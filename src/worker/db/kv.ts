// SQL for the small key-value table: IGDB token, last_backup_at, login failure counters.

export async function kvGet(db: D1Database, key: string, nowIso: string): Promise<string | null> {
  const r = await db.prepare('SELECT value, expires_at FROM kv WHERE key = ?').bind(key).first<{ value: string; expires_at: string | null }>();
  if (!r || (r.expires_at !== null && r.expires_at <= nowIso)) return null;
  return r.value;
}

export async function kvPut(db: D1Database, key: string, value: string, expiresAt: string | null = null): Promise<void> {
  await db
    .prepare('INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
    .bind(key, value, expiresAt)
    .run();
}

/**
 * Add 1 to a counter and return the new count, in ONE statement, so concurrent callers can't
 * all read the same old value. A missing key starts at 1 with the given expiry.
 * Callers put the clock hour in the key, so an expired row is never reused (no expiry check here).
 */
export async function kvIncrement(db: D1Database, key: string, expiresAt: string): Promise<number> {
  const r = await db
    .prepare(
      "INSERT INTO kv (key, value, expires_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value",
    )
    .bind(key, expiresAt)
    .first<{ value: string | number }>();
  return Number(r?.value);
}

/** Subtract 1 from a counter made by kvIncrement (does nothing if the key is missing). */
export async function kvDecrement(db: D1Database, key: string): Promise<void> {
  await db.prepare('UPDATE kv SET value = CAST(value AS INTEGER) - 1 WHERE key = ?').bind(key).run();
}

export async function kvDelete(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
}
