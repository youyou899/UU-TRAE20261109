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

/** 其他 OpenAI 兼容免费供应商（与 js/api.js 的 PROVIDERS 保持一致） */
const OAI_BASES = {
  sensenova: 'https://token.sensenova.cn/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  hunyuan: 'https://tokenhub.tencentcloudapi.com/v1',
  qianfan: 'https://qianfan.baidubce.com/v2',
  spark: 'https://spark-api-open.xf-yun.com/v1',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  qiniu: 'https://api.qnaigc.com/v1',
  modelscope: 'https://api-inference.modelscope.cn/v1',
};

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

const ALLOW_HOSTS = ['open.bigmodel.cn', 'bigmodel.cn', 'ufileos.com', 'volces.com'];
const allowedHost = (h) => ALLOW_HOSTS.some((x) => h === x || h.endsWith(`.${x}`));

async function proxy(req, res, url) {
  const m = url.pathname.match(/^\/api\/oai\/([a-z0-9]+)(\/.*)?$/);
  let target;
  let isZhipu = true;
  if (m) {
    const base = OAI_BASES[m[1]];
    if (!base) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: { message: `未知供应商：${m[1]}` } }));
    }
    target = `${base}${m[2] || ''}${url.search}`;
    isZhipu = false;
  } else {
    target = `${UPSTREAM}${url.pathname}${url.search}`;
  }

  const headers = {};
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers.accept) headers.Accept = req.headers.accept;
  const auth = req.headers.authorization || (isZhipu && KEY ? `Bearer ${KEY}` : '');
  if (auth) headers.Authorization = auth;

  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // 先收集完整 body 并带 Content-Length 转发（部分上游如讯飞网关不接受 chunked）
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    init.body = buf; // undici 会自动设置 Content-Length，不可手动指定
  }

  try {
    const resp = await fetch(target, init);
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
    console.error('[proxy]', target, e.message, e.cause?.code || '', e.cause?.message || '');
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
