// The two bits of linear algebra ridge regression needs. Plain loops; n is at most a few hundred.

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Solve A·x = b for a symmetric positive-definite A (n × n) with a Cholesky decomposition A = L·Lᵀ.
 * A ridge kernel matrix plus λ·I (λ > 0) is always positive-definite, so this never fails in practice.
 */
export function choleskySolve(A: Float64Array[], b: ArrayLike<number>): Float64Array {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) throw new Error('matrix is not positive-definite');
        L[i][i] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  // Forward substitution: L·z = b
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * z[k];
    z[i] = sum / L[i][i];
  }
  // Back substitution: Lᵀ·x = z
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}
