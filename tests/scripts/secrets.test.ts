// Checks for the secrets tooling: what push-secrets says when a command fails, and the runbook's
// "change only the passphrase" one-liner. Only fake values are used; the real .env is never read.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { failureMessage } from '../../scripts/command-failure';

describe('failureMessage (push-secrets)', () => {
  const sent = ['Worker APP_PASSPHRASE', 'Worker TWITCH_CLIENT_ID'];

  it('returns null when the command succeeded', () => {
    expect(failureMessage('gh secret set X', { status: 0, signal: null }, sent)).toBeNull();
  });

  it('names the exit code, what was already sent, and that a full re-run is safe', () => {
    const msg = failureMessage('npx wrangler secret put STEAM_API_KEY', { status: 2, signal: null }, sent);
    expect(msg).toContain('npx wrangler secret put STEAM_API_KEY');
    expect(msg).toContain('exit code 2');
    expect(msg).toContain('Worker APP_PASSPHRASE, Worker TWITCH_CLIENT_ID');
    expect(msg).toContain('run the same command again');
  });

  it('names the error when the command could not start at all', () => {
    // spawnSync reports "could not start" through `error`, with status null.
    const msg = failureMessage('gh secret set X', { status: null, signal: null, error: new Error('spawn gh ENOENT') }, []);
    expect(msg).toContain('spawn gh ENOENT');
    expect(msg).toContain('Nothing was sent');
  });

  it('names the signal when the command was killed', () => {
    const msg = failureMessage('gh secret set X', { status: null, signal: 'SIGTERM' }, sent);
    expect(msg).toContain('SIGTERM');
  });
});

describe("runbook: change only the passphrase", () => {
  // The test runs the exact `node -e "..."` part of the runbook's one-liner, so the docs can't drift.
  const runbook = readFileSync(resolve(__dirname, '../../docs/runbook.md'), 'utf8');
  const snippet = /node -e "([^"]*loadEnvFile[^"]*)"/.exec(runbook)?.[1];

  const dir = mkdtempSync(join(tmpdir(), 'versus-env-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Child environment without APP_PASSPHRASE, so only the fake .env can supply it.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.APP_PASSPHRASE;

  function readPassphrase(envFile: string): { status: number | null; stdout: string } {
    writeFileSync(join(dir, '.env'), envFile);
    const result = spawnSync(process.execPath, ['-e', snippet!], { cwd: dir, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout };
  }

  it('the runbook contains the snippet', () => {
    expect(snippet).toBeDefined();
  });

  it('outputs exactly the passphrase for LF, CRLF and quoted lines (no \\r, no quotes, no newline)', () => {
    for (const envFile of [
      'OTHER=1\nAPP_PASSPHRASE=fake-pass-123\n',
      'OTHER=1\r\nAPP_PASSPHRASE=fake-pass-123\r\n',
      'OTHER=1\r\nAPP_PASSPHRASE="fake-pass-123"\r\n',
    ]) {
      expect(readPassphrase(envFile)).toEqual({ status: 0, stdout: 'fake-pass-123' });
    }
  });

  it('fails (so wrangler never runs) when .env has no APP_PASSPHRASE', () => {
    const { status, stdout } = readPassphrase('OTHER=1\n');
    expect(status).not.toBe(0);
    expect(stdout).toBe('');
  });
});
