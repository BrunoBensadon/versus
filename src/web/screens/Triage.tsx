// Triage (spec §6.4, R-RANK-7): one tap per imported game, highest Steam playtime first.
// Duplicate hints (spec §8) show as a banner with a Merge button.

import { useMemo, useState } from 'react';
import { duplicateHints } from '../../core/catalog';
import type { Bucket, GameId, Status } from '../../core/types';
import { BUCKET_LABEL, Cover, gameName } from '../components';
import { inboxQueue } from '../derive';
import { useStore } from '../store';

const DISMISSED_KEY = 'versus.dismissedHints';

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function TriageScreen() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);

  const queue = inboxQueue(store.rows, store.state);
  const current = queue[0];

  // Hints among games still visible in the library (not ignored, not already merged away).
  // Memoized: only recomputed when the library, the log or the game data change.
  const visible = useMemo(
    () =>
      store.rows
        .filter((r) => r.status !== 'ignored' && !store.state.aliases.has(r.gameId))
        .map((r) => store.games.get(r.gameId))
        .filter((g) => g !== undefined),
    [store.rows, store.state, store.games],
  );
  const hints = useMemo(() => duplicateHints(visible), [visible]);
  const hint = hints.find(([a, b]) => !dismissed.includes(`${a}-${b}`));

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
      setDropped(false);
    }
  }

  const setStatus = (id: GameId, status: Status, bucket: Bucket | null = null) => act(() => store.patchLibrary(id, { status, bucket }));

  async function merge(keep: GameId, drop: GameId) {
    await act(async () => {
      await store.append([{ type: 'merged', gameId: drop, data: { into: keep } }]);
      await store.patchLibrary(drop, { status: 'ignored' });
    });
  }

  function dismiss(a: GameId, b: GameId) {
    const next = [...dismissed, `${a}-${b}`];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the hint just comes back next time.
    }
  }

  // Keep the one with more playtime; merge the other into it.
  let banner = null;
  if (hint) {
    const [a, b] = hint;
    const playtime = (id: GameId) => store.rowOf.get(id)?.steamPlaytimeMin ?? 0;
    const [keep, drop] = playtime(a) >= playtime(b) ? [a, b] : [b, a];
    banner = (
      <div className="card banner" data-testid="duplicate-hint">
        <p>
          <strong>{gameName(store.games, drop)}</strong> looks like the same game as <strong>{gameName(store.games, keep)}</strong>.
        </p>
        <div className="row-buttons">
          <button disabled={busy} onClick={() => merge(keep, drop)}>Merge</button>
          <button disabled={busy} onClick={() => dismiss(a, b)}>Not the same</button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <section>
        {banner}
        <h2>Triage done</h2>
        <p className="muted">Nothing left in the inbox.</p>
        <a className="button" href="#/queue?left=10">Rank 10</a>
      </section>
    );
  }

  const hours = Math.round((current.steamPlaytimeMin ?? 0) / 60);
  return (
    <section>
      {banner}
      <p className="muted small">{queue.length} left</p>
      <div className="hero">
        <Cover meta={store.games.get(current.gameId)} big />
        <h2 data-testid="triage-name">{gameName(store.games, current.gameId)}</h2>
        <p className="muted">{hours} h on Steam</p>
      </div>
      <p>Played it?</p>
      <div className="choices">
        {(['loved', 'liked', 'disliked'] as const).map((b) => (
          <button key={b} className={`big ${b}`} disabled={busy} onClick={() => setStatus(current.gameId, dropped ? 'dropped' : 'played', b)}>
            {BUCKET_LABEL[b]}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={dropped} onChange={(e) => setDropped(e.target.checked)} /> I dropped it
      </label>
      <p>Not yet:</p>
      <div className="row-buttons">
        <button disabled={busy} onClick={() => setStatus(current.gameId, 'backlog')}>Backlog</button>
        <button disabled={busy} onClick={() => setStatus(current.gameId, 'playing')}>Playing</button>
        <button disabled={busy} onClick={() => setStatus(current.gameId, 'ignored')}>Ignore</button>
      </div>
    </section>
  );
}
