import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = os.homedir();
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONFIG_DIR = path.join(ROOT, 'config');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'interstice.config.json');
export const CONFIG_DEFAULT = path.join(CONFIG_DIR, 'interstice.config.default.json');

export const LOG_DIR = path.join(ROOT, 'logs');
export const EVENTS_LOG = path.join(LOG_DIR, 'events.jsonl');
export const GAPS_LOG = path.join(LOG_DIR, 'gaps.jsonl');
export const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log');
export const QUEUED_PROMPTS = path.join(LOG_DIR, 'queued_prompts.jsonl');
export const PID_FILE = path.join(LOG_DIR, 'interstice.pid');
export const OFFSETS_FILE = path.join(LOG_DIR, 'offsets.json');

/**
 * Cowork (Claude Desktop local agent mode) keeps one private `.claude` home per
 * session. That is why hooks configured in ~/.claude/settings.json never fire there:
 * the session home contains no settings.json at all. It does contain an ordinary
 * Claude Code transcript, which is what we watch instead.
 */
export const COWORK_SESSIONS_ROOT = path.join(
  HOME,
  'Library',
  'Application Support',
  'Claude',
  'local-agent-mode-sessions'
);

/** Claude Code CLI transcripts. Watched as a fallback when the hook is not installed. */
export const CLAUDE_CODE_PROJECTS = path.join(HOME, '.claude', 'projects');

export const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.json');

export const LAUNCH_AGENT = path.join(
  HOME,
  'Library',
  'LaunchAgents',
  'com.interstice.daemon.plist'
);
