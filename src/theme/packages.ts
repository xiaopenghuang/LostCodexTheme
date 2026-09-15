import { strFromU8, strToU8, zip } from 'fflate';
import { documentSchema, themeSchema, type ThemeDocument } from './types';
import { loadImage, saveImage } from '../platform/storage';
import { readArchive } from './archive';
import { imageMetadata } from './images';
import { importDreamSkin } from '../adapters/dreamskin';

const MAX_ARCHIVE = 32 * 1024 * 1024;

export interface ThemeImport { document: ThemeDocument; image: Blob | null; notes: string[]; source: 'native' | 'dreamskin' }

export async function importTheme(file: File, appearance: 'dark' | 'light' = 'dark'): Promise<ThemeImport> {
  if (file.size > MAX_ARCHIVE || !file.size) throw new Error('主题文件大小需在 32 MB 以内');
  let raw: unknown, customCss = '';
  let files: Map<string, Uint8Array> | undefined;
  if (file.name.toLowerCase().endsWith('.json')) {
    if (file.size > 256 * 1024) throw new Error('主题配置文件过大');
    try { raw = JSON.parse(await file.text()); } catch { throw new Error('主题配置不是有效的 JSON 文件'); }
  } else if (file.name.toLowerCase().endsWith('.zip')) {
    files = await readArchive(new Uint8Array(await file.arrayBuffer()));
    const theme = files.get('theme.json');
    if (!theme) throw new Error('主题包缺少 theme.json');
    try { raw = JSON.parse(strFromU8(theme)); } catch { throw new Error('主题配置已损坏'); }
    if (files.has('custom.css')) customCss = strFromU8(files.get('custom.css')!);
  } else throw new Error('请选择 LostCodexTheme 的 JSON 或 ZIP 文件');
  const result = themeSchema.safeParse(raw);
  if (!result.success && raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    if (!files) throw new Error('Dream Skin 主题需要导入完整的 ZIP 主题包');
    const converted = await importDreamSkin(raw, files, appearance);
    return { document: converted.document, image: converted.imageBytes ? new Blob([new Uint8Array(converted.imageBytes)]) : null,
      notes: converted.notes, source: 'dreamskin' };
  }
  if (!result.success) throw new Error('主题格式或版本不受支持，原来的主题未改动');
  const theme = result.data;
  if (!documentSchema.safeParse({ theme, customCss }).success) throw new Error('自定义样式格式不正确或过大');
  const allowed = new Set(['theme.json', 'custom.css', ...(theme.background.image ? [theme.background.image] : [])]);
  if (files && [...files.keys()].some(name => !allowed.has(name))) throw new Error('主题包包含未使用或不属于当前格式的文件');
  let image: Blob | null = null;
  if (theme.background.image) {
    const data = files?.get(theme.background.image);
    if (!data) throw new Error('主题缺少背景图片，请导入完整的 ZIP 主题包');
    const format = imageMetadata(data).format, extension = theme.background.image.split('.').at(-1);
    if (format !== (extension === 'jpeg' ? 'jpg' : extension)) throw new Error('主题图片内容与扩展名不匹配');
    image = new Blob([new Uint8Array(data)]);
  }
  theme.meta.id = crypto.randomUUID();
  return { document: documentSchema.parse({ theme, customCss }), image, notes: [], source: 'native' };
}

export async function commitImport(pending: ThemeImport, signal?: AbortSignal): Promise<ThemeDocument> {
  signal?.throwIfAborted();
  const document = documentSchema.parse(pending.document);
  if (pending.image) document.theme.background.image = await saveImage(pending.image, signal);
  signal?.throwIfAborted();
  return document;
}

export async function exportTheme(document: ThemeDocument): Promise<Blob> {
  const valid = documentSchema.parse(document);
  const files: Record<string, Uint8Array> = { 'theme.json': strToU8(JSON.stringify(valid.theme, null, 2)) };
  if (valid.customCss.trim()) files['custom.css'] = strToU8(valid.customCss);
  const name = valid.theme.background.image;
  if (name) files[name] = new Uint8Array(await (await loadImage(name)).arrayBuffer());
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}
