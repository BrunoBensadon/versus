// The design spike as a regression test (spec §11): on a synthetic library where taste is linear in
// the features, the ridge model must beat the genre-average baseline.

import { describe, expect, it } from 'vitest';
import { evaluate, kendallTau, MODEL_NAMES } from '../../../src/core/recommender';
import { syntheticDataset } from '../../fixtures/synthetic';

describe('kendallTau', () => {
  it('is 1 for identical order, −1 for reversed, NaN below 2 items', () => {
    expect(kendallTau([1, 2, 3], [10, 20, 30])).toBe(1);
    expect(kendallTau([1, 2, 3], [30, 20, 10])).toBe(-1);
    expect(kendallTau([1], [1])).toBeNaN();
  });
});

describe('evaluate', () => {
  it('reports "not enough data" below 20 ranked games', () => {
    const data = syntheticDataset({ games: 15, seed: 1, noise: 0.3 });
    const report = evaluate(data, { repeats: 1, folds: 5, seed: 1 });
    expect(report.ok).toBe(false);
  });

  it('ridge beats the genre-average baseline on a synthetic library', { timeout: 30_000 }, () => {
    const data = syntheticDataset({ games: 70, seed: 5, noise: 0.3 });
    const report = evaluate(data, { repeats: 2, folds: 5, seed: 1 });
    if (!report.ok) throw new Error(report.reason);
    expect(report.folds).toBe(10);
    expect(report.models.ridge.acc.mean).toBeGreaterThan(report.models.genre_avg.acc.mean);
    expect(report.models.ridge.acc.mean).toBeGreaterThan(report.models.mean_only.acc.mean + 0.03);
    for (const name of MODEL_NAMES) {
      const acc = report.models[name].acc;
      expect(acc.lo).toBeLessThanOrEqual(acc.mean);
      expect(acc.hi).toBeGreaterThanOrEqual(acc.mean);
    }
  });

  it('runs the Steam-masked subgroup and is deterministic for a given seed', { timeout: 30_000 }, () => {
    const data = syntheticDataset({ games: 40, seed: 9, noise: 0.5 });
    const a = evaluate(data, { repeats: 1, folds: 5, seed: 3 });
    const b = evaluate(data, { repeats: 1, folds: 5, seed: 3 });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(Number.isNaN(a.models.ridge_steam_masked.acc.mean)).toBe(false);
    expect(a).toEqual(b);
  });
});
