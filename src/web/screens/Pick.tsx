// Backlog pick (spec §7.3, R-REC-3): backlog (optionally + wishlist) sorted by predicted score,
// filtered by platform, genre and length.

import { useMemo, useState } from 'react';
import { BUCKET_LABEL, GameRow, ScoreBadge, TimeToBeat } from '../components';
import { matchesFilter } from '../derive';
import { useStore } from '../store';

export function PickScreen() {
  const store = useStore();
  const [withWishlist, setWithWishlist] = useState(false);
  const [platform, setPlatform] = useState('');
  const [genre, setGenre] = useState('');
  const [maxHours, setMaxHours] = useState('');

  const candidates = useMemo(
    () =>
      store.rows
        .filter((r) => r.status === 'backlog' || (withWishlist && r.status === 'wishlist'))
        .filter((r) => !store.state.aliases.has(r.gameId))
        .map((r) => r.gameId),
    [store.rows, store.state, withWishlist],
  );
  // The model is fitted once per data change (store.predict); here we only predict.
  const predictions = useMemo(
    () => store.predict(candidates),
    [store.predict, candidates],
  );

  const shown = predictions
    .filter((p) => {
      const meta = store.games.get(p.gameId);
      if (!matchesFilter(meta, store.rowOf.get(p.gameId), { platform: platform || undefined, genre: genre || undefined })) return false;
      if (maxHours && meta?.ttb && meta.ttb.normally / 3600 > Number(maxHours)) return false;
      return true;
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const genres = [...new Set(candidates.flatMap((id) => store.games.get(id)?.genres ?? []))].sort();
  const platforms = [...new Set(candidates.flatMap((id) => [...(store.games.get(id)?.platforms ?? []), ...(store.rowOf.get(id)?.platforms ?? [])]))].sort();

  return (
    <section>
      <h2>What to play next</h2>
      <div className="filter-grid">
        <label className="check">
          <input type="checkbox" checked={withWishlist} onChange={(e) => setWithWishlist(e.target.checked)} /> include wishlist
        </label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
          <option value="">Any platform</option>
          {platforms.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
          <option value="">Any genre</option>
          {genres.map((g) => <option key={g}>{g}</option>)}
        </select>
        <input type="number" min="1" placeholder="Max hours" value={maxHours} onChange={(e) => setMaxHours(e.target.value)} />
      </div>
      {shown.length === 0 ? <p className="muted">Nothing in your backlog matches.</p> : null}
      {shown.map((p) => (
        <div key={p.gameId} className="pick" data-testid="pick-row">
          <GameRow
            id={p.gameId}
            meta={store.games.get(p.gameId)}
            sub={<TimeToBeat meta={store.games.get(p.gameId)} />}
            right={p.score === null ? <span className="muted small">no prediction yet · {p.confidence} confidence</span> : <ScoreBadge score={p.score} bucket={p.bucket!} />}
          />
          {p.score !== null ? (
            <p className="muted small pick-why">
              {BUCKET_LABEL[p.bucket!]} · {p.confidence} confidence
              {p.reasons[0] ? <> · {p.reasons[0].label} {p.reasons[0].value >= 0 ? '+' : '−'}{Math.abs(p.reasons[0].value).toFixed(1)}</> : null}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
