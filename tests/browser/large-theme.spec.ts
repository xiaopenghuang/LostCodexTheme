import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { largePng } from '../fixtures/large-png.mjs';
import { DEFAULT_THEME } from '../../src/theme/defaults';
import { buildCss } from '../../src/theme/css-generator';
import { imageMetadata } from '../../src/theme/images';

const example = resolve('target/debug/examples/codex_poc.exe');
const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));

test('maximum accepted image passes native CSS validation and renders through the actual bridge', async ({ page }) => {
  test.setTimeout(60000);
  const png = largePng();
  expect(png.byteLength).toBe(10 * 1024 * 1024);
  expect(imageMetadata(png).format).toBe('png');
  await page.goto('http://127.0.0.1:1421');
  const originalData = `data:image/png;base64,${png.toString('base64')}`;
  const data = await page.evaluate(async data => {
    // Exercise the same display preparation used by preview and native apply.
    const { displayImageDataUrl } = await import('/src/theme/display-image.ts');
    return displayImageDataUrl(await (await fetch(data)).blob());
  }, originalData);
  expect(data.length).toBeLessThan(1024 * 1024);
  const css = buildCss({ ...DEFAULT_THEME, background: { ...DEFAULT_THEME.background, type: 'image' } }, data);
  expect(css.indexOf(data)).toBe(css.lastIndexOf(data));
  expect(css.indexOf(data)).toBeGreaterThanOrEqual(0);
  const combined = `${css}\n/*${'x'.repeat(contract.limits.customCssBytes - 4)}*/`;
  expect(Buffer.byteLength(combined)).toBeLessThan(contract.limits.generatedCssBytes);
  const validation = JSON.parse(execFileSync(example, ['validate-css'], { input: combined, encoding: 'utf8', timeout: 20000 }));
  expect(validation.valid).toBe(true);
  await page.setContent('<!doctype html><html><head><style>main,aside,.composer-surface-chrome {display:block;min-height:100px;width:200px}</style></head><body><aside class="app-shell-left-panel">Sidebar</aside><main data-app-shell-main-surface><div class="composer-surface-chrome">Composer</div></main></body></html>');
  const result = await page.evaluate(async ({ source, profile, css }) => {
    const execute = new Function('location', `return ${source}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    execute({ action: 'apply', profile, css });
    const verified = execute({ action: 'verify', profile, css });
    const background = document.querySelector('[data-lct-part="background"]')!;
    const url = getComputedStyle(background).backgroundImage;
    if (url === 'none') return { applied: verified.applied, visibleImage: false, width: 0, restored: false };
    const image = new Image(); image.src = url.slice(5, -2); await image.decode();
    const restored = execute({ action: 'restore', profile, css: '' });
    return { applied: verified.applied, visibleImage: true, width: image.naturalWidth, restored: restored.restored };
  }, { source: contract.bridge, profile: contract.profile, css: combined });
  expect(result).toEqual({ applied: true, visibleImage: true, width: 2, restored: true });
});
