// One step of binary insertion (spec §6.1).
// Given a bucket's order and the answers so far, decide what happens next: ask another
// question, place the game, or report that the list changed under this session.
// Undo and resume need no special code: the caller just passes fewer or the same answers.

import type { AnswerResult, GameId } from '../types';

export interface Answer {
  pivot: GameId;
  result: AnswerResult;
}

export type Step =
  | { kind: 'ask'; pivot: GameId }
  | { kind: 'place'; below: GameId | null } // null = top of the bucket
  | { kind: 'stale' }; // an answer's pivot is no longer where we expect it → restart the session

/**
 * @param list    the bucket order, best first, WITHOUT the game being ranked
 * @param answers the session's answers, oldest first, undone answers already removed
 */
export function step(list: readonly GameId[], answers: readonly Answer[]): Step {
  // Candidate insertion indexes are lo..hi (inclusive). Index i means "between list[i-1] and list[i]".
  let lo = 0;
  let hi = list.length;
  for (const a of answers) {
    if (lo >= hi) return { kind: 'stale' }; // more answers than this list needs: it must have shrunk
    const mid = Math.floor((lo + hi) / 2);
    if (list[mid] !== a.pivot) return { kind: 'stale' };
    if (a.result === 'tie') return { kind: 'place', below: list[mid] }; // "too close" (spec D7)
    if (a.result === 'better') hi = mid;
    else lo = mid + 1;
  }
  if (lo === hi) return { kind: 'place', below: lo > 0 ? list[lo - 1] : null };
  return { kind: 'ask', pivot: list[Math.floor((lo + hi) / 2)] };
}
