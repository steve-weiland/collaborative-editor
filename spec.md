# Real-Time Collaborative Editor

| Field   | Value         |
|---------|---------------|
| Version | 0.3 (draft)   |
| Author  | Steve Weiland |
| Date    | 2026-05-02    |
| Status  | Draft         |

---

## 1. Overview

This spec is layered: V1 introduced a deliberately-broken WebSocket pipeline
with last-write-wins on the entire document, in-memory state, and a fixed
1 s reconnect that lost any locally-typed text. V2 fixes the five V1
failure modes with three mechanisms:

1. **CRDT state** — the server holds a `Y.Doc` containing a `Y.Text` named
   `doc`. Concurrent operations commute; there is no LWW.
2. **Operation-based wire protocol** — the y-websocket binary protocol
   exchanges sync_step messages (state-vector ↔ delta) and awareness frames;
   on every local Y.Text op the provider ships only the changed bytes.
3. **Persistence + reconnect-with-state-sync** — `y-leveldb` writes Y.Doc
   updates to disk; on client reconnect the WebsocketProvider runs
   sync_step1 against the persisted state and applies the delta.

Each of F1–F4 has an inverted chaos test in V2; F5 is structurally fixed
by the protocol change and is not separately asserted.

v2.1.0 stacks four independent stretch features on top of V2 without
touching the sync protocol or persistence backend: **multi-document via
URL path**, **awareness-channel presence** (text-only display: who's
connected and where their cursor is), **`Y.UndoManager`** for local-only
undo/redo that respects remote ops, and **y-indexeddb** for browser-side
offline-first persistence (page reload shows the doc immediately, even if
the server is unreachable). F8–F11 cover these as feature-presence tests.

The portfolio milestone is a deployable live demo (Fly.io / Railway target),
which is v2.2.0 work.

---

## 2. Definitions

| Term | Definition |
|------|------------|
| Document | The single shared piece of text being edited |
| Last-write-wins (LWW) | *(V1)* Conflict resolution rule: whoever writes most recently overwrites prior state. **Replaced in V2 by CRDT merge.** |
| CRDT | Conflict-free Replicated Data Type — a data structure whose concurrent operations commute. V2 uses Yjs. |
| `Y.Doc` | A Yjs document container; holds one or more shared types. The server and each client hold their own `Y.Doc` instance synchronized via the y-websocket protocol. |
| `Y.Text` | A Yjs shared type representing a sequence of text with operation-based concurrent editing. The document's text lives in `ydoc.getText('doc')`. |
| Op | An insert-at-offset or delete-at-offset operation on `Y.Text`. The unit of synchronization in V2. |
| Sync step | y-websocket sync protocol exchange: step1 sends a state vector, step2 returns the missing updates, step3 acks. Drives initial state load and reconnect reconciliation. |
| Awareness | y-websocket sub-protocol for ephemeral per-client state (e.g., presence cursors). Not used in V2 but the channel is present for V2.1. |
| Update message | Binary y-websocket frame carrying one or more ops; what the client and server exchange after the initial sync. |
| Relative position | Yjs cursor representation that survives concurrent ops — converts to/from an absolute offset against a `Y.Doc`'s current state. |
| `y-websocket` | Yjs's standard WebSocket transport. Server-side `setupWSConnection` handles per-doc state + per-client framing; client-side `WebsocketProvider` handles connect / sync / reconnect. |
| `y-leveldb` | Yjs's LevelDB persistence adapter. Loads a `Y.Doc` from disk on first access; persists every update. |
| Reconnect | Client behavior after a WebSocket drop: reopen, run sync_step1, apply server delta, ship local ops. Local edits made while offline are preserved by the CRDT and reconciled on reconnect. |
| Room | *(v2.1.0)* A `Y.Doc` keyed by name (URL path component on the WebSocket; URL hash fragment on the page). Each room is independent; edits in one don't reach another. The bare path `/ws` defaults to room `'doc'` for back-compat. |
| Awareness state | *(v2.1.0)* Ephemeral per-client metadata published on the y-websocket awareness channel: `{ name, color, cursor }`. Used in v2.1.0 for a text-only presence footer; visual cursor overlays are v2.2.0. |
| `Y.UndoManager` | *(v2.1.0)* Yjs class that tracks origin-tagged operations and produces inverse ops on `undo()`. v2.1.0 scopes it to a single `localOrigin` symbol so remote ops are never undone. |
| `y-indexeddb` | *(v2.1.0)* Yjs persistence adapter that mirrors a `Y.Doc` into the browser's IndexedDB. Loads on page open *before* the WebSocketProvider syncs, so reload shows the document immediately. |

---

## 3. Requirements

Requirements use [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) keywords:
**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**.

### 3.1 Components

| ID | Requirement |
|----|-------------|
| DOC-01 | The system **MUST** consist of a single Node.js backend process and any number of browser clients. |
| DOC-02 | The backend **MUST** expose a WebSocket endpoint at `/ws` and serve the built frontend bundle from the HTTP root `/`. |
| DOC-03 | The system **MUST** support arbitrarily many rooms, each keyed by a name extracted from the WebSocket URL path. The bare `/ws` path **MUST** default to room `'doc'` for backward compatibility with V2 clients. *(v2.1.0; replaced V2's single-hardcoded-doc requirement.)* |

### 3.2 Backend

| ID | Requirement |
|----|-------------|
| DOC-10 | The backend **MUST** accept WebSocket upgrades on `/ws`. |
| DOC-11 | The backend **MUST** hold a single in-memory `Y.Doc` exposing a `Y.Text` named `doc`. *(Replaces V1 OPS-11 in-memory string.)* |
| DOC-12 | On WebSocket upgrade the backend **MUST** extract the room name from the URL path (`/ws/<room>` → `<room>`); empty or missing path **MUST** default to `'doc'`. Room names **MUST** match `/^[A-Za-z0-9_-]{1,64}$/`; non-matching upgrades **MUST** be rejected with HTTP 400. The accepted upgrade is then handed to y-websocket's `setupWSConnection(ws, request, { docName: <room>, gc })`, which drives the sync protocol. *(v2.1.0; replaced V2's hardcoded `docName: 'doc'`.)* |
| DOC-13 | *(Removed.)* Server-driven full-document broadcast is replaced by the y-websocket protocol's update messages. |
| DOC-14 | The backend **MUST** persist every Y.Doc update to LevelDB at `PERSIST_DIR` (default `./data/yjs`) via `y-leveldb`. State **MUST** survive process restart and **MUST** be loaded into the Y.Doc on the first connection after restart. *(Inverted from V1 OPS-14.)* |
| DOC-15 | The backend **MUST** tolerate client disconnects without crashing or affecting other clients. *(Unchanged from V1.)* |
| DOC-16 | The backend **MUST** tolerate malformed y-websocket frames (handled by the y-websocket library). The library logs and ignores; the connection is **NOT REQUIRED** to be terminated. |

### 3.3 Frontend

| ID | Requirement |
|----|-------------|
| DOC-20 | The frontend **MUST** render a single `<textarea>` filling the viewport. |
| DOC-21 | On every `input` event, the frontend **MUST** translate the textarea's new value into one or more Y.Text operations using a prefix-suffix diff against the prior `Y.Text` content. The diff **MUST** be applied inside a single `ydoc.transact` so the resulting update message is one frame, not N. *(Replaces V1 OPS-21 full-text broadcast.)* |
| DOC-22 | On Y.Text observation of remote ops, the frontend **MUST** apply the new text to the textarea while preserving the user's cursor position via `Y.RelativePosition`. F3 (cursor jump under remote ops) **MUST NOT** manifest. *(Inverted from V1 OPS-22.)* |
| DOC-23 | The frontend **MUST** use y-websocket's `WebsocketProvider` for connection lifecycle. On reconnect the provider **MUST** run sync_step1 against the server, apply any missed ops, and ship any locally-buffered ops produced while disconnected. F2 (offline edits lost on reconnect) **MUST NOT** manifest. *(Inverted from V1 OPS-23.)* |
| DOC-24 | The frontend **MUST** read the active room from `location.hash` (`/#meeting-notes` → room `'meeting-notes'`); empty hash defaults to `'doc'`. The `WebsocketProvider` URL **MUST** be `<wsBase>/<room>`. *(v2.1.0)* |
| DOC-25 | A change to `location.hash` **MUST** trigger a full page reload. v2.1.0 does not hot-swap rooms — the provider, IndexeddbPersistence, and binding are all bound to one room for the page's lifetime. *(v2.1.0)* |

### 3.4 Wire Protocol

| ID | Requirement |
|----|-------------|
| DOC-30 | Frames **MUST** conform to the y-websocket binary protocol (sync messages + awareness messages, type-tagged with a leading byte; payloads are y-protocols-encoded). The JSON `doc`/`edit` protocol from V1 is **REMOVED**. |
| DOC-31 | The server's first message after `setupWSConnection` **MUST** be a sync_step1 carrying the server-side state vector; the client's response is sync_step2 carrying the delta. Subsequent ops are exchanged as update messages. |
| DOC-32 | Awareness frames **MUST** be exchanged. v2.1.0 actively uses the awareness channel for presence (§3.10); the y-websocket library handles framing on both ends. |
| DOC-33 | Maximum frame size **SHOULD** remain at the default y-websocket library limit; oversize frames **MAY** be rejected. |

### 3.5 Operational

| ID | Requirement |
|----|-------------|
| DOC-40 | Default port **MUST** be `:3001`; configurable via `PORT` environment variable. |
| DOC-41 | `npm run dev` **MUST** run the backend (`tsx --watch`) and the Vite dev server with hot reload simultaneously. |
| DOC-42 | `npm run build` **MUST** produce a production frontend bundle and a compiled backend; `npm start` **MUST** run the production backend, which serves the frontend bundle as static files. |
| DOC-43 | The system **SHOULD** log on connect, disconnect, and persistence-store boot events; debug-level logging of every update **MAY** be enabled. |
| DOC-44 | The persistence directory **MUST** be configurable via `PERSIST_DIR` (default `./data/yjs`) and **MUST** be created if missing. |

### 3.6 CRDT State (V2)

| ID | Requirement |
|----|-------------|
| DOC-50 | The server's authoritative document **MUST** be a Yjs `Y.Doc` with `getText('doc')` as the single shared text type. |
| DOC-51 | Every connected client **MUST** hold its own `Y.Doc` instance, synchronized to the server's via the y-websocket sync protocol. |
| DOC-52 | Local edits and remote ops **MUST** be applied via `Y.Text.insert(offset, text)` / `Y.Text.delete(offset, count)`. The server **MUST NOT** maintain a parallel string state; `Y.Text.toString()` is the only canonical text. |

### 3.7 Persistence (V2)

| ID | Requirement |
|----|-------------|
| DOC-60 | The backend **MUST** open a LevelDB instance at `PERSIST_DIR` and bind it to the Y.Doc via `y-leveldb`'s `LeveldbPersistence`. |
| DOC-61 | On Y.Doc creation (first request), the backend **MUST** call `bindState(docName, ydoc)` which loads any persisted state into the in-memory Y.Doc. |
| DOC-62 | Every Y.Doc update **MUST** be written to LevelDB. The backend **MAY** rely on `y-leveldb`'s automatic `update`-event subscription rather than explicit per-update writes. |
| DOC-63 | The backend **SHOULD** flush pending writes on `SIGINT`/`SIGTERM` before exiting; partial-write recovery is **NOT REQUIRED** (any successfully `flush`-ed update survives; in-flight ops on a hard kill may be lost — this is acceptable for V2 and tightened in V2.1+). |

### 3.8 Reconnect (V2)

| ID | Requirement |
|----|-------------|
| DOC-70 | On WebSocket disconnect, the client provider **MUST** retry with backoff (provider default — V2 does not configure custom backoff). |
| DOC-71 | While disconnected, the client **MUST** continue to accept local edits; the provider buffers updates and ships them on reconnect. |
| DOC-72 | On reconnect, sync_step1 **MUST** be issued by both ends so each side learns what the other is missing. The CRDT then merges concurrent edits without LWW. |

### 3.9 Multi-document (v2.1.0)

| ID | Requirement |
|----|-------------|
| DOC-90 | The server **MUST** route each room to its own `Y.Doc` via `setupWSConnection(ws, req, { docName: <fromPath> })`. |
| DOC-91 | y-leveldb persistence **MUST** key updates by `docName`, so rooms persist independently and survive restart on a per-room basis. |
| DOC-92 | The client **MUST** display the current room name in the page header. |
| DOC-93 | The client **MUST** offer a room switcher: an input field whose submission sets `location.hash` (which triggers a reload per DOC-25). |

### 3.10 Presence (v2.1.0)

| ID | Requirement |
|----|-------------|
| DOC-100 | Each client **MUST** publish an awareness state on connect: `{ name: string, color: string (hex), cursor: number \| null }`. Name and color **MUST** be picked deterministically from the WebsocketProvider's per-session client ID. |
| DOC-101 | The client **MUST** update its awareness `cursor` field on every textarea `selectionchange` (debounced ~50 ms) with the textarea's `selectionStart`, or `null` if the textarea is not focused. |
| DOC-102 | The client **MUST** render a status footer listing every OTHER client's `name`, `color`, and `cursor` offset. The footer **MUST** update whenever the awareness map changes. |
| DOC-103 | Visual cursor overlays inside the textarea are **OUT OF SCOPE** in v2.1.0; the offset display in the footer is the v2.1 surface. Overlays are v2.2.0. |

### 3.11 Undo/redo (v2.1.0)

| ID | Requirement |
|----|-------------|
| DOC-110 | The client **MUST** instantiate a `Y.UndoManager(ytext, { trackedOrigins: new Set([localOrigin]) })` so the undo stack tracks only local-origin ops. |
| DOC-111 | Local Y.Text edits from the textarea binding **MUST** be tagged with `localOrigin` via `ydoc.transact(fn, localOrigin)`. |
| DOC-112 | The client **MUST** intercept `keydown` on the textarea: `⌘/Ctrl+Z` calls `undoManager.undo()`, `⌘/Ctrl+Shift+Z` (or `Ctrl+Y`) calls `undoManager.redo()`. The browser's default undo on the textarea **MUST** be suppressed via `event.preventDefault()`. |
| DOC-113 | A local undo **MUST NOT** affect remote ops. If the user types `'AAA'`, a remote client inserts `'BBB'` before it (yielding `'BBBAAA'`), and the local user hits Undo, the result **MUST** be `'BBB'` — `'BBB'` survives. |

### 3.12 IndexedDB persistence (v2.1.0)

| ID | Requirement |
|----|-------------|
| DOC-120 | The client **MUST** instantiate an `IndexeddbPersistence(roomName, ydoc)` from `y-indexeddb`. |
| DOC-121 | The client **SHOULD** wait for the `IndexeddbPersistence` `synced` event before binding the textarea, so reload-with-content doesn't briefly flash empty. |
| DOC-122 | A page reload **MUST** display the previously-edited document text immediately, even if the WebSocket connection is unavailable. |
| DOC-123 | Edits made while the server is unreachable **MUST** be persisted to IndexedDB and pushed to the server on the next successful reconnect (automatic via the WebsocketProvider's update buffer + IndexeddbPersistence's update-event subscription). |

---

## 4. Inputs / Outputs

### Wire-protocol layer

The y-websocket binary protocol is documented at
`https://github.com/yjs/y-protocols`. V2 does not customize it.

### HTTP

```
GET /              → 200, the built frontend (HTML + JS + CSS)
GET /assets/*      → 200, hashed bundle assets (Vite output)
GET /ws            → 101 Switching Protocols  (WebSocket upgrade; y-websocket protocol)
```

### Filesystem

```
$PERSIST_DIR/    LevelDB instance owned by y-leveldb. One instance covers all
                 document names; in V2 there's only `doc`. Format is a Yjs-
                 internal log of binary updates plus a final flushed-state
                 snapshot.
```

### CLI / env

```
PORT          (env, default 3001)            HTTP/WebSocket port
PERSIST_DIR   (env, default ./data/yjs)      LevelDB directory
```

---

## 5. Out of Scope

Deferred to v2.2.0+ unless otherwise noted:

- **Visual cursor overlays inside the textarea** *(v2.2.0)* — pixel-from-character-offset measurement against a hidden mirror div + absolutely-positioned overlays. v2.1.0's text-only awareness footer is the bridge.
- **User-supplied names** *(v2.2.0)* — v2.1.0 picks an anonymous handle deterministically from the client ID.
- Authentication, sessions, user identity (V3?)
- Permissions / read-only rooms — every connected client is read-write.
- Compaction / GC of LevelDB (Yjs-internal `gc: true` is the default; manual snapshotting is later)
- Rate-limiting / flood protection
- **Hot-swap rooms without a page reload** *(v2.2.0+)* — v2.1.0 reloads on hash change.
- **Deployment / hosting** (Fly.io / Railway is the v2.2.0 portfolio milestone)
- CodeMirror / ProseMirror editor upgrade — V3 if it earns its keep

---

## 6. V1 Failure Modes Resolved in V2

| # | V1 outcome | V2 fix mechanism | V2 chaos test |
|---|-----------|------------------|---------------|
| F1 | Concurrent edits diverge — each tab sees the other's text | Yjs operations commute; both inserts land in the merged `Y.Text` and both clients converge | `F1_ConcurrentEditsConverge` — concurrent inserts on two `Y.Doc` instances; assert `finalA === finalB` AND both `'AAAAA'` and `'BBBBB'` are present |
| F2 | Network blip → divergence on reconnect; offline edits lost | `WebsocketProvider` reconnect runs sync_step1 + ships buffered offline ops; CRDT merges | `F2_OfflineEditReconciles` — drop the WS, edit `Y.Text` locally, reconnect, assert merged result on both sides |
| F3 | Echo cursor jump on remote edits | Y.Text observe + `Y.RelativePosition` preserves cursor across remote ops | `F3_CursorPreservedDuringRemoteEdit` — Playwright: A focuses textarea at offset N; B inserts text *before* offset N via Y.Text; assert A's cursor is still over the same logical character |
| F4 | Server restart wipes the doc | `y-leveldb` writes every Y.Doc update; on restart the doc loads from disk | `F4_PersistsAcrossRestart` — write text via client, kill the server process, respawn against the same `PERSIST_DIR`, reconnect, assert text intact |
| F5 | Bandwidth scales `O(doc_size × clients × edit_rate)` | y-websocket update messages carry only the delta (~10–30 bytes per typical keystroke) | Out of test scope — F5 is structurally fixed by protocol change and not separately asserted in V2 |

v2.1.0 adds four feature-presence tests (F8–F11) — these aren't V1 failure
inversions but confirm that the v2.1.0 features are wired correctly:

| # | Feature | v2.1.0 test |
|---|---------|-------------|
| F8 | Two rooms are independent | `F8_MultiDocIsolation` — clients on `#room-a` and `#room-b` don't see each other's edits |
| F9 | Awareness exposes other clients' cursors | `F9_AwarenessVisible` — A focuses at offset N; B reads `provider.awareness` and sees A's name + cursor=N |
| F10 | Local undo doesn't affect remote ops | `F10_UndoRespectsRemote` — A types `AAA`, B inserts `BBB` before, A undoes, result is `BBB` |
| F11 | IndexedDB survives page reload | `F11_IndexedDBSurvivesReload` — edit, `page.reload()`, assert text still there |

---

## 7. Resolved Decisions

V1 entries Q1–Q11 still apply where the V1 mechanism survives in V2 (e.g.
single-doc, vanilla TS, single npm package). V2 adds Q12–Q19.

| # | Question | Decision |
|---|----------|----------|
| Q12 | Yjs or Automerge? | **Yjs.** Built specifically for collaborative text editing, mature WebSocket provider, smaller WASM, smaller learning curve for the V1 → V2 swap. Automerge is the answer if/when JSON-document sync (not just text) becomes a requirement. |
| Q13 | Persistence backend? | **`y-leveldb`.** Official Yjs adapter; file-based, no external service, no schema. Postgres / S3-backed snapshotting is a V3 production-hardening question. |
| Q14 | Editor — keep `<textarea>` or upgrade to CodeMirror/ProseMirror? | **Keep `<textarea>`** with a hand-written ~60-line binding. V2 pedagogy is the CRDT mechanics; richer editors would obscure them. CodeMirror is V3 if it earns its keep. |
| Q15 | Wire protocol — y-websocket binary or roll our own JSON op protocol? | **y-websocket binary.** Canonical, free reconnect-with-sync, free awareness channel for V2.1 presence. |
| Q16 | Multi-document / rooms? | **No, single hardcoded `doc`** in V2 — `docName="doc"` in `setupWSConnection`. URL-based multi-doc routing is V2.1. |
| Q17 | Authentication? | **None.** Same as V1; out of scope. |
| Q18 | Persistence directory layout? | **`./data/yjs`** under repo root by default; configurable via `PERSIST_DIR`. Single LevelDB instance covering all docs. Compaction is Yjs-internal (`gc: true`). |
| Q19 | Server-side y-websocket utility — vendored copy or library import? | **Library import** of `y-websocket/bin/utils.js` (the canonical CommonJS helper). If ESM interop becomes painful we vendor it as `src/server/y-websocket-utils.ts` (~150 lines, mostly deserialization plumbing). |
| Q20 | Room from URL path, query string, or hash? | **URL path** (`/ws/<room>`) for the WebSocket endpoint and **hash** (`/#room`) for the page. Path keeps the WS protocol RESTful; hash on the page lets the user switch rooms without a full HTTP navigation. |
| Q21 | Allowed room name characters? | **`[A-Za-z0-9_-]{1,64}`** — alphanumeric + hyphen + underscore, capped at 64 chars. The server rejects others with HTTP 400 on the upgrade. |
| Q22 | Presence: visual cursor overlays or text-only? | **Text-only in v2.1.0.** Pixel-position math against a hidden mirror `<div>` is real UI work and would dominate the v2.1.0 diff. Overlays land in v2.2.0. |
| Q23 | Per-client name + color: user-input or auto? | **Auto** — derived deterministically from the client ID, drawn from a small fixed list of names + a hex-color palette. User-supplied names are v2.2.0 (and overlap with auth concerns even if we don't add auth). |
| Q24 | Undo manager scope? | **Track local origin only** (`{ trackedOrigins: new Set([localOrigin]) }`) so remote ops are never undone — the F10 invariant. |
| Q25 | Wait for IndexedDB sync before binding? | **Yes** (DOC-121, `SHOULD`). Avoids the reload "flash empty then jump to content" paint sequence. |

---

## 8. Open Questions

| # | Question | Owner | Due |
|---|----------|-------|-----|
| *(none outstanding for V2)* | | | |

---

## 9. Revision History

| Version | Date       | Author        | Notes |
|---------|------------|---------------|-------|
| 0.1     | 2026-05-01 | Steve Weiland | Initial V1 draft — WebSocket, last-write-wins on full document, in-memory state, single document. F1–F5 documented as deliberate V1 failure modes. |
| 0.2     | 2026-05-02 | Steve Weiland | V2: Yjs CRDT (Y.Doc + Y.Text), y-websocket binary protocol, y-leveldb persistence, WebsocketProvider reconnect-with-state-sync. F1 inverted (converge), F2 inverted (offline reconcile), F3 inverted (cursor preserved), F4 inverted (persist across restart). New §3.6 / §3.7 / §3.8; OPS-11/12/13/14/21/22/23 rewritten or removed. Resolved Q12–Q19. |
| 0.3     | 2026-05-02 | Steve Weiland | v2.1.0: multi-doc routing (DOC-03/12/24/25, §3.9), awareness presence (§3.10), `Y.UndoManager` for local-only undo/redo (§3.11), `y-indexeddb` offline-first persistence (§3.12). F8-F11 added as feature-presence tests. Resolved Q20-Q25. |
