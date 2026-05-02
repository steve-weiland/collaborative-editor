import * as Y from 'yjs';

/**
 * Binds a `<textarea>` to a `Y.Text` so they stay in sync:
 *
 * - Local `input` events become `Y.Text.insert`/`Y.Text.delete` ops via a
 *   prefix-suffix diff.
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
    });
  };
  textarea.addEventListener('input', onInput);

  // Cursor preservation needs the relative position captured BEFORE the
  // remote op is applied — otherwise we're computing it against the
  // already-updated Y.Text and end up pointing at the wrong logical
  // character. We hook beforeTransaction for that, observe for the
  // post-update value swap + cursor restore.
  let savedRelStart: Y.RelativePosition | null = null;
  let savedRelEnd: Y.RelativePosition | null = null;

  const beforeTransaction = (transaction: Y.Transaction): void => {
    if (transaction.local) return;
    savedRelStart = Y.createRelativePositionFromTypeIndex(ytext, textarea.selectionStart);
    savedRelEnd = Y.createRelativePositionFromTypeIndex(ytext, textarea.selectionEnd);
  };
  ytext.doc!.on('beforeTransaction', beforeTransaction);

  const observer = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
    if (transaction.local) return;

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
