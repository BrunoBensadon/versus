// The shape of one API route. Each routes/*.ts file exports a list of these; index.ts tries them in order.

import type { Ctx } from './env';

export interface RouteArgs {
  req: Request;
  url: URL;
  ctx: Ctx;
  params: string[]; // the regex capture groups of `path`, e.g. the :id in /api/games/:id
  nowIso: string;
  viaBackupToken: boolean; // true when the caller used the backup bearer token instead of the cookie
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: RegExp;
  run: (args: RouteArgs) => Promise<Response>;
}
