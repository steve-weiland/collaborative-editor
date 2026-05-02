import { test, expect, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket as NodeWebSocket } from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const PORT = 3100; // matches playwright.config.ts

/* ─── helpers ────────────────────────────────────────────────────────────── */

async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('#status-dot')?.classList.contains('connected') ?? false,
  );
}

/**
 * Open a Node-side Y.Doc + WebsocketProvider against the running server.
 * `room` selects the y-websocket room (server URL path → docName); each
 * test uses a unique room so its server-side Y.Doc is independent of
 * other tests'. The Y.Text key inside the doc is always `'doc'` to match
 * the page-bound default.
 */
function openYjsClient(room: string = 'doc', port: number = PORT): {
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider;
  synced: Promise<void>;
} {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('doc');
  const provider = new WebsocketProvider(`ws://localhost:${port}/ws`, room, ydoc, {
    // y-websocket uses the global WebSocket by default; in Node we hand it `ws`.
    WebSocketPolyfill: NodeWebSocket as unknown as typeof WebSocket,
  });
  const synced = new Promise<void>((res) => {
    if (provider.synced) return res();
    provider.once('sync', (isSynced: boolean) => {
      if (isSynced) res();
    });
  });
  return { ydoc, ytext, provider, synced };
}

/** Wait for `predicate` to return truthy, polling every 20 ms; throws on timeout. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
  label = 'condition',
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/* ─── V2 baseline (browser-driven) ───────────────────────────────────────── */

// Page-driven tests use Playwright's `fill()` which selects-and-replaces the
// textarea content, so they're self-clearing — no `Y.Text` reset helper needed.

test.describe('V2 baseline', () => {
  test('single tab: typing a value is reflected in the textarea', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.locator('#editor').fill('hello world');
    expect(await page.locator('#editor').inputValue()).toBe('hello world');
  });

  test('two tabs converge after one types', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto('/');
      await b.goto('/');
      await waitConnected(a);
      await waitConnected(b);

      await a.locator('#editor').fill('from A');
      await expect(b.locator('#editor')).toHaveValue('from A');

      await b.locator('#editor').fill('from B');
      await expect(a.locator('#editor')).toHaveValue('from B');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

/* ─── F1 — concurrent edits CONVERGE under V2 CRDT ───────────────────────── */

/**
 * V1 baseline: same test asserted finalA !== finalB ("each tab ends up with
 * the OTHER tab's text"). V2 inverts: both tabs converge AND the merged
 * result contains characters from both inputs. Same protocol-level test
 * (raw Yjs clients), opposite assertion — that's the V1 → V2 portfolio diff.
 */
test.describe('F1 — concurrent edits (V2 CRDT)', () => {
  test('two clients editing concurrently converge to a merged document', async () => {
    // Unique room isolates this test from the page-bound 'doc' room.
    const a = openYjsClient('f1-test');
    const b = openYjsClient('f1-test');
    try {
      await Promise.all([a.synced, b.synced]);

      // Both insert at offset 0 concurrently. Yjs's text CRDT resolves the
      // concurrent inserts deterministically (one ordering wins, but BOTH
      // sets of characters land — no LWW, no loss).
      a.ytext.insert(0, 'AAAAA');
      b.ytext.insert(0, 'BBBBB');

      await waitFor(
        () => a.ytext.toString() === b.ytext.toString() && a.ytext.length === 10,
        5_000,
        'CRDT convergence',
      );

      const finalA = a.ytext.toString();
      const finalB = b.ytext.toString();
      expect(finalA).toBe(finalB);
      expect(finalA).toContain('AAAAA');
      expect(finalA).toContain('BBBBB');
      expect(finalA.length).toBe(10);
    } finally {
      a.provider.destroy();
      b.provider.destroy();
    }
  });
});

/* ─── F2 — offline edits reconcile on reconnect ──────────────────────────── */

test.describe('F2 — offline edit reconciles on reconnect', () => {
  test('a client that edits while offline pushes its ops on reconnect', async () => {
    const a = openYjsClient('f2-test');
    const b = openYjsClient('f2-test');
    try {
      await Promise.all([a.synced, b.synced]);

      // Online edit lands on both.
      a.ytext.insert(0, 'online ');
      await waitFor(() => b.ytext.toString() === 'online ', 5_000, 'initial sync to B');

      // Take A offline.
      a.provider.disconnect();
      await waitFor(() => a.provider.wsconnected === false, 2_000, 'A disconnected');

      // A keeps editing locally; B doesn't see it yet.
      a.ytext.insert(a.ytext.length, 'offline edit');
      expect(a.ytext.toString()).toBe('online offline edit');
      // Brief check that B is unchanged while A is offline.
      await new Promise((r) => setTimeout(r, 100));
      expect(b.ytext.toString()).toBe('online ');

      // Reconnect — provider ships the buffered ops, both sides converge.
      a.provider.connect();
      await waitFor(
        () => b.ytext.toString() === 'online offline edit',
        5_000,
        'B catches up after A reconnects',
      );
      expect(a.ytext.toString()).toBe(b.ytext.toString());
    } finally {
      a.provider.destroy();
      b.provider.destroy();
    }
  });
});

/* ─── F3 — cursor preserved during remote edits ──────────────────────────── */

test.describe('F3 — cursor preserved under remote ops', () => {
  test('inserting before the user\'s cursor does not jump the cursor to position 0', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);

    // Seed via the page; wait for the server to settle.
    await page.locator('#editor').fill('hello');
    await page.waitForFunction(
      () => (document.getElementById('editor') as HTMLTextAreaElement).value === 'hello',
    );

    // Park the cursor at the end of 'hello' (offset 5).
    await page.evaluate(() => {
      const t = document.getElementById('editor') as HTMLTextAreaElement;
      t.focus();
      t.setSelectionRange(5, 5);
    });

    // From a Node-side Yjs client, insert 'XXX' at offset 0.
    const remote = openYjsClient();
    try {
      await remote.synced;
      await waitFor(
        () => remote.ytext.toString() === 'hello',
        5_000,
        'remote sees seeded text',
      );
      remote.ytext.insert(0, 'XXX');

      // Wait for the remote op to land in the page's textarea.
      await page.waitForFunction(
        () => (document.getElementById('editor') as HTMLTextAreaElement).value === 'XXXhello',
      );

      // Cursor should have shifted from 5 to 8 (5 + 3 inserted before it),
      // NOT reset to 0 (which is the V1 F3 bug).
      const cursor = await page.evaluate(
        () => (document.getElementById('editor') as HTMLTextAreaElement).selectionStart,
      );
      expect(cursor).toBe(8);
    } finally {
      remote.provider.destroy();
    }
  });
});

/* ─── F4 — server restart preserves the document ─────────────────────────── */

/**
 * Spawns its own server on a different port + persist dir, separate from
 * Playwright's webServer (which lives on PORT 3100). This lets us actually
 * kill + respawn the server within a single test.
 */
test.describe('F4 — persists across server restart', () => {
  const F4_PORT = 3101;
  const F4_PERSIST = './data/yjs-test-f4';

  function startServer(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', ['dist/server/server/index.js'], {
        cwd: REPO_ROOT,
        env: { ...process.env, PORT: String(F4_PORT), PERSIST_DIR: F4_PERSIST },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let resolved = false;
      const onOut = (chunk: Buffer): void => {
        if (chunk.toString().includes(`listening on :${F4_PORT}`)) {
          resolved = true;
          proc.stdout?.off('data', onOut);
          resolve(proc);
        }
      };
      proc.stdout?.on('data', onOut);
      proc.on('exit', (code) => {
        if (!resolved) reject(new Error(`server exited with code ${code} before starting`));
      });
      setTimeout(() => {
        if (!resolved) reject(new Error('server did not announce listening within 10s'));
      }, 10_000);
    });
  }

  function killServer(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve();
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 3_000);
    });
  }

  test.beforeEach(() => {
    rmSync(path.join(REPO_ROOT, F4_PERSIST), { recursive: true, force: true });
  });

  test('a doc written before kill survives a respawn', async () => {
    let server = await startServer();
    try {
      // Write the doc, wait for the server to ack.
      let c = openYjsClient('doc', F4_PORT);
      await c.synced;
      c.ytext.insert(0, 'preserved');
      await new Promise((r) => setTimeout(r, 200)); // let the server flush to leveldb
      c.provider.destroy();

      await killServer(server);

      // Respawn with the same PERSIST_DIR; new client should see the doc.
      server = await startServer();
      c = openYjsClient('doc', F4_PORT);
      await c.synced;
      await waitFor(
        () => c.ytext.toString() === 'preserved',
        5_000,
        'doc loaded from leveldb after restart',
      );
      expect(c.ytext.toString()).toBe('preserved');
      c.provider.destroy();
    } finally {
      await killServer(server);
    }
  });
});

/* ─── F8 — multi-doc isolation (v2.1.0) ──────────────────────────────────── */

test.describe('F8 — multi-doc isolation', () => {
  test('different rooms hold independent documents', async () => {
    const a = openYjsClient('f8-room-a');
    const b = openYjsClient('f8-room-b');
    try {
      await Promise.all([a.synced, b.synced]);

      a.ytext.insert(0, 'in room A');
      // Settle: nothing should arrive at B because B is on a different room.
      await new Promise((r) => setTimeout(r, 250));

      expect(a.ytext.toString()).toBe('in room A');
      expect(b.ytext.toString()).toBe('');

      b.ytext.insert(0, 'in room B');
      await new Promise((r) => setTimeout(r, 250));

      expect(a.ytext.toString()).toBe('in room A');
      expect(b.ytext.toString()).toBe('in room B');
    } finally {
      a.provider.destroy();
      b.provider.destroy();
    }
  });
});

/* ─── F9 — awareness exposes other clients' cursors (v2.1.0) ─────────────── */

test.describe('F9 — awareness presence', () => {
  test('client B sees client A\'s name + cursor over the awareness channel', async () => {
    const a = openYjsClient('f9-room');
    const b = openYjsClient('f9-room');
    try {
      await Promise.all([a.synced, b.synced]);

      a.provider.awareness.setLocalStateField('name', 'A');
      a.provider.awareness.setLocalStateField('color', '#abcdef');
      a.provider.awareness.setLocalStateField('cursor', 42);

      // Wait until B's awareness map contains A.
      await waitFor(
        () => {
          for (const [clientId, state] of b.provider.awareness.getStates()) {
            if (clientId === b.provider.awareness.clientID) continue;
            const s = state as { name?: string; cursor?: number };
            if (s.name === 'A' && s.cursor === 42) return true;
          }
          return false;
        },
        5_000,
        'B sees A in awareness',
      );

      // Spot-check: B doesn't see anyone but A.
      const others: Array<{ name?: string; cursor?: number }> = [];
      for (const [clientId, state] of b.provider.awareness.getStates()) {
        if (clientId === b.provider.awareness.clientID) continue;
        others.push(state as { name?: string; cursor?: number });
      }
      expect(others).toHaveLength(1);
      expect(others[0].name).toBe('A');
      expect(others[0].cursor).toBe(42);
    } finally {
      a.provider.destroy();
      b.provider.destroy();
    }
  });
});

/* ─── F10 — local undo respects remote ops (v2.1.0) ──────────────────────── */

test.describe('F10 — Y.UndoManager scoped to local origin', () => {
  test('A undoing only reverts A\'s edits — B\'s ops survive', async () => {
    const a = openYjsClient('f10-room');
    const b = openYjsClient('f10-room');
    try {
      await Promise.all([a.synced, b.synced]);

      // A's UndoManager only tracks transactions tagged with this origin.
      // B's edits arrive via the provider with a different origin, so the
      // UndoManager doesn't see them.
      const aLocalOrigin = Symbol('A-local');
      const um = new Y.UndoManager(a.ytext, { trackedOrigins: new Set([aLocalOrigin]) });
      try {
        a.ydoc.transact(() => a.ytext.insert(0, 'AAA'), aLocalOrigin);
        await waitFor(() => b.ytext.toString() === 'AAA', 5_000, 'B sees AAA');

        b.ytext.insert(0, 'BBB');
        await waitFor(() => a.ytext.toString() === 'BBBAAA', 5_000, 'A sees BBBAAA');

        // A undoes — AAA reverts; BBB survives because it's a remote op
        // and not on the UndoManager's local stack.
        um.undo();

        expect(a.ytext.toString()).toBe('BBB');
        await waitFor(() => b.ytext.toString() === 'BBB', 5_000, 'B sees BBB after undo');
      } finally {
        um.destroy();
      }
    } finally {
      a.provider.destroy();
      b.provider.destroy();
    }
  });
});

/* ─── F11 — IndexedDB survives page reload (v2.1.0) ──────────────────────── */

test.describe('F11 — IndexedDB persists across page reload', () => {
  test('typed text survives a reload', async ({ page }) => {
    // Unique per-run hash so we don't trip over stale IndexedDB from earlier
    // runs in the same Playwright browser context.
    const room = `f11-${Date.now()}`;
    await page.goto(`/#${room}`);
    await waitConnected(page);

    const text = 'preserved across reload';
    await page.locator('#editor').fill(text);
    await page.waitForFunction(
      (t) => (document.getElementById('editor') as HTMLTextAreaElement).value === t,
      text,
    );
    // Let IndexeddbPersistence flush.
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForFunction(
      (t) => (document.getElementById('editor') as HTMLTextAreaElement).value === t,
      text,
      { timeout: 5_000 },
    );
  });
});

/* ─── F12 — visual cursor overlay rendered for remote client (v2.2.0) ────── */

test.describe('F12 — visual cursor overlay', () => {
  test('B renders a .cursor-overlay element keyed by A\'s clientID', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const room = `f12-${Date.now()}`;
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto(`/#${room}`);
      await b.goto(`/#${room}`);
      await waitConnected(a);
      await waitConnected(b);

      // Seed text and park A's cursor at offset 5 (end of 'hello').
      await a.locator('#editor').fill('hello world');
      await b.waitForFunction(
        () => (document.getElementById('editor') as HTMLTextAreaElement).value === 'hello world',
      );
      await a.evaluate(() => {
        const t = document.getElementById('editor') as HTMLTextAreaElement;
        t.focus();
        t.setSelectionRange(5, 5);
      });

      // A's clientID is the awareness key the overlay element is tagged with.
      const aClientId = await a.evaluate(() => {
        const w = window as unknown as { __yProvider: { awareness: { clientID: number } } };
        return w.__yProvider.awareness.clientID;
      });

      const overlay = b.locator(`.cursor-overlay[data-client-id="${aClientId}"]`);
      await expect(overlay).toBeVisible({ timeout: 5_000 });

      // It must be positioned somewhere — not stuck at top:0/left:0.
      const pos = await overlay.evaluate((el: HTMLElement) => ({
        left: parseFloat(el.style.left),
        top: parseFloat(el.style.top),
        height: parseFloat(el.style.height),
      }));
      expect(pos.left).toBeGreaterThan(0);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.height).toBeGreaterThan(0);

      // The label has the remote client's name.
      const labelText = await overlay.locator('.cursor-overlay-label').innerText();
      expect(labelText.length).toBeGreaterThan(0);

      // And A does NOT render an overlay for its own cursor (DOC-136).
      const ownOverlay = a.locator(`.cursor-overlay[data-client-id="${aClientId}"]`);
      await expect(ownOverlay).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

/* ─── F13 — user-supplied name persists across reload (v2.2.0) ───────────── */

test.describe('F13 — user-supplied name', () => {
  test('typing a name pushes it on awareness, persists, and survives reload', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const room = `f13-${Date.now()}`;
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto(`/#${room}`);
      await b.goto(`/#${room}`);
      await waitConnected(a);
      await waitConnected(b);

      const customName = `Custom-${Date.now() % 100000}`;
      await a.locator('#name-input').fill(customName);

      // B sees A's custom name on the awareness channel.
      await b.waitForFunction(
        (expected) => {
          const aw = (window as unknown as {
            __yProvider?: { awareness: { clientID: number; getStates(): Map<number, unknown> } };
          }).__yProvider?.awareness;
          if (!aw) return false;
          for (const [clientId, state] of aw.getStates()) {
            if (clientId === aw.clientID) continue;
            if ((state as { name?: string }).name === expected) return true;
          }
          return false;
        },
        customName,
        { timeout: 5_000 },
      );

      // Reload A; localStorage rehydrates the input.
      await a.reload();
      await waitConnected(a);
      await expect(a.locator('#name-input')).toHaveValue(customName);

      // And the new (post-reload) A still publishes the name on awareness.
      await b.waitForFunction(
        (expected) => {
          const aw = (window as unknown as {
            __yProvider?: { awareness: { clientID: number; getStates(): Map<number, unknown> } };
          }).__yProvider?.awareness;
          if (!aw) return false;
          for (const [clientId, state] of aw.getStates()) {
            if (clientId === aw.clientID) continue;
            if ((state as { name?: string }).name === expected) return true;
          }
          return false;
        },
        customName,
        { timeout: 5_000 },
      );
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
