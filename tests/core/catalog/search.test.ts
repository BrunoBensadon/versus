import { describe, expect, it } from 'vitest';
import { normalizeIgdb, rerankSearch } from '../../../src/core/catalog';
import { fixture } from './fixtures';

const hits = (path: string) => (fixture(path) as unknown[]).map((r) => normalizeIgdb(r));

describe('rerankSearch (real IGDB search results)', () => {
  it('"hades" → Supergiant\'s Hades first, Hades II above the obscure namesakes', () => {
    const results = hits('igdb/search-hades.json');
    expect(results[0].id).not.toBe(113112); // IGDB's own order is wrong here
    const ranked = rerankSearch(results, 'hades');
    expect(ranked[0].id).toBe(113112);
    expect(ranked.findIndex((g) => g.id === 228525)).toBeLessThan(ranked.findIndex((g) => g.id === 80529));
  });

  it('"outer wild" → Outer Wilds stays first', () => {
    expect(rerankSearch(hits('igdb/search-outer-wild.json'), 'outer wild')[0].id).toBe(11737);
  });

  it('keeps IGDB order between equally popular games', () => {
    const a = normalizeIgdb({ id: 1 });
    const b = normalizeIgdb({ id: 2 });
    expect(rerankSearch([a, b], 'x').map((g) => g.id)).toEqual([1, 2]);
  });
});
