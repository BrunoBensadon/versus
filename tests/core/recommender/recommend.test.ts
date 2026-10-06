import { describe, expect, it } from 'vitest';
import { globalOrder, replay, scores } from '../../../src/core/ranking';
import { buildFeatures, columnLabel, prepareRecommender, recommend, vectorize } from '../../../src/core/recommender';
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

    // Every reason names a feature the candidate actually has (deviation 19). Rebuild the same
    // feature space recommend() fitted on (the ranked games, best first), then list the labels of
    // the candidate's non-zero columns, plus the rating label when the game has a rating.
    const metaById = new Map(games.map((g) => [g.id, g]));
    const trainMetas = globalOrder(state)
      .filter((id) => metaById.has(id) && scoreMap.has(id))
      .map((id) => metaById.get(id)!);
    const space = buildFeatures(trainMetas);
    for (const p of preds) {
      const meta = metaById.get(p.gameId)!;
      const x = vectorize(space, meta);
      const has = new Set<string>();
      space.columns.forEach((col, j) => {
        if (x[j] !== 0) has.add(columnLabel(col));
        if (col.block === 'consensus' && meta.totalRating !== null) has.add(columnLabel(col));
      });
      for (const r of p.reasons) expect(has, `game ${p.gameId}: "${r.label}"`).toContain(r.label);
    }

    // Fit once, predict many: the prepared function gives what recommend() gives, call after call.
    const [a, b, c, d] = candidates;
    const prepared = prepareRecommender(state, scoreMap, games);
    expect(prepared([a, b])).toEqual(recommend(state, scoreMap, games, [a, b]));
    expect(prepared([c, d, a])).toEqual(recommend(state, scoreMap, games, [c, d, a]));
    expect(prepared([b])).toEqual(recommend(state, scoreMap, games, [b]));
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
