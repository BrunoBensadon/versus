// Settings: Steam import, export (JSON + CSV), backup age, logout (spec §8, §10, R-LIB-3).

import { useEffect, useState } from 'react';
import { api, type ImportSummary } from '../api';
import { backupAgeDays, rankedListCsv } from '../derive';
import { useStore } from '../store';

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const store = useStore();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null | undefined>(undefined);
  // True when the status request itself failed (different from "no backup recorded").
  const [statusFailed, setStatusFailed] = useState(false);

  useEffect(() => {
    api.status().then((s) => setLastBackupAt(s.lastBackupAt)).catch(() => setStatusFailed(true));
  }, []);

  async function logout() {
    setError(null);
    try {
      await api.logout();
    } catch (e) {
      // Do not call onLogout(): if the server logout failed the session cookie is still valid,
      // so showing the login screen would pretend we are logged out when we are not.
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    onLogout();
  }

  async function importSteam() {
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.importSteam());
      await store.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    const csv = rankedListCsv(store.state, store.scoreMap, store.games, store.rowOf);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `versus-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const age = lastBackupAt === undefined ? undefined : backupAgeDays(lastBackupAt, new Date());
  const backupOld = !statusFailed && (age === null || (age !== undefined && age > 3));

  return (
    <section>
      <h2>Settings</h2>

      <div className="card">
        <h3>Steam</h3>
        <button className="primary" disabled={busy} onClick={importSteam}>{busy ? 'Importing…' : 'Import / refresh Steam library'}</button>
        {summary ? (
          <p data-testid="import-summary">
            {summary.owned} owned · {summary.mapped} found on IGDB · {summary.added} new · {summary.updated} updated
            {summary.unmapped.length > 0 ? <span className="muted small"> · not found: {summary.unmapped.map((u) => u.name).join(', ')}</span> : null}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h3>Export</h3>
        <div className="row-buttons">
          <a className="button" href="/api/export" download>Everything (JSON)</a>
          <button onClick={downloadCsv}>Ranked list (CSV)</button>
        </div>
        <p className={backupOld ? 'error small' : 'muted small'} data-testid="backup-age">
          {statusFailed ? 'Could not check backups.' : age === undefined ? 'Checking backups…' : age === null ? 'No nightly backup recorded yet.' : `Last nightly backup: ${age} day${age === 1 ? '' : 's'} ago.`}
        </p>
      </div>

      <div className="card">
        <button onClick={logout}>Log out</button>
      </div>
    </section>
  );
}
