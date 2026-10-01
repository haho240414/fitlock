#!/usr/bin/env node
// 의존성 없는 정적 서버. app/ 를 루트로 서비스하고, 개발용으로 /test/ 와 /tools/ 도 연다.
//   node tools/serve.mjs [--port 8860] [--host 127.0.0.1]
// 카메라(getUserMedia)는 https 또는 localhost 에서만 동작한다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

export function createServer({ dev = true } = {}) {
  const mounts = [['/', path.join(ROOT, 'app')]];
  if (dev) mounts.unshift(['/test/', path.join(ROOT, 'test')], ['/tools/', path.join(ROOT, 'tools')]);

  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const [prefix, base] = mounts.find(([p]) => pathname.startsWith(p));
    let file = path.join(base, pathname.slice(prefix.length));
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        file = path.join(file, 'index.html');
        try { st = fs.statSync(file); err = null; } catch (e) { err = e; }
      }
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      };
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) { // 영상 탐색(seek)에 필요
        let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
        let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
        start = Math.max(0, start);
        end = Math.min(end, st.size - 1);
        if (start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
          return;
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : def;
  };
  const port = Number(arg('--port', process.env.PORT || 8870));
  const host = arg('--host', '127.0.0.1');
  createServer().listen(port, host, () => {
    console.log(`핏락 개발 서버: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  });
}
