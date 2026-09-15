import { DEFAULT_THEME } from './defaults';
import { auxiliaryDefaults, type ThemeDocument, type ThemeState } from './types';

export interface Preset { id: string; name: string; description: string; theme: ThemeState }
function preset(id: string, name: string, description: string, edit: (theme: ThemeState) => void): Preset {
  const theme = structuredClone(DEFAULT_THEME);
  theme.meta = { id, name, version: 1 };
  edit(theme);
  Object.assign(theme, auxiliaryDefaults(theme));
  return { id, name, description, theme };
}
function palette(theme: ThemeState, background: string, surface: string, composer: string, accent: string, border: string) {
  theme.background.color = background;
  theme.sidebar.background = surface;
  theme.composer.background = composer;
  theme.codeBlock.background = surface;
  theme.userMessage.background = composer;
  theme.global.accent = accent;
  for (const key of ['sidebar', 'composer', 'userMessage', 'assistantMessage', 'codeBlock'] as const) theme[key].borderColor = border;
}

export const PRESETS: Preset[] = [
  preset('default', 'Default', '安静、熟悉的原生质感', () => {}),
  preset('oled', 'OLED', '纯黑底色，专注每一个像素', theme => {
    palette(theme, '#000000', '#080808', '#101010', '#dedede', '#252525');
    theme.composer.shadow = false;
  }),
  preset('glass', 'Glass', '层叠的绿意，轻盈的磨砂玻璃', theme => {
    palette(theme, '#182721', '#233f32', '#2b4839', '#bbdac4', '#567061');
    theme.background.type = 'gradient'; theme.background.gradientStart = '#304e3d'; theme.background.gradientEnd = '#14252c';
    theme.sidebar.opacity = 0.45; theme.sidebar.blur = 24;
    theme.composer.opacity = 0.65; theme.composer.blur = 20;
    theme.userMessage.opacity = 0.75; theme.codeBlock.opacity = 0.7;
  }),
  preset('minimal-dark', 'Minimal Dark', '收起装饰，留下内容', theme => {
    palette(theme, '#17191b', '#17191b', '#202326', '#b3c4d1', '#32373b');
    theme.global.radius = 8; theme.composer.radius = 8; theme.composer.shadow = false; theme.userMessage.radius = 8;
  }),
  preset('warm-dark', 'Warm Dark', '像黄昏里的一杯咖啡', theme => {
    palette(theme, '#29241f', '#221e1a', '#39312a', '#d4ad86', '#53463b');
    theme.global.textColor = '#efe4d8'; theme.userMessage.textColor = '#efe4d8'; theme.assistantMessage.textColor = '#efe4d8';
  }),
  preset('soft-gray', 'Soft Gray', '柔和的浅灰，清爽而不刺眼', theme => {
    palette(theme, '#f0f1ed', '#e7e9e3', '#fbfcf9', '#416450', '#ced4c9');
    theme.global.appearance = 'light'; theme.global.textColor = '#28352b';
    theme.userMessage.textColor = '#28352b'; theme.assistantMessage.textColor = '#28352b'; theme.userMessage.background = '#dfe8dc';
    theme.composer.shadow = false;
  }),
  preset('vscode', 'VS Code Style', '熟悉的冷灰与蓝色点缀', theme => {
    palette(theme, '#1e1e1e', '#252526', '#2d2d30', '#75b7e8', '#424247');
    theme.global.radius = 6; theme.composer.radius = 6; theme.codeBlock.radius = 6;
  }),
  preset('jetbrains', 'JetBrains Style', '沉稳的石墨色工作空间', theme => {
    palette(theme, '#2b2d30', '#232529', '#34373b', '#9bbf88', '#484c52');
    theme.global.radius = 10; theme.composer.radius = 10; theme.font.codeSize = 14;
  }),
];

export function fromPreset(preset: Preset): ThemeDocument {
  const theme = structuredClone(preset.theme);
  theme.meta.id = crypto.randomUUID();
  return { theme, customCss: '' };
}
