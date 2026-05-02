import type { DocMessage } from '../shared/messages.js';

/**
 * Minimal interface a "client" must satisfy to receive a broadcast. The
 * real {@code ws.WebSocket} has both these properties; tests can supply
 * fakes.
 */
export interface BroadcastTarget {
  send(data: string): void;
  readonly readyState: number;
}

/** {@code WebSocket.OPEN} value (1). Defined here so this module has no ws dep. */
const OPEN = 1;

/**
 * Send the current document text as a {@link DocMessage} to every target
 * other than {@code except}. Skips targets that are not in the OPEN state.
 * Returns the number of frames actually sent (mostly for diagnostics + tests).
 */
export function broadcast(
  text: string,
  except: BroadcastTarget | null,
  clients: Iterable<BroadcastTarget>,
): number {
  const payload: DocMessage = { type: 'doc', text };
  const json = JSON.stringify(payload);
  let sent = 0;
  for (const c of clients) {
    if (c === except) continue;
    if (c.readyState !== OPEN) continue;
    c.send(json);
    sent++;
  }
  return sent;
}
