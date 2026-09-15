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
  return page.evaluate(({ action, css, contract }) => {
    const run = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return run({ action, css, profile: contract.profile });
  }, { action, css, contract });
}

for (const mode of ['dark', 'light'] as const) {
  for (const nativeMode of ['light', 'dark'] as const) {
    test(`${mode} theme with ${nativeMode} native chrome keeps settings and one message bubble readable`, async ({ page, context }, testInfo) => {
      test.skip(process.platform !== 'win32', 'Requires read-only official Windows styles');
      let detection;
      try { detection = JSON.parse(execFileSync(example, ['detect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
      catch { test.skip(true, 'Official package unavailable'); return; }
      const styles = installedStyles(detection.installation.executable);
      for (const anchor of ['--color-surface-elevated', '--color-background-primary-soft-alpha', '.bg-user-message']) {
        expect(styles.some(style => style.css.includes(anchor))).toBe(true);
      }
      let document = newDocument();
      if (mode === 'light') document = patchTheme('global', { appearance: 'light' })(document);
      document = patchTheme('userMessage', { opacity: 0.6, borderWidth: 2, radius: 18, maxWidth: 77 })(document);
      const css = execFileSync(example, ['render-css'], { input: buildCss(document.theme), encoding: 'utf8' });
      await context.route('**/*', route => route.abort());
      await page.emulateMedia({ colorScheme: nativeMode });
      await page.setViewportSize({ width: 1200, height: 820 });
      await page.setContent(`<!doctype html><html class="light electron-opaque" data-theme="light" data-codex-window-type="electron" data-codex-os="win32"><head></head><body>
        <aside class="app-shell-left-panel">Settings</aside><main data-app-shell-main-surface>
        <section data-theme="light" style="--color-background-panel:#fff">
          <h1 class="text-default">General settings</h1>
          <div id="settings-card" class="rounded-2xl border border-default" style="background-color:var(--color-background-panel, var(--color-background-primary-soft-alpha));padding:20px">
            <p class="text-default">Default permissions</p><p id="description" class="text-secondary">Choose how Codex can access your workspace.</p>
            <input aria-label="Folder" class="bg-primary-soft text-default" value="C:/Workspace">
            <button id="dropdown" class="bg-surface-elevated text-default">Windows native</button>
          </div><div id="fallback-card" style="background:var(--color-background-primary-soft-alpha)">Panel fallback</div>
          <div id="message-row" data-local-conversation-user-anchor="true"><div class="group flex w-full flex-col items-end justify-end gap-1">
            <div id="bubble" class="bg-user-message text-user-message rounded-2xl px-4 py-2.5">Can I keep Codex open?</div>
            <button id="message-actions">Copy</button>
          </div></div>
          <div id="popup" role="dialog" class="bg-surface-elevated text-default">Popup content</div>
          <span id="warning" style="color:#d97706">Permission warning</span>
          <button id="caption-hit" style="position:fixed;right:0;top:0;width:138px;height:36px">Native control hit area</button>
        </section></main></body></html>`);
      for (const style of styles) await page.addStyleTag({ content: style.css });
      await page.addStyleTag({ content: 'body{display:flex;min-height:820px;margin:0}aside{width:240px}main{padding:70px 35px;flex:1}#message-row{margin-top:30px}#popup{margin-top:30px;padding:20px}' });
      await page.evaluate(() => {
        let reads = 0;
        const overlay = Object.assign(new EventTarget(), {
          visible: true,
          getTitlebarAreaRect: () => { reads++; return new DOMRect(0, 0, innerWidth - 138, 36); },
        });
        Object.defineProperty(overlay, 'reads', { get: () => reads });
        Object.defineProperty(navigator, 'windowControlsOverlay', { configurable: true, value: overlay });
      });
      await expect(page.locator('#settings-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      const originalBubble = await page.locator('#bubble').evaluate(el => getComputedStyle(el).backgroundColor);
      await invoke(page, 'apply', css);
      const foreground = mode === 'dark' ? 'rgb(230, 232, 229)' : 'rgb(40, 53, 43)';
      const surface = mode === 'dark' ? 'rgb(40, 44, 41)' : 'rgb(251, 252, 249)';
      for (const selector of ['#settings-card', '#fallback-card', '#dropdown', '#popup', 'input']) {
        await expect(page.locator(selector)).toHaveCSS('background-color', surface);
      }
      await expect(page.locator('#settings-card p').first()).toHaveCSS('color', foreground);
      await expect(page.locator('#dropdown')).toHaveCSS('color', foreground);
      const contrast = await page.locator('#description').evaluate(el => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const luminance = (color: string) => {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
          const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c / 255)
            .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const a = luminance(getComputedStyle(el).color), b = luminance(getComputedStyle(el.parentElement!).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await expect(page.locator('#message-row')).not.toHaveAttribute('data-lct-part');
      await expect(page.locator('#message-row')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.locator('#bubble')).toHaveAttribute('data-lct-part', 'user-message');
      await expect(page.locator('[data-lct-part="user-message"]')).toHaveCount(1);
      await expect(page.locator('#bubble')).toHaveCSS('border-radius', '18px');
      await expect(page.locator('#bubble')).toHaveCSS('border-top-width', '2px');
      const row = await page.locator('#message-row').boundingBox(), bubble = await page.locator('#bubble').boundingBox();
      expect(bubble!.width).toBeLessThan(row!.width * 0.78);
      expect(bubble!.x + bubble!.width).toBeCloseTo(row!.x + row!.width, 0);
      await expect(page.locator('#message-actions')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.locator('#warning')).toHaveCSS('color', 'rgb(217, 119, 6)');
      const caption = page.locator('#lostcodextheme-caption-backdrop');
      await expect(caption).toHaveCount(0);
      expect(await page.evaluate(() => document.elementFromPoint(innerWidth - 30, 18)?.id)).toBe('caption-hit');
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${nativeMode}-surfaces.png`) });
      await page.setViewportSize({ width: 960, height: 720 });
      await expect(caption).toHaveCount(0);
      await page.evaluate(() => {
        const overlay = (navigator as Navigator & { windowControlsOverlay: EventTarget & { visible: boolean } }).windowControlsOverlay;
        overlay.visible = false; overlay.dispatchEvent(new Event('geometrychange'));
      });
      await expect(caption).toHaveCount(0);
      expect((await invoke(page, 'restore')).restored).toBe(true);
      await expect(caption).toHaveCount(0);
      expect(await page.evaluate(() => {
        const overlay = (navigator as Navigator & { windowControlsOverlay: EventTarget & { reads: number } }).windowControlsOverlay;
        const before = overlay.reads;
        overlay.dispatchEvent(new Event('geometrychange')); window.dispatchEvent(new Event('resize'));
        return overlay.reads === before;
      })).toBe(true);
      await expect(page.locator('#settings-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.locator('#bubble')).toHaveCSS('background-color', originalBubble);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect((await invoke(page, 'apply', css)).applied).toBe(true);
      await expect(caption).toHaveCount(0);
      await invoke(page, 'restore');
    });
  }
}
