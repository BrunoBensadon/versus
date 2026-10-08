// The backup format round-trips: export → split-export.mjs (what the nightly job runs) → readBackupDir
// gives back exactly the same export, so `npm run restore` from the backup repo loses nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExportFile } from '../../src/core/types';
import { readBackupDir } from '../../scripts/backup-files';
import { syntheticDataset } from '../fixtures/synthetic';

const SPLIT = resolve(__dirname, '../../ops/versus-backup/split-export.mjs');
const dir = mkdtempSync(join(tmpdir(), 'versus-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

describe('backup files', () => {
  it('split-export.mjs writes the six files and readBackupDir reads back the identical export', () => {
    const original = sampleExport();
    writeFileSync(join(dir, 'export.json'), JSON.stringify(original));
    execFileSync(process.execPath, [SPLIT, 'export.json'], { cwd: dir });
    expect(readdirSync(dir).sort()).toEqual(['events.jsonl', 'export.json', 'external_ids.json', 'games.json', 'library.json', 'meta.json', 'sublists.json']);
    expect(readBackupDir(dir)).toEqual(original);
  });

  it('split-export.mjs refuses something that is not an export', () => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ hello: 1 }));
    expect(() => execFileSync(process.execPath, [SPLIT, 'bad.json'], { cwd: dir, stdio: 'pipe' })).toThrow();
  });
});
