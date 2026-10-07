# versus

Rank the games you've played with head-to-head questions; get a predicted rank, with reasons, for
the ones you haven't. A single-user installable web app (PWA) on Cloudflare's free tier.

- Design: [`docs/specs/2026-10-06-versus-design.md`](docs/specs/2026-10-06-versus-design.md)
- Implementation plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

## Layout

| Folder | What lives there |
|---|---|
| `src/core/` | pure TypeScript: ranking engine, recommender, catalog normalization (no network, no DOM, no database) |
| `src/worker/` | the Cloudflare Worker: API routes, auth, SQL, IGDB and Steam clients |
| `src/web/` | the PWA: React screens, data store, service worker, manifest, icons |
| `migrations/` | the D1 (SQLite) schema |
| `scripts/` | command-line tools: eval, restore, fixture capture, .dev.vars setup |
| `tests/` | `core/`, `web/` and `worker/` unit tests, `e2e/` (Playwright), `fixtures/` (public game data + synthetic data only) |

## First-time setup (Windows, PowerShell or Git Bash)

```bash
npm ci                     # install the pinned tools
npm run dev-vars           # writes .dev.vars (local Worker secrets) from .env; both are git-ignored
npm run db:migrate:local   # creates the local D1 database under .wrangler/
```

## Everyday commands

```bash
npm run dev                # build the web app, then serve app + API on http://127.0.0.1:8787 (local D1)
npm run dev:web            # hot-reloading web app on http://localhost:5173; run `npm run dev:worker` alongside
npm test                   # core + web unit tests, then Worker tests (in Cloudflare's local runtime)
npm run typecheck          # TypeScript for core, web and scripts, then for the Worker
npm run e2e                # Playwright journey on a phone viewport, against fake IGDB/Steam
npm run eval -- exports/<file>.json    # offline recommender evaluation on an export
```

The first `npm run e2e` needs a browser: `npx playwright install chromium`.

## Never commit

`.env`, `.dev.vars`, exports (`exports/`, `*.export.json`), restore `.sql` files, or any fixture with
playtimes or a Steam id. This repository is public.
