// Hash routes (#/game/123?x=1): no server routing needed, and every path loads the same index.html.

import { useEffect, useState } from 'react';

export interface Route {
  parts: string[]; // '#/game/123' → ['game', '123']
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter((p) => p.length > 0), query: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Go to a route, e.g. navigate('/game/123'). `replace` avoids a Back-button entry. */
export function navigate(path: string, replace = false): void {
  const hash = `#${path}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}
