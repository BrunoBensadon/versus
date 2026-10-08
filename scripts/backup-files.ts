// Read a backup folder (the files ops/versus-backup/split-export.mjs writes) back into one export,
// so `npm run restore` works from a clone of the backup repo as well as from an export file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportFile } from '../src/core/types';

export function readBackupDir(dir: string): ExportFile {
  const json = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
  const meta = json<{ version: 1; exportedAt: string }>('meta.json');
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim().length > 0);
  return {
    version: meta.version,
    exportedAt: meta.exportedAt,
    events: lines.map((l) => JSON.parse(l) as ExportFile['events'][number]),
    library: json('library.json'),
    games: json('games.json'),
    externalIds: json('external_ids.json'),
    sublists: json('sublists.json'),
  };
}
