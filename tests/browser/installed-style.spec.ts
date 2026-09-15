import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installedStyles } from '../fixtures/installed-styles.mjs';
import { DEFAULT_THEME } from '../../src/theme/defaults';
import { buildCss } from '../../src/theme/css-generator';

test('installed Codex styles respect the mapped palette without a live Codex connection', async ({ page, context }, testInfo) => {
  test.skip(process.platform !== 'win32', 'Read-only installed package check requires Windows');
  test.setTimeout(30000);
  const example = resolve('target/debug/examples/codex_poc.exe');
  let detection;
  try { detection = JSON.parse(execFileSync(example, ['detect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { test.skip(true, 'Official Codex package is not available'); return; }
  const styles = installedStyles(detection.installation.executable);
  expect(styles.length).toBeGreaterThan(0);
  for (const anchor of ['_ComposerLayoutRoot_1qpwu_2', '_ComposerLayoutBody_1qpwu_2', '_ComposerHomeUtilityBar_dqhd9_4']) {
    expect(styles.some(style => style.css.includes(anchor)), `Update the installed-style fixture for ${anchor}`).toBe(true);
  }
  const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
  const css = execFileSync(example, ['render-css'], { input: buildCss(DEFAULT_THEME), encoding: 'utf8' });
  await context.route('**/*', route => route.abort());
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setContent('<!doctype html><html class="light electron-opaque" data-theme="light" data-codex-window-type="electron" data-codex-os="win32"><head></head><body><aside class="app-shell-left-panel"><span class="text-token-text-primary">Workspace</span></aside><main data-app-shell-main-surface><section data-theme="light"><h1 class="text-token-text-primary">New task</h1><div class="_ComposerHomeUtilityBar_dqhd9_4 text-token-text-primary">Project folder</div><div class="_ComposerLayoutRoot_1qpwu_2" data-composer-surface-variant="opaque" data-composer-radius-variant="default" data-composer-utility-bar-variant="home"><div class="_ComposerLayoutBody_1qpwu_2"><div contenteditable="true" class="ProseMirror text-token-text-primary">Type a message</div></div></div></section></main></body></html>');
  for (const style of styles) await page.addStyleTag({ content: style.css });
  await page.addStyleTag({ content: 'body{display:flex;min-height:600px} aside{width:220px;min-height:500px} main{flex:1;padding:30px} [contenteditable]{min-height:80px} h1{font-size:24px}' });
  await expect(page.locator('h1')).not.toHaveCSS('color', 'rgb(230, 232, 229)');
  const result = await page.evaluate(({ source, profile, css }) => {
    const run = new Function('location', `return ${source}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    run({ action: 'apply', profile, css });
    return run({ action: 'verify', profile, css });
  }, { source: contract.bridge, profile: contract.profile, css });
  expect(result.applied).toBe(true);
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(230, 232, 229)');
  await expect(page.locator('aside span')).toHaveCSS('color', 'rgb(230, 232, 229)');
  await expect(page.locator('[contenteditable]')).toHaveCSS('color', 'rgb(230, 232, 229)');
  await expect(page.locator('._ComposerLayoutRoot_1qpwu_2')).toHaveCSS('background-color', 'rgb(40, 44, 41)');
  await expect(page.locator('._ComposerLayoutBody_1qpwu_2')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('._ComposerHomeUtilityBar_dqhd9_4')).toHaveCSS('background-color', 'rgb(40, 44, 41)');
  await page.screenshot({ path: testInfo.outputPath('installed-styles-palette.png') });
});
