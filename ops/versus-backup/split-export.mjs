// Runs in the PRIVATE repo BrunoBensadon/versus-backup (copied there from versus/ops/versus-backup/).
// Splits one GET /api/export response into small, diff-friendly files, so the git history of that
// repo is the versioned off-site backup (spec §10). Plain Node, no dependencies.
//   node split-export.mjs export.json
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node split-export.mjs <export.json>');
  process.exit(1);
}
const file = JSON.parse(readFileSync(path, 'utf8'));
if (file.version !== 1 || !Array.isArray(file.events)) {
  console.error('Not a versus export (expected version 1 with an events array).');
  process.exit(1);
}
const pretty = (x) => `${JSON.stringify(x, null, 2)}\n`;
writeFileSync('meta.json', pretty({ version: file.version, exportedAt: file.exportedAt }));
writeFileSync('events.jsonl', file.events.map((e) => JSON.stringify(e)).join('\n') + (file.events.length > 0 ? '\n' : ''));
writeFileSync('library.json', pretty(file.library));
writeFileSync('sublists.json', pretty(file.sublists));
writeFileSync('games.json', pretty(file.games));
writeFileSync('external_ids.json', pretty(file.externalIds));
console.log(`Split ${file.events.length} events, ${file.library.length} library rows, ${file.games.length} games.`);
