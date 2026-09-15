import { test, expect } from '@playwright/test';

for (const [key, part] of [['workspacePanel', 'workspace-panel'], ['summaryPanel', 'summary-panel'], ['toolbarButtons', 'toolbar-button']]) {
  test(`${key} edits preview independently and survives save, undo and draft recovery`, async ({ page }, testInfo) => {
    await page.goto('http://127.0.0.1:1421');
    await page.getByRole('button', { name: '工作面板', exact: true }).click();
    await page.getByRole('combobox', { name: '正在调整', exact: true }).selectOption(key);
    const target = page.frameLocator('iframe').locator(`[data-lct-part="${part}"]`);
    await expect(target).toBeVisible();
    const composer = page.frameLocator('iframe').locator('[data-lct-part="composer"]');
    const before = await composer.evaluate(el => getComputedStyle(el).backgroundColor);
    const color = page.getByRole('textbox', { name: '背景颜色', exact: true });
    await color.fill('#123456'); await color.press('Enter');
    await page.getByRole('slider', { name: '不透明度', exact: true }).focus();
    await page.getByRole('slider', { name: '不透明度', exact: true }).press('End');
    await expect(target).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await page.getByRole('textbox', { name: '文字颜色', exact: true }).fill('#fedcba');
    await page.getByRole('textbox', { name: '文字颜色', exact: true }).press('Enter');
    await expect(target).toHaveCSS('color', 'rgb(254, 220, 186)');
    await expect(composer).toHaveCSS('background-color', before);
    await page.getByRole('button', { name: /撤销/ }).first().click();
    await expect(target).not.toHaveCSS('color', 'rgb(254, 220, 186)');
    await page.getByRole('button', { name: /重做/ }).first().click();
    await expect(target).toHaveCSS('color', 'rgb(254, 220, 186)');
    await page.screenshot({ path: testInfo.outputPath(`${key}-editor.png`) });
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
    await page.getByRole('button', { name: '工作面板', exact: true }).click();
    await expect(target).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await expect(target).toHaveCSS('color', 'rgb(254, 220, 186)');
    await page.getByRole('button', { name: '保存主题', exact: true }).click();
    await expect(page.getByText('主题已保存到我的主题', { exact: true })).toBeVisible();
  });
}
