/* 剧本分镜：小说 → 短剧剧本 → 分镜表 */
import { state, saveSoon, newShot } from './state.js';
import { $, $$, esc, toast, setBusy, extractJson, downloadBlob } from './ui.js';
import { chat } from './api.js';
import { getSettings } from './store.js';

let busy = false;

export function renderScript(root) {
  const p = state.project;
  if (!p) { root.innerHTML = '<div class="empty"><b>请先创建项目</b></div>'; return; }

  root.innerHTML = `
    <div class="page-head">
      <div><h1>剧本分镜 <small>SCRIPT &amp; SHOT LIST</small></h1><p>把小说章节改编成短剧剧本，再拆成带画面提示词、台词与时长的分镜表。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="exportJson">导出分镜 JSON</button>
        <button class="btn btn-ghost" id="scriptBtn">生成剧本</button>
        <button class="btn btn-primary" id="shotBtn">生成分镜表</button>
      </div>
    </div>

    <div class="split">
      <div class="card sticky">
        <div class="card-head"><h3>改编设置</h3><span class="sub">从哪一章开始</span></div>
        <div class="field"><label>素材来源</label>
          <select class="select" id="source">
            <option value="all">全部章节（自动压缩）</option>
            ${p.chapters.map((c, i) => `<option value="${i}">第${i + 1}章 ${esc(c.title || '')}</option>`).join('')}
          </select>
        </div>
        <div class="row">
          <div class="field"><label>分镜数量</label>
            <select class="select" id="shotCount">
              ${[6, 8, 10, 12, 16].map((n) => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} 个镜头</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>单镜时长</label>
            <select class="select" id="shotDur">
              ${[3, 4, 5, 6, 8].map((n) => `<option value="${n}" ${n === 5 ? 'selected' : ''}>约 ${n} 秒</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label>改编要求 <b>可留空</b></label>
          <textarea class="textarea" id="extra" style="min-height:88px" placeholder="例：竖屏短剧节奏，前3秒必须有强钩子；保留原台词；结尾留反转"></textarea>
        </div>
        <div class="field"><label>角色设定 <b>用于画面一致性</b></label>
          <textarea class="textarea" id="characters" style="min-height:86px" placeholder="每行一个：姓名｜身份｜外貌｜性格">${esc(p.characters || '')}</textarea>
        </div>
        <div class="note">分镜提示词会自动叠加「${esc(shortStyle())}」与角色设定，保证画风统一。</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-head">
            <h3>短剧剧本</h3>
            <div class="inline">
              <span class="sub" id="scriptMeta">${(p.script || '').length} 字</span>
              <button class="btn btn-ghost btn-xs" id="saveScript">保存</button>
            </div>
          </div>
          <textarea class="textarea" id="script" style="min-height:240px;font-family:var(--serif);font-size:13.5px;line-height:1.9" placeholder="点击「生成剧本」，或直接粘贴你的剧本。格式建议：&#10;【场景1 旧公寓·夜】&#10;人物：林晚、陈默&#10;△ 雨水敲窗，林晚握着一部没有来电显示的手机。&#10;林晚：你是谁？">${esc(p.script || '')}</textarea>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>分镜表</h3>
            <div class="inline">
              <span class="sub" id="shotMeta">0 个镜头</span>
              <button class="btn btn-ghost btn-xs" id="addShot">添加镜头</button>
              <button class="btn btn-ghost btn-xs" id="enrichBtn">补齐提示词</button>
              <button class="btn btn-ghost btn-xs" id="toImage">去生成画面</button>
            </div>
          </div>
          <div id="shotWrap"></div>
        </div>
      </div>
    </div>
  `;

  const setMeta = () => {
    $('#shotMeta').textContent = `${p.shots.length} 个镜头 · 约 ${p.shots.reduce((n, s) => n + (Number(s.duration) || 0), 0)} 秒`;
    $('#scriptMeta').textContent = `${(p.script || '').length} 字`;
  };
  setMeta();
  renderShots();
  $('#script').addEventListener('input', (e) => {
    p.script = e.target.value;
    setMeta();
    saveSoon();
  });
  $('#characters').addEventListener('input', (e) => {
    p.characters = e.target.value;
    saveSoon();
  });
  $('#saveScript').onclick = () => { p.script = $('#script').value; saveSoon(0); toast('剧本已保存', 'ok'); };

  $('#scriptBtn').onclick = (e) => genScript(e.currentTarget);
  $('#shotBtn').onclick = (e) => genShots(e.currentTarget);
  $('#enrichBtn').onclick = (e) => enrichPrompts(e.currentTarget);
  $('#addShot').onclick = () => {
    p.shots.push(newShot(p.shots.length + 1));
    renumber();
    renderShots();
    saveSoon(0);
  };
  $('#exportJson').onclick = () => {
    downloadBlob(new Blob([JSON.stringify(p.shots, null, 2)], { type: 'application/json' }), `${p.name}-分镜.json`);
  };
  $('#toImage').onclick = () => { location.hash = '#/image'; };

  function sourceText() {
    const val = $('#source').value;
    if (val === 'all') {
      return p.chapters.map((c, i) => `第${i + 1}章 ${c.title || ''}\n${c.content || ''}`).join('\n\n').slice(0, 14000);
    }
    const c = p.chapters[Number(val)];
    return `第${Number(val) + 1}章 ${c?.title || ''}\n${c?.content || ''}`.slice(0, 14000);
  }

  async function genScript(btn) {
    if (busy) return toast('正在处理，请稍候', 'warn');
    const src = sourceText();
    if (!src.trim()) return toast('请先在「小说工坊」生成章节，或直接粘贴小说原文', 'warn');
    busy = true;
    setBusy(btn, true, '改编中');
    try {
      const prompt = `你是短剧编剧。请把下面这段小说改编成可以直接拍摄的中文短剧剧本。

【原著内容】
${src}

【角色设定】
${$('#characters').value || '按原文提炼'}

【改编要求】
${$('#extra').value || '竖屏短剧节奏，开场 3 秒抓人，对白短促有力，每场结尾留钩子'}

输出格式：
【场景1 地点·日/夜】
人物：xxx、xxx
△ 画面与动作描写
角色名：台词
（依次写 4-8 场，不要写旁白解释，不要写拍摄说明）

只输出剧本本身。`;
      const text = await chat({
        messages: [
          { role: 'system', content: '你是经验丰富的竖屏短剧编剧，擅长强冲突、快节奏、口语化台词。' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 5000,
        temperature: 0.85,
      });
      p.script = text.trim();
      $('#script').value = p.script;
      setMeta();
      saveSoon(0);
      toast('剧本已生成', 'ok');
    } catch (e) {
      toast(e.message, 'err', 4000);
    } finally {
      busy = false;
      setBusy(btn, false);
    }
  }

  async function genShots(btn) {
    if (busy) return toast('正在处理，请稍候', 'warn');
    const src = (p.script || '').trim() || sourceText();
    if (!src.trim()) return toast('请先生成剧本或小说正文', 'warn');
    busy = true;
    setBusy(btn, true, '拆分镜中');
    try {
      const count = Number($('#shotCount').value);
      const dur = Number($('#shotDur').value);
      const prompt = `你是短剧分镜师。请把下面的剧本拆成 ${count} 个分镜，输出 JSON 数组。

【剧本 / 原文】
${src.slice(0, 12000)}

【角色设定】
${$('#characters').value || '按内容提炼'}

【风格】${shortStyle()}
【单镜目标时长】约 ${dur} 秒

每个对象必须包含字段：
{
  "no": 1,
  "scene": "场景（地点·日/夜）",
  "shotType": "景别：远景/全景/中景/近景/特写",
  "camera": "运镜：固定/推/拉/摇/移/跟/环绕/升降",
  "desc": "画面内容，40字以内，写清人物动作与关键道具",
  "dialogue": "该镜台词，没有就写空字符串",
  "duration": ${dur},
  "imagePrompt": "用于 AI 绘图的详细中文提示词：人物外貌与服装、动作、环境、光线、构图、景别、镜头语言；不要出现文字、字幕、水印",
  "sfx": "环境音/音效，简短"
}

要求：
1. 镜头之间连贯，景别有变化，开场第一个镜头必须有强视觉钩子
2. imagePrompt 必须是纯视觉描述，不要写“镜头1”“画面中”等词
3. 只输出 JSON 数组，不要 Markdown 代码块，不要解释`;
      const text = await chat({
        messages: [
          { role: 'system', content: '你是专业短剧分镜师，输出严格合法的 JSON。' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 6000,
        temperature: 0.7,
      });
      const arr = extractJson(text);
      if (!Array.isArray(arr)) throw new Error('分镜不是数组格式');
      p.shots = arr.slice(0, 30).map((s, i) => newShot(i + 1, {
        scene: s.scene || '',
        shotType: s.shotType || '中景',
        camera: s.camera || '固定',
        desc: s.desc || '',
        dialogue: s.dialogue || '',
        duration: Math.max(1, Math.round(Number(s.duration) || dur)),
        imagePrompt: s.imagePrompt || '',
        sfx: s.sfx || '',
      }));
      p.compose = { ...(p.compose || {}), order: p.shots.map((s) => s.id) };
      saveSoon(0);
      renderShots();
      setMeta();
      toast(`已生成 ${p.shots.length} 个分镜`, 'ok');
    } catch (e) {
      toast(`分镜生成失败：${e.message}`, 'err', 5000);
    } finally {
      busy = false;
      setBusy(btn, false);
    }
  }

  async function enrichPrompts(btn) {
    const targets = p.shots.filter((s) => !s.imagePrompt || s.imagePrompt.length < 12);
    if (!targets.length) return toast('所有镜头都已有提示词', 'ok');
    if (busy) return toast('正在处理，请稍候', 'warn');
    busy = true;
    setBusy(btn, true, '补全中');
    try {
      const payload = targets.map((s) => ({ no: s.no, desc: s.desc, scene: s.scene, dialogue: s.dialogue, shotType: s.shotType }));
      const text = await chat({
        messages: [{ role: 'user', content: `根据以下分镜信息，为每个镜头补全 AI 绘图提示词，输出 JSON 数组，每项 {"no":镜头号,"imagePrompt":"中文视觉描述"}。要求：人物外貌与服装、动作、环境、光线、构图、景别；不要文字/水印；只输出 JSON。\n\n${JSON.stringify(payload, null, 2)}\n\n全局画风：${shortStyle()}\n角色设定：${$('#characters').value || '按描述'}`, }],
        maxTokens: 3000,
        temperature: 0.7,
      });
      const arr = extractJson(text);
      arr.forEach((item) => {
        const shot = p.shots.find((s) => Number(s.no) === Number(item.no));
        if (shot && item.imagePrompt) shot.imagePrompt = item.imagePrompt;
      });
      saveSoon(0);
      renderShots();
      toast('提示词已补齐', 'ok');
    } catch (e) {
      toast(`补全失败：${e.message}`, 'err', 4200);
    } finally {
      busy = false;
      setBusy(btn, false);
    }
  }

  function renumber() {
    p.shots.forEach((s, i) => { s.no = i + 1; });
    p.compose = { ...(p.compose || {}), order: p.shots.map((s) => s.id) };
  }

  function renderShots() {
    const wrap = $('#shotWrap');
    if (!p.shots.length) {
      wrap.innerHTML = '<div class="empty"><b>还没有分镜</b>点右上角「生成分镜表」，或手动添加镜头</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="shot-table">
        <thead><tr>
          <th style="width:34px">#</th>
          <th style="width:150px">场景 / 景别 / 运镜</th>
          <th style="width:24%">画面内容</th>
          <th style="width:19%">台词</th>
          <th style="width:52px">秒</th>
          <th style="width:27%">AI 画面提示词</th>
          <th style="width:44px">操作</th>
        </tr></thead>
        <tbody>
          ${p.shots.map((s, i) => `
            <tr>
              <td class="no-cell">${String(i + 1).padStart(2, '0')}</td>
              <td>
                <input class="cell-input" data-i="${i}" data-f="scene" value="${esc(s.scene)}" placeholder="场景" />
                <input class="cell-input" data-i="${i}" data-f="shotType" value="${esc(s.shotType)}" placeholder="景别" style="margin-top:3px" />
                <input class="cell-input" data-i="${i}" data-f="camera" value="${esc(s.camera)}" placeholder="运镜" style="margin-top:3px" />
                <div class="shot-meta">${s.imageAssetId ? '<span class="chip ok">已出图</span>' : ''}${(s.videoAssetId || s.videoUrl) ? '<span class="chip ok">已出视频</span>' : ''}</div>
              </td>
              <td><textarea class="cell-input" rows="3" data-i="${i}" data-f="desc" placeholder="谁在做什么，关键道具">${esc(s.desc)}</textarea></td>
              <td><textarea class="cell-input" rows="3" data-i="${i}" data-f="dialogue" placeholder="台词">${esc(s.dialogue)}</textarea></td>
              <td><input class="cell-input" type="number" min="1" max="10" data-i="${i}" data-f="duration" value="${s.duration}" /></td>
              <td><textarea class="cell-input" rows="3" data-i="${i}" data-f="imagePrompt" placeholder="人物外观、动作、环境、光线、景别">${esc(s.imagePrompt)}</textarea></td>
              <td>
                <button class="btn btn-ghost btn-xs" data-up="${i}" title="上移">↑</button>
                <button class="btn btn-ghost btn-xs" data-down="${i}" title="下移" style="margin-top:3px">↓</button>
                <button class="btn btn-danger btn-xs" data-del="${i}" title="删除" style="margin-top:3px">×</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    $$('#shotWrap [data-f]').forEach((el) => {
      el.addEventListener('input', () => {
        const i = Number(el.dataset.i);
        const f = el.dataset.f;
        p.shots[i][f] = f === 'duration' ? Math.max(1, Number(el.value) || 1) : el.value;
        if (f === 'duration') setMeta();
        saveSoon();
      });
    });
    $$('#shotWrap [data-up]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.up);
        if (i <= 0) return;
        [p.shots[i - 1], p.shots[i]] = [p.shots[i], p.shots[i - 1]];
        renumber(); renderShots(); saveSoon(0);
      };
    });
    $$('#shotWrap [data-down]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.down);
        if (i >= p.shots.length - 1) return;
        [p.shots[i + 1], p.shots[i]] = [p.shots[i], p.shots[i + 1]];
        renumber(); renderShots(); saveSoon(0);
      };
    });
    $$('#shotWrap [data-del]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.del);
        p.shots.splice(i, 1);
        renumber(); renderShots(); setMeta(); saveSoon(0);
      };
    });
  }
}

function shortStyle() {
  return getSettings().stylePrompt;
}
