import { themeSchema, type SurfaceStyle, type ThemeDocument, type ThemeState } from './types';

const surface = (background: string, radius = 14): SurfaceStyle => ({
  background, opacity: 1, blur: 0, radius, borderWidth: 1, borderColor: '#333735', shadow: false,
});

export const DEFAULT_THEME: ThemeState = themeSchema.parse({
  meta: { id: 'default', name: 'Default', version: 1 },
  global: { appearance: 'dark', accent: '#a8c8b4', textColor: '#e6e8e5', density: 'normal', radius: 14, opacity: 1 },
  background: { type: 'color', color: '#1b1d1c', gradientStart: '#202b28', gradientEnd: '#141c23',
    gradientAngle: 135, opacity: 1, overlay: 0.2, blur: 0, positionX: 50, positionY: 50, size: 'cover' },
  sidebar: { ...surface('#222522', 0), borderWidth: 0, width: 220 },
  composer: { ...surface('#282c29', 18), padding: 18, shadow: true },
  userMessage: { ...surface('#303b34', 16), borderWidth: 0, textColor: '#e6e8e5', spacing: 24, maxWidth: 85 },
  assistantMessage: { ...surface('#1b1d1c', 0), opacity: 0, borderWidth: 0, textColor: '#e6e8e5', spacing: 24, maxWidth: 100 },
  codeBlock: surface('#161917', 12),
  font: { uiFamily: 'Microsoft YaHei UI', codeFamily: 'Consolas', uiSize: 14, codeSize: 13, weight: 400, lineHeight: 1.65 },
});

export function newDocument(name = '未命名主题'): ThemeDocument {
  const theme = structuredClone(DEFAULT_THEME);
  theme.meta = { id: crypto.randomUUID(), name, version: 1 };
  return { theme, customCss: '' };
}
