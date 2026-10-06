// IGDB query text (APICalypse). Pure strings, shared by the Worker (src/worker/igdb.ts) and the
// fixture capture script, so the test fixtures always have exactly the shape production fetches.

/** Fields for a full game record; normalizeIgdb() reads exactly these. */
export const GAME_FIELDS = [
  'name', 'first_release_date', 'game_type', 'cover.image_id',
  'genres.name', 'themes.name', 'keywords.name', 'game_modes.name', 'player_perspectives.name',
  'collections.name', 'franchises.name',
  'involved_companies.developer', 'involved_companies.company.name',
  'platforms.abbreviation', 'platforms.name',
  'total_rating', 'rating_count', 'version_parent', 'parent_game',
].join(',');

/** Fields for typeahead results: enough for a result row (cover, year) and the rerank. */
export const SEARCH_FIELDS = 'name,first_release_date,game_type,cover.image_id,rating_count,total_rating,version_parent,parent_game';

/** Main games, standalone expansions, remakes, remasters and expanded games; never editions (spec §8). */
export function searchQuery(text: string): string {
  const clean = text.replace(/["\\]/g, ' ').trim();
  return `search "${clean}"; fields ${SEARCH_FIELDS}; where game_type = (0,4,8,9,10) & version_parent = null; limit 20;`;
}

export function gamesByIdQuery(ids: number[]): string {
  return `fields ${GAME_FIELDS}; where id = (${ids.join(',')}); limit 500;`;
}

/** external_game_source 1 = Steam. uid is the Steam appid as a string. */
export function steamExternalQuery(appids: number[]): string {
  return `fields uid,game; where external_game_source = 1 & uid = (${appids.map((a) => `"${a}"`).join(',')}); limit 500;`;
}

export function steamUidForGameQuery(gameId: number): string {
  return `fields uid,game; where external_game_source = 1 & game = ${gameId}; limit 10;`;
}

export function timeToBeatQuery(ids: number[]): string {
  return `fields game_id,hastily,normally,completely,count; where game_id = (${ids.join(',')}); limit 500;`;
}

// --- Steam store request ---------------------------------------------------------------------
// Not an IGDB query, but it belongs with them: the fixture capture script and the Worker must send
// exactly the same request, so the captured fixtures have the shape production fetches.

/**
 * The `input_json` value for Steam's IStoreBrowseService/GetItems: the store items for these appids,
 * each with up to 20 weighted user tags.
 */
export function steamItemsInput(appids: number[]): string {
  return JSON.stringify({
    ids: appids.map((appid) => ({ appid })),
    context: { language: 'english', country_code: 'US' },
    data_request: { include_tag_count: 20 },
  });
}
