/* 智谱 BigModel API 客户端（全部通过同源代理，免费模型） */
import { getSettings } from './store.js';

export const TEXT_MODELS = [
  { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash · 免费 · 200K 上下文' },
  { id: 'glm-4.5-flash', label: 'GLM-4.5-Flash · 免费 · 128K 上下文' },
  { id: 'glm-4-flash-250414', label: 'GLM-4-Flash-250414 · 免费 · 快速' },
  { id: 'glm-4-flash', label: 'GLM-4-Flash · 免费 · 轻量' },
  { id: 'glm-z1-flash', label: 'GLM-Z1-Flash · 免费 · 推理' },
];

export const VISION_MODELS = [
  { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash · 免费 · 视觉理解' },
  { id: 'glm-4.1v-thinking-flash', label: 'GLM-4.1V-Thinking-Flash · 免费' },
  { id: 'glm-4v-flash', label: 'GLM-4V-Flash · 免费 · 轻量' },
];

export const IMAGE_MODELS = [
  { id: 'cogview-3-flash', label: 'CogView-3-Flash · 免费 · 带 AI 水印' },
];

export const VIDEO_MODELS = [
  { id: 'cogvideox-flash', label: 'CogVideoX-Flash · 免费 · 5/10 秒' },
];

export const IMAGE_SIZES = [
  { id: '1344x768', label: '横屏 16:9 · 1344×768' },
  { id: '1440x720', label: '宽银幕 · 1440×720' },
  { id: '1024x1024', label: '方形 · 1024×1024' },
  { id: '768x1344', label: '竖屏 · 768×1344' },
  { id: '864x1152', label: '竖屏 3:4 · 864×1152' },
];

export const VIDEO_SIZES = [
  { id: '1280x720', label: '横屏 720P · 1280×720' },
  { id: '720x1280', label: '竖屏 720P · 720×1280' },
  { id: '1024x1024', label: '方形 · 1024×1024' },
  { id: '1920x1080', label: '横屏 1080P · 1920×1080' },
];

/** 其他永久免费 / OpenAI 兼容供应商（模型名可在设置里改） */
export const PROVIDERS = [
  {
    id: 'sensenova',
    name: '商汤 SenseNova',
    base: 'https://token.sensenova.cn/v1',
    model: 'sensenova-6.5-flash-lite',
    alt: [],
    note: '需邀请码 · 暂不可用',
  },
  {
    id: 'doubao',
    name: '火山引擎豆包',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-lite-260915',
    alt: ['deepseek-v4-1-flash-economy-261017', 'glm-5-3-flash-260828', 'kimi-k3-1-pro-261024'],
    note: '每日 200 万 Token · 实测可用 · 含出图/视频',
  },
  {
    id: 'hunyuan',
    name: '腾讯混元 Lite',
    base: 'https://tokenhub.tencentcloudapi.com/v1',
    model: 'hunyuan-lite',
    alt: [],
    note: 'TokenHub 需 API 3.0 签名 · 暂不可用',
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    base: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-speed',
    alt: ['ernie-lite'],
    note: 'Key 有效 · 需控制台开通模型',
  },
  {
    id: 'spark',
    name: '讯飞星火 Maas',
    base: 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
    model: 'spark-x2.5',
    alt: ['spark-x2.5-4b', 'xop3qwen4b'],
    note: 'Key 已配 · 模型授权待控制台确认',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    alt: ['qwen-plus', 'qwen-flash'],
    note: 'qwen-turbo 长期免费',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    base: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    alt: ['Qwen/Qwen3-8B', 'THUDM/GLM-4-9B-0414'],
    note: '小参数模型免费 · 需实名',
  },
  {
    id: 'qiniu',
    name: '七牛云 Conatus',
    base: 'https://api.qnaigc.com/v1',
    model: 'deepseek-v3',
    alt: ['deepseek-r1', 'qwen2.5-72b-instruct'],
    note: '限时大额度 · 建议先小规模试',
  },
  {
    id: 'modelscope',
    name: '魔搭 ModelScope',
    base: 'https://api-inference.modelscope.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    alt: ['deepseek-ai/DeepSeek-V3'],
    note: '每日签到魔粒 · 免费额度',
  },
];

export const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export class ApiError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function apiBase() {
  let b = (getSettings().apiBase || '/api').trim();
  b = b.replace(/\/+$/, '');
  if (!/\/api$/.test(b)) b += '/api';
  return b;
}

function authHeaders(extra = {}) {
  const s = getSettings();
  const h = { ...extra };
  if (s.apiKey) h.Authorization = `Bearer ${s.apiKey.trim()}`;
  return h;
}

async function parseError(resp) {
  let msg = `请求失败（HTTP ${resp.status}）`;
  let code = '';
  try {
    const data = await resp.json();
    if (data?.error) {
      msg = data.error.message || msg;
      code = String(data.error.code || '');
    } else if (data?.message) {
      msg = data.message;
      code = String(data.code || '');
    }
  } catch {}
  if (code === '1305' || /访问量过大|流量过大|繁忙/.test(msg)) {
    msg = '免费模型当前排队拥堵（1305），稍后自动重试即可';
  }
  if (resp.status === 401 || resp.status === 403) {
    msg = 'API Key 无效或无权限，请在「设置」里重新填写';
  }
  return new ApiError(msg, { status: resp.status, code });
}

/**
 * 对话（支持流式）；免费模型拥堵时自动降级到备用模型
 * @param {object} opts
 * @param {Array} opts.messages
 * @param {(t:string)=>void} [opts.onDelta] 正文增量
 * @param {(t:string)=>void} [opts.onReason] 思考增量
 * @returns {Promise<string>} 完整正文
 */
const FALLBACK_CHAIN = ['glm-4.7-flash', 'glm-4.5-flash', 'glm-4-flash-250414', 'glm-4-flash'];

/** 供应商是否可用：智谱允许用云端环境变量兜底，其余必须有 Key */
export function providerUsable(id) {
  if (id === 'zhipu') {
    const s = getSettings();
    const host = location.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.pages.dev');
    return Boolean(s.apiKey) || local;
  }
  return Boolean(getSettings().providers?.[id]?.apiKey);
}

export function providerConfig(id) {
  const s = getSettings();
  if (id === 'zhipu') {
    const model = s.textModel || 'glm-4.7-flash';
    return { id, name: '智谱 BigModel', model, models: [model, ...FALLBACK_CHAIN.filter((m) => m !== model)], apiKey: s.apiKey || '' };
  }
  const p = PROVIDER_MAP[id];
  const cfg = s.providers?.[id] || {};
  const model = cfg.model || p.model;
  return { id, name: p.name, model, models: [model, ...(p.alt || []).filter((m) => m !== model)], apiKey: cfg.apiKey || '' };
}

function chatEndpoint(id) {
  return id === 'zhipu' ? `${apiBase()}/paas/v4/chat/completions` : `${apiBase()}/oai/${id}/chat/completions`;
}

/**
 * 对话（流式）；按「优先供应商 → 备用供应商」顺序自动切换
 * @param {object} opts
 * @param {Array} opts.messages
 * @param {string} [opts.provider] 指定供应商（zhipu / sensenova / doubao / hunyuan / qianfan / spark）
 */
export async function chat(opts) {
  const s = getSettings();
  const auto = opts.model && /^glm-/.test(opts.model) ? 'zhipu' : s.preferredProvider || 'zhipu';
  const preferred = opts.provider || auto;
  const ids = [preferred, 'zhipu', ...PROVIDERS.map((p) => p.id)].filter((id, i, arr) => arr.indexOf(id) === i);
  // 智谱始终尝试：云端可由 env.ZHIPU_API_KEY 注入，浏览器端无法感知
  const usable = opts.strict
    ? (preferred === 'zhipu' || providerUsable(preferred) ? [preferred] : [])
    : ids.filter((id) => id === 'zhipu' || providerUsable(id));
  if (!usable.length) {
    throw new ApiError(opts.strict ? `「${providerConfig(preferred).name}」未填写 API Key` : '未配置任何 API Key，请到「设置」填写');
  }

  let lastError;
  for (let pi = 0; pi < usable.length; pi++) {
    const id = usable[pi];
    const cfg = providerConfig(id);
    const chain = opts.model && id === 'zhipu' ? [opts.model, ...stripGlm(opts.model)] : cfg.models;
    for (let i = 0; i < chain.length; i++) {
      try {
        return await chatOnce({ ...opts, provider: id, model: chain[i] });
      } catch (e) {
        lastError = e;
        if (opts.signal?.aborted || e.name === 'AbortError') throw e;
        const retryable = e.status === 429 || e.code === '1305' || /拥堵|访问量过大|稍后再试|繁忙/.test(e.message);
        if (e.partial) throw e;
        if (i < chain.length - 1 && retryable) {
          window.dispatchEvent(new CustomEvent('uu:fallback', { detail: { from: chain[i], to: chain[i + 1], provider: cfg.name } }));
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }
    if (pi < usable.length - 1) {
      const next = usable[pi + 1];
      window.dispatchEvent(new CustomEvent('uu:fallback', {
        detail: { from: cfg.name, to: providerConfig(next).name, provider: cfg.name },
      }));
    }
  }
  throw lastError;
}

function stripGlm(exclude) {
  return FALLBACK_CHAIN.filter((m) => m !== exclude);
}

async function chatOnce({
  messages,
  model,
  provider = 'zhipu',
  onDelta,
  onReason,
  signal,
  temperature = 0.85,
  maxTokens = 4096,
  thinking,
  stream = true,
}) {
  const s = getSettings();
  const cfg = providerConfig(provider);
  const useThinking = thinking ?? s.thinking;
  const body = {
    model: model || cfg.model,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens,
  };
  if (provider === 'zhipu') body.thinking = { type: useThinking ? 'enabled' : 'disabled' };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;
  const resp = await fetch(chatEndpoint(provider), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw await parseError(resp);

  if (!stream) {
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (text && onDelta) onDelta(text);
    return text;
  }

  if (!resp.body) throw new ApiError('浏览器不支持流式响应');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let reason = '';
  let emitted = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          if (json.error) {
            const err = new ApiError(json.error.message || '生成失败', { code: String(json.error.code || '') });
            if (err.code === '1305') err.message = '免费模型当前排队拥堵（1305），请稍后重试';
            err.partial = emitted;
            throw err;
          }
          const delta = json.choices?.[0]?.delta || {};
          if (delta.reasoning_content) {
            reason += delta.reasoning_content;
            onReason?.(delta.reasoning_content);
          }
          if (delta.content) {
            emitted = true;
            full += delta.content;
            onDelta?.(delta.content);
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof ApiError) e.partial = emitted;
    throw e;
  }
  if (!full && reason) {
    full = reason;
  }
  return full;
}

/** 文生图（智谱 CogView 或 豆包 Seedream，均免费） */
export async function generateImage({ prompt, size, model, signal, provider }) {
  const s = getSettings();
  const src = provider || s.imageProvider || 'zhipu';
  if (src === 'doubao') {
    const cfg = providerConfig('doubao');
    const resp = await fetch(`${apiBase()}/oai/doubao/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: model || s.doubaoImageModel || 'doubao-seedream-5-0-flash-260915',
        prompt,
        size: size || s.doubaoImageSize || '2048x2048',
        response_format: 'url',
      }),
      signal,
    });
    if (!resp.ok) throw await parseError(resp);
    const data = await resp.json();
    const url = data?.data?.[0]?.url;
    if (!url) throw new ApiError('豆包出图失败：没有返回图片地址');
    return { url, requestId: data.id || '' };
  }
  const resp = await fetch(`${apiBase()}/paas/v4/images/generations`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: model || s.imageModel,
      prompt,
      size: size || s.imageSize,
    }),
    signal,
  });
  if (!resp.ok) throw await parseError(resp);
  const data = await resp.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new ApiError('图片生成失败：没有返回图片地址');
  return { url, requestId: data.request_id || data.id };
}

/** 创建视频任务（智谱 CogVideoX 或 豆包 Seedance，异步） */
export async function createVideo({ prompt, imageUrl, size, fps = 30, duration, withAudio = false, model, signal, provider }) {
  const s = getSettings();
  const src = provider || s.videoProvider || 'zhipu';
  if (src === 'doubao') {
    const cfg = providerConfig('doubao');
    const dur = Number(duration || s.videoDuration || 5);
    const ratio = (size || s.videoSize || '1280x720').startsWith('720') || /9:16|竖/.test(size || '') ? '9:16' : '16:9';
    const content = [];
    if (imageUrl) content.push({ type: 'image_url', image_url: { url: imageUrl } });
    content.push({ type: 'text', text: `${prompt || ''} --ratio ${ratio} --duration ${dur}` });
    const resp = await fetch(`${apiBase()}/oai/doubao/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: model || s.doubaoVideoModel || 'doubao-seedance-2-0-mini-260615', content }),
      signal,
    });
    if (!resp.ok) throw await parseError(resp);
    const data = await resp.json();
    if (!data.id) throw new ApiError('豆包视频任务创建失败：没有返回任务 ID');
    return { id: data.id, status: 'PROCESSING', provider: 'doubao' };
  }
  const body = {
    model: model || s.videoModel,
    prompt: prompt || '',
    size: size || s.videoSize,
    fps,
    duration: duration || s.videoDuration,
    with_audio: withAudio,
    quality: 'speed',
  };
  if (imageUrl) body.image_url = imageUrl;
  const resp = await fetch(`${apiBase()}/paas/v4/videos/generations`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw await parseError(resp);
  const data = await resp.json();
  if (!data.id) throw new ApiError('视频任务创建失败：没有返回任务 ID');
  return { id: data.id, status: data.task_status || 'PROCESSING', provider: 'zhipu' };
}

/** 查询异步任务 */
export async function getAsyncResult(id, signal, provider = 'zhipu') {
  if (provider === 'doubao') {
    const cfg = providerConfig('doubao');
    const resp = await fetch(`${apiBase()}/oai/doubao/contents/generations/tasks/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal,
    });
    if (!resp.ok) throw await parseError(resp);
    const data = await resp.json();
    const st = String(data.status || '').toLowerCase();
    const mapped = st === 'succeeded' ? 'SUCCESS' : st === 'failed' ? 'FAIL' : 'PROCESSING';
    return {
      task_status: mapped,
      video_result: data.content?.video_url ? [{ url: data.content.video_url, cover_image_url: '' }] : [],
      error: st === 'failed' ? { message: data.error?.message || '豆包视频生成失败' } : undefined,
    };
  }
  const resp = await fetch(`${apiBase()}/paas/v4/async-result/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal,
  });
  if (!resp.ok) throw await parseError(resp);
  return resp.json();
}

/**
 * 轮询视频任务直到完成
 * @param {string} id
 * @param {(info:{status:string,elapsed:number})=>void} onTick
 */
export async function waitVideo(id, { onTick, signal, timeout = 12 * 60 * 1000, interval = 6000, provider = 'zhipu' } = {}) {
  const start = Date.now();
  let netErrors = 0;
  while (Date.now() - start < timeout) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    try {
      const data = await getAsyncResult(id, signal, provider);
      const status = data.task_status || 'PROCESSING';
      onTick?.({ status, elapsed: Date.now() - start });
      if (status === 'SUCCESS') {
        const video = data.video_result?.[0]?.url;
        if (!video) throw new ApiError('视频任务成功但没有返回地址');
        return { url: video, cover: data.video_result?.[0]?.cover_image_url || '' };
      }
      if (status === 'FAIL') {
        throw new ApiError(data?.error?.message || '视频生成失败（可能触发内容审核）');
      }
      netErrors = 0;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      netErrors += 1;
      if (netErrors > 5) throw e;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new ApiError('视频生成超时，请稍后到任务里重试');
}

/** 通过同源代理下载素材（智谱 CDN 不允许跨域读取） */
export async function downloadAsset(url, signal, quick = false) {
  if (!url) throw new ApiError('素材地址为空');
  let lastError;
  const delays = quick ? [] : [4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000];
  const maxAttempts = delays.length + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`${apiBase()}/dl?u=${encodeURIComponent(url)}`, { signal });
      if (!resp.ok) throw new ApiError(`素材下载失败（HTTP ${resp.status}）`, { status: resp.status });
      return await resp.blob();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastError = e;
      if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw lastError;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 测试 Key / 代理是否可用 */
export async function testConnection(providerId = 'zhipu') {
  const cfg = providerConfig(providerId);
  const t0 = performance.now();
  const text = await chat({
    provider: providerId,
    model: cfg.model,
    strict: true,
    messages: [{ role: 'user', content: '只回复：连接成功' }],
    maxTokens: 16,
    stream: false,
  });
  return { text: text.trim(), ms: Math.round(performance.now() - t0), provider: cfg.name, model: cfg.model };
}
