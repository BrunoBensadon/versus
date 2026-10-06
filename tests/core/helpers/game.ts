// Test helper: a GameMeta with every field filled, so tests only spell out what matters to them.
import type { GameMeta } from '../../../src/core/types';

export function game(id: number, overrides: Partial<GameMeta> = {}): GameMeta {
  return {
    id,
    name: `Game ${id}`,
    year: 2020,
    gameType: 0,
    coverImageId: null,
    genres: [],
    themes: [],
    keywords: [],
    modes: [],
    perspectives: [],
    collections: [],
    franchises: [],
    developers: [],
    platforms: [],
    totalRating: null,
    ratingCount: 0,
    steamTags: null,
    ttb: null,
    versionParent: null,
    parentGame: null,
    ...overrides,
  };
}
