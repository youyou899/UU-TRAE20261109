/* 设置：Key、模型、存储、部署说明 */
import { state } from './state.js';
import { $, $$, esc, toast, setBusy, modal, confirmDialog } from './ui.js';
import { getSettings, saveSettings, storageUsage, clearAll } from './store.js';
import { TEXT_MODELS, VISION_MODELS, IMAGE_MODELS, VIDEO_MODELS, PROVIDERS, testConnection } from './api.js';

export function renderSettings(root) {
  const s = getSettings();

  root.innerHTML = `
    <div class="page-head">
      <div><h1>设置 <small>SETTINGS</small></h1><p>Key 只保存在本机浏览器；云端可用环境变量注入，不写入仓库。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="testBtn">测试连接</button>
        <button class="btn btn-primary" id="saveBtn">保存设置</button>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card">
        <div class="card-head"><h3>API 接入</h3><span class="sub">智谱 BigModel</span></div>
        <div class="field">
          <label>API Key <b>仅存本机 localStorage</b></label>
          <div class="inline" style="flex-wrap:nowrap">
            <input class="input" id="apiKey" type="password" placeholder="xxxx.xxxx" value="${esc(s.apiKey)}" autocomplete="off" />
            <button class="btn btn-ghost" id="toggleKey" style="flex:0 0 auto">显示</button>
          </div>
          <div class="tiny" style="margin-top:6px">公开仓库千万不要提交 Key；部署到 Pages 后建议改用环境变量 ZHIPU_API_KEY。</div>
        </div>
        <div class="field">
          <label>代理地址 <b>必须经同源代理，浏览器直连会被 CORS 拦截</b></label>
          <input class="input" id="apiBase" value="${esc(s.apiBase)}" placeholder="/api" />
          <div class="tiny" style="margin-top:6px">默认 /api（Cloudflare Pages Functions）。本地开发由 dev-server 代理。</div>
        </div>
        <div class="row">
          <div class="field"><label>文本 / 剧本模型</label>
            <select class="select" id="textModel">${TEXT_MODELS.map((m) => `<option value="${m.id}" ${m.id === s.textModel ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
          </div>
          <div class="field"><label>视觉理解模型</label>
            <select class="select" id="visionModel">${VISION_MODELS.map((m) => `<option value="${m.id}" ${m.id === s.visionModel ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>图片来源</label>
            <select class="select" id="imageProvider">
              <option value="zhipu" ${s.imageProvider !== 'doubao' ? 'selected' : ''}>智谱 CogView-3-Flash（免费 · 带水印）</option>
              <option value="doubao" ${s.imageProvider === 'doubao' ? 'selected' : ''}>豆包 Seedream 5.0 Flash（免费额度 · 无水印）</option>
            </select>
          </div>
          <div class="field"><label>视频来源</label>
            <select class="select" id="videoProvider">
              <option value="zhipu" ${s.videoProvider !== 'doubao' ? 'selected' : ''}>智谱 CogVideoX-Flash（免费 · 高峰拥堵）</option>
              <option value="doubao" ${s.videoProvider === 'doubao' ? 'selected' : ''}>豆包 Seedance 2.0 Mini（免费额度 · 较快）</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>图像模型（智谱）</label>
            <select class="select" id="imageModel">${IMAGE_MODELS.map((m) => `<option value="${m.id}" ${m.id === s.imageModel ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
          </div>
          <div class="field"><label>视频模型（智谱）</label>
            <select class="select" id="videoModel">${VIDEO_MODELS.map((m) => `<option value="${m.id}" ${m.id === s.videoModel ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="row">
          <div class="field"><label>图片并发数</label>
            <select class="select" id="concurrency">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === s.concurrency ? 'selected' : ''}>${n} 路</option>`).join('')}</select>
          </div>
          <div class="field"><label>深度思考</label>
            <label class="switch" style="height:38px"><input type="checkbox" id="thinking" ${s.thinking ? 'checked' : ''} /><i></i>让文本模型先推理（更慢）</label>
          </div>
        </div>
        <div class="field"><label>全局画风提示词</label>
          <textarea class="textarea" id="stylePrompt" style="min-height:70px">${esc(s.stylePrompt)}</textarea>
        </div>
        <div id="testResult"></div>
      </div>

      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h3>备用免费供应商</h3><span class="sub">OpenAI 兼容</span></div>
          <div class="field"><label>优先使用</label>
            <select class="select" id="preferredProvider">
              <option value="zhipu" ${s.preferredProvider === 'zhipu' ? 'selected' : ''}>智谱 BigModel（默认）</option>
              ${PROVIDERS.map((p) => `<option value="${p.id}" ${s.preferredProvider === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
          ${PROVIDERS.map((p) => `
            <div class="field" style="border-top:1px dashed var(--line);padding-top:10px">
              <label>${p.name} <b>${p.note}</b></label>
              <input class="input" data-pk="${p.id}" type="password" placeholder="API Key（不填则不启用）" value="${esc(s.providers?.[p.id]?.apiKey || '')}" autocomplete="off" />
              <div class="inline" style="margin-top:6px;flex-wrap:nowrap">
                <input class="input" data-pm="${p.id}" placeholder="模型名" value="${esc(s.providers?.[p.id]?.model || p.model)}" />
                <button class="btn btn-ghost" data-pt="${p.id}" style="flex:0 0 auto">测试</button>
              </div>
              <div class="tiny" style="margin-top:4px">${p.base}</div>
            </div>`).join('')}
          <div class="note warn" style="margin-top:10px">只填自己注册拿到的 Key；网上售卖的「AI 兑换码 / 内部激活码」基本是钓鱼。免费额度政策随时会变，多配几家做备用。</div>
          <div id="providerTestResult"></div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h3>免费模型可用性</h3><span class="sub">实测</span></div>
          <div class="kv"><span>GLM-4.7-Flash</span><b style="color:var(--ok)">可用 · 200K</b></div>
          <div class="kv"><span>GLM-4.5 / 4-Flash</span><b style="color:var(--ok)">可用</b></div>
          <div class="kv"><span>CogView-3-Flash</span><b style="color:var(--ok)">可用 · 带水印</b></div>
          <div class="kv"><span>CogVideoX-Flash</span><b style="color:var(--warn)">免费 · 高峰期拥堵</b></div>
          <div class="kv"><span>GLM-4.6V-Flash</span><b style="color:var(--ok)">可用</b></div>
          <div class="kv"><span>GLM-TTS / GLM-ASR</span><b style="color:var(--err)">付费 · 未接入</b></div>
          <div class="note" style="margin-top:14px">图片 / 视频链接约 7 天后失效，本项目会自动转存到 IndexedDB。</div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h3>本地数据</h3><span class="sub" id="usage">计算中…</span></div>
          <div class="kv"><span>存储方式</span><b>浏览器 IndexedDB</b></div>
          <div class="kv"><span>当前项目素材</span><b>${state.assets.size} 个</b></div>
          <div class="kv"><span>清理范围</span><b>项目 + 图片 + 视频</b></div>
          <div class="inline" style="margin-top:14px">
            <button class="btn btn-danger btn-sm" id="clearBtn">清空全部本地数据</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>三个仓库怎么用</h3></div>
          <div class="kv"><span>UU-TRAE20261109</span><b>主程序（部署到 Pages）</b></div>
          <div class="kv"><span>UU-TRAE20261109-2</span><b>图片素材库 / 图片站</b></div>
          <div class="kv"><span>UU-TRAE20261109-3</span><b>视频成片库 / 短剧站</b></div>
          <p class="tiny" style="margin-top:10px">三个仓库都能各自建一个免费 Pages 站点；主程序生成素材后导出制作包，再上传到对应素材仓库即可。也可以只用主仓库，另外两个留作备份与发布。</p>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>部署到 Cloudflare Pages（全免费）</h3><span class="sub">约 5 分钟</span></div>
      <div class="grid grid-2">
        <div>
          <h4 style="margin:0 0 8px;font-size:13px">方式一：网页连接 GitHub</h4>
          <div class="code">1. Cloudflare Dashboard → Workers &amp; Pages → Create
2. Pages → Connect to Git → 选择 UU-TRAE20261109
3. Framework preset：None
4. Build command：留空
5. Build output directory：/
6. Environment variables（可选）
   ZHIPU_API_KEY = 你的 Key
7. Save and Deploy
→ 得到 https://uu-studio-xxx.pages.dev</div>
          <p class="tiny" style="margin-top:8px">Functions 目录会自动生效，/api 代理无需额外配置。</p>
        </div>
        <div>
          <h4 style="margin:0 0 8px;font-size:13px">方式二：命令行</h4>
          <div class="code">npm install -g wrangler
wrangler login
cd UU-TRAE20261109
wrangler pages deploy .

# 本地预览（含 /api 代理）
npm run dev
# 打开 http://localhost:8788</div>
          <p class="tiny" style="margin-top:8px">本地如需 Key：ZHIPU_API_KEY=xxx npm run dev</p>
        </div>
      </div>
      <div class="note ok" style="margin-top:14px">免费额度：Pages 静态请求不限量，Functions 10 万次/天；个人自用足够。</div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>还缺什么 / 替代方案</h3></div>
      <div class="kv"><span>免费 TTS 配音</span><b>缺口 · 方案：edge-tts 或浏览器 speechSynthesis</b></div>
      <div class="kv"><span>免费 ASR 字幕</span><b>缺口 · 方案：台词直接生成 SRT</b></div>
      <div class="kv"><span>角色一致性</span><b>已用「定妆照 + 固定角色描述」缓解，非参考图控制</b></div>
      <div class="kv"><span>视频单段时长</span><b>5 / 10 秒 · 多镜拼接</b></div>
      <div class="kv"><span>成片编码</span><b>WebM · 可转 MP4</b></div>
      <div class="kv"><span>免费素材存储</span><b>本机 IndexedDB · 可选 Cloudflare R2 10GB</b></div>
      <div class="kv"><span>内容合规</span><b>免费模型自带显式 / 隐式 AI 水印</b></div>
      <div class="kv"><span>密钥安全</span><b>环境变量优先，勿提交仓库</b></div>
    </div>
  `;

  $('#toggleKey').onclick = () => {
    const input = $('#apiKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#toggleKey').textContent = show ? '隐藏' : '显示';
  };

  $('#saveBtn').onclick = () => {
    saveSettings(collect());
    updateStatusPill();
    toast('设置已保存', 'ok');
  };

  $$('[data-pt]').forEach((b) => {
    b.onclick = async () => {
      saveSettings(collect());
      const id = b.dataset.pt;
      const name = PROVIDERS.find((p) => p.id === id)?.name || id;
      setBusy(b, true, '测试');
      const box = $('#providerTestResult');
      if (box) box.innerHTML = '';
      try {
        const r = await testConnection(id);
        if (box) box.innerHTML = `<div class="note ok">${esc(name)} 可用：${esc(r.text)}（${r.ms} ms · 模型 ${esc(r.model)}）</div>`;
        toast(`${name} 连接成功`, 'ok');
      } catch (err) {
        if (box) box.innerHTML = `<div class="note err">${esc(name)} 连接失败：${esc(err.message)}</div>`;
        toast(err.message, 'err', 4000);
      } finally {
        setBusy(b, false);
      }
    };
  });

  $('#testBtn').onclick = async (e) => {
    saveSettings(collect());
    const btn = e.currentTarget;
    setBusy(btn, true, '测试中');
    $('#testResult').innerHTML = '';
    try {
      const r = await testConnection();
      $('#testResult').innerHTML = `<div class="note ok">连接成功：${esc(r.text)}（${r.ms} ms）</div>`;
      updateStatusPill();
      toast('连接成功', 'ok');
    } catch (err) {
      $('#testResult').innerHTML = `<div class="note err">连接失败：${esc(err.message)}</div>`;
      toast(err.message, 'err', 4000);
    } finally {
      setBusy(btn, false);
    }
  };

  $('#clearBtn').onclick = async () => {
    const ok = await confirmDialog('将删除本机所有项目、图片与视频，且无法恢复。确定继续？', { okLabel: '全部清空' });
    if (!ok) return;
    await clearAll();
    toast('已清空，正在刷新…', 'ok');
    setTimeout(() => location.reload(), 700);
  };

  storageUsage().then(({ usage, quota }) => {
    const el = $('#usage');
    if (!el) return;
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    el.textContent = `${mb(usage)} MB / ${mb(quota)} MB`;
  });

  function collect() {
    const providers = {};
    for (const p of PROVIDERS) {
      providers[p.id] = {
        apiKey: $(`[data-pk="${p.id}"]`).value.trim(),
        model: $(`[data-pm="${p.id}"]`).value.trim() || p.model,
      };
    }
    return {
      apiKey: $('#apiKey').value.trim(),
      apiBase: $('#apiBase').value.trim() || '/api',
      preferredProvider: $('#preferredProvider').value,
      providers,
      textModel: $('#textModel').value,
      visionModel: $('#visionModel').value,
      imageProvider: $('#imageProvider').value,
      videoProvider: $('#videoProvider').value,
      imageModel: $('#imageModel').value,
      videoModel: $('#videoModel').value,
      concurrency: Number($('#concurrency').value),
      thinking: $('#thinking').checked,
      stylePrompt: $('#stylePrompt').value.trim(),
    };
  }

  function updateStatusPill() {
    const key = $('#apiKey').value.trim();
    const extra = PROVIDERS.filter((p) => $(`[data-pk="${p.id}"]`)?.value.trim()).length;
    const el = document.getElementById('apiStatus');
    if (!el) return;
    const total = (key ? 1 : 0) + extra;
    el.className = total ? 'status-pill ok' : 'status-pill err';
    el.innerHTML = total ? `<i></i> ${total} 个供应商已配置` : '<i></i> 未配置 Key';
  }
}
