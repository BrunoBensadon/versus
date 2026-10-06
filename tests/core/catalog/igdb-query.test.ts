import { describe, expect, it } from 'vitest';
import { gamesByIdQuery, searchQuery, steamExternalQuery } from '../../../src/core/catalog';

describe('IGDB query text', () => {
  it('filters to main games, expansions, remakes and remasters, and strips quotes', () => {
    const q = searchQuery('say "hi"\\');
    expect(q).toContain('search "say  hi"');
    expect(q).toContain('where game_type = (0,4,8,9,10) & version_parent = null');
  });

  it('builds id and Steam-mapping queries', () => {
    expect(gamesByIdQuery([20, 34293])).toMatch(/^fields name,.*; where id = \(20,34293\); limit 500;$/);
    expect(steamExternalQuery([7670, 409710])).toBe(
      'fields uid,game; where external_game_source = 1 & uid = ("7670","409710"); limit 500;',
    );
  });
});
