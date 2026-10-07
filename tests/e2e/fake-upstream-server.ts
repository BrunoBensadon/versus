// Serves tests/fixtures/fake-upstream.ts over HTTP on :8788 so `wrangler dev` can call it during the
// end-to-end tests (tests/e2e/e2e.env points IGDB_BASE_URL, TWITCH_TOKEN_URL and STEAM_BASE_URL here).

import { createServer } from 'node:http';
import { fakeUpstream } from '../fixtures/fake-upstream';

const PORT = 8788;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const response = await fakeUpstream(`http://127.0.0.1:${PORT}${req.url}`, { method: req.method, body });
  res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`fake upstream on http://127.0.0.1:${PORT}`));
