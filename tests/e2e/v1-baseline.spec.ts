import { test, expect, type Page } from '@playwright/test';

async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('#status-dot')?.classList.contains('connected') ?? false,
  );
}

test.describe('V1 baseline', () => {
  test('single tab: typing a value is reflected in the textarea', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.locator('#editor').fill('hello world');
    expect(await page.locator('#editor').inputValue()).toBe('hello world');
  });

  test('two tabs, one at a time: edits propagate via broadcast', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto('/');
      await b.goto('/');
      await waitConnected(a);
      await waitConnected(b);

      // A types alone first; B should see it.
      await a.locator('#editor').fill('from A');
      await expect(b.locator('#editor')).toHaveValue('from A');

      // Then B types; A should see it.
      await b.locator('#editor').fill('from B');
      await expect(a.locator('#editor')).toHaveValue('from B');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

/**
 * F1 — concurrent edits diverge under last-write-wins.
 *
 * V1 baseline: this test PASSES by asserting the bug. After two tabs fill
 * concurrently, each tab ends up with the OTHER tab's text, because each
 * tab's input event fired with its own pre-broadcast value and the server
 * processed them in some order, sending the loser's text back to the
 * winner via broadcast. They diverge until someone makes a fresh edit.
 *
 * V2 (CRDT) will INVERT: both tabs converge to a merged text containing
 * the characters from both tabs.
 */
test.describe('F1 — concurrent edits (V1 LWW)', () => {
  test('two tabs typing simultaneously diverge', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto('/');
      await b.goto('/');
      await waitConnected(a);
      await waitConnected(b);

      // Concurrent fills. Both pages dispatch an `input` event with their
      // local textarea value before either has seen the other's broadcast.
      await Promise.all([
        a.locator('#editor').fill('AAAAA'),
        b.locator('#editor').fill('BBBBB'),
      ]);

      // Let any in-flight broadcasts settle.
      await a.waitForTimeout(500);

      const finalA = await a.locator('#editor').inputValue();
      const finalB = await b.locator('#editor').inputValue();

      // V1 LWW: both ended up with the OTHER tab's text → they diverge.
      // (Deterministic for this two-message sequence: each page sees the
      //  remote broadcast after its own local fill, and the broadcast
      //  payload is the other tab's text.)
      expect(finalA).not.toEqual(finalB);
      expect([finalA, finalB].sort()).toEqual(['AAAAA', 'BBBBB']);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
