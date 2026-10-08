// The app must fit a 360 px wide phone (plan 5): no screen may scroll sideways, and nothing may spill
// into the side gutters (the page can look fine to scrollWidth while a grid pokes into .app's padding).
// Independent of journey.spec.ts: it imports the Steam library itself (importing again is harmless) and
// makes sure the Loved bucket has a game to compare against, whether or not the journey ran first.
// Playwright runs the files one at a time (workers: 1) in name order, so journey.spec.ts (which needs a
// fresh database) always runs before this file.

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 360, height: 780 } });

/**
 * Fails if the page is wider than the 360 px screen (it would scroll sideways), or if any visible element
 * reaches past the right edge of .app's content box (into its 16 px right padding, the gutter).
 */
async function expectNoSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(() => {
    const app = document.querySelector('main.app')!;
    // Right edge of the content box = the app's right edge minus its right padding (the gutter).
    const limit = app.getBoundingClientRect().right - parseFloat(getComputedStyle(app).paddingRight);
    return [...app.querySelectorAll('*')]
      // The bottom nav is full-bleed on purpose (fixed to the screen edges), so it is left out.
      .filter((el) => !el.closest('.bottom-nav'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > limit + 0.5;
      })
      .map((el) => `${el.tagName}.${el.className} right=${Math.round(el.getBoundingClientRect().right)} limit=${limit}`)
      .slice(0, 5);
  });
  expect(overflow).toEqual([]);
}

/** Search a game and open its page. */
async function openGame(page: Page, query: string, name: string): Promise<void> {
  await page.goto('/#/search');
  await page.getByLabel('Search games').fill(query);
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await expect(page.getByTestId('game-name')).toHaveText(name);
}

test('every screen fits a 360 px phone', async ({ page }) => {
  // Covers come from IGDB's CDN; tests never touch the real IGDB, so serve a local image instead.
  await page.route('https://images.igdb.com/**', (route) => route.fulfill({ path: 'src/web/public/icons/icon-192.png' }));

  await test.step('log in and import the Steam library', async () => {
    await page.goto('/');
    await page.getByLabel('Passphrase').fill('e2e-passphrase');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'versus' })).toBeVisible();
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Import / refresh Steam library' }).click();
    await expect(page.getByTestId('import-summary')).toBeVisible();
  });

  await test.step('make sure Hades is ranked in Loved', async () => {
    await openGame(page, 'hades', 'Hades');
    const rankNow = page.getByRole('button', { name: 'Already played → rank now' });
    await expect(rankNow.or(page.getByTestId('ranked-score'))).toBeVisible();
    if (await rankNow.isVisible()) {
      // Fresh database: Hades is the first Loved game, so there's no question, just the confirm screen.
      await rankNow.click();
      await page.getByRole('button', { name: 'Loved', exact: true }).click();
      await expect(page.getByTestId('confirm')).toBeVisible();
      await page.getByRole('button', { name: '✓ Looks right' }).click();
      await expect(page.getByTestId('ranked-score')).toContainText('Loved');
    }
  });

  await test.step('home', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'versus' })).toBeVisible();
    await expectNoSideScroll(page);
  });

  await test.step('ranked list with the filters open', async () => {
    await page.goto('/#/ranked');
    await expect(page.getByRole('heading', { name: 'My ranking' })).toBeVisible();
    await page.getByText('Filter', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save as sub-list' })).toBeVisible();
    await expectNoSideScroll(page);
  });

  await test.step('what to play next', async () => {
    await page.goto('/#/pick');
    await expect(page.getByRole('heading', { name: 'What to play next' })).toBeVisible();
    await expectNoSideScroll(page);
  });

  await test.step('a head-to-head question', async () => {
    // Outer Wilds is either unranked (fresh database) or already ranked (after the journey): either way,
    // choosing Loved asks it against Hades or the other Loved games.
    await openGame(page, 'outer wild', 'Outer Wilds');
    await page
      .getByRole('button', { name: 'Already played → rank now' })
      .or(page.getByRole('link', { name: 'Re-rank / change bucket' }))
      .click();
    await page.getByRole('button', { name: 'Loved', exact: true }).click();
    await expect(page.getByTestId('pick-new')).toBeVisible();
    await expectNoSideScroll(page);
  });
});
