// Restore an export into a fresh D1 database (spec §10; runbook in docs/runbook.md).
//   npm run restore -- <export.json | backup-folder> <restore.sql>
//   npx wrangler d1 migrations apply versus --remote     (on the NEW, empty database)
//   npx wrangler d1 execute versus --remote --file <restore.sql>
// The .sql file contains the full log: treat it like the export (never commit it).

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import type { ExportFile } from '../src/core/types';
import { readBackupDir } from './backup-files';
import { restoreStatements } from './restore-sql';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: npm run restore -- <export.json | backup-folder> <restore.sql>');
  process.exit(1);
}
// A folder is a clone of the backup repo; a file is an export downloaded from the app.
const file = statSync(input).isDirectory() ? readBackupDir(input) : (JSON.parse(readFileSync(input, 'utf8')) as ExportFile);
const statements = restoreStatements(file, new Date().toISOString());
writeFileSync(output, `${statements.join('\n')}\n`);
console.log(`Wrote ${statements.length} statements (${file.events.length} events) to ${output}`);
