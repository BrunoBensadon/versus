import { describe, expect, it } from 'vitest';
import { replay, scores } from '../../../src/core/ranking';
import { recommend } from '../../../src/core/recommender';
import { syntheticEvents, syntheticGames, syntheticUtility } from '../../fixtures/synthetic';

describe('recommend', () => {
  const opts = { games: 60, seed: 11, noise: 0.3 };
  const games = syntheticGames(opts);
  const utility = syntheticUtility(games, opts);
  // Rank games 1-50; games 51-60 are the unranked candidates.
  const rankedUtility = new Map([...utility].filter(([id]) => id <= 50));
  const state = replay(syntheticEvents(rankedUtility, opts.seed));
  const scoreMap = scores(state);
  const candidates = games.filter((g) => g.id > 50).map((g) => g.id);

  it('returns one prediction per candidate with a score, bucket, bracket and 3 similar games', () => {
    const preds = recommend(state, scoreMap, games, candidates);
    expect(preds).toHaveLength(10);
    for (const p of preds) {
      expect(p.score).not.toBeNull();
      expect(p.score!).toBeGreaterThanOrEqual(0);
      expect(p.score!).toBeLessThanOrEqual(10);
      expect(p.bucket).not.toBeNull();
      expect(p.above !== null || p.below !== null).toBe(true);
      if (p.above) expect(p.above.score).toBeGreaterThanOrEqual(p.score!);
      if (p.below) expect(p.below.score).toBeLessThan(p.score!);
      expect(p.similar).toHaveLength(3);
      expect(p.reasons.length).toBeGreaterThan(0);
      expect(p.reasons.length).toBeLessThanOrEqual(4);
    }
  });

  it('kNN mode gives the same shape without reasons', () => {
    const preds = recommend(state, scoreMap, games, candidates, { scorer: 'knn' });
    expect(preds).toHaveLength(10);
    expect(preds.every((p) => p.reasons.length === 0 && p.score !== null)).toBe(true);
  });

  it('is honest below 5 ranked games: score null, confidence low', () => {
    const tiny = replay(syntheticEvents(new Map([...utility].filter(([id]) => id <= 3)), opts.seed));
    const preds = recommend(tiny, scores(tiny), games, candidates);
    expect(preds.every((p) => p.score === null && p.confidence === 'low')).toBe(true);
  });

  it('skips candidates without metadata', () => {
    expect(recommend(state, scoreMap, games, [99999])).toEqual([]);
  });
});
