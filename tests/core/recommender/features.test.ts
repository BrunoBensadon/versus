import { describe, expect, it } from 'vitest';
import { buildFeatures, columnLabel, vectorize, vocabCoverage } from '../../../src/core/recommender';
import { game } from '../helpers/game';

const tags = (...ids: number[]) => ids.map((tagId, i) => ({ tagId, name: `Tag${tagId}`, weight: 100 * (ids.length - i) }));

describe('buildFeatures', () => {
  it('keeps genres at min-df 1 but keywords only when ≥ 3 ranked games use them', () => {
    const train = [
      game(1, { genres: ['RPG'], keywords: ['roguelite', 'rare'] }),
      game(2, { genres: ['Puzzle'], keywords: ['roguelite'] }),
      game(3, { keywords: ['roguelite'] }),
    ];
    const keys = buildFeatures(train).columns.map((c) => `${c.block}:${c.key}`);
    expect(keys).toContain('genre:rpg');
    expect(keys).toContain('genre:puzzle');
    expect(keys).toContain('keyword:roguelite');
    expect(keys).not.toContain('keyword:rare');
  });

  it('drops stop-listed keywords whatever their case', () => {
    const train = [1, 2, 3].map((id) => game(id, { keywords: ['Steam Achievements', 'digital distribution'] }));
    const blocks = buildFeatures(train).columns.map((c) => c.block);
    expect(blocks).not.toContain('keyword');
  });

  it('always ends with the consensus and has_steam_tags columns', () => {
    const cols = buildFeatures([game(1)]).columns;
    expect(cols.map((c) => c.block)).toEqual(['consensus', 'has_steam_tags']);
  });
});

describe('vectorize', () => {
  it('scales each block to unit length, so many keywords do not outweigh few', () => {
    const train = [1, 2, 3].map((id) => game(id, { genres: ['A', 'B', 'C', 'D'], themes: ['X'] }));
    const space = buildFeatures(train);
    const x = vectorize(space, train[0]);
    const genreCols = space.columns.map((c, i) => (c.block === 'genre' ? x[i] : 0));
    const themeCols = space.columns.map((c, i) => (c.block === 'theme' ? x[i] : 0));
    expect(Math.hypot(...genreCols)).toBeCloseTo(1, 10);
    expect(Math.hypot(...themeCols)).toBeCloseTo(1, 10);
    expect(genreCols.filter((v) => v > 0)[0]).toBeCloseTo(0.5, 10); // 4 genres → 1/√4 each
  });

  it('weights Steam tags by tag weight ÷ the game\'s top weight before normalizing', () => {
    const train = [1, 2, 3].map((id) => game(id, { steamTags: tags(10, 20) }));
    const space = buildFeatures(train);
    const x = vectorize(space, train[0]);
    const t10 = x[space.index.get('steam_tag:10')!];
    const t20 = x[space.index.get('steam_tag:20')!];
    expect(t10 / t20).toBeCloseTo(2, 10); // weights 200 and 100
    expect(x[space.index.get('has_steam_tags:has_steam_tags')!]).toBe(1);
  });

  it('maskSteam zeroes the tag block and has_steam_tags (console-game simulation)', () => {
    const train = [1, 2, 3].map((id) => game(id, { steamTags: tags(10, 20) }));
    const space = buildFeatures(train);
    const x = vectorize(space, train[0], { maskSteam: true });
    expect(x[space.index.get('steam_tag:10')!]).toBe(0);
    expect(x[space.index.get('has_steam_tags:has_steam_tags')!]).toBe(0);
  });

  it('standardizes total rating; a missing rating becomes 0', () => {
    const train = [game(1, { totalRating: 60 }), game(2, { totalRating: 80 }), game(3, { totalRating: null })];
    const space = buildFeatures(train);
    const c = space.index.get('consensus:total_rating')!;
    expect(vectorize(space, train[1])[c]).toBeGreaterThan(0);
    expect(vectorize(space, train[0])[c]).toBeLessThan(0);
    expect(vectorize(space, train[2])[c]).toBe(0);
  });
});

describe('vocabCoverage and labels', () => {
  it('measures the share of a game\'s features that the vocabulary knows', () => {
    const space = buildFeatures([game(1, { genres: ['RPG'] })]);
    expect(vocabCoverage(space, game(9, { genres: ['RPG', 'Puzzle'] }))).toBe(0.5);
    expect(vocabCoverage(space, game(9))).toBe(0);
  });

  it('builds readable labels', () => {
    const space = buildFeatures([1, 2, 3].map((id) => game(id, { steamTags: [{ tagId: 3959, name: 'Roguelite', weight: 9 }] })));
    const col = space.columns[space.index.get('steam_tag:3959')!];
    expect(columnLabel(col)).toBe('Steam tag: Roguelite');
  });
});
