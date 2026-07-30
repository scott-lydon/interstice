import { activate, notify } from './state/system.js';

/**
 * The way back.
 *
 * This is the stage that decides whether the whole system is trusted. If you do not
 * believe you will be fetched, you will keep checking, and checking is exactly the
 * moment we set out to delete.
 *
 * Two rules:
 *   - It never types into the delivered app. A half-answered Anki card survives
 *     being backgrounded because Anki keeps its own state; sending keystrokes to
 *     "clean up" would be the thing that loses it.
 *   - It only raises a window. Nothing is quit, hidden, or closed.
 */

const ORIGIN_APP = {
  cowork: 'Claude',
  'claude-code': null, // resolved from the terminal that owned the session
};

export function originAppFor(surface, config, hint) {
  if (hint && config.originApps.includes(hint)) return hint;
  return ORIGIN_APP[surface] || config.originApps[0];
}

export async function reclaim({ gap, config, reason, logger }) {
  const app = originAppFor(gap.surface, config, gap.originApp);
  const detail = { app, reason, gapId: gap.id };

  try {
    await activate(app);
    detail.activated = true;
  } catch (err) {
    detail.activated = false;
    detail.error = err.message;
    logger?.warn('reclaim could not raise the origin app', detail);
  }

  if (config.notifications) {
    const what =
      reason === 'permission'
        ? 'needs your permission'
        : reason === 'complete'
          ? 'finished'
          : reason;
    const where = gap.surface === 'cowork' ? 'Cowork' : 'Claude Code';
    await notify('Interstice', `${where} ${what}`);
    detail.notified = true;
  }

  return detail;
}
