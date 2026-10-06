// Order derivation (spec §6.2): the ranked order is a pure function of the event log.
// Only `placed`, `unranked`, `merged` and `unmerged` move games. Answers are kept as evidence
// and to resume open sessions, but they never reorder anything by themselves.

import type { Bucket, GameId, RankEvent } from '../types';
import { step, type Answer, type Step } from './step';

export interface OpenSession {
  id: string;
  game: GameId;
  bucket: Bucket;
  answers: Answer[]; // undone answers already removed
}

export interface RankState {
  lists: Record<Bucket, GameId[]>; // best first; the canonical order
  openSessions: Map<string, OpenSession>;
  aliases: Map<GameId, GameId>; // merged-from → into
  warnings: string[]; // defensive fixes made while replaying (a pure function can't log)
}

/** Follow merge aliases to the surviving game. The hop limit protects against a cycle. */
export function resolve(aliases: Map<GameId, GameId>, id: GameId): GameId {
  let current = id;
  for (let hops = 0; hops < 10; hops++) {
    const next = aliases.get(current);
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

/** Where a game sits, or null if it isn't ranked. */
export function positionOf(state: Pick<RankState, 'lists'>, id: GameId): { bucket: Bucket; index: number } | null {
  for (const bucket of ['loved', 'liked', 'disliked'] as const) {
    const index = state.lists[bucket].indexOf(id);
    if (index !== -1) return { bucket, index };
  }
  return null;
}

/** All ranked games, best first: loved, then liked, then disliked. */
export function globalOrder(state: Pick<RankState, 'lists'>): GameId[] {
  return [...state.lists.loved, ...state.lists.liked, ...state.lists.disliked];
}

/** The list a session inserts into: its bucket's order without the game itself (re-rank case). */
export function sessionList(state: RankState, session: OpenSession): GameId[] {
  return state.lists[session.bucket].filter((id) => id !== session.game);
}

/** What the ranking screen should show next for an open session; null if the session isn't open. */
export function sessionStep(state: RankState, sessionId: string): Step | null {
  const session = state.openSessions.get(sessionId);
  if (!session) return null;
  return step(sessionList(state, session), session.answers);
}

interface SessionDraft {
  id: string;
  game: GameId;
  bucket: Bucket;
  answers: { pivot: GameId; result: Answer['result']; voided: boolean }[];
}

function removeEverywhere(lists: Record<Bucket, GameId[]>, id: GameId): void {
  for (const bucket of ['loved', 'liked', 'disliked'] as const) {
    lists[bucket] = lists[bucket].filter((x) => x !== id);
  }
}

export function replay(events: readonly RankEvent[]): RankState {
  const lists: Record<Bucket, GameId[]> = { loved: [], liked: [], disliked: [] };
  const sessions = new Map<string, SessionDraft>();
  const aliases = new Map<GameId, GameId>();
  const warnings: string[] = [];

  // Own-criterion sub-lists (list_id ≠ 'global') are a Later feature; ignore their events.
  const ordered = events.filter((e) => e.listId === 'global').sort((a, b) => a.seq - b.seq);

  for (const e of ordered) {
    switch (e.type) {
      case 'session_started':
        sessions.set(e.data.session, {
          id: e.data.session,
          game: resolve(aliases, e.gameId),
          bucket: e.data.bucket,
          answers: [],
        });
        break;
      case 'answer':
        sessions.get(e.data.session)?.answers.push({ pivot: e.data.pivot, result: e.data.result, voided: false });
        break;
      case 'undo': {
        const answers = sessions.get(e.data.session)?.answers ?? [];
        for (let i = answers.length - 1; i >= 0; i--) {
          if (!answers[i].voided) {
            answers[i].voided = true;
            break;
          }
        }
        break;
      }
      case 'session_cancelled':
        sessions.delete(e.data.session);
        break;
      case 'placed': {
        const game = resolve(aliases, e.gameId);
        removeEverywhere(lists, game);
        const list = lists[e.data.bucket];
        const below = e.data.below === null ? null : resolve(aliases, e.data.below);
        let index = 0;
        if (below !== null) {
          const at = list.indexOf(below);
          if (at === -1) {
            warnings.push(`seq ${e.seq}: game ${below} is not in ${e.data.bucket}; placed ${game} at the bottom`);
            index = list.length;
          } else {
            index = at + 1;
          }
        }
        list.splice(index, 0, game);
        sessions.delete(e.data.session);
        break;
      }
      case 'unranked':
        removeEverywhere(lists, resolve(aliases, e.gameId));
        break;
      case 'merged': {
        // Use the raw id: resolving it would follow an older merge of the same game.
        const from = e.gameId;
        const into = resolve(aliases, e.data.into);
        if (from === into) {
          warnings.push(`seq ${e.seq}: game ${from} merged into itself; ignored`);
          break;
        }
        const fromPos = positionOf({ lists }, from);
        aliases.set(from, into);
        if (fromPos && !positionOf({ lists }, into)) {
          lists[fromPos.bucket][fromPos.index] = into; // into takes from's slot
        } else {
          removeEverywhere(lists, from);
        }
        break;
      }
      case 'unmerged':
        // `from` comes back unranked; `into` keeps its slot.
        aliases.delete(e.gameId);
        break;
    }
  }

  const openSessions = new Map<string, OpenSession>();
  for (const s of sessions.values()) {
    openSessions.set(s.id, {
      id: s.id,
      game: resolve(aliases, s.game),
      bucket: s.bucket,
      answers: s.answers
        .filter((a) => !a.voided)
        .map((a) => ({ pivot: resolve(aliases, a.pivot), result: a.result })),
    });
  }
  return { lists, openSessions, aliases, warnings };
}
