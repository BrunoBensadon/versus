// Calls to IGDB, Twitch and Steam. Retries "429 Too Many Requests" twice with backoff (spec §8).
// Error messages name the service, never the URL: Steam puts the API key in the query string.

import type { Ctx } from './env';
import { HttpError } from './http';

/** `allow`: non-2xx statuses returned to the caller instead of thrown (IGDB uses it for 401). */
export async function fetchUpstream(
  ctx: Ctx,
  label: string,
  url: string,
  init: RequestInit = {},
  allow: number[] = [],
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await ctx.deps.fetch(url, init);
    } catch {
      throw new HttpError(502, `${label}: network error`);
    }
    if (res.status === 429 && attempt < 2) {
      await ctx.deps.sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok && !allow.includes(res.status)) throw new HttpError(502, `${label}: HTTP ${res.status}`);
    return res;
  }
}
