// Test helper: builds an event log the way the server would (ids and seq numbers assigned in order),
// and runs a whole ranking session against an "oracle" that knows the true preference.

import type { Bucket, EventBody, GameId, RankEvent } from '../../../src/core/types';
import { replay, sessionStep } from '../../../src/core/ranking';

export class Log {
  events: RankEvent[] = [];
  private n = 0;

  add(body: EventBody): RankEvent {
    this.n += 1;
    const event = { ...body, id: `e${this.n}`, ts: '2026-10-06T00:00:00.000Z', listId: 'global', seq: this.n } as RankEvent;
    this.events.push(event);
    return event;
  }
}

/**
 * Rank `game` into `bucket`, answering every question with `prefers(game, pivot)`.
 * Returns the number of questions asked.
 */
export function rankWithOracle(
  log: Log,
  game: GameId,
  bucket: Bucket,
  prefers: (a: GameId, b: GameId) => boolean,
  session = `s-${game}-${log.events.length}`,
): number {
  log.add({ type: 'session_started', gameId: game, data: { session, bucket } });
  let questions = 0;
  for (;;) {
    const next = sessionStep(replay(log.events), session);
    if (next === null) throw new Error('session vanished');
    if (next.kind === 'stale') throw new Error('unexpected stale session');
    if (next.kind === 'place') {
      log.add({ type: 'placed', gameId: game, data: { session, bucket, below: next.below } });
      return questions;
    }
    questions += 1;
    const result = prefers(game, next.pivot) ? 'better' : 'worse';
    log.add({ type: 'answer', gameId: game, data: { session, pivot: next.pivot, result } });
  }
}
