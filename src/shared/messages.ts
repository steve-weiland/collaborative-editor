/**
 * Wire protocol for V1.
 *
 * All frames are JSON over WebSocket text frames. No version field, no
 * sequence number, no client ID — those are deliberate omissions documented
 * in spec.md DOC-32 and added in V2 alongside the CRDT.
 */

/** Server → client. Sent on connect and after every other client's edit. */
export interface DocMessage {
  type: 'doc';
  text: string;
}

/** Client → server. Sent on every textarea input event. */
export interface EditMessage {
  type: 'edit';
  text: string;
}

export type ServerMessage = DocMessage;
export type ClientMessage = EditMessage;

/** Returns true if x has the shape of a {@link ClientMessage}. */
export function isClientMessage(x: unknown): x is ClientMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return m.type === 'edit' && typeof m.text === 'string';
}
