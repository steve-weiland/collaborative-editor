import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { isClientMessage, type DocMessage } from '../shared/messages.js';
import { DocumentState } from './state.js';
import { broadcast } from './broadcast.js';

const PORT = Number(process.env.PORT ?? 3001);

const state = new DocumentState();

// __dirname-equivalent in ESM. In production the compiled file lives at
// dist/server/server/index.js; the Vite-built frontend lives at dist/client/.
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
  // Cheap path-traversal guard.
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

// WebSocket server attached manually via the HTTP upgrade event so that
// non-/ws upgrade attempts get a clean 404 rather than being accepted.
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  // DOC-12: send the current state on connect.
  const initial: DocMessage = { type: 'doc', text: state.text() };
  ws.send(JSON.stringify(initial));
  console.log(`[connect] clients=${wss.clients.size}`);

  ws.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      // DOC-16: log + ignore.
      console.warn('[malformed] non-JSON');
      return;
    }
    if (!isClientMessage(parsed)) {
      console.warn('[malformed] not a ClientMessage');
      return;
    }
    // DOC-13: overwrite state, broadcast to others.
    state.setText(parsed.text);
    broadcast(state.text(), ws, wss.clients);
  });

  ws.on('close', () => {
    console.log(`[disconnect] clients=${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.warn('[ws-error]', err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`collaborative-editor V1 listening on :${PORT}`);
});

// Graceful shutdown so `npm run dev`'s tsx --watch can restart cleanly.
function shutdown(): void {
  console.log('shutting down');
  wss.clients.forEach((c) => c.terminate());
  httpServer.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
