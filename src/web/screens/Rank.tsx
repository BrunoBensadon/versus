// The ranking flow (spec §6.1): pick a bucket → answer head-to-head questions → confirm the place.
// Everything shown is derived from the event log, so closing the app mid-session and coming back
// (on any device) resumes exactly where it stopped.

import { useState } from 'react';
import { positionOf, sessionList, sessionStep } from '../../core/ranking';
import { BUCKETS, type Bucket, type EventBody, type GameId } from '../../core/types';
import { ApiError } from '../api';
import { BUCKET_LABEL, Cover, gameName } from '../components';
import { unrankedQueue } from '../derive';
import { navigate, useRoute } from '../router';
import { useStore, type Store } from '../store';

/** Shown under the buttons when a save fails, so a tap never silently does nothing. */
const SAVE_ERROR = "Couldn't save — check your connection and try again.";

/**
 * The message to show for a failed save, or null when there's nothing to show.
 * A 401 (logged out) is already handled by the store: it sends the user to the login page.
 */
function saveErrorFor(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 401) return null;
  return SAVE_ERROR;
}

/**
 * Open a session for `game` in `bucket` and go to it. `left` = games remaining in a "Rank 10" run.
 * `cancelSession`: an open session to cancel in the SAME post (Redo / "Start this game again"),
 * so a half-failed redo can't leave the user with no session at all.
 */
export async function startSession(store: Store, game: GameId, bucket: Bucket, left?: number, cancelSession?: string): Promise<void> {
  const session = crypto.randomUUID();
  const events: EventBody[] = [];
  if (cancelSession) events.push({ type: 'session_cancelled', gameId: game, data: { session: cancelSession } });
  events.push({ type: 'session_started', gameId: game, data: { session, bucket } });
  await store.append(events);
  navigate(`/rank/${session}${left ? `?left=${left}` : ''}`, true);
}

/** #/rank/new/:id(?left=N): choose the bucket. Also used for re-rank and for moving a game to another bucket. */
export function RankStartScreen({ gameId }: { gameId: GameId }) {
  const store = useStore();
  // `left` is set when we came here from a "Rank 10" run; pass it on so the run continues after Confirm.
  const { query } = useRoute();
  const left = Number(query.get('left') ?? '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = store.rowOf.get(gameId);
  const meta = store.games.get(gameId);

  async function choose(bucket: Bucket) {
    setBusy(true);
    setError(null);
    try {
      // Ranking a game means you've played it: keep `dropped` if it was, otherwise mark it played.
      const status = row?.status === 'dropped' ? 'dropped' : 'played';
      if (positionOf(store.state, gameId) === null) {
        // Not ranked yet: save the chosen bucket on the library row right away.
        if (row?.status !== status || row?.bucket !== bucket) await store.patchLibrary(gameId, { status, bucket });
      } else if (row?.status !== status) {
        // Already ranked (re-rank or bucket change): leave the bucket alone. The game keeps its old place
        // until the new `placed` event, and the Worker sets the bucket from that event (spec §6.1).
        await store.patchLibrary(gameId, { status });
      }
      await startSession(store, gameId, bucket, left || undefined);
    } catch (e) {
      setError(saveErrorFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="hero">
        <Cover meta={meta} big />
        <h2>{meta?.name ?? `IGDB ${gameId}`}</h2>
      </div>
      <p>How was it?</p>
      <div className="choices">
        {BUCKETS.map((b) => (
          <button key={b} className={`big ${b}${row?.bucket === b ? ' suggested' : ''}`} disabled={busy} onClick={() => choose(b)}>
            {BUCKET_LABEL[b]}
          </button>
        ))}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}

/** #/rank/:session: one question at a time, then the confirm screen. */
export function RankScreen({ sessionId, left }: { sessionId: string; left: number }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a successful Confirm. The `placed` event closes the session, so without this flag the
  // "session is finished" message below would flash for a moment before the next screen shows.
  const [done, setDone] = useState(false);
  const session = store.state.openSessions.get(sessionId);

  if (done) return null;
  if (!session) {
    return (
      <section>
        <p>This ranking session is finished.</p>
        <a href="#/">Home</a>
      </section>
    );
  }
  const next = sessionStep(store.state, sessionId)!;
  const name = (id: GameId) => gameName(store.games, id);
  // Every button goes through here: buttons are disabled while saving, and a failed save shows a message.
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(saveErrorFor(e));
    } finally {
      setBusy(false);
    }
  };
  const errorLine = error ? <p className="error" role="alert">{error}</p> : null;
  const answer = (result: 'better' | 'worse' | 'tie') => () =>
    act(() => store.append([{ type: 'answer', gameId: session.game, data: { session: sessionId, pivot: (next as { pivot: GameId }).pivot, result } }]));
  const undo = () => act(() => store.append([{ type: 'undo', gameId: session.game, data: { session: sessionId } }]));
  // Cancel this session and start a fresh one in the same bucket, in one post.
  const restart = () => act(() => startSession(store, session.game, session.bucket, left || undefined, sessionId));
  // Keep `?left=N` so a "Rank 10" run carries on after the bucket change.
  const backToBuckets = () =>
    act(async () => {
      await store.append([{ type: 'session_cancelled', gameId: session.game, data: { session: sessionId } }]);
      navigate(`/rank/new/${session.game}${left > 0 ? `?left=${left}` : ''}`, true);
    });

  const header = (
    <p className="muted small">
      Ranking <strong>{name(session.game)}</strong> in {BUCKET_LABEL[session.bucket]} · question {session.answers.length + (next.kind === 'ask' ? 1 : 0)}
    </p>
  );

  if (next.kind === 'stale') {
    return (
      <section>
        {header}
        <p>The {BUCKET_LABEL[session.bucket]} list changed while you were ranking (maybe on another device). Your answers no longer fit.</p>
        <button className="primary" disabled={busy} onClick={restart}>Start this game again</button>
        {errorLine}
      </section>
    );
  }

  if (next.kind === 'ask') {
    return (
      <section>
        {header}
        <h2>Which did you enjoy more?</h2>
        <div className="versus">
          <button className="big pick" disabled={busy} onClick={answer('better')} data-testid="pick-new">
            <Cover meta={store.games.get(session.game)} big />
            {name(session.game)}
          </button>
          <span className="vs">vs</span>
          <button className="big pick" disabled={busy} onClick={answer('worse')} data-testid="pick-pivot">
            <Cover meta={store.games.get(next.pivot)} big />
            {name(next.pivot)}
          </button>
        </div>
        <div className="row-buttons">
          <button disabled={busy} onClick={answer('tie')}>Too close to call</button>
          {session.answers.length > 0 ? <button disabled={busy} onClick={undo}>Undo</button> : <button disabled={busy} onClick={backToBuckets}>Change bucket</button>}
          <a className="button" href="#/">Stop for now</a>
        </div>
        {errorLine}
      </section>
    );
  }

  // next.kind === 'place': show where it lands and ask for confirmation.
  const list = sessionList(store.state, session);
  const index = next.below === null ? 0 : list.indexOf(next.below) + 1;
  const above = index > 0 ? list[index - 1] : null;
  const below = index < list.length ? list[index] : null;
  const where =
    above === null && below === null
      ? `the first game in ${BUCKET_LABEL[session.bucket]}`
      : above === null
        ? `at the top, above ${name(below!)}`
        : below === null
          ? `at the bottom, below ${name(above)}`
          : `between ${name(above)} and ${name(below)}`;

  const confirm = () =>
    act(async () => {
      await store.append([{ type: 'placed', gameId: session.game, data: { session: sessionId, bucket: session.bucket, below: next.below } }]);
      setDone(true); // saved: show nothing until the next screen replaces this one
      navigate(left > 0 ? `/queue?left=${left - 1}` : `/game/${session.game}`, true);
    });

  return (
    <section>
      {header}
      <h2 data-testid="confirm">
        {name(session.game)} goes {where}.
      </h2>
      <div className="row-buttons">
        <button className="primary" disabled={busy} onClick={confirm}>✓ Looks right</button>
        <button disabled={busy} onClick={restart}>Redo</button>
        {session.answers.length > 0 ? <button disabled={busy} onClick={undo}>Undo last answer</button> : null}
      </div>
      {errorLine}
    </section>
  );
}

/** #/queue?left=N: "Rank 10" works through unranked games, highest playtime first (spec §6.4). */
export function QueueScreen({ left }: { left: number }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = unrankedQueue(store.rows, store.state);
  const nextRow = queue[0];
  if (left <= 0 || !nextRow) {
    return (
      <section>
        <h2>{nextRow ? 'Nice run!' : 'Nothing left to rank'}</h2>
        <p className="muted">{queue.length} unranked game{queue.length === 1 ? '' : 's'} waiting.</p>
        <a href="#/">Home</a>
      </section>
    );
  }
  return (
    <section>
      <p className="muted small">{left} to go in this run · {queue.length} unranked in total</p>
      <div className="hero">
        <Cover meta={store.games.get(nextRow.gameId)} big />
        <h2>{gameName(store.games, nextRow.gameId)}</h2>
        <p className="muted">{BUCKET_LABEL[nextRow.bucket!]}</p>
      </div>
      <div className="row-buttons">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await startSession(store, nextRow.gameId, nextRow.bucket!, left);
            } catch (e) {
              setError(saveErrorFor(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Rank it
        </button>
        {/* `?left=N` keeps the "Rank 10" run going after the bucket is chosen there. */}
        <a className="button" href={`#/rank/new/${nextRow.gameId}?left=${left}`}>Different bucket</a>
        <a className="button" href="#/">Done for now</a>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
