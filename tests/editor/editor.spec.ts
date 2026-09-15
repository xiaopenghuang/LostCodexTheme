import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.goto('http://127.0.0.1:1421'); });

test('offline editor loads and global edits affect preview with undo', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '整体', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '连接 Codex', exact: true })).toBeDisabled();
  const composer = page.frameLocator('iframe').locator('[data-lct-part="composer"]');
  await expect(composer).toHaveCSS('border-radius', '18px');
  const radius = page.getByLabel('整体圆角', { exact: true }); await radius.focus(); await radius.press('End');
  await expect(composer).toHaveCSS('border-radius', '40px');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(composer).toHaveCSS('border-radius', '18px');
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('html')).toHaveCSS('color-scheme', 'light');
});

test('theme save, library load and draft recovery retain edits', async ({ page }) => {
  await page.getByRole('button', { name: '我的第一个主题', exact: true }).click();
  await page.getByRole('textbox', { name: '主题名称', exact: true }).fill('离线保存测试');
  await page.getByRole('textbox', { name: '主题名称', exact: true }).press('Enter');
  await page.getByRole('button', { name: '保存主题', exact: true }).click();
  await expect(page.getByText('主题已保存到我的主题', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '主题', exact: true }).click();
  await expect(page.getByRole('button', { name: /离线保存测试.*保存/ })).toBeVisible();
  await page.getByRole('button', { name: /离线保存测试.*保存/ }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('dialog')).toContainText('离线保存测试');
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '离线保存测试', exact: true })).toBeVisible();
});

test('native and Dream Skin packages round-trip through the visible workflow', async ({ page }) => {
  test.setTimeout(30000);
  await page.getByRole('button', { name: '代码块', exact: true }).click();
  await page.getByLabel('代码字号', { exact: true }).focus();
  await page.getByLabel('代码字号', { exact: true }).press('End');
  await page.getByRole('button', { name: '工作面板', exact: true }).click();
  for (const key of ['workspacePanel', 'summaryPanel', 'toolbarButtons']) {
    await page.getByRole('combobox', { name: '正在调整', exact: true }).selectOption(key);
    const input = page.getByRole('textbox', { name: '背景颜色', exact: true });
    await input.fill('#234567'); await input.press('Enter');
    await page.getByRole('slider', { name: '不透明度', exact: true }).focus();
    await page.getByRole('slider', { name: '不透明度', exact: true }).press('End');
  }
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('switch', { name: /高级主题编辑/ }).check();
  await page.getByLabel('自定义 CSS', { exact: true }).fill('[data-lct-part="composer"] { border-width: 3px !important; }');
  await page.getByRole('button', { name: '导入与导出', exact: true }).click();
  for (const format of ['原生主题包', 'Dream Skin']) {
    await page.getByRole('button', { name: format, exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出主题包', exact: true }).click();
    const item = await download; const path = await item.path();
    const buffer = await readFile(path!);
    await page.locator('input[type=file]').setInputFiles({ name: 'roundtrip.zip', mimeType: 'application/zip', buffer });
    await expect(page.getByRole('dialog')).toContainText('我的第一个主题');
    await page.getByRole('dialog').getByRole('button', { name: /^(导入主题|信任并导入)$/ }).click();
    await expect(page.getByRole('heading', { name: '整体', exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe').locator('[data-lct-part="composer"]')).toHaveCSS('border-top-width', '3px');
    await expect(page.frameLocator('iframe').locator('[data-lct-part="code-block"]')).toHaveCSS('font-size', '24px');
    for (const part of ['workspace-panel', 'summary-panel', 'toolbar-button']) {
      await expect(page.frameLocator('iframe').locator(`[data-lct-part="${part}"]`)).toHaveCSS('background-color', 'rgb(35, 69, 103)');
    }
    await page.getByRole('button', { name: '导入与导出', exact: true }).click();
  }
});

test('desktop and narrow layouts do not overflow the window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: '整体', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  for (const width of [1000, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '输入框', exact: true }).click();
    await expect(page.getByRole('heading', { name: '输入框', exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/editor-narrow.png', fullPage: true });
});
