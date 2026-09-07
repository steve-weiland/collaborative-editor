# CLAUDE.md

Agent context for collaborative-editor — a real-time collaborative text
editor (TypeScript, Yjs CRDT, y-websocket, vanilla frontend). Read
`spec.md` for requirements (`DOC-*` ids); this file is the standing
conventions that survive between sessions.

## What this repo is

The V1 → V2 story: a deliberately-broken last-write-wins WebSocket
baseline, replaced by a Yjs CRDT with y-websocket sync, y-leveldb server
persistence, y-indexeddb offline-first, awareness presence, scoped undo,
and visual cursor overlays. The chaos/feature tests (F1–F15, in
`tests/e2e/v2-baseline.spec.ts`) are the spec's enforcement arm — each F
number maps to a spec row or a README table entry.

## Conventions (violations are review-rejectable)

- **Awareness state is attacker-controlled** regardless of local types
  (DOC-137): anything rendered from it goes through DOM APIs
  (`textContent`/`createTextNode`), never innerHTML string-building;
  `color` is regex-pinned before touching a style attribute; non-integer
  cursors render as the idle marker.
- **The shutdown flush covers every room** (`flushAllDocs` over
  y-websocket's `docs` map) — never a hardcoded room name; that exact
  regression lost named-room keystrokes once already (F15).
- **Keep the textarea + hand-written binding** — the CRDT mechanics are
  the lesson; an editor framework would hide them. Cursor capture happens
  in `beforeTransaction`, restore in `observe` (capturing in-observe
  computes against post-update state — F3's lesson).
- **Undo is scoped to `localOrigin`** — Ctrl/Cmd+Z must never undo
  someone else's edits (F10).
- New behavior lands with an F-numbered test; red-first where the bug is
  deterministic, unit-level red where it's a race (the F15 pattern).

## Working discipline

- Keep comments short; no volatile values in them (ports, sizes — values
  drift; name the constraint).
- Minimal code and tests to do the job; every feature gated by a test.
- Prove new tests are load-bearing: sabotage the code, watch the test
  fail for the right reason, restore — and verify the sabotage APPLIED
  and the restore took (grep both ways).
- Full gates before declaring done. Human review before every commit.

## Gates

```
npm run typecheck    # tsc on client + server
npm test             # vitest unit suite
npm run test:e2e     # Playwright F-suite (builds + boots the server on :3100)
```

## Documentation contract

`spec.md` follows the sibling repos' format: RFC-2119 keywords, `DOC-*`
requirement ids, a revision-history row for every behavior change in the
same commit as the change. README's failure-mode tables carry the
F-number ↔ test mapping. Deployment is formally skipped, as a decision —
don't resurrect it casually.

## When review catches you violating a convention

Fix the code, then encode the violated rule into this file so the class
of error dies, not the instance.
