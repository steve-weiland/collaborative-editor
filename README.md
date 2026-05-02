# Real-Time Collaborative Editor

WebSocket-driven shared text editor in TypeScript, built to walk the V1 → V2
evolution: a deliberately-broken **last-write-wins** baseline replaced in V2
by a **CRDT** (Yjs) with **operation-based diff sync**, **leveldb
persistence**, and **reconnect-with-state-sync** via the y-websocket
provider.

| | |
|--|--|
| **Spec** | [`spec.md`](./spec.md) — RFC-2119 requirements; V1 → V2 → v2.1.0 evolution |
| **Status** | `v2.1.0` released. V1 failure modes F1-F5 addressed in v2.0.0; v2.1.0 stacks **multi-doc routing**, **awareness presence**, **`Y.UndoManager`**, and **y-indexeddb offline-first** on top, locked in by feature tests F8-F11. |
| **Stack** | Node.js 20 + TypeScript + Yjs + y-websocket + y-leveldb + y-indexeddb + Vite + vanilla TS frontend |

---

## v2.1.0 in 30 seconds

```
Page A's Y.Doc ─┐                              ┌─> Page B's Y.Doc
   │            │  y-websocket binary (ops)    │            │
   │ y-indexeddb├─> Server's Y.Doc(<room>) <───┤y-indexeddb │
   │     │      │       │                      │     │      │
   ▼     ▼      │       │ y-leveldb            │     ▼      ▼
 IDB:<room>    │       ▼                      │   IDB:<room>
                │   ./data/yjs/<room>/         │
                └──────────────────────────────┘
                  awareness channel: name + color + cursor
```

- **Multi-doc routing** — `/ws/<room>` on the WebSocket; `/#<room>` on the
  page. Each room is an independent `Y.Doc` on the server, with its own
  leveldb namespace. Bare `/ws` defaults to room `'doc'`.
- **Awareness presence** — each client publishes `{ name, color, cursor }`
  on the y-websocket awareness channel; the footer lists every other
  client's name + color + cursor offset.
- **Undo/redo** — `Y.UndoManager` scoped to local ops only via
  `trackedOrigins`; Ctrl/Cmd+Z never undoes someone else's edits.
- **Offline-first** — `IndexeddbPersistence` mirrors each room into
  IndexedDB; a page reload shows the doc immediately, even if the server
  is unreachable.

(All v2.0.0 mechanics — Yjs CRDT, y-websocket binary protocol, y-leveldb,
`Y.RelativePosition` cursor preservation — still apply unchanged.)

## Run it

```bash
npm install
npm run dev          # backend on :3001 (tsx --watch), Vite dev on :5173
                     # → open two tabs at http://localhost:5173/
```

Production build:

```bash
npm run build
npm start            # serves frontend + WebSocket on :3001
                     # persistence in ./data/yjs/ (override via PERSIST_DIR=…)
```

## Tests

```bash
npm test             # 22 vitest unit tests (diff + Y.Text round-trip + URL parsing + presence identity)
npm run test:e2e     # 10 Playwright tests on port 3100 (~3.5s incl. server boot)
                     #   - 2 baseline browser tests
                     #   - F1 concurrent-edit convergence
                     #   - F2 offline-edit reconciliation
                     #   - F3 cursor preservation under remote ops
                     #   - F4 persistence across server restart
                     #   - F8 multi-doc isolation (v2.1.0)
                     #   - F9 awareness presence (v2.1.0)
                     #   - F10 undo respects remote ops (v2.1.0)
                     #   - F11 IndexedDB survives reload (v2.1.0)
npm run typecheck    # tsc --noEmit on both client and server
```

The Playwright config uses port `3100` to keep e2e isolated from
`npm run dev`'s `:3001` default. F4 spawns its own server on `:3101` so it
can kill+respawn within a single test.

## V1 → V2 failure-mode table

Each row was a deliberate V1 bug; the chaos test for it flipped at the V2
boundary. The diff on `tests/e2e/v2-baseline.spec.ts` (renamed from
`v1-baseline.spec.ts`) is the portfolio artifact.

| # | V1 outcome | V2 fix mechanism | Chaos test |
|---|-----------|------------------|-----------|
| F1 | Concurrent edits diverge — each tab gets the OTHER tab's text | Yjs CRDT — operations commute; both inserts land in a single merged document | `F1_ConcurrentEditsConverge` — `expect(finalA).toBe(finalB)` AND text contains characters from both inputs |
| F2 | Network blip → offline edits lost on reconnect | `WebsocketProvider` reconnect runs sync_step1 + ships buffered ops; CRDT merges | `F2_OfflineEditReconciles` |
| F3 | Echo cursor jump on cross-tab edits | `Y.RelativePosition` snapshotted in `beforeTransaction`, restored in observe | `F3_CursorPreserved` — insert before user's cursor; cursor stays over the same logical character (5 → 8 after a 3-char prepend) |
| F4 | Server restart wipes the doc | `y-leveldb` writes every Y.Doc update; `bindState` loads on first access | `F4_PersistsAcrossRestart` — spawn server, write, kill (SIGTERM with leveldb flush), respawn, assert doc intact |
| F5 | Bandwidth scales `O(doc_size × clients × edit_rate)` | y-websocket binary ops carry only the delta (~10–30 bytes per keystroke) | (structural — not separately asserted) |

## v2.1.0 features (F8-F11)

These aren't V1 failure inversions — V2 didn't have them at all. They're
feature-presence tests that lock in the v2.1.0 surface:

| # | Feature | What the test asserts |
|---|---------|----------------------|
| F8 | Multi-doc isolation | Two Yjs clients on `f8-room-a` and `f8-room-b` don't see each other's edits |
| F9 | Awareness presence | Client B reads `provider.awareness.getStates()` and sees client A's `name + cursor=42` |
| F10 | Undo respects remote ops | A types `AAA`, B inserts `BBB` at offset 0, A undoes; result is `BBB` (not `''`, not `BBBAAA`) — only A's local origin is on its UndoManager's stack |
| F11 | IndexedDB survives reload | Page types text, `page.reload()`, asserts text is still there before the WebSocket reconnects |

## Project layout

```
collaborative-editor/
├── spec.md                          RFC-2119 spec; V1 → V2 evolution
├── package.json                     scripts: dev / build / start / test / test:e2e / typecheck
├── tsconfig.json                    base + client (target DOM)
├── tsconfig.server.json             server build (target Node ESM)
├── vite.config.ts                   Vite dev + build for the client
├── vitest.config.ts                 unit-test runner config (separate from Vite root)
├── playwright.config.ts             e2e config; port 3100; webServer = build && start
├── src/
│   ├── server/
│   │   ├── index.ts                 http + ws upgrade + setupWSConnection + leveldb flush on shutdown
│   │   ├── url.ts                   parseRoomFromUrl (regex-validated /ws/<room>)
│   │   └── y-websocket-utils.d.ts   tiny type stub for the CommonJS server helper
│   └── client/
│       ├── index.html               textarea + status pill + room switcher + presence footer
│       ├── main.ts                  Y.Doc + IndexeddbPersistence + WebsocketProvider + binding/presence/undo wiring
│       ├── textarea-binding.ts      ~80 lines: prefix-suffix diff + relative-position cursor preservation; exports localOrigin
│       ├── presence.ts              identity-by-client-ID + awareness publish + footer renderer
│       └── undo.ts                  Y.UndoManager scoped to localOrigin + Ctrl/Cmd+Z handler
└── tests/
    ├── unit/                        vitest: diff + Y.Text round-trip + URL parser + presence identity
    └── e2e/                         playwright: baseline + F1-F4 (V1→V2 inversions) + F8-F11 (v2.1.0 features)
```

## Why these decisions

**Yjs over Automerge.** Yjs is built specifically for collaborative text
editing, has a mature WebSocket provider (`y-websocket`), a smaller WASM
footprint, and a smaller learning curve for the V1 → V2 swap. Automerge
wins for general JSON-document sync, but text is the whole job here.

**Keep the textarea, hand-write the binding.** V2's lesson is the CRDT
mechanics; CodeMirror or ProseMirror would obscure them behind a heavy
editor. The binding is ~70 lines; cursor preservation falls out of
`Y.RelativePosition`.

**y-leveldb over a "real" database.** Official Yjs adapter, file-based,
no schema, no service. Postgres / S3 snapshotting is V3 production
hardening — overkill for V2.

**Multi-doc via URL path, hash on the page (v2.1.0).** WebSocket
connects to `/ws/<room>`; the page reads the room from
`location.hash` (`/#meeting-notes`). Server validates room names against
`[A-Za-z0-9_-]{1,64}` and rejects others with HTTP 400. Hash changes
trigger a full page reload — hot-swapping rooms without recreating the
provider, IndexeddbPersistence, and binding is v2.2.0+.

**Text-only presence in v2.1.0; visual overlays deferred (v2.1.0).**
The awareness channel is published with `{ name, color, cursor }`; the
footer shows it as text (`Alice-042 @12`). Visual cursor overlays
inside the textarea need pixel-from-character-offset measurement
against a hidden mirror div — real UI work, deferred to v2.2.0.

**`Y.UndoManager` scoped to local origin (v2.1.0).** Local-edit
transactions are tagged with a module-level `localOrigin` symbol
(exported from `textarea-binding.ts`); the UndoManager's
`trackedOrigins: new Set([localOrigin])` keeps remote ops out of the
undo stack. F10 (`A types 'AAA', B types 'BBB' before, A undoes → 'BBB'`)
is the load-bearing assertion.

**`beforeTransaction` cursor capture, not in-observe.** The naive cursor-
preservation pattern (capture relative position inside the `observe`
callback) is wrong: by the time the observer fires, `Y.Text` has already
been updated, so the relative position is computed against post-update
state. Capture in `beforeTransaction` (pre-update) and restore in
`observe` (post-update). One of those things you only learn from the
test that catches it.

## Roadmap

| Version | Theme | Scope |
|---------|-------|-------|
| `v1.0.0` ✅ | Naive baseline | WebSocket + last-write-wins + in-memory + single doc. F1 chaos test asserts divergence. |
| `v2.0.0` ✅ | CRDT + persistence | Yjs + y-websocket + y-leveldb. F1 inverted to converge; F2 offline reconcile; F3 cursor preserved; F4 persist across restart. |
| `v2.1.0` ✅ | Multi-doc + presence + undo + offline-first | Room routing (`/ws/<room>`, `/#<room>`); awareness footer; `Y.UndoManager`; `y-indexeddb`. F8-F11 feature tests. |
| `v2.2.0` | Portfolio | Visual cursor overlays; user-supplied names; deploy to Fly.io / Railway with a public URL. |
| `v3.0.0` | Editor upgrade | CodeMirror 6 + `y-codemirror.next` if the textarea ergonomics become limiting. |

## Reading

- Martin Kleppmann — CRDT lecture series (free on YouTube)
- Yjs documentation — `https://docs.yjs.dev/`
- y-protocols / y-websocket sync protocol — `https://github.com/yjs/y-protocols`
- Kleppmann, *Designing Data-Intensive Applications* — chapter 5 (replication), chapter 9 (consistency & consensus)
