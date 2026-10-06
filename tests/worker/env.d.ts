// Tells TypeScript what `env` from "cloudflare:workers" contains inside the Worker tests.
import type { D1Migration } from 'cloudflare:test';
import type { Env as AppEnv } from '../../src/worker/env';

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
