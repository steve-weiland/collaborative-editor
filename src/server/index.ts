import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { parseRoomFromUrl } from './url.js';

const PORT = Number(process.env.PORT ?? 3001);
const PERSIST_DIR = process.env.PERSIST_DIR ?? './data/yjs';

// y-websocket/bin/utils inspects YPERSISTENCE at module-load time and binds
// y-leveldb if it's set, so the env var MUST be set before the dynamic
// import below evaluates the module.
fs.mkdirSync(PERSIST_DIR, { recursive: true });
process.env.YPERSISTENCE = PERSIST_DIR;

// Dynamic import so the YPERSISTENCE assignment above runs first. The /bin
// helpers ship as CommonJS in y-websocket@1.5; ESM interop yields the
// exports under both `default` and named.
// y-websocket@1.5's package.json exports map publishes the helper as
// './bin/utils' (without the .js extension), so we import via that path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// @ts-ignore
const utils: any = await import('y-websocket/bin/utils');
const setupWSConnection: (
  ws: unknown,
  req: http.IncomingMessage,
  opts?: { docName?: string; gc?: boolean },
) => void = utils.setupWSConnection ?? utils.default?.setupWSConnection;

if (typeof setupWSConnection !== 'function') {
  throw new Error('y-websocket/bin/utils.js did not export setupWSConnection');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_ROOT = path.resolve(__dirname, '../../client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const httpServer = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400).end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(STATIC_ROOT, pathname);
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `404 not found — ${pathname}\n` +
          `(in dev, the frontend lives on Vite's dev server at http://localhost:5173)\n`,
      );
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

// v2.1.0: extract the room name from the URL path; reject malformed names
// with HTTP 400. /ws → 'doc' (back-compat); /ws/foo → 'foo'.
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const room = parseRoomFromUrl(req.url ?? '');
  if (room === null) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    setupWSConnection(ws, req, { docName: room, gc: true });
  });
});

httpServer.listen(PORT, () => {
  console.log(`collaborative-editor V2 listening on :${PORT} persist=${PERSIST_DIR}`);
});

// On SIGTERM/SIGINT we MUST flush y-leveldb's pending writes before exiting,
// otherwise updates that were `storeUpdate`-ed asynchronously can be lost
// (their underlying `level.put` resolves after we've already process.exit()ed).
// Without this, F4 — persists across server restart — hits a race where the
// new server boots a doc that's missing the last few keystrokes.
async function shutdown(): Promise<void> {
  console.log('shutting down');
  wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((res) => httpServer.close(() => res()));
  try {
    const persistence = utils.getPersistence?.();
    const provider = persistence?.provider;
    if (provider?.flushDocument) {
      await provider.flushDocument('doc');
    }
    if (provider?.destroy) {
      await provider.destroy();
    }
  } catch (e) {
    console.warn('persistence flush failed', e);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
