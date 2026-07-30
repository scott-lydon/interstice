/**
 * Gap statistics.
 *
 * This exists to make the system falsifiable. The premise is that the gap is where
 * the habit loop gets in; if that is wrong, these numbers are what will say so.
 * Accordingly, nothing here is designed to flatter: the headline figures include
 * the ones that would indict the router.
 *
 * Synthetic gaps (driven from /debug) are excluded everywhere. A debug surface that
 * can inflate the statistics beside it is worse than no statistics.
 */

const REAL = (g) => !g.synthetic;

/**
 * A false positive is a delivery you immediately rejected: you stood down, or the
 * gap closed within a few seconds of being moved. Either way we interrupted you
 * when we should not have.
 */
export function isFalsePositive(gap, { windowSec = 10 } = {}) {
  if (!gap.delivered?.length) return false;
  if (gap.stoodDown) return true;
  const lastDelivery = gap.delivered[gap.delivered.length - 1];
  return gap.endedAt - lastDelivery.at < windowSec * 1000;
}

export function summarize(allGaps, config = {}) {
  const gaps = allGaps.filter(REAL);
  const delivered = gaps.filter((g) => g.delivered?.length);
  const durations = gaps.map((g) => g.durationSec).filter((d) => Number.isFinite(d));
  const sorted = durations.slice().sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

  const byRung = {};
  for (const g of delivered) {
    for (const d of g.delivered) {
      byRung[d.rung] = (byRung[d.rung] || 0) + 1;
    }
  }

  const falsePositives = delivered.filter((g) => isFalsePositive(g));
  const stoodDown = gaps.filter((g) => g.stoodDown);
  const reclaimedSec = delivered.reduce((acc, g) => {
    const first = g.delivered[0].at;
    return acc + Math.max(0, (g.endedAt - first) / 1000);
  }, 0);

  return {
    generatedAt: Date.now(),
    totals: {
      gaps: gaps.length,
      synthetic: allGaps.length - gaps.length,
      delivered: delivered.length,
      deliveryRate: gaps.length ? delivered.length / gaps.length : 0,
      minutesReclaimed: Math.round(reclaimedSec / 60),
    },
    duration: {
      medianSec: pct(0.5),
      p90Sec: pct(0.9),
      maxSec: sorted.length ? sorted[sorted.length - 1] : 0,
      belowArm: durations.filter((d) => d < (config.arm ?? 25)).length,
    },
    byRung,
    quality: {
      falsePositives: falsePositives.length,
      falsePositiveRate: delivered.length ? falsePositives.length / delivered.length : 0,
      standDowns: stoodDown.length,
      standDownRate: gaps.length ? stoodDown.length / gaps.length : 0,
    },
    bySurface: gaps.reduce((acc, g) => {
      acc[g.surface] = (acc[g.surface] || 0) + 1;
      return acc;
    }, {}),
  };
}

/**
 * Suggest thresholds from observed data rather than from the opening guess.
 * Returns null when there is not enough history to say anything honest.
 */
export function suggestThresholds(allGaps, { minSample = 50 } = {}) {
  const durations = allGaps
    .filter(REAL)
    .map((g) => g.durationSec)
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  if (durations.length < minSample) {
    return { enough: false, sample: durations.length, needed: minSample };
  }
  const q = (p) => durations[Math.floor(durations.length * p)];
  return {
    enough: true,
    sample: durations.length,
    arm: Math.max(10, Math.round(q(0.15) / 5) * 5),
    mid: Math.round(q(0.55) / 10) * 10,
    long: Math.round(q(0.85) / 30) * 30,
  };
}
