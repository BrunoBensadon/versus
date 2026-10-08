// Home: resume open ranking sessions, and the two queues (triage, unranked).

import { gameName } from '../components';
import { inboxQueue, unrankedQueue } from '../derive';
import { useStore } from '../store';

export function HomeScreen() {
  const store = useStore();
  const open = [...store.state.openSessions.values()];
  const inbox = inboxQueue(store.rows, store.state).length;
  const unranked = unrankedQueue(store.rows, store.state).length;
  const ranked = store.scoreMap.size;

  return (
    <section>
      <h1>versus</h1>
      {open.length > 0 ? (
        <div className="card">
          <h3>Pick up where you left off</h3>
          {open.map((s) => (
            <a key={s.id} className="button wide" href={`#/rank/${s.id}`}>
              Continue ranking {gameName(store.games, s.game)}
            </a>
          ))}
        </div>
      ) : null}
      <div className="tiles">
        <a className="tile" href="#/search">
          <strong>Rank a game</strong>
          <span className="muted small">Search, then a few questions</span>
        </a>
        <a className="tile" href="#/triage">
          <strong>Triage</strong>
          <span className="muted small" data-testid="inbox-count">{inbox} imported, not sorted</span>
        </a>
        <a className="tile" href="#/queue?left=10">
          <strong>Rank 10</strong>
          <span className="muted small">{unranked} played, not yet ranked</span>
        </a>
        <a className="tile" href="#/pick">
          <strong>What to play next</strong>
          <span className="muted small">Backlog, by predicted score</span>
        </a>
        <a className="tile" href="#/ranked">
          <strong>My ranking</strong>
          <span className="muted small">{ranked} ranked</span>
        </a>
        <a className="tile" href="#/library">
          <strong>Library</strong>
          <span className="muted small">{store.rows.length} games</span>
        </a>
      </div>
    </section>
  );
}
