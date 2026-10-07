// Triage (spec §6.4, R-RANK-7): one tap per imported game, highest Steam playtime first.
// Duplicate hints (spec §8) show as a banner with a Merge button.

import { useMemo, useState } from 'react';
import { duplicateHints } from '../../core/catalog';
import { positionOf } from '../../core/ranking';
import type { Bucket, GameId, Status } from '../../core/types';
import { ApiError } from '../api';
import { BUCKET_LABEL, Cover, gameName } from '../components';
import { inboxQueue } from '../derive';
import { useStore } from '../store';

const DISMISSED_KEY = 'versus.dismissedHints';

/** Shown under the buttons when a save fails, so a tap never silently does nothing. */
const SAVE_ERROR = "Couldn't save — check your connection and try again.";

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
  const [error, setError] = useState<string | null>(null);

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

  // Every button goes through here: buttons are disabled while saving, and a failed save shows a message.
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setDropped(false); // only after a successful save, so a retry still saves `dropped`
    } catch (e) {
      // A 401 (logged out) is already handled by the store: it sends the user to the login page.
      if (!(e instanceof ApiError && e.status === 401)) setError(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (id: GameId, status: Status, bucket: Bucket | null = null) => act(() => store.patchLibrary(id, { status, bucket }));

  async function merge(keep: GameId, drop: GameId) {
    // Read both rows before saving anything: the dropped row is about to become `ignored`.
    const keepRow = store.rowOf.get(keep);
    const dropRow = store.rowOf.get(drop);
    await act(async () => {
      await store.append([{ type: 'merged', gameId: drop, data: { into: keep } }]);
      await store.patchLibrary(drop, { status: 'ignored' });
      // If the kept game hasn't been triaged yet, give it what was already decided for the dropped one.
      if (keepRow?.status === 'inbox' && dropRow) {
        // A kept game that already has a ranked place keeps its own bucket; copy only the status.
        const patch = positionOf(store.state, keep) !== null ? { status: dropRow.status } : { status: dropRow.status, bucket: dropRow.bucket };
        await store.patchLibrary(keep, patch);
      }
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

  // Which game survives a merge (extends roadmap deviation 14):
  // - if exactly one of the two has a ranked place, keep that one (the game you ranked stays the one you see);
  // - otherwise keep the one with more Steam playtime.
  // The other one is merged into it.
  let banner = null;
  if (hint) {
    const [a, b] = hint;
    const playtime = (id: GameId) => store.rowOf.get(id)?.steamPlaytimeMin ?? 0;
    const aRanked = positionOf(store.state, a) !== null;
    const bRanked = positionOf(store.state, b) !== null;
    let keep: GameId;
    let drop: GameId;
    if (aRanked && !bRanked) [keep, drop] = [a, b];
    else if (bRanked && !aRanked) [keep, drop] = [b, a];
    else [keep, drop] = playtime(a) >= playtime(b) ? [a, b] : [b, a];
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

  const errorLine = error ? <p className="error" role="alert">{error}</p> : null;

  if (!current) {
    return (
      <section>
        {banner}
        {errorLine}
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
      {errorLine}
    </section>
  );
}
