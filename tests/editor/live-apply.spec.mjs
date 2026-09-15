import { test, expect } from '@playwright/test';

test.setTimeout(30000);

test.beforeEach(async ({ page }) => {
  // Mock only the IPC boundary. No installed editor or Codex process is contacted.
  await page.addInitScript(() => {
    const connected = { state: 'connected', message: 'Mock connected', verified: true, sessionActive: true };
    const applied = { ...connected, state: 'applied', message: 'Mock applied' };
    const callbacks = new Map();
    let callbackId = 0;
    window.mockCodex = { calls: [], pending: [], hold: false, actualCss: '' };
    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { callbacks.set(++callbackId, callback); return callbackId; },
      async invoke(command, args) {
        if (command === 'plugin:event|listen') return args.handler;
        if (command === 'plugin:event|unlisten' || command === 'set_editor_dirty' || command === 'save_draft' || command === 'save_preferences') return;
        if (command === 'list_themes') return [];
        if (command === 'load_draft') return null;
        if (command === 'get_preferences') return { advanced: false, liveApply: true };
        if (command === 'get_codex_status') return connected;
        if (command === 'apply_theme_css') {
          const mock = window.mockCodex;
          mock.calls.push(args.css);
          if (mock.hold) await new Promise(resolve => mock.pending.push(resolve));
          mock.actualCss = args.css;
          return applied;
        }
        throw new Error(`Unexpected mock command: ${command}`);
      },
    };
  });
  await page.goto('http://127.0.0.1:1421');
  await expect.poll(() => page.evaluate(() => window.mockCodex.calls.length)).toBe(1);
  await expect(page.getByRole('button', { name: '应用到 Codex', exact: true })).toBeEnabled();
});

test('undo while an apply is in flight restores the actual Codex style, not just the preview', async ({ page }) => {
  const original = await page.evaluate(() => window.mockCodex.actualCss);
  await page.evaluate(() => { window.mockCodex.hold = true; });
  const radius = page.getByLabel('整体圆角', { exact: true });
  await radius.focus(); await radius.press('End');
  await expect.poll(() => page.evaluate(() => window.mockCodex.pending.length)).toBe(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('[data-lct-part="composer"]')).toHaveCSS('border-radius', '18px');
  // Allow the debounce to queue the undo while the old native request is held.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.mockCodex.hold = false;
    window.mockCodex.pending.shift()();
  });
  await expect.poll(() => page.evaluate(() => window.mockCodex.actualCss)).toBe(original);
  await expect.poll(() => page.evaluate(() => window.mockCodex.calls.length)).toBe(3);
  await expect(page.getByRole('button', { name: '应用到 Codex', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '应用到 Codex', exact: true }).click();
  await expect(page.getByText('当前主题已经应用', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.mockCodex.calls.length)).toBe(3);
});
