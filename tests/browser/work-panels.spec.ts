import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { installedStyles } from '../fixtures/installed-styles.mjs';
import { buildCss } from '../../src/theme/css-generator';
import { newDocument } from '../../src/theme/defaults';
import { patchTheme } from '../../src/theme/history';

const example = resolve('target/debug/examples/codex_poc.exe');
const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
const summary = '<div id="summary" class="rounded-3xl bg-surface-elevated-secondary relative flex max-h-full min-h-0 flex-col overflow-hidden"><div><div><section role="presentation"><h3>Outputs</h3><button data-slot="thread-summary-panel-icon-button">Add</button><p>Sources</p><button data-slot="thread-summary-panel-item-button">Reference.png</button></section></div></div></div>';
async function invoke(page: import('@playwright/test').Page, action: string, css = '') {
  return page.evaluate(({ contract, action, css }) => {
    const execute = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return execute({ profile: contract.profile, action, css });
  }, { contract, action, css });
}

for (const mode of ['dark', 'light'] as const) {
  test(`${mode} work panels reveal wallpaper through native inner layers and preserve interaction`, async ({ page, context }, testInfo) => {
    test.skip(process.platform !== 'win32', 'Requires installed Windows styles');
    let detection;
    try { detection = JSON.parse(execFileSync(example, ['detect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { test.skip(true, 'Official Codex package unavailable'); return; }
    const styles = installedStyles(detection.installation.executable);
    expect(styles.some(style => style.css.includes('--app-shell-panel-background,var(--color-surface)'))).toBe(true);
    await context.route('**/*', route => route.abort());
    await page.emulateMedia({ colorScheme: mode });
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.setContent(`<!doctype html><html class="${mode} electron-opaque" data-theme="${mode}" data-codex-window-type="electron" data-codex-os="win32"><head></head><body>
      <div id="native-caption">Native caption placeholder</div><aside class="app-shell-left-panel">Projects</aside>
      <main data-app-shell-main-surface><div data-testid="app-shell-header-context-menu-surface"><div data-app-shell-header-obstacle="true" class="ms-auto flex shrink-0"><div class="no-drag"><button id="more" class="bg-surface" aria-label="More" aria-pressed="false">...</button></div></div></div>
      <div class="thread-scroll-container"><p>Conversation</p><div id="summary-host">${summary}</div></div><div class="composer-surface-chrome">Composer</div></main>
      <aside id="right" data-app-shell-focus-area="right-panel"><div class="native-pane"><div id="file-content" data-theme="${mode}" class="bg-surface"><input aria-label="Filter files" placeholder="Filter files"><div id="tree" style="background-color:var(--color-surface);color:var(--color-text)"><button aria-selected="true" style="background:rgba(80,120,180,.3)">app.ts</button></div><div id="editor"></div><div id="terminal" style="background:#151515;color:#eeeeee">Terminal remains native</div><iframe id="web" title="Unrelated webpage" srcdoc="<body style='background:rgb(240,240,240)'>Web content</body>"></iframe></div></div><button id="divider" aria-label="Resize workspace panes">|</button></aside>
      <div id="unrelated" class="rounded-3xl bg-surface-elevated-secondary">Unrelated card</div></body></html>`);
    for (const style of styles) await page.addStyleTag({ content: style.css });
    // Match the native clipped paint layer. The aside itself must never be filled.
    await page.locator('#right').evaluate(el => {
      const pane = el.querySelector('.native-pane')!;
      pane.classList.add('absolute', 'top-0', 'bottom-0');
      (pane as HTMLElement).style.width = '100%';
      const layout = document.createElement('div');
      layout.style.cssText = 'position:absolute;inset:0';
      const clip = document.createElement('div');
      clip.className = 'absolute inset-0';
      clip.style.cssText = 'overflow:hidden;clip-path:polygon(0 0,90% 0,90% 30px,100% 30px,100% 100%,0 100%)';
      el.prepend(layout); layout.append(clip); clip.append(pane);
    });
    await page.addStyleTag({ content: 'body{margin:0;height:820px;--app-shell-left-panel-width:180px}main{position:absolute;left:180px;top:40px;bottom:0;right:380px}aside.app-shell-left-panel{width:180px;height:100%}#right{position:absolute;right:0;top:40px;bottom:0;width:380px}.native-pane{height:100%;background:var(--app-shell-panel-background,var(--color-surface))}#file-content{height:100%;padding:20px}#summary-host{margin:24px}#summary{padding:16px}#editor{margin:20px 0}#more{width:32px;height:28px;-webkit-app-region:no-drag;outline-offset:2px}#more:focus-visible{outline:2px solid #65aadd}.no-drag{display:flex}#divider{position:absolute;left:-6px;top:90px;width:12px;height:80px}#native-caption{position:absolute;right:0;top:0;height:30px;background:#343434;color:white}#unrelated{position:absolute;left:200px;bottom:80px;padding:15px}#web{height:70px;width:100%}input{border:1px solid gray}#terminal{padding:10px}' });
    // The installed editor styles use inherited surface tokens inside a shadow root.
    await page.locator('#editor').evaluate(el => {
      el.attachShadow({ mode: 'open' }).innerHTML = '<style>[data-file]{background:var(--color-surface)!important;--diffs-bg:var(--color-surface)}[data-content]{color:var(--color-text)}.syntax{color:rgb(220,150,80)}.addition{background:rgba(40,180,80,.2)}</style><div data-file><div data-content contenteditable="true" role="textbox" aria-label="File source"><span class="syntax">const</span> sample = 1;</div><div class="addition">Added line</div></div>';
    });
    const geometry = () => page.locator('#right').evaluate(el => {
      const r = el.getBoundingClientRect(); const divider = document.querySelector('#divider')!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, divider: [divider.x, divider.y, divider.width, divider.height] };
    });
    const original = await page.locator('#summary').evaluate(el => getComputedStyle(el).backgroundColor);
    const unrelated = await page.locator('#unrelated').evaluate(el => getComputedStyle(el).backgroundColor);
    const wallpaper = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 400; const x = c.getContext('2d')!;
      x.fillStyle = '#6c858e'; x.fillRect(0, 0, 400, 400); x.fillStyle = '#919a85'; x.fillRect(200, 0, 200, 400); return c.toDataURL('image/png');
    });
    let doc = patchTheme('global', { appearance: mode })(newDocument());
    doc = patchTheme('background', { type: 'image', opacity: 1, overlay: 0 })(doc);
    doc = patchTheme('global', { opacity: 0.8 })(doc);
    for (const opacity of [0, 0.5, 1]) {
      for (const key of ['workspacePanel', 'summaryPanel', 'toolbarButtons'] as const) doc = patchTheme(key, { background: '#223344', opacity, textColor: '#eeddcc', borderWidth: 2, blur: 0 })(doc);
      const css = execFileSync(example, ['render-css'], { input: buildCss(doc.theme, wallpaper), encoding: 'utf8' });
      const before = await geometry();
      await invoke(page, 'apply', css);
      for (const part of ['workspace-panel', 'summary-panel', 'toolbar-button']) await expect(page.locator(`[data-lct-part="${part}"]`)).toHaveCount(1);
      await page.mouse.move(1, 1);
      for (const id of ['.native-pane', '#summary', '#more']) await expect(page.locator(id)).toHaveCSS('background-color', `rgba(34, 51, 68, ${opacity * 0.8})`);
      for (const selector of ['#right', '#file-content', '#tree', '#editor [data-file]']) await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.locator('#right > div > .absolute')).toHaveCSS('clip-path', 'polygon(0px 0px, 90% 0px, 90% 30px, 100% 30px, 100% 100%, 0px 100%)');
      await expect(page.locator('#tree')).toHaveCSS('color', 'rgb(238, 221, 204)');
      expect(await page.locator('#file-content').evaluate(el => getComputedStyle(el).getPropertyValue('--color-token-text-primary').trim())).toBe('#eeddcc');
      await expect(page.locator('#editor .syntax')).toHaveCSS('color', 'rgb(220, 150, 80)');
      await expect(page.locator('#editor .addition')).toHaveCSS('background-color', 'rgba(40, 180, 80, 0.2)');
      await expect(page.locator('#tree [aria-selected]')).toHaveCSS('background-color', 'rgba(80, 120, 180, 0.3)');
      await expect(page.locator('#terminal')).toHaveCSS('background-color', 'rgb(21, 21, 21)');
      await expect(page.frameLocator('#web').locator('body')).toHaveCSS('background-color', 'rgb(240, 240, 240)');
      await expect(page.locator('#native-caption')).toHaveCSS('background-color', 'rgb(52, 52, 52)');
      expect(await geometry()).toEqual(before);
      await page.getByRole('textbox', { name: 'Filter files', exact: true }).fill('app');
      await page.getByRole('textbox', { name: 'File source', exact: true }).fill('Updated source');
      await page.locator('#summary button').first().click();
      await page.keyboard.press('Tab');
      await page.locator('#more').focus();
      await expect(page.locator('#more')).toHaveCSS('outline-style', 'solid');
      await page.locator('#more').click();
      const hover = await page.locator('#more').evaluate(el => getComputedStyle(el).backgroundColor);
      await page.locator('#more').evaluate(el => el.setAttribute('aria-pressed', 'true'));
      await expect(page.locator('#more')).not.toHaveCSS('background-color', hover);
      await page.locator('#more').evaluate(el => el.setAttribute('aria-pressed', 'false'));
      expect(await page.locator('#more').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
      expect((await invoke(page, 'verify', css)).applied).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${mode}-work-panels-${opacity}.png`) });
      await page.locator('#right').evaluate(el => { el.style.width = '320px'; });
      await expect(page.locator('#right')).toHaveCSS('width', '320px');
      await page.locator('#divider').click();
      await invoke(page, 'restore');
      await expect(page.locator('#summary')).toHaveCSS('background-color', original);
      await expect(page.locator('#unrelated')).toHaveCSS('background-color', unrelated);
      await expect(page.locator('[data-lct-part="workspace-panel"]')).toHaveCount(0);
      // Restore the sample code before the next editability/highlight check.
      await page.locator('#editor [data-content]').evaluate(el => { el.innerHTML = '<span class="syntax">const</span> sample = 1;'; });
      await page.locator('#more').blur();
    }
    await invoke(page, 'apply', execFileSync(example, ['render-css'], { input: buildCss(doc.theme), encoding: 'utf8' }));
    await page.locator('#summary-host').evaluate((el, html) => { el.innerHTML = html; }, summary);
    await expect(page.locator('#summary')).toHaveAttribute('data-lct-part', 'summary-panel');
    await page.locator('#right').evaluate(el => { el.hidden = true; });
    await expect(page.locator('#right')).toBeHidden();
    await page.locator('#right').evaluate(el => { el.hidden = false; });
    await expect(page.locator('#right')).toBeVisible();
    await invoke(page, 'restore');
    await expect(page.locator('#summary')).not.toHaveAttribute('data-lct-part');
  });
}
