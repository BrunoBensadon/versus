// Small checks shared by the request-body parsers in routes/*.ts. Anything malformed → 400.

import { HttpError } from './http';

export type Json = Record<string, unknown>;

export function fail(message: string): never {
  throw new HttpError(400, message);
}

export function isObject(x: unknown): x is Json {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isGameId(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0;
}

export function isText(x: unknown, max = 64): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= max;
}
