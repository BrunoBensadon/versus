// The v1 journey on a phone (spec §11): login → import → triage → rank → search a game → bucket →
// questions → undo → abort and resume after reload → confirm → score shown → backlog pick shows
// reasons → export downloads. One test, because each step builds on the data the previous one made.
// Fixture library (tests/fixtures/steam/owned.json): Skyrim 5000 min, Hades 3000, GTA V 2000,
// Outer Wilds 1200, BioShock 600 + Remastered 300 (merged into one work), GTA V Enhanced 100.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** Answer every question in favour of `choice` until the confirm screen; returns the number asked. */
async function answerUntilConfirm(page: Page, choice: 'pick-new' | 'pick-pivot' = 'pick-new'): Promise<number> {
  let asked = 0;
  for (;;) {
    await expect(page.getByTestId('pick-new').or(page.getByTestId('confirm'))).toBeVisible();
    if (await page.getByTestId('confirm').isVisible()) return asked;
    // The pick buttons stay visible but disabled while the answer saves, so wait for the save to finish
    // (and the buttons to be enabled again, or the confirm screen to replace them) before looking again.
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/events') && r.request().method() === 'POST'),
      page.getByTestId(choice).click(),
    ]);
    await expect(page.locator('[data-testid^="pick-"][disabled]')).toHaveCount(0);
    asked += 1;
  }
}

test('the v1 journey on a phone', async ({ page }) => {
  await test.step('log in', async () => {
    await page.goto('/');
    await page.getByLabel('Passphrase').fill('e2e-passphrase');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'versus' })).toBeVisible();
  });

  await test.step('import the Steam library', async () => {
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Import / refresh Steam library' }).click();
    await expect(page.getByTestId('import-summary')).toContainText('8 owned · 7 found on IGDB · 6 new');
  });

  await test.step('triage, highest playtime first', async () => {
    await page.goto('/#/triage');
    await expect(page.getByTestId('duplicate-hint')).toContainText('Grand Theft Auto V Enhanced'); // spec §8 hint
    const plan: [string, string][] = [
      ['The Elder Scrolls V: Skyrim', 'Loved'],
      ['Hades', 'Loved'],
      ['Grand Theft Auto V', 'Liked'],
      ['Outer Wilds', 'Backlog'],
      ['BioShock', 'Liked'],
      ['Grand Theft Auto V Enhanced', 'Backlog'],
    ];
    for (const [name, button] of plan) {
      await expect(page.getByTestId('triage-name')).toHaveText(name);
      await page.getByRole('button', { name: button, exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Triage done' })).toBeVisible();
  });

  await test.step('Rank 10 places the four triaged games', async () => {
    await page.goto('/#/queue?left=10');
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Rank it' }).click();
      expect(await answerUntilConfirm(page)).toBeLessThanOrEqual(8);
      await page.getByRole('button', { name: '✓ Looks right' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Nothing left to rank' })).toBeVisible();
  });

  let sessionUrl = '';
  await test.step('search a game and start ranking it', async () => {
    await page.goto('/#/search');
    await page.getByLabel('Search games').fill('outer wild');
    await page.getByRole('link', { name: /Outer Wilds/ }).first().click();
    await expect(page.getByTestId('game-name')).toHaveText('Outer Wilds');
    await page.getByRole('button', { name: 'Already played → rank now' }).click();
    await page.getByRole('button', { name: 'Loved', exact: true }).click();
    await expect(page.getByTestId('pick-pivot')).toBeVisible();
    sessionUrl = page.url();
  });

  await test.step('undo brings the same question back', async () => {
    const firstPivot = await page.getByTestId('pick-pivot').innerText();
    await page.getByTestId('pick-pivot').click();
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByTestId('pick-pivot')).toHaveText(firstPivot);
  });

  await test.step('abort and resume after a reload', async () => {
    await page.getByTestId('pick-new').click(); // Outer Wilds beats the first pivot
    await page.reload();
    await page.goto('/');
    await page.getByRole('link', { name: 'Continue ranking Outer Wilds' }).click();
    expect(page.url()).toBe(sessionUrl);
  });

  await test.step('confirm the place and see the score', async () => {
    expect(await answerUntilConfirm(page)).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('confirm')).toContainText('Outer Wilds goes');
    await page.getByRole('button', { name: '✓ Looks right' }).click();
    await expect(page.getByTestId('ranked-score')).toContainText('Loved');
    await expect(page.getByTestId('ranked-score')).toContainText('10.0'); // it beat both other loved games
  });

  await test.step('backlog pick shows a prediction with reasons', async () => {
    await page.goto('/#/pick');
    const row = page.getByTestId('pick-row').filter({ hasText: 'Grand Theft Auto V Enhanced' });
    await expect(row).toContainText('confidence'); // 5 ranked games → predictions exist (low confidence)
    await row.getByRole('link').click();
    await expect(page.getByTestId('prediction')).toBeVisible();
    await expect(page.getByTestId('reasons').locator('li').first()).toBeVisible();
  });

  await test.step('export downloads the whole log', async () => {
    await page.goto('/#/settings');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Everything (JSON)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^versus-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync((await file.path())!, 'utf8')) as { events: unknown[]; library: unknown[] };
    expect(data.events.length).toBeGreaterThan(10);
    expect(data.library).toHaveLength(6);
  });
});
