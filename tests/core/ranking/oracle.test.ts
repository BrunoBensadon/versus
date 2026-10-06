// Property test: with a perfect oracle (every answer correct), insertion must produce exactly the
// true order inside each bucket, for many random libraries.

import { describe, expect, it } from 'vitest';
import { replay, sessionStep } from '../../../src/core/ranking';
import { seededRandom, shuffled } from '../../../src/core/random';
import type { Bucket } from '../../../src/core/types';
import { Log, rankWithOracle } from '../helpers/log';

describe('perfect oracle', () => {
  it('produces exactly sorted buckets for random libraries', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = seededRandom(seed);
      const n = 5 + Math.floor(rand() * 60);
      const utility = new Map<number, number>();
      for (let id = 1; id <= n; id++) utility.set(id, rand());
      // Bucket by utility: top 30% loved, bottom 25% disliked (the simulation's shares).
      const bucketOf = (id: number): Bucket => {
        const u = utility.get(id)!;
        return u > 0.7 ? 'loved' : u < 0.25 ? 'disliked' : 'liked';
      };
      const log = new Log();
      for (const id of shuffled([...utility.keys()], rand)) {
        rankWithOracle(log, id, bucketOf(id), (a, b) => utility.get(a)! > utility.get(b)!);
      }
      const state = replay(log.events);
      for (const bucket of ['loved', 'liked', 'disliked'] as const) {
        const expected = [...utility.keys()]
          .filter((id) => bucketOf(id) === bucket)
          .sort((a, b) => utility.get(b)! - utility.get(a)!);
        expect(state.lists[bucket]).toEqual(expected);
      }
      expect(state.openSessions.size).toBe(0);
      expect(state.warnings).toEqual([]);
    }
  });

  it('replay after every action equals the live state the session loop expects', () => {
    // Spec §11: replay(log) must equal the live state after every action. The app keeps no state
    // besides the log, so "live state" here is what the session loop knows at each moment: which
    // games are placed and in what order, and how many answers the open session holds. We track
    // that by hand and compare it with a fresh replay after every event we append.
    const log = new Log();
    const rand = seededRandom(7);
    const utility = new Map<number, number>();
    for (let id = 1; id <= 15; id++) utility.set(id, rand());
    let expectedLiked: number[] = []; // the order we expect, best first

    // Replay the log so far and check it against the live state. Returns the replayed state.
    const check = (session: string | null, answers: number) => {
      const before = JSON.stringify(log.events);
      const state = replay(log.events);
      expect(JSON.stringify(log.events)).toBe(before); // replay must not change the log it reads
      expect(state.lists).toEqual({ loved: [], liked: expectedLiked, disliked: [] });
      expect(state.warnings).toEqual([]);
      if (session === null) expect(state.openSessions.size).toBe(0);
      else expect(state.openSessions.get(session)?.answers.length).toBe(answers);
      return state;
    };

    for (const game of utility.keys()) {
      const session = `s${game}`;
      log.add({ type: 'session_started', gameId: game, data: { session, bucket: 'liked' } });
      let answers = 0;
      let undoneOnce = false;
      for (;;) {
        const next = sessionStep(check(session, answers), session);
        if (next === null || next.kind === 'stale') throw new Error(`unexpected step: ${JSON.stringify(next)}`);
        if (next.kind === 'place') {
          log.add({ type: 'placed', gameId: game, data: { session, bucket: 'liked', below: next.below } });
          // Live state after placing: the game sits directly under `below` (on top when it's null).
          const at = next.below === null ? 0 : expectedLiked.indexOf(next.below) + 1;
          expectedLiked = [...expectedLiked.slice(0, at), game, ...expectedLiked.slice(at)];
          check(null, 0);
          break;
        }
        const result = utility.get(game)! > utility.get(next.pivot)! ? 'better' : 'worse';
        log.add({ type: 'answer', gameId: game, data: { session, pivot: next.pivot, result } });
        answers += 1;
        // Once per game, undo the first answer and check the session really lost it.
        if (answers === 1 && !undoneOnce) {
          check(session, answers);
          log.add({ type: 'undo', gameId: game, data: { session } });
          answers -= 1;
          undoneOnce = true;
        }
      }
    }
    // The finished list is also the true order (the oracle never lies).
    expect(expectedLiked).toEqual([...utility.keys()].sort((a, b) => utility.get(b)! - utility.get(a)!));
  });

  it('resume: a session reopened from the log continues where it stopped', () => {
    const log = new Log();
    for (const id of [1, 2, 3, 4, 5, 6, 7]) log.add({ type: 'placed', gameId: id, data: { session: `p${id}`, bucket: 'liked', below: id === 1 ? null : id - 1 } });
    log.add({ type: 'session_started', gameId: 9, data: { session: 's', bucket: 'liked' } });
    const first = sessionStep(replay(log.events), 's');
    expect(first).toEqual({ kind: 'ask', pivot: 4 });
    log.add({ type: 'answer', gameId: 9, data: { session: 's', pivot: 4, result: 'better' } });
    // "Close the app": nothing else happens. A new replay (another device, a reload) resumes.
    expect(sessionStep(replay(log.events), 's')).toEqual({ kind: 'ask', pivot: 2 });
  });
});
