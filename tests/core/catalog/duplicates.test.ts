import { describe, expect, it } from 'vitest';
import { duplicateHints, normalizeIgdb, normalizeName } from '../../../src/core/catalog';
import { igdbGames } from './fixtures';

const raw = igdbGames();
const meta = (id: number) => normalizeIgdb(raw.get(id));

describe('normalizeName', () => {
  it('strips punctuation, case, accents and trailing edition words', () => {
    expect(normalizeName('The Elder Scrolls V: Skyrim - Special Edition')).toBe('the elder scrolls v skyrim');
    expect(normalizeName('Grand Theft Auto V Enhanced')).toBe('grand theft auto v');
    expect(normalizeName('Grand Theft Auto V Legacy')).toBe('grand theft auto v');
    expect(normalizeName('Pokémon Legends')).toBe('pokemon legends');
  });

  it('only strips trailing words, and never the whole name', () => {
    expect(normalizeName('Legacy of Kain')).toBe('legacy of kain');
    expect(normalizeName('Definitive')).toBe('definitive');
  });
});

describe('duplicateHints (real records)', () => {
  it('pairs GTA V with GTA V Enhanced (shared franchise, same normalized name)', () => {
    const library = [20, 241, 307, 472, 1020, 11737, 113112, 334647].map(meta);
    expect(duplicateHints(library)).toEqual([[1020, 334647]]);
  });

  it('does not pair Counter-Strike with Counter-Strike: Source', () => {
    expect(duplicateHints([meta(241), meta(307)])).toEqual([]);
  });
});
