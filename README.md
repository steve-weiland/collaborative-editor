# Real-Time Collaborative Editor

WebSocket-driven shared text editor in TypeScript, built to walk the V1 → V2
evolution: a deliberately-broken **last-write-wins** baseline replaced in V2
by a **CRDT** (Yjs) with **operation-based diff sync**, **leveldb
persistence**, and **reconnect-with-state-sync** via the y-websocket
provider.

| | |
|--|--|
| **Spec** | [`spec.md`](./spec.md) — RFC-2119 requirements; V1 → V2 failure-mode mapping |
| **Status** | `v2.0.0` released. F1–F5 V1 failure modes all addressed; F1–F4 locked in by chaos tests that flip from V1's "asserts the bug" to V2's "asserts the fix." |
| **Stack** | Node.js 20 + TypeScript + Yjs + y-websocket + y-leveldb + Vite + vanilla TS frontend |

---

## V2 in 30 seconds

```
Page A's Y.Doc ──┐                            ┌──> Page B's Y.Doc
                 │  y-websocket binary (ops)  │
                 ├──> Server's Y.Doc <────────┤
                 │       │                    │
                 │       │ y-leveldb          │
                 │       ▼                    │
                 │   ./data/yjs/              │
                 └────────────────────────────┘
```

- The document is a `Y.Text` named `'doc'` inside a Y.Doc shared by every
  client.
- Local edits become `Y.Text.insert` / `Y.Text.delete` ops (smallest
  prefix-suffix diff against the current ytext).
- The y-websocket provider ships ops, runs sync_step1/2 on connect, and
  reconciles offline ops on reconnect.
- y-leveldb persists every update so the doc survives server restart.
- Cursor stays put on remote ops via `Y.RelativePosition` snapshotted
  before each transaction.

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
npm test             # 11 vitest unit tests covering the diff + Y.Text round-trip
npm run test:e2e     # 6 Playwright tests on port 3100 (~3s incl. server boot)
                     #   - 2 baseline browser tests
                     #   - F1 concurrent-edit convergence
                     #   - F2 offline-edit reconciliation
                     #   - F3 cursor preservation under remote ops
                     #   - F4 persistence across server restart
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
│   │   └── y-websocket-utils.d.ts   tiny type stub for the CommonJS server helper
│   └── client/
│       ├── index.html               textarea + status pill
│       ├── main.ts                  Y.Doc + WebsocketProvider + binding wiring
│       └── textarea-binding.ts      ~70 lines: prefix-suffix diff + relative-position cursor preservation
└── tests/
    ├── unit/                        vitest: diff + Y.Text round-trip
    └── e2e/                         playwright: baseline + F1-F4 chaos
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

**Single-doc routing in V2.** `setupWSConnection(ws, req, { docName: 'doc' })`
pins all clients to one shared `Y.Doc` regardless of URL. URL-based
multi-doc routing is V2.1.

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
| `v2.1.0` | Stretch | Multi-document / rooms via URL path; presence cursors over the awareness channel; undo/redo with `Y.UndoManager`; offline-first IndexedDB persistence. |
| `v2.2.0` | Portfolio | Deploy to Fly.io / Railway with a public URL. |
| `v3.0.0` | Editor upgrade | CodeMirror 6 + `y-codemirror.next` if the textarea ergonomics become limiting. |

## Reading

- Martin Kleppmann — CRDT lecture series (free on YouTube)
- Yjs documentation — `https://docs.yjs.dev/`
- y-protocols / y-websocket sync protocol — `https://github.com/yjs/y-protocols`
- Kleppmann, *Designing Data-Intensive Applications* — chapter 5 (replication), chapter 9 (consistency & consensus)
