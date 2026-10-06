import { defineConfig } from 'vitest/config';

// Unit tests for the pure core (ranking, recommender, catalog). They run in plain Node.
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/boundary.test.ts'],
    environment: 'node',
  },
});
