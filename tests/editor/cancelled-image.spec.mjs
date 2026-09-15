import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';

test.setTimeout(30000);

async function pauseImageDecode(page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    const original = window.createImageBitmap.bind(window);
    window.imageGate = { waiting: false, finished: false };
    window.createImageBitmap = async (...args) => {
      const bitmap = await original(...args);
      window.imageGate.waiting = true;
      await new Promise(resolve => { window.imageGate.release = resolve; });
      window.imageGate.finished = true;
      return bitmap;
    };
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(png, 'base64');
}

async function assetCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('lost-codex-theme', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('assets').objectStore('assets').count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
    };
  }));
}

for (const action of ['preset', 'page', 'mode']) {
  test(`cancelled background upload cannot overwrite the editor after changing ${action}`, async ({ page }) => {
    await page.goto('http://127.0.0.1:1421');
    const png = await pauseImageDecode(page);
    await page.getByRole('button', { name: '背景', exact: true }).click();
    await page.getByRole('button', { name: '图片', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'delayed.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => page.evaluate(() => window.imageGate.waiting)).toBe(true);
    if (action === 'preset') await page.getByRole('region', { name: '内置主题预设' }).getByRole('button').last().click();
    if (action === 'page') {
      await page.getByRole('button', { name: '主题', exact: true }).click();
      await page.getByRole('button', { name: '新建主题', exact: true }).click();
    }
    if (action === 'mode') await page.getByRole('button', { name: '纯色', exact: true }).click();
    const background = page.frameLocator('iframe').locator('[data-lct-part="background"]');
    const before = await background.evaluate(el => getComputedStyle(el).backgroundImage);
    await page.evaluate(() => window.imageGate.release());
    await expect.poll(() => page.evaluate(() => window.imageGate.finished)).toBe(true);
    // Allow the resolved decoder's storage continuation and React work to settle.
    await page.waitForTimeout(300);
    expect(await assetCount(page)).toBe(0);
    await expect(background).toHaveCSS('background-image', before);
    await expect(page.getByText('背景图片已加入主题', { exact: true })).toHaveCount(0);
  });
}

test('leaving a pending import prevents late storage and document replacement', async ({ page }) => {
  await page.goto('http://127.0.0.1:1421');
  const png = await pauseImageDecode(page);
  const document = JSON.parse(await readFile('tests/fixtures/document.json', 'utf8'));
  document.theme.meta.name = 'Delayed import';
  document.theme.background.type = 'image';
  document.theme.background.image = 'delayed.png';
  const archive = zipSync({ 'theme.json': strToU8(JSON.stringify(document.theme)), 'delayed.png': png });
  await page.getByRole('button', { name: '导入与导出', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'theme.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await page.getByRole('button', { name: '导入主题', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.imageGate.waiting)).toBe(true);
  // Navigation remains mounted behind the modal; simulate its activation while IO is pending.
  await page.getByRole('button', { name: '整体', exact: true }).evaluate(el => el.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.imageGate.release());
  await expect.poll(() => page.evaluate(() => window.imageGate.finished)).toBe(true);
  await page.waitForTimeout(300);
  expect(await assetCount(page)).toBe(0);
  await expect(page.getByRole('button', { name: '我的第一个主题', exact: true })).toBeVisible();
  await expect(page.getByText('主题已导入，可以继续调整', { exact: true })).toHaveCount(0);
});
