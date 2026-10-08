// One game: metadata, library status, its place in the ranking, or a prediction with reasons
// (spec §7.3), "Already played → rank now" (R-REC-5a), Refresh, set-list membership, unmerge.

import { useEffect, useMemo, useState } from 'react';
import { formatScore, globalOrder, positionOf } from '../../core/ranking';
import { STATUSES, type GameId, type Status } from '../../core/types';
import { BUCKET_LABEL, Cover, DroppedMarker, gameName, PredictionCard, ScoreBadge, TimeToBeat } from '../components';
import { isStale } from '../derive';
import { navigate } from '../router';
import { useStore } from '../store';

export function GameScreen({ gameId }: { gameId: GameId }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = store.games.get(gameId);
  const row = store.rowOf.get(gameId);
  const stale = isStale(store.fetchedAt[gameId], new Date());

  // Fetch missing or > 30-day-old metadata. A searched edition/remaster redirects to its root work.
  useEffect(() => {
    if (!stale) return;
    let cancelled = false;
    store
      .fetchGame(gameId)
      .then((rootId) => {
        if (!cancelled && rootId !== gameId) navigate(`/game/${rootId}`, true);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the game and its freshness only: `store` changes after every fetch.
  }, [gameId, stale]);

  const position = positionOf(store.state, gameId);
  const prediction = useMemo(
    () => (position || !meta ? null : (store.predict([gameId])[0] ?? null)),
    [position, meta, store.predict, gameId],
  );

  if (!meta) return <p className="muted">{error ?? 'Loading game…'}</p>;

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: Status) => act(() => store.patchLibrary(gameId, { status }));
  // Only go to the bucket choice: choosing a bucket there saves `played` (or keeps `dropped`) with the bucket,
  // so backing out of it leaves a backlog/wishlist game as it was.
  const rankNow = () => navigate(`/rank/new/${gameId}`);
  const unrank = () => act(() => store.append([{ type: 'unranked', gameId, data: {} }]));
  const mergedHere = [...store.state.aliases].filter(([, into]) => into === gameId).map(([from]) => from);
  const unmerge = (from: GameId) =>
    act(async () => {
      await store.append([{ type: 'unmerged', gameId: from, data: { into: gameId } }]);
      await store.patchLibrary(from, { status: 'inbox' });
    });
  const setLists = store.sublists.filter((s) => s.kind === 'set');
  const toggleSet = (id: string) =>
    act(async () => {
      const s = setLists.find((x) => x.id === id)!;
      const items = s.items.includes(gameId) ? s.items.filter((x) => x !== gameId) : [...s.items, gameId];
      await store.saveSublist({ ...s, items });
    });

  const rank = position ? globalOrder(store.state).indexOf(gameId) + 1 : null;

  return (
    <section>
      <div className="hero">
        <Cover meta={meta} big />
        <h2 data-testid="game-name">{meta.name}</h2>
        <p className="muted">
          {[meta.year, meta.genres.slice(0, 3).join(', '), meta.platforms.slice(0, 4).join(', ')].filter(Boolean).join(' · ')}
          {meta.ttb ? <> · <TimeToBeat meta={meta} /></> : null}
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {position ? (
        <div className="card">
          <p data-testid="ranked-score">
            #{rank} · <ScoreBadge score={store.scoreMap.get(gameId)!} bucket={position.bucket} /> · {BUCKET_LABEL[position.bucket]} <DroppedMarker row={row} />
          </p>
          <div className="row-buttons">
            <a className="button" href={`#/rank/new/${gameId}`}>Re-rank / change bucket</a>
            <button disabled={busy} onClick={unrank}>Remove from ranking</button>
          </div>
        </div>
      ) : (
        <>
          {prediction ? <PredictionCard prediction={prediction} games={store.games} state={store.state} /> : null}
          <div className="row-buttons">
            <button className="primary" disabled={busy} onClick={rankNow}>Already played → rank now</button>
          </div>
        </>
      )}

      <div className="card">
        {row ? (
          <label>
            Status{' '}
            <select value={row.status} disabled={busy} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="row-buttons">
            <span>Add to library:</span>
            <button disabled={busy} onClick={() => setStatus('wishlist')}>Wishlist</button>
            <button disabled={busy} onClick={() => setStatus('backlog')}>Backlog</button>
          </div>
        )}
        {setLists.length > 0 ? (
          <div className="row-buttons">
            {setLists.map((s) => (
              <button key={s.id} disabled={busy} className={s.items.includes(gameId) ? 'tab active' : 'tab'} onClick={() => toggleSet(s.id)}>
                {s.items.includes(gameId) ? '✓ ' : '+ '}
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        {mergedHere.map((from) => (
          <p key={from} className="muted small">
            Merged: {gameName(store.games, from)} <button disabled={busy} onClick={() => unmerge(from)}>Unmerge</button>
          </p>
        ))}
        <button disabled={busy} onClick={() => act(async () => void (await store.fetchGame(gameId)))}>Refresh game data</button>
        {position ? <p className="muted small">Score {formatScore(store.scoreMap.get(gameId)!)}: scores shift as you rank more games.</p> : null}
      </div>
    </section>
  );
}
