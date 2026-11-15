// Tiny static file server: node tools/serve.mjs [port]
// Used for local development and as the web server when hosted (it reads PORT).
// WebHID needs a secure context: https on a host, or http://localhost locally.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2]) || Number(process.env.PORT) || 5173;
// Only the app itself is served: nothing else in the repository is reachable.
const PUBLIC = new Set(['index.html', 'css', 'js', 'assets']);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  const top = path.split('/').filter(Boolean)[0];
  if (!file.startsWith(root + sep) || !PUBLIC.has(top) || path.includes('/.')) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, () => console.log(`Aula in Chrome listening on port ${port}`));
