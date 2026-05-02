/**
 * V1 in-memory document state. A bare wrapper around a string so the tests
 * can instantiate it independently of the HTTP/WebSocket layer.
 *
 * Spec: DOC-11 (default empty), DOC-14 (no persistence).
 */
export class DocumentState {
  private current = '';

  text(): string {
    return this.current;
  }

  /**
   * Last-write-wins overwrite. The whole point of V1 — whatever the caller
   * passes becomes the new state, no merging, no diffing.
   */
  setText(text: string): void {
    this.current = text;
  }
}
