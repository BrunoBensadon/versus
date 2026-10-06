import { describe, expect, it } from 'vitest';
import { canonicalWork, normalizeIgdb, parentIds } from '../../../src/core/catalog';
import type { GameMeta } from '../../../src/core/types';
import { igdbGames } from './fixtures';

const metas = new Map<number, GameMeta>([...igdbGames().values()].map((r) => {
  const m = normalizeIgdb(r);
  return [m.id, m];
}));
const lookup = (id: number) => metas.get(id);

describe('canonicalWork (real IGDB links)', () => {
  it('BioShock Remastered → BioShock', () => {
    expect(canonicalWork(34293, lookup)).toBe(20);
  });

  it('Skyrim Anniversary → Special Edition → Skyrim (2-step chain)', () => {
    expect(canonicalWork(165192, lookup)).toBe(472);
  });

  it('Counter-Strike: Source is a remake and stays separate', () => {
    expect(canonicalWork(307, lookup)).toBe(307);
  });

  it('a main game is its own root; an unknown id is returned unchanged', () => {
    expect(canonicalWork(11737, lookup)).toBe(11737);
    expect(canonicalWork(999999, lookup)).toBe(999999);
  });

  it('GTA V Enhanced (Bundle, no parent link) stays separate: duplicate hints catch it instead', () => {
    expect(canonicalWork(334647, lookup)).toBe(334647);
  });

  it('stops after 5 steps even on a cycle', () => {
    const a = { ...metas.get(20)!, id: 1, versionParent: 2 };
    const b = { ...metas.get(20)!, id: 2, versionParent: 1 };
    const cyc = new Map([[1, a], [2, b]]);
    expect([1, 2]).toContain(canonicalWork(1, (id) => cyc.get(id)));
  });
});

describe('parentIds', () => {
  it('names the ancestor canonicalWork would visit next', () => {
    expect(parentIds(metas.get(165192)!)).toEqual([19457]);
    expect(parentIds(metas.get(307)!)).toEqual([]); // remake: not followed
  });
});
