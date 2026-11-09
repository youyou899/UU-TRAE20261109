/**
 * 本地开发服务器：静态文件 + /api 代理（与 Cloudflare Pages Functions 行为一致）
 * 运行：node dev-server.mjs  （或 npm run dev）
 * 访问：http://localhost:8788
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const UPSTREAM = 'https://open.bigmodel.cn';
const KEY = process.env.ZHIPU_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

const ALLOW_HOSTS = ['open.bigmodel.cn', 'bigmodel.cn', 'ufileos.com'];
const allowedHost = (h) => ALLOW_HOSTS.some((x) => h === x || h.endsWith(`.${x}`));

async function proxy(req, res, url) {
  const headers = {};
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers.accept) headers.Accept = req.headers.accept;
  const auth = req.headers.authorization || (KEY ? `Bearer ${KEY}` : '');
  if (auth) headers.Authorization = auth;

  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }

  try {
    const resp = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, init);
    res.statusCode = resp.status;
    res.setHeader('Access-Control-Allow-Origin', '*');
    const ct = resp.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store');
    if (resp.body) {
      Readable.fromWeb(resp.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code: 'proxy', message: `代理失败：${e.message}` } }));
  }
}

async function download(req, res, url) {
  const target = url.searchParams.get('u');
  let u;
  try { u = new URL(target); } catch {
    res.statusCode = 400;
    return res.end('invalid url');
  }
  if (u.protocol !== 'https:' || !allowedHost(u.hostname)) {
    res.statusCode = 403;
    return res.end('host not allowed');
  }
  let resp = null;
  let lastErr = '';
  try {
    resp = await fetch(u.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; UU-Studio/1.0)',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,video/mp4,*/*',
      },
    });
    if (!resp.ok) {
      lastErr = `upstream ${resp.status}`;
      console.error('[dl] upstream', resp.status, u.toString());
      fs.appendFileSync('/tmp/uu-dl.log', `${new Date().toISOString()}\t${resp.status}\t${u.hostname}\t${u.pathname}\n`);
    }
  } catch (e) {
    resp = null;
    lastErr = e.message;
    console.error('[dl] fetch error', e.message, u.toString());
    fs.appendFileSync('/tmp/uu-dl.log', `${new Date().toISOString()}\tERR\t${e.message}\t${u.hostname}\n`);
  }
  if (!resp?.ok) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(lastErr || 'upstream failed');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  Readable.fromWeb(resp.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept',
    });
    return res.end();
  }

  if (url.pathname === '/api/dl') return download(req, res, url);
  if (url.pathname.startsWith('/api/')) return proxy(req, res, url);

  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('404 Not Found');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  云幕 UU 本地预览： http://localhost:${PORT}\n  API 代理： /api -> ${UPSTREAM}/api\n`);
});
