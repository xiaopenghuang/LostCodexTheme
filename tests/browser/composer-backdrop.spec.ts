import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installedStyles } from '../fixtures/installed-styles.mjs';
import { buildCss } from '../../src/theme/css-generator';
import { newDocument } from '../../src/theme/defaults';
import { patchTheme } from '../../src/theme/history';

const example = resolve('target/debug/examples/codex_poc.exe');
const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
const scrim = '<div aria-hidden="true" class="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-full bg-gradient-to-t from-surface via-surface extension:from-surface-secondary extension:via-surface-secondary"></div>';

async function invoke(page: import('@playwright/test').Page, action: string, css = '') {
  return page.evaluate(({ contract, action, css }) => {
    const execute = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return execute({ profile: contract.profile, action, css });
  }, { contract, action, css });
}

for (const mode of ['dark', 'light'] as const) {
  test(`${mode} composer scrim reveals wallpaper without changing layout, controls or unrelated gradients`, async ({ page, context }, testInfo) => {
    test.skip(process.platform !== 'win32', 'Requires read-only installed Windows styles');
    let detection;
    try { detection = JSON.parse(execFileSync(example, ['detect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { test.skip(true, 'Official Codex package unavailable'); return; }
    const styles = installedStyles(detection.installation.executable);
    for (const anchor of ['.from-surface{', '.via-surface{', '_ComposerLayoutRoot_1qpwu_2']) {
      expect(styles.some(style => style.css.includes(anchor))).toBe(true);
    }
    await context.route('**/*', route => route.abort());
    await page.emulateMedia({ colorScheme: mode });
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.setContent(`<!doctype html><html class="${mode} electron-opaque" data-theme="${mode}" data-codex-window-type="electron" data-codex-os="win32"><head></head><body>
      <aside class="app-shell-left-panel"><div id="unrelated" aria-hidden="true" class="sticky bottom-0">${scrim}</div></aside>
      <main data-app-shell-main-surface>
        <div class="thread-scroll-container"><div class="flex min-h-full shrink-0 flex-col justify-start overflow-x-clip">
          <div id="messages">Conversation content<div id="message-gradient">${scrim}</div></div>
          <div id="spacer" aria-hidden="true" class="sticky bottom-0 z-10 mt-auto w-full shrink-0">${scrim}</div>
        </div></div>
        <div id="composer" class="_ComposerLayoutRoot_1qpwu_2" data-composer-surface-variant="opaque" data-composer-radius-variant="default">
          <div class="_ComposerLayoutBody_1qpwu_2"><div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Message"></div><button id="send">Send</button></div>
        </div>
      </main></body></html>`);
    for (const style of styles) await page.addStyleTag({ content: style.css });
    await page.addStyleTag({ content: 'body{margin:0;display:flex;height:820px;--app-shell-left-panel-width:240px}aside{width:240px}main{position:relative;flex:1;min-width:0}.thread-scroll-container{height:820px;overflow:auto;--thread-scroll-padding-bottom:196px}#messages{min-height:1100px;padding:32px}#spacer{height:180px}#unrelated,#message-gradient{position:relative;height:80px}#composer{position:absolute;bottom:16px;left:60px;right:60px;z-index:20} [contenteditable]{min-height:70px} #send{padding:10px}'});
    await page.locator('.thread-scroll-container').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const geometry = async () => page.locator('#spacer').evaluate(el => {
      const scroll = document.querySelector('.thread-scroll-container')!;
      const box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop };
    });
    const before = await geometry();
    const original = await page.locator('#spacer > div').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(original).toContain('linear-gradient');
    const wallpaper = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#95bfd0'; ctx.fillRect(0, 0, 400, 400);
      ctx.fillStyle = '#d7a3c0'; ctx.fillRect(0, 200, 200, 200); ctx.fillRect(200, 0, 200, 200);
      return canvas.toDataURL('image/png');
    });
    let document = newDocument();
    if (mode === 'light') document = patchTheme('global', { appearance: mode })(document);
    document = patchTheme('global', { opacity: 0.8 })(document);
    document = patchTheme('background', { type: 'image', overlay: 0, blur: 0, opacity: 1 })(document);
    for (const [opacity, alpha] of [[0, 0], [0.35, 0.28], [1, 0.8]]) {
      document = patchTheme('composer', { background: '#223344', opacity, blur: 0 })(document);
      const css = execFileSync(example, ['render-css'], { input: buildCss(document.theme, wallpaper), encoding: 'utf8' });
      await invoke(page, 'apply', css);
      await expect(page.locator('[data-lct-part="composer-backdrop"]')).toHaveCount(1);
      await expect(page.locator('#spacer > div')).toHaveCSS('background-image', 'none');
      await expect(page.locator('#spacer > div')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.locator('#spacer')).toHaveCSS('position', 'sticky');
      await expect(page.locator('#composer')).toHaveCSS('background-color', `rgba(34, 51, 68, ${alpha})`);
      await expect(page.locator('._ComposerLayoutBody_1qpwu_2')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect(await geometry()).toEqual(before);
      for (const selector of ['#unrelated > div', '#message-gradient > div']) {
        await expect(page.locator(selector)).not.toHaveAttribute('data-lct-part');
        expect(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
      }
      await page.getByRole('textbox', { name: 'Message' }).fill(`Opacity ${opacity}`);
      await page.locator('#send').click();
      expect((await invoke(page, 'verify', css)).applied).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${mode}-composer-opacity-${opacity}.png`) });
    }
    await page.locator('#spacer').evaluate((el, html) => { el.innerHTML = html; }, scrim);
    await expect(page.locator('#spacer > div')).toHaveAttribute('data-lct-part', 'composer-backdrop');
    await expect(page.locator('#spacer > div')).toHaveCSS('background-image', 'none');
    expect((await invoke(page, 'restore')).restored).toBe(true);
    await expect(page.locator('#spacer > div')).not.toHaveAttribute('data-lct-part');
    await expect(page.locator('#spacer > div')).toHaveCSS('background-image', original);
    expect(await geometry()).toEqual(before);
  });
}
