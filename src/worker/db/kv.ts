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

export async function kvDelete(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
}
