/* 画面工坊：CogView-3-Flash 出图（角色定妆照 + 分镜画面） */
import { state, saveSoon, putAssetInState, removeAssetFromState, assetUrl } from './state.js';
import { $, $$, esc, toast, setBusy, downloadBlob, sleep } from './ui.js';
import { generateImage, downloadAsset, IMAGE_SIZES } from './api.js';
import { getSettings, saveSettings, uid, putAsset, deleteAsset } from './store.js';

let running = false;
let stopFlag = false;

export function renderImage(root) {
  const p = state.project;
  if (!p) { root.innerHTML = '<div class="empty"><b>请先创建项目</b></div>'; return; }
  const s = getSettings();

  root.innerHTML = `
    <div class="page-head">
      <div><h1>画面工坊 <small>FRAME STUDIO</small></h1><p>CogView-3-Flash 免费出图。生成后自动转存到本机，避免 7 天链接过期。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="downloadAll">下载全部</button>
        <button class="btn btn-primary" id="batchBtn">批量生成分镜图</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3>全局画风</h3><span class="sub">所有镜头共用，保证统一</span></div>
      <div class="row-3">
        <div class="field" style="grid-column:span 2">
          <input class="input" id="styleInput" value="${esc(s.stylePrompt)}" />
        </div>
        <div class="field">
          <select class="select" id="sizeSelect">
            ${IMAGE_SIZES.map((x) => `<option value="${x.id}" ${x.id === s.imageSize ? 'selected' : ''}>${x.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="inline">
        <span class="chip brand">cogview-3-flash</span>
        <span class="chip">免费 · 自带 AI 水印</span>
        <span class="chip">并发 ${s.concurrency}</span>
        <span class="tiny" style="margin-left:auto" id="imageMeta">0 / ${p.shots.length} 个分镜已出图</span>
      </div>
    </div>

    <div class="card" id="progressCard" style="display:none;margin-bottom:16px">
      <div class="card-head"><h3 id="progressTitle">生成中…</h3><span class="sub" id="progressText"></span></div>
      <div class="progress"><i id="progressBar" style="width:0%"></i></div>
      <div class="tiny" id="progressLog" style="margin-top:8px"></div>
    </div>

    <div class="card" style="margin-bottom:16px" id="castCard">
      <div class="card-head">
        <h3>角色定妆照</h3>
        <div class="inline">
          <span class="sub">用于统一人物长相与服装</span>
          <button class="btn btn-ghost btn-xs" id="castBtn">生成定妆照</button>
          <button class="btn btn-ghost btn-xs" id="toScript">去写角色设定</button>
        </div>
      </div>
      <div id="castWrap"></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>分镜画面</h3><span class="sub">提示词来自分镜表，可自动叠加角色设定</span></div>
      <div id="gridWrap"></div>
    </div>
  `;

  renderCast();
  renderGrid();
  updateMeta();

  $('#styleInput').addEventListener('change', (e) => {
    saveSettings({ stylePrompt: e.target.value.trim() });
    toast('画风已保存', 'ok', 1200);
  });
  $('#sizeSelect').addEventListener('change', (e) => {
    saveSettings({ imageSize: e.target.value });
    toast('尺寸已保存', 'ok', 1200);
  });
  $('#batchBtn').onclick = batchAll;
  $('#downloadAll').onclick = downloadAll;
  $('#castBtn').onclick = generateCast;
  $('#toScript').onclick = () => { location.hash = '#/script'; };

  function updateMeta() {
    const done = p.shots.filter((x) => x.imageAssetId || x.imageUrl).length;
    const el = $('#imageMeta');
    if (el) el.textContent = `${done} / ${p.shots.length} 个分镜已出图`;
  }

  function characterLine() {
    if (!p.characters) return '';
    return p.characters.split('\n').map((x) => x.trim()).filter(Boolean).join('；');
  }

  function buildPrompt(shot) {
    const style = $('#styleInput')?.value || s.stylePrompt;
    const parts = [
      style,
      shot.imagePrompt || shot.desc || '',
      characterLine() ? `人物设定：${characterLine()}` : '',
      shot.shotType ? `景别：${shot.shotType}` : '',
      shot.camera && shot.camera !== '固定' ? `镜头：${shot.camera}` : '',
      '画面中不要出现任何文字、字幕、水印、logo',
    ];
    return parts.filter(Boolean).join('。').slice(0, 950);
  }

  function renderGrid() {
    const wrap = $('#gridWrap');
    if (!p.shots.length) {
      wrap.innerHTML = '<div class="empty"><b>还没有分镜</b>先到「剧本分镜」生成分镜表</div>';
      return;
    }
    wrap.innerHTML = `<div class="media-grid">${p.shots.map(shotCard).join('')}</div>`;
    bindGrid();
  }

  function shotCard(shot) {
    const url = assetUrl(shot.imageAssetId) || shot.imageUrl || '';
    return `
      <div class="media-card" data-shot="${shot.id}">
        <div class="media-thumb">
          ${url ? `<img src="${url}" alt="镜头${shot.no}" />` : `<div class="placeholder">${esc((shot.imagePrompt || shot.desc || '待生成画面').slice(0, 46))}</div>`}
          <span class="tag-no">镜 ${String(shot.no).padStart(2, '0')}</span>
        </div>
        <div class="media-body">
          <p>${esc(shot.desc || shot.imagePrompt || '')}</p>
          <div class="shot-meta">
            <span class="chip">${esc(shot.shotType || '中景')}</span>
            <span class="chip">${esc(shot.camera || '固定')}</span>
            ${shot.imageUrl && !shot.imageAssetId ? '<span class="chip warn">仅线上链接</span>' : ''}
            ${shot.videoAssetId || shot.videoUrl ? '<span class="chip ok">已出视频</span>' : ''}
          </div>
          <div class="media-actions">
            <button class="btn btn-soft btn-xs" data-gen="${shot.id}">${url ? '重绘' : '生成'}</button>
            ${shot.imageUrl && !shot.imageAssetId ? `<button class="btn btn-ghost btn-xs" data-save="${shot.id}">转存</button>` : ''}
            ${url ? `<button class="btn btn-ghost btn-xs" data-dl="${shot.id}">下载</button>` : ''}
            ${url ? `<button class="btn btn-ghost btn-xs" data-del="${shot.id}">删图</button>` : ''}
            <button class="btn btn-ghost btn-xs" data-video="${shot.id}" style="margin-left:auto">去视频</button>
          </div>
        </div>
      </div>`;
  }

  function bindGrid() {
    $$('#gridWrap [data-gen]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.gen);
        setBusy(b, true, '生成');
        try {
          await genShot(shot);
          refreshCard(shot);
          updateMeta();
          toast(`镜头 ${shot.no} 已出图`, 'ok', 1800);
        } catch (e) {
          toast(`镜头 ${shot.no}：${e.message}`, 'err', 4000);
        } finally {
          setBusy(b, false);
        }
      };
    });
    $$('#gridWrap [data-dl]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.dl);
        const asset = state.assets.get(shot.imageAssetId);
        if (asset?.blob) return downloadBlob(asset.blob, `${p.name}-镜${shot.no}.png`);
        if (shot.imageUrl) {
          setBusy(b, true, '下载');
          try {
            const blob = await downloadAsset(shot.imageUrl);
            downloadBlob(blob, `${p.name}-镜${shot.no}.png`);
          } catch (e) {
            toast(`下载失败：${e.message}`, 'err', 4000);
          } finally {
            setBusy(b, false);
          }
        }
      };
    });
    $$('#gridWrap [data-save]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.save);
        if (!shot.imageUrl) return;
        setBusy(b, true, '转存');
        try {
          await persistShot(shot, shot.imageUrl, shot.imagePrompt, 1);
          toast(shot.imageAssetId ? `镜 ${shot.no} 已转存到本机` : 'CDN 暂未就绪，请稍后再试', shot.imageAssetId ? 'ok' : 'warn', 3000);
        } finally {
          setBusy(b, false);
        }
      };
    });
    $$('#gridWrap [data-del]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.del);
        if (shot.imageAssetId) {
          await deleteAsset(shot.imageAssetId);
          removeAssetFromState(shot.imageAssetId);
          shot.imageAssetId = '';
        }
        shot.imageUrl = '';
        saveSoon(0);
        renderGrid();
        updateMeta();
      };
    });
    $$('#gridWrap [data-video]').forEach((b) => {
      b.onclick = () => { location.hash = '#/video'; };
    });
  }

  function refreshCard(shot) {
    const el = document.querySelector(`[data-shot="${shot.id}"]`);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = shotCard(shot);
    el.replaceWith(tmp.firstElementChild);
    bindGrid();
  }

  async function genShot(shot) {
    if (!shot.imagePrompt && !shot.desc) throw new Error('缺少画面描述');
    const prompt = buildPrompt(shot);
    const { url } = await generateImage({ prompt, size: $('#sizeSelect')?.value || s.imageSize });
    shot.imageUrl = url;
    shot.status = 'image';
    await saveSoon(0);
    void persistShot(shot, url, prompt);
    return { url };
  }

  /** 后台把线上链接转存到 IndexedDB（智谱 CDN 刚生成时可能 401，需等待） */
  async function persistShot(shot, url, prompt, rounds = 8) {
    if (!url) return;
    for (let round = 0; round < rounds; round++) {
      try {
        const blob = await downloadAsset(url, undefined, true);
        if (shot.imageUrl !== url) return;
        const asset = {
          id: uid('a'),
          projectId: p.id,
          kind: 'image',
          shotId: shot.id,
          name: `${p.name}-镜${shot.no}.png`,
          mime: blob.type || 'image/png',
          blob,
          prompt,
          createdAt: Date.now(),
        };
        if (shot.imageAssetId) {
          await deleteAsset(shot.imageAssetId);
          removeAssetFromState(shot.imageAssetId);
        }
        await putAsset(asset);
        putAssetInState(asset);
        shot.imageAssetId = asset.id;
        shot.imageUrl = '';
        await saveSoon(0);
        refreshCard(shot);
        updateMeta();
        return;
      } catch (e) {
        console.warn('[image] 转存失败，稍后重试', e);
        if (round < rounds - 1) await sleep(60000);
      }
    }
    console.warn('[image] 转存未完成，保留线上链接', url);
  }

  async function batchAll() {
    if (running) { toast('正在批量生成中', 'warn'); return; }
    if (!p.shots.length) { toast('请先生成分镜表', 'warn'); return; }
    const targets = p.shots.filter((x) => {
      const hasAsset = x.imageAssetId && state.assets.has(x.imageAssetId);
      return !hasAsset && !x.imageUrl;
    });
    if (!targets.length) { toast('所有分镜都已有画面，可单张重绘', 'ok'); return; }
    running = true;
    stopFlag = false;
    const btn = $('#batchBtn');
    setBusy(btn, true, '生成中');
    const card = $('#progressCard');
    card.style.display = '';
    $('#progressTitle').textContent = `批量生成 ${targets.length} 张分镜图`;
    $('#progressLog').innerHTML = '<button class="btn btn-danger btn-xs" id="stopBatch">停止</button>';
    $('#stopBatch').onclick = () => { stopFlag = true; toast('将在当前图片完成后停止', 'warn'); };
    let done = 0;
    const total = targets.length;
    const concurrency = Math.max(1, Math.min(4, getSettings().concurrency));
    const queue = [...targets];

    const worker = async () => {
      while (queue.length && !stopFlag) {
        const shot = queue.shift();
        try {
          await genShot(shot);
          refreshCard(shot);
          done++;
          $('#progressLog').textContent = `镜 ${shot.no} 完成 · ${done}/${total}`;
        } catch (e) {
          $('#progressLog').textContent = `镜 ${shot.no} 失败：${e.message}`;
          if (/1305|401|403/.test(e.message)) stopFlag = true;
        }
        $('#progressBar').style.width = `${Math.round((done / total) * 100)}%`;
        $('#progressText').textContent = `${done} / ${total}`;
        updateMeta();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    running = false;
    setBusy(btn, false);
    $('#progressTitle').textContent = stopFlag ? '已停止' : '批量生成完成';
    setTimeout(() => { card.style.display = 'none'; }, 2200);
    toast(`批量生成结束：成功 ${done} 张`, done ? 'ok' : 'warn', 3000);
  }

  async function downloadAll() {
    const shots = p.shots.filter((x) => x.imageAssetId && state.assets.get(x.imageAssetId));
    if (!shots.length) return toast('还没有可下载的图片', 'warn');
    for (const shot of shots) {
      const asset = state.assets.get(shot.imageAssetId);
      downloadBlob(asset.blob, `${p.name}-镜${String(shot.no).padStart(2, '0')}.png`);
      await new Promise((r) => setTimeout(r, 320));
    }
  }

  /* ---------- 角色定妆照 ---------- */
  function castList() {
    if (!p.characters) return [];
    return p.characters.split('\n').map((line) => line.trim()).filter(Boolean).map((line, i) => {
      const name = line.split(/[｜|]/)[0]?.trim() || `角色${i + 1}`;
      return { name, line };
    });
  }

  function renderCast() {
    const wrap = $('#castWrap');
    const list = castList();
    if (!list.length) {
      wrap.innerHTML = '<div class="empty" style="padding:24px"><b>还没有角色设定</b>去「剧本分镜」页填写或让 AI 提取角色设定</div>';
      return;
    }
    p.cast = p.cast || [];
    wrap.innerHTML = `<div class="media-grid">${list.map((c, i) => {
      const rec = p.cast.find((x) => x.name === c.name);
      const url = rec?.assetId ? assetUrl(rec.assetId) : (rec?.url || '');
      return `
        <div class="media-card" data-cast="${esc(c.name)}">
          <div class="media-thumb" style="aspect-ratio:3/4">
            ${url ? `<img src="${url}" alt="${esc(c.name)}" />` : `<div class="placeholder">${esc(c.line.slice(0, 60))}</div>`}
            <span class="tag-no">${esc(c.name)}</span>
          </div>
          <div class="media-body">
            <p>${esc(c.line)}</p>
            <div class="media-actions">
              <button class="btn btn-soft btn-xs" data-castgen="${i}">${url ? '重绘' : '生成'}</button>
              ${url ? `<button class="btn btn-ghost btn-xs" data-castdl="${i}">下载</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;
    $$('#castWrap [data-castgen]').forEach((b) => {
      b.onclick = async () => {
        const item = list[Number(b.dataset.castgen)];
        setBusy(b, true, '生成');
        try {
          await genCast(item);
          renderCast();
          toast(`${item.name} 定妆照已生成`, 'ok');
        } catch (e) {
          toast(`生成失败：${e.message}`, 'err', 4000);
        } finally {
          setBusy(b, false);
        }
      };
    });
    $$('#castWrap [data-castdl]').forEach((b) => {
      b.onclick = async () => {
        const item = list[Number(b.dataset.castdl)];
        const rec = (p.cast || []).find((x) => x.name === item.name);
        const asset = state.assets.get(rec?.assetId);
        if (asset?.blob) return downloadBlob(asset.blob, `${p.name}-${item.name}-定妆照.png`);
        if (rec?.url) {
          setBusy(b, true, '下载');
          try {
            const blob = await downloadAsset(rec.url);
            downloadBlob(blob, `${p.name}-${item.name}-定妆照.png`);
          } catch (e) {
            toast(`下载失败：${e.message}`, 'err', 4000);
          } finally {
            setBusy(b, false);
          }
        }
      };
    });
  }

  async function genCast(item) {
    const style = $('#styleInput')?.value || s.stylePrompt;
    const prompt = `角色定妆照，半身肖像，纯净浅灰背景，正面柔和打光，${item.line}。${style}。不要文字、字幕、水印`;
    const { url } = await generateImage({ prompt: prompt.slice(0, 950), size: '864x1152' });
    p.cast = p.cast || [];
    let rec = p.cast.find((x) => x.name === item.name);
    if (!rec) { rec = { name: item.name, assetId: '', url: '' }; p.cast.push(rec); }
    rec.url = url;
    await saveSoon(0);
    void persistCast(item.name, url, prompt);
    return { url };
  }

  /** 后台转存定妆照 */
  async function persistCast(name, url, prompt) {
    for (let round = 0; round < 8; round++) {
      try {
        const blob = await downloadAsset(url, undefined, true);
        const rec = (p.cast || []).find((x) => x.name === name);
        if (!rec || rec.url !== url) return;
        const asset = {
          id: uid('a'),
          projectId: p.id,
          kind: 'image',
          shotId: `cast:${name}`,
          name: `${p.name}-${name}-定妆照.png`,
          mime: blob.type || 'image/png',
          blob,
          prompt,
          createdAt: Date.now(),
        };
        if (rec.assetId) {
          await deleteAsset(rec.assetId);
          removeAssetFromState(rec.assetId);
        }
        await putAsset(asset);
        putAssetInState(asset);
        rec.assetId = asset.id;
        rec.url = '';
        await saveSoon(0);
        renderCast();
        return;
      } catch (e) {
        console.warn('[image] 定妆照转存失败，稍后重试', e);
        if (round < 7) await sleep(60000);
      }
    }
    console.warn('[image] 定妆照转存未完成，保留线上链接', url);
  }

  async function generateCast() {
    const list = castList();
    if (!list.length) return toast('请先填写角色设定', 'warn');
    const btn = $('#castBtn');
    setBusy(btn, true, '生成中');
    try {
      for (const item of list) {
        const rec = (p.cast || []).find((x) => x.name === item.name);
        if ((rec?.assetId && state.assets.has(rec.assetId)) || rec?.url) continue;
        await genCast(item);
      }
      renderCast();
      toast('定妆照已生成', 'ok');
    } catch (e) {
      toast(e.message, 'err', 4200);
    } finally {
      setBusy(btn, false);
    }
  }
}
