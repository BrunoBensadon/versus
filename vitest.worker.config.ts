import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Worker tests run inside Cloudflare's local Workers runtime with a real local D1 (spec §11).
// Each test FILE gets a fresh database; tests inside one file share it.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Fake secrets for tests only. The Steam key looks like a real one so redaction is tested.
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_PASSPHRASE: 'test-passphrase',
            SESSION_KEY: 'test-session-key',
            BACKUP_TOKEN: 'test-backup-token',
            TWITCH_CLIENT_ID: 'test-twitch-client',
            TWITCH_CLIENT_SECRET: 'test-twitch-secret',
            STEAM_API_KEY: 'TESTSTEAMKEY0123456789ABCDEF',
            STEAM_ID64: '76561190000000000',
          },
        },
      }),
    ],
    test: {
      include: ['tests/worker/**/*.test.ts'],
      setupFiles: ['./tests/worker/apply-migrations.ts'],
    },
  };
});
