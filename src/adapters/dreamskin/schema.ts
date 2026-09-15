import { z } from 'zod';

export const COLOR_KEYS = ['background', 'panel', 'panelAlt', 'accent', 'accentAlt', 'secondary', 'highlight', 'text', 'muted', 'line'] as const;
const color = z.string().trim().max(64).refine(value => parseColor(value) !== null);
const copy = z.string().max(512).optional();
export const dreamThemeSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1).max(100), name: z.string().trim().min(1).max(80),
  image: z.string().regex(/^[a-zA-Z0-9_-]{1,100}\.(png|jpg|jpeg|webp)$/),
  appearance: z.enum(['auto', 'dark', 'light']).optional(),
  art: z.object({ focusX: z.number().min(0).max(1).optional(), focusY: z.number().min(0).max(1).optional(),
    safeArea: z.enum(['left', 'right', 'none']).optional(), taskMode: z.enum(['ambient', 'full', 'off']).optional() }).strict().optional(),
  colors: z.object(Object.fromEntries(COLOR_KEYS.map(key => [key, color.optional()])) as Record<typeof COLOR_KEYS[number], z.ZodOptional<typeof color>>).strict().optional(),
  brandSubtitle: copy, tagline: copy, projectPrefix: copy, projectLabel: copy, statusText: copy, quote: copy,
  promoTitle: copy, promoSub: copy, promoUrl: copy,
}).passthrough();
export type DreamTheme = z.infer<typeof dreamThemeSchema>;

export function parseColor(value: string): { hex: string; opacity: number } | null {
  value = value.trim();
  let hex = value.trim().toLowerCase().replace(/^#/, '');
  if (value.startsWith('#') && /^[a-f\d]+$/.test(hex) && [3, 4, 6, 8].includes(hex.length)) {
    if (hex.length < 5) hex = [...hex].map(ch => ch + ch).join('');
    return { hex: `#${hex.slice(0, 6)}`, opacity: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
  }
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0?\.\d+|0|1(?:\.0+)?))?\s*\)$/i.exec(value);
  if (!match || match.slice(1, 4).some(channel => Number(channel) > 255)) return null;
  if (value.toLowerCase().startsWith('rgba(') !== (match[4] !== undefined)) return null;
  return { hex: `#${match.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}`, opacity: Number(match[4] ?? 1) };
}

const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const manifestSchema = z.object({
  packageVersion: z.literal(1), skinApiVersion: z.literal(1), themeId: z.string(), version,
  minClientVersion: version, platforms: z.array(z.enum(['windows', 'macos'])).min(1).max(2).refine(values => new Set(values).size === values.length),
  capabilities: z.array(z.enum(['background', 'tokens', 'safe-css'])).min(1).max(3).refine(values => new Set(values).size === values.length),
  publisher: z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/), displayName: z.string().min(1).max(80) }).strict(),
  license: z.string(), provenance: z.object({ aiGenerated: z.boolean(), summary: z.string() }),
  createdAt: z.string(), keyId: z.string().optional(),
  files: z.array(z.object({ path: z.string(), mediaType: z.string(), bytes: z.number().int().positive().max(10 * 1024 * 1024), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) }).strict()).min(3).max(8),
}).strict();

export async function verifyManifest(files: Map<string, Uint8Array>, theme: DreamTheme): Promise<void> {
  const bytes = files.get('manifest.json');
  if (!bytes) return;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('Dream Skin 清单已损坏'); }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Dream Skin 清单格式或协议版本不受支持');
  const manifest = parsed.data;
  if (bytes.length > 65536 || (files.get('manifest.sig')?.length ?? 0) > 4096) throw new Error('Dream Skin 清单或签名文件过大');
  if (manifest.themeId !== theme.id || !manifest.platforms.includes('windows')) throw new Error('主题清单标识不匹配，或未标注 Windows 支持');
  const required = manifest.minClientVersion.split('.').map(Number), supported = [1, 5, 18];
  for (let i = 0; i < 3; i++) {
    if (required[i] > supported[i]) throw new Error('主题需要更新的 Dream Skin 协议，当前转换器尚未支持');
    if (required[i] < supported[i]) break;
  }
  const seen = new Set<string>();
  const media: Record<string, string> = { 'theme.json': 'application/json', 'theme.css': 'text/css', 'LICENSE.txt': 'text/plain',
    'background.png': 'image/png', 'background.jpg': 'image/jpeg', 'background.webp': 'image/webp' };
  for (const entry of manifest.files) {
    const data = files.get(entry.path);
    const limit = entry.path === 'theme.json' || entry.path === 'LICENSE.txt' ? 65536 : entry.path === 'theme.css' ? 262144 : 10 * 1024 * 1024;
    if (seen.has(entry.path) || !data || media[entry.path] !== entry.mediaType || data.length !== entry.bytes || data.length > limit) throw new Error('Dream Skin 文件与清单声明不一致');
    seen.add(entry.path);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)));
    const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== entry.sha256.toLowerCase()) throw new Error('Dream Skin 文件哈希校验失败');
  }
  if (!seen.has('theme.json') || !seen.has('theme.css') || !seen.has(theme.image) || [...seen].filter(name => /^background\.(png|jpg|webp)$/.test(name)).length !== 1
    || [...files.keys()].some(name => name !== 'manifest.json' && name !== 'manifest.sig' && !seen.has(name))) throw new Error('Dream Skin 主题包内容不完整');
}
