import * as Y from 'yjs';
import { localOrigin } from './textarea-binding';

/**
 * Wires `⌘/Ctrl+Z` (undo) and `⌘/Ctrl+Shift+Z` / `Ctrl+Y` (redo) on the
 * textarea to a `Y.UndoManager` scoped to local ops only — remote updates
 * have a different origin (the WebsocketProvider) and are not tracked, so
 * Undo never affects what other users typed (DOC-113 / F10).
 *
 * Returns a teardown function.
 */
export function setupUndo(ytext: Y.Text, target: HTMLTextAreaElement): () => void {
  const um = new Y.UndoManager(ytext, {
    trackedOrigins: new Set([localOrigin]),
  });

  const onKeydown = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      um.undo();
    } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
      e.preventDefault();
      um.redo();
    }
  };
  target.addEventListener('keydown', onKeydown);

  return () => {
    target.removeEventListener('keydown', onKeydown);
    um.destroy();
  };
}
