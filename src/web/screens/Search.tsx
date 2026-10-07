// Typeahead search over IGDB (spec §8, R-DATA-1): 250 ms debounce, at least 2 characters.

import { useEffect, useState } from 'react';
import type { GameMeta } from '../../core/types';
import { api } from '../api';
import { GameRow } from '../components';
import { useStore } from '../store';

export function SearchScreen() {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null); // an old error must not linger once there is no search to blame it on
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(q)
        .then((r) => {
          if (!cancelled) {
            setResults(r.results);
            setError(null);
          }
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <section>
      <input
        className="search"
        type="search"
        autoFocus
        placeholder="Search any game…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search games"
      />
      {error ? <p className="error">{error}</p> : null}
      {results.map((g) => (
        <GameRow
          key={g.id}
          id={g.id}
          meta={g}
          right={store.rowOf.has(g.id) ? <span className="tag">in library</span> : null}
        />
      ))}
    </section>
  );
}
