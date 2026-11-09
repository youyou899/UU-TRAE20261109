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

export async function chat(opts) {
  const preferred = opts.model || getSettings().textModel;
  const chain = [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];
  let lastError;
  for (let i = 0; i < chain.length; i++) {
    try {
      return await chatOnce({ ...opts, model: chain[i] });
    } catch (e) {
      lastError = e;
      if (opts.signal?.aborted || e.name === 'AbortError') throw e;
      const retryable = e.status === 429 || e.code === '1305' || /拥堵|访问量过大|稍后再试/.test(e.message);
      if (!retryable || e.partial) throw e;
      if (i < chain.length - 1) {
        const next = chain[i + 1];
        window.dispatchEvent(new CustomEvent('uu:fallback', { detail: { from: chain[i], to: next } }));
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastError;
}

async function chatOnce({
  messages,
  model,
  onDelta,
  onReason,
  signal,
  temperature = 0.85,
  maxTokens = 4096,
  thinking,
  stream = true,
}) {
  const s = getSettings();
  const useThinking = thinking ?? s.thinking;
  const body = {
    model: model || s.textModel,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens,
    thinking: { type: useThinking ? 'enabled' : 'disabled' },
  };
  const resp = await fetch(`${apiBase()}/paas/v4/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
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

/** 文生图 / 图生图（CogView-3-Flash 免费） */
export async function generateImage({ prompt, size, model, signal }) {
  const s = getSettings();
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

/** 创建视频任务（免费 CogVideoX-Flash，异步） */
export async function createVideo({ prompt, imageUrl, size, fps = 30, duration, withAudio = false, model, signal }) {
  const s = getSettings();
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
  return { id: data.id, status: data.task_status || 'PROCESSING' };
}

/** 查询异步任务 */
export async function getAsyncResult(id, signal) {
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
export async function waitVideo(id, { onTick, signal, timeout = 12 * 60 * 1000, interval = 6000 } = {}) {
  const start = Date.now();
  let netErrors = 0;
  while (Date.now() - start < timeout) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    try {
      const data = await getAsyncResult(id, signal);
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
export async function testConnection() {
  const t0 = performance.now();
  const text = await chat({
    messages: [{ role: 'user', content: '只回复：连接成功' }],
    maxTokens: 12,
    stream: false,
  });
  return { text: text.trim(), ms: Math.round(performance.now() - t0) };
}
