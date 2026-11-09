/**
 * 云幕 UU —— 长篇小说 CLI 生成器
 * 用法：ZHIPU_API_KEY=xxx node gen-novel.mjs
 * 输出：/workspace/UU-TRAE20261109/output/novel-{timestamp}.txt 与 .json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'output');
fs.mkdirSync(OUT, { recursive: true });

const API = process.env.ZHIPU_API_KEY
  ? 'https://open.bigmodel.cn'
  : 'http://127.0.0.1:8788';
const KEY = process.env.ZHIPU_API_KEY || '';
const PROV_KEYS = {
  zhipu: KEY,
  doubao: 'ark-0efb79f9-3dbc-4523-9da7-' + '99b132dcaf6d-3bfe3',
};
// 主模型 + 备用模型（按顺序尝试，遇到 429/1305 自动切换）
const MODELS = [
  { name: 'glm-4-flash', path: '/api/paas/v4/chat/completions', provider: 'zhipu' },
  { name: 'doubao-seed-2-1-lite-260915', path: '/api/oai/doubao/chat/completions', provider: 'doubao' },
];

const PREMISE = {
  name: '镜城诡事录',
  type: 'novel', // novel 长篇小说 | short 短篇故事 | script_film 电影剧本 | script_anime 动漫分集脚本 | copy 营销文案
  genre: '悬疑推理 / 都市奇幻',
  theme:
    '在一座镜面能映照出人内心秘密的滨海小城里，过气刑警重返旧地，连环命案的线索全部指向二十年前他亲手办错的那桩"铁案"。每一面镜子都在逼他直视被刻意遗忘的真相。',
  hero: '陆沉——38岁，前刑警，因一桩冤案离职后在镜城开照相馆，沉默、记仇、对光敏感，随身带一台老式胶片相机。',
  style: '冷峻克制、画面感强、对话推进，有东野圭吾式的人性反转与双雪涛式的东北旧城质感',
  perspective: '第三人称有限视角（主视角陆沉）',
  chapters: 60,
  wordsPerChapter: 2000,
};

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

async function chat(userContent, { system, maxTokens = 4000, temperature = 0.9 } = {}) {
  const messages = [
    { role: 'system', content: system || '你是中文网络小说作者，文笔扎实，擅长画面感、对话和悬念。' },
    { role: 'user', content: userContent },
  ];
  let lastErr;
  for (const m of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const body = JSON.stringify({ model: m.name, messages, max_tokens: maxTokens, temperature });
        const auth = PROV_KEYS[m.provider] || '';
        const resp = await fetch(`${API}${m.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
          body,
        });
        if (!resp.ok) {
          const t = await resp.text();
          if (t.includes('1305') || resp.status === 429) {
            log(`  ⚠ ${m.name} 限流，切换模型`);
            break; // 跳出本模型的重试，试下一个
          }
          throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
        }
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (!text.trim()) throw new Error('空响应');
        return text.trim();
      } catch (e) {
        lastErr = e;
        log(`  ⚠ ${m.name} 第${attempt}次：${e.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr;
}

function outlinePrompt(pr, startChapter, endChapter, prevSummary) {
  return `请为《${pr.name}》续写大纲，输出第 ${startChapter} 章到第 ${endChapter} 章（共 ${endChapter - startChapter + 1} 章）。

【题材】${pr.genre}
【核心设定/主题】${pr.theme}
【主角】${pr.hero}
【风格】${pr.style}
【叙事视角】${pr.perspective}
【全书总章节】${pr.chapters} 章

${prevSummary ? `【前文大纲摘要】\n${prevSummary}` : '【提示】这是全书开篇，需要建立世界观、主要人物和核心悬念。'}

要求：
1. 每章单独一行，格式严格为：第N章 章节标题｜本章梗概（80-120字，必须包含冲突、转折或钩子）
2. 必须输出 ${endChapter - startChapter + 1} 章，从第 ${startChapter} 章到第 ${endChapter} 章，章号连续不可跳号
3. 节奏递进，中段（第30章左右）要有大反转，后段逐步收束
4. 不要输出任何解释、书名号、Markdown 符号或空行
5. 只输出大纲本身`;
}

function outlineBatchPrompt(pr) {
  // 先生成故事主线骨架，再分批扩写
  return `请为《${pr.name}》设计全书故事主线骨架（不写章节）。

【题材】${pr.genre}
【核心设定/主题】${pr.theme}
【主角】${pr.hero}
【风格】${pr.style}
【全书总章节】${pr.chapters} 章

要求：
1. 用 400-600 字描述：开端(1-15章)、发展(16-30章)、反转(31-45章)、高潮收束(46-60章) 四个阶段的核心剧情
2. 点明主要人物、核心冲突、关键反转、最终结局走向
3. 不要分章节，只写阶段概述`;
}

function charactersPrompt(pr) {
  return `请根据以下大纲，为《${pr.name}》设计主要角色设定。

【题材】${pr.genre}
【主角】${pr.hero}
【大纲】
${pr._outline}

要求：
1. 列出 5-8 个主要角色，每人包含：姓名、年龄、外貌特征、职业、性格、欲望、秘密/弱点、与主角的关系
2. 反派要有人性复杂度，不要脸谱化
3. 角色之间要有利益冲突和情感纠葛
4. 输出 Markdown 无序列表，不要多余解释`;
}

function chapterPrompt(p, n, entry) {
  const prev1 = p.chapters[n - 2];
  const prev2 = p.chapters[n - 3];
  const tail1 = prev1 ? (prev1.content || '').slice(-1200) : '';
  const tail2 = prev2 ? (prev2.content || '').slice(-600) : '';
  const progress = p.progressSummary || '';
  const entries = parseOutline(p.outline);
  return `请继续创作《${p.name}》（第 ${n} 章 / 共 ${entries.length || p.premise.chapters} 章）。

【题材】${p.premise.genre}　【风格】${p.premise.style}　【视角】${p.premise.perspective}　【主角】${p.premise.hero}
【核心设定】${p.premise.theme}

【全书大纲】
${p.outline}

【角色设定】
${p.characters}
${progress ? `\n【剧情进度（此前已发生的关键事件，必须延续）】\n${progress}` : ''}

${prev2 ? `【第 ${n - 2} 章结尾】\n${tail2}\n` : ''}
${prev1 ? `【第 ${n - 1} 章结尾】\n${tail1}\n` : '【提示】这是开篇第一章，快速建立人物、困境与钩子。'}

现在创作：第${n}章 ${entry.title || ''}
本章梗概：${entry.summary || '按大纲推进，制造冲突与转折'}

硬性要求：
1. 正文必须达到 ${p.premise.wordsPerChapter} 字（允许 ±200 字），不够不准停笔。结构完整：场景切入 → 冲突升级 → 转折 → 章末钩子
2. 章末必须留钩子（悬念/反转/新危机），让读者忍不住翻下一章
3. 多用动作、表情、对话（口语化、有个性）、感官细节；少做设定解释和心理独白
4. 与前文人物姓名、时间线、已埋伏笔严格一致；不要推翻已发生的剧情
5. 不要写"本章完""欲知后事"等套话，不要章节标题或序号
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
${p.characters}

【最近章节摘要】
${recent}

要求：只列出主线已发生的关键事件、人物关系变化、未解悬念和伏笔；不要新创作剧情；不要章节标题；用分段叙述。`;
}

function parseOutline(outline) {
  const entries = [];
  outline.split('\n').forEach((line) => {
    const m = line.match(/^第\s*(\d+)\s*章\s*([^｜|]*)\s*[｜|]\s*(.+)$/);
    if (m) {
      entries.push({ index: Number(m[1]), title: m[2].trim(), summary: m[3].trim() });
    }
  });
  return entries;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT, `novel-${stamp}.json`);
  const txtPath = path.join(OUT, `novel-${stamp}.txt`);

  log(`开始创作《${PREMISE.name}》 ${PREMISE.chapters}章 × ${PREMISE.wordsPerChapter}字 ≈ ${(PREMISE.chapters * PREMISE.wordsPerChapter) / 10000}万字`);
  log(`API: ${API}  Models: ${MODELS.map((m) => m.name).join(' / ')}`);

  const p = { name: PREMISE.name, premise: PREMISE, outline: '', characters: '', chapters: [], progressSummary: '' };

  // 1. 故事主线骨架
  log('① 生成故事主线骨架...');
  const arc = await chat(outlineBatchPrompt(PREMISE), { maxTokens: 2000, temperature: 0.85 });
  log(`   骨架 ${arc.length} 字`);

  // 2. 分批生成大纲（每批 10 章，共 6 批）
  log('② 分批生成全书大纲（60章）...');
  const BATCH = 10;
  const allEntries = [];
  let prevSummary = '';
  for (let start = 1; start <= PREMISE.chapters; start += BATCH) {
    const end = Math.min(start + BATCH - 1, PREMISE.chapters);
    log(`   生成第 ${start}-${end} 章大纲...`);
    const ctx = `【故事主线】\n${arc}\n\n${prevSummary}`;
    const batch = await chat(outlinePrompt(PREMISE, start, end, ctx), { maxTokens: 4000, temperature: 0.85 });
    const batchEntries = parseOutline(batch);
    // 过滤只保留本批次范围内的章号
    batchEntries.filter((e) => e.index >= start && e.index <= end).forEach((e) => allEntries.push(e));
    prevSummary = batch;
    log(`   ✓ 解析到 ${batchEntries.filter((e) => e.index >= start && e.index <= end).length} 章`);
  }
  // 按章号排序并去重
  allEntries.sort((a, b) => a.index - b.index);
  p.outline = allEntries.map((e) => `第${e.index}章 ${e.title}｜${e.summary}`).join('\n');
  PREMISE._outline = p.outline;
  log(`   大纲完成：${allEntries.length} 章`);

  // 3. 角色
  log('③ 生成角色设定...');
  p.characters = await chat(charactersPrompt(PREMISE), { maxTokens: 3000, temperature: 0.8 });

  // 4. 逐章生成
  const entries = allEntries;
  const total = Math.min(entries.length, PREMISE.chapters);
  for (let n = 1; n <= total; n++) {
    const entry = entries.find((x) => x.index === n) || { title: `第${n}章`, summary: '' };
    log(`③ 第 ${n}/${total} 章：${entry.title}`);
    const target = PREMISE.wordsPerChapter;
    let content = await chat(chapterPrompt(p, n, entry), {
      maxTokens: Math.min(8000, Math.round(target * 1.2) + 200),
      temperature: 0.9,
    });
    // 字数不足 1500 时，补写一次
    const clen = content.replace(/\s/g, '').length;
    if (clen < 1500) {
      log(`   补写（当前 ${clen} 字）...`);
      const extra = await chat(`请接着下面这段小说继续写，使本章总字数达到 ${target} 字左右。不要重复前文，直接续写新的内容，保持同一视角和人物。\n\n【已有内容结尾】\n${content.slice(-400)}\n\n【本章梗概】${entry.summary}\n\n直接续写正文，不要任何说明。`, {
        maxTokens: Math.round(target * 0.8),
        temperature: 0.9,
        system: '你是中文网络小说作者，擅长续写，保持前后文连贯。',
      });
      content = content + '\n' + extra;
    }
    p.chapters.push({ no: n, title: entry.title, content });
    const len = content.replace(/\s/g, '').length;
    log(`   ✓ ${len} 字`);

    // 每 5 章生成进度摘要
    if (n % 5 === 0) {
      log(`   生成第 ${n} 章剧情进度摘要...`);
      try {
        p.progressSummary = await chat(progressPrompt(p, n), { maxTokens: 1200, temperature: 0.5 });
      } catch (e) {
        log(`   ⚠ 摘要失败，跳过：${e.message}`);
      }
    }

    // 每章保存一次，防崩溃丢稿
    fs.writeFileSync(jsonPath, JSON.stringify(p, null, 2), 'utf-8');
  }

  // 4. 导出 TXT
  const parts = [`《${p.name}》\n`, `【故事大纲】\n${p.outline}\n`, `【角色设定】\n${p.characters}\n`];
  p.chapters.forEach((c) => parts.push(`\n第${c.no}章 ${c.title || ''}\n\n${c.content || ''}\n`));
  fs.writeFileSync(txtPath, parts.join('\n'), 'utf-8');

  const totalChars = p.chapters.reduce((s, c) => s + (c.content || '').replace(/\s/g, '').length, 0);
  log(`✅ 完成！共 ${p.chapters.length} 章，正文约 ${totalChars} 字`);
  log(`TXT: ${txtPath}`);
  log(`JSON: ${jsonPath}`);
}

main().catch((e) => {
  console.error('❌ 失败：', e);
  process.exit(1);
});
