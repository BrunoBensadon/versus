// Which scorer the app uses (spec §7.4 ship rule).
// Run `npm run eval -- <export.json>`. If ridge does NOT beat kNN-5 on pairwise accuracy, change this
// to 'knn' and commit. The UI then hides the feature contributions; everything else stays the same.

export type Scorer = 'ridge' | 'knn';

export const SCORER: Scorer = 'ridge';
