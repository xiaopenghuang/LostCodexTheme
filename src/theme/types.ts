import { z } from 'zod';

const color = z.string().regex(/^#[\da-fA-F]{6}$/).transform(value => value.toLowerCase());
const percent = z.number().finite().min(0).max(1);
const family = z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} ._()-]+$/u);
export const assetName = z.string().regex(/^[a-zA-Z0-9_-]{1,100}\.(png|jpg|jpeg|webp)$/);
export const surfaceSchema = z.object({
  background: color,
  opacity: percent,
  blur: z.number().finite().min(0).max(40),
  radius: z.number().finite().min(0).max(40),
  borderWidth: z.number().finite().min(0).max(4),
  borderColor: color,
  shadow: z.boolean(),
}).strict();
const messageSchema = surfaceSchema.extend({
  textColor: color,
  spacing: z.number().finite().min(0).max(48),
  maxWidth: z.number().finite().min(40).max(100),
});
const panelSchema = surfaceSchema.extend({ textColor: color });

export function auxiliaryDefaults(theme: {
  global: { textColor: string }; sidebar: z.infer<typeof surfaceSchema>; composer: z.infer<typeof surfaceSchema>;
}) {
  const textColor = theme.global.textColor;
  const sidebar = surfaceSchema.strip().parse(theme.sidebar);
  const composer = surfaceSchema.strip().parse(theme.composer);
  return {
    workspacePanel: { ...sidebar, radius: 0, borderWidth: 0, shadow: false, opacity: 0.7, textColor },
    summaryPanel: { ...composer, radius: 24, borderWidth: 0, shadow: false, opacity: 0.7, textColor },
    toolbarButtons: { ...composer, radius: 8, borderWidth: 0, shadow: false, opacity: 0, blur: 0, textColor },
  };
}

export const themeSchema = z.object({
  meta: z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    name: z.string().trim().min(1).max(80),
    version: z.literal(1),
  }).strict(),
  global: z.object({
    appearance: z.enum(['dark', 'light']), accent: color, textColor: color,
    density: z.enum(['compact', 'normal', 'comfortable']),
    radius: z.number().finite().min(0).max(40), opacity: percent,
  }).strict(),
  background: z.object({
    type: z.enum(['color', 'gradient', 'image']), color,
    gradientStart: color, gradientEnd: color,
    gradientAngle: z.number().finite().min(0).max(360),
    image: assetName.optional(), opacity: percent, overlay: percent,
    blur: z.number().finite().min(0).max(40),
    positionX: z.number().finite().min(0).max(100),
    positionY: z.number().finite().min(0).max(100),
    size: z.enum(['cover', 'contain']),
  }).strict(),
  sidebar: surfaceSchema.extend({ width: z.number().finite().min(180).max(360) }),
  composer: surfaceSchema.extend({ padding: z.number().finite().min(8).max(32) }),
  userMessage: messageSchema,
  assistantMessage: messageSchema,
  codeBlock: surfaceSchema,
  workspacePanel: panelSchema.optional(),
  summaryPanel: panelSchema.optional(),
  toolbarButtons: panelSchema.optional(),
  font: z.object({
    uiFamily: family, codeFamily: family,
    uiSize: z.number().finite().min(11).max(24),
    codeSize: z.number().finite().min(10).max(24),
    weight: z.number().int().min(300).max(700),
    lineHeight: z.number().finite().min(1.2).max(2.2),
  }).strict(),
}).strict().transform(theme => {
  // Version-one themes remain readable; explicit new settings are never replaced.
  const defaults = auxiliaryDefaults(theme);
  return { ...theme,
    workspacePanel: theme.workspacePanel ?? defaults.workspacePanel,
    summaryPanel: theme.summaryPanel ?? defaults.summaryPanel,
    toolbarButtons: theme.toolbarButtons ?? defaults.toolbarButtons,
  };
});

export const documentSchema = z.object({
  theme: themeSchema,
  customCss: z.string().max(262144).refine(value => new TextEncoder().encode(value).byteLength <= 262144),
}).strict();

export type ThemeState = z.infer<typeof themeSchema>;
export type SurfaceStyle = z.infer<typeof surfaceSchema>;
export type ThemeDocument = z.infer<typeof documentSchema>;
export type SurfaceKey = 'sidebar' | 'composer' | 'userMessage' | 'assistantMessage' | 'codeBlock' | 'workspacePanel' | 'summaryPanel' | 'toolbarButtons';
export type EditorSection = 'global' | 'background' | 'sidebar' | 'composer' | 'messages' | 'codeBlock' | 'panels' | 'font' | 'themes' | 'transfer' | 'settings';
export interface SavedTheme { document: ThemeDocument; savedAt: string }
