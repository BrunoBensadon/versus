import { defineConfig } from 'vitest/config';

// Unit tests for the pure core (ranking, recommender, catalog) and the web app's pure helpers.
// They run in plain Node.
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/web/**/*.test.ts', 'tests/boundary.test.ts'],
    environment: 'node',
  },
});
