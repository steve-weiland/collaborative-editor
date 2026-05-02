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
 * Same ID → same identity, every time. The name is the v2.1.0 fallback;
 * v2.2.0 lets the user override it (DOC-104). Color stays auto (DOC-105).
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
 * v2.2.0 user-supplied name persistence (DOC-104). Stored per-browser;
 * not synced across devices because v2.2.0 has no auth.
 */
const NAME_STORAGE_KEY = 'collab-editor:name';

export function loadStoredName(): string | null {
  try {
    const v = localStorage.getItem(NAME_STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function saveStoredName(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(NAME_STORAGE_KEY, value);
    else localStorage.removeItem(NAME_STORAGE_KEY);
  } catch {
    /* ignore — Safari private mode etc. */
  }
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
  const { name: autoName, color } = identityForClient(me);
  const initialName = loadStoredName() ?? autoName;
  aw.setLocalStateField('name', initialName);
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

/**
 * v2.2.0 — wire a name `<input>` to the awareness channel + localStorage
 * (DOC-104). On input (debounced 150 ms) the new value is persisted and
 * pushed onto the awareness state so other clients see the change. An
 * empty input falls back to the auto-derived `Alice-042`-style handle.
 *
 * Returns a teardown.
 */
export function setupName(aw: Awareness, input: HTMLInputElement): () => void {
  const stored = loadStoredName();
  if (stored) input.value = stored;

  let pending: number | null = null;
  const onInput = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = window.setTimeout(() => {
      pending = null;
      const v = input.value.trim();
      saveStoredName(v);
      const fallback = identityForClient(aw.clientID).name;
      aw.setLocalStateField('name', v || fallback);
    }, 150);
  };
  input.addEventListener('input', onInput);

  return () => {
    input.removeEventListener('input', onInput);
    if (pending !== null) clearTimeout(pending);
  };
}
