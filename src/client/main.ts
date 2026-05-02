import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { bindTextareaToYText } from './textarea-binding';

/**
 * V2 frontend.
 *
 * Y.Doc + WebsocketProvider replace V1's manual JSON wire protocol. The
 * textarea is bound to `ydoc.getText('doc')` via {@link bindTextareaToYText}
 * which ships ops on local edits and preserves the cursor on remote ones.
 *
 * Reconnect is handled by WebsocketProvider — on drop it retries with
 * backoff, runs sync_step1 against the server, and applies any missed ops.
 * Local edits made while offline are buffered by the provider and shipped
 * when the connection comes back (closes V1 F2).
 */

const editor = document.getElementById('editor') as HTMLTextAreaElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;

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

// WebsocketProvider appends '/<roomname>' to the URL, so 'ws://host/ws' +
// roomname 'doc' resolves to 'ws://host/ws/doc'. The server matches any
// /ws* path and pins docName='doc' (single-doc per spec Q16).
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const provider = new WebsocketProvider(`${wsProto}//${location.host}/ws`, 'doc', ydoc);

provider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
  setStatus(event.status);
});

bindTextareaToYText(editor, ytext);
