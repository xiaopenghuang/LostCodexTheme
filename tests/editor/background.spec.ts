import { test, expect } from '@playwright/test';

test('wallpaper extends behind sidebar with undo, replacement and recovery', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:1421');
  const sidebar = page.frameLocator('iframe').locator('[data-lct-part="sidebar"]');
  const background = page.frameLocator('iframe').locator('[data-lct-part="background"]');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 800, 500);
    gradient.addColorStop(0, '#89402d'); gradient.addColorStop(0.5, '#334a50'); gradient.addColorStop(1, '#153e35');
    context.fillStyle = gradient; context.fillRect(0, 0, 800, 500);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(background).not.toHaveCSS('background-image', 'none');
  await expect(sidebar).toHaveCSS('background-color', 'rgba(34, 37, 34, 0)');
  await expect(page.getByRole('button', { name: '图片已覆盖侧栏', exact: true })).toBeDisabled();
  const bounds = await background.evaluate(element => {
    const image = element.getBoundingClientRect();
    const side = document.querySelector('[data-lct-part="sidebar"]')!.getBoundingClientRect();
    const main = document.querySelector('[data-lct-part="main"]')!.getBoundingClientRect();
    return { left: image.left, right: image.right, top: image.top, bottom: image.bottom,
      sideLeft: side.left, sideBottom: side.bottom, mainRight: main.right, viewport: innerWidth };
  });
  expect(bounds.left).toBeLessThanOrEqual(bounds.sideLeft);
  expect(bounds.right).toBeGreaterThanOrEqual(bounds.mainRight);
  expect(bounds.right).toBe(bounds.viewport);
  expect(bounds.top).toBe(0); expect(bounds.bottom).toBeGreaterThanOrEqual(bounds.sideBottom);
  await page.screenshot({ path: testInfo.outputPath('wallpaper-continuity.png'), fullPage: true });

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(sidebar).toHaveCSS('background-color', 'rgb(34, 37, 34)');
  await expect(background).toHaveCSS('background-image', 'none');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(sidebar).toHaveCSS('background-color', 'rgba(34, 37, 34, 0)');

  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await page.getByRole('slider', { name: '不透明度', exact: true }).press('End');
  await expect(sidebar).toHaveCSS('background-color', 'rgb(34, 37, 34)');
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await expect(sidebar).toHaveCSS('background-color', 'rgb(34, 37, 34)');
  await page.getByRole('button', { name: '让图片覆盖侧栏', exact: true }).click();
  await expect(sidebar).toHaveCSS('background-color', 'rgba(34, 37, 34, 0)');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(sidebar).toHaveCSS('background-color', 'rgb(34, 37, 34)');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(sidebar).toHaveCSS('background-color', 'rgba(34, 37, 34, 0)');
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(sidebar).toHaveCSS('background-color', 'rgba(34, 37, 34, 0)');
  await expect(background).not.toHaveCSS('background-image', 'none');
});
