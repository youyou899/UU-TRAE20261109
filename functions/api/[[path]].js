/**
 * Cloudflare Pages Function：同源代理
 *  - /api/paas/v4/*  -> https://open.bigmodel.cn/api/paas/v4/*
 *  - /api/dl?u=...   -> 代理下载智谱生成的图片/视频（其 CDN 不允许浏览器跨域读取）
 *
 * 环境变量（推荐在 Pages 控制台配置，避免 Key 出现在浏览器）：
 *   ZHIPU_API_KEY = 你的 Key
 */
const UPSTREAM = 'https://open.bigmodel.cn';
const ALLOW_HOSTS = [
  'open.bigmodel.cn',
  'bigmodel.cn',
  'ufileos.com',
  'cn-wlcb.ufileos.com',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept',
  'Access-Control-Max-Age': '86400',
};

function allowedHost(host) {
  return ALLOW_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

async function handleDownload(url, env) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return new Response('invalid url', { status: 400, headers: CORS });
  }
  if (target.protocol !== 'https:' || !allowedHost(target.hostname)) {
    return new Response('host not allowed', { status: 403, headers: CORS });
  }
  let resp = null;
  try {
    resp = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; UU-Studio/1.0)',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,video/mp4,*/*',
      },
    });
  } catch {
    resp = null;
  }
  if (!resp?.ok) {
    return new Response(`upstream ${resp?.status || 'error'}`, { status: 502, headers: CORS });
  }
  const headers = new Headers(CORS);
  headers.set('Content-Type', resp.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400');
  const name = target.pathname.split('/').pop() || 'asset';
  headers.set('Content-Disposition', `attachment; filename="${name}"`);
  return new Response(resp.body, { status: 200, headers });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const segments = params.path || [];
  if (segments[0] === 'dl') {
    return handleDownload(url.searchParams.get('u') || '', env);
  }

  const headers = new Headers();
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  const accept = request.headers.get('Accept');
  if (accept) headers.set('Accept', accept);
  const auth = request.headers.get('Authorization') || (env.ZHIPU_API_KEY ? `Bearer ${env.ZHIPU_API_KEY}` : '');
  if (auth) headers.set('Authorization', auth);

  const init = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  let resp;
  try {
    resp = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, init);
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: 'proxy', message: `代理请求失败：${e.message}` } }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const out = new Headers(CORS);
  const ct = resp.headers.get('Content-Type');
  if (ct) out.set('Content-Type', ct);
  out.set('Cache-Control', 'no-store');

  return new Response(resp.body, { status: resp.status, headers: out });
}
