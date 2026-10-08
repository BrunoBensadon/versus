// The backup format round-trips: export → split-export.mjs (what the nightly job runs) → readBackupDir
// gives back exactly the same export, so `npm run restore` from the backup repo loses nothing.
// split-export.mjs also refuses inputs that would write a broken or shrunken backup.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExportFile } from '../../src/core/types';
import { readBackupDir } from '../../scripts/backup-files';
import { syntheticDataset } from '../fixtures/synthetic';

const SPLIT = resolve(__dirname, '../../ops/versus-backup/split-export.mjs');

// Every test gets its own empty folder (a stand-in for the backup repo's clone); all are removed at the end.
const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'versus-backup-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sampleExport(): ExportFile {
  const d = syntheticDataset({ games: 12, seed: 4, noise: 0.3 });
  return {
    version: 1,
    exportedAt: '2026-10-06T03:17:00.000Z',
    events: d.events,
    library: [{ gameId: 1, status: 'played', bucket: 'loved', platforms: ['PC'], source: 'steam', steamPlaytimeMin: 5, addedAt: 'a', updatedAt: 'b' }],
    games: d.games,
    externalIds: [{ source: 'steam', uid: '10', gameId: 1 }],
    sublists: [{ id: 's', name: "Bruno's", kind: 'set', filter: null, items: [1, 2], createdAt: 'c' }],
  };
}

// Write `contents` as export.json in `dir` and run split-export.mjs there, like the nightly job does.
// Returns the exit code and what it printed to stderr (instead of throwing on failure).
function split(dir: string, contents: unknown, extraArgs: string[] = []): { status: number | null; stderr: string } {
  writeFileSync(join(dir, 'export.json'), JSON.stringify(contents));
  const result = spawnSync(process.execPath, [SPLIT, 'export.json', ...extraArgs], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

function eventLines(dir: string): number {
  return readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim().length > 0).length;
}

describe('backup files', () => {
  it('split-export.mjs writes the six files and readBackupDir reads back the identical export', () => {
    const dir = freshDir();
    const original = sampleExport();
    writeFileSync(join(dir, 'export.json'), JSON.stringify(original));
    execFileSync(process.execPath, [SPLIT, 'export.json'], { cwd: dir });
    expect(readdirSync(dir).sort()).toEqual(['events.jsonl', 'export.json', 'external_ids.json', 'games.json', 'library.json', 'meta.json', 'sublists.json']);
    expect(readBackupDir(dir)).toEqual(original);
  });

  it('split-export.mjs refuses something that is not an export', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ hello: 1 }));
    expect(() => execFileSync(process.execPath, [SPLIT, 'bad.json'], { cwd: dir, stdio: 'pipe' })).toThrow();
  });

  it('split-export.mjs refuses an export with any field missing or of the wrong type, and writes nothing', () => {
    // Without this check a missing `sublists` would be written as the text "undefined" and committed.
    const fields = ['version', 'exportedAt', 'events', 'library', 'sublists', 'games', 'externalIds'] as const;
    for (const field of fields) {
      for (const broken of ['missing', 'wrong type'] as const) {
        const dir = freshDir();
        const file: Record<string, unknown> = { ...sampleExport() };
        if (broken === 'missing') delete file[field];
        else file[field] = field === 'exportedAt' ? 123 : 'not an array';
        const { status, stderr } = split(dir, file);
        expect(status, `${field} ${broken}`).toBe(1);
        expect(stderr, `${field} ${broken}`).toContain(field);
        expect(readdirSync(dir), `${field} ${broken}`).toEqual(['export.json']);
      }
    }
  });

  it('split-export.mjs refuses an export with fewer events than the last backup, unless --allow-fewer', () => {
    // Events are append-only, so fewer events means the Worker is reading the wrong (empty/older) database.
    const dir = freshDir();
    const full = sampleExport();
    const n = full.events.length;
    expect(split(dir, full).status).toBe(0); // first backup: nothing to compare with
    expect(split(dir, full).status).toBe(0); // same count again (a quiet night): fine

    const shorter = { ...full, events: full.events.slice(0, n - 1) };
    const refused = split(dir, shorter);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('fewer events');
    expect(eventLines(dir)).toBe(n); // the last good backup is left untouched

    expect(split(dir, shorter, ['--allow-fewer']).status).toBe(0);
    expect(eventLines(dir)).toBe(n - 1);
  });
});
