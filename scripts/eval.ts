// Offline evaluation CLI (spec §7.4).
//   npm run eval -- path/to/export.json
// Reads an export (Settings → Export, or the backup repo), runs evaluate() with fixed seeds and prints
// mean pairwise accuracy and Kendall τ with 95% bootstrap intervals for the model and the baselines.
// Exports hold personal data: keep them OUT of this public repo (exports/ is git-ignored).

import { readFileSync } from 'node:fs';
import { evaluate, MODEL_NAMES, type EvalReport } from '../src/core/recommender';
import type { ExportFile } from '../src/core/types';

export function formatReport(report: EvalReport): string {
  if (!report.ok) return `Not evaluated: ${report.reason}`;
  const fmt = (i: { mean: number; lo: number; hi: number }) => `${i.mean.toFixed(3)} [${i.lo.toFixed(3)}, ${i.hi.toFixed(3)}]`;
  const lines = [
    `Ranked games: ${report.ranked} · folds: ${report.folds}`,
    '',
    `${'model'.padEnd(20)}${'pairwise accuracy'.padEnd(28)}Kendall τ`,
    ...MODEL_NAMES.map((name) => `${name.padEnd(20)}${fmt(report.models[name].acc).padEnd(28)}${fmt(report.models[name].tau)}`),
    '',
    report.ridgeBeatsKnn
      ? 'Ship rule: ridge beats kNN-5 → keep SCORER = "ridge" in src/core/recommender/config.ts.'
      : 'Ship rule: ridge does NOT beat kNN-5 → set SCORER = "knn" in src/core/recommender/config.ts.',
  ];
  return lines.join('\n');
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npm run eval -- <export.json>');
    process.exit(1);
  }
  const file = JSON.parse(readFileSync(path, 'utf8')) as ExportFile;
  const report = evaluate({ events: file.events, games: file.games }, { repeats: 5, folds: 5, seed: 1 });
  console.log(formatReport(report));
}

// Run main() only when this file is executed directly, not when a test imports formatReport.
if (process.argv[1]?.endsWith('eval.ts')) main();
