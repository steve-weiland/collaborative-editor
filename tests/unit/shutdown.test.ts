import { describe, it, expect } from 'vitest';
import { flushAllDocs } from '../../src/server/shutdown.js';

describe('flushAllDocs', () => {
  it('flushes every open room, not just the default (F15)', async () => {
    const flushed: string[] = [];
    const provider = { flushDocument: async (n: string) => void flushed.push(n) };
    // What y-websocket's `docs` map holds after three rooms were opened.
    const docs = new Map<string, unknown>([['doc', 0], ['meeting-notes', 0], ['plan', 0]]);

    await flushAllDocs(provider, docs.keys());

    // Pre-fix behavior was flushDocument('doc') alone — every other room's
    // pending leveldb puts could die with the process.
    expect(flushed.sort()).toEqual(['doc', 'meeting-notes', 'plan']);
  });
});
