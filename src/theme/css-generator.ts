import type { SurfaceStyle, ThemeState } from './types';

export function rgba(hex: string, opacity: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}
function onAccent(hex: string): string {
  const channels = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
function surfaceCss(surface: SurfaceStyle, overallOpacity: number, nativeSidebar = false): string {
  const shadow = surface.shadow ? '0 12px 36px rgba(0,0,0,.16)' : 'none';
  return `background: ${rgba(surface.background, surface.opacity * overallOpacity)} !important;
    border: ${nativeSidebar ? `var(--lct-sidebar-layout-border-width, ${surface.borderWidth}px)` : `${surface.borderWidth}px`} solid ${surface.borderColor} !important;
    border-radius: ${surface.radius}px !important;
    backdrop-filter: ${surface.blur > 0 ? `blur(${surface.blur}px)` : 'none'} !important;
    box-shadow: ${nativeSidebar ? `var(--lct-sidebar-layout-shadow, ${shadow})` : shadow} !important;`;
}

function panelCss(surface: SurfaceStyle & { textColor: string }, opacity: number, inset = false): string {
  const shadow = surface.shadow ? '0 12px 36px rgba(0,0,0,.16)' : '0 0 0 transparent';
  return `${surfaceCss(surface, opacity)}
    ${inset ? `border-width: 0 !important; box-shadow: inset 0 0 0 ${surface.borderWidth}px ${surface.borderColor}, ${shadow} !important;` : ''}
    --lct-part-text: ${surface.textColor};
    --lct-part-muted: color-mix(in srgb, ${surface.textColor} 75%, ${surface.background});
    color: ${surface.textColor} !important;`;
}

// Both preview and live injection use this semantic-only contract.
export function buildCss(theme: ThemeState, imageDataUrl?: string): string {
  const b = theme.background;
  if (b.type === 'image' && imageDataUrl && imageDataUrl.length > 1024 * 1024) {
    throw new Error('背景图片尚未完成显示优化，请重新选择图片后应用');
  }
  const image = imageDataUrl && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(imageDataUrl)
    ? `url("${imageDataUrl}")` : 'none';
  const backgroundImage = b.type === 'gradient'
    ? `linear-gradient(${b.gradientAngle}deg, ${b.gradientStart}, ${b.gradientEnd})`
    : b.type === 'image' ? image : 'none';
  const spacing = { compact: 12, normal: 20, comfortable: 28 }[theme.global.density];
  const density = { compact: 0.8, normal: 1, comfortable: 1.2 }[theme.global.density];
  return `
[data-lct-part="root"] {
  --lct-accent: ${theme.global.accent};
  --lct-background-color: ${b.color};
  --lct-background-image: ${backgroundImage};
  --lct-panel-color: ${rgba(theme.sidebar.background, theme.sidebar.opacity * theme.global.opacity)};
  --lct-sidebar-width: ${theme.sidebar.width}px;
  --lct-sidebar-border-width: ${theme.sidebar.borderWidth}px;
  --lct-sidebar-border-color: ${theme.sidebar.borderColor};
  --lct-sidebar-shadow: ${theme.sidebar.shadow ? '0 12px 36px rgba(0,0,0,.16)' : '0 0 0 transparent'};
  --lct-composer-color: ${rgba(theme.composer.background, theme.composer.opacity * theme.global.opacity)};
  --lct-text-color: ${theme.global.textColor};
  --lct-user-message-text-color: ${theme.userMessage.textColor};
  --lct-assistant-message-text-color: ${theme.assistantMessage.textColor};
  --lct-muted-text-color: color-mix(in srgb, ${theme.global.textColor} 85%, ${b.color});
  --lct-surface-color: ${b.color};
  --lct-raised-color: ${theme.composer.background};
  --lct-on-accent-color: ${onAccent(theme.global.accent)};
  --lct-border-color: ${theme.composer.borderColor};
  --lct-ui-font: "${theme.font.uiFamily}", sans-serif;
  --lct-font-scale: ${theme.font.uiSize / 14};
  --lct-surface-opacity: ${theme.global.opacity};
  --lct-surface-blur: ${theme.composer.blur}px;
  --lct-image-x: ${b.positionX}%;
  --lct-image-y: ${b.positionY}%;
  --lct-image-dim: ${b.overlay};
  --lct-density: ${density};
  --lct-radius: ${theme.global.radius}px;
  --lct-spacing: ${spacing}px;
  color-scheme: ${theme.global.appearance};
  color: ${theme.global.textColor} !important;
  font-family: "${theme.font.uiFamily}", sans-serif !important;
  font-size: ${theme.font.uiSize}px !important;
  font-weight: ${theme.font.weight} !important;
  line-height: ${theme.font.lineHeight} !important;
  isolation: isolate;
  background: ${theme.global.appearance === 'dark' ? '#111512' : '#f7f8f4'} !important;
}
[data-lct-part="background"] {
  position: fixed; inset: 0; pointer-events: none; z-index: -1;
  background-color: ${b.color}; background-image: var(--lct-background-image);
  background-size: ${b.size}; background-position: ${b.positionX}% ${b.positionY}%;
  background-repeat: no-repeat; opacity: ${b.opacity}; filter: blur(${b.blur}px);
}
[data-lct-part="background"]::after {
  content: ""; position: absolute; inset: 0; background: ${rgba(b.color, b.overlay)};
}
[data-lct-part="main"] { background: transparent !important; color: inherit; }
[data-lct-part="sidebar"] { ${surfaceCss(theme.sidebar, theme.global.opacity, true)} width: var(--lct-sidebar-layout-width, var(--lct-sidebar-width)) !important; }
[data-lct-part="composer"] { ${surfaceCss(theme.composer, theme.global.opacity)} padding: ${theme.composer.padding * density}px !important; color: ${theme.global.textColor} !important; }
[data-lct-part="composer"] :where(textarea, input, [contenteditable="true"]) {
  color: ${theme.global.textColor} !important; caret-color: ${theme.global.textColor} !important;
}
[data-lct-part="composer"] :where(textarea, input)::placeholder {
  color: var(--lct-muted-text-color) !important; opacity: 1 !important;
}
[data-lct-part="user-message"] {
  ${surfaceCss(theme.userMessage, theme.global.opacity)}
  color: ${theme.userMessage.textColor} !important; max-width: ${theme.userMessage.maxWidth}% !important;
  margin-block: ${theme.userMessage.spacing * density / 2}px !important;
}
[data-lct-part="assistant-message"] {
  ${surfaceCss(theme.assistantMessage, theme.global.opacity)}
  color: ${theme.assistantMessage.textColor} !important; max-width: ${theme.assistantMessage.maxWidth}% !important;
  margin-block: ${theme.assistantMessage.spacing * density / 2}px !important;
}
[data-lct-part="code-block"] {
  ${surfaceCss(theme.codeBlock, theme.global.opacity)}
  font-family: "${theme.font.codeFamily}", monospace !important;
  font-size: ${theme.font.codeSize}px !important; line-height: ${theme.font.lineHeight} !important;
}
[data-lct-part="code-block"] code { font: inherit !important; }
[data-lct-part="workspace-panel"] { ${panelCss(theme.workspacePanel, theme.global.opacity, true)} }
[data-lct-part="workspace-shell"] {
  --lct-part-text: ${theme.workspacePanel.textColor};
  --lct-part-muted: color-mix(in srgb, ${theme.workspacePanel.textColor} 75%, ${theme.workspacePanel.background});
  color: ${theme.workspacePanel.textColor} !important;
}
[data-lct-part="summary-panel"] { ${panelCss(theme.summaryPanel, theme.global.opacity)} }
[data-lct-part="toolbar-button"] {
  ${panelCss(theme.toolbarButtons, theme.global.opacity, true)}
  --lct-toolbar-fill: ${rgba(theme.toolbarButtons.background, theme.toolbarButtons.opacity * theme.global.opacity)};
}
[data-lct-part="toolbar-button"]:is(:hover, :focus-visible):not(:disabled) {
  background: color-mix(in srgb, ${theme.toolbarButtons.textColor} 12%, var(--lct-toolbar-fill)) !important;
}
[data-lct-part="toolbar-button"]:is([aria-pressed="true"], [data-state="open"], :active):not(:disabled) {
  background: color-mix(in srgb, ${theme.toolbarButtons.textColor} 22%, var(--lct-toolbar-fill)) !important;
}
`;
}
