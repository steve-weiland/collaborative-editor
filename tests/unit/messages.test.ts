import { describe, it, expect } from 'vitest';
import { isClientMessage } from '../../src/shared/messages';

describe('isClientMessage', () => {
  it('accepts a well-formed edit', () => {
    expect(isClientMessage({ type: 'edit', text: 'hello' })).toBe(true);
    expect(isClientMessage({ type: 'edit', text: '' })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage(undefined)).toBe(false);
    expect(isClientMessage('edit')).toBe(false);
    expect(isClientMessage(42)).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(isClientMessage({ type: 'doc', text: '' })).toBe(false);
    expect(isClientMessage({ type: 'delete', text: '' })).toBe(false);
    expect(isClientMessage({ text: 'hi' })).toBe(false);
  });

  it('rejects edits with wrong text type', () => {
    expect(isClientMessage({ type: 'edit', text: 42 })).toBe(false);
    expect(isClientMessage({ type: 'edit', text: null })).toBe(false);
    expect(isClientMessage({ type: 'edit' })).toBe(false);
  });
});
