import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { bindTextareaToYText } from './textarea-binding';
import { setupPresence, setupName } from './presence';
import { setupUndo } from './undo';
import { CursorOverlay } from './cursor-overlay';

/**
 * v2.1.0 frontend.
 *
 * - Room is read from `location.hash` (`#meeting-notes` → room
 *   `'meeting-notes'`); empty defaults to `'doc'`.
 * - `IndexeddbPersistence` loads the doc client-side BEFORE the
 *   WebsocketProvider connects, so reload-with-content shows immediately.
 * - WebsocketProvider syncs to `ws://host/ws/<room>`; the server routes by
 *   path (DOC-12).
 * - Awareness publishes `{ name, color, cursor }` per client; the footer
 *   shows everyone else.
 * - Y.UndoManager scopes undo to local-origin transactions only, so
 *   Ctrl/Cmd+Z never undoes someone else's edits.
 */

const editor = document.getElementById('editor') as HTMLTextAreaElement;
const editorWrap = document.getElementById('editor-wrap') as HTMLElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const roomLabel = document.getElementById('room-label') as HTMLElement;
const roomInput = document.getElementById('room-input') as HTMLInputElement;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const presenceFooter = document.getElementById('presence') as HTMLElement;

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const room = (() => {
  const fromHash = location.hash.replace(/^#/, '');
  if (fromHash && ROOM_RE.test(fromHash)) return fromHash;
  return 'doc';
})();
roomLabel.textContent = `room: ${room}`;

function setStatus(state: 'connecting' | 'connected' | 'disconnected'): void {
  statusDot.classList.remove('connected', 'disconnected');
  if (state === 'connected') statusDot.classList.add('connected');
  if (state === 'disconnected') statusDot.classList.add('disconnected');
  statusText.textContent =
    state === 'connecting' ? 'connecting…' :
    state === 'connected' ? 'connected' :
    'disconnected — retrying…';
}

const ydoc = new Y.Doc();
const ytext = ydoc.getText('doc');

// IndexedDB first — populates the Y.Doc with whatever was saved last time
// before the textarea is wired up. F11 / DOC-122.
const idb = new IndexeddbPersistence(`collab-editor:${room}`, ydoc);
await new Promise<void>((res) => {
  if (idb.synced) return res();
  idb.once('synced', () => res());
});

// Now wire up the network and the UI.
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const provider = new WebsocketProvider(`${wsProto}//${location.host}/ws`, room, ydoc);

provider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
  setStatus(event.status);
});

bindTextareaToYText(editor, ytext);
setupPresence(provider.awareness, editor, presenceFooter);
setupName(provider.awareness, nameInput);
setupUndo(ytext, editor);
new CursorOverlay(editor, editorWrap, provider.awareness);

// Test hook: e2e tests need to read the local awareness clientID from
// the OTHER tab to assert the overlay is keyed correctly. (F12.)
(window as unknown as { __yProvider: WebsocketProvider }).__yProvider = provider;

// Room switcher: Enter in the input → location.hash → reload (DOC-25).
roomInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Enter') return;
  const v = roomInput.value.trim();
  if (!v) return;
  if (!ROOM_RE.test(v)) {
    roomInput.setCustomValidity('letters, digits, _ and - only; up to 64 chars');
    roomInput.reportValidity();
    return;
  }
  location.hash = v;
  // hashchange triggers a reload below, which re-creates everything for the new room.
});
window.addEventListener('hashchange', () => location.reload());
