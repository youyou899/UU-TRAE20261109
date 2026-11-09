/* 短剧工坊：CogVideoX-Flash 图生视频 / 文生视频 */
import { state, saveSoon, putAssetInState, removeAssetFromState, assetUrl } from './state.js';
import { $, $$, esc, toast, setBusy, downloadBlob, sleep } from './ui.js';
import { createVideo, waitVideo, downloadAsset, blobToDataUrl, VIDEO_SIZES } from './api.js';
import { getSettings, saveSettings, uid, putAsset, deleteAsset } from './store.js';

let queueRunning = false;
let stopFlag = false;
const live = new Map(); // shotId -> {state, text, elapsed}

export function renderVideo(root) {
  const p = state.project;
  if (!p) { root.innerHTML = '<div class="empty"><b>请先创建项目</b></div>'; return; }
  const s = getSettings();

  root.innerHTML = `
    <div class="page-head">
      <div><h1>短剧工坊 <small>MOTION STUDIO</small></h1><p>CogVideoX-Flash 免费视频模型，支持图生视频与文生视频；单段 5 或 10 秒，多镜拼接成片。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="downloadAll">下载全部</button>
        <button class="btn btn-primary" id="batchBtn">批量生成视频</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3>生成参数</h3><span class="sub">免费模型高峰期会排队，请耐心等待</span></div>
      <div class="row-3">
        <div class="field"><label>分辨率</label>
          <select class="select" id="vSize">
            ${VIDEO_SIZES.map((x) => `<option value="${x.id}" ${x.id === s.videoSize ? 'selected' : ''}>${x.label}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>单段时长</label>
          <select class="select" id="vDur">
            <option value="5" ${s.videoDuration === 5 ? 'selected' : ''}>5 秒</option>
            <option value="10" ${s.videoDuration === 10 ? 'selected' : ''}>10 秒</option>
          </select>
        </div>
        <div class="field"><label>当前进度</label>
          <div class="inline" style="height:38px"><span class="chip brand">cogvideox-flash</span><span class="tiny" id="videoMeta">0 / ${p.shots.length} 已出视频</span></div>
        </div>
      </div>
      <div class="tiny">提示：图生视频会以分镜图为首帧；若分镜还没有图片，会退化为文生视频。</div>
    </div>

    <div class="card" id="progressCard" style="display:none;margin-bottom:16px">
      <div class="card-head"><h3 id="progressTitle">视频队列</h3><span class="sub" id="progressText"></span></div>
      <div class="progress"><i id="progressBar" style="width:0%"></i></div>
      <div class="tiny" id="progressLog" style="margin-top:8px"></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3>文生视频 · 快速试用</h3><span class="sub">不依赖分镜</span></div>
      <div class="inline" style="align-items:flex-start">
        <input class="input" id="freePrompt" style="flex:1;min-width:240px" placeholder="例：雨夜霓虹街道，一名穿风衣的女子撑伞走过，镜头缓慢推进，电影感" />
        <button class="btn btn-soft" id="freeBtn">生成 5 秒</button>
      </div>
      <div id="freeResult" style="margin-top:14px"></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>分镜视频</h3><span class="sub">建议先生成画面，再图生视频</span></div>
      <div id="gridWrap"></div>
    </div>
  `;

  renderGrid();
  updateMeta();

  $('#vSize').onchange = (e) => { saveSettings({ videoSize: e.target.value }); toast('已保存分辨率', 'ok', 1200); };
  $('#vDur').onchange = (e) => { saveSettings({ videoDuration: Number(e.target.value) }); toast('已保存时长', 'ok', 1200); };
  $('#batchBtn').onclick = batchAll;
  $('#downloadAll').onclick = downloadAll;
  $('#freeBtn').onclick = freeGenerate;

  function updateMeta() {
    const done = p.shots.filter((x) => x.videoAssetId || x.videoUrl).length;
    const el = $('#videoMeta');
    if (el) el.textContent = `${done} / ${p.shots.length} 已出视频`;
  }

  function statusOf(shot) {
    const t = live.get(shot.id);
    if (t) return t;
    if (shot.videoAssetId || shot.videoUrl) return { state: 'done', text: '已完成' };
    if (shot.videoTaskId) return { state: 'task', text: '任务进行中' };
    return { state: 'idle', text: '待生成' };
  }

  function renderGrid() {
    const wrap = $('#gridWrap');
    if (!p.shots.length) {
      wrap.innerHTML = '<div class="empty"><b>还没有分镜</b>先到「剧本分镜」生成分镜表</div>';
      return;
    }
    wrap.innerHTML = `<div class="media-grid">${p.shots.map(card).join('')}</div>`;
    bind();
  }

  function card(shot) {
    const img = assetUrl(shot.imageAssetId) || shot.imageUrl || '';
    const vid = shot.videoAssetId ? assetUrl(shot.videoAssetId) : '';
    const st = statusOf(shot);
    const chipCls = st.state === 'done' ? 'ok' : st.state === 'error' ? 'err' : st.state === 'idle' ? '' : 'warn';
    return `
      <div class="media-card" data-shot="${shot.id}">
        <div class="media-thumb">
          ${vid
            ? `<video src="${vid}" controls muted loop playsinline ${img ? `poster="${img}"` : ''}></video>`
            : img
              ? `<img src="${img}" alt="镜${shot.no}" />`
              : `<div class="placeholder">该镜头还没有画面，可直接文生视频</div>`}
          <span class="tag-no">镜 ${String(shot.no).padStart(2, '0')}</span>
        </div>
        <div class="media-body">
          <p>${esc(shot.desc || shot.imagePrompt || '')}</p>
          <div class="shot-meta">
            <span class="chip ${chipCls}">${esc(st.text)}</span>
            ${shot.videoUrl && !shot.videoAssetId ? '<span class="chip warn">仅线上链接</span>' : ''}
            ${shot.duration ? `<span class="chip">${shot.duration}s</span>` : ''}
          </div>
          <div class="media-actions">
            <button class="btn btn-soft btn-xs" data-gen="${shot.id}">${vid || shot.videoUrl ? '重生成' : '生成视频'}</button>
            ${shot.videoTaskId && !vid ? `<button class="btn btn-ghost btn-xs" data-poll="${shot.id}">查询</button>` : ''}
            ${vid || shot.videoUrl ? `<button class="btn btn-ghost btn-xs" data-dl="${shot.id}">下载</button>` : ''}
            <button class="btn btn-ghost btn-xs" data-image="${shot.id}" style="margin-left:auto">去出图</button>
          </div>
        </div>
      </div>`;
  }

  function bind() {
    $$('#gridWrap [data-gen]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.gen);
        setBusy(b, true, '提交');
        try {
          await runShot(shot, true);
          refresh(shot);
          updateMeta();
        } catch (e) {
          if (e.name !== 'AbortError') toast(e.message, 'err', 4200);
        } finally {
          setBusy(b, false);
        }
      };
    });
    $$('#gridWrap [data-poll]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.poll);
        setBusy(b, true, '查询');
        try {
          live.set(shot.id, { state: 'polling', text: '查询中' });
          const res = await waitVideo(shot.videoTaskId, {
            onTick: (i) => setLive(shot, i),
            provider: shot.videoTaskProvider || getSettings().videoProvider || 'zhipu',
          });
          await saveVideo(shot, res.url);
          live.delete(shot.id);
          refresh(shot);
          updateMeta();
          toast(`镜头 ${shot.no} 视频完成`, 'ok');
        } catch (e) {
          live.set(shot.id, { state: 'error', text: e.message.slice(0, 18) });
          refresh(shot);
          toast(e.message, 'err', 4200);
        } finally {
          setBusy(b, false);
        }
      };
    });
    $$('#gridWrap [data-dl]').forEach((b) => {
      b.onclick = async () => {
        const shot = p.shots.find((x) => x.id === b.dataset.dl);
        const asset = shot.videoAssetId ? state.assets.get(shot.videoAssetId) : null;
        if (asset?.blob) downloadBlob(asset.blob, `${p.name}-镜${shot.no}.mp4`);
        else if (shot.videoUrl) {
          try {
            const blob = await downloadAsset(shot.videoUrl);
            downloadBlob(blob, `${p.name}-镜${shot.no}.mp4`);
          } catch (e) {
            window.open(shot.videoUrl, '_blank');
          }
        }
      };
    });
    $$('#gridWrap [data-image]').forEach((b) => {
      b.onclick = () => { location.hash = '#/image'; };
    });
  }

  function setLive(shot, info) {
    const map = { PROCESSING: '排队/生成中', SUCCESS: '已完成', FAIL: '失败' };
    const text = info.status === 'PROCESSING'
      ? `生成中 ${Math.floor((info.elapsed || 0) / 1000)}s`
      : map[info.status] || info.status;
    live.set(shot.id, { state: 'polling', text });
    const el = document.querySelector(`[data-shot="${shot.id}"] .shot-meta .chip`);
    if (el) el.textContent = text;
  }

  function refresh(shot) {
    const el = document.querySelector(`[data-shot="${shot.id}"]`);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = card(shot);
    el.replaceWith(tmp.firstElementChild);
    bind();
  }

  /** 提交任务 + 轮询 + 保存，带 1305 重试 */
  async function runShot(shot, showProgress = false) {
    const cfg = getSettings();
    const imageBlob = shot.imageAssetId ? state.assets.get(shot.imageAssetId)?.blob : null;
    let imageUrl = '';
    if (imageBlob) {
      try { imageUrl = await toSafeDataUrl(imageBlob); } catch {}
    }
    if (!imageUrl && shot.imageUrl) imageUrl = shot.imageUrl;
    const prompt = [shot.imagePrompt || shot.desc || '', cfg.stylePrompt, '电影感运镜，画面稳定，人物动作自然']
      .filter(Boolean).join('。').slice(0, 480);

    let attempt = 0;
    const maxAttempts = 5;
    live.set(shot.id, { state: 'submitting', text: '提交任务' });
    if (showProgress) showQueue(`镜头 ${shot.no}`);
    while (attempt < maxAttempts) {
      if (stopFlag) throw new DOMException('已停止', 'AbortError');
      attempt++;
      try {
        const task = await createVideo({
          prompt,
          imageUrl: imageUrl || undefined,
          size: $('#vSize')?.value || cfg.videoSize,
          duration: $('#vDur')?.value ? Number($('#vDur').value) : cfg.videoDuration,
          fps: 30,
        });
        shot.videoTaskId = task.id;
        shot.videoTaskProvider = task.provider || 'zhipu';
        saveSoon(0);
        live.set(shot.id, { state: 'polling', text: '排队生成中' });
        const res = await waitVideo(task.id, {
          provider: shot.videoTaskProvider,
          onTick: (info) => {
            setLive(shot, info);
            if (showProgress) $('#progressText').textContent = `${Math.floor(info.elapsed / 1000)} 秒`;
          },
        });
        await saveVideo(shot, res.url);
        shot.videoTaskId = '';
        live.delete(shot.id);
        saveSoon(0);
        if (showProgress) $('#progressLog').textContent = `镜头 ${shot.no} 完成`;
        return true;
      } catch (e) {
        if (e.name === 'AbortError') { live.delete(shot.id); throw e; }
        const retryable = /1305|拥堵|排队|超时|timeout|fetch/i.test(e.message) || e.status === 429 || e.status >= 500;
        if (retryable && attempt < maxAttempts) {
          const wait = Math.min(90, 15 * attempt);
          live.set(shot.id, { state: 'retry', text: `拥堵，${wait}s 后重试` });
          if (showProgress) $('#progressLog').textContent = `镜头 ${shot.no} 拥堵，${wait} 秒后第 ${attempt + 1} 次尝试…`;
          await sleep(wait * 1000);
          continue;
        }
        live.set(shot.id, { state: 'error', text: e.message.slice(0, 20) });
        throw e;
      }
    }
    throw new Error('多次重试仍失败，请稍后再试');
  }

  async function saveVideo(shot, url) {
    let blob = null;
    try { blob = await downloadAsset(url, undefined, true); } catch {}
    if (blob) {
      const asset = {
        id: uid('a'),
        projectId: p.id,
        kind: 'video',
        shotId: shot.id,
        name: `${p.name}-镜${shot.no}.mp4`,
        mime: blob.type || 'video/mp4',
        blob,
        prompt: shot.imagePrompt || shot.desc || '',
        createdAt: Date.now(),
      };
      if (shot.videoAssetId) {
        await deleteAsset(shot.videoAssetId);
        removeAssetFromState(shot.videoAssetId);
      }
      await putAsset(asset);
      putAssetInState(asset);
      shot.videoAssetId = asset.id;
      shot.videoUrl = '';
    } else {
      shot.videoUrl = url;
    }
    shot.status = 'video';
    await saveSoon(0);
  }

  async function batchAll() {
    if (queueRunning) return toast('视频队列正在运行', 'warn');
    const targets = p.shots.filter((x) => !x.videoAssetId && !x.videoUrl);
    if (!targets.length) return toast('所有分镜都已有视频', 'ok');
    queueRunning = true;
    stopFlag = false;
    const btn = $('#batchBtn');
    setBusy(btn, true, '队列中');
    showQueue(`批量生成 ${targets.length} 个视频`);
    $('#progressLog').innerHTML = '<button class="btn btn-danger btn-xs" id="stopQueue">停止队列</button>';
    $('#stopQueue').onclick = () => { stopFlag = true; toast('当前任务结束后停止', 'warn'); };
    let done = 0;
    for (const shot of targets) {
      if (stopFlag) break;
      $('#progressText').textContent = `${done} / ${targets.length}`;
      try {
        await runShot(shot, true);
        done++;
        refresh(shot);
        updateMeta();
      } catch (e) {
        refresh(shot);
        if (e.name === 'AbortError') break;
        if (/401|403/.test(e.message)) break;
      }
      $('#progressBar').style.width = `${Math.round((done / targets.length) * 100)}%`;
    }
    queueRunning = false;
    setBusy(btn, false);
    $('#progressTitle').textContent = stopFlag ? '队列已停止' : '队列完成';
    toast(`视频任务结束：成功 ${done} / ${targets.length}`, done ? 'ok' : 'warn', 3200);
    setTimeout(() => { $('#progressCard').style.display = 'none'; }, 2600);
  }

  function showQueue(title) {
    $('#progressCard').style.display = '';
    $('#progressTitle').textContent = title;
    $('#progressText').textContent = '';
    $('#progressBar').style.width = '0%';
    $('#progressLog').textContent = '';
  }

  async function downloadAll() {
    const shots = p.shots.filter((x) => (x.videoAssetId && state.assets.get(x.videoAssetId)) || x.videoUrl);
    if (!shots.length) return toast('还没有可下载的视频', 'warn');
    for (const shot of shots) {
      try {
        const asset = shot.videoAssetId ? state.assets.get(shot.videoAssetId) : null;
        const blob = asset?.blob || await downloadAsset(shot.videoUrl);
        downloadBlob(blob, `${p.name}-镜${String(shot.no).padStart(2, '0')}.mp4`);
        await sleep(400);
      } catch (e) {
        toast(`镜 ${shot.no} 下载失败`, 'err');
      }
    }
  }

  async function freeGenerate() {
    const prompt = $('#freePrompt').value.trim();
    if (!prompt) return toast('请先写视频描述', 'warn');
    const btn = $('#freeBtn');
    setBusy(btn, true, '生成中');
    const box = $('#freeResult');
    box.innerHTML = '<div class="progress"><i style="width:20%"></i></div><div class="tiny" id="freeStatus" style="margin-top:8px">提交任务…</div>';
    stopFlag = false;
    try {
      const cfg = getSettings();
      const task = await createVideo({ prompt, size: cfg.videoSize, duration: 5, fps: 30 });
      const res = await waitVideo(task.id, {
        provider: task.provider || 'zhipu',
        onTick: (info) => {
          const el = $('#freeStatus');
          if (el) el.textContent = `生成中 ${Math.floor((info.elapsed || 0) / 1000)} 秒（免费模型可能排队，请耐心等待）`;
        },
      });
      const blob = await downloadAsset(res.url).catch(() => null);
      const src = blob ? URL.createObjectURL(blob) : res.url;
      box.innerHTML = `<video src="${src}" controls autoplay loop playsinline style="width:100%;max-width:720px;border-radius:12px;border:1px solid var(--line)"></video>
        <div class="inline" style="margin-top:10px"><button class="btn btn-soft btn-xs" id="freeDl">下载视频</button><span class="tiny">${blob ? '已转存到内存，请及时下载' : '仅线上链接，可能 7 天后失效'}</span></div>`;
      $('#freeDl').onclick = () => blob ? downloadBlob(blob, '文生视频.mp4') : window.open(res.url, '_blank');
      toast('视频生成完成', 'ok');
    } catch (e) {
      box.innerHTML = `<div class="note err">${esc(e.message)}</div>`;
      toast(e.message, 'err', 4200);
    } finally {
      setBusy(btn, false);
    }
  }
}

/** 压缩过大的图片，保证 ≤5MB 且为 dataURL */
async function toSafeDataUrl(blob) {
  if (blob.size <= 4.2 * 1024 * 1024 && /^image\/(png|jpe?g)$/.test(blob.type || 'image/png')) {
    return blobToDataUrl(blob);
  }
  const bitmap = await createImageBitmap(blob);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  bitmap.close?.();
  return url;
}
