import * as Y from 'yjs';

/**
 * Origin tag attached to local-edit transactions. Used by Y.UndoManager's
 * `trackedOrigins` to scope the undo stack to local ops only — remote
 * updates from the WebsocketProvider have a different origin (the provider
 * instance) and are not tracked, so a local Undo never undoes someone
 * else's edits. (DOC-111, DOC-113)
 */
export const localOrigin = Symbol('local-origin');

/**
 * Binds a `<textarea>` to a `Y.Text` so they stay in sync:
 *
 * - Local `input` events become `Y.Text.insert`/`Y.Text.delete` ops via a
 *   prefix-suffix diff. Each local edit is wrapped in a transaction tagged
 *   with {@link localOrigin} so the UndoManager can scope to local ops.
 * - Remote `Y.Text` ops update the textarea while preserving the user's
 *   cursor position via {@link Y.RelativePosition} (closes V1 F3 — cursor
 *   no longer jumps to position 0 on every remote echo).
 *
 * Returns a teardown function.
 */
export function bindTextareaToYText(
  textarea: HTMLTextAreaElement,
  ytext: Y.Text,
): () => void {
  let applyingRemote = false;

  // Initial sync — pull whatever the Y.Text already contains.
  textarea.value = ytext.toString();

  const onInput = (): void => {
    if (applyingRemote) return;
    const newValue = textarea.value;
    const oldValue = ytext.toString();
    if (newValue === oldValue) return;

    // Smallest-possible diff: shared prefix, shared suffix, replace the middle.
    let prefix = 0;
    const minLen = Math.min(oldValue.length, newValue.length);
    while (prefix < minLen && oldValue[prefix] === newValue[prefix]) prefix++;

    let suffix = 0;
    while (
      suffix < oldValue.length - prefix &&
      suffix < newValue.length - prefix &&
      oldValue[oldValue.length - 1 - suffix] === newValue[newValue.length - 1 - suffix]
    ) {
      suffix++;
    }

    const removed = oldValue.length - prefix - suffix;
    const inserted = newValue.slice(prefix, newValue.length - suffix);

    ytext.doc!.transact(() => {
      if (removed > 0) ytext.delete(prefix, removed);
      if (inserted.length > 0) ytext.insert(prefix, inserted);
    }, localOrigin);
  };
  textarea.addEventListener('input', onInput);

  // Cursor preservation needs the relative position captured BEFORE the
  // remote op is applied — otherwise we're computing it against the
  // already-updated Y.Text and end up pointing at the wrong logical
  // character. We hook beforeTransaction for that, observe for the
  // post-update value swap + cursor restore.
  let savedRelStart: Y.RelativePosition | null = null;
  let savedRelEnd: Y.RelativePosition | null = null;

  // "Remote-shaped" = anything not produced by the local input handler.
  // That covers BOTH provider updates from peers AND undo/redo ops produced
  // by Y.UndoManager (whose origin is the UndoManager instance, not us).
  // We still need to swap textarea.value and adjust the cursor for those.
  const isRemoteShaped = (transaction: Y.Transaction): boolean =>
    transaction.origin !== localOrigin;

  const beforeTransaction = (transaction: Y.Transaction): void => {
    if (!isRemoteShaped(transaction)) return;
    savedRelStart = Y.createRelativePositionFromTypeIndex(ytext, textarea.selectionStart);
    savedRelEnd = Y.createRelativePositionFromTypeIndex(ytext, textarea.selectionEnd);
  };
  ytext.doc!.on('beforeTransaction', beforeTransaction);

  const observer = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
    if (!isRemoteShaped(transaction)) return;

    applyingRemote = true;
    try {
      textarea.value = ytext.toString();
    } finally {
      applyingRemote = false;
    }

    if (savedRelStart && savedRelEnd) {
      const ydoc = ytext.doc!;
      const newStart = Y.createAbsolutePositionFromRelativePosition(savedRelStart, ydoc);
      const newEnd = Y.createAbsolutePositionFromRelativePosition(savedRelEnd, ydoc);
      if (newStart && newEnd) {
        textarea.setSelectionRange(newStart.index, newEnd.index);
      }
    }
    savedRelStart = null;
    savedRelEnd = null;
  };
  ytext.observe(observer);

  return () => {
    textarea.removeEventListener('input', onInput);
    ytext.unobserve(observer);
    ytext.doc!.off('beforeTransaction', beforeTransaction);
  };
}

/**
 * Internal — exported for unit tests. Computes the smallest insert/delete
 * pair that turns {@code oldValue} into {@code newValue}.
 */
export function diff(oldValue: string, newValue: string): {
  prefix: number;
  removed: number;
  inserted: string;
} {
  let prefix = 0;
  const minLen = Math.min(oldValue.length, newValue.length);
  while (prefix < minLen && oldValue[prefix] === newValue[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < oldValue.length - prefix &&
    suffix < newValue.length - prefix &&
    oldValue[oldValue.length - 1 - suffix] === newValue[newValue.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    prefix,
    removed: oldValue.length - prefix - suffix,
    inserted: newValue.slice(prefix, newValue.length - suffix),
  };
}
