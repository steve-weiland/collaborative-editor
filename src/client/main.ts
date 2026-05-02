import type { ClientMessage, ServerMessage } from '../shared/messages';

/**
 * V1 frontend.
 *
 * Single textarea. On every input event we ship the textarea's full value
 * to the server. On every doc message from the server we replace the
 * textarea's value with the server's text.
 *
 * No cursor preservation, no buffering, no version vector. The naïveté is
 * the point — see spec.md §6 F1–F5.
 */

const editor = document.getElementById('editor') as HTMLTextAreaElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;

const RECONNECT_DELAY_MS = 1000;

let socket: WebSocket | null = null;

function setStatus(state: 'connecting' | 'connected' | 'disconnected'): void {
  statusDot.classList.remove('connected', 'disconnected');
  if (state === 'connected') statusDot.classList.add('connected');
  if (state === 'disconnected') statusDot.classList.add('disconnected');
  statusText.textContent =
    state === 'connecting' ? 'connecting…' :
    state === 'connected' ? 'connected' :
    'disconnected — retrying…';
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function connect(): void {
  setStatus('connecting');
  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.addEventListener('open', () => {
    setStatus('connected');
  });

  ws.addEventListener('message', (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data) as ServerMessage;
    } catch {
      console.warn('[malformed server frame]', event.data);
      return;
    }
    if (msg.type === 'doc') {
      // DOC-22: replace textarea value with server text. Cursor jump is
      // documented as F3 — V1 does NOT preserve cursor position.
      editor.value = msg.text;
    }
  });

  ws.addEventListener('close', () => {
    setStatus('disconnected');
    socket = null;
    // DOC-23: fixed 1 s retry, no state-sync logic.
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.addEventListener('error', () => {
    // 'close' will fire after this; let the close handler drive reconnect.
  });
}

editor.addEventListener('input', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  // DOC-21: send the full textarea value on every input event.
  const msg: ClientMessage = { type: 'edit', text: editor.value };
  socket.send(JSON.stringify(msg));
});

connect();
