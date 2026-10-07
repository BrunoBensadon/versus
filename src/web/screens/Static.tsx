// Screens without data: login and the privacy statement (Steam's terms ask for one, spec §8).

import { useState } from 'react';
import { api, ApiError } from '../api';

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.login(passphrase);
          onLogin();
        } catch (err) {
          setError(err instanceof ApiError && err.status === 401 ? 'Wrong passphrase.' : err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>versus</h1>
      <input type="password" autoComplete="current-password" placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label="Passphrase" />
      <button className="primary" disabled={busy || passphrase.length === 0}>Log in</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

export function PrivacyScreen() {
  return (
    <section className="prose">
      <h2>Privacy</h2>
      <p>versus is a personal, single-user app. It is not offered to anyone else.</p>
      <p>
        It reads the owner's Steam library (owned games and playtime) through the Steam Web API, and game metadata from
        IGDB. That data, the owner's rankings and library are stored in the owner's Cloudflare D1 database and in a
        private GitHub backup repository. Nothing is shared, sold or sent anywhere else.
      </p>
      <p>Game data: IGDB.com. Steam data via the Steam Web API. Not affiliated with Valve or IGDB.</p>
    </section>
  );
}
