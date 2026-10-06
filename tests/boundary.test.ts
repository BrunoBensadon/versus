// Boundary rule (spec §3): nothing under src/core may import from worker/ or web/, import any
// package, or use fetch, the DOM or D1. This keeps the core testable and portable.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve(__dirname, '../src/core');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN_CODE: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bdocument\./, 'the DOM (document)'],
  [/\bwindow\./, 'the DOM (window)'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bD1Database\b/, 'D1'],
];

describe('src/core boundary', () => {
  const files = tsFiles(CORE);

  it('finds the core files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(CORE, file);
    it(`${name} imports only relative files inside src/core`, () => {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec.startsWith('.'), `${name}: package import "${spec}"`).toBe(true);
        const target = resolve(dirname(file), spec);
        expect(target.startsWith(CORE), `${name}: "${spec}" leaves src/core`).toBe(true);
      }
    });

    it(`${name} uses no fetch, DOM or D1`, () => {
      const source = readFileSync(file, 'utf8');
      for (const [pattern, what] of FORBIDDEN_CODE) {
        expect(pattern.test(source), `${name} uses ${what}`).toBe(false);
      }
    });
  }
});
