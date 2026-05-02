import { test, expect, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../../src/shared/messages';

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
 * V1 baseline: this test PASSES by asserting the bug. Two concurrent edits
 * over the wire result in each client seeing only the OTHER client's text
 * — the server doesn't echo back to a sender, and broadcasts capture the
 * server's state at the moment of processing. With LWW, that state is
 * "the most recently received text from anyone", so:
 *
 *   - A sends AAAAA   → server state=AAAAA → broadcast 'AAAAA' to {B}
 *   - B sends BBBBB   → server state=BBBBB → broadcast 'BBBBB' to {A}
 *
 * A only ever hears 'BBBBB'; B only ever hears 'AAAAA'. They diverge,
 * with neither client's local state containing both inputs.
 *
 * V2 (CRDT) will INVERT: the broadcasts both contain a merged document with
 * characters from both clients, and both clients converge to the same text.
 *
 * This test uses raw `ws` clients rather than Playwright `page.fill()`. The
 * earlier browser-driven version was flaky: Playwright's `fill()` runs in
 * two phases (selectAll, then insertText) and an incoming broadcast between
 * those phases programmatically set `textarea.value`, moved the cursor, and
 * caused insertText to append rather than replace — producing a fluke
 * "AAAAABBBBB" merge that's a Playwright+DOM artifact, not LWW behaviour.
 * F1 is a server-protocol claim, so the test exercises the protocol
 * directly.
 */
test.describe('F1 — concurrent edits (V1 LWW)', () => {
  const PORT = 3100; // matches playwright.config.ts

  /** Helper: open a WS client and wait for the initial 'doc' message. */
  async function open(): Promise<{ ws: WebSocket; messages: string[] }> {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

    // CRITICAL: register the 'message' listener BEFORE awaiting 'open'.
    // When the upgrade response and the server's initial doc frame arrive
    // in the same TCP read, ws emits 'open' and 'message' synchronously
    // in the same tick. Awaiting 'open' first queues the resolution as a
    // microtask; by the time the microtask runs and the test registers a
    // 'message' listener, the synchronous emit has already happened with
    // no listener and the frame is gone. Registering up front fixes it.
    const messages: string[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === 'doc') messages.push(msg.text);
    });

    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });

    // Initial doc message may already be in `messages` if it arrived in
    // the same TCP read as the upgrade response; otherwise it lands shortly.
    const startedAt = Date.now();
    while (messages.length === 0) {
      if (Date.now() - startedAt > 5_000) {
        throw new Error('timed out waiting for initial doc message');
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return { ws, messages };
  }

  test('two clients editing concurrently end up with each other\'s text', async () => {
    const { ws: a, messages: aMessages } = await open();
    const { ws: b, messages: bMessages } = await open();
    try {
      // Reset capture: discard the initial empty-doc snapshot from connect.
      aMessages.length = 0;
      bMessages.length = 0;

      // Concurrent edits. Each client sends its own text. The server
      // processes them sequentially, broadcasting each to the OTHER
      // client. We don't care which order the server picks.
      a.send(JSON.stringify({ type: 'edit', text: 'AAAAA' }));
      b.send(JSON.stringify({ type: 'edit', text: 'BBBBB' }));

      // Wait until both clients have heard one broadcast each.
      const startedAt = Date.now();
      while (aMessages.length < 1 || bMessages.length < 1) {
        if (Date.now() - startedAt > 5_000) {
          throw new Error(
            `timed out waiting for broadcasts: aMessages=${aMessages.length} bMessages=${bMessages.length}`,
          );
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      // Brief settle window in case anything else lands.
      await new Promise((r) => setTimeout(r, 100));

      const finalA = aMessages.at(-1);
      const finalB = bMessages.at(-1);

      // V1 LWW (the "bug"): A only ever hears B's text, B only ever hears
      // A's. The two clients have diverged — neither has a document that
      // contains both inputs.
      expect(finalA).toBe('BBBBB');
      expect(finalB).toBe('AAAAA');
      expect(finalA).not.toBe(finalB);
    } finally {
      a.close();
      b.close();
    }
  });
});
