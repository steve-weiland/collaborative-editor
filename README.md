# Real-Time Collaborative Editor

WebSocket-driven shared text editor in TypeScript, built to walk the V1 → V2
evolution: a deliberately-broken **last-write-wins** baseline that loses
characters under concurrent edits, replaced in V2 by a **CRDT** (Yjs or
Automerge) with operation-based diff sync, persistence, and reconnect-with-
state-sync.

| | |
|--|--|
| **Spec** | [`spec.md`](./spec.md) — RFC-2119 requirements + V1 failure modes |
| **Status** | `v1.0.0` released — V1 baseline. F1 (concurrent edits diverge) locked in by a Playwright chaos test that V2 will invert. |
| **Stack** | Node.js 20 + TypeScript + `ws` + Vite + vanilla TS frontend |

---

## V1 in 30 seconds

```
client A ─┐
client B ─┼──┐  WebSocket /ws       ┌─→ broadcasts
client C ─┘  └─→ Node.js server ────┤   `{type:"doc", text}`
                  state.text:string  └─→ to all OTHER clients
                  (last-write-wins)
```

- Every keystroke ships the **full textarea value** as `{type:"edit", text}`.
- Server overwrites `state.text` and broadcasts to all other connected
  clients, who replace their textarea value verbatim.
- One user, one tab — works fine. Two tabs typing at once — you'll watch
  characters disappear.

That's the design. V1's job is to expose the failure shapes; V2 fixes them.

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
```

## Tests

```bash
npm test             # 12 vitest unit tests (~200ms)
npm run test:e2e     # 3 Playwright tests on port 3100 (~3s incl. server boot)
                     # — includes the F1 chaos test
npm run typecheck    # tsc --noEmit on both client and server
```

The Playwright config uses port `3100` to keep e2e isolated from `npm run dev`'s
:3001 default.

## V1 failure modes (and how V2 fixes them)

Each row in `spec.md` §6 captures a deliberate V1 bug. The Playwright suite
locks F1 in place:

| # | Bug | V1 chaos test | V2 mechanism (planned) |
|---|-----|---------------|------------------------|
| F1 | Concurrent edits diverge — each tab ends up with the OTHER tab's text | `tests/e2e/v1-baseline.spec.ts` — `expect(finalA).not.toEqual(finalB)` | CRDT (Yjs / Automerge) — operations commute, both edits land |
| F2 | Network blip → divergence on reconnect | (manual) | Persistent CRDT doc + state-sync on reconnect |
| F3 | Echo cursor jump in cross-tab edits | (manual) | Operation-based sync preserves local cursor |
| F4 | Server restart wipes the doc | (manual) | Persist CRDT state to disk |
| F5 | Bandwidth scales `O(doc_size × clients × edit_rate)` | (manual) | Operation diffs ship only changed bytes |

The V1 → V2 portfolio asset is the diff on `tests/e2e/v1-baseline.spec.ts`:
the F1 assertion flips from `not.toEqual` to `toEqual` plus a check that
both tabs' inputs are present in the final text.

## Project layout

```
collaborative-editor/
├── spec.md                          RFC-2119 spec + V1 failure modes
├── package.json                     scripts: dev / build / start / test / test:e2e / typecheck
├── tsconfig.json                    base + client (target DOM)
├── tsconfig.server.json             server build (target Node ESM)
├── vite.config.ts                   Vite dev + build for the client
├── vitest.config.ts                 unit-test runner config (separate from Vite root)
├── playwright.config.ts             e2e config; port 3100; webServer = build && start
├── src/
│   ├── shared/messages.ts           wire-protocol types + isClientMessage guard
│   ├── server/
│   │   ├── index.ts                 http + ws + static; the ~100-line entry point
│   │   ├── state.ts                 DocumentState — testable string wrapper
│   │   └── broadcast.ts             broadcast() — testable, BroadcastTarget interface
│   └── client/
│       ├── index.html               textarea + status pill
│       └── main.ts                  WebSocket client + 1s reconnect
└── tests/
    ├── unit/                        vitest: messages, state, broadcast
    └── e2e/                         playwright: V1 baseline + F1 chaos
```

## Roadmap

| Version | Theme | Scope |
|---------|-------|-------|
| `v1.0.0` ✅ | Naive baseline | WebSocket + last-write-wins + in-memory + single doc. F1 chaos test asserts divergence. |
| `v2.0.0` | CRDT | Yjs or Automerge in place of `state.text`. F1 inverted: tabs converge to a merged result. F3 (cursor) fixed by op-based sync. |
| `v2.1.0` | Persistence + reconnect | Persist CRDT state (sqlite or `level`); state-sync on reconnect; F2, F4 fixed. |
| `v2.2.0` | Stretch | Multiple documents/rooms; presence cursors; undo/redo respecting remote ops. |
| `v3.0.0` | Portfolio | Deploy to Fly.io / Railway with a public URL; offline-first via IndexedDB. |

## Reading

- Martin Kleppmann — CRDT lecture series (free on YouTube)
- Automerge internals docs — `https://automerge.org/docs/`
- Yjs — `https://docs.yjs.dev/`
- Kleppmann, *Designing Data-Intensive Applications* — chapter 5 (replication) and chapter 9 (consistency & consensus)
