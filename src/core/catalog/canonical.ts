// Canonical work (spec §8, decision D15): editions, remasters, ports and expanded games collapse
// into the game they come from. Remakes (8) and standalone expansions (4) stay separate games.

import type { GameId, GameMeta } from '../types';

export const GAME_TYPE = {
  main: 0,
  bundle: 3,
  standaloneExpansion: 4,
  remake: 8,
  remaster: 9,
  expandedGame: 10,
  port: 11,
} as const;

const FOLLOW_PARENT: ReadonlySet<number> = new Set([GAME_TYPE.remaster, GAME_TYPE.expandedGame, GAME_TYPE.port]);

/**
 * The longest edition/remaster chain canonicalWork() follows (spec §8). The Worker fetches this
 * many levels of ancestors before calling it, so the walk never stops at a game it doesn't know.
 */
export const MAX_CHAIN_STEPS = 5;

/**
 * Walk up the edition/remaster chain, at most MAX_CHAIN_STEPS steps. `lookup` must already know the
 * ancestors (the Worker fetches them first); a missing ancestor ends the walk where it is.
 */
export function canonicalWork(id: GameId, lookup: (id: GameId) => GameMeta | undefined): GameId {
  let current = id;
  for (let steps = 0; steps < MAX_CHAIN_STEPS; steps++) {
    const g = lookup(current);
    if (!g) return current;
    if (g.versionParent !== null) current = g.versionParent; // editions
    else if (FOLLOW_PARENT.has(g.gameType) && g.parentGame !== null) current = g.parentGame;
    else return current;
  }
  return current;
}

/** Ids of the games canonicalWork() would visit next, so the Worker can fetch them before calling it. */
export function parentIds(g: GameMeta): GameId[] {
  if (g.versionParent !== null) return [g.versionParent];
  if (FOLLOW_PARENT.has(g.gameType) && g.parentGame !== null) return [g.parentGame];
  return [];
}
