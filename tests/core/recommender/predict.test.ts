import { describe, expect, it } from 'vitest';
import { confidence, cosine, fitRidge, knnScore, neighbours, predict } from '../../../src/core/recommender';

const v = (...x: number[]) => Float64Array.from(x);

describe('predict', () => {
  it('contributions sum to raw score − baseline', () => {
    const m = fitRidge([v(1, 0, 0.5), v(0, 1, 0.2), v(1, 1, 0.9), v(0, 0, 0.1)], [8, 3, 9, 1], 0.3);
    const p = predict(m, v(1, 0.5, 0.4));
    const sum = p.contributions.reduce((s, c) => s + c.value, 0);
    expect(sum).toBeCloseTo(p.raw - p.baseline, 10);
  });

  it('sorts contributions by size and clamps the score to 0..10', () => {
    const m = fitRidge([v(0), v(1)], [0, 10], 0.001);
    const p = predict(m, v(5));
    expect(p.raw).toBeGreaterThan(10);
    expect(p.score).toBe(10);
    // Largest |value| first: the game page's reasons read the head of this list.
    const m3 = fitRidge([v(1, 0, 0.5), v(0, 1, 0.2), v(1, 1, 0.9), v(0, 0, 0.1)], [8, 3, 9, 1], 0.3);
    const sizes = predict(m3, v(0.5, 1, 1)).contributions.map((c) => Math.abs(c.value));
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});

describe('neighbours and kNN', () => {
  it('cosine of orthogonal vectors is 0; of a zero vector is 0', () => {
    expect(cosine(v(1, 0), v(0, 1))).toBe(0);
    expect(cosine(v(0, 0), v(1, 1))).toBe(0);
  });

  it('returns the k most similar, ties broken by id', () => {
    const ranked = [
      { id: 3, x: v(1, 0) },
      { id: 1, x: v(1, 0) },
      { id: 2, x: v(0, 1) },
    ];
    expect(neighbours(v(1, 0), ranked, 2).map((n) => n.id)).toEqual([1, 3]);
  });

  it('kNN score is the similarity-weighted mean, ignoring negative similarity', () => {
    const score = (id: number) => ({ 1: 8, 2: 2, 3: 5 })[id]!;
    expect(knnScore([{ id: 1, similarity: 0.75 }, { id: 2, similarity: 0.25 }, { id: 3, similarity: -1 }], score, 0)).toBeCloseTo(6.5, 10);
    expect(knnScore([{ id: 3, similarity: -1 }], score, 4.2)).toBe(4.2);
  });
});

describe('confidence', () => {
  const base = { rankedCount: 50, maxSimilarity: 0.6, vocabCoverage: 0.8, hasSteamTags: true };
  it('is high with enough data, Steam tags and a close neighbour', () => {
    expect(confidence(base)).toBe('high');
  });
  it('is low below 20 ranked games, weak similarity or poor coverage', () => {
    expect(confidence({ ...base, rankedCount: 19 })).toBe('low');
    expect(confidence({ ...base, maxSimilarity: 0.29 })).toBe('low');
    expect(confidence({ ...base, vocabCoverage: 0.49 })).toBe('low');
  });
  it('is capped at medium without Steam tags', () => {
    expect(confidence({ ...base, hasSteamTags: false })).toBe('medium');
  });
});
