import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { largePng } from '../tests/fixtures/large-png.mjs';

const root = resolve('artifacts/native', `native-${randomUUID()}`);
const expectedVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
await mkdir(root, { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const logs = [];
const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
vite.stdout.on('data', data => logs.push(String(data))); vite.stderr.on('data', data => logs.push(String(data)));
let app, browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(operation, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null || app?.exitCode != null) throw new Error(`${label}: helper exited\n${logs.join('')}`);
    try { const result = await operation(); if (result) return result; } catch {}
    await delay(250);
  }
  throw new Error(`${label} timed out\n${logs.join('')}`);
}
try {
  await waitFor(async () => (await fetch('http://127.0.0.1:1420')).ok, 'Editor server');
  app = spawn(resolve('target/debug/lost-codex-theme.exe'), [], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LCT_SMOKE_DIRECTORY: root,
      WEBVIEW2_USER_DATA_FOLDER: resolve(root, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` },
  });
  app.stdout.on('data', data => logs.push(String(data))); app.stderr.on('data', data => logs.push(String(data)));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'Isolated WebView2');
  // Verify the test endpoint belongs to a WebView2 using this unique, private test directory.
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    $rows = @(Get-NetTCPConnection -State Listen -LocalPort $env:LCT_SMOKE_PORT -ErrorAction Stop)
    if ($rows.Count -eq 0) { throw 'No test listener' }
    foreach ($row in $rows) {
      if ($row.LocalAddress -ne '127.0.0.1') { throw 'Non-loopback test listener' }
      $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $row.OwningProcess)
      $command = $owner.CommandLine.Replace('/', '\\')
      if ($owner.Name -ne 'msedgewebview2.exe' -or $command.IndexOf($env:LCT_SMOKE_DIRECTORY, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $dataArgument = [regex]::Match($owner.CommandLine, '--user-data-dir=("[^"]*"|[^ ]+)').Value
        throw ('Unexpected test listener owner: ' + $owner.Name + ' ' + $dataArgument)
      }
    }
  `], { windowsHide: true, env: { ...process.env, LCT_SMOKE_PORT: String(port), LCT_SMOKE_DIRECTORY: root }, stdio: 'pipe' });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await waitFor(async () => browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('http://127.0.0.1:1420')), 'Editor page');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__));
  const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const info = await invoke('get_runtime_info');
  assert.equal(info.version, expectedVersion, 'Rebuild the debug desktop binary before native smoke');
  assert.equal(info.isolatedTest, true); assert.ok(info.testDirectory.toLowerCase().endsWith(root.toLowerCase()));
  assert.equal(info.trayAvailable, true, 'Tray icon must have a persistent owner');
  await page.getByRole('heading', { name: '整体', exact: true }).waitFor();
  const fixture = JSON.parse(await readFile(resolve('tests/fixtures/document.json'), 'utf8'));
  fixture.theme.meta.id = 'native-smoke'; fixture.theme.meta.name = 'Native smoke';
  await invoke('save_theme', { document: fixture });
  let themes = await invoke('list_themes'); assert.equal(themes.length, 1); assert.equal(themes[0].document.theme.meta.name, 'Native smoke');
  const invalid = structuredClone(fixture); invalid.theme.meta.id = '../outside';
  await assert.rejects(invoke('save_theme', { document: invalid }));
  assert.deepEqual(await invoke('list_themes'), themes);
  await invoke('save_draft', { document: fixture });
  assert.equal((await invoke('load_draft')).theme.meta.id, 'native-smoke');
  await invoke('save_preferences', { preferences: { advanced: true, liveApply: false } });
  assert.deepEqual(await invoke('get_preferences'), { advanced: true, liveApply: false });
  const fonts = await invoke('list_system_fonts'); assert.ok(fonts.length > 0);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext('2d'); context.fillStyle = '#668855'; context.fillRect(0, 0, 2, 2);
    return Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0));
  });
  await invoke('save_image', { name: 'smoke.png', bytes: png });
  assert.deepEqual(await invoke('load_image', { name: 'smoke.png' }), png);
  await assert.rejects(invoke('save_image', { name: 'invalid.png', bytes: [0, 1, 2] }));
  await assert.rejects(invoke('load_image', { name: 'invalid.png' }));
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await waitFor(async () => page.frameLocator('iframe').locator('[data-lct-part="background"]').evaluate(element => getComputedStyle(element).backgroundImage.startsWith('url("data:image/png')), 'Native image preview');
  assert.equal(await page.frameLocator('iframe').locator('[data-lct-part="sidebar"]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(34, 37, 34, 0)');
  await page.locator('input[type=file]').setInputFiles({ name: 'maximum.png', mimeType: 'image/png', buffer: largePng() });
  await waitFor(async () => page.frameLocator('iframe').locator('[data-lct-part="background"]').evaluate(element => getComputedStyle(element).backgroundImage.startsWith('url("data:image/webp')), 'Native maximum image preview');
  const imageFilesBeforeCancel = (await readdir(resolve(root, 'images'))).sort();
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window);
    window.lctCancelledDecode = { original, waiting: false, finished: false };
    window.createImageBitmap = async (...args) => {
      const bitmap = await original(...args);
      window.lctCancelledDecode.waiting = true;
      await new Promise(resolve => { window.lctCancelledDecode.release = resolve; });
      window.lctCancelledDecode.finished = true;
      return bitmap;
    };
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'cancelled.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await waitFor(() => page.evaluate(() => window.lctCancelledDecode.waiting), 'Delayed image validation');
  await page.getByRole('button', { name: '纯色', exact: true }).click();
  await page.evaluate(() => {
    window.createImageBitmap = window.lctCancelledDecode.original;
    window.lctCancelledDecode.release();
  });
  await waitFor(() => page.evaluate(() => window.lctCancelledDecode.finished), 'Cancelled decoder completion');
  await waitFor(async () => (await invoke('load_draft'))?.theme.background.type === 'color', 'Cancelled upload preserves current draft');
  assert.deepEqual((await readdir(resolve(root, 'images'))).sort(), imageFilesBeforeCancel, 'Cancelled validation must not write an image through native IPC');
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await waitFor(async () => page.frameLocator('iframe').locator('[data-lct-part="background"]').evaluate(element => getComputedStyle(element).backgroundImage.startsWith('url("data:image/webp')), 'Previous image remains available after cancellation');
  for (const command of ['start_theming_session', 'restore_default', 'reconnect_codex', 'apply_theme_css']) {
    await assert.rejects(invoke(command, command === 'apply_theme_css' ? { css: '', customCss: '' } : {}), /隔离测试/);
  }
  await assert.rejects(invoke('load_image', { name: '../outside.png' }));
  await invoke('delete_theme', { id: 'native-smoke' });
  themes = await invoke('list_themes'); assert.equal(themes.length, 0);
  await page.screenshot({ path: resolve(root, 'native-editor.png') });
  assert.deepEqual(errors, []);

  // Exercise real WM_CLOSE only on this process we spawned, never on Codex or
  // another installed editor. The tray exit path reveals the confirmation UI.
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('heading', { name: '关闭窗口后继续运行' }).waitFor();
  await page.screenshot({ path: resolve(root, 'native-tray-settings.png') });
  for (const dirty of [false, true]) {
    if (dirty) await invoke('request_editor_exit');
    else await page.getByRole('button', { name: '退出换肤软件', exact: true }).click();
    await page.getByRole('dialog', { name: '退出主题编辑器？' }).waitFor();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await waitFor(async () => (await invoke('get_runtime_info')).windowVisible, 'Restored editor window');
    await invoke('set_editor_dirty', { dirty });
    const before = await invoke('get_codex_status');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `
      $process = Get-Process -Id $env:LCT_SMOKE_PID -ErrorAction Stop
      if ($process.Path -ne $env:LCT_SMOKE_EXE) { throw 'Unexpected editor process' }
      $handle = $process.MainWindowHandle
      if ($handle -eq 0) { throw 'Missing isolated editor window' }
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class LctSmokeClose { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid); }'
      [uint32]$ownerId = 0
      [void][LctSmokeClose]::GetWindowThreadProcessId($handle, [ref]$ownerId)
      if ($ownerId -ne [uint32]$env:LCT_SMOKE_PID) { throw 'Unexpected window owner' }
      if (-not [LctSmokeClose]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }
    `], { windowsHide: true, stdio: 'pipe', env: { ...process.env, LCT_SMOKE_PID: String(app.pid), LCT_SMOKE_EXE: resolve('target/debug/lost-codex-theme.exe') } });
    await waitFor(async () => (await invoke('get_runtime_info')).windowVisible === false, 'Close hides editor');
    assert.equal(app.exitCode, null, 'Close must keep the editor process alive');
    assert.equal((await invoke('get_runtime_info')).trayAvailable, true);
    assert.deepEqual(await invoke('get_codex_status'), before, 'Close must not restore or disconnect Codex');
    assert.equal(await page.getByRole('dialog', { name: '退出主题编辑器？' }).count(), 0);
    await invoke('save_draft', { document: fixture });
    assert.equal((await invoke('load_draft')).theme.meta.id, 'native-smoke', 'Storage stays available while hidden');
  }
  await invoke('set_editor_dirty', { dirty: false });
  await invoke('request_editor_exit');
  await page.getByRole('dialog', { name: '退出主题编辑器？' }).waitFor();
  await page.getByRole('button', { name: '直接退出', exact: true }).click();
  const deadline = Date.now() + 10000;
  while (app.exitCode === null && Date.now() < deadline) await delay(100);
  assert.notEqual(app.exitCode, null, 'Editor must exit cleanly');
  await writeFile(resolve(root, 'result.json'), JSON.stringify({ passed: true, version: info.version, fonts: fonts.length, maximumSourceImageBytes: 10 * 1024 * 1024,
    scope: ['isolated Tauri/WebView2 startup', 'theme CRUD and rejected invalid writes', 'draft and preference IPC',
      'native image IPC, validation, upload and preview', 'system fonts', 'persistent tray icon',
      'cancelled image validation cannot write native assets or overwrite the current draft',
      'real isolated WM_CLOSE hides with clean or pending draft', 'hidden process and IPC remain alive',
      'shared tray/settings exit route reveals window and confirmation; cancel preserves process',
      'confirmed clean exit', 'all Codex mutation commands blocked'] }, null, 2));
  process.stdout.write(`Native smoke passed. Evidence: ${root}\n`);
} finally {
  await writeFile(resolve(root, 'process.log'), logs.join(''));
  if (browser) await browser.close().catch(() => undefined);
  if (app && app.exitCode === null) app.kill();
  if (vite.exitCode === null) vite.kill();
}
