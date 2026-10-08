// Typed calls to the Worker API (spec §4). Same origin, so the session cookie goes along automatically.

import type { GameMeta, LibraryRow, NewEvent, RankEvent, Status, Bucket, Sublist } from '../core/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface LibraryResponse {
  rows: LibraryRow[];
  games: GameMeta[];
  fetchedAt: Record<number, string>;
}

export interface ImportSummary {
  owned: number;
  mapped: number;
  added: number;
  updated: number;
  unmapped: { appid: number; name: string }[];
  hint?: string; // set when Steam returned no games (private profile?)
}

export const api = {
  login: (passphrase: string) => request<{ ok: true }>('POST', '/api/login', { passphrase }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  events: (since = 0) => request<{ events: RankEvent[] }>('GET', `/api/events?since=${since}`),
  postEvents: (events: NewEvent[]) => request<{ events: RankEvent[] }>('POST', '/api/events', { events }),
  library: () => request<LibraryResponse>('GET', '/api/library'),
  putLibrary: (id: number, patch: { status?: Status; bucket?: Bucket | null; platforms?: string[] }) =>
    request<{ row: LibraryRow }>('PUT', `/api/library/${id}`, patch),
  search: (q: string) => request<{ results: GameMeta[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  fetchGame: (id: number) => request<{ requestedId: number; rootId: number; meta: GameMeta }>('POST', `/api/games/${id}`),
  importSteam: () => request<ImportSummary>('POST', '/api/import/steam'),
  status: () => request<{ lastBackupAt: string | null; eventCount: number }>('GET', '/api/status'),
  sublists: () => request<{ sublists: Sublist[] }>('GET', '/api/sublists'),
  putSublist: (s: Sublist) => request<{ sublist: Sublist }>('PUT', `/api/sublists/${encodeURIComponent(s.id)}`, s),
  deleteSublist: (id: string) => request<{ ok: true }>('DELETE', `/api/sublists/${encodeURIComponent(id)}`),
};
