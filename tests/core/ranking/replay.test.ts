import { describe, expect, it } from 'vitest';
import { replay, sessionStep } from '../../../src/core/ranking';
import { Log } from '../helpers/log';

describe('replay', () => {
  it('builds lists from placed events, below = null meaning top', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
    log.add({ type: 'placed', gameId: 3, data: { session: 'c', bucket: 'loved', below: null } });
    expect(replay(log.events).lists).toEqual({ loved: [3, 1, 2], liked: [], disliked: [] });
  });

  it('orders by seq, not by array position', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 1 } });
    const reversed = [...log.events].reverse();
    expect(replay(reversed).lists.liked).toEqual([1, 2]);
  });

  it('ignores events from other lists (own-criterion lists are Later)', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    const other = { ...log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: null } }), listId: 'coop' };
    expect(replay([log.events[0], other]).lists.liked).toEqual([1]);
  });

  it('re-placing a game moves it (re-rank and bucket change)', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 1 } });
    log.add({ type: 'placed', gameId: 1, data: { session: 'c', bucket: 'loved', below: null } });
    expect(replay(log.events).lists).toEqual({ loved: [1], liked: [2], disliked: [] });
  });

  it('a game keeps its old place while a re-rank session is open', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 1 } });
    log.add({ type: 'session_started', gameId: 1, data: { session: 'r', bucket: 'liked' } });
    const state = replay(log.events);
    expect(state.lists.liked).toEqual([1, 2]);
    // The session's list excludes the game itself: only game 2 → the first question is about 2.
    expect(sessionStep(state, 'r')).toEqual({ kind: 'ask', pivot: 2 });
  });

  it('unranked removes the game from the order', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'unranked', gameId: 1, data: {} });
    expect(replay(log.events).lists.liked).toEqual([]);
  });

  it('keeps open sessions with their non-voided answers; placed and cancelled close them', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'session_started', gameId: 2, data: { session: 'open', bucket: 'liked' } });
    log.add({ type: 'answer', gameId: 2, data: { session: 'open', pivot: 1, result: 'worse' } });
    log.add({ type: 'session_started', gameId: 3, data: { session: 'gone', bucket: 'liked' } });
    log.add({ type: 'session_cancelled', gameId: 3, data: { session: 'gone' } });
    const state = replay(log.events);
    expect([...state.openSessions.keys()]).toEqual(['open']);
    expect(state.openSessions.get('open')?.answers).toEqual([{ pivot: 1, result: 'worse' }]);
  });

  it('undo voids the latest non-voided answer, one per undo', () => {
    const log = new Log();
    for (const id of [1, 2, 3]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'liked', below: id === 1 ? null : id - 1 } });
    log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'liked' } });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 2, result: 'worse' } });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'better' } });
    log.add({ type: 'undo', gameId: 9, data: { session: 's' } });
    expect(replay(log.events).openSessions.get('s')?.answers).toEqual([{ pivot: 2, result: 'worse' }]);
    log.add({ type: 'undo', gameId: 9, data: { session: 's' } });
    log.add({ type: 'undo', gameId: 9, data: { session: 's' } }); // extra undo with nothing left: no-op
    expect(replay(log.events).openSessions.get('s')?.answers).toEqual([]);
  });

  it('undo then re-answer gives the same step as answering directly', () => {
    const direct = new Log();
    const viaUndo = new Log();
    for (const log of [direct, viaUndo]) {
      for (const id of [1, 2, 3, 4, 5]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'loved', below: id === 1 ? null : id - 1 } });
      log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'loved' } });
    }
    direct.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'better' } });
    viaUndo.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'worse' } });
    viaUndo.add({ type: 'undo', gameId: 9, data: { session: 's' } });
    viaUndo.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 3, result: 'better' } });
    expect(sessionStep(replay(viaUndo.events), 's')).toEqual(sessionStep(replay(direct.events), 's'));
  });

  it('detects a stale session when another placement changed the bucket', () => {
    const log = new Log();
    for (const id of [1, 2, 3]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'liked', below: id === 1 ? null : id - 1 } });
    log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'liked' } });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 2, result: 'better' } });
    // Meanwhile, on another device, game 8 lands at the bottom: [1, 2, 3, 8].
    // The middle (index 2) is now game 3, not game 2, so the old answer no longer fits.
    log.add({ type: 'placed', gameId: 8, data: { session: 'other', bucket: 'liked', below: 3 } });
    expect(sessionStep(replay(log.events), 's')).toEqual({ kind: 'stale' });
  });

  it('places at the bottom and warns when `below` is missing from the bucket', () => {
    const log = new Log();
    log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
    log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: 77 } });
    const state = replay(log.events);
    expect(state.lists.liked).toEqual([1, 2]);
    expect(state.warnings).toHaveLength(1);
  });

  describe('merge', () => {
    it('into takes from\'s slot when into was unranked', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
      log.add({ type: 'placed', gameId: 3, data: { session: 'c', bucket: 'loved', below: 2 } });
      log.add({ type: 'merged', gameId: 2, data: { into: 50 } });
      const state = replay(log.events);
      expect(state.lists.loved).toEqual([1, 50, 3]);
      expect(state.aliases.get(2)).toBe(50);
    });

    it('from disappears when into is already ranked', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
      log.add({ type: 'merged', gameId: 2, data: { into: 1 } });
      expect(replay(log.events).lists.loved).toEqual([1]);
    });

    it('later events about the merged game apply to the survivor', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'loved', below: null } });
      log.add({ type: 'merged', gameId: 2, data: { into: 50 } });
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'loved', below: 1 } });
      expect(replay(log.events).lists.loved).toEqual([1, 50]);
    });

    it('unmerge: from comes back unranked, into keeps its slot', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 2, data: { session: 'b', bucket: 'liked', below: null } });
      log.add({ type: 'merged', gameId: 2, data: { into: 50 } });
      log.add({ type: 'unmerged', gameId: 2, data: { into: 50 } });
      const state = replay(log.events);
      expect(state.lists.liked).toEqual([50]);
      expect(state.aliases.size).toBe(0);
    });

    it('ignores a merge of a game into itself', () => {
      const log = new Log();
      log.add({ type: 'placed', gameId: 1, data: { session: 'a', bucket: 'liked', below: null } });
      log.add({ type: 'merged', gameId: 1, data: { into: 1 } });
      const state = replay(log.events);
      expect(state.lists.liked).toEqual([1]);
      expect(state.warnings).toHaveLength(1);
    });
  });
});
