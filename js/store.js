/* 本地存储：IndexedDB 存项目与素材，localStorage 存设置 */

const DB_NAME = 'uu-studio';
const DB_VERSION = 1;
const LS_KEY = 'uu.settings.v1';

export const DEFAULT_SETTINGS = {
  apiKey: '',
  apiBase: '/api',
  textModel: 'glm-4.7-flash',
  visionModel: 'glm-4.6v-flash',
  imageModel: 'cogview-3-flash',
  videoModel: 'cogvideox-flash',
  thinking: false,
  imageSize: '1344x768',
  videoSize: '1280x720',
  videoDuration: 5,
  concurrency: 2,
  stylePrompt: '电影感写实国风，统一色调，柔和体积光，35mm 胶片质感，高细节，构图讲究',
};

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

export function isConfigured() {
  const s = getSettings();
  return Boolean(s.apiKey || location.hostname.endsWith('.pages.dev') || location.hostname === 'localhost');
}

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function newProject(name = '未命名项目') {
  const now = Date.now();
  return {
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    premise: {
      genre: '都市悬疑',
      theme: '',
      hero: '',
      style: '强情节、快节奏、强钩子',
      perspective: '第三人称',
      chapters: 6,
      wordsPerChapter: 2000,
    },
    outline: '',
    chapters: [],
    characters: '',
    script: '',
    shots: [],
    compose: { order: [], subtitles: true },
  };
}

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const st = db.createObjectStore('assets', { keyPath: 'id' });
        st.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    try { result = fn(os); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects() {
  const db = await openDB();
  const res = await reqToPromise(db.transaction('projects').objectStore('projects').getAll());
  return res.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id) {
  const db = await openDB();
  return reqToPromise(db.transaction('projects').objectStore('projects').get(id));
}

export async function saveProject(p) {
  p.updatedAt = Date.now();
  const db = await openDB();
  await reqToPromise(db.transaction('projects', 'readwrite').objectStore('projects').put(p));
  return p;
}

export async function deleteProject(id) {
  const assets = await listAssets(id);
  const db = await openDB();
  const t = db.transaction(['projects', 'assets'], 'readwrite');
  t.objectStore('projects').delete(id);
  assets.forEach((a) => t.objectStore('assets').delete(a.id));
  return new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function listAssets(projectId) {
  const db = await openDB();
  const idx = db.transaction('assets').objectStore('assets').index('projectId');
  return reqToPromise(idx.getAll(projectId));
}

export async function getAsset(id) {
  if (!id) return null;
  const db = await openDB();
  return reqToPromise(db.transaction('assets').objectStore('assets').get(id));
}

export async function putAsset(asset) {
  const db = await openDB();
  await reqToPromise(db.transaction('assets', 'readwrite').objectStore('assets').put(asset));
  return asset;
}

export async function deleteAsset(id) {
  const db = await openDB();
  return reqToPromise(db.transaction('assets', 'readwrite').objectStore('assets').delete(id));
}

export async function clearAll() {
  const db = await openDB();
  const t = db.transaction(['projects', 'assets'], 'readwrite');
  t.objectStore('projects').clear();
  t.objectStore('assets').clear();
  return new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

/** 估算 IndexedDB 占用 */
export async function storageUsage() {
  if (navigator.storage?.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    } catch {}
  }
  return { usage: 0, quota: 0 };
}
