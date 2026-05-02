# Real-Time Collaborative Editor — V1

| Field   | Value         |
|---------|---------------|
| Version | 0.1 (draft)   |
| Author  | Steve Weiland |
| Date    | 2026-05-01    |
| Status  | Draft         |

---

## 1. Overview

V1 is a deliberately-naive WebSocket-driven shared text editor. One process, one
hardcoded document, multiple browser tabs. Every keystroke ships the **full
current document text** to the server; the server overwrites its in-memory
state and broadcasts the new full text to all other connected tabs, which
replace their `<textarea>` value on receipt. The conflict-resolution model is
**last-write-wins on the entire document** — whoever's edit reaches the server
most recently wins; everyone else's keystrokes between are silently lost.

V1 works fine for one user typing in one tab, or two tabs taking strict turns.
It demonstrably fails under concurrent edits (F1), network blips (F2),
echo round-trips during fast typing (F3), and server restarts (F4); bandwidth
also scales badly with document size and client count (F5). Each failure is
the documented entry point for a V2 fix.

V2 will replace the LWW string with a **CRDT** (Yjs or Automerge), the
"send full doc" wire protocol with **operation-based diffs**, and add
**persistence** + **reconnect-with-state-sync**. The portfolio asset is
eventually a deployable live demo (Fly.io / Railway target), but deployment
itself is V2+ work.

---

## 2. Definitions

| Term | Definition |
|------|------------|
| Document | The single shared piece of text being edited |
| Document state | The server's in-memory `string` representing the latest known document text |
| Last-write-wins (LWW) | Conflict resolution rule used in V1: whoever writes most recently overwrites prior state, regardless of what was overwritten |
| Edit message | Client → server message carrying the full current textarea value |
| Doc message | Server → client message carrying the full current document state |
| Broadcast | Sending a `doc` message to every connected client other than the original sender |
| Echo | The cross-tab effect: an edit from tab A is broadcast to tab B, where it can land mid-keystroke and force a textarea replace; not echoed back to A in V1 |
| Divergence | Two clients whose textarea values differ and whose subsequent edits cannot reconcile under LWW |
| Reconnect | Client behavior after the WebSocket drops: reopen the socket and accept whatever state the server sends |
| CRDT | *(V2)* Conflict-free Replicated Data Type — a data structure whose concurrent operations commute, eliminating the need for LWW. Yjs and Automerge are the two leading text-CRDT libraries |
| Operation-based sync | *(V2)* Wire protocol that ships the *change* (insert character at offset N) rather than the entire post-change document |

---

## 3. Requirements

Requirements use [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) keywords:
**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**.

### 3.1 Components

| ID | Requirement |
|----|-------------|
| DOC-01 | The system **MUST** consist of a single Node.js backend process and any number of browser clients. |
| DOC-02 | The backend **MUST** expose a WebSocket endpoint at `/ws` and serve the built frontend bundle from the HTTP root `/`. |
| DOC-03 | V1 **MUST** support a single hardcoded document; document IDs and multi-document routing are out of scope. |

### 3.2 Backend

| ID | Requirement |
|----|-------------|
| DOC-10 | The backend **MUST** accept WebSocket upgrades on `/ws`. |
| DOC-11 | The backend **MUST** keep a single in-memory `state.text: string`, defaulting to the empty string. |
| DOC-12 | On client connect, the backend **MUST** send a `doc` message containing the current state. |
| DOC-13 | On `edit` message, the backend **MUST** overwrite `state.text` with the message payload and broadcast a `doc` message to all OTHER active connections. |
| DOC-14 | The backend **MUST NOT** persist state. A restart **MUST** reset the document to empty. *(Deliberate V1 limitation; superseded in V2.)* |
| DOC-15 | The backend **MUST** tolerate client disconnects without crashing or affecting other clients. |
| DOC-16 | The backend **MUST** ignore malformed messages (non-JSON, missing `type`, wrong `type`) without disconnecting the offending client; logging is sufficient. |

### 3.3 Frontend

| ID | Requirement |
|----|-------------|
| DOC-20 | The frontend **MUST** render a single `<textarea>` filling the viewport. |
| DOC-21 | On every `input` event, the frontend **MUST** send `{type:"edit", text:<full textarea value>}` over the WebSocket. |
| DOC-22 | On `doc` message from the server, the frontend **MUST** replace the textarea value with the server text. Cursor-position preservation is **NOT REQUIRED** in V1 and the cursor jump is documented as failure F3. |
| DOC-23 | On WebSocket disconnect, the frontend **MUST** attempt reconnection with a fixed 1-second retry interval. No state-sync logic is implemented in V1 — the server's `doc` message on reconnect is the only reconciliation, and any locally-typed text since disconnect is lost (failure F2). |

### 3.4 Wire Protocol

JSON over WebSocket text frames; UTF-8.

| ID | Requirement |
|----|-------------|
| DOC-30 | Server → client: `{ "type": "doc", "text": <string> }`. |
| DOC-31 | Client → server: `{ "type": "edit", "text": <string> }`. |
| DOC-32 | Messages **MUST NOT** carry a version, sequence number, client ID, or timestamp in V1. *(Deliberate omissions; V2 adds operation framing.)* |
| DOC-33 | Maximum frame size **SHOULD** be 1 MiB; oversize frames **MAY** be rejected. |

### 3.5 Operational

| ID | Requirement |
|----|-------------|
| DOC-40 | Default port **MUST** be `:3000`; configurable via `PORT` environment variable. |
| DOC-41 | `npm run dev` **MUST** run the backend (`tsx --watch`) and the Vite dev server with hot reload simultaneously. |
| DOC-42 | `npm run build` **MUST** produce a production frontend bundle and a compiled backend; `npm start` **MUST** run the production backend, which serves the frontend bundle as static files. |
| DOC-43 | The system **SHOULD** log on connect, disconnect, and malformed-message events; debug-level logging of every edit is **OPTIONAL**. |

---

## 4. Inputs / Outputs

### WebSocket frames

```
// Server → client (sent on connect; sent after every other client's edit)
{ "type": "doc",  "text": "Hello, world." }

// Client → server (sent on every input event)
{ "type": "edit", "text": "Hello, world!" }
```

### HTTP

```
GET /              → 200, the built frontend (HTML + JS + CSS)
GET /assets/*      → 200, hashed bundle assets (Vite output)
GET /ws            → 101 Switching Protocols  (WebSocket upgrade)
```

### CLI / env

```
PORT  (env, default 3000)  — HTTP/WebSocket port
```

---

## 5. Out of Scope

Deferred to V2 unless otherwise noted:

- CRDTs / operational transforms / any conflict-free merge
- Operation-based diff sync (V1 sends the full document on every keystroke)
- Persistence (database, filesystem, or otherwise)
- Reconnect-with-state-sync (V1 reconnect just re-fetches server state and clobbers local)
- Multiple documents / rooms / document IDs
- Authentication, sessions, user identity
- Presence cursors / user names / colored selections *(V2 stretch per study plan)*
- Undo / redo that respects remote edits *(V2 stretch)*
- Offline-first behavior with IndexedDB *(V2 stretch)*
- Rate-limiting / flood protection
- Deployment / hosting (Fly.io / Railway is the V2 portfolio milestone)

---

## 6. Deliberate V1 Failure Modes

V1 is designed to fail in these specific ways. Each is the target of a V2 fix.

| # | Failure | How to trigger | Why it happens | V2 fix |
|---|---------|----------------|----------------|--------|
| F1 | Concurrent edits lose characters | Two tabs typing simultaneously | LWW: each `edit` message overwrites the entire document; the second writer's payload clobbers the first writer's keystrokes that the first writer hadn't yet shipped | CRDT: operations commute; concurrent inserts both land |
| F2 | Network blip → divergence on reconnect | Drop network, type locally for a few seconds, reconnect | On reconnect the server sends `doc` with its last-known text; the frontend overwrites the textarea, discarding anything typed offline. Mirror case: the client missed `doc` broadcasts during the blip → its first edit after reconnect races with stale state | CRDT + persistent doc storage + state-sync on reconnect (apply local ops since last-known server state) |
| F3 | Echo cursor jump | Open tabs A and B; type fast in A | A's keystrokes are broadcast to B; each broadcast replaces B's textarea value, which forces the cursor to position 0 mid-keystroke. Symmetric in the other direction | Operation-based sync: receivers apply *insert at offset* operations and preserve their local cursor |
| F4 | Server restart wipes the doc | `Ctrl-C` the Node process | In-memory only; all clients see an empty textarea on reconnect, and their next keystroke ships their local text — which then becomes the new state for everyone | Persistence (sqlite, level, or persistent CRDT doc) |
| F5 | Bandwidth scales `O(doc_size × clients × edit_rate)` | Open 5 tabs on a 50 KB document and start typing | Each keystroke sends the full document (~50 KB), broadcast to (clients-1). At 5 chars/sec across 5 tabs: 5 × 50 KB × 5 × 4 = 5 MB/s server uplink | Operation-based diff: send only the changed bytes per edit |

The chaos test for V1 will assert F1 (the cleanest to demonstrate
deterministically with Playwright). F2–F5 are documented but not all
chaos-tested in V1; V2 may add F2–F5 chaos tests as the corresponding
mechanisms land.

---

## 7. Resolved Decisions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Frontend framework? | **Vanilla TypeScript + `<textarea>`.** V1's lesson is the protocol and conflict-resolution model, not framework choice. React (or otherwise) is V2+ if it earns its keep. |
| Q2 | WebSocket library on the server? | **`ws` (raw).** No `socket.io` magic; the V2 swap to a CRDT-aware provider (Yjs `WebsocketProvider`) is cleaner without an intermediary. |
| Q3 | Document representation? | **Plain `string`** in the server's in-memory state. V2 replaces with a CRDT instance. |
| Q4 | Multi-document? | **Single hardcoded doc** in V1. Rooms / document IDs are V2+. |
| Q5 | Authentication? | **None.** Out of scope; the WebSocket is open to any connector. |
| Q6 | Persistence? | **In-memory only.** F4 documents the failure; V2 adds storage. |
| Q7 | Test framework? | **Vitest** for unit tests; **Playwright** for two-tab concurrent-edit chaos tests. |
| Q8 | Repo layout? | **Single npm package** with `src/{server,client,shared}/`. Workspaces add ceremony not justified for V1. |
| Q9 | Deployment? | **Local dev only in V1.** Fly.io / Railway is the V2 portfolio milestone. |
| Q10 | Reconnect cadence? | **Fixed 1 s retry.** Dumb on purpose — exponential backoff is V2 hardening. |
| Q11 | Chaos test for F1 — Playwright or manual? | **Playwright e2e:** two pages connect, type concurrently, assert character loss. Same "test asserts the V1 bug; V2 inverts it" pattern as prior builds. |

---

## 8. Open Questions

| # | Question | Owner | Due |
|---|----------|-------|-----|
| *(none outstanding for V1)* | | | |

---

## 9. Revision History

| Version | Date       | Author        | Notes |
|---------|------------|---------------|-------|
| 0.1     | 2026-05-01 | Steve Weiland | Initial V1 draft — WebSocket, last-write-wins on full document, in-memory state, single document. F1-F5 documented as deliberate V1 failure modes; V2 introduces CRDTs + operation-based sync + persistence. |
