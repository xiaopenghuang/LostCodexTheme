import { strToU8, zip } from 'fflate';
import { documentSchema, type SurfaceStyle, type ThemeDocument } from '../../theme/types';
import { rgba } from '../../theme/css-generator';
import { loadImage } from '../../platform/storage';

async function background(document: ThemeDocument): Promise<{ name: string; bytes: Uint8Array }> {
  const b = document.theme.background;
  if (b.image) {
    const extension = b.image.endsWith('.png') ? 'png' : b.image.endsWith('.webp') ? 'webp' : 'jpg';
    return { name: `background.${extension}`, bytes: new Uint8Array(await (await loadImage(b.image)).arrayBuffer()) };
  }
  const canvas = window.document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成兼容背景图片');
  context.fillStyle = b.color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (b.type === 'gradient') {
    const angle = b.gradientAngle * Math.PI / 180;
    const extent = (Math.abs(canvas.width * Math.sin(angle)) + Math.abs(canvas.height * Math.cos(angle))) / 2;
    const dx = Math.sin(angle) * extent, dy = -Math.cos(angle) * extent;
    const gradient = context.createLinearGradient(800 - dx, 500 - dy, 800 + dx, 500 + dy);
    gradient.addColorStop(0, b.gradientStart); gradient.addColorStop(1, b.gradientEnd);
    context.fillStyle = gradient; context.fillRect(0, 0, 1600, 1000);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('背景图片生成失败')), 'image/png'));
  return { name: 'background.png', bytes: new Uint8Array(await blob.arrayBuffer()) };
}

export async function exportDreamSkin(input: ThemeDocument): Promise<Blob> {
  const original = documentSchema.parse(input), theme = original.theme;
  const image = await background(original);
  const restored = structuredClone(original);
  if (restored.theme.background.image) restored.theme.background.image = image.name;
  const metadata = {
    schemaVersion: 1, id: `lct-${crypto.randomUUID()}`, name: theme.meta.name, image: image.name,
    appearance: theme.global.appearance,
    art: { focusX: theme.background.positionX / 100, focusY: theme.background.positionY / 100, safeArea: 'none',
      taskMode: theme.background.type !== 'image' && theme.background.image ? 'off' : 'full' },
    colors: { background: theme.background.color, panel: theme.sidebar.background, panelAlt: theme.composer.background,
      accent: theme.global.accent, accentAlt: theme.global.accent, secondary: theme.global.accent,
      highlight: theme.global.accent, text: theme.global.textColor, muted: theme.global.textColor, line: theme.composer.borderColor },
    lostCodexTheme: { schema: 'lostcodextheme/1', document: restored },
  };
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const surface = (part: string, style: SurfaceStyle) => `[data-ds-part="${part}"] {
    background-color: ${rgba(style.background, style.opacity * theme.global.opacity)};
    border-color: ${style.borderColor}; border-width: ${style.borderWidth}px; border-style: solid;
    border-radius: ${clamp(style.radius, 0, 28)}px; backdrop-filter: blur(${clamp(style.blur, 0, 30)}px);
    box-shadow: ${style.shadow ? '0 8px 24px rgba(0,0,0,0.16)' : 'none'};
  }`;
  const css = `[data-ds-part="root"] {
    color: ${theme.global.textColor}; font-family: system-ui, sans-serif;
    font-size: ${clamp(theme.font.uiSize, 12, 20)}px;
    font-weight: ${clamp(Math.round(theme.font.weight / 100) * 100, 400, 700)};
    line-height: ${clamp(theme.font.lineHeight, 1.1, 1.8)};
  }
  ${surface('sidebar', theme.sidebar)}
  ${surface('composer', theme.composer)}
  [data-ds-part="main"] { color: ${theme.global.textColor}; }
  `;
  const files = { 'theme.json': strToU8(JSON.stringify(metadata, null, 2)), 'theme.css': strToU8(css), [image.name]: image.bytes };
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}
