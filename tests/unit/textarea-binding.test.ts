import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { diff } from '../../src/client/textarea-binding';

describe('diff', () => {
  it('returns empty diff when strings are equal', () => {
    expect(diff('hello', 'hello')).toEqual({ prefix: 5, removed: 0, inserted: '' });
  });

  it('detects an append at the end', () => {
    expect(diff('hello', 'hello world')).toEqual({ prefix: 5, removed: 0, inserted: ' world' });
  });

  it('detects a prepend at the start', () => {
    expect(diff('hello', 'XYZhello')).toEqual({ prefix: 0, removed: 0, inserted: 'XYZ' });
  });

  it('detects an insert in the middle', () => {
    expect(diff('helloworld', 'hello world')).toEqual({ prefix: 5, removed: 0, inserted: ' ' });
  });

  it('detects a delete from the middle', () => {
    expect(diff('hello world', 'helloworld')).toEqual({ prefix: 5, removed: 1, inserted: '' });
  });

  it('detects a replacement in the middle', () => {
    // 'hello world' → 'hello there': shared prefix 'hello ' (6), no shared
    // suffix ('d' vs 'e'), so we remove 'world' (5) and insert 'there'.
    expect(diff('hello world', 'hello there')).toEqual({
      prefix: 6,
      removed: 5,
      inserted: 'there',
    });
  });

  it('handles full replace (no shared prefix or suffix)', () => {
    expect(diff('abc', 'xyz')).toEqual({ prefix: 0, removed: 3, inserted: 'xyz' });
  });

  it('handles a delete at the start', () => {
    expect(diff('XYZhello', 'hello')).toEqual({ prefix: 0, removed: 3, inserted: '' });
  });

  it('handles empty → non-empty', () => {
    expect(diff('', 'abc')).toEqual({ prefix: 0, removed: 0, inserted: 'abc' });
  });

  it('handles non-empty → empty', () => {
    expect(diff('abc', '')).toEqual({ prefix: 0, removed: 3, inserted: '' });
  });
});

describe('diff applied to Y.Text', () => {
  /** Apply the result of diff() to a Y.Text and return the resulting string. */
  function applyDiff(ytext: Y.Text, oldValue: string, newValue: string): string {
    const d = diff(oldValue, newValue);
    ytext.doc!.transact(() => {
      if (d.removed > 0) ytext.delete(d.prefix, d.removed);
      if (d.inserted.length > 0) ytext.insert(d.prefix, d.inserted);
    });
    return ytext.toString();
  }

  it('round-trips arbitrary edits through Y.Text', () => {
    const cases: Array<[string, string]> = [
      ['', 'hello'],
      ['hello', 'hello world'],
      ['hello world', 'hello there'],
      ['hello there', ''],
      ['', 'A'],
      ['A', 'AB'],
      ['AB', 'AXB'],
      ['AXB', 'XB'],
    ];
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('doc');
    let cur = '';
    for (const [oldValue, newValue] of cases) {
      // Sanity: the running ytext should match `oldValue` at this point.
      expect(ytext.toString()).toBe(oldValue);
      const result = applyDiff(ytext, oldValue, newValue);
      expect(result).toBe(newValue);
      cur = newValue;
    }
    expect(cur).toBe('XB');
  });
});
