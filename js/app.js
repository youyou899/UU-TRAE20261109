/* 应用外壳：路由、项目切换、工作台、项目库 */
import * as store from './store.js';
import { state, setProject, loadProjectAssets, projectStats, flushSave } from './state.js';
import { $, esc, toast, modal, confirmDialog, promptDialog, fmtDate, fmtTime, downloadBlob } from './ui.js';
import { TEXT_MODELS, IMAGE_MODELS, VIDEO_MODELS } from './api.js';
import { renderNovel } from './novel.js';
import { renderScript } from './script.js';
import { renderImage } from './image.js';
import { renderVideo } from './video.js';
import { renderCompose } from './compose.js';
import { renderSettings } from './settings.js';

const ROUTES = {
  dashboard: { title: '工作台', render: renderDashboard },
  novel: { title: '小说工坊', render: renderNovel },
  script: { title: '剧本分镜', render: renderScript },
  image: { title: '画面工坊', render: renderImage },
  video: { title: '短剧工坊', render: renderVideo },
  compose: { title: '成片合成', render: renderCompose },
  projects: { title: '项目库', render: renderProjects },
  settings: { title: '设置', render: renderSettings },
};

/* ---------------- 启动 ---------------- */
async function boot() {
  const projects = await store.listProjects();
  if (projects.length === 0) {
    const p = store.newProject('我的第一部短剧');
    await store.saveProject(p);
    projects.push(p);
  }
  await openProject(projects[0].id, false);
  await refreshProjectSelect();
  window.addEventListener('hashchange', route);
  window.addEventListener('uu:fallback', (e) => {
    toast(`「${e.detail.from}」繁忙，已自动切换「${e.detail.to}」`, 'warn', 3200);
  });
  route();
  updateStatus();
  bindShell();
}

function bindShell() {
  document.getElementById('topNew').onclick = createProjectFlow;
  document.getElementById('topSettings').onclick = () => go('settings');
  document.getElementById('menuBtn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('projectSelect').onchange = async (e) => {
    await openProject(e.target.value);
    route();
  };
}

async function createProjectFlow() {
  const name = await promptDialog('新建项目', '', '例如：雨夜来电 · 悬疑短剧');
  if (!name) return;
  const p = store.newProject(name);
  await store.saveProject(p);
  await openProject(p.id);
  await refreshProjectSelect();
  go('novel');
  toast('项目已创建', 'ok');
}

export async function openProject(id, rerender = true) {
  const p = await store.getProject(id);
  if (!p) return;
  setProject(p);
  await loadProjectAssets();
  if (rerender) {
    document.getElementById('projectSelect').value = id;
    const crumb = document.getElementById('crumb');
    if (crumb) crumb.textContent = p.name;
  }
}

async function refreshProjectSelect() {
  const list = await store.listProjects();
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (state.project) sel.value = state.project.id;
}

function go(route) {
  location.hash = `#/${route}`;
}

function route() {
  const name = (location.hash || '#/dashboard').replace(/^#\//, '').split('?')[0];
  const key = ROUTES[name] ? name : 'dashboard';
  state.route = key;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  document.getElementById('crumb').textContent = ROUTES[key].title;
  const view = document.getElementById('view');
  view.innerHTML = '';
  document.getElementById('sidebar').classList.remove('open');
  view.scrollTop = 0;
  Promise.resolve(ROUTES[key].render(view)).catch((e) => {
    view.innerHTML = `<div class="empty"><b>页面加载失败</b>${esc(e.message)}</div>`;
  });
}

function updateStatus() {
  const s = store.getSettings();
  const el = document.getElementById('apiStatus');
  if (!el) return;
  if (s.apiKey) {
    el.className = 'status-pill ok';
    el.innerHTML = '<i></i> Key 已配置';
  } else {
    el.className = 'status-pill err';
    el.innerHTML = '<i></i> 未配置 Key';
  }
}

export function refreshStatus() { updateStatus(); }
export { refreshProjectSelect, go };

/* ---------------- 工作台 ---------------- */
async function renderDashboard(root) {
  const projects = await store.listProjects();
  const s = projectStats();
  const totalShots = projects.reduce((n, p) => n + (p.shots?.length || 0), 0);
  root.innerHTML = `
    <section class="hero">
      <span class="tag">纯云端 · 纯免费 · 智谱免费模型</span>
      <h1>从一句设定，到一部<span>属于你的短剧</span></h1>
      <p>小说 → 剧本 → 分镜 → 画面 → 视频 → 成片，一条流水线全部在浏览器里完成。所有素材保存在本机 IndexedDB，不上传第三方服务器。</p>
      <div class="head-actions">
        <button class="btn btn-primary" id="heroNovel">开始写小说</button>
        <button class="btn btn-ghost" id="heroVision">查看免费模型栈</button>
      </div>
      <div class="pipeline">
        ${['小说正文', '剧本改编', '分镜拆解', 'AI 画面', '动态视频', '成片导出'].map((x, i) => `
          <div class="step"><b>${x}</b><span>STEP ${String(i + 1).padStart(2, '0')}</span></div>`).join('')}
      </div>
    </section>

    <div class="stats">
      <div class="stat"><i><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4V4Zm2 2v12h12V6H6Z"/></svg></i><small>项目总数</small><b>${projects.length}</b><em>本地保存</em></div>
      <div class="stat"><i><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5V4Zm2 2v3h10V6H7Zm0 6h10v-1.4H7V12Zm0 3h7v-1.4H7V15Z"/></svg></i><small>当前项目字数</small><b>${s.words.toLocaleString()}</b><em>${s.chapters} 章</em></div>
      <div class="stat"><i><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4V5Zm2 2v7l4-2.6 3 2 4-3.4 3 2.4V7H6Z"/></svg></i><small>分镜 / 画面</small><b>${s.shots}</b><em>${s.images} 张已生成</em></div>
      <div class="stat"><i><svg viewBox="0 0 24 24"><path d="M4 6h12v12H4V6Zm14 2.5 3-2v11l-3-2V8.5Z"/></svg></i><small>动态视频</small><b>${s.videos}</b><em>共 ${totalShots} 个分镜</em></div>
    </div>

    <div class="grid grid-2" style="grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)">
      <div class="card">
        <div class="card-head"><h3>快速开始</h3><span class="sub">三步出片</span></div>
        <div class="quick-grid" style="grid-template-columns:1fr">
          <button class="quick" data-go="novel"><em>01</em><b>写小说 / 生成故事大纲</b><span>设定题材、主角与章节数，GLM-4.7-Flash 逐章生成，可随时改写。</span></button>
          <button class="quick" data-go="script"><em>02</em><b>改编剧本 + 拆分镜</b><span>自动拆成 8–16 个镜头，带画面提示词、台词、时长与运镜。</span></button>
          <button class="quick" data-go="image"><em>03</em><b>生成画面与动态视频</b><span>CogView-3-Flash 出图，CogVideoX-Flash 图生视频，最后合成成片。</span></button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>免费模型栈</h3><span class="sub">已验证可用</span></div>
        <div class="kv"><span>文本 / 剧本</span><b>GLM-4.7-Flash · 200K</b></div>
        <div class="kv"><span>图像生成</span><b>CogView-3-Flash · 带水印</b></div>
        <div class="kv"><span>视频生成</span><b>CogVideoX-Flash · 5/10s</b></div>
        <div class="kv"><span>视觉理解</span><b>GLM-4.6V-Flash</b></div>
        <div class="hr"></div>
        <p class="tiny" style="margin:0 0 12px">还缺：免费 TTS 配音、免费语音转写。当前版本先用浏览器朗读与台词字幕替代。</p>
        <button class="btn btn-soft btn-sm" id="dashGap">查看缺失清单</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>最近项目</h3><a class="btn btn-ghost btn-sm" href="#/projects">全部项目</a></div>
      ${projects.length ? `<div class="proj-grid">${projects.slice(0, 4).map(projectCard).join('')}</div>` : '<div class="empty"><b>还没有项目</b>点击右上角「新建项目」开始</div>'}
    </div>
  `;

  root.querySelector('#heroNovel').onclick = () => go('novel');
  root.querySelector('#heroVision').onclick = () => go('settings');
  root.querySelector('#dashGap').onclick = showGapModal;
  root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  bindProjectCards(root);
}

function showGapModal() {
  modal({
    title: '这台「免费云端」还缺什么',
    width: 620,
    body: `
      <div class="note ok" style="margin-bottom:14px">已具备：文本、剧本、分镜、图像、图生视频、浏览器成片合成、云端免费部署。</div>
      <div class="kv"><span>免费配音 TTS</span><b style="color:var(--warn)">缺失 · 需 edge-tts 或浏览器朗读</b></div>
      <div class="kv"><span>免费语音转写（字幕）</span><b style="color:var(--warn)">缺失 · 用台词自动生成 SRT</b></div>
      <div class="kv"><span>角色一致性</span><b>靠角色设定 + 固定风格词，非参考图</b></div>
      <div class="kv"><span>视频时长</span><b>单段 5/10 秒，需多镜拼接</b></div>
      <div class="kv"><span>免费视频排队</span><b>高峰期 1305，需自动重试</b></div>
      <div class="kv"><span>素材有效期</span><b>智谱链接约 7 天，需转存本地</b></div>
      <div class="kv"><span>合规标识</span><b>免费模型自带 AI 水印</b></div>
      <p class="tiny" style="margin-top:14px">详细方案见「设置 → 部署与说明」。</p>
    `,
    actions: [{ label: '知道了', primary: true }],
  });
}

/* ---------------- 项目库 ---------------- */
function projectCard(p) {
  const s = projectStats(p);
  const stage = s.videos ? '已成片' : s.images ? '已出图' : s.shots ? '已分镜' : s.chapters ? '已写小说' : '刚创建';
  return `
    <div class="proj-card" data-project="${p.id}">
      <h3>${esc(p.name)}</h3>
      <div class="meta">${fmtDate(p.updatedAt)} 更新 · ${stage}</div>
      <div class="bar">
        <span class="chip">${s.chapters} 章</span>
        <span class="chip">${s.words} 字</span>
        <span class="chip">${s.shots} 镜</span>
        <span class="chip ${s.images ? 'ok' : ''}">${s.images} 图</span>
        <span class="chip ${s.videos ? 'ok' : ''}">${s.videos} 视频</span>
      </div>
      <div class="foot">
        <span class="tiny">${esc(p.premise?.genre || '未设定题材')}</span>
        <span class="inline">
          <button class="btn btn-ghost btn-xs" data-del="${p.id}">删除</button>
          <button class="btn btn-soft btn-xs" data-open="${p.id}">打开</button>
        </span>
      </div>
    </div>`;
}

function bindProjectCards(root) {
  root.querySelectorAll('[data-open]').forEach((b) => {
    b.onclick = async (e) => { e.stopPropagation(); await openProject(b.dataset.open); await refreshProjectSelect(); go('novel'); };
  });
  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('删除后该项目的章节、分镜与本地素材都会移除，且不可恢复。确定删除？', { okLabel: '删除' });
      if (!ok) return;
      await store.deleteProject(b.dataset.del);
      if (state.project?.id === b.dataset.del) {
        const list = await store.listProjects();
        if (list[0]) await openProject(list[0].id, false);
        else {
          const np = store.newProject('我的第一部短剧');
          await store.saveProject(np);
          await openProject(np.id, false);
        }
      }
      await refreshProjectSelect();
      route();
      toast('项目已删除', 'ok');
    };
  });
  root.querySelectorAll('.proj-card').forEach((c) => {
    c.onclick = async () => {
      const id = c.dataset.project;
      if (!id) return;
      await openProject(id);
      await refreshProjectSelect();
      go('novel');
    };
  });
}

async function renderProjects(root) {
  const projects = await store.listProjects();
  root.innerHTML = `
    <div class="page-head">
      <div><h1>项目库 <small>PROJECTS</small></h1><p>所有项目保存在浏览器 IndexedDB 中。换设备前请导出项目 JSON 与成片制作包。</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="importBtn">导入项目</button>
        <button class="btn btn-primary" id="newBtn">新建项目</button>
      </div>
    </div>
    <div class="proj-grid">
      ${projects.map((p) => `
        <div class="proj-card" data-project="${p.id}">
          <h3>${esc(p.name)}</h3>
          <div class="meta">创建于 ${fmtTime(p.createdAt)}</div>
          <div class="bar">
            ${(() => { const s = projectStats(p); return `<span class="chip">${s.chapters} 章</span><span class="chip">${s.shots} 镜</span><span class="chip">${s.images} 图</span><span class="chip">${s.videos} 视频</span>`; })()}
          </div>
          <div class="foot">
            <span class="inline">
              <button class="btn btn-ghost btn-xs" data-export="${p.id}">导出</button>
              <button class="btn btn-ghost btn-xs" data-del="${p.id}">删除</button>
            </span>
            <button class="btn btn-soft btn-xs" data-open="${p.id}">打开</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="note" style="margin-top:18px">提示：素材（图片 / 视频）体积较大，默认只保存在本机；成片请在「成片合成 → 导出制作包」里打包。</div>
  `;
  root.querySelector('#newBtn').onclick = createProjectFlow;
  bindProjectCards(root);
  root.querySelectorAll('[data-export]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const p = await store.getProject(b.dataset.export);
      const blob = new Blob([JSON.stringify({ format: 'uu-studio-project', version: 1, project: p }, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${p.name || 'project'}.json`);
      toast('项目已导出（不含媒体素材）', 'ok');
    };
  });
  root.querySelector('#importBtn').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const p = data.project || data;
        if (!p.name) throw new Error('不是有效的项目文件');
        p.id = store.uid('p');
        p.name = `${p.name}（导入）`;
        p.createdAt = Date.now();
        p.updatedAt = Date.now();
        delete p.compose;
        await store.saveProject(p);
        await refreshProjectSelect();
        route();
        toast('项目已导入', 'ok');
      } catch (err) {
        toast(`导入失败：${err.message}`, 'err');
      }
    };
    input.click();
  };
}

/* 保存离开前的改动 */
window.addEventListener('beforeunload', () => { flushSave(); });

boot().catch((e) => {
  document.getElementById('view').innerHTML = `<div class="empty"><b>初始化失败</b>${esc(e.message)}<br/><span class="tiny">请用本地服务器或 Cloudflare Pages 打开（不支持 file:// 直接双击）</span></div>`;
});
