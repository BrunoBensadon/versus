import { describe, expect, it } from 'vitest';
import { attachSteam, normalizeIgdb, steamItemsByAppid, steamTagNames } from '../../../src/core/catalog';
import { fixture, igdbGames } from './fixtures';

const raw = igdbGames();
const ttb = fixture('igdb/time-to-beat.json') as { game_id: number }[];

describe('normalizeIgdb (real Outer Wilds record)', () => {
  const meta = normalizeIgdb(raw.get(11737), ttb.find((t) => t.game_id === 11737));

  it('reads identity, year, type and cover', () => {
    expect(meta.id).toBe(11737);
    expect(meta.name).toBe('Outer Wilds');
    expect(meta.year).toBe(2019);
    expect(meta.gameType).toBe(0);
    expect(meta.coverImageId).toBe('co65ac');
  });

  it('reads the name lists', () => {
    expect(meta.genres).toEqual(['Puzzle', 'Simulator', 'Adventure', 'Indie']);
    expect(meta.modes).toEqual(['Single player']);
    expect(meta.perspectives).toEqual(['First person']);
    expect(meta.collections).toEqual(['Outer Wilds']);
    expect(meta.keywords.length).toBeGreaterThan(0);
  });

  it('keeps only developers (not publishers) and uses platform abbreviations', () => {
    expect(meta.developers).toEqual(['Mobius Digital']);
    expect(meta.platforms).toContain('PC');
    expect(meta.platforms).toContain('Switch');
  });

  it('reads ratings and time-to-beat', () => {
    expect(meta.totalRating).toBeCloseTo(87, 0);
    expect(meta.ttb).toEqual({ hastily: 43200, normally: 68400, completely: 115200, count: 7 });
    expect(meta.steamTags).toBeNull();
  });

  it('reads edition links (Skyrim Anniversary → Special Edition) and the Bundle type', () => {
    const anniversary = normalizeIgdb(raw.get(165192));
    expect(anniversary.gameType).toBe(10);
    expect(anniversary.parentGame).toBe(19457);
    expect(normalizeIgdb(raw.get(334647)).gameType).toBe(3);
  });
});

describe('normalizeIgdb (defensive)', () => {
  it('fills missing fields with empty values', () => {
    const meta = normalizeIgdb({ id: 5 });
    expect(meta.name).toBe('IGDB 5');
    expect(meta.year).toBeNull();
    expect(meta.genres).toEqual([]);
    expect(meta.ratingCount).toBe(0);
    expect(meta.ttb).toBeNull();
  });

  it('accepts game_type as a bare id', () => {
    expect(normalizeIgdb({ id: 5, game_type: 9 }).gameType).toBe(9);
  });

  it('refuses a record without an id', () => {
    expect(() => normalizeIgdb({ name: 'x' })).toThrow(/without an id/);
  });
});

describe('attachSteam (real GetItems + GetTagList)', () => {
  const names = steamTagNames(fixture('steam/tag-list.json'));
  const items = steamItemsByAppid(fixture('steam/get-items.json'));

  it('maps tag ids to names and keeps weights', () => {
    const meta = attachSteam(normalizeIgdb(raw.get(11737)), items.get(753640), names);
    expect(meta.steamTags).toHaveLength(20);
    expect(meta.steamTags![0]).toEqual({ tagId: 3834, name: 'Exploration', weight: 927 });
  });

  it('leaves steamTags null when the item has no tags', () => {
    expect(attachSteam(normalizeIgdb({ id: 1 }), { appid: 1 }, names).steamTags).toBeNull();
  });

  it('knows Steam\'s full tag list', () => {
    expect(names.size).toBeGreaterThan(400);
    expect(names.get(3959)).toBe('Roguelite');
  });
});
