import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installedStyles } from '../fixtures/installed-styles.mjs';
import { buildCss } from '../../src/theme/css-generator';
import { newDocument } from '../../src/theme/defaults';
import { patchTheme } from '../../src/theme/history';

const example = resolve('target/debug/examples/codex_poc.exe');
const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
async function invoke(page: import('@playwright/test').Page, action: string, css = '') {
  return page.evaluate(({ contract, action, css }) => {
    const execute = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return execute({ profile: contract.profile, action, css });
  }, { contract, action, css });
}

for (const mode of ['dark', 'light'] as const) {
  test(`${mode} independent header slots keep toolbar styling after resize and relocation`, async ({ page, context }, testInfo) => {
    test.skip(process.platform !== 'win32', 'Requires installed Windows styles');
    let detection;
    try { detection = JSON.parse(execFileSync(example, ['detect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { test.skip(true, 'Official package unavailable'); return; }
    await context.route('**/*', route => route.abort());
    await page.emulateMedia({ colorScheme: mode });
    await page.setContent(`<!doctype html><html class="${mode}" data-theme="${mode}" data-codex-os="win32" data-codex-window-type="electron"><head></head><body>
      <aside class="app-shell-left-panel">Projects</aside><main data-app-shell-main-surface><div class="composer-surface-chrome">Composer</div></main>
      <header data-pip-obstacle="app-shell-header">
        <div data-testid="app-shell-header-context-menu-surface"><div id="central" data-app-shell-header-obstacle="true"></div><div data-app-shell-page-header="true"><div class="_Toolbar_1r2f4_2 flex items-center" data-app-shell-header-toolbar="true"><div id="page-identity" style="width:100px;height:28px;flex-shrink:0;font:14px/28px sans-serif">Chat title</div><div id="page-actions" class="ms-auto"></div></div></div></div>
        <div data-test-id="header-shell-slot" data-app-shell-header-obstacle="true">
          <div aria-hidden="true" class="invisible"><div class="no-drag"><button id="measure" class="bg-surface" tabindex="-1">...</button></div></div>
          <div id="slot" class="pointer-events-none"><div id="action" class="no-drag pointer-events-auto"><button id="more" class="bg-surface" aria-label="More" aria-haspopup="menu" data-state="closed">...</button></div></div>
        </div>
      </header>
      <div id="caption"><button>Native caption placeholder</button></div>
      <div id="menu" role="menu" hidden><button role="menuitem">Menu action</button></div>
      <div data-test-id="header-shell-slot" id="unrelated"><div class="no-drag"><button>Unrelated slot</button></div></div>
      </body></html>`);
    for (const style of installedStyles(detection.installation.executable)) await page.addStyleTag({ content: style.css });
    await page.addStyleTag({ content: 'body{margin:0;--app-shell-left-panel-width:180px}header{position:absolute;top:40px;left:180px;right:0;display:flex;justify-content:flex-end;-webkit-app-region:drag}header button{width:28px;height:28px;font:14px/20px sans-serif}header button:focus-visible{outline:2px solid #75aadd;outline-offset:2px}.no-drag{-webkit-app-region:no-drag}.invisible{position:absolute;visibility:hidden}#caption{position:absolute;right:0;top:0}#menu{position:absolute;top:80px;right:0;background:#303030;color:white}#unrelated{position:absolute;top:150px;right:0;background:#303030;color:white}aside{height:100vh}main{position:absolute;left:180px;top:180px}.composer-surface-chrome{padding:20px}' });
    await page.locator('#more').evaluate(el => el.addEventListener('click', () => {
      const menu = document.querySelector<HTMLElement>('#menu')!;
      menu.hidden = !menu.hidden; el.setAttribute('data-state', menu.hidden ? 'closed' : 'open');
    }));
    let doc = patchTheme('global', { appearance: mode })(newDocument());
    doc = patchTheme('background', { type: 'gradient', gradientStart: '#697e90', gradientEnd: '#808b75', overlay: 0 })(doc);
    doc = patchTheme('toolbarButtons', { opacity: 0, blur: 0, borderWidth: 0, shadow: false })(doc);
    const render = () => execFileSync(example, ['render-css'], { input: buildCss(doc.theme), encoding: 'utf8' });
    const geometry = () => page.locator('#more').boundingBox();
    const original = await page.locator('#more').evaluate(el => getComputedStyle(el).backgroundColor);
    for (const [width, parent] of [[1920, '#slot'], [900, '#central'], [1920, '#page-actions'], [1920, '#slot']] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('header').evaluate(el => el.setAttribute('data-app-shell-header-edge-scroll', 'true'));
      await page.locator(parent).evaluate(el => el.append(document.querySelector('#action')!));
      const before = await geometry();
      await invoke(page, 'apply', render());
      await page.mouse.move(1, 1);
      await expect(page.locator('#more')).toHaveAttribute('data-lct-part', 'toolbar-button');
      expect(await page.locator('#more').evaluate(el => getComputedStyle(el).backgroundColor)).toMatch(/, 0\)$/);
      // Codex paints the toolbar's direct children when content meets the header.
      // A transparent button alone still exposes this opaque container.
      for (const id of ['page-actions', 'page-identity']) {
        await expect(page.locator(`#${id}`)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }
      for (const scrolled of ['false', 'true']) {
        await page.locator('header').evaluate((el, value) => el.setAttribute('data-app-shell-header-edge-scroll', value), scrolled);
        await expect(page.locator('#page-actions')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }
      expect(await geometry()).toEqual(before);
      await expect(page.locator('#measure')).toBeHidden();
      for (const selector of ['#caption button', '#menu button', '#unrelated button']) await expect(page.locator(selector)).not.toHaveAttribute('data-lct-part');
      await page.keyboard.press('Tab'); await page.locator('#more').focus();
      await expect(page.locator('#more')).toHaveCSS('outline-style', 'solid');
      await page.locator('#more').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.getByRole('menuitem').click();
      await page.locator('#more').click();
      await expect(page.getByRole('menu')).toBeHidden();
      await page.locator('#more').blur(); await page.mouse.move(1, 1);
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}-${parent.slice(1)}.png`) });
      // Moving an already styled action must not require a fresh apply.
      const destination = parent === '#slot' ? '#central' : '#slot';
      await page.locator(destination).evaluate(el => el.append(document.querySelector('#action')!));
      await expect(page.locator('#more')).toHaveAttribute('data-lct-part', 'toolbar-button');
      expect((await invoke(page, 'verify', render())).applied).toBe(true);
      await invoke(page, 'restore');
      await expect(page.locator('#more')).not.toHaveAttribute('data-lct-part');
      await expect(page.locator('#more')).toHaveCSS('background-color', original);
      const restoredFill = await page.locator('#page-actions').evaluate(el => getComputedStyle(el).backgroundColor);
      expect(restoredFill).not.toBe('rgba(0, 0, 0, 0)');
      await expect(page.locator('#page-actions')).not.toHaveAttribute('data-lct-part');
    }
    doc = patchTheme('toolbarButtons', { background: '#123456', opacity: 0.5 })(doc);
    await invoke(page, 'apply', render());
    await expect(page.locator('#more')).toHaveCSS('background-color', 'rgba(18, 52, 86, 0.5)');
    await page.locator('#action').evaluate(el => { el.innerHTML = '<button id="more" class="bg-surface">...</button>'; });
    await expect(page.locator('#more')).toHaveAttribute('data-lct-part', 'toolbar-button');
    await expect(page.locator('#more')).toHaveCSS('background-color', 'rgba(18, 52, 86, 0.5)');
    await invoke(page, 'restore');
    await expect(page.locator('#measure')).not.toHaveAttribute('data-lct-part');
  });
}
