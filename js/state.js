/* 全局状态与素材 URL 管理 */
import { listAssets, saveProject } from './store.js';

export const state = {
  project: null,
  route: 'dashboard',
  assets: new Map(),   // assetId -> asset
  urls: new Map(),     // assetId -> objectURL
};

export function setProject(p) {
  revokeUrls();
  state.project = p;
  state.assets = new Map();
}

export async function loadProjectAssets() {
  if (!state.project) return;
  revokeUrls();
  const list = await listAssets(state.project.id);
  state.assets = new Map(list.map((a) => [a.id, a]));
}

export function putAssetInState(asset) {
  state.assets.set(asset.id, asset);
  return asset;
}

export function removeAssetFromState(id) {
  const url = state.urls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.urls.delete(id);
  state.assets.delete(id);
}

export function assetUrl(id) {
  if (!id) return '';
  if (state.urls.has(id)) return state.urls.get(id);
  const asset = state.assets.get(id);
  if (!asset?.blob) return '';
  const url = URL.createObjectURL(asset.blob);
  state.urls.set(id, url);
  return url;
}

export function getAsset(id) {
  return state.assets.get(id);
}

export function revokeUrls() {
  for (const url of state.urls.values()) URL.revokeObjectURL(url);
  state.urls.clear();
}

let saveTimer = null;
export function saveSoon(delay = 600) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.project) saveProject(state.project).catch(() => {});
  }, delay);
}

export async function flushSave() {
  clearTimeout(saveTimer);
  if (state.project) await saveProject(state.project);
}

export function projectStats(p = state.project) {
  if (!p) return { chapters: 0, words: 0, shots: 0, images: 0, videos: 0 };
  const words = (p.chapters || []).reduce((n, c) => n + (c.content || '').replace(/\s/g, '').length, 0);
  const shots = p.shots?.length || 0;
  const images = (p.shots || []).filter((s) => s.imageAssetId).length;
  const videos = (p.shots || []).filter((s) => s.videoAssetId || s.videoUrl).length;
  return { chapters: p.chapters?.length || 0, words, shots, images, videos };
}

export function newShot(no, patch = {}) {
  return {
    id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    no,
    scene: '',
    shotType: '中景',
    camera: '固定',
    desc: '',
    dialogue: '',
    duration: 5,
    imagePrompt: '',
    sfx: '',
    imageAssetId: '',
    imageUrl: '',
    videoAssetId: '',
    videoUrl: '',
    status: '', // '' | 'image' | 'video' | 'error'
    ...patch,
  };
}
