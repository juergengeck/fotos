#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const host = args.host || '127.0.0.1';
const port = Number(args.port || process.env.PORT || '5518');
const rootDir = path.resolve(args.root || process.env.BROWSER_DIST_DIR || '.');
const indexPath = path.join(rootDir, 'index.html');

if (!Number.isInteger(port) || port <= 0) {
  console.error(`[browser-static-server] Invalid port: ${args.port}`);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  console.error(`[browser-static-server] Browser dist not found at ${indexPath}`);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || 'application/octet-stream';

  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    'Content-Type': contentType,
  });

  fs.createReadStream(filePath)
    .on('error', error => {
      console.error(`[browser-static-server] Failed to read ${filePath}: ${error.message}`);
      if (!response.headersSent) {
        response.writeHead(500, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/plain; charset=utf-8',
        });
      }
      response.end('Internal Server Error');
    })
    .pipe(response);
}

function resolveRequestPath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname || '/');
  const normalizedPath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const safeRelativePath = path.normalize(normalizedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(rootDir, safeRelativePath);
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

  if (requestUrl.pathname === '/health') {
    sendJson(response, 200, {
      root: rootDir,
      status: 'running',
      timestamp: Date.now(),
      uptime: process.uptime(),
    });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Method Not Allowed');
    return;
  }

  const candidatePath = resolveRequestPath(requestUrl.pathname);
  fs.stat(candidatePath, (error, stats) => {
    if (!error && stats.isFile()) {
      sendFile(response, candidatePath);
      return;
    }

    sendFile(response, indexPath);
  });
});

server.listen(port, host, () => {
  console.log(`[browser-static-server] Serving ${rootDir} at http://${host}:${port}`);
});
