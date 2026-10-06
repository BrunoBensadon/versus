# versus Plan 2 — Recommender

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict how Bruno would score any unranked game (score, implied bucket, the ranked games around it, a confidence label and a readable "why"), and measure the model offline with `npm run eval`.

**Architecture:** Pure TypeScript in `src/core/recommender/`, with no libraries. Metadata becomes block-normalized feature vectors. Ridge regression on the ranked games' scores is solved in dual form with a hand-written Cholesky solve. `recommend()` is the single call the UI makes. `evaluate()` runs repeated k-fold cross-validation against baselines, and `scripts/eval.ts` prints its report.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.11, tsx 4.23.15 (runs the eval CLI).

**Spec:** `docs/specs/2026-10-06-versus-design.md` §7 (recommender), §4 (interfaces), §11 (recommender tests), decisions D11–D13.
**Roadmap:** `docs/superpowers/plans/2026-10-06-versus-v1-roadmap.md`. This is Plan 2 of 6 and needs Plan 1 merged.

## Global Constraints

- Everything in this plan lives under `src/core/` and obeys the boundary rule: no npm imports, no `fetch`, no DOM, no D1. `tests/boundary.test.ts` (Plan 1) checks every new file automatically.
- No ML or linear-algebra library. Ridge plus Cholesky is about 60 lines (spec §7.2).
- Steam playtime is **never** a model feature (spec D19).
- Keyword stop-list and min-df values exactly as spec §7.1. λ grid exactly `{0.1, 0.3, 1, 3, 10}`.
- Confidence thresholds exactly spec §7.3: `low` if ranked < 20 or max similarity < 0.3 or vocabulary coverage < 0.5; `high` if ranked ≥ 40 and Steam tags and max similarity ≥ 0.5; else `medium`.
- Evaluation needs ≥ 20 ranked games; default protocol 5 repeats × 5 folds, seed 1 (spec §7.4).
- Exports hold personal data. Never commit one; `exports/` is git-ignored (Plan 1).
- Commits end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Deviations from the spec (decided while writing this plan; recorded in the roadmap)

1. **Baseline `mean_only` added to the evaluation report.** Spec §7.4's pairwise metric compares pred(h) with score(t) for *training* games t. Under that metric, predicting the training mean for every game already scores ≈ 0.75, because most training games sit far from the middle (✅ measured on the synthetic library: `mean_only` 0.748, `knn5` 0.753, `ridge` 0.807). "0.5 = chance" is therefore wrong for this metric; the design simulation compared prediction against prediction. The report shows `mean_only` as the real floor, and nothing else in the protocol changes.
2. `recommend()` returns `score: null` (confidence `low`) below **5** ranked games, since a model can't be fitted on fewer. Spec R-REC-7 asks for honesty at small n but names no floor.
3. The ship rule's kNN switch is a constant, `SCORER` in `src/core/recommender/config.ts`. Bruno flips it after reading `npm run eval`.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/recommender/features.ts` | stop-list, vocabulary (min-df), block-normalized vectors, readable column labels, vocabulary coverage |
| `src/core/recommender/linalg.ts` | `dot`, `choleskySolve` |
| `src/core/recommender/metrics.ts` | held-out pairwise accuracy, Kendall τ, bootstrap interval |
| `src/core/recommender/ridge.ts` | dual ridge fit, raw prediction, λ by inner CV |
| `src/core/recommender/predict.ts` | clamped prediction + contributions, cosine neighbours, kNN scorer, confidence rule |
| `src/core/recommender/config.ts` | `SCORER`: ship-rule switch between ridge and kNN |
| `src/core/recommender/recommend.ts` | `recommend()`: the UI's single entry point |
| `src/core/recommender/evaluate.ts` | `evaluate()`: repeated k-fold with leak-free training scores, 5 baselines |
| `src/core/recommender/index.ts` | public surface (`export *` per file) |
| `scripts/eval.ts` | `npm run eval -- <export.json>` |
| `tests/core/helpers/game.ts` | `game(id, overrides)`: a fully filled GameMeta for tests |
| `tests/fixtures/synthetic.ts` | synthetic library + oracle-ranked event log (no personal data) |
| `tests/core/recommender/*.test.ts` | one test file per source file |

---

### Task 1: Feature space

**Files:**
- Create: `src/core/recommender/features.ts`, `src/core/recommender/index.ts`, `tests/core/helpers/game.ts`
- Test: `tests/core/recommender/features.test.ts`

**Interfaces:**
- Consumes: `GameMeta` (Plan 1, `src/core/types.ts`).
- Produces (from `src/core/recommender`): `type BlockName`, `BLOCKS`, `STOP_KEYWORDS: ReadonlySet<string>`, `interface FeatureConfig { minDf: Record<BlockName, number> }`, `DEFAULT_FEATURE_CONFIG`, `interface Column { block; key; label }`, `interface FeatureSpace { columns: Column[]; index: Map<string, number>; ratingMean: number; ratingSd: number }`, `columnLabel(column: Column): string`, `rawFeatures(g, opts?)`, `buildFeatures(train: GameMeta[], cfg?): FeatureSpace`, `vectorize(space, g, opts?: { maskSteam?: boolean }): Float64Array`, `vocabCoverage(space, g): number`. Column keys look like `'genre:rpg'`, `'steam_tag:3959'`, `'consensus:total_rating'`, `'has_steam_tags:has_steam_tags'`. Test helper: `game(id: number, overrides?: Partial<GameMeta>): GameMeta`.

- [ ] **Step 1: Create a branch**

```bash
git checkout main && git pull && git checkout -b p2-recommender
```

- [ ] **Step 2: Write the test helper**

`tests/core/helpers/game.ts`:

```ts
// Test helper: a GameMeta with every field filled, so tests only spell out what matters to them.
import type { GameMeta } from '../../../src/core/types';

export function game(id: number, overrides: Partial<GameMeta> = {}): GameMeta {
  return {
    id,
    name: `Game ${id}`,
    year: 2020,
    gameType: 0,
    coverImageId: null,
    genres: [],
    themes: [],
    keywords: [],
    modes: [],
    perspectives: [],
    collections: [],
    franchises: [],
    developers: [],
    platforms: [],
    totalRating: null,
    ratingCount: 0,
    steamTags: null,
    ttb: null,
    versionParent: null,
    parentGame: null,
    ...overrides,
  };
}
```

- [ ] **Step 3: Write the failing test**

`tests/core/recommender/features.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildFeatures, columnLabel, vectorize, vocabCoverage } from '../../../src/core/recommender';
import { game } from '../helpers/game';

const tags = (...ids: number[]) => ids.map((tagId, i) => ({ tagId, name: `Tag${tagId}`, weight: 100 * (ids.length - i) }));

describe('buildFeatures', () => {
  it('keeps genres at min-df 1 but keywords only when ≥ 3 ranked games use them', () => {
    const train = [
      game(1, { genres: ['RPG'], keywords: ['roguelite', 'rare'] }),
      game(2, { genres: ['Puzzle'], keywords: ['roguelite'] }),
      game(3, { keywords: ['roguelite'] }),
    ];
    const keys = buildFeatures(train).columns.map((c) => `${c.block}:${c.key}`);
    expect(keys).toContain('genre:rpg');
    expect(keys).toContain('genre:puzzle');
    expect(keys).toContain('keyword:roguelite');
    expect(keys).not.toContain('keyword:rare');
  });

  it('drops stop-listed keywords whatever their case', () => {
    const train = [1, 2, 3].map((id) => game(id, { keywords: ['Steam Achievements', 'digital distribution'] }));
    const blocks = buildFeatures(train).columns.map((c) => c.block);
    expect(blocks).not.toContain('keyword');
  });

  it('always ends with the consensus and has_steam_tags columns', () => {
    const cols = buildFeatures([game(1)]).columns;
    expect(cols.map((c) => c.block)).toEqual(['consensus', 'has_steam_tags']);
  });
});

describe('vectorize', () => {
  it('scales each block to unit length, so many keywords do not outweigh few', () => {
    const train = [1, 2, 3].map((id) => game(id, { genres: ['A', 'B', 'C', 'D'], themes: ['X'] }));
    const space = buildFeatures(train);
    const x = vectorize(space, train[0]);
    const genreCols = space.columns.map((c, i) => (c.block === 'genre' ? x[i] : 0));
    const themeCols = space.columns.map((c, i) => (c.block === 'theme' ? x[i] : 0));
    expect(Math.hypot(...genreCols)).toBeCloseTo(1, 10);
    expect(Math.hypot(...themeCols)).toBeCloseTo(1, 10);
    expect(genreCols.filter((v) => v > 0)[0]).toBeCloseTo(0.5, 10); // 4 genres → 1/√4 each
  });

  it('weights Steam tags by tag weight ÷ the game\'s top weight before normalizing', () => {
    const train = [1, 2, 3].map((id) => game(id, { steamTags: tags(10, 20) }));
    const space = buildFeatures(train);
    const x = vectorize(space, train[0]);
    const t10 = x[space.index.get('steam_tag:10')!];
    const t20 = x[space.index.get('steam_tag:20')!];
    expect(t10 / t20).toBeCloseTo(2, 10); // weights 200 and 100
    expect(x[space.index.get('has_steam_tags:has_steam_tags')!]).toBe(1);
  });

  it('maskSteam zeroes the tag block and has_steam_tags (console-game simulation)', () => {
    const train = [1, 2, 3].map((id) => game(id, { steamTags: tags(10, 20) }));
    const space = buildFeatures(train);
    const x = vectorize(space, train[0], { maskSteam: true });
    expect(x[space.index.get('steam_tag:10')!]).toBe(0);
    expect(x[space.index.get('has_steam_tags:has_steam_tags')!]).toBe(0);
  });

  it('standardizes total rating; a missing rating becomes 0', () => {
    const train = [game(1, { totalRating: 60 }), game(2, { totalRating: 80 }), game(3, { totalRating: null })];
    const space = buildFeatures(train);
    const c = space.index.get('consensus:total_rating')!;
    expect(vectorize(space, train[1])[c]).toBeGreaterThan(0);
    expect(vectorize(space, train[0])[c]).toBeLessThan(0);
    expect(vectorize(space, train[2])[c]).toBe(0);
  });
});

describe('vocabCoverage and labels', () => {
  it('measures the share of a game\'s features that the vocabulary knows', () => {
    const space = buildFeatures([game(1, { genres: ['RPG'] })]);
    expect(vocabCoverage(space, game(9, { genres: ['RPG', 'Puzzle'] }))).toBe(0.5);
    expect(vocabCoverage(space, game(9))).toBe(0);
  });

  it('builds readable labels', () => {
    const space = buildFeatures([1, 2, 3].map((id) => game(id, { steamTags: [{ tagId: 3959, name: 'Roguelite', weight: 9 }] })));
    const col = space.columns[space.index.get('steam_tag:3959')!];
    expect(columnLabel(col)).toBe('Steam tag: Roguelite');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/core/recommender/features.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/core/recommender"`.

- [ ] **Step 5: Implement**

`src/core/recommender/features.ts`:

```ts
// Feature space (spec §7.1). Turns GameMeta into a numeric vector the model can read.
// Each sparse block (genres, keywords, Steam tags, ...) is scaled to unit length per game, so a game
// with 84 keywords doesn't outweigh one with 4. The vocabulary is built from the RANKED games only.

import type { GameMeta } from '../types';

export type BlockName = 'genre' | 'theme' | 'mode' | 'perspective' | 'keyword' | 'steam_tag' | 'collection' | 'developer';
export const BLOCKS: readonly BlockName[] = ['genre', 'theme', 'mode', 'perspective', 'keyword', 'steam_tag', 'collection', 'developer'];

/** Keywords that describe distribution or platform, not the game (spec §7.1, D13). Compared lower-case. */
export const STOP_KEYWORDS: ReadonlySet<string> = new Set([
  'steam', 'digital distribution', 'steam achievements', 'achievements', 'steam cloud',
  'steam trading cards', 'steam workshop', 'overlay', 'pc', 'windows', 'dlc',
  'downloadable content', 'xbox one x enhanced', 'playstation trophies', 'online',
]);

export interface FeatureConfig {
  /** A feature becomes a column only if at least this many ranked games have it. */
  minDf: Record<BlockName, number>;
}

export const DEFAULT_FEATURE_CONFIG: FeatureConfig = {
  minDf: { genre: 1, theme: 1, mode: 1, perspective: 1, keyword: 3, steam_tag: 3, collection: 2, developer: 2 },
};

export interface Column {
  block: BlockName | 'consensus' | 'has_steam_tags';
  key: string; // stable id inside the block: lower-case name, or the Steam tag id
  label: string; // readable name for explanations
}

export interface FeatureSpace {
  columns: Column[];
  index: Map<string, number>; // `${block}:${key}` → column number
  ratingMean: number; // for standardizing IGDB total_rating
  ratingSd: number;
}

const BLOCK_LABELS: Record<Column['block'], string> = {
  genre: 'Genre',
  theme: 'Theme',
  mode: 'Mode',
  perspective: 'Perspective',
  keyword: 'Keyword',
  steam_tag: 'Steam tag',
  collection: 'Series',
  developer: 'Developer',
  consensus: 'Critic & player rating',
  has_steam_tags: 'Has Steam tags',
};

/** "Steam tag: Roguelite". Used by the explanation UI. */
export function columnLabel(column: Column): string {
  if (column.block === 'consensus' || column.block === 'has_steam_tags') return BLOCK_LABELS[column.block];
  return `${BLOCK_LABELS[column.block]}: ${column.label}`;
}

interface RawEntry {
  value: number;
  label: string;
}

function binary(names: string[]): Map<string, RawEntry> {
  const out = new Map<string, RawEntry>();
  for (const name of names) out.set(name.toLowerCase(), { value: 1, label: name });
  return out;
}

/** A game's features before vocabulary filtering, block by block. */
export function rawFeatures(g: GameMeta, opts: { maskSteam?: boolean } = {}): Map<BlockName, Map<string, RawEntry>> {
  const steam = new Map<string, RawEntry>();
  if (!opts.maskSteam && g.steamTags && g.steamTags.length > 0) {
    const top = Math.max(...g.steamTags.map((t) => t.weight)) || 1;
    for (const t of g.steamTags) steam.set(String(t.tagId), { value: t.weight / top, label: t.name });
  }
  return new Map<BlockName, Map<string, RawEntry>>([
    ['genre', binary(g.genres)],
    ['theme', binary(g.themes)],
    ['mode', binary(g.modes)],
    ['perspective', binary(g.perspectives)],
    ['keyword', binary(g.keywords.filter((k) => !STOP_KEYWORDS.has(k.toLowerCase())))],
    ['steam_tag', steam],
    ['collection', binary(g.collections)],
    ['developer', binary(g.developers)],
  ]);
}

export function buildFeatures(train: GameMeta[], cfg: FeatureConfig = DEFAULT_FEATURE_CONFIG): FeatureSpace {
  // Document frequency: how many training games have each feature.
  const df = new Map<string, { block: BlockName; key: string; label: string; count: number }>();
  for (const g of train) {
    for (const [block, entries] of rawFeatures(g)) {
      for (const [key, entry] of entries) {
        const id = `${block}:${key}`;
        const seen = df.get(id);
        if (seen) seen.count += 1;
        else df.set(id, { block, key, label: entry.label, count: 1 });
      }
    }
  }
  const sparse = [...df.values()]
    .filter((f) => f.count >= cfg.minDf[f.block])
    .sort((a, b) => BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block) || a.key.localeCompare(b.key));

  const columns: Column[] = sparse.map((f) => ({ block: f.block, key: f.key, label: f.label }));
  columns.push({ block: 'consensus', key: 'total_rating', label: 'IGDB total rating' });
  columns.push({ block: 'has_steam_tags', key: 'has_steam_tags', label: 'Has Steam tags' });

  const index = new Map<string, number>();
  columns.forEach((c, i) => index.set(`${c.block}:${c.key}`, i));

  const ratings = train.map((g) => g.totalRating).filter((r): r is number => r !== null);
  const ratingMean = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;
  const variance = ratings.length > 1 ? ratings.reduce((s, r) => s + (r - ratingMean) ** 2, 0) / (ratings.length - 1) : 0;
  const ratingSd = Math.sqrt(variance) || 1;

  return { columns, index, ratingMean, ratingSd };
}

export function vectorize(space: FeatureSpace, g: GameMeta, opts: { maskSteam?: boolean } = {}): Float64Array {
  const x = new Float64Array(space.columns.length);
  for (const [block, entries] of rawFeatures(g, opts)) {
    const cols: [number, number][] = [];
    for (const [key, entry] of entries) {
      const col = space.index.get(`${block}:${key}`);
      if (col !== undefined) cols.push([col, entry.value]);
    }
    const norm = Math.sqrt(cols.reduce((s, [, v]) => s + v * v, 0));
    if (norm > 0) for (const [col, v] of cols) x[col] = v / norm;
  }
  const consensus = space.index.get('consensus:total_rating')!;
  x[consensus] = g.totalRating === null ? 0 : (g.totalRating - space.ratingMean) / space.ratingSd;
  const hasTags = space.index.get('has_steam_tags:has_steam_tags')!;
  x[hasTags] = !opts.maskSteam && g.steamTags !== null && g.steamTags.length > 0 ? 1 : 0;
  return x;
}

/** Share of a game's raw features that the vocabulary knows (0 when the game has none). */
export function vocabCoverage(space: FeatureSpace, g: GameMeta): number {
  let total = 0;
  let known = 0;
  for (const [block, entries] of rawFeatures(g)) {
    for (const key of entries.keys()) {
      total += 1;
      if (space.index.has(`${block}:${key}`)) known += 1;
    }
  }
  return total === 0 ? 0 : known / total;
}
```

`src/core/recommender/index.ts` (Tasks 2–5 each add lines):

```ts
// Public surface of the recommender. Other modules import from here, not from the files inside.
export * from './features';
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/core/recommender/features.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add src/core/recommender/features.ts src/core/recommender/index.ts tests/core/helpers/game.ts tests/core/recommender/features.test.ts
git commit -m "feat(recommender): block-normalized feature space with stop-list and min-df

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ridge regression (with linear algebra and metrics)

**Files:**
- Create: `src/core/recommender/linalg.ts`, `src/core/recommender/metrics.ts`, `src/core/recommender/ridge.ts`
- Modify: `src/core/recommender/index.ts`
- Test: `tests/core/recommender/ridge.test.ts`

**Interfaces:**
- Consumes: `seededRandom`, `shuffled` (Plan 1, `src/core/random.ts`).
- Produces:
  - `linalg.ts` (internal, not re-exported): `dot(a, b): number`, `choleskySolve(A: Float64Array[], b: ArrayLike<number>): Float64Array`
  - `metrics.ts`: `heldOutPairwise(held: { pred: number; trueRank: number }[], train: { score: number; trueRank: number }[]): { agree: number; total: number }`, `kendallTau(a: number[], b: number[]): number`, `interface Interval { mean; lo; hi }`, `bootstrapMean(values: number[], rand: () => number, resamples?: number): Interval`
  - `ridge.ts`: `interface RidgeModel { w: Float64Array; intercept: number; xMean: Float64Array; yMean: number; lambda: number }`, `fitRidge(X: Float64Array[], y: number[], lambda: number): RidgeModel`, `rawPredict(m, x): number`, `LAMBDA_GRID`, `chooseLambda(X, y, grid?, folds?, seed?): number`
- Note: `trueRank` is 0 for the best game. `chooseLambda` returns 1 below 10 games, and ties go to the larger λ.

- [ ] **Step 1: Write the failing test**

`tests/core/recommender/ridge.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/recommender/ridge.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/core/recommender/linalg"`.

- [ ] **Step 3: Implement**

`src/core/recommender/linalg.ts`:

```ts
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
```

`src/core/recommender/metrics.ts`:

```ts
// Evaluation metrics (spec §7.4).

/**
 * Held-out pairwise accuracy. For every pair (held-out game h, training game t): does "pred(h) is
 * above score(t)" agree with "h is truly above t"? Pairs where the prediction equals the training
 * score, or where the true ranks are equal, are skipped.
 * trueRank: 0 = best.
 */
export function heldOutPairwise(
  held: { pred: number; trueRank: number }[],
  train: { score: number; trueRank: number }[],
): { agree: number; total: number } {
  let agree = 0;
  let total = 0;
  for (const h of held) {
    for (const t of train) {
      if (h.pred === t.score || h.trueRank === t.trueRank) continue;
      total += 1;
      if (h.pred > t.score === h.trueRank < t.trueRank) agree += 1;
    }
  }
  return { agree, total };
}

/** Kendall τ-a between two equal-length lists. Tied pairs count as neither. NaN below 2 items. */
export function kendallTau(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  let score = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      score += Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
    }
  }
  return score / ((n * (n - 1)) / 2);
}

export interface Interval {
  mean: number;
  lo: number; // 2.5th percentile of the bootstrap means
  hi: number; // 97.5th percentile
}

/** Mean and 95% bootstrap interval. NaN values are dropped first. */
export function bootstrapMean(values: number[], rand: () => number, resamples = 1000): Interval {
  const v = values.filter((x) => !Number.isNaN(x));
  if (v.length === 0) return { mean: NaN, lo: NaN, hi: NaN };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(rand() * v.length)];
    means.push(s / v.length);
  }
  means.sort((x, y) => x - y);
  return { mean, lo: means[Math.floor(0.025 * resamples)], hi: means[Math.floor(0.975 * resamples) - 1] };
}
```

`src/core/recommender/ridge.ts`:

```ts
// Ridge regression on the score (spec §7.2), solved in its dual form because there are far more
// features (hundreds) than ranked games (tens): α = (Xc·Xcᵀ + λI)⁻¹ (y − ȳ), w = Xcᵀ·α.

import { seededRandom, shuffled } from '../random';
import { choleskySolve, dot } from './linalg';
import { heldOutPairwise } from './metrics';

export interface RidgeModel {
  w: Float64Array; // one weight per feature column, in score points per unit of feature
  intercept: number;
  xMean: Float64Array; // training mean of each feature (contributions are measured from here)
  yMean: number; // training mean score: the "baseline" of every explanation
  lambda: number;
}

export function fitRidge(X: Float64Array[], y: number[], lambda: number): RidgeModel {
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const xMean = new Float64Array(d);
  for (const row of X) for (let j = 0; j < d; j++) xMean[j] += row[j] / n;
  const yMean = y.reduce((s, v) => s + v, 0) / n;

  const Xc = X.map((row) => row.map((v, j) => v - xMean[j]));
  const K = Xc.map((a, i) => {
    const r = new Float64Array(n);
    for (let k = 0; k < n; k++) r[k] = dot(a, Xc[k]) + (i === k ? lambda : 0);
    return r;
  });
  const alpha = choleskySolve(K, y.map((v) => v - yMean));

  const w = new Float64Array(d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) w[j] += Xc[i][j] * alpha[i];
  const intercept = yMean - dot(xMean, w);
  return { w, intercept, xMean, yMean, lambda };
}

/** Unclamped prediction: intercept + w·x. */
export function rawPredict(m: RidgeModel, x: Float64Array): number {
  return m.intercept + dot(m.w, x);
}

export const LAMBDA_GRID: readonly number[] = [0.1, 0.3, 1, 3, 10];

/**
 * Pick λ by k-fold cross-validation on held-out pairwise accuracy (spec §7.2).
 * Below 10 games CV is meaningless, so it returns 1. Ties go to the larger λ (simpler model).
 */
export function chooseLambda(
  X: Float64Array[],
  y: number[],
  grid: readonly number[] = LAMBDA_GRID,
  folds = 5,
  seed = 1,
): number {
  const n = X.length;
  if (n < 10) return 1;
  const order = shuffled(Array.from({ length: n }, (_, i) => i), seededRandom(seed));
  const foldOf = new Array<number>(n);
  order.forEach((row, position) => (foldOf[row] = position % folds));

  let best = grid[0];
  let bestAcc = -1;
  for (const lambda of grid) {
    let agree = 0;
    let total = 0;
    for (let f = 0; f < folds; f++) {
      const trainRows = [...Array(n).keys()].filter((i) => foldOf[i] !== f);
      const testRows = [...Array(n).keys()].filter((i) => foldOf[i] === f);
      const m = fitRidge(trainRows.map((i) => X[i]), trainRows.map((i) => y[i]), lambda);
      const r = heldOutPairwise(
        testRows.map((i) => ({ pred: rawPredict(m, X[i]), trueRank: -y[i] })),
        trainRows.map((i) => ({ score: y[i], trueRank: -y[i] })),
      );
      agree += r.agree;
      total += r.total;
    }
    const acc = total === 0 ? 0 : agree / total;
    if (acc >= bestAcc) {
      best = lambda;
      bestAcc = acc;
    }
  }
  return best;
}
```

`src/core/recommender/index.ts`:

```ts
// Public surface of the recommender. Other modules import from here, not from the files inside.
export * from './features';
export * from './metrics';
export * from './ridge';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/recommender/ridge.test.ts`
Expected: PASS (6 tests). The hand-solved case gives w = [0.125, 0.625] and intercept 1.5.

- [ ] **Step 5: Commit**

```bash
git add src/core/recommender/linalg.ts src/core/recommender/metrics.ts src/core/recommender/ridge.ts src/core/recommender/index.ts tests/core/recommender/ridge.test.ts
git commit -m "feat(recommender): dual ridge regression with Cholesky solve and CV lambda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prediction, neighbours, confidence

**Files:**
- Create: `src/core/recommender/predict.ts`
- Modify: `src/core/recommender/index.ts`
- Test: `tests/core/recommender/predict.test.ts`

**Interfaces:**
- Consumes: `dot` (Task 2, linalg), `rawPredict`, `RidgeModel` (Task 2); `GameId` (Plan 1).
- Produces: `interface Contribution { column: number; value: number }`, `interface RidgePrediction { score; raw; baseline; contributions }`, `clampScore(s): number`, `predict(m: RidgeModel, x: Float64Array): RidgePrediction`, `cosine(a, b): number`, `interface Neighbour { id: GameId; similarity: number }`, `neighbours(x, ranked: { id: GameId; x: Float64Array }[], k: number): Neighbour[]`, `knnScore(neigh: Neighbour[], scoreOf: (id: GameId) => number, fallback: number): number`, `type Confidence = 'low' | 'medium' | 'high'`, `interface ConfidenceInput { rankedCount; maxSimilarity; vocabCoverage; hasSteamTags }`, `confidence(i: ConfidenceInput): Confidence`.

- [ ] **Step 1: Write the failing test**

`tests/core/recommender/predict.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/recommender/predict.test.ts`
Expected: FAIL. `predict` and the other imports are undefined (`TypeError: ... is not a function`).

- [ ] **Step 3: Implement**

`src/core/recommender/predict.ts`:

```ts
// Prediction, similarity and confidence (spec §7.3).

import type { GameId } from '../types';
import { dot } from './linalg';
import { rawPredict, type RidgeModel } from './ridge';

export interface Contribution {
  column: number;
  value: number; // score points this feature adds (+) or removes (−) relative to the baseline
}

export interface RidgePrediction {
  score: number; // clamped to 0..10
  raw: number; // before clamping
  baseline: number; // the training mean score
  contributions: Contribution[]; // largest |value| first; they sum to raw − baseline
}

export function clampScore(s: number): number {
  return Math.min(10, Math.max(0, s));
}

export function predict(m: RidgeModel, x: Float64Array): RidgePrediction {
  const raw = rawPredict(m, x);
  const contributions: Contribution[] = [];
  for (let j = 0; j < x.length; j++) {
    const value = m.w[j] * (x[j] - m.xMean[j]);
    if (value !== 0) contributions.push({ column: j, value });
  }
  contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { score: clampScore(raw), raw, baseline: m.yMean, contributions };
}

export function cosine(a: Float64Array, b: Float64Array): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

export interface Neighbour {
  id: GameId;
  similarity: number;
}

/** The k ranked games most similar to x (cosine), most similar first; ties broken by id. */
export function neighbours(x: Float64Array, ranked: { id: GameId; x: Float64Array }[], k: number): Neighbour[] {
  return ranked
    .map((r) => ({ id: r.id, similarity: cosine(x, r.x) }))
    .sort((a, b) => b.similarity - a.similarity || a.id - b.id)
    .slice(0, k);
}

/** kNN scorer: similarity-weighted mean score of the neighbours (negative similarities count 0). */
export function knnScore(neigh: Neighbour[], scoreOf: (id: GameId) => number, fallback: number): number {
  let weight = 0;
  let sum = 0;
  for (const n of neigh) {
    const w = Math.max(n.similarity, 0);
    weight += w;
    sum += w * scoreOf(n.id);
  }
  return weight === 0 ? fallback : sum / weight;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface ConfidenceInput {
  rankedCount: number;
  maxSimilarity: number;
  vocabCoverage: number; // share of the candidate's raw features in the vocabulary, 0..1
  hasSteamTags: boolean;
}

/** Spec §7.3 rule. Initial thresholds; tune once real data exists. */
export function confidence(i: ConfidenceInput): Confidence {
  if (i.rankedCount < 20 || i.maxSimilarity < 0.3 || i.vocabCoverage < 0.5) return 'low';
  if (i.rankedCount >= 40 && i.hasSteamTags && i.maxSimilarity >= 0.5) return 'high';
  return 'medium';
}
```

`src/core/recommender/index.ts`:

```ts
// Public surface of the recommender. Other modules import from here, not from the files inside.
export * from './features';
export * from './metrics';
export * from './ridge';
export * from './predict';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/core/recommender/predict.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/recommender/predict.ts src/core/recommender/index.ts tests/core/recommender/predict.test.ts
git commit -m "feat(recommender): clamped prediction with contributions, neighbours, confidence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `recommend()` and the synthetic library

**Files:**
- Create: `src/core/recommender/config.ts`, `src/core/recommender/recommend.ts`, `tests/fixtures/synthetic.ts`
- Modify: `src/core/recommender/index.ts`
- Test: `tests/core/recommender/recommend.test.ts`

**Interfaces:**
- Consumes: `bandOf`, `globalOrder`, `positionOf`, `replay`, `sessionStep`, `RankState` (Plan 1, `src/core/ranking`); everything from Tasks 1–3.
- Produces:
  - `type Scorer = 'ridge' | 'knn'`, `SCORER: Scorer` (= `'ridge'`)
  - `MIN_RANKED_TO_PREDICT = 5`
  - `interface Reason { label: string; value: number }`
  - `interface SimilarGame { id; similarity; score; bucket: Bucket; position: number }` (position is 1-based in the global list)
  - `interface Prediction { gameId; score: number | null; bucket: Bucket | null; above: { id; score } | null; below: { id; score } | null; confidence: Confidence; reasons: Reason[]; similar: SimilarGame[] }`
  - `recommend(state: RankState, scoreMap: Map<GameId, number>, games: GameMeta[], candidates: GameId[], opts?: { scorer?: Scorer }): Prediction[]`. Candidates without metadata are skipped.
  - Test fixture `tests/fixtures/synthetic.ts`: `syntheticGames(opts)`, `syntheticUtility(games, opts)`, `syntheticEvents(utility, seed)`, `syntheticDataset(opts): { events: RankEvent[]; games: GameMeta[] }`, with `opts: { games: number; seed: number; noise: number; steamShare?: number }`.

- [ ] **Step 1: Write the synthetic library**

`tests/fixtures/synthetic.ts`:

```ts
// Synthetic library for testing the recommender and the evaluation harness (spec §11).
// Games get random genres/themes/keywords/Steam tags; a hidden linear "taste" plus noise decides
// the true order; a perfect-oracle ranking session turns that order into a real event log.
// No personal data: everything here is generated.

import { replay, sessionStep } from '../../src/core/ranking';
import { seededRandom, shuffled } from '../../src/core/random';
import type { Bucket, EventBody, GameMeta, RankEvent } from '../../src/core/types';

export interface SyntheticOptions {
  games: number;
  seed: number;
  noise: number; // standard deviation of the part of taste that features can't explain
  steamShare?: number; // share of games with Steam tags (default 0.8)
}

function pick<T>(pool: readonly T[], count: number, rand: () => number): T[] {
  return shuffled(pool, rand).slice(0, count);
}

function normal(rand: () => number): number {
  // Box-Muller transform
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GENRES = ['Adventure', 'Indie', 'Platform', 'Puzzle', 'RPG', 'Shooter', 'Strategy', 'Simulator'];
const THEMES = ['Action', 'Fantasy', 'Science fiction', 'Horror', 'Comedy', 'Drama', 'Survival', 'Open world'];
const MODES = ['Single player', 'Multiplayer', 'Co-operative'];
const PERSPECTIVES = ['First person', 'Third person', 'Side view', 'Bird view / Isometric'];
const KEYWORDS = Array.from({ length: 40 }, (_, i) => `keyword ${i + 1}`);
const TAGS = Array.from({ length: 30 }, (_, i) => ({ tagId: 1000 + i, name: `Tag ${i + 1}` }));
const DEVELOPERS = Array.from({ length: 15 }, (_, i) => `Studio ${i + 1}`);
const COLLECTIONS = Array.from({ length: 10 }, (_, i) => `Series ${i + 1}`);

export function syntheticGames(opts: SyntheticOptions): GameMeta[] {
  const rand = seededRandom(opts.seed);
  const steamShare = opts.steamShare ?? 0.8;
  return Array.from({ length: opts.games }, (_, i) => {
    const hasSteam = rand() < steamShare;
    return {
      id: i + 1,
      name: `Game ${i + 1}`,
      year: 2000 + Math.floor(rand() * 25),
      gameType: 0,
      coverImageId: null,
      genres: pick(GENRES, 1 + Math.floor(rand() * 3), rand),
      themes: pick(THEMES, 1 + Math.floor(rand() * 3), rand),
      keywords: pick(KEYWORDS, 3 + Math.floor(rand() * 8), rand),
      modes: pick(MODES, 1, rand),
      perspectives: pick(PERSPECTIVES, 1, rand),
      collections: rand() < 0.3 ? pick(COLLECTIONS, 1, rand) : [],
      franchises: [],
      developers: pick(DEVELOPERS, 1, rand),
      platforms: ['PC'],
      totalRating: 50 + rand() * 45,
      ratingCount: Math.floor(rand() * 1000),
      steamTags: hasSteam
        ? pick(TAGS, 8 + Math.floor(rand() * 8), rand).map((t) => ({ ...t, weight: 100 + Math.floor(rand() * 900) }))
        : null,
      ttb: null,
      versionParent: null,
      parentGame: null,
    };
  });
}

/** Hidden taste: each genre/theme/keyword/tag has a random weight; utility = mean weight per block + noise. */
export function syntheticUtility(games: GameMeta[], opts: SyntheticOptions): Map<number, number> {
  const rand = seededRandom(opts.seed + 1);
  const weight = new Map<string, number>();
  const w = (key: string) => {
    if (!weight.has(key)) weight.set(key, normal(rand));
    return weight.get(key)!;
  };
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length);
  const utility = new Map<number, number>();
  for (const g of games) {
    const u =
      mean(g.genres.map((x) => w(`g:${x}`))) +
      mean(g.themes.map((x) => w(`t:${x}`))) +
      mean(g.keywords.map((x) => w(`k:${x}`))) +
      mean((g.steamTags ?? []).map((t) => w(`s:${t.tagId}`))) +
      opts.noise * normal(rand);
    utility.set(g.id, u);
  }
  return utility;
}

/** Rank every game with a perfect oracle; buckets: top 30% loved, bottom 25% disliked. */
export function syntheticEvents(utility: Map<number, number>, seed: number): RankEvent[] {
  const byUtility = [...utility.keys()].sort((a, b) => utility.get(b)! - utility.get(a)!);
  const bucketOf = new Map<number, Bucket>();
  byUtility.forEach((id, i) => {
    const share = i / byUtility.length;
    bucketOf.set(id, share < 0.3 ? 'loved' : share >= 0.75 ? 'disliked' : 'liked');
  });

  const events: RankEvent[] = [];
  const add = (body: EventBody) => {
    events.push({ ...body, id: `e${events.length + 1}`, ts: '2026-10-06T00:00:00.000Z', listId: 'global', seq: events.length + 1 } as RankEvent);
  };
  for (const game of shuffled([...utility.keys()], seededRandom(seed + 2))) {
    const bucket = bucketOf.get(game)!;
    const session = `s${game}`;
    add({ type: 'session_started', gameId: game, data: { session, bucket } });
    for (;;) {
      const next = sessionStep(replay(events), session)!;
      if (next.kind === 'place') {
        add({ type: 'placed', gameId: game, data: { session, bucket, below: next.below } });
        break;
      }
      if (next.kind === 'stale') throw new Error('stale in synthetic data');
      const result = utility.get(game)! > utility.get(next.pivot)! ? 'better' : 'worse';
      add({ type: 'answer', gameId: game, data: { session, pivot: next.pivot, result } });
    }
  }
  return events;
}

export function syntheticDataset(opts: SyntheticOptions): { events: RankEvent[]; games: GameMeta[] } {
  const games = syntheticGames(opts);
  const utility = syntheticUtility(games, opts);
  return { events: syntheticEvents(utility, opts.seed), games };
}
```

- [ ] **Step 2: Write the failing test**

`tests/core/recommender/recommend.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/recommender/recommend.test.ts`
Expected: FAIL. `recommend` is not a function.

- [ ] **Step 4: Implement**

`src/core/recommender/config.ts`:

```ts
// Which scorer the app uses (spec §7.4 ship rule).
// Run `npm run eval -- <export.json>`. If ridge does NOT beat kNN-5 on pairwise accuracy, change this
// to 'knn' and commit. The UI then hides the feature contributions; everything else stays the same.

export type Scorer = 'ridge' | 'knn';

export const SCORER: Scorer = 'ridge';
```

`src/core/recommender/recommend.ts`:

```ts
// The one call the UI makes (spec §4): fit on the ranked games, then predict each candidate with a
// score, implied bucket, neighbourhood, confidence and explanation.

import { bandOf, globalOrder, positionOf, type RankState } from '../ranking';
import type { Bucket, GameId, GameMeta } from '../types';
import { SCORER, type Scorer } from './config';
import { buildFeatures, columnLabel, vectorize, vocabCoverage } from './features';
import { clampScore, confidence, knnScore, neighbours, predict, type Confidence } from './predict';
import { chooseLambda, fitRidge } from './ridge';

/** Below this many ranked games there is nothing to fit: predictions come back with score null. */
export const MIN_RANKED_TO_PREDICT = 5;

export interface Reason {
  label: string; // "Steam tag: Roguelite"
  value: number; // +0.6 = this feature adds 0.6 points
}

export interface SimilarGame {
  id: GameId;
  similarity: number;
  score: number;
  bucket: Bucket;
  position: number; // 1-based place in the global ranked list
}

export interface Prediction {
  gameId: GameId;
  score: number | null; // null = not enough ranked games yet
  bucket: Bucket | null;
  above: { id: GameId; score: number } | null; // ranked game just above the prediction
  below: { id: GameId; score: number } | null; // ranked game just below it
  confidence: Confidence;
  reasons: Reason[]; // top 3 positive + top 1 negative; empty in kNN mode
  similar: SimilarGame[]; // 3 most similar ranked games, disliked ones included
}

export function recommend(
  state: RankState,
  scoreMap: Map<GameId, number>,
  games: GameMeta[],
  candidates: GameId[],
  opts: { scorer?: Scorer } = {},
): Prediction[] {
  const metaById = new Map(games.map((g) => [g.id, g]));
  const order = globalOrder(state).filter((id) => metaById.has(id) && scoreMap.has(id));

  if (order.length < MIN_RANKED_TO_PREDICT) {
    return candidates.map((gameId) => ({
      gameId, score: null, bucket: null, above: null, below: null, confidence: 'low', reasons: [], similar: [],
    }));
  }

  const trainMetas = order.map((id) => metaById.get(id)!);
  const space = buildFeatures(trainMetas);
  const X = trainMetas.map((g) => vectorize(space, g));
  const y = order.map((id) => scoreMap.get(id)!);
  const ranked = order.map((id, i) => ({ id, x: X[i] }));
  const meanScore = y.reduce((s, v) => s + v, 0) / y.length;

  const scorer = opts.scorer ?? SCORER;
  const model = scorer === 'ridge' ? fitRidge(X, y, chooseLambda(X, y)) : null;

  const out: Prediction[] = [];
  for (const gameId of candidates) {
    const meta = metaById.get(gameId);
    if (!meta) continue; // no metadata yet: the caller fetches it first
    const x = vectorize(space, meta);
    const neigh = neighbours(x, ranked, 5);

    let score: number;
    let reasons: Reason[] = [];
    if (model) {
      const p = predict(model, x);
      score = p.score;
      const positive = p.contributions.filter((c) => c.value > 0).slice(0, 3);
      const negative = p.contributions.filter((c) => c.value < 0).slice(0, 1);
      reasons = [...positive, ...negative].map((c) => ({ label: columnLabel(space.columns[c.column]), value: c.value }));
    } else {
      score = clampScore(knnScore(neigh, (id) => scoreMap.get(id)!, meanScore));
    }

    // The ranked games whose actual scores bracket the prediction. `order` is best first.
    let above: Prediction['above'] = null;
    let below: Prediction['below'] = null;
    for (const id of order) {
      const s = scoreMap.get(id)!;
      if (s >= score) above = { id, score: s };
      else if (!below) below = { id, score: s };
    }

    const similar = neigh.slice(0, 3).map((n) => ({
      id: n.id,
      similarity: n.similarity,
      score: scoreMap.get(n.id)!,
      bucket: positionOf(state, n.id)!.bucket,
      position: order.indexOf(n.id) + 1,
    }));

    out.push({
      gameId,
      score,
      bucket: bandOf(score),
      above,
      below,
      confidence: confidence({
        rankedCount: order.length,
        maxSimilarity: neigh[0]?.similarity ?? 0,
        vocabCoverage: vocabCoverage(space, meta),
        hasSteamTags: meta.steamTags !== null && meta.steamTags.length > 0,
      }),
      reasons,
      similar,
    });
  }
  return out;
}
```

`src/core/recommender/index.ts`:

```ts
// Public surface of the recommender. Other modules import from here, not from the files inside.
export * from './features';
export * from './metrics';
export * from './ridge';
export * from './predict';
export * from './config';
export * from './recommend';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/core/recommender/recommend.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/recommender/config.ts src/core/recommender/recommend.ts src/core/recommender/index.ts tests/fixtures/synthetic.ts tests/core/recommender/recommend.test.ts
git commit -m "feat(recommender): recommend() with bracket, similar games, reasons and kNN mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Offline evaluation and `npm run eval`

**Files:**
- Create: `src/core/recommender/evaluate.ts`, `scripts/eval.ts`
- Modify: `src/core/recommender/index.ts`, `package.json` (script + tsx)
- Test: `tests/core/recommender/evaluate.test.ts`

**Interfaces:**
- Consumes: `replay`, `globalOrder`, `scores`, `RankState` (Plan 1); Tasks 1–3; `ExportFile` (Plan 1 types).
- Produces: `MIN_RANKED_TO_EVALUATE = 20`, `interface EvalDataset { events: RankEvent[]; games: GameMeta[] }`, `type ModelName = 'ridge' | 'ridge_steam_masked' | 'genre_avg' | 'knn5' | 'rating_only' | 'mean_only'`, `MODEL_NAMES`, `interface MetricSummary { acc: Interval; tau: Interval }`, `type EvalReport = { ok: false; ranked; reason } | { ok: true; ranked; folds; models: Record<ModelName, MetricSummary>; ridgeBeatsKnn: boolean }`, `evaluate(dataset: EvalDataset, opts: { repeats: number; folds: number; seed: number }): EvalReport`. Script: `npm run eval -- <export.json>`; `formatReport(report: EvalReport): string` is exported from `scripts/eval.ts`.

- [ ] **Step 1: Install tsx**

Run: `npm install --save-exact -D tsx@4.23.15`
Expected: `tsx` appears in `devDependencies`.

Then add the script to `package.json` so the `scripts` block reads:

```json
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "eval": "tsx scripts/eval.ts"
  }
```

- [ ] **Step 2: Write the failing test**

`tests/core/recommender/evaluate.test.ts`:

```ts
// The design spike as a regression test (spec §11): on a synthetic library where taste is linear in
// the features, the ridge model must beat the genre-average baseline.

import { describe, expect, it } from 'vitest';
import { evaluate, kendallTau, MODEL_NAMES } from '../../../src/core/recommender';
import { syntheticDataset } from '../../fixtures/synthetic';

describe('kendallTau', () => {
  it('is 1 for identical order, −1 for reversed, NaN below 2 items', () => {
    expect(kendallTau([1, 2, 3], [10, 20, 30])).toBe(1);
    expect(kendallTau([1, 2, 3], [30, 20, 10])).toBe(-1);
    expect(kendallTau([1], [1])).toBeNaN();
  });
});

describe('evaluate', () => {
  it('reports "not enough data" below 20 ranked games', () => {
    const data = syntheticDataset({ games: 15, seed: 1, noise: 0.3 });
    const report = evaluate(data, { repeats: 1, folds: 5, seed: 1 });
    expect(report.ok).toBe(false);
  });

  it('ridge beats the genre-average baseline on a synthetic library', { timeout: 30_000 }, () => {
    const data = syntheticDataset({ games: 70, seed: 5, noise: 0.3 });
    const report = evaluate(data, { repeats: 2, folds: 5, seed: 1 });
    if (!report.ok) throw new Error(report.reason);
    expect(report.folds).toBe(10);
    expect(report.models.ridge.acc.mean).toBeGreaterThan(report.models.genre_avg.acc.mean);
    expect(report.models.ridge.acc.mean).toBeGreaterThan(report.models.mean_only.acc.mean + 0.03);
    for (const name of MODEL_NAMES) {
      const acc = report.models[name].acc;
      expect(acc.lo).toBeLessThanOrEqual(acc.mean);
      expect(acc.hi).toBeGreaterThanOrEqual(acc.mean);
    }
  });

  it('runs the Steam-masked subgroup and is deterministic for a given seed', { timeout: 30_000 }, () => {
    const data = syntheticDataset({ games: 40, seed: 9, noise: 0.5 });
    const a = evaluate(data, { repeats: 1, folds: 5, seed: 3 });
    const b = evaluate(data, { repeats: 1, folds: 5, seed: 3 });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(Number.isNaN(a.models.ridge_steam_masked.acc.mean)).toBe(false);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/recommender/evaluate.test.ts`
Expected: FAIL. `kendallTau` passes, but `evaluate` and `MODEL_NAMES` are undefined.

- [ ] **Step 4: Implement**

`src/core/recommender/evaluate.ts`:

```ts
// Offline evaluation (spec §7.4). Repeated k-fold over ranked games; for every held-out fold the
// order is rebuilt WITHOUT those games, so they never leak into the training scores.

import { globalOrder, replay, scores, type RankState } from '../ranking';
import { seededRandom, shuffled } from '../random';
import type { GameId, GameMeta, RankEvent } from '../types';
import { buildFeatures, vectorize } from './features';
import { bootstrapMean, heldOutPairwise, kendallTau, type Interval } from './metrics';
import { clampScore, knnScore, neighbours, predict } from './predict';
import { chooseLambda, fitRidge, LAMBDA_GRID } from './ridge';

export const MIN_RANKED_TO_EVALUATE = 20;

export interface EvalDataset {
  events: RankEvent[];
  games: GameMeta[];
}

export type ModelName = 'ridge' | 'ridge_steam_masked' | 'genre_avg' | 'knn5' | 'rating_only' | 'mean_only';
export const MODEL_NAMES: readonly ModelName[] = ['ridge', 'ridge_steam_masked', 'genre_avg', 'knn5', 'rating_only', 'mean_only'];

export interface MetricSummary {
  // Held-out pairwise accuracy. NOT 0.5 at chance: predicting the training mean for every game already
  // scores ~0.75, because most training games sit far from the middle. Read it against `mean_only`.
  acc: Interval;
  tau: Interval; // Kendall τ within the held-out fold
}

export type EvalReport =
  | { ok: false; ranked: number; reason: string }
  | { ok: true; ranked: number; folds: number; models: Record<ModelName, MetricSummary>; ridgeBeatsKnn: boolean };

/** Score of each held-out game from the training scores of games sharing ≥ 1 genre; else the mean. */
function genreAverage(h: GameMeta, train: GameMeta[], trainScore: Map<GameId, number>, mean: number): number {
  const genres = new Set(h.genres.map((g) => g.toLowerCase()));
  const shared = train.filter((t) => t.genres.some((g) => genres.has(g.toLowerCase())));
  if (shared.length === 0) return mean;
  return shared.reduce((s, t) => s + trainScore.get(t.id)!, 0) / shared.length;
}

/** Least-squares line score ≈ a + b · total_rating, fitted on the training games that have a rating. */
function ratingOnly(h: GameMeta, train: GameMeta[], trainScore: Map<GameId, number>, mean: number): number {
  const pts = train.filter((t) => t.totalRating !== null).map((t) => [t.totalRating!, trainScore.get(t.id)!]);
  if (pts.length < 2 || h.totalRating === null) return mean;
  const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
  const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
  const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return mean;
  const b = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / sxx;
  return my + b * (h.totalRating - mx);
}

export function evaluate(dataset: EvalDataset, opts: { repeats: number; folds: number; seed: number }): EvalReport {
  const metaById = new Map(dataset.games.map((g) => [g.id, g]));
  const state = replay(dataset.events);
  const order = globalOrder(state).filter((id) => metaById.has(id));
  if (order.length < MIN_RANKED_TO_EVALUATE) {
    return { ok: false, ranked: order.length, reason: `not enough data: ${order.length} ranked games, need ${MIN_RANKED_TO_EVALUATE}` };
  }
  const trueRank = new Map(order.map((id, i) => [id, i]));
  const perFold: Record<ModelName, { acc: number[]; tau: number[] }> = {
    ridge: { acc: [], tau: [] },
    ridge_steam_masked: { acc: [], tau: [] },
    genre_avg: { acc: [], tau: [] },
    knn5: { acc: [], tau: [] },
    rating_only: { acc: [], tau: [] },
    mean_only: { acc: [], tau: [] },
  };

  for (let r = 1; r <= opts.repeats; r++) {
    const ids = shuffled(order, seededRandom(opts.seed * 1000 + r));
    for (let f = 0; f < opts.folds; f++) {
      const held = ids.filter((_, i) => i % opts.folds === f);
      const heldSet = new Set(held);
      const trainState: Pick<RankState, 'lists'> = {
        lists: {
          loved: state.lists.loved.filter((id) => !heldSet.has(id) && metaById.has(id)),
          liked: state.lists.liked.filter((id) => !heldSet.has(id) && metaById.has(id)),
          disliked: state.lists.disliked.filter((id) => !heldSet.has(id) && metaById.has(id)),
        },
      };
      const trainScore = scores(trainState);
      const trainIds = order.filter((id) => !heldSet.has(id));
      const trainMetas = trainIds.map((id) => metaById.get(id)!);
      const space = buildFeatures(trainMetas);
      const X = trainMetas.map((g) => vectorize(space, g));
      const y = trainIds.map((id) => trainScore.get(id)!);
      const mean = y.reduce((s, v) => s + v, 0) / y.length;
      const model = fitRidge(X, y, chooseLambda(X, y, LAMBDA_GRID, 5, opts.seed * 1000 + r * 10 + f));
      const ranked = trainIds.map((id, i) => ({ id, x: X[i] }));

      const preds: Record<ModelName, number[]> = {
        ridge: [], ridge_steam_masked: [], genre_avg: [], knn5: [], rating_only: [], mean_only: [],
      };
      for (const id of held) {
        const h = metaById.get(id)!;
        const x = vectorize(space, h);
        preds.ridge.push(predict(model, x).score);
        preds.ridge_steam_masked.push(predict(model, vectorize(space, h, { maskSteam: true })).score);
        preds.genre_avg.push(genreAverage(h, trainMetas, trainScore, mean));
        preds.knn5.push(clampScore(knnScore(neighbours(x, ranked, 5), (t) => trainScore.get(t)!, mean)));
        preds.rating_only.push(ratingOnly(h, trainMetas, trainScore, mean));
        preds.mean_only.push(mean);
      }

      const trainPoints = trainIds.map((id) => ({ score: trainScore.get(id)!, trueRank: trueRank.get(id)! }));
      for (const name of MODEL_NAMES) {
        const p = preds[name];
        const pair = heldOutPairwise(held.map((id, i) => ({ pred: p[i], trueRank: trueRank.get(id)! })), trainPoints);
        if (pair.total > 0) perFold[name].acc.push(pair.agree / pair.total);
        perFold[name].tau.push(kendallTau(p, held.map((id) => -trueRank.get(id)!)));
      }
    }
  }

  const rand = seededRandom(opts.seed);
  const models = {} as Record<ModelName, MetricSummary>;
  for (const name of MODEL_NAMES) {
    models[name] = { acc: bootstrapMean(perFold[name].acc, rand), tau: bootstrapMean(perFold[name].tau, rand) };
  }
  return {
    ok: true,
    ranked: order.length,
    folds: opts.repeats * opts.folds,
    models,
    ridgeBeatsKnn: models.ridge.acc.mean > models.knn5.acc.mean,
  };
}
```

Final `src/core/recommender/index.ts`:

```ts
// Public surface of the recommender. Other modules import from here, not from the files inside.
export * from './features';
export * from './metrics';
export * from './ridge';
export * from './predict';
export * from './config';
export * from './recommend';
export * from './evaluate';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/core/recommender/evaluate.test.ts`
Expected: PASS (4 tests, under 2 s).

- [ ] **Step 6: Write the CLI**

`scripts/eval.ts`:

```ts
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
```

- [ ] **Step 7: Smoke-test the CLI on a synthetic export (outside the repo)**

Create a scratch generator **outside the repo** (e.g. in your temp dir) called `make-synthetic-export.ts`, with the path to the repo adjusted:

```ts
import { writeFileSync } from 'node:fs';
import { syntheticDataset } from '<repo>/tests/fixtures/synthetic';

const d = syntheticDataset({ games: 80, seed: 5, noise: 0.3 });
writeFileSync('synthetic.export.json', JSON.stringify({
  version: 1, exportedAt: '', events: d.events, library: [], games: d.games, externalIds: [], sublists: [],
}));
```

Run: `npx tsx make-synthetic-export.ts && npm run eval -- synthetic.export.json`
Expected output (✅ measured while writing this plan):

```
Ranked games: 80 · folds: 25

model               pairwise accuracy           Kendall τ
ridge               0.807 [0.792, 0.821]        0.432 [0.387, 0.472]
ridge_steam_masked  0.803 [0.788, 0.816]        0.430 [0.387, 0.469]
genre_avg           0.763 [0.747, 0.779]        0.198 [0.142, 0.250]
knn5                0.753 [0.731, 0.771]        0.189 [0.131, 0.250]
rating_only         0.741 [0.723, 0.759]        -0.108 [-0.165, -0.055]
mean_only           0.748 [0.730, 0.764]        0.000 [0.000, 0.000]

Ship rule: ridge beats kNN-5 → keep SCORER = "ridge" in src/core/recommender/config.ts.
```

Running `npm run eval` with no argument prints `Usage: npm run eval -- <export.json>` and exits 1. Delete the scratch files afterwards.

- [ ] **Step 8: Full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; `Test Files 10 passed`, `Tests 96 passed`.

- [ ] **Step 9: Commit and push**

```bash
git add src/core/recommender/evaluate.ts src/core/recommender/index.ts scripts/eval.ts tests/core/recommender/evaluate.test.ts package.json package-lock.json
git commit -m "feat(recommender): offline k-fold evaluation with baselines and eval CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin p2-recommender
gh run watch --exit-status
```

Expected: CI green. Merge per `superpowers:finishing-a-development-branch`.
