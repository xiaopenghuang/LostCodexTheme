import { invoke, isTauri } from '@tauri-apps/api/core';
import { assetName, documentSchema, type SavedTheme, type ThemeDocument } from '../theme/types';
import { imageMetadata } from '../theme/images';
import { displayImageDataUrl } from '../theme/display-image';

export const desktop = isTauri();
export interface Preferences { advanced: boolean; liveApply: boolean }
let draftQueue: Promise<void> = Promise.resolve();
let themeQueue: Promise<unknown> = Promise.resolve();
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('lost-codex-theme', 1);
    request.onupgradeneeded = () => {
      for (const store of ['themes', 'assets', 'drafts']) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('无法打开本地存储')); };
    request.onblocked = () => { database = undefined; reject(new Error('请关闭其他编辑器页面后重试')); };
  });
  return database;
}

async function read<T>(store: string, key?: IDBValidKey): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(new Error('本地数据读取失败'));
  });
}
async function write(store: string, key: IDBValidKey, value?: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    if (value === undefined) tx.objectStore(store).delete(key);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('保存失败，请检查可用存储空间'));
    tx.onabort = () => reject(new Error('保存被中断'));
  });
}

export async function listThemes(): Promise<SavedTheme[]> {
  await themeQueue;
  const raw = desktop ? await invoke<SavedTheme[]>('list_themes') : await read<SavedTheme[]>('themes');
  return raw.map(item => ({ ...item, document: documentSchema.parse(item.document) }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function saveTheme(document: ThemeDocument): Promise<SavedTheme> {
  const validated = documentSchema.parse(document);
  const task = themeQueue.then(async () => {
    if (desktop) return invoke<SavedTheme>('save_theme', { document: validated });
    const saved: SavedTheme = { document: validated, savedAt: new Date().toISOString() };
    await write('themes', document.theme.meta.id, saved);
    return saved;
  });
  themeQueue = task.catch(() => undefined);
  return task;
}
export async function deleteTheme(id: string): Promise<void> {
  const task = themeQueue.then(async () => {
    if (desktop) await invoke('delete_theme', { id });
    else await write('themes', id);
  });
  themeQueue = task.catch(() => undefined);
  return task;
}
export async function loadDraft(): Promise<ThemeDocument | null> {
  const raw = desktop ? await invoke<unknown>('load_draft') : await read<unknown>('drafts', 'current');
  return raw ? documentSchema.parse(raw) : null;
}
export async function saveDraft(document: ThemeDocument): Promise<void> {
  const validated = documentSchema.parse(document);
  const task = draftQueue.then(async () => {
    if (desktop) await invoke('save_draft', { document: validated });
    else await write('drafts', 'current', validated);
  });
  draftQueue = task.catch(() => undefined);
  await task;
}
export async function clearDraft(): Promise<void> {
  const task = draftQueue.then(async () => {
    if (desktop) await invoke('clear_draft');
    else {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
        const request = store.get('current');
        request.onsuccess = () => { if (request.result !== undefined) store.put(request.result, 'discarded'); store.delete('current'); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('旧草稿备份失败'));
        tx.onabort = () => reject(new Error('草稿备份被中断'));
      });
    }
  });
  draftQueue = task.catch(() => undefined);
  await task;
}

export async function loadPreferences(): Promise<Preferences> {
  const preferences = desktop ? await invoke<Preferences>('get_preferences') : await read<Preferences | undefined>('drafts', 'preferences');
  if (!preferences) return { advanced: false, liveApply: true };
  if (typeof preferences.advanced !== 'boolean' || typeof preferences.liveApply !== 'boolean') throw new Error('偏好设置无法读取，原文件已保留');
  return preferences;
}
let preferencesQueue: Promise<void> = Promise.resolve();
export function savePreferences(preferences: Preferences): Promise<void> {
  const task = preferencesQueue.then(async () => {
    if (desktop) await invoke('save_preferences', { preferences });
    else await write('drafts', 'preferences', preferences);
  });
  preferencesQueue = task.catch(() => undefined);
  return task;
}

export async function saveExport(blob: Blob, fileName: string): Promise<boolean> {
  if (desktop) return invoke('save_export', { fileName, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function validateImage(blob: Blob): Promise<'png' | 'jpg' | 'webp'> {
  if (blob.size > 10 * 1024 * 1024 || blob.size === 0) throw new Error('图片大小需在 10 MB 以内');
  const metadata = imageMetadata(new Uint8Array(await blob.arrayBuffer()));
  const bitmap = await createImageBitmap(blob).catch(() => { throw new Error('这张图片无法读取'); });
  const valid = bitmap.width <= 16384 && bitmap.height <= 16384 && bitmap.width * bitmap.height <= 50_000_000;
  bitmap.close();
  if (!valid) throw new Error('图片尺寸过大，请先缩小图片');
  return metadata.format;
}

export async function saveImage(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const extension = await validateImage(blob);
  signal?.throwIfAborted();
  const name = `${crypto.randomUUID()}.${extension}`;
  if (desktop) {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    signal?.throwIfAborted();
    await invoke('save_image', { name, bytes });
  } else await write('assets', name, new Blob([blob], { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` }));
  signal?.throwIfAborted();
  return name;
}

export async function loadImage(name: string): Promise<Blob> {
  assetName.parse(name);
  if (desktop) {
    const bytes = await invoke<number[]>('load_image', { name });
    return new Blob([new Uint8Array(bytes)], { type: `image/${name.endsWith('.png') ? 'png' : name.endsWith('.webp') ? 'webp' : 'jpeg'}` });
  }
  const blob = await read<Blob | undefined>('assets', name);
  if (!blob) throw new Error('背景图片已丢失，请重新选择');
  return blob;
}
export async function imageDataUrl(name: string): Promise<string> {
  return displayImageDataUrl(await loadImage(name));
}

export async function systemFonts(): Promise<string[]> {
  if (desktop) return invoke('list_system_fonts');
  const api = window as Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> };
  if (!api.queryLocalFonts) throw new Error('浏览器不支持读取字体，请在桌面版使用此功能');
  const fonts = await api.queryLocalFonts();
  return [...new Set(fonts.map(font => font.family).filter(font => /^[\p{L}\p{N} ._()-]+$/u.test(font)))].sort();
}
