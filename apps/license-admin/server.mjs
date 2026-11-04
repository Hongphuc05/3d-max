import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import sessionHandler from './api/session.js';
import issueLicenseHandler from './api/issue-license.js';
import { validateLocalConfig } from './server/local-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// 1. Tự động đọc file .env hoặc .env.local nếu có
for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      }
    } catch {
      throw new Error(`Cannot load configuration file ${envFile}.`);
    }
  }
}

// Existing signing keys and credentials must be explicitly configured.
validateLocalConfig(process.env);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function handleRequest(req, res) {
  const origin = `http://${req.headers.host || 'localhost:3001'}`;
  const url = new URL(req.url, origin);

  // API Routes
  if (url.pathname.startsWith('/api/')) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : null,
      duplex: hasBody ? 'half' : undefined,
    });

    let webResponse;
    if (url.pathname === '/api/session') {
      webResponse = await sessionHandler.fetch(webRequest);
    } else if (url.pathname === '/api/issue-license') {
      webResponse = await issueLicenseHandler.fetch(webRequest);
    } else {
      webResponse = new Response(JSON.stringify({ error: 'Endpoint not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((val, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        if (typeof webResponse.headers.getSetCookie === 'function') {
          res.setHeader('Set-Cookie', webResponse.headers.getSetCookie());
        } else {
          res.setHeader(key, val);
        }
      } else {
        res.setHeader(key, val);
      }
    });

    if (webResponse.body) {
      Readable.fromWeb(webResponse.body).pipe(res);
    } else {
      res.end();
    }
    return;
  }

  // Static files in public/
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[license-admin error]', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  });
});

const HOST = process.env.LICENSE_ADMIN_HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`[license-admin] Listening on ${HOST}:${PORT}`);
});
