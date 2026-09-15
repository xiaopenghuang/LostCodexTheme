import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { readArchive } from '../../src/theme/archive';
import { DEFAULT_THEME, newDocument } from '../../src/theme/defaults';
import { themeSchema } from '../../src/theme/types';
import { createHistory, historyReducer, patchTheme } from '../../src/theme/history';
import { buildCss } from '../../src/theme/css-generator';
import { imageMetadata } from '../../src/theme/images';
import { importCss } from '../../src/adapters/dreamskin/css';
import { parseColor } from '../../src/adapters/dreamskin/schema';
import { PRESETS } from '../../src/theme/presets';

test('legacy themes gain independent panels without losing original settings', () => {
  const { workspacePanel: _workspace, summaryPanel: _summary, toolbarButtons: _toolbar, ...legacy } = DEFAULT_THEME;
  const migrated = themeSchema.parse(legacy);
  for (const key of Object.keys(legacy) as Array<keyof typeof legacy>) expect(migrated[key]).toEqual(legacy[key]);
  expect(migrated.workspacePanel.opacity).toBe(0.7);
  expect(migrated.toolbarButtons.opacity).toBe(0);
  expect(migrated.workspacePanel).not.toHaveProperty('width');
  expect(migrated.summaryPanel).not.toHaveProperty('padding');
  migrated.summaryPanel.opacity = 0.25;
  expect(themeSchema.parse(migrated)).toEqual(migrated);
  for (const key of ['workspacePanel', 'summaryPanel', 'toolbarButtons']) {
    expect(themeSchema.safeParse({ ...migrated, [key]: null }).success).toBe(false);
    expect(themeSchema.safeParse({ ...migrated, [key]: { ...migrated.summaryPanel, opacity: 2 } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...migrated, [key]: { ...migrated.summaryPanel, textColor: 'red' } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...migrated, [key]: { ...migrated.summaryPanel, unexpected: true } }).success).toBe(false);
  }
  const light = patchTheme('global', { appearance: 'light' })({ theme: migrated, customCss: '' });
  expect(light.theme.workspacePanel.textColor).toBe(light.theme.global.textColor);
  expect(light.theme.summaryPanel.opacity).toBe(0.25);
  const custom = patchTheme('summaryPanel', { textColor: '#123456' })(light);
  const changed = patchTheme('global', { textColor: '#654321' })(custom);
  expect(changed.theme.summaryPanel.textColor).toBe('#123456');
  expect(changed.theme.workspacePanel.textColor).toBe('#654321');
  for (const preset of PRESETS) {
    expect(themeSchema.parse(preset.theme)).toEqual(preset.theme);
    expect(preset.theme.summaryPanel.textColor).toBe(preset.theme.global.textColor);
  }
});

test('default theme satisfies the public schema', () => {
  expect(themeSchema.parse(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
});
test('schema rejects traversal, injected font names and invalid ranges', () => {
  for (const update of [
    { background: { ...DEFAULT_THEME.background, image: '../secret.png' } },
    { font: { ...DEFAULT_THEME.font, uiFamily: 'x";color:red' } },
    { composer: { ...DEFAULT_THEME.composer, radius: 1000 } },
  ]) expect(themeSchema.safeParse({ ...DEFAULT_THEME, ...update }).success).toBe(false);
});
test('slider edits coalesce until the gesture ends', () => {
  const document = newDocument(); let history = createHistory(document);
  for (const radius of [18, 20, 24]) history = historyReducer(history, { type: 'edit', group: 'slider', update: patchTheme('composer', { radius }) });
  expect(history.past).toHaveLength(1);
  history = historyReducer(history, { type: 'undo' }); expect(history.present).toEqual(document);
  history = historyReducer(history, { type: 'redo' }); expect(history.present.theme.composer.radius).toBe(24);
});
test('history stays bounded and appearance changes remain one undo step', () => {
  let history = createHistory(newDocument());
  for (let i = 0; i < 80; i++) history = historyReducer(history, { type: 'edit', update: patchTheme('meta', { name: `Theme ${i}` }) });
  expect(history.past).toHaveLength(50);
  const previous = history.present;
  history = historyReducer(history, { type: 'edit', update: patchTheme('global', { appearance: 'light' }) });
  expect(history.present.theme.background.color).toBe('#f0f1ed');
  history = historyReducer(history, { type: 'undo' }); expect(history.present).toEqual(previous);
});
test('generated CSS uses semantic parts and rejects non-raster URLs', () => {
  const css = buildCss(DEFAULT_THEME, 'https://example.invalid/image.png');
  expect(css).toContain('[data-lct-part="composer"]');
  expect(css).not.toContain('example.invalid'); expect(css).not.toContain('data-ds-part');
  expect(css).not.toContain('_ComposerLayoutRoot_');
});

test('first wallpaper reveals sidebar atomically without resetting later opacity choices', () => {
  const document = newDocument();
  let history = createHistory(document);
  history = historyReducer(history, { type: 'edit', update: patchTheme('background', { type: 'image', image: 'first.png' }) });
  expect(history.present.theme.sidebar.opacity).toBe(0);
  expect(history.present.theme.composer).toEqual(document.theme.composer);
  expect(history.past).toHaveLength(1);
  const firstImage = history.present;
  history = historyReducer(history, { type: 'undo' });
  expect(history.present).toEqual(document);
  history = historyReducer(history, { type: 'redo' });
  expect(history.present).toEqual(firstImage);
  history = historyReducer(history, { type: 'edit', update: patchTheme('sidebar', { opacity: 0.65 }) });
  history = historyReducer(history, { type: 'edit', update: patchTheme('background', { type: 'image', image: 'second.png' }) });
  expect(history.present.theme.sidebar.opacity).toBe(0.65);
  expect(history.present.theme.background.image).toBe('second.png');
});
test('ZIP accepts a single wrapper and checks content CRC', async () => {
  const archive = zipSync({ 'MyTheme/theme.json': strToU8('{"name":"example"}') }, { level: 0 });
  const files = await readArchive(archive); expect(files.has('theme.json')).toBe(true);
  const damaged = archive.slice(); const view = new DataView(damaged.buffer);
  const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  damaged[payload] ^= 1;
  await expect(readArchive(damaged)).rejects.toThrow('校验');
});
test('ZIP rejects traversal, scripts, duplicate-case names and symlinks', async () => {
  for (const files of [
    { '../theme.json': strToU8('{}') },
    { 'theme.json': strToU8('{}'), 'run.exe': strToU8('MZ') },
    { 'theme.json': strToU8('{}'), 'THEME.JSON': strToU8('{}') },
  ]) await expect(async () => readArchive(zipSync(files))).rejects.toThrow();
  const symlink = zipSync({ 'theme.json': [strToU8('{}'), { attrs: 0xa1ff0000 }] });
  await expect(async () => readArchive(symlink)).rejects.toThrow('链接');
});
test('raster dimensions are checked before decoding pixels', () => {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8,13); bytes.set([73,72,68,82],12);
  view.setUint32(16,2); view.setUint32(20,3);
  expect(imageMetadata(bytes)).toEqual({ format: 'png', width: 2, height: 3 });
  view.setUint32(16,100000); expect(() => imageMetadata(bytes)).toThrow('尺寸');
});
test('Dream Skin CSS maps parts and variables without accepting external resources', () => {
  const result = importCss('[data-ds-part="composer"] { background-color:var(--ds-theme-color-panel); border-radius:20px; }', 'background.png');
  expect(result.css).toContain('data-lct-part'); expect(result.css).toContain('--lct-panel-color'); expect(result.css).toContain('!important');
  expect(() => importCss('a {background:url(https://example.invalid/a.png)}','background.png')).toThrow();
  expect(importCss('a { background: url(background.png); }', 'background.png').css).toContain('var(--lct-background-image)');
});
test('Dream Skin CSS rejects escaped resource loaders and preserves escaped local images', () => {
  for (const css of [
    String.raw`@\69mport "https://example.invalid/theme.css";`,
    String.raw`@\66ont-face { font-family: x; src: local(Arial); }`,
    String.raw`a { background: \69mage-set("https://example.invalid/image.png" 1x); }`,
    String.raw`a { background: u\72l("https://example.invalid/image.png"); }`,
  ]) expect(() => importCss(css, 'background.png')).toThrow();
  expect(importCss(String.raw`a { background: u\72l("./background.png"); }`, 'background.png').css)
    .toContain('var(--lct-background-image)');
});

test('Dream Skin colors preserve alpha and reject malformed channels', () => {
  expect(parseColor('#abc8')).toEqual({ hex: '#aabbcc', opacity: 136 / 255 });
  expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ hex: '#0a141e', opacity: 0.5 });
  expect(parseColor('rgb(300, 0, 0)')).toBeNull(); expect(parseColor('rgba(1,2,3)')).toBeNull();
});
