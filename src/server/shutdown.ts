/**
 * Flush every open room's pending y-leveldb writes before exit.
 *
 * v2.0.0's shutdown flushed the single default room; v2.1.0 added
 * multi-doc routing and the flush never learned — SIGTERM could drop the
 * last keystrokes of every room EXCEPT 'doc' (the exact race the flush
 * exists to close, and F4 only exercised the default room). The doc list
 * comes from y-websocket's `docs` map so nothing hardcodes room names.
 */
export interface FlushableProvider {
  flushDocument(name: string): Promise<unknown>;
}

export async function flushAllDocs(
  provider: FlushableProvider,
  docNames: Iterable<string>,
): Promise<string[]> {
  const flushed: string[] = [];
  for (const name of docNames) {
    await provider.flushDocument(name);
    flushed.push(name);
  }
  return flushed;
}
