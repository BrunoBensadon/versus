// Runs in the PRIVATE repo BrunoBensadon/versus-backup (copied there from versus/ops/versus-backup/).
// Splits one GET /api/export response into small, diff-friendly files, so the git history of that
// repo is the versioned off-site backup (spec §10). Plain Node, no dependencies.
//   node split-export.mjs export.json [--allow-fewer]
// It refuses (exit 1, files left untouched) when the export is malformed, or when it has FEWER events
// than the backup already in this folder: events are never deleted, so that means the Worker is
// reading the wrong database. After deliberately restoring an older backup, pass --allow-fewer once.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const allowFewer = args.includes('--allow-fewer');
const path = args.find((a) => !a.startsWith('--'));
if (!path) {
  console.error('Usage: node split-export.mjs <export.json> [--allow-fewer]');
  process.exit(1);
}
const file = JSON.parse(readFileSync(path, 'utf8'));

// 1. Every field must be there with the right type, or we'd write "undefined" into a backup file.
const problems = [];
if (file.version !== 1) problems.push('version must be 1');
if (typeof file.exportedAt !== 'string') problems.push('exportedAt must be a string');
for (const key of ['events', 'library', 'sublists', 'games', 'externalIds']) {
  if (!Array.isArray(file[key])) problems.push(`${key} must be an array`);
}
if (problems.length > 0) {
  console.error(`Not a versus export: ${problems.join('; ')}.`);
  process.exit(1);
}

// 2. Never replace the last backup with one that has fewer events.
if (existsSync('events.jsonl') && !allowFewer) {
  const previous = readFileSync('events.jsonl', 'utf8').split('\n').filter((l) => l.trim().length > 0).length;
  if (file.events.length < previous) {
    console.error(
      `Refusing: the export has fewer events (${file.events.length}) than the last backup (${previous}). ` +
        'Check which database the Worker uses. If you restored an older backup on purpose, run once with --allow-fewer.',
    );
    process.exit(1);
  }
}

const pretty = (x) => `${JSON.stringify(x, null, 2)}\n`;
writeFileSync('meta.json', pretty({ version: file.version, exportedAt: file.exportedAt }));
writeFileSync('events.jsonl', file.events.map((e) => JSON.stringify(e)).join('\n') + (file.events.length > 0 ? '\n' : ''));
writeFileSync('library.json', pretty(file.library));
writeFileSync('sublists.json', pretty(file.sublists));
writeFileSync('games.json', pretty(file.games));
writeFileSync('external_ids.json', pretty(file.externalIds));
console.log(`Split ${file.events.length} events, ${file.library.length} library rows, ${file.games.length} games.`);
