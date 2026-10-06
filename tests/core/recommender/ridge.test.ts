import { describe, expect, it } from 'vitest';
import { chooseLambda, fitRidge, LAMBDA_GRID, rawPredict } from '../../../src/core/recommender';
import { choleskySolve } from '../../../src/core/recommender/linalg';
import { seededRandom } from '../../../src/core/random';

const rows = (...r: number[][]) => r.map((x) => Float64Array.from(x));

describe('choleskySolve', () => {
  it('solves a 2 × 2 system', () => {
    const x = choleskySolve(rows([4, 2], [2, 3]), [2, 1]);
    expect(x[0]).toBeCloseTo(0.5, 10);
    expect(x[1]).toBeCloseTo(0, 10);
  });

  it('refuses a matrix that is not positive-definite', () => {
    expect(() => choleskySolve(rows([1, 2], [2, 1]), [1, 1])).toThrow(/positive-definite/);
  });
});

describe('fitRidge', () => {
  it('matches a hand-solved 3 × 2 case', () => {
    // X = [[1,0],[0,1],[1,1]], y = [1,2,3], λ = 1. Centered primal solution, worked by hand:
    // XcᵀXc + I = [[5/3, −1/3], [−1/3, 5/3]], Xcᵀ(y − ȳ) = [0, 1] → w = [1/8, 5/8];
    // intercept = ȳ − x̄·w = 2 − (2/3)(6/8) = 1.5.
    const m = fitRidge(rows([1, 0], [0, 1], [1, 1]), [1, 2, 3], 1);
    expect(m.w[0]).toBeCloseTo(0.125, 10);
    expect(m.w[1]).toBeCloseTo(0.625, 10);
    expect(m.intercept).toBeCloseTo(1.5, 10);
    expect(m.yMean).toBeCloseTo(2, 10);
    expect(rawPredict(m, Float64Array.from([1, 1]))).toBeCloseTo(2.25, 10);
  });

  it('shrinks toward the mean as λ grows', () => {
    const X = rows([1, 0], [0, 1], [1, 1]);
    const small = fitRidge(X, [1, 2, 3], 0.01);
    const big = fitRidge(X, [1, 2, 3], 1000);
    const x = Float64Array.from([1, 1]);
    expect(Math.abs(rawPredict(big, x) - 2)).toBeLessThan(Math.abs(rawPredict(small, x) - 2));
  });
});

describe('chooseLambda', () => {
  it('returns 1 below 10 games', () => {
    expect(chooseLambda(rows([1], [2], [3]), [1, 2, 3])).toBe(1);
  });

  it('returns a value from the grid and is deterministic', () => {
    const rand = seededRandom(3);
    const X = Array.from({ length: 30 }, () => Float64Array.from([rand(), rand(), rand()]));
    const y = X.map((x) => 3 * x[0] - 2 * x[1] + 0.1 * rand());
    const a = chooseLambda(X, y);
    expect(LAMBDA_GRID).toContain(a);
    expect(chooseLambda(X, y)).toBe(a);
  });
});
