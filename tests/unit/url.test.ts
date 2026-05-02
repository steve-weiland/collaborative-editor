import { describe, it, expect } from 'vitest';
import { parseRoomFromUrl } from '../../src/server/url';

describe('parseRoomFromUrl', () => {
  it('defaults to "doc" for the bare /ws path', () => {
    expect(parseRoomFromUrl('/ws')).toBe('doc');
    expect(parseRoomFromUrl('/ws/')).toBe('doc');
  });

  it('extracts the room from /ws/<name>', () => {
    expect(parseRoomFromUrl('/ws/meeting-notes')).toBe('meeting-notes');
    expect(parseRoomFromUrl('/ws/abc_123')).toBe('abc_123');
    expect(parseRoomFromUrl('/ws/A')).toBe('A');
  });

  it('strips a trailing slash', () => {
    expect(parseRoomFromUrl('/ws/foo/')).toBe('foo');
  });

  it('ignores query strings', () => {
    expect(parseRoomFromUrl('/ws/foo?x=y')).toBe('foo');
    expect(parseRoomFromUrl('/ws?x=y')).toBe('doc');
  });

  it('rejects names with disallowed characters', () => {
    expect(parseRoomFromUrl('/ws/has space')).toBeNull();
    expect(parseRoomFromUrl('/ws/has/slash')).toBeNull();
    expect(parseRoomFromUrl('/ws/dot.dot')).toBeNull();
    expect(parseRoomFromUrl('/ws/percent%20')).toBeNull();
  });

  it('rejects names longer than 64 chars', () => {
    expect(parseRoomFromUrl('/ws/' + 'a'.repeat(64))).toBe('a'.repeat(64));
    expect(parseRoomFromUrl('/ws/' + 'a'.repeat(65))).toBeNull();
  });

  it('returns null for non-/ws paths', () => {
    expect(parseRoomFromUrl('/')).toBeNull();
    expect(parseRoomFromUrl('/socket')).toBeNull();
    expect(parseRoomFromUrl('/wsx')).toBeNull();
    expect(parseRoomFromUrl('/api/ws/foo')).toBeNull();
  });
});
