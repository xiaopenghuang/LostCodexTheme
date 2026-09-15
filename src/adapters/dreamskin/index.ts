import { newDocument } from '../../theme/defaults';
import { auxiliaryDefaults, documentSchema, type ThemeDocument } from '../../theme/types';
import { rgba } from '../../theme/css-generator';
import { dreamThemeSchema, parseColor, verifyManifest } from './schema';
import { importCss } from './css';
import { imageMetadata } from '../../theme/images';

export interface ConvertedTheme { document: ThemeDocument; imageBytes: Uint8Array | null; notes: string[] }

export async function importDreamSkin(raw: unknown, files: Map<string, Uint8Array>, appearance: 'dark' | 'light'): Promise<ConvertedTheme> {
  const parsed = dreamThemeSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Dream Skin 主题配置格式不受支持');
  const source = parsed.data;
  const imageBytes = files.get(source.image);
  const stylesheet = files.get('theme.css');
  if (!imageBytes || !stylesheet?.length) throw new Error('Dream Skin 主题需要配置、背景图片和 theme.css 三个有效文件');
  const allowed = new Set(['manifest.json', 'manifest.sig', 'theme.json', 'theme.css', 'LICENSE.txt', source.image]);
  if ([...files.keys()].some(name => !allowed.has(name))) throw new Error('Dream Skin 主题包含未声明的资源');
  if (!files.has('manifest.json') && files.size !== 3) throw new Error('简化 Dream Skin 主题包必须恰好包含配置、样式和背景图片');
  await verifyManifest(files, source);
  const imageFormat = imageMetadata(imageBytes).format;
  const extension = source.image.split('.').at(-1);
  if (imageFormat !== (extension === 'jpeg' ? 'jpg' : extension)) throw new Error('Dream Skin 图片内容与扩展名不匹配');
  const extensionData = source.lostCodexTheme as { schema?: unknown; document?: unknown } | undefined;
  if (extensionData?.schema === 'lostcodextheme/1' && !files.has('manifest.json')) {
    const restored = documentSchema.safeParse(extensionData.document);
    if (!restored.success) throw new Error('兼容包中的原始编辑设置已损坏');
    const document = restored.data;
    if (document.theme.background.image && document.theme.background.image !== source.image) throw new Error('兼容包中的原始图片引用不匹配');
    document.theme.meta.id = crypto.randomUUID();
    return { document, imageBytes: document.theme.background.image ? imageBytes : null,
      notes: ['已从兼容包恢复完整的 LostCodexTheme 编辑设置'] };
  }
  const document = newDocument(source.name), theme = document.theme;
  theme.global.appearance = source.appearance === 'auto' || !source.appearance ? appearance : source.appearance;
  if (theme.global.appearance === 'light') {
    theme.global.textColor = '#28352b'; theme.global.accent = '#416450';
    theme.background.color = '#f0f1ed'; theme.sidebar.background = '#e7e9e3'; theme.composer.background = '#fbfcf9';
    theme.userMessage.background = '#dfe8dc'; theme.codeBlock.background = '#e7e9e3';
    theme.userMessage.textColor = theme.assistantMessage.textColor = '#28352b';
  }
  const colors = source.colors;
  const normalized = (key: keyof NonNullable<typeof colors>) => colors?.[key] ? parseColor(colors[key]!) : null;
  const background = normalized('background'), panel = normalized('panel'), composer = normalized('panelAlt');
  if (background) { theme.background.color = background.hex; theme.background.opacity = background.opacity; }
  if (panel) { theme.sidebar.background = theme.codeBlock.background = panel.hex; theme.sidebar.opacity = theme.codeBlock.opacity = panel.opacity; }
  if (composer) { theme.composer.background = theme.userMessage.background = composer.hex; theme.composer.opacity = theme.userMessage.opacity = composer.opacity; }
  const accent = normalized('accent'), text = normalized('text'), line = normalized('line');
  if (accent) theme.global.accent = accent.hex;
  if (text) theme.global.textColor = theme.userMessage.textColor = theme.assistantMessage.textColor = text.hex;
  if (line) for (const key of ['sidebar', 'composer', 'userMessage', 'assistantMessage', 'codeBlock'] as const) theme[key].borderColor = line.hex;
  Object.assign(theme, auxiliaryDefaults(theme));
  theme.background.type = source.art?.taskMode === 'off' ? 'color' : 'image';
  theme.background.image = source.image;
  theme.background.positionX = (source.art?.focusX ?? 0.5) * 100;
  theme.background.positionY = (source.art?.focusY ?? 0.5) * 100;
  if (source.art?.taskMode === 'full') theme.background.overlay = 0;
  let textCss: string;
  try { textCss = new TextDecoder('utf-8', { fatal: true }).decode(stylesheet); } catch { throw new Error('Dream Skin 样式编码已损坏'); }
  const converted = importCss(textCss, source.image);
  const preserved = ['accentAlt', 'secondary', 'highlight', 'muted'] as const;
  const variables = preserved.map(key => {
    const color = normalized(key);
    const name = key === 'accentAlt' ? 'accent-alt' : key;
    return `--lct-import-${name}:${color ? rgba(color.hex, color.opacity) : theme.global.accent};`;
  }).join('');
  document.customCss = `[data-lct-part="root"]{${variables}--lct-import-border-alpha:1;--lct-import-shadow:none;--lct-import-image-zoom:1;--lct-import-image-intensity:1;--lct-import-motion:0;}\n${converted.css}`;
  const notes = ['Dream Skin 的专属文案与整体布局不会覆盖 Codex 原生界面', ...converted.notes];
  if (files.has('manifest.sig')) notes.push('文件完整性已核对，但没有认证发布者签名');
  if (text && text.opacity !== 1) {
    document.customCss += `\n[data-lct-part="user-message"],[data-lct-part="assistant-message"]{color:${rgba(text.hex, text.opacity)} !important;}`;
  }
  if (!documentSchema.safeParse(document).success) throw new Error('转换后的主题样式过大或不受支持');
  return { document, imageBytes, notes };
}
