// The app's data in one place: the event log, library, game metadata and sub-lists, plus what's
// derived from them (the ranked order and scores). The order is always replay(events): spec §6.2.
// Ranking is online-only in v1 (spec D21): every action is posted at once, then merged locally.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { replay, scores, type RankState } from '../core/ranking';
import { prepareRecommender, type Prediction } from '../core/recommender';
import type { Bucket, EventBody, GameId, GameMeta, LibraryRow, RankEvent, Status, Sublist } from '../core/types';
import { api, ApiError } from './api';
import { makeEvent, mergeEvents, withPlacedBuckets } from './derive';

interface Data {
  events: RankEvent[];
  rows: LibraryRow[];
  games: Map<GameId, GameMeta>;
  fetchedAt: Record<number, string>;
  sublists: Sublist[];
}

export interface Store extends Data {
  state: RankState;
  scoreMap: Map<GameId, number>;
  rowOf: Map<GameId, LibraryRow>;
  /** Predictions for these games. The model is fitted at most once per event log / game data (spec §7.2). */
  predict: (candidates: GameId[]) => Prediction[];
  /** Post events (each gets a fresh UUID) and merge the stored versions into the log. */
  append: (bodies: EventBody[]) => Promise<void>;
  patchLibrary: (id: GameId, patch: { status?: Status; bucket?: Bucket | null; platforms?: string[] }) => Promise<void>;
  /** Fetch or refresh one game's metadata; returns its canonical (root) id. */
  fetchGame: (id: GameId) => Promise<GameId>;
  reload: () => Promise<void>;
  saveSublist: (s: Sublist) => Promise<void>;
  removeSublist: (id: string) => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside <StoreProvider>');
  return store;
}

const EMPTY: Data = { events: [], rows: [], games: new Map(), fetchedAt: {}, sublists: [] };

export function StoreProvider({ children, onUnauthorized }: { children: ReactNode; onUnauthorized: () => void }) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onUnauthorized();
        throw e;
      }
    },
    [onUnauthorized],
  );

  const reload = useCallback(async () => {
    await guard(async () => {
      const [ev, lib, sub] = await Promise.all([api.events(0), api.library(), api.sublists()]);
      setData({
        events: ev.events,
        rows: lib.rows,
        games: new Map(lib.games.map((g) => [g.id, g])),
        fetchedAt: lib.fetchedAt,
        sublists: sub.sublists,
      });
      setLoaded(true);
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [guard]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Another device may have ranked something: pick up new events when the app comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const last = data.events.at(-1)?.seq ?? 0;
      // Through guard, so a 401 sends the user to login; other (network) errors are ignored.
      guard(() => api.events(last))
        .then(({ events }) => {
          if (events.length > 0) setData((d) => ({ ...d, events: mergeEvents(d.events, events), rows: withPlacedBuckets(d.rows, events) }));
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [data.events, guard]);

  const append = useCallback(
    async (bodies: EventBody[]) => {
      const now = new Date();
      const stored = await guard(() => api.postEvents(bodies.map((b) => makeEvent(b, now, crypto.randomUUID()))));
      setData((d) => ({ ...d, events: mergeEvents(d.events, stored.events), rows: withPlacedBuckets(d.rows, stored.events) }));
    },
    [guard],
  );

  const patchLibrary = useCallback<Store['patchLibrary']>(
    async (id, patch) => {
      const { row } = await guard(() => api.putLibrary(id, patch));
      setData((d) => ({ ...d, rows: [...d.rows.filter((r) => r.gameId !== id), row] }));
    },
    [guard],
  );

  const fetchGame = useCallback(
    async (id: GameId) => {
      const res = await guard(() => api.fetchGame(id));
      setData((d) => {
        const games = new Map(d.games);
        games.set(res.rootId, res.meta);
        return { ...d, games, fetchedAt: { ...d.fetchedAt, [res.rootId]: new Date().toISOString() } };
      });
      return res.rootId;
    },
    [guard],
  );

  const saveSublist = useCallback(
    async (s: Sublist) => {
      const { sublist } = await guard(() => api.putSublist(s));
      setData((d) => ({ ...d, sublists: [...d.sublists.filter((x) => x.id !== s.id), sublist] }));
    },
    [guard],
  );

  const removeSublist = useCallback(
    async (id: string) => {
      await guard(() => api.deleteSublist(id));
      setData((d) => ({ ...d, sublists: d.sublists.filter((x) => x.id !== id) }));
    },
    [guard],
  );

  const state = useMemo(() => replay(data.events), [data.events]);
  const scoreMap = useMemo(() => scores(state), [state]);
  const gameList = useMemo(() => [...data.games.values()], [data.games]);
  // Fit the model lazily, once per event log / game data; every screen then reuses it.
  const predict = useMemo(() => {
    let fitted: ((candidates: GameId[]) => Prediction[]) | null = null;
    return (candidates: GameId[]) => {
      fitted ??= prepareRecommender(state, scoreMap, gameList);
      return fitted(candidates);
    };
  }, [state, scoreMap, gameList]);
  const rowOf = useMemo(() => new Map(data.rows.map((r) => [r.gameId, r])), [data.rows]);

  if (error) {
    // Clearing the error (loaded is still false) shows "Loading…" while reload() runs again.
    const retry = () => {
      setError(null);
      void reload();
    };
    return (
      <div>
        <p className="error">Could not load your data: {error}</p>
        <button onClick={retry}>Retry</button>
      </div>
    );
  }
  if (!loaded) return <p className="muted">Loading…</p>;

  const store: Store = { ...data, state, scoreMap, rowOf, predict, append, patchLibrary, fetchGame, reload, saveSublist, removeSublist };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
