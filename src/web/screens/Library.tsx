// Library by status (R-LIB-2).

import { useState } from 'react';
import { STATUSES, type Status } from '../../core/types';
import { GameRow } from '../components';
import { useStore } from '../store';

const LABEL: Record<Status, string> = {
  inbox: 'Inbox', wishlist: 'Wishlist', backlog: 'Backlog', playing: 'Playing', played: 'Played', dropped: 'Dropped', ignored: 'Ignored',
};

export function LibraryScreen() {
  const store = useStore();
  const [status, setStatus] = useState<Status>('backlog');
  const visible = store.rows.filter((r) => !store.state.aliases.has(r.gameId));
  const shown = visible
    .filter((r) => r.status === status)
    .sort((a, b) => (store.games.get(a.gameId)?.name ?? '').localeCompare(store.games.get(b.gameId)?.name ?? ''));

  return (
    <section>
      <h2>Library</h2>
      <div className="tabs">
        {STATUSES.map((s) => (
          <button key={s} className={s === status ? 'tab active' : 'tab'} onClick={() => setStatus(s)}>
            {LABEL[s]} <span className="muted">{visible.filter((r) => r.status === s).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="muted">Nothing here.</p> : null}
      {shown.map((r) => (
        <GameRow key={r.gameId} id={r.gameId} meta={store.games.get(r.gameId)} sub={r.platforms.join(', ')} />
      ))}
    </section>
  );
}
