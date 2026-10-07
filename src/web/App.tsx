// The app shell: login gate, bottom navigation, and the hash-route switch.

import { useCallback, useState } from 'react';
import { Footer } from './components';
import { useRoute } from './router';
import { HomeScreen } from './screens/Home';
import { LoginScreen, PrivacyScreen } from './screens/Static';
import { StoreProvider } from './store';

function Screen({ onLogout }: { onLogout: () => void }) {
  const { parts, query } = useRoute();
  const [first, second, third] = parts;
  const id = (raw: string | undefined) => Number(raw);

  if (first === 'privacy') return <PrivacyScreen />;
  return <HomeScreen />;
}

export function App() {
  const route = useRoute();
  // Assume a session exists; the first API call that answers 401 flips this to false.
  const [loggedIn, setLoggedIn] = useState(true);
  const [generation, setGeneration] = useState(0); // remount the store after logging in again

  // Stable, so the store loads once per login (not on every navigation).
  const onUnauthorized = useCallback(() => setLoggedIn(false), []);

  // Logged-out privacy page: same container as the login page, plus a way back to it.
  if (route.parts[0] === 'privacy' && !loggedIn) {
    return (
      <main className="app">
        <PrivacyScreen />
        <p>
          <a href="#/">Back to login</a>
        </p>
        <Footer />
      </main>
    );
  }
  if (!loggedIn) {
    return (
      <main className="app">
        <LoginScreen
          onLogin={() => {
            setLoggedIn(true);
            setGeneration((g) => g + 1);
          }}
        />
        <Footer />
      </main>
    );
  }

  return (
    <main className="app">
      <StoreProvider key={generation} onUnauthorized={onUnauthorized}>
        <div className="content">
          <Screen onLogout={() => setLoggedIn(false)} />
        </div>
        <Footer />
        <nav className="bottom-nav">
          <a href="#/">Home</a>
          <a href="#/ranked">Ranking</a>
          <a href="#/search">Search</a>
          <a href="#/pick">Next</a>
          <a href="#/settings">Settings</a>
        </nav>
      </StoreProvider>
    </main>
  );
}
