import { defineConfig } from 'vitest/config';

// Unit tests for the pure core (ranking, recommender, catalog), the web app's pure helpers and the
// command-line scripts. They run in plain Node.
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/web/**/*.test.ts', 'tests/scripts/**/*.test.ts', 'tests/boundary.test.ts'],
    environment: 'node',
  },
});
