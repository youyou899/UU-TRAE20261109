/* 成片合成：预览 / WebM 录制 / SRT / 制作包 */
import { state, assetUrl } from './state.js';
import { $, esc, toast, downloadBlob, srtTime, sleep } from './ui.js';
import { downloadAsset } from './api.js';

let playing = false;
let stopRequested = false;
let recorder = null;

export function renderCompose(root) {
  const p = state.project;
  if (!p) { root.innerHTML = '<div class="empty"><b>请先创建项目</b></div>'; return; }

  root.innerHTML = `
    <div class="page-head">
      <div><h1>成片合成 <small>ASSEMBLY</small></h1><p>按分镜顺序串联画面与视频，自动叠加台词字幕，导出 WebM 成片或完整制作包。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="srtBtn">导出 SRT</button>
        <button class="btn btn-ghost" id="packBtn">导出制作包</button>
        <button class="btn btn-primary" id="recordBtn">导出成片 WebM</button>
      </div>
    </div>

    <div class="split" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
      <div class="card">
        <div class="card-head">
          <h3>预览</h3>
          <div class="inline">
            <label class="switch"><input type="checkbox" id="skipEmpty" checked /><i></i>跳过无素材镜头</label>
            <button class="btn btn-soft btn-sm" id="playBtn">播放预览</button>
            <button class="btn btn-ghost btn-sm" id="stopBtn" disabled>停止</button>
          </div>
        </div>
        <div style="background:#05050a;border:1px solid var(--line);border-radius:12px;overflow:hidden">
          <canvas id="stage" width="1280" height="720" style="width:100%;display:block;aspect-ratio:16/9;background:#05050a"></canvas>
        </div>
        <div class="progress" style="margin-top:12px"><i id="playBar" style="width:0%"></i></div>
        <div class="inline" style="justify-content:space-between;margin-top:8px">
          <span class="tiny" id="playStatus">就绪</span>
          <span class="tiny" id="totalDur"></span>
        </div>
        <div class="note" style="margin-top:14px">WebM 为实时录制，时长等于分镜总时长；录制时请保持页面在前台。需要 MP4 可用剪映/格式工厂转码。</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>成片镜头</h3><span class="sub" id="shotCount"></span></div>
        <div id="seqList"></div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>配音稿</h3><button class="btn btn-ghost btn-xs" id="ttsBtn">浏览器朗读</button></div>
        <div class="stream-box" id="voiceBox" style="min-height:150px;max-height:260px;font-size:13px">暂无台词</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>字幕</h3><span class="sub">按镜头时长自动排轴</span></div>
        <div class="stream-box" id="srtBox" style="min-height:150px;max-height:260px;font-size:11.5px;font-family:ui-monospace,monospace"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>交付清单</h3></div>
        <div class="kv"><span>镜头数</span><b id="sumShots">0</b></div>
        <div class="kv"><span>含视频镜头</span><b id="sumVideos">0</b></div>
        <div class="kv"><span>含画面镜头</span><b id="sumImages">0</b></div>
        <div class="kv"><span>预计时长</span><b id="sumDur">0s</b></div>
        <div class="kv"><span>分辨率</span><b>1280×720</b></div>
      </div>
    </div>
  `;

  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  drawIdle(ctx, p);

  const active = () => {
    const skip = $('#skipEmpty').checked;
    return p.shots.filter((s) => {
      const has = s.videoAssetId || s.imageAssetId || s.videoUrl || s.imageUrl;
      return skip ? has : true;
    });
  };

  renderSeq();
  updateSummary();
  $('#totalDur').textContent = `预计 ${active().reduce((n, s) => n + (Number(s.duration) || 5), 0)} 秒`;

  $('#playBtn').onclick = () => playAll(false);
  $('#stopBtn').onclick = stopPlay;
  $('#recordBtn').onclick = record;
  $('#srtBtn').onclick = exportSrt;
  $('#packBtn').onclick = exportPack;
  $('#ttsBtn').onclick = speak;
  $('#skipEmpty').onchange = () => { renderSeq(); updateSummary(); $('#totalDur').textContent = `预计 ${active().reduce((n, s) => n + (Number(s.duration) || 5), 0)} 秒`; };

  function renderSeq() {
    const list = active();
    $('#shotCount').textContent = `${list.length} 个镜头`;
    if (!list.length) {
      $('#seqList').innerHTML = '<div class="empty"><b>没有可用的镜头</b>请先生成画面或视频，或取消「跳过无素材镜头」</div>';
      return;
    }
    $('#seqList').innerHTML = list.map((s, i) => {
      const img = s.imageAssetId ? state.assets.get(s.imageAssetId) : null;
      const vid = s.videoAssetId ? state.assets.get(s.videoAssetId) : null;
      const imgSrc = img ? assetUrl(s.imageAssetId) : (s.imageUrl || '');
      return `
        <div class="chapter-item" style="margin-bottom:8px">
          <div style="display:flex;gap:10px;padding:9px 11px;align-items:center">
            <div style="width:64px;height:40px;border-radius:7px;overflow:hidden;background:#0a0a13;flex:0 0 64px;display:grid;place-items:center">
              ${imgSrc ? `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover" />` : '<span class="tiny">无图</span>'}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;display:flex;gap:6px;align-items:center"><b>镜 ${String(i + 1).padStart(2, '0')}</b>
                <span class="chip">${s.duration || 5}s</span>
                ${vid || s.videoUrl ? '<span class="chip ok">视频</span>' : imgSrc ? '<span class="chip brand">图片</span>' : '<span class="chip warn">占位</span>'}
              </div>
              <div class="tiny" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.dialogue || s.desc || '')}</div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function updateSummary() {
    const list = active();
    $('#sumShots').textContent = list.length;
    $('#sumVideos').textContent = list.filter((s) => s.videoAssetId || s.videoUrl).length;
    $('#sumImages').textContent = list.filter((s) => s.imageAssetId || s.imageUrl).length;
    $('#sumDur').textContent = `${list.reduce((n, s) => n + (Number(s.duration) || 5), 0)}s`;
    $('#voiceBox').textContent = list.map((s) => s.dialogue).filter(Boolean).join('\n') || '暂无台词';
    $('#srtBox').textContent = buildSrt(list) || '暂无台词';
  }

  function buildSrt(list) {
    let t = 0;
    const rows = [];
    let i = 1;
    for (const s of list) {
      const d = Number(s.duration) || 5;
      const text = (s.dialogue || '').trim();
      if (text) {
        rows.push(`${i}\n${srtTime(t)} --> ${srtTime(t + d)}\n${text}\n`);
        i++;
      }
      t += d;
    }
    return rows.join('\n');
  }

  function exportSrt() {
    const list = active();
    const srt = buildSrt(list);
    if (!srt.trim()) return toast('没有台词可生成字幕', 'warn');
    downloadBlob(new Blob([srt], { type: 'text/plain;charset=utf-8' }), `${p.name}.srt`);
  }

  function stopPlay() {
    stopRequested = true;
    playing = false;
    $('#playBtn').disabled = false;
    $('#stopBtn').disabled = true;
    window.speechSynthesis?.cancel();
    if (recorder?.state === 'recording') {
      try { recorder.stop(); } catch {}
      recorder = null;
    }
  }

  async function playAll(isRecording) {
    if (playing) return;
    const list = active();
    if (!list.length) return toast('没有可播放的镜头', 'warn');
    playing = true;
    stopRequested = false;
    $('#playBtn').disabled = true;
    $('#stopBtn').disabled = false;
    ctx.clearRect(0, 0, 1280, 720);

    const total = list.reduce((n, s) => n + (Number(s.duration) || 5), 0);
    let elapsedTotal = 0;

    try {
      for (let i = 0; i < list.length; i++) {
        if (stopRequested) break;
        const shot = list[i];
        const dur = Math.max(1, Number(shot.duration) || 5);
        $('#playStatus').textContent = `生成/播放 镜 ${i + 1} / ${list.length}`;
        await playShot(ctx, shot, dur, i, (t) => {
          const pct = ((elapsedTotal + t) / total) * 100;
          $('#playBar').style.width = `${Math.min(100, pct)}%`;
        });
        elapsedTotal += dur;
      }
      if (!stopRequested) {
        $('#playStatus').textContent = isRecording ? '录制完成' : '播放完成';
        $('#playBar').style.width = '100%';
      }
    } catch (e) {
      toast(`播放失败：${e.message}`, 'err', 4000);
    } finally {
      playing = false;
      stopRequested = false;
      $('#playBtn').disabled = false;
      $('#stopBtn').disabled = true;
    }
  }

  async function record() {
    if (playing) return toast('正在播放中', 'warn');
    if (!window.MediaRecorder) return toast('当前浏览器不支持录制，请使用 Chrome / Edge', 'err', 4000);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return toast('当前浏览器不支持 WebM 录制', 'err');
    let stream;
    try {
      stream = canvas.captureStream(30);
    } catch {
      return toast('存在未转存的线上素材，无法录制。请稍后在画面工坊重绘或等待自动转存', 'err', 5000);
    }
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(1000);
    await playAll(true);
    if (recorder?.state === 'recording') recorder.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    downloadBlob(blob, `${p.name}-成片.webm`);
    toast(`成片已导出（${(blob.size / 1024 / 1024).toFixed(1)} MB）`, 'ok', 4000);
    $('#playStatus').textContent = '成片已导出';
  }

  function speak() {
    if (!window.speechSynthesis) return toast('当前浏览器不支持语音朗读', 'warn');
    const lines = active().map((s) => s.dialogue).filter(Boolean);
    if (!lines.length) return toast('没有台词', 'warn');
    window.speechSynthesis.cancel();
    lines.forEach((line) => {
      const u = new SpeechSynthesisUtterance(line);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    });
    toast('开始朗读配音稿（浏览器本地 TTS，免费）', 'ok');
  }

  async function exportPack() {
    const btn = $('#packBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>打包中';
    try {
      const list = active();
      let JSZip;
      try {
        JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
      } catch {
        JSZip = null;
      }
      if (!JSZip) {
        await fallbackDownloads(list);
        return;
      }
      const zip = new JSZip();
      zip.file('分镜表.json', JSON.stringify(p.shots, null, 2));
      zip.file('剧本.md', p.script || '');
      zip.file('小说.txt', p.chapters.map((c, i) => `第${i + 1}章 ${c.title}\n\n${c.content}`).join('\n\n'));
      zip.file('字幕.srt', buildSrt(list));
      zip.file('配音稿.txt', list.map((s) => `镜${s.no}：${s.dialogue || ''}`).join('\n'));
      zip.file('素材地址.txt', list.map((s) => `镜${s.no}\t${s.videoUrl || ''}`).join('\n'));
      const imgDir = zip.folder('images');
      const vidDir = zip.folder('videos');
      for (const s of list) {
        const img = s.imageAssetId ? state.assets.get(s.imageAssetId) : null;
        let ib = img?.blob;
        if (!ib && s.imageUrl) {
          try { ib = await downloadAsset(s.imageUrl); } catch {}
        }
        if (ib) imgDir.file(`shot-${String(s.no).padStart(2, '0')}.png`, ib);
        else if (s.imageUrl) zip.file(`images/链接-镜${s.no}.txt`, s.imageUrl);
        const vid = s.videoAssetId ? state.assets.get(s.videoAssetId) : null;
        let vb = vid?.blob;
        if (!vb && s.videoUrl) {
          try { vb = await downloadAsset(s.videoUrl); } catch {}
        }
        if (vb) vidDir.file(`shot-${String(s.no).padStart(2, '0')}.mp4`, vb);
        else if (s.videoUrl) zip.file(`videos/链接-镜${s.no}.txt`, s.videoUrl);
      }
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        btn.innerHTML = `<span class="spin"></span>${Math.round(meta.percent)}%`;
      });
      downloadBlob(blob, `${p.name}-制作包.zip`);
      toast('制作包已导出', 'ok', 3000);
    } catch (e) {
      toast(`打包失败：${e.message}`, 'err', 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = '导出制作包';
    }
  }

  async function fallbackDownloads(list) {
    toast('ZIP 组件加载失败，改为逐个下载', 'warn', 3000);
    for (const s of list) {
      const img = s.imageAssetId ? state.assets.get(s.imageAssetId) : null;
      if (img?.blob) downloadBlob(img.blob, `${p.name}-镜${s.no}.png`);
      else if (s.imageUrl) {
        try { downloadBlob(await downloadAsset(s.imageUrl), `${p.name}-镜${s.no}.png`); } catch {}
      }
      const vid = s.videoAssetId ? state.assets.get(s.videoAssetId) : null;
      if (vid?.blob) downloadBlob(vid.blob, `${p.name}-镜${s.no}.mp4`);
      else if (s.videoUrl) {
        try { downloadBlob(await downloadAsset(s.videoUrl), `${p.name}-镜${s.no}.mp4`); } catch {}
      }
      await sleep(350);
    }
    downloadBlob(new Blob([JSON.stringify(p.shots, null, 2)], { type: 'application/json' }), `${p.name}-分镜.json`);
  }
}

/* ---------------- 绘制 ---------------- */
function drawIdle(ctx, p) {
  const g = ctx.createLinearGradient(0, 0, 1280, 720);
  g.addColorStop(0, '#12122a');
  g.addColorStop(0.55, '#0a0a14');
  g.addColorStop(1, '#101a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = 'rgba(124,92,255,.16)';
  ctx.beginPath();
  ctx.arc(1030, 130, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(34,211,238,.1)';
  ctx.beginPath();
  ctx.arc(180, 640, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c4b5fd';
  ctx.font = '500 22px "PingFang SC", sans-serif';
  ctx.fillText('云幕 UU · 成片预览', 640, 340);
  ctx.fillStyle = '#6f6e88';
  ctx.font = '14px "PingFang SC", sans-serif';
  ctx.fillText(p.name || '', 640, 372);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(380, 400, 520, 1);
  ctx.fillStyle = '#55546c';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText('点击「播放预览」查看分镜串联效果', 640, 428);
  ctx.textAlign = 'left';
}

async function playShot(ctx, shot, duration, index, onProgress) {
  const W = 1280, H = 720;
  const videoAsset = shot.videoAssetId ? state.assets.get(shot.videoAssetId) : null;
  const imgAsset = shot.imageAssetId ? state.assets.get(shot.imageAssetId) : null;
  let videoBlob = videoAsset?.blob || null;
  let imgBlob = imgAsset?.blob || null;
  if (!videoBlob && shot.videoUrl) {
    try { videoBlob = await downloadAsset(shot.videoUrl, undefined, true); } catch {}
  }
  if (!videoBlob && !imgBlob && shot.imageUrl) {
    try { imgBlob = await downloadAsset(shot.imageUrl, undefined, true); } catch {}
  }
  let video = null;
  let image = null;

  if (videoBlob) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.loop = true;
    video.src = URL.createObjectURL(videoBlob);
    await new Promise((resolve) => {
      const done = () => resolve();
      video.onloadeddata = done;
      video.onerror = done;
      setTimeout(done, 4000);
    });
    try { await video.play(); } catch {}
  } else if (imgBlob) {
    image = new Image();
    image.src = URL.createObjectURL(imgBlob);
    await new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
      setTimeout(resolve, 4000);
    });
  } else if (shot.imageUrl) {
    image = new Image();
    image.src = shot.imageUrl;
    await new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
      setTimeout(resolve, 6000);
    });
  }

  const start = performance.now();
  const dir = (index % 2 === 0) ? 1 : -1;

  await new Promise((resolve) => {
    const tick = () => {
      if (stopRequested) { resolve(); return; }
      const elapsed = (performance.now() - start) / 1000;
      const t = Math.min(elapsed, duration);
      ctx.fillStyle = '#05050a';
      ctx.fillRect(0, 0, W, H);

      if (video && video.readyState >= 2) {
        drawCover(ctx, video, W, H, 1);
      } else if (image && image.complete && image.naturalWidth) {
        const zoom = 1.05 + 0.07 * (t / duration);
        const pan = dir * 18 * (t / duration);
        drawCover(ctx, image, W, H, zoom, pan, 0);
      } else {
        drawPlaceholder(ctx, shot);
      }

      // 轻微暗角 + 底部渐变
      const vg = ctx.createRadialGradient(W / 2, H / 2, 220, W / 2, H / 2, 760);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.5)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, H - 220, 0, H);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(1, 'rgba(0,0,0,.72)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, H - 220, W, 220);

      // 左上角分镜标记
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(34, 30, 132, 30);
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText(`SHOT ${String(index + 1).padStart(2, '0')} · ${shot.scene || ''}`.slice(0, 18), 46, 50);

      // 台词字幕
      if (shot.dialogue) drawSubtitle(ctx, shot.dialogue, W, H);

      onProgress?.(t);
      if (t >= duration) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  if (video) {
    try { video.pause(); } catch {}
    URL.revokeObjectURL(video.src);
  }
  if (image) URL.revokeObjectURL(image.src);
}

function drawCover(ctx, media, W, H, zoom = 1, panX = 0, panY = 0) {
  const mw = media.videoWidth || media.naturalWidth || media.width;
  const mh = media.videoHeight || media.naturalHeight || media.height;
  if (!mw || !mh) return;
  const scale = Math.max(W / mw, H / mh) * zoom;
  const dw = mw * scale;
  const dh = mh * scale;
  const dx = (W - dw) / 2 + panX;
  const dy = (H - dh) / 2 + panY;
  ctx.drawImage(media, dx, dy, dw, dh);
}

function drawPlaceholder(ctx, shot) {
  const g = ctx.createLinearGradient(0, 0, 1280, 720);
  g.addColorStop(0, '#141426');
  g.addColorStop(1, '#0b0b14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = '#8b8aa5';
  ctx.font = '24px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('缺素材 · 待生成画面或视频', 640, 340);
  ctx.fillStyle = '#55546c';
  ctx.font = '15px "PingFang SC", sans-serif';
  wrapText(ctx, shot.desc || '', 640, 382, 700, 24, 'center');
  ctx.textAlign = 'left';
}

function drawSubtitle(ctx, text, W, H) {
  const size = 30;
  ctx.font = `500 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  const maxW = W - 220;
  const lines = [];
  let line = '';
  for (const ch of String(text)) {
    if (ctx.measureText(line + ch).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 2);
  const lineH = 44;
  const boxH = shown.length * lineH + 22;
  const y = H - 74 - boxH;
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  roundRect(ctx, W / 2 - maxW / 2 - 14, y, maxW + 28, boxH, 10);
  ctx.fill();
  ctx.fillStyle = '#f4f3ff';
  ctx.textAlign = 'center';
  shown.forEach((l, i) => {
    ctx.fillText(l, W / 2, y + 38 + i * lineH);
  });
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, align = 'left') {
  const chars = String(text).split('');
  let line = '';
  let cy = y;
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      ctx.fillText(line, x, cy);
      line = ch;
      cy += lineHeight;
    } else {
      line += ch;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}
