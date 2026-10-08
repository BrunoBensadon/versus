// The ranked list (R-RANK-4, R-LIB-2, R-RANK-9a): buckets in order, scores, unranked games marked,
// filters, and sub-lists (saved filters or hand-picked sets) shown in the global order.

import { useState } from 'react';
import { globalOrder } from '../../core/ranking';
import { BUCKETS, STATUSES, type Status, type SublistFilter } from '../../core/types';
import { BUCKET_LABEL, DroppedMarker, GameRow, ScoreBadge } from '../components';
import { matchesFilter } from '../derive';
import { navigate } from '../router';
import { useStore } from '../store';

export function RankedScreen({ listId }: { listId: string | null }) {
  const store = useStore();
  const [filter, setFilter] = useState<SublistFilter>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sublist = listId ? store.sublists.find((s) => s.id === listId) : undefined;
  const order = globalOrder(store.state);
  const rankOf = new Map(order.map((id, i) => [id, i + 1]));

  const passes = (id: number) => {
    const meta = store.games.get(id);
    const row = store.rowOf.get(id);
    if (sublist?.kind === 'set' && !sublist.items.includes(id)) return false;
    if (sublist?.kind === 'filter' && sublist.filter && !matchesFilter(meta, row, sublist.filter)) return false;
    return matchesFilter(meta, row, filter);
  };

  // Runs a save/delete: busy is always reset, and a failure is shown instead of being lost.
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

  async function saveFilter() {
    const name = window.prompt('Name this sub-list');
    if (!name) return;
    const id = crypto.randomUUID();
    await act(async () => {
      await store.saveSublist({ id, name, kind: 'filter', filter, items: [], createdAt: new Date().toISOString() });
      navigate(`/ranked?list=${id}`);
    });
  }

  async function newSet() {
    const name = window.prompt('Name the new hand-picked list (add games from their page)');
    if (!name) return;
    await act(() => store.saveSublist({ id: crypto.randomUUID(), name, kind: 'set', filter: null, items: [], createdAt: new Date().toISOString() }));
  }

  const genres = [...new Set([...store.games.values()].flatMap((g) => g.genres))].sort();
  const platforms = [...new Set([...store.games.values()].flatMap((g) => g.platforms).concat(store.rows.flatMap((r) => r.platforms)))].sort();

  return (
    <section>
      <h2>{sublist ? sublist.name : 'My ranking'}</h2>
      <div className="tabs">
        <a className={listId ? 'tab' : 'tab active'} href="#/ranked">All</a>
        {store.sublists.map((s) => (
          <a key={s.id} className={s.id === listId ? 'tab active' : 'tab'} href={`#/ranked?list=${s.id}`}>{s.name}</a>
        ))}
        <button className="tab" disabled={busy} onClick={newSet}>+ list</button>
      </div>
      <details className="filters">
        <summary>Filter</summary>
        <div className="filter-grid">
          <select value={filter.platform ?? ''} onChange={(e) => setFilter({ ...filter, platform: e.target.value || undefined })} aria-label="Platform">
            <option value="">Any platform</option>
            {platforms.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select value={filter.genre ?? ''} onChange={(e) => setFilter({ ...filter, genre: e.target.value || undefined })} aria-label="Genre">
            <option value="">Any genre</option>
            {genres.map((g) => <option key={g}>{g}</option>)}
          </select>
          <input type="number" placeholder="From year" value={filter.yearFrom ?? ''} onChange={(e) => setFilter({ ...filter, yearFrom: e.target.value ? Number(e.target.value) : undefined })} />
          <input type="number" placeholder="To year" value={filter.yearTo ?? ''} onChange={(e) => setFilter({ ...filter, yearTo: e.target.value ? Number(e.target.value) : undefined })} />
          <select value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: (e.target.value || undefined) as Status | undefined })} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button onClick={saveFilter} disabled={busy || Object.keys(filter).every((k) => filter[k as keyof SublistFilter] === undefined)}>Save as sub-list</button>
        </div>
      </details>
      {sublist ? (
        <button
          className="link"
          disabled={busy}
          onClick={() => {
            // Ask first: a set list's hand-picked games are gone for good once it's deleted.
            if (!window.confirm("Delete this sub-list? Its hand-picked games can't be recovered.")) return;
            void act(async () => { await store.removeSublist(sublist.id); navigate('/ranked'); });
          }}
        >
          Delete this sub-list
        </button>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className="muted small">Scores (0–10) come from positions inside each bucket, so they shift as you rank more games.</p>

      {BUCKETS.map((bucket) => {
        const ranked = store.state.lists[bucket].filter(passes);
        const unranked = store.rows
          .filter((r) => r.bucket === bucket && (r.status === 'played' || r.status === 'dropped'))
          .filter((r) => !rankOf.has(r.gameId) && !store.state.aliases.has(r.gameId) && passes(r.gameId));
        return (
          <div key={bucket} className="bucket">
            <h3 className={bucket}>{BUCKET_LABEL[bucket]}</h3>
            {ranked.length === 0 && unranked.length === 0 ? <p className="muted small">Nothing yet.</p> : null}
            {ranked.map((id) => (
              <GameRow
                key={id}
                id={id}
                meta={store.games.get(id)}
                sub={<DroppedMarker row={store.rowOf.get(id)} />}
                right={<><span className="muted">#{rankOf.get(id)}</span> <ScoreBadge score={store.scoreMap.get(id)!} bucket={bucket} /></>}
              />
            ))}
            {unranked.map((r) => (
              <GameRow key={r.gameId} id={r.gameId} meta={store.games.get(r.gameId)} right={<span className="tag">unranked</span>} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
