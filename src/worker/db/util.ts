// Helpers shared by the db/*.ts files.
// D1 allows at most 100 bound parameters per statement, so lists of ids are queried in chunks.

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "?,?,?" for n parameters. */
export const marks = (n: number): string => Array(n).fill('?').join(',');
