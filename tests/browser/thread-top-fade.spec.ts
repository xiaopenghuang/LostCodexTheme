import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installedStyles } from '../fixtures/installed-styles.mjs';
import { buildCss } from '../../src/theme/css-generator';
import { newDocument } from '../../src/theme/defaults';
import { patchTheme } from '../../src/theme/history';

const example = resolve('target/debug/examples/codex_poc.exe');
const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
const fade = '<div id="fade" class="_MainContentTopFade_xmgnx_2" data-app-shell-main-content-top-fade="visible"></div>';

async function invoke(page: import('@playwright/test').Page, action: string, css = '') {
  return page.evaluate(({ contract, action, css }) => {
    const execute = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return execute({ profile: contract.profile, action, css });
  }, { contract, action, css });
}

for (const mode of ['dark', 'light'] as const) {
  test(`${mode} top fade is transparent without changing shell geometry or controls`, async ({ page, context }, testInfo) => {
    test.skip(process.platform !== 'win32', 'Requires read-only installed Windows styles');
    let detection;
    try { detection = JSON.parse(execFileSync(example, ['detect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { test.skip(true, 'Official Codex package unavailable'); return; }
    const styles = installedStyles(detection.installation.executable);
    expect(styles.some(style => style.css.includes('._MainContentTopFade_xmgnx_2'))).toBe(true);
    await context.route('**/*', route => route.abort());
    await page.emulateMedia({ colorScheme: mode });
    await page.setContent(`<!doctype html><html class="${mode} electron-opaque" data-theme="${mode}" data-codex-window-type="electron" data-codex-os="win32"><head></head><body>
      <div id="bar" class="_ApplicationMenuTopBar_xmgnx_2"><button id="menu">Menu</button></div>
      <aside class="app-shell-left-panel"><button id="sidebar-control">Sidebar</button></aside>
      <div id="frame" class="_MainContentFrame_xmgnx_2" data-app-shell-thread-edge-divider="true">
        <div id="fade-host">${fade}</div>
        <main data-app-shell-main-surface><div class="thread-scroll-container"><div id="content">Conversation</div></div></main>
        <button id="under-fade">Content action</button>
        <div id="unrelated" style="background:linear-gradient(black,transparent);box-shadow:0 2px 5px black;border:1px solid red;height:30px"></div>
        <div id="lookalike" class="_MainContentTopFade_other" style="background:linear-gradient(red,blue)"></div>
      </div></body></html>`);
    for (const style of styles) await page.addStyleTag({ content: style.css });
    await page.addStyleTag({ content: 'body{margin:0;--app-shell-left-panel-width:240px;--spacing:4px;--height-toolbar:40px}#bar{position:absolute;top:0;left:0;right:0;height:40px}aside{position:absolute;top:40px;bottom:0;width:240px}#frame{position:absolute;top:40px;left:240px;right:0;bottom:0}main{height:100%}.thread-scroll-container{height:100%;overflow:auto}#content{height:1600px;padding:50px}#under-fade{position:absolute;top:0;left:60px}#unrelated{position:absolute;bottom:0;left:0;right:0}#menu,#sidebar-control{padding:8px}' });
    // Isolate fade layout from the theme's intentionally different typography.
    await page.addStyleTag({ content: '#menu,#sidebar-control,#under-fade{font:14px/20px sans-serif}' });
    const snapshot = () => page.evaluate(() => Object.fromEntries(['#bar', '#menu', '#frame', '#fade', '#under-fade'].map(selector => {
      const el = document.querySelector(selector)!;
      const rect = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, position: css.position, zIndex: css.zIndex, pointerEvents: css.pointerEvents, drag: css.getPropertyValue('-webkit-app-region'), radius: css.borderTopLeftRadius, border: selector === '#frame' ? css.borderTop : css.borderTopWidth, shadow: css.boxShadow }];
    })));
    const wallpaper = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#95bfd0'; ctx.fillRect(0, 0, 400, 400);
      ctx.fillStyle = '#d7a3c0'; ctx.fillRect(0, 200, 200, 200); ctx.fillRect(200, 0, 200, 200);
      return canvas.toDataURL('image/png');
    });
    let document = patchTheme('global', { appearance: mode })(newDocument());
    document = patchTheme('background', { type: 'image', overlay: 0, blur: 0, opacity: 1 })(document);
    const css = execFileSync(example, ['render-css'], { input: buildCss(document.theme, wallpaper), encoding: 'utf8' });
    await page.locator('#under-fade').evaluate(el => el.addEventListener('click', () => el.setAttribute('data-clicked', 'true')));
    for (const width of [1200, 760]) {
      await page.setViewportSize({ width, height: 820 });
      for (const state of ['visible', 'full-bleed', 'hidden']) {
        await page.locator('#fade').evaluate((el, state) => el.setAttribute('data-app-shell-main-content-top-fade', state), state);
        await page.locator('.thread-scroll-container').evaluate(el => { el.scrollTop = 300; });
        const before = await snapshot();
        const original = await page.locator('#fade').evaluate(el => getComputedStyle(el).backgroundImage);
        expect(original).toContain('linear-gradient');
        const unrelated = await page.locator('#unrelated').evaluate(el => { const s = getComputedStyle(el); return [s.backgroundImage, s.boxShadow, s.border]; });
        await invoke(page, 'apply', css);
        await expect(page.locator('[data-lct-part="thread-top-fade"]')).toHaveCount(1);
        await expect(page.locator('#fade')).toHaveCSS('background-image', 'none');
        await expect(page.locator('#fade')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        expect(await snapshot()).toEqual(before);
        expect(await page.locator('.thread-scroll-container').evaluate(el => el.scrollTop)).toBe(300);
        expect(await page.locator('#unrelated').evaluate(el => { const s = getComputedStyle(el); return [s.backgroundImage, s.boxShadow, s.border]; })).toEqual(unrelated);
        await expect(page.locator('#lookalike')).not.toHaveAttribute('data-lct-part');
        expect(await page.locator('#lookalike').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
        await page.locator('#menu').click();
        await page.locator('#sidebar-control').click();
        await page.locator('#under-fade').click();
        await expect(page.locator('#under-fade')).toHaveAttribute('data-clicked', 'true');
        expect((await invoke(page, 'verify', css)).applied).toBe(true);
        if (state === 'visible') await page.screenshot({ path: testInfo.outputPath(`${mode}-top-fade-${width}.png`) });
        expect((await invoke(page, 'restore')).restored).toBe(true);
        await expect(page.locator('#fade')).not.toHaveAttribute('data-lct-part');
        await expect(page.locator('#fade')).toHaveCSS('background-image', original);
        expect(await snapshot()).toEqual(before);
      }
    }
    await invoke(page, 'apply', css);
    await page.locator('#fade-host').evaluate((el, html) => { el.innerHTML = html; }, fade);
    await expect(page.locator('#fade')).toHaveAttribute('data-lct-part', 'thread-top-fade');
    await expect(page.locator('#fade')).toHaveCSS('background-image', 'none');
    await invoke(page, 'restore');
    await expect(page.locator('#fade')).not.toHaveAttribute('data-lct-part');
    expect(await page.locator('#fade').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  });
}
