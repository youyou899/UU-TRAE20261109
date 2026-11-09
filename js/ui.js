/* 通用 UI 工具 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, type = 'info', ms = 2600) {
  const wrap = $('#toast');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

export function modal({ title = '', body = '', actions = [], width = 560 }) {
  const root = $('#modalRoot');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal" style="width:min(${width}px,100%)">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close>
          <svg viewBox="0 0 24 24"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z"/></svg>
        </button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"></div>
    </div>`;
  root.appendChild(mask);
  const foot = mask.querySelector('.modal-foot');
  const close = () => mask.remove();
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = `btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'}`;
    b.textContent = a.label;
    b.onclick = async () => {
      const ret = a.onClick ? await a.onClick(mask) : undefined;
      if (ret !== false) close();
    };
    foot.appendChild(b);
  });
  mask.querySelector('[data-close]').onclick = close;
  mask.addEventListener('mousedown', (e) => { if (e.target === mask && !mask.dataset.locked) close(); });
  return { el: mask, close };
}

export function confirmDialog(msg, { title = '确认操作', okLabel = '确认', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p style="margin:0;color:var(--muted);line-height:1.8">${esc(msg)}</p>`,
      actions: [
        { label: '取消', onClick: () => resolve(false) },
        { label: okLabel, danger, onClick: () => resolve(true) },
      ],
    });
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) resolve(false); });
  });
}

export function promptDialog(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<input class="input" id="promptInput" value="${esc(value)}" placeholder="${esc(placeholder)}" />`,
      actions: [
        { label: '取消', onClick: () => resolve(null) },
        { label: '确定', primary: true, onClick: () => resolve(m.el.querySelector('#promptInput').value.trim()) },
      ],
    });
    const input = m.el.querySelector('#promptInput');
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        resolve(input.value.trim());
        m.close();
      }
    });
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) resolve(null); });
  });
}

export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制', 'ok', 1400);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制', 'ok', 1400);
  }
}

export function debounce(fn, wait = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从模型回复里尽力提取 JSON 数组 / 对象 */
export function extractJson(text) {
  if (!text) throw new Error('内容为空');
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch {}
  const start = s.search(/[[{]/);
  if (start >= 0) {
    const open = s[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inStr = false;
    let escChar = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (escChar) escChar = false;
        else if (ch === '\\') escChar = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch {}
          break;
        }
      }
    }
  }
  throw new Error('未解析到有效 JSON');
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>${label || '处理中'}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}
