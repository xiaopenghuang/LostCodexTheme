import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { largePng } from '../fixtures/large-png.mjs';
import { readArchive } from '../../src/theme/archive';

test('10 MiB image displays as a bounded copy and exports the untouched original', async ({ page }) => {
  test.setTimeout(60000);
  const original = largePng();
  await page.goto('http://127.0.0.1:1421');
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'maximum.png', mimeType: 'image/png', buffer: original });
  const background = page.frameLocator('iframe').locator('[data-lct-part="background"]');
  await expect(background).not.toHaveCSS('background-image', 'none');
  const size = await background.evaluate(async element => {
    const url = getComputedStyle(element).backgroundImage.slice(5, -2);
    const image = new Image(); image.src = url; await image.decode();
    return { bytes: url.length, width: image.naturalWidth };
  });
  expect(size.bytes).toBeLessThan(1024 * 1024); expect(size.width).toBe(2);
  await page.getByRole('button', { name: '保存主题', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(background).not.toHaveCSS('background-image', 'none');
  await page.getByRole('button', { name: '导入与导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出主题包', exact: true }).click();
  const path = await (await download).path();
  const archive = await readArchive(await readFile(path!));
  const exportedImage = [...archive].find(([name]) => name.endsWith('.png'))![1];
  expect(Buffer.compare(Buffer.from(exportedImage), original)).toBe(0);
});
