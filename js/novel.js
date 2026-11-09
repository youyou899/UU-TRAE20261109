/* 小说工坊：设定 → 大纲 → 逐章生成 */
import { state, saveSoon } from './state.js';
import { $, $$, esc, toast, setBusy, downloadBlob } from './ui.js';
import { chat } from './api.js';
import { TEXT_MODELS } from './api.js';

let abortCtrl = null;
let generating = false;

const GENRES = ['都市悬疑', '古装权谋', '玄幻修仙', '科幻末世', '现代言情', '无限流', '民国探案', '校园青春', '家庭伦理', '历史穿越'];
const STYLES = ['强情节、快节奏、强钩子', '细腻文艺、情绪流', '轻松幽默、爽点密集', '冷峻写实、犯罪悬疑', '热血燃向、升级流', '狗血反转、短剧节奏'];

/* 内容类型：决定大纲结构、prompt 风格与默认规模 */
const CONTENT_TYPES = [
  { id: 'novel', name: '长篇小说', desc: '章节制连载', defChapters: 60, defWords: 2000 },
  { id: 'short', name: '短篇故事', desc: '1-5 章一次成型', desc2: '', defChapters: 3, defWords: 2000 },
  { id: 'script_film', name: '电影文案 / 剧本', desc: '场景制，含台词动作', defChapters: 40, defWords: 1200 },
  { id: 'script_anime', name: '动漫文案 / 分集脚本', desc: '分集大纲 + 画面描述', defChapters: 24, defWords: 1200 },
  { id: 'copy', name: '营销文案 / 推文', desc: '短内容批量产出', defChapters: 10, defWords: 500 },
];
const TYPE_MAP = Object.fromEntries(CONTENT_TYPES.map((t) => [t.id, t]));
const isScript = (t) => t === 'script_film' || t === 'script_anime';

export function renderNovel(root) {
  const p = state.project;
  if (!p) { root.innerHTML = '<div class="empty"><b>请先创建项目</b></div>'; return; }

  const pr = p.premise;
  root.innerHTML = `
    <div class="page-head">
      <div><h1>小说工坊 <small>NOVEL STUDIO</small></h1><p>用设定生成大纲，再逐章写正文。每次生成都会自动保存到本地。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="exportTxt">导出 TXT</button>
        <button class="btn btn-ghost" id="charBtn">提取角色设定</button>
        <button class="btn btn-primary" id="outlineBtn">生成故事大纲</button>
      </div>
    </div>

    <div class="split">
      <div class="card sticky">
        <div class="card-head"><h3>创作设定</h3><span class="sub">决定故事骨架</span></div>
        <div class="field"><label>内容类型</label>
          <select class="select" id="fType">
            ${CONTENT_TYPES.map((t) => `<option value="${t.id}" ${(pr.type || 'novel') === t.id ? 'selected' : ''}>${t.name}｜${t.desc}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>题材类型</label>
          <select class="select" id="fGenre">${GENRES.map((g) => `<option ${g === pr.genre ? 'selected' : ''}>${g}</option>`).join('')}</select>
        </div>
        <div class="field"><label>核心设定 / 主题 <b>一句话即可</b></label>
          <textarea class="textarea" id="fTheme" style="min-height:74px" placeholder="例：一个能听见死者最后一句话的接线员，被卷入连环失踪案">${esc(pr.theme)}</textarea>
        </div>
        <div class="field"><label>主角</label>
          <input class="input" id="fHero" placeholder="姓名 / 身份 / 最大弱点" value="${esc(pr.hero)}" />
        </div>
        <div class="field"><label>叙事风格</label>
          <select class="select" id="fStyle">${STYLES.map((s) => `<option ${s === pr.style ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <div class="row">
          <div class="field"><label>视角</label>
            <select class="select" id="fPerspective">
              ${['第三人称', '第一人称', '双线视角'].map((x) => `<option ${x === pr.perspective ? 'selected' : ''}>${x}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>章节数 <small>(≤600)</small></label>
            <input class="input" id="fChapters" type="number" min="1" max="600" value="${pr.chapters}" title="300 万字 ≈ 600 章 × 5000 字；100 万字 ≈ 200 章 × 5000 字；12 万字 ≈ 60 章 × 2000 字" />
          </div>
        </div>
        <div class="field"><label>每章目标字数</label>
          <select class="select" id="fWords">
            ${[500, 800, 1200, 2000, 3000, 5000].map((w) => `<option value="${w}" ${w === pr.wordsPerChapter ? 'selected' : ''}>约 ${w} 字</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-soft" style="width:100%" id="savePremise">保存设定</button>
        <div class="note" style="margin-top:14px">规模参考：<b>500-1万字</b>文案/短故事：1-10 章；<b>12万字</b>：60 章 × 2000 字；<b>100万字</b>：200 章 × 5000 字；<b>300万字</b>：600 章 × 5000 字。超长篇大纲自动分批生成，每 5 章整理剧情进度保连贯。</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-head">
            <h3>故事大纲</h3>
            <div class="inline">
              <span class="sub" id="outlineMeta">${p.outline ? `${countLines(p.outline)} 行` : '尚未生成'}</span>
              <button class="btn btn-ghost btn-xs" id="saveOutline">保存</button>
            </div>
          </div>
          <textarea class="textarea" id="outline" style="min-height:210px;font-size:13px" placeholder="点击右上角「生成故事大纲」，或直接在这里手写：&#10;第1章 雨夜来电｜主角接到一通来自三年前的电话，被迫回到旧案现场……">${esc(p.outline)}</textarea>
        </div>

        <div class="card" id="streamCard" style="display:none">
          <div class="card-head">
            <h3 id="streamTitle">生成中…</h3>
            <div class="inline">
              <span class="sub" id="streamMeta">0 字</span>
              <button class="btn btn-danger btn-xs" id="stopBtn">停止</button>
            </div>
          </div>
          <div class="stream-box" id="streamBox"></div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>章节正文</h3>
            <div class="inline">
              <span class="sub" id="chapterMeta">${p.chapters.length} 章 · ${totalWords()} 字</span>
              <button class="btn btn-ghost btn-sm" id="nextBtn">生成下一章</button>
              <button class="btn btn-primary btn-sm" id="allBtn">按大纲生成全部</button>
            </div>
          </div>
          <div class="chapter-list" id="chapterList"></div>
        </div>
      </div>
    </div>
  `;

  renderChapters();

  /* 设定保存 */
  const premiseFields = {
    genre: '#fGenre', theme: '#fTheme', hero: '#fHero', style: '#fStyle', perspective: '#fPerspective',
  };
  const collect = () => {
    p.premise = {
      type: $('#fType').value || 'novel',
      genre: $('#fGenre').value,
      theme: $('#fTheme').value.trim(),
      hero: $('#fHero').value.trim(),
      style: $('#fStyle').value,
      perspective: $('#fPerspective').value,
      chapters: Math.max(1, Math.min(600, Number($('#fChapters').value) || 6)),
      wordsPerChapter: Number($('#fWords').value) || 2000,
    };
    return p.premise;
  };
  Object.values(premiseFields).forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('change', () => { collect(); saveSoon(); });
  });
  // 切换内容类型时自动填充推荐规模
  $('#fType').addEventListener('change', () => {
    const t = TYPE_MAP[$('#fType').value];
    if (t) { $('#fChapters').value = t.defChapters; $('#fWords').value = t.defWords; }
    collect(); saveSoon();
  });
  $('#fChapters').addEventListener('input', () => { collect(); saveSoon(); });
  $('#savePremise').onclick = () => { collect(); saveSoon(0); toast('设定已保存', 'ok'); };

  $('#outline').addEventListener('input', () => {
    p.outline = $('#outline').value;
    $('#outlineMeta').textContent = `${countLines(p.outline)} 行`;
    saveSoon();
  });
  $('#saveOutline').onclick = () => { p.outline = $('#outline').value; saveSoon(0); toast('大纲已保存', 'ok'); };

  $('#outlineBtn').onclick = (e) => generateOutline(e.currentTarget);
  $('#nextBtn').onclick = (e) => generateNext(e.currentTarget);
  $('#allBtn').onclick = (e) => generateAll(e.currentTarget);
  $('#charBtn').onclick = (e) => extractCharacters(e.currentTarget);
  $('#exportTxt').onclick = exportTxt;

  function renderChapters() {
    const list = $('#chapterList');
    if (!p.chapters.length) {
      list.innerHTML = '<div class="empty"><b>还没有正文</b>先写大纲，再点「生成下一章」</div>';
      return;
    }
    list.innerHTML = p.chapters.map((c, i) => `
      <div class="chapter-item ${i === p.chapters.length - 1 ? 'open' : ''}" data-idx="${i}">
        <button type="button" data-toggle>
          <span class="no">CH ${String(i + 1).padStart(2, '0')}</span>
          <span class="title">${esc(c.title || `第${i + 1}章`)}</span>
          <span class="badge">${(c.content || '').replace(/\s/g, '').length} 字</span>
        </button>
        <div class="chapter-body">
          <textarea class="textarea" data-content="${i}">${esc(c.content || '')}</textarea>
          <div class="inline" style="margin-top:8px">
            <button class="btn btn-ghost btn-xs" data-regen="${i}">重写本章</button>
            <button class="btn btn-ghost btn-xs" data-copy="${i}">复制</button>
            <button class="btn btn-danger btn-xs" data-remove="${i}">删除</button>
          </div>
        </div>
      </div>`).join('');

    $$('#chapterList [data-toggle]').forEach((b) => {
      b.onclick = () => b.closest('.chapter-item').classList.toggle('open');
    });
    $$('#chapterList [data-content]').forEach((ta) => {
      ta.addEventListener('input', () => {
        const i = Number(ta.dataset.content);
        p.chapters[i].content = ta.value;
        const item = ta.closest('.chapter-item');
        item.querySelector('.badge').textContent = `${ta.value.replace(/\s/g, '').length} 字`;
        $('#chapterMeta').textContent = `${p.chapters.length} 章 · ${totalWords()} 字`;
        saveSoon();
      });
    });
    $$('#chapterList [data-regen]').forEach((b) => {
      b.onclick = () => regenChapter(Number(b.dataset.regen), b);
    });
    $$('#chapterList [data-copy]').forEach((b) => {
      b.onclick = async () => {
        await navigator.clipboard.writeText(p.chapters[Number(b.dataset.copy)].content || '');
        toast('已复制', 'ok', 1200);
      };
    });
    $$('#chapterList [data-remove]').forEach((b) => {
      b.onclick = () => {
        p.chapters.splice(Number(b.dataset.remove), 1);
        p.chapters.forEach((c, i) => { c.no = i + 1; });
        saveSoon(0);
        renderChapters();
      };
    });
  }

  function totalWords() {
    return p.chapters.reduce((n, c) => n + (c.content || '').replace(/\s/g, '').length, 0);
  }

  function showStream(title) {
    $('#streamCard').style.display = '';
    $('#streamTitle').textContent = title;
    $('#streamBox').innerHTML = '';
    $('#streamMeta').textContent = '0 字';
    $('#streamCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function hideStream() { $('#streamCard').style.display = 'none'; }

  function startAbort() {
    abortCtrl = new AbortController();
    $('#stopBtn').onclick = () => { abortCtrl?.abort(); toast('已停止生成', 'warn', 1500); };
    return abortCtrl.signal;
  }

  /* 大纲：短篇单次生成；长篇分批（每批 10 章）+ 故事主线骨架 */
  async function generateOutline(btn) {
    if (generating) return toast('正在生成，请稍候', 'warn');
    collect();
    if (!p.premise.theme && !p.premise.hero) {
      toast('至少填写「核心设定」或「主角」', 'warn');
      return;
    }
    generating = true;
    setBusy(btn, true, '生成大纲中');
    showStream('生成故事大纲');
    const box = $('#streamBox');
    const signal = startAbort();
    try {
      const total = p.premise.chapters;
      if (total <= 20) {
        // 短篇：一次生成
        const text = await chat({
          messages: [
            { role: 'system', content: '你是资深中文网文主编，擅长设计强钩子、强反转的故事结构。' },
            { role: 'user', content: outlinePrompt(p.premise, p.name, 1, total, '') },
          ],
          maxTokens: Math.min(8000, 1200 + total * 220),
          temperature: 0.85,
          signal,
          onDelta: (d) => { box.textContent += d; $('#streamMeta').textContent = `${box.textContent.replace(/\s/g, '').length} 字`; box.scrollTop = box.scrollHeight; },
        });
        p.outline = text.trim();
      } else {
        // 长篇：先骨架，再分批
        box.textContent = '【第 1 步】生成故事主线骨架...\n\n';
        const arc = await chat({
          messages: [
            { role: 'system', content: '你是资深网文主编，擅长长篇故事结构设计。' },
            { role: 'user', content: outlineArcPrompt(p.premise, p.name) },
          ],
          maxTokens: 2000, temperature: 0.85, signal,
          onDelta: (d) => { box.textContent += d; box.scrollTop = box.scrollHeight; },
        });
        const BATCH = 10;
        const allEntries = [];
        let prevBatch = '';
        for (let start = 1; start <= total; start += BATCH) {
          const end = Math.min(start + BATCH - 1, total);
          box.textContent += `\n\n【第 2 步】生成第 ${start}-${end} 章大纲...\n`;
          const ctx = `【故事主线】\n${arc}\n\n${prevBatch}`;
          const batchText = await chat({
            messages: [
              { role: 'system', content: '你是资深网文主编，擅长设计强钩子、强反转的章节大纲。' },
              { role: 'user', content: outlinePrompt(p.premise, p.name, start, end, ctx) },
            ],
            maxTokens: 4000, temperature: 0.85, signal,
            onDelta: (d) => { box.textContent += d; $('#streamMeta').textContent = `${box.textContent.replace(/\s/g, '').length} 字`; box.scrollTop = box.scrollHeight; },
          });
          parseOutline(batchText).filter((e) => e.index >= start && e.index <= end).forEach((e) => allEntries.push(e));
          prevBatch = batchText;
          if (signal.aborted) break;
        }
        allEntries.sort((a, b) => a.index - b.index);
        const seen = new Set();
        p.outline = allEntries.filter((e) => { if (seen.has(e.index)) return false; seen.add(e.index); return true; })
          .map((e) => `第${e.index}章 ${e.title}｜${e.summary}`).join('\n');
      }
      $('#outline').value = p.outline;
      $('#outlineMeta').textContent = `${countLines(p.outline)} 行`;
      saveSoon(0);
      hideStream();
      toast(`大纲已生成（${countLines(p.outline)} 章）`, 'ok');
    } catch (e) {
      if (e.name === 'AbortError') return;
      toast(e.message, 'err', 4200);
      $('#streamBox').textContent = `生成失败：${e.message}`;
    } finally {
      generating = false;
      setBusy(btn, false);
    }
  }

  /* 角色设定 */
  async function extractCharacters(btn) {
    if (!p.outline) return toast('请先生成大纲', 'warn');
    setBusy(btn, true, '提取中');
    try {
      const text = await chat({
        messages: [{ role: 'user', content: charactersPrompt(p) }],
        maxTokens: 900,
        temperature: 0.6,
      });
      p.characters = text.trim();
      saveSoon(0);
      toast('角色设定已保存，将用于后续画面一致性', 'ok', 3200);
    } catch (e) {
      toast(e.message, 'err', 4000);
    } finally {
      setBusy(btn, false);
    }
  }

  function nextIndex() {
    return p.chapters.length + 1;
  }

  function outlineEntries() {
    return parseOutline(p.outline);
  }

  async function generateNext(btn) {
    if (generating) return toast('正在生成，请稍候', 'warn');
    if (!p.outline.trim()) return toast('请先生成或填写大纲', 'warn');
    const n = nextIndex();
    if (n > 600) return toast('章节数已达上限', 'warn');
    const entry = outlineEntries().find((x) => x.index === n) || { title: `第${n}章`, summary: '' };
    await writeChapter(n, entry, btn);
    renderChapters();
  }

  async function generateAll(btn) {
    if (generating) return toast('正在生成，请稍候', 'warn');
    if (!p.outline.trim()) return toast('请先生成或填写大纲', 'warn');
    const entries = outlineEntries();
    const max = Math.max(p.premise.chapters, entries.length || 0);
    if (p.chapters.length >= max) return toast('大纲章节已全部生成', 'warn', 2600);
    generating = true;
    setBusy(btn, true, '批量生成中');
    try {
      for (let n = p.chapters.length + 1; n <= max; n++) {
        const entry = entries.find((x) => x.index === n) || { title: `第${n}章`, summary: '' };
        const ok = await writeChapter(n, entry, null, true);
        renderChapters();
        if (abortCtrl?.signal.aborted) break;
        // 每 5 章生成一次剧情进度摘要，用于后续章节保持连贯
        if (ok && n % 5 === 0) {
          try {
            const summary = await chat({
              messages: [
                { role: 'system', content: '你是小说编辑，擅长用精炼语言总结已发生剧情。' },
                { role: 'user', content: progressPrompt(p, n) },
              ],
              maxTokens: 1200,
              temperature: 0.5,
              signal: abortCtrl?.signal,
            });
            p.progressSummary = summary.trim();
            saveSoon(0);
            toast(`已整理第 ${n} 章剧情进度，后续章节将延续`, 'ok', 2600);
          } catch (e) { /* 不阻塞主流程 */ }
        }
      }
      if (!abortCtrl?.signal.aborted) toast('全部章节已生成', 'ok');
    } finally {
      generating = false;
      setBusy(btn, false);
    }
  }

  async function regenChapter(idx, btn) {
    if (generating) return toast('正在生成，请稍候', 'warn');
    const n = idx + 1;
    const entry = outlineEntries().find((x) => x.index === n)
      || { title: p.chapters[idx].title || `第${n}章`, summary: '' };
    await writeChapter(n, entry, btn, false, idx);
    renderChapters();
  }

  /**
   * 写一章并写入/替换
   */
  async function writeChapter(n, entry, btn, quiet = false, replaceIdx = -1) {
    generating = true;
    if (btn) setBusy(btn, true, '写作中');
    showStream(`第 ${n} 章 · ${entry.title || ''}`);
    const box = $('#streamBox');
    const signal = startAbort();
    const target = p.premise.wordsPerChapter;
    try {
      const text = await chat({
        messages: [
          { role: 'system', content: '你是中文网络小说作者，文笔扎实，擅长画面感、对话和悬念。' },
          { role: 'user', content: chapterPrompt(p, n, entry) },
        ],
        maxTokens: Math.min(16000, Math.round(target * 2.1) + 600),
        temperature: 0.9,
        signal,
        onDelta: (d) => {
          box.textContent += d;
          const len = box.textContent.replace(/\s/g, '').length;
          $('#streamMeta').textContent = `${len} 字 / 目标 ${target}`;
          box.scrollTop = box.scrollHeight;
        },
      });
      const content = text.trim();
      if (!content) throw new Error('模型没有返回正文，请重试');
      if (replaceIdx >= 0 && p.chapters[replaceIdx]) {
        p.chapters[replaceIdx].content = content;
        p.chapters[replaceIdx].title = entry.title;
      } else {
        p.chapters.push({
          id: `c_${Date.now().toString(36)}`,
          no: n,
          title: entry.title,
          content,
          summary: entry.summary,
        });
      }
      saveSoon(0);
      hideStream();
      if (!quiet) toast(`第 ${n} 章完成（${content.replace(/\s/g, '').length} 字）`, 'ok', 3200);
    } catch (e) {
      if (e.name === 'AbortError') {
        hideStream();
        return false;
      }
      toast(e.message, 'err', 4200);
      $('#streamBox').textContent = `生成失败：${e.message}`;
      return false;
    } finally {
      generating = false;
      if (btn) setBusy(btn, false);
    }
    return true;
  }

  function exportTxt() {
    const parts = [`《${p.name}》\n`];
    if (p.outline) parts.push(`\n【故事大纲】\n${p.outline}\n`);
    if (p.characters) parts.push(`\n【角色设定】\n${p.characters}\n`);
    p.chapters.forEach((c, i) => parts.push(`\n第${i + 1}章 ${c.title || ''}\n\n${c.content || ''}\n`));
    downloadBlob(new Blob([parts.join('\n')], { type: 'text/plain;charset=utf-8' }), `${p.name}.txt`);
  }
}

/* ---------------- prompts ---------------- */
const TYPE_LABEL = { novel: '长篇小说', short: '短篇故事', script_film: '电影剧本', script_anime: '动漫分集脚本', copy: '营销文案/推文' };

function outlineArcPrompt(pr, name) {
  const t = TYPE_LABEL[pr.type] || '长篇小说';
  return `请为《${name || '未命名'}》设计${t}的全书主线骨架（不写章节）。

【题材】${pr.genre}
【核心设定/主题】${pr.theme || '请根据题材自行设计一个高概念'}
【主角】${pr.hero || '请自行设计，要有明确欲望与致命弱点'}
【风格】${pr.style}
【计划总规模】${pr.chapters} 章/集

要求：
1. 用 400-600 字描述开端、发展、中段大反转、高潮收束四个阶段的核心剧情走向
2. 点明主要人物、核心冲突、关键反转、最终结局走向
3. 不要分章节，只写阶段概述`;
}

function outlinePrompt(pr, name, start, end, ctx) {
  const t = TYPE_LABEL[pr.type] || '长篇小说';
  const count = end - start + 1;
  return `请为《${name || '未命名'}》这部${t}写大纲，输出第 ${start} 章到第 ${end} 章（共 ${count} 章）。

【题材】${pr.genre}
【核心设定/主题】${pr.theme || '请根据题材自行设计一个高概念'}
【主角】${pr.hero || '请自行设计，要有明确欲望与致命弱点'}
【风格】${pr.style}
【叙事视角】${pr.perspective}
【全书总章节】${pr.chapters} 章
【每章目标字数】约 ${pr.wordsPerChapter} 字

${ctx ? `${ctx}` : '【提示】这是开篇部分，需要快速建立人物、核心冲突与钩子。'}

要求：
1. 每章单独一行，格式严格为：第${start}章 章节标题｜本章梗概（80-120字，必须包含冲突、转折或钩子）
2. 必须恰好输出 ${count} 章，章号从第${start}章到第${end}章连续，不可跳号、不可少写
3. 主线清晰，人物动机可信，节奏递进，中段有反转，最后一章收束并留余味
4. 不要输出任何解释、书名号、Markdown 符号或空行
5. 只输出大纲本身`;
}

function chapterPrompt(p, n, entry) {
  const prev1 = p.chapters[n - 2];
  const prev2 = p.chapters[n - 3];
  const tail1 = prev1 ? (prev1.content || '').slice(-1200) : '';
  const tail2 = prev2 ? (prev2.content || '').slice(-600) : '';
  const progress = p.progressSummary || '';
  const entries = parseOutline(p.outline);
  const t = p.premise.type || 'novel';
  const isScriptType = isScript(t);
  const typeLabel = TYPE_LABEL[t] || '小说';
  const structRule = isScriptType
    ? '结构完整：场景切入（含场景描述/氛围/动作）→ 冲突升级（台词+表情动作）→ 转折 → 章末钩子'
    : t === 'copy'
      ? '结构完整：标题/开头抓人 → 核心卖点/情节 → 金句/反转 → 结尾引导互动'
      : '结构完整：场景切入 → 冲突升级 → 转折 → 章末钩子';
  const styleRule = isScriptType
    ? '多用动作、表情、对话（口语化、有个性）、感官细节、画面描述；台词要符合人物身份性格；少做设定解释和心理独白'
    : '多用动作、表情、对话（口语化、有个性）、感官细节；少做设定解释和心理独白';
  return `请继续创作《${p.name}》（${typeLabel}，第 ${n} 章 / 共 ${entries.length || p.premise.chapters} 章）。

【题材】${p.premise.genre}　【风格】${p.premise.style}　【视角】${p.premise.perspective}　【主角】${p.premise.hero || '见大纲'}
【核心设定】${p.premise.theme}

【全书大纲】
${p.outline}

【角色设定】
${p.characters || '请保持人物前后一致，自行设定并保持'}
${progress ? `\n【剧情进度（此前已发生的关键事件，必须延续）】\n${progress}` : ''}

${prev2 ? `【第 ${n - 2} 章结尾】\n${tail2}\n` : ''}
${prev1 ? `【第 ${n - 1} 章结尾】\n${tail1}\n` : '【提示】这是开篇第一章，快速建立人物、困境与钩子。'}

现在创作：第${n}章 ${entry.title || ''}
本章梗概：${entry.summary || '按大纲推进，制造冲突与转折'}

硬性要求：
1. 约 ${p.premise.wordsPerChapter} 字，${structRule}
2. 章末必须留钩子（悬念/反转/新危机），让读者忍不住翻下一章
3. ${styleRule}
4. 与前文人物姓名、时间线、已埋伏笔严格一致；不要推翻已发生的剧情
5. 不要写“本章完”“欲知后事”等套话，不要章节标题或序号
6. 只输出正文，不要任何说明文字`;
}

function progressPrompt(p, upToN) {
  const recent = p.chapters.slice(-8).map((c, i) => {
    const no = p.chapters.length - 7 + i;
    return `第${no}章 ${c.title || ''}：${(c.content || '').slice(0, 280)}`;
  }).join('\n');
  return `请用 400-600 字总结《${p.name}》到第 ${upToN} 章为止的剧情进度。

【全书大纲】
${p.outline}

【角色设定】
${p.characters || '(略)'}

【最近章节摘要】
${recent}

要求：只列出主线已发生的关键事件、人物关系变化、未解悬念和伏笔；不要新创作剧情；不要章节标题；用分段叙述。`;
}

function charactersPrompt(p) {
  return `根据以下小说设定与大纲，提炼主要角色（3-6 人）。

【题材】${p.premise.genre}　【主角】${p.premise.hero}
【核心设定】${p.premise.theme}
【大纲】
${p.outline}

要求：每行一个角色，格式严格为：
姓名｜年龄与身份｜外貌（发型、脸部特征、服装、体态）｜性格｜说话风格
不要编号，不要解释，不要空行。外貌描述要具体到可以直接用于 AI 绘图。`;
}

/* ---------------- helpers ---------------- */
function parseOutline(text) {
  if (!text) return [];
  const out = [];
  const lines = String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    let m = line.match(/^第\s*(\d+)\s*[章集节回]\s*[、.：:\-—\s]*(.+)$/);
    if (!m) m = line.match(/^(\d+)\s*[、.．]\s*(.+)$/);
    if (!m) continue;
    const index = Number(m[1]);
    const rest = m[2].trim();
    const parts = rest.split(/[｜|]/);
    const title = (parts[0] || rest).replace(/^[《「【]/, '').replace(/[》」】]$/, '').trim();
    const summary = (parts.slice(1).join('｜') || '').trim();
    out.push({ index, title, summary });
  }
  return out;
}

function countLines(text) {
  return String(text || '').split(/\n/).filter((s) => s.trim()).length;
}
