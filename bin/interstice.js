#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { readToken } from '../lib/auth.js';
import { loadCached } from '../lib/config.js';
import { Daemon } from '../lib/daemon.js';
import { createLogger, readJsonl } from '../lib/logger.js';
import { runDoctor } from '../lib/doctor.js';
import { install, uninstall } from '../lib/install.js';
import { PID_FILE, GAPS_LOG, LOG_DIR } from '../lib/paths.js';
import { summarize, suggestThresholds } from '../lib/stats.js';
import { openUrl } from '../lib/state/system.js';
import { buildHotkeyApps, instructions } from '../lib/hotkeys.js';

const [, , cmd, ...args] = process.argv;
const has = (flag) => args.includes(flag);

const USAGE = `interstice - fills the dead moment after you dispatch an AI agent

  doctor              Prove every dependency. Exits non-zero when a required check fails.
  install             Write config, install hooks and the LaunchAgent.
  uninstall           Remove hooks and the LaunchAgent. Leaves your logs.
  start [--foreground]
  stop
  status              Current gap, counters, health.
  advance             Move to the next rung.
  standdown [--day]   Stop routing for this gap, or for today.
  dashboard           Open the log UI.
  hotkeys             Build the advance / stand-down apps and print how to bind them.
  stats [--tune]      Summarise your gaps. --tune suggests thresholds from data.
  simulate <seconds>  Drive a synthetic gap. Tagged, excluded from stats.
`;

async function api(pathname, { method = 'GET', body } = {}) {
  const config = loadCached();
  // The control surface authenticates every request. A local client proves it is local by reading
  // the mode 0600 token the daemon minted, which a web page on another origin cannot do.
  const token = readToken(LOG_DIR);
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers['x-interstice-token'] = token;
  const res = await fetch(`http://127.0.0.1:${config.port}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function daemonPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null; // stale pidfile
  }
}

function fmtSec(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

async function main() {
  switch (cmd) {
    case 'doctor': {
      const ok = await runDoctor({ fix: has('--fix') });
      process.exit(ok ? 0 : 1);
      break;
    }

    case 'install': {
      // install() returns false when the LaunchAgent did not end up loaded and running. Pointing
      // at doctor after a failed install sends you to a second command to be told the same thing,
      // so the failure is the exit code here instead.
      const ok = await install({ force: has('--force') });
      if (!ok) {
        console.error('\ninstall did not finish: the LaunchAgent is not running. Fix the line above, then re-run.');
        process.exit(1);
      }
      console.log('\nNow run:  interstice doctor');
      break;
    }

    case 'uninstall':
      await uninstall();
      break;

    case 'start': {
      const existing = daemonPid();
      if (existing) {
        console.error(`already running (pid ${existing}). Use "interstice stop" first.`);
        process.exit(1);
      }
      const config = loadCached();
      const logger = createLogger({ toFile: !has('--foreground') });
      const daemon = new Daemon({ config, logger });
      await daemon.start();
      console.log(`interstice listening on http://127.0.0.1:${config.port}`);
      const shutdown = async () => {
        await daemon.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      break;
    }

    case 'stop': {
      const pid = daemonPid();
      if (!pid) {
        console.log('not running');
        break;
      }
      process.kill(pid, 'SIGTERM');
      console.log(`stopped (pid ${pid})`);
      break;
    }

    case 'status': {
      const pid = daemonPid();
      if (!pid) {
        console.log('interstice is not running');
        process.exit(1);
      }
      const health = await api('/api/health');
      console.log(`running          pid ${health.pid}, up ${fmtSec(health.uptimeSec)}`);
      console.log(`gap              ${health.open ? `${health.gap.surface}, ${fmtSec(health.gap.elapsed)}, rung=${health.gap.current ?? 'none yet'}` : 'none open'}`);
      console.log(`counters         ${Object.entries(health.counters).map(([k, v]) => `${k}=${v}`).join('  ')}`);
      if (health.detectionSilent) console.log('WARNING          no events seen in 24h. Detection may be broken.');
      break;
    }

    case 'advance':
      console.log(JSON.stringify(await api('/api/advance', { method: 'POST' })));
      break;

    case 'standdown':
      console.log(JSON.stringify(await api('/api/standdown', { method: 'POST', body: { day: has('--day') } })));
      break;

    case 'hotkeys': {
      const config = loadCached();
      const built = await buildHotkeyApps({ port: config.port });
      console.log(instructions(built));
      break;
    }

    case 'dashboard': {
      const config = loadCached();
      await openUrl(`http://127.0.0.1:${config.port}/`);
      break;
    }

    case 'stats': {
      const gaps = readJsonl(GAPS_LOG);
      const s = summarize(gaps, loadCached());
      console.log(`gaps             ${s.totals.gaps} real (${s.totals.synthetic} synthetic, excluded)`);
      console.log(`delivered        ${s.totals.delivered} (${(s.totals.deliveryRate * 100).toFixed(1)}%)`);
      console.log(`reclaimed        ${s.totals.minutesReclaimed} min inside activities`);
      console.log(`median turn      ${fmtSec(s.duration.medianSec)}   p90 ${fmtSec(s.duration.p90Sec)}`);
      console.log(`by rung          ${Object.entries(s.byRung).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'}`);
      console.log(`false positives  ${s.quality.falsePositives} (${(s.quality.falsePositiveRate * 100).toFixed(1)}%)`);
      console.log(`stand downs      ${s.quality.standDowns} (${(s.quality.standDownRate * 100).toFixed(1)}%)`);
      if (has('--tune')) {
        const t = suggestThresholds(gaps);
        console.log('');
        if (!t.enough) console.log(`tuning           not yet: ${t.sample}/${t.needed} gaps logged`);
        else console.log(`tuning           arm=${t.arm} mid=${t.mid} long=${t.long}  (from ${t.sample} gaps)`);
      }
      break;
    }

    case 'simulate': {
      const seconds = Number(args[0] || 60);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        console.error('usage: interstice simulate <seconds>');
        process.exit(1);
      }
      await api('/debug/submit', { method: 'POST', body: { surface: 'debug' } });
      console.log(`synthetic gap opened; ending it in ${seconds}s (tagged, excluded from stats)`);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const out = await api('/debug/end', { method: 'POST', body: { reason: 'complete' } });
      console.log(JSON.stringify(out.gap, null, 2));
      break;
    }

    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`interstice: ${err.message}`);
  process.exit(1);
});
