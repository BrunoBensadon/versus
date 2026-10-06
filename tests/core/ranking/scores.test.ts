import { describe, expect, it } from 'vitest';
import { bandOf, formatScore, scores } from '../../../src/core/ranking';

const lists = (loved: number[], liked: number[], disliked: number[]) => ({ lists: { loved, liked, disliked } });

describe('scores', () => {
  it('gives no scores for an empty bucket (n = 0)', () => {
    expect(scores(lists([], [], [])).size).toBe(0);
  });

  it('a single game gets the top of its band (n = 1)', () => {
    const s = scores(lists([1], [2], [3]));
    expect(s.get(1)).toBe(10.0);
    expect(s.get(2)).toBe(6.6);
    expect(s.get(3)).toBe(3.3);
  });

  it('two games get the two ends of the band (n = 2)', () => {
    const s = scores(lists([1, 2], [], []));
    expect(s.get(1)).toBe(10.0);
    expect(s.get(2)).toBeCloseTo(6.7, 10);
  });

  it('spreads positions linearly', () => {
    const s = scores(lists([], [1, 2, 3], []));
    expect(s.get(2)).toBeCloseTo(5.0, 10);
  });

  it('bandOf maps a score back to its bucket; gaps go to the lower bucket', () => {
    expect(bandOf(9)).toBe('loved');
    expect(bandOf(6.7)).toBe('loved');
    expect(bandOf(6.66)).toBe('loved');
    expect(bandOf(6.64)).toBe('liked');
    expect(bandOf(6.699999999999999)).toBe('loved');
    expect(bandOf(3.4)).toBe('liked');
    expect(bandOf(3.36)).toBe('liked');
    expect(bandOf(3.34)).toBe('disliked');
    expect(bandOf(0)).toBe('disliked');
  });

  it('formats with one decimal', () => {
    expect(formatScore(6.66666)).toBe('6.7');
  });
});
