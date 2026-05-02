import type { Awareness } from 'y-protocols/awareness';

/**
 * Per-client awareness state. Published over the y-websocket awareness
 * channel; each connected client sees every other client's state.
 */
export interface PresenceState {
  name: string;
  color: string;
  cursor: number | null;
}

/** Eight visually-distinct hex colors. Picked by client ID. */
const COLORS = [
  '#e6194B', '#3cb44b', '#dba100', '#4363d8',
  '#f58231', '#911eb4', '#42d4f4', '#f032e6',
];

/** Ten anonymous handles. Picked by client ID and disambiguated with a 3-digit suffix. */
const NAMES = [
  'Alice', 'Bob', 'Carol', 'Dave', 'Eve',
  'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy',
];

/**
 * Pick a deterministic name + color for a client based on its ID.
 * Same ID → same identity, every time.
 */
export function identityForClient(clientId: number): { name: string; color: string } {
  const baseName = NAMES[clientId % NAMES.length];
  const suffix = clientId % 1000;
  return {
    name: `${baseName}-${suffix.toString().padStart(3, '0')}`,
    color: COLORS[clientId % COLORS.length],
  };
}

/**
 * Wire up the awareness channel: publish our identity + cursor, render
 * everyone else's identity + cursor in `footer` whenever the awareness
 * map changes.
 *
 * Returns a teardown.
 */
export function setupPresence(
  aw: Awareness,
  textarea: HTMLTextAreaElement,
  footer: HTMLElement,
): () => void {
  const me = aw.clientID;
  const { name, color } = identityForClient(me);
  aw.setLocalStateField('name', name);
  aw.setLocalStateField('color', color);
  aw.setLocalStateField('cursor', null);

  // Cursor updates on selection change. Debounced so a held arrow key
  // doesn't flood the awareness channel.
  let pending: number | null = null;
  const onSelectionChange = (): void => {
    if (pending !== null) return;
    pending = window.setTimeout(() => {
      pending = null;
      const focused = document.activeElement === textarea;
      aw.setLocalStateField('cursor', focused ? textarea.selectionStart : null);
    }, 50);
  };
  document.addEventListener('selectionchange', onSelectionChange);
  // Also clear cursor on blur — selectionchange isn't always reliable on focus exit.
  textarea.addEventListener('blur', () => aw.setLocalStateField('cursor', null));

  const renderFooter = (): void => {
    const lis: string[] = [];
    aw.getStates().forEach((state, clientId) => {
      if (clientId === me) return;
      const s = state as Partial<PresenceState>;
      const cursorTxt =
        s.cursor === null || s.cursor === undefined ? '·' : `@${s.cursor}`;
      const safeName = (s.name ?? '?').replace(/[<>&]/g, '');
      const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(s.color ?? '') ? s.color : '#888';
      lis.push(`<li><span class="dot" style="background:${safeColor}"></span>${safeName} ${cursorTxt}</li>`);
    });
    footer.innerHTML = lis.length ? lis.join('') : '<li class="empty">no other clients</li>';
  };
  renderFooter();
  aw.on('change', renderFooter);

  return () => {
    document.removeEventListener('selectionchange', onSelectionChange);
    aw.off('change', renderFooter);
    if (pending !== null) clearTimeout(pending);
  };
}
