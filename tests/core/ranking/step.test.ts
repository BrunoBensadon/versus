import { describe, expect, it } from 'vitest';
import { step } from '../../../src/core/ranking';

describe('step', () => {
  it('places the first game of an empty bucket at the top without asking', () => {
    expect(step([], [])).toEqual({ kind: 'place', below: null });
  });

  it('asks about the middle game first', () => {
    // 5 games → candidate slots 0..5 → middle index floor(5/2) = 2
    expect(step([10, 20, 30, 40, 50], [])).toEqual({ kind: 'ask', pivot: 30 });
  });

  it('narrows to the top half after "better"', () => {
    expect(step([10, 20, 30, 40, 50], [{ pivot: 30, result: 'better' }])).toEqual({ kind: 'ask', pivot: 20 });
  });

  it('places at the very top after beating everything asked', () => {
    const answers = [
      { pivot: 30, result: 'better' as const },
      { pivot: 20, result: 'better' as const },
      { pivot: 10, result: 'better' as const },
    ];
    expect(step([10, 20, 30, 40, 50], answers)).toEqual({ kind: 'place', below: null });
  });

  it('places at the bottom after losing to everything asked', () => {
    const answers = [
      { pivot: 30, result: 'worse' as const },
      { pivot: 50, result: 'worse' as const },
    ];
    // after 30 worse: slots 3..5, mid 4 → list[4] = 50; after 50 worse: slot 5 → below 50
    expect(step([10, 20, 30, 40, 50], answers)).toEqual({ kind: 'place', below: 50 });
  });

  it('"too close" places the game directly below the pivot', () => {
    expect(step([10, 20, 30, 40, 50], [{ pivot: 30, result: 'tie' }])).toEqual({ kind: 'place', below: 30 });
  });

  it('reports stale when an answer pivot is not where it should be', () => {
    expect(step([10, 20, 99, 40, 50], [{ pivot: 30, result: 'better' }])).toEqual({ kind: 'stale' });
  });

  it('reports stale when there are more answers than the list needs', () => {
    expect(step([10], [{ pivot: 10, result: 'better' }, { pivot: 10, result: 'better' }])).toEqual({ kind: 'stale' });
  });

  it('asks at most ceil(log2(m+1)) questions', () => {
    for (const m of [1, 2, 7, 60, 100, 200]) {
      const list = Array.from({ length: m }, (_, i) => i + 1);
      // Always answer "worse" (the longest path to the bottom).
      const answers: { pivot: number; result: 'worse' }[] = [];
      for (;;) {
        const next = step(list, answers);
        if (next.kind !== 'ask') break;
        answers.push({ pivot: next.pivot, result: 'worse' });
      }
      expect(answers.length).toBeLessThanOrEqual(Math.ceil(Math.log2(m + 1)));
    }
  });
});
