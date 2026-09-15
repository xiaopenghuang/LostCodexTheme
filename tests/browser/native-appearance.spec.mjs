import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const contract = JSON.parse(execFileSync(resolve('target/debug/examples/codex_poc.exe'), ['contract'], { encoding: 'utf8' }));
const location = { protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' };
async function run(page, action, appearance = true, mode = 'dark', route = location) {
  return page.evaluate(({ contract, action, appearance, mode, route }) => {
    const source = appearance ? contract.nativeAppearance : contract.bridge;
    const execute = new Function('location', `return ${source}`)(route);
    return execute({ action, profile: contract.profile, css: `body {color-scheme:${mode};background:#161916;color:#eee}` });
  }, { contract, action, appearance, mode, route });
}

async function setup(page, target = 'dark', initial = 'light') {
  await page.emulateMedia({ colorScheme: initial === 'system' ? 'light' : initial });
  await page.exposeFunction('setMockNativeMode', mode => page.emulateMedia({ colorScheme: mode }));
  await page.setContent(`<!doctype html><html data-codex-os="win32"><head><style>
    aside,main{min-height:300px;width:300px}body{display:flex}
    #caption{position:fixed;right:0;top:0;color:#1f1f1f;background:transparent}
    @media(prefers-color-scheme:dark){#caption{color:white}}
    </style></head><body><aside class="app-shell-left-panel">Sidebar</aside>
    <main data-app-shell-main-surface>Theme sample</main>
    <div id="caption"><svg width="138" height="36" viewBox="0 0 138 36"><path d="M18 18h10 M62 14h9v9h-9z M108 14l9 9m-9 0l9-9" fill="none" stroke="currentColor"/></svg></div>
    </body></html>`);
  await run(page, 'apply', false, target);
  await page.evaluate(initial => {
    window.mockAppearance = { value: initial, calls: [], failure: '', delayRead: false, otherSetting: 'unchanged' };
    window.electronBridge = { sendMessageFromView: async request => {
      const mock = window.mockAppearance;
      mock.calls.push(request);
      if (mock.failure === 'send') throw new Error('private native failure');
      const operation = request.url.split('/').at(-1);
      const params = JSON.parse(request.body);
      if (mock.delayRead && operation === 'get-setting') await new Promise(resolve => { window.releaseAppearanceRead = resolve; });
      let result;
      if (operation === 'get-setting') result = mock.failure === 'malformed' ? {} : { value: mock.value };
      else if (operation === 'set-setting') {
        if (mock.failure !== 'readback') mock.value = params.value;
        if (mock.failure !== 'palette') await window.setMockNativeMode(params.value);
        result = { success: true };
      } else throw new Error('Unexpected operation');
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'fetch-response', requestId: request.requestId, status: mock.failure === 'reject' ? 432 : 200,
        responseType: mock.failure === 'reject' ? 'error' : 'success', bodyJsonString: JSON.stringify(result),
      } }));
    } };
  }, initial);
}

for (const mode of ['dark', 'light']) {
  test(`automatically syncs native ${mode} mode, reads it back and preserves transparent caption`, async ({ page }, testInfo) => {
    await setup(page, mode, mode === 'dark' ? 'light' : 'dark');
    expect((await run(page, 'verify')).synced).toBe(false);
    expect(await run(page, 'sync')).toMatchObject({ synced: true, mode });
    expect((await run(page, 'verify')).synced).toBe(true);
    await expect(page.locator('#caption')).toHaveCSS('color', mode === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(31, 31, 31)');
    await expect(page.locator('#caption')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('#lostcodextheme-caption-backdrop')).toHaveCount(0);
    const calls = await page.evaluate(() => window.mockAppearance.calls);
    expect(calls.map(call => call.url)).toEqual(['vscode://codex/get-setting', 'vscode://codex/set-setting', 'vscode://codex/get-setting']);
    for (const call of calls) {
      expect(call.type).toBe('fetch'); expect(call.method).toBe('POST');
      expect(JSON.parse(call.body)).toEqual(call.url.endsWith('set-setting') ? { key: 'appearanceTheme', value: mode } : { key: 'appearanceTheme' });
    }
    expect((await run(page, 'sync')).synced).toBe(true);
    expect(await page.evaluate(() => window.mockAppearance.calls.filter(call => call.url.endsWith('set-setting')).length)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`native-${mode}-transparent-caption.png`) });
    await run(page, 'restore', false);
    // As disclosed in Settings, synchronization uses the real saved preference.
    expect(await page.evaluate(() => [window.mockAppearance.value, window.mockAppearance.otherSetting])).toEqual([mode, 'unchanged']);
  });
}

test('already matching native appearance avoids writes', async ({ page }) => {
  await setup(page, 'dark', 'dark');
  expect((await run(page, 'sync')).synced).toBe(true);
  expect(await page.evaluate(() => window.mockAppearance.calls.every(call => call.url.endsWith('get-setting')))).toBe(true);
});

for (const [failure, reason] of [['send', 'settings-send-failed'], ['reject', 'settings-rejected'], ['malformed', 'invalid-appearance'], ['readback', 'settings-readback-mismatch'], ['palette', 'native-palette-mismatch']]) {
  test(`native appearance ${failure} does not claim success`, async ({ page }) => {
    await setup(page);
    await page.evaluate(failure => { window.mockAppearance.failure = failure; }, failure);
    expect(await run(page, 'sync')).toEqual({ synced: false, reason });
    expect((await run(page, 'verify')).synced).toBe(false);
    await expect(page.locator('#lostcodextheme-caption-backdrop')).toHaveCount(0);
  });
}

test('missing native settings bridge and excluded routes never write preferences', async ({ page }) => {
  await setup(page);
  expect(await run(page, 'sync', true, 'dark', { ...location, search: '?window=overlay' })).toEqual({ synced: false, reason: 'unverified-renderer' });
  expect(await page.evaluate(() => window.mockAppearance.calls.length)).toBe(0);
  await page.evaluate(() => { delete window.electronBridge; });
  expect(await run(page, 'sync')).toEqual({ synced: false, reason: 'settings-bridge-unavailable' });
});

test('timed out reads are cleaned up and cannot trigger a late settings write', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.mockAppearance.delayRead = true; });
  expect(await run(page, 'sync')).toEqual({ synced: false, reason: 'settings-timeout' });
  await page.evaluate(() => { window.mockAppearance.delayRead = false; window.releaseAppearanceRead(); });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.mockAppearance.calls.length)).toBe(1);
  expect((await run(page, 'sync')).synced).toBe(true);
});

test('restoration while a read is pending prevents subsequent writes', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.mockAppearance.delayRead = true; });
  const pending = run(page, 'sync');
  await expect.poll(() => page.evaluate(() => typeof window.releaseAppearanceRead)).toBe('function');
  await run(page, 'restore', false);
  await page.evaluate(() => { window.releaseAppearanceRead(); });
  expect(await pending).toEqual({ synced: false, reason: 'renderer-changed' });
  expect(await page.evaluate(() => window.mockAppearance.calls.length)).toBe(1);
});
