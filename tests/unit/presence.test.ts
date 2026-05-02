import { describe, it, expect } from 'vitest';
import { identityForClient } from '../../src/client/presence';

describe('identityForClient', () => {
  it('is deterministic for a given client ID', () => {
    expect(identityForClient(42)).toEqual(identityForClient(42));
    expect(identityForClient(99)).toEqual(identityForClient(99));
  });

  it('produces a name with a 3-digit zero-padded suffix', () => {
    expect(identityForClient(7).name).toMatch(/^[A-Za-z]+-007$/);
    expect(identityForClient(123).name).toMatch(/^[A-Za-z]+-123$/);
    expect(identityForClient(1000).name).toMatch(/^[A-Za-z]+-000$/);
  });

  it('produces a hex color', () => {
    expect(identityForClient(1).color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('cycles names + colors across the palette', () => {
    // 10 names × 8 colors gives 80 distinct combinations before strict
    // identity recurs (suffix wraps at 1000), so just make sure two
    // different IDs CAN differ.
    const a = identityForClient(0);
    const b = identityForClient(1);
    expect(a).not.toEqual(b);
  });
});
