import { test, expect } from '@playwright/test';

test('editor assets, theme editing, storage and export need no external requests', async ({ page, context }) => {
  test.setTimeout(30000);
  const external: string[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin === 'http://127.0.0.1:1421') return route.continue();
    external.push(url.href); return route.abort('internetdisconnected');
  });
  await page.goto('http://127.0.0.1:1421');
  await expect(page.getByRole('heading', { name: '整体', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('button', { name: '保存主题', exact: true }).click();
  await expect(page.getByText('主题已保存到我的主题', { exact: true })).toBeVisible();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('button', { name: '导入与导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出主题包', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(requests.some(url => /\.woff2(?:\?|$)/.test(url))).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
