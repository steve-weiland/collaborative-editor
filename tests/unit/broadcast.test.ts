import { describe, it, expect } from 'vitest';
import { broadcast, type BroadcastTarget } from '../../src/server/broadcast';

class FakeClient implements BroadcastTarget {
  readonly received: string[] = [];
  constructor(public readyState: number = 1 /* OPEN */) {}
  send(data: string): void { this.received.push(data); }
}

describe('broadcast', () => {
  it('sends a doc message to every other open client', () => {
    const a = new FakeClient();
    const b = new FakeClient();
    const c = new FakeClient();
    const sent = broadcast('hello', a, [a, b, c]);
    expect(sent).toBe(2);
    expect(a.received).toEqual([]);
    expect(b.received).toEqual([JSON.stringify({ type: 'doc', text: 'hello' })]);
    expect(c.received).toEqual([JSON.stringify({ type: 'doc', text: 'hello' })]);
  });

  it('skips clients that are not in the OPEN state', () => {
    const sender = new FakeClient();
    const open = new FakeClient(1);
    const closing = new FakeClient(2 /* CLOSING */);
    const closed = new FakeClient(3 /* CLOSED */);
    const sent = broadcast('hi', sender, [sender, open, closing, closed]);
    expect(sent).toBe(1);
    expect(open.received).toHaveLength(1);
    expect(closing.received).toEqual([]);
    expect(closed.received).toEqual([]);
  });

  it('handles a null sender (broadcast to all)', () => {
    const a = new FakeClient();
    const b = new FakeClient();
    const sent = broadcast('all', null, [a, b]);
    expect(sent).toBe(2);
    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
  });

  it('returns 0 when there are no other clients', () => {
    const a = new FakeClient();
    const sent = broadcast('lonely', a, [a]);
    expect(sent).toBe(0);
  });
});
