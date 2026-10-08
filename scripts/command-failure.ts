// What push-secrets.ts prints when one of its commands fails. Kept in its own file so tests can import
// it: importing push-secrets.ts itself would run the script.

// The three fields of spawnSync's result that say how a command ended.
export interface CommandResult {
  status: number | null; // exit code; null when it never started or was killed
  signal: string | null; // e.g. 'SIGTERM' when it was killed
  error?: Error; // set when the command could not be started at all
}

// Returns null when the command succeeded, otherwise a message that says why it failed, which secrets
// were already sent, and how to get back to a consistent state. It never contains secret values.
export function failureMessage(command: string, result: CommandResult, alreadySent: string[]): string | null {
  let why: string;
  if (result.error) why = `could not start: ${result.error.message}`;
  else if (result.signal) why = `was stopped by signal ${result.signal}`;
  else if (result.status !== 0) why = `failed with exit code ${result.status}`;
  else return null;

  const sent = alreadySent.length > 0 ? `Already sent: ${alreadySent.join(', ')}.` : 'Nothing was sent.';
  return [
    `Failed: ${command} ${why}`,
    sent,
    'Nothing after that was sent. Fix the problem, then run the same command again: it makes a new',
    'SESSION_KEY and BACKUP_TOKEN and sends all of them, so the Worker and the backup repo match again.',
  ].join('\n');
}
