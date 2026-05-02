/**
 * Parse a WebSocket upgrade URL into a room name (= y-websocket docName).
 *
 * - `/ws`              → `'doc'`  (back-compat default)
 * - `/ws/`             → `'doc'`
 * - `/ws/foo`          → `'foo'`
 * - `/ws/foo?x=y`      → `'foo'`
 * - `/ws/Bad Name`     → `null`   (rejected → server returns HTTP 400)
 * - anything not under `/ws` → `null`
 *
 * Allowed room characters: `[A-Za-z0-9_-]`, length 1..64.
 */
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoomFromUrl(url: string): string | null {
  // Match the /ws prefix, optionally followed by /<room>, then anything
  // (query string, trailing slash) until end.
  const m = url.match(/^\/ws(?:\/([^?]*))?(?:\?.*)?$/);
  if (!m) return null;
  const raw = (m[1] ?? '').replace(/\/$/, '');
  if (raw === '') return 'doc';
  return ROOM_RE.test(raw) ? raw : null;
}
