import { describe, it, expect } from 'vitest';
import { DocumentState } from '../../src/server/state';

describe('DocumentState', () => {
  it('starts empty (DOC-11)', () => {
    expect(new DocumentState().text()).toBe('');
  });

  it('setText overwrites the entire current text (LWW)', () => {
    const s = new DocumentState();
    s.setText('hello');
    expect(s.text()).toBe('hello');
    s.setText('world');
    expect(s.text()).toBe('world');
  });

  it('setText with empty string clears the document', () => {
    const s = new DocumentState();
    s.setText('not empty');
    s.setText('');
    expect(s.text()).toBe('');
  });

  it('keeps no history — V1 is intentionally lossy', () => {
    // This is a property test of sorts: there's no API to recover prior
    // text. F1's lost-characters bug is a direct consequence of this.
    const s = new DocumentState();
    s.setText('original');
    s.setText('clobbered');
    expect((s as unknown as { history?: unknown }).history).toBeUndefined();
  });
});
