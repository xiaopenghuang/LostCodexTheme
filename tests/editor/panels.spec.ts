import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('http://127.0.0.1:1421'); });

async function color(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(value); await input.press('Enter');
}

async function maximum(page: Page, label: string) {
  const input = page.getByRole('slider', { name: label, exact: true });
  await input.focus(); await input.press('End');
}

test('new theme has independent identity and preserves saved work', async ({ page }) => {
  const composer = page.frameLocator('iframe').locator('[data-lct-part="composer"]');
  await maximum(page, '整体圆角');
  await page.getByRole('button', { name: '保存主题', exact: true }).click();
  await expect(page.getByText('主题已保存到我的主题', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '主题', exact: true }).click();
  await page.getByRole('button', { name: '新建主题', exact: true }).click();
  await expect(page.getByRole('button', { name: '未命名主题', exact: true })).toBeVisible();
  await expect(composer).toHaveCSS('border-radius', '18px');
  await page.getByRole('button', { name: '保存主题', exact: true }).click();
  await page.getByRole('button', { name: '主题', exact: true }).click();
  await expect(page.getByRole('button', { name: /未命名主题.*保存/ })).toBeVisible();
  await page.getByRole('button', { name: /我的第一个主题.*保存/ }).click();
  await expect(composer).toHaveCSS('border-radius', '40px');
  await expect(page.getByRole('button', { name: '我的第一个主题', exact: true })).toBeVisible();
});

const surfaces = [
  { section: '侧栏', part: 'sidebar' },
  { section: '输入框', part: 'composer' },
  { section: '消息', role: '我的消息', part: 'user-message', other: 'assistant-message', otherRadius: '0px' },
  { section: '消息', role: 'Codex 回复', part: 'assistant-message', other: 'user-message', otherRadius: '16px' },
  { section: '代码块', part: 'code-block' },
];

for (const surface of surfaces) {
  test(`${surface.part} controls affect only the chosen surface and survive draft recovery`, async ({ page }) => {
    test.setTimeout(30000);
    await page.getByRole('button', { name: surface.section, exact: true }).click();
    if (surface.role) await page.getByRole('button', { name: surface.role, exact: true }).click();
    const target = page.frameLocator('iframe').locator(`[data-lct-part="${surface.part}"]`);
    await color(page, '背景颜色', '#123456');
    await maximum(page, '不透明度');
    await expect(target).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await maximum(page, '背景模糊');
    await expect(target).toHaveCSS('backdrop-filter', 'blur(40px)');
    await maximum(page, '圆角');
    await expect(target).toHaveCSS('border-radius', '40px');
    await maximum(page, '边框粗细');
    await color(page, '边框颜色', '#abcdef');
    await expect(target).toHaveCSS('border-top-width', '4px');
    await expect(target).toHaveCSS('border-top-color', 'rgb(171, 205, 239)');
    await page.getByRole('switch', { name: '柔和阴影', exact: true }).check();
    await expect(target).not.toHaveCSS('box-shadow', 'none');
    await page.getByRole('switch', { name: '柔和阴影', exact: true }).uncheck();
    await expect(target).toHaveCSS('box-shadow', 'none');

    if (surface.part === 'sidebar') {
      await maximum(page, '预览侧栏宽度');
      await expect(target).toHaveCSS('width', '360px');
    } else if (surface.part === 'composer') {
      await maximum(page, '内部留白');
      await expect(target).toHaveCSS('padding-top', '32px');
    } else if (surface.other) {
      await color(page, '文字颜色', '#fedcba');
      await maximum(page, '消息间距');
      await page.getByRole('slider', { name: '最大宽度', exact: true }).press('Home');
      await expect(target).toHaveCSS('color', 'rgb(254, 220, 186)');
      await expect(target).toHaveCSS('margin-top', '24px');
      await expect(target).toHaveCSS('max-width', '40%');
      await expect(page.frameLocator('iframe').locator(`[data-lct-part="${surface.other}"]`))
        .toHaveCSS('border-radius', surface.otherRadius!);
    } else {
      await maximum(page, '代码字号');
      await expect(target).toHaveCSS('font-size', '24px');
      await expect(target.locator('code')).toHaveCSS('font-size', '24px');
    }
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
    await expect(target).toHaveCSS('border-radius', '40px');
    await expect(target).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  });
}

test('background gradient and font settings drive computed preview styles', async ({ page }) => {
  const preview = page.frameLocator('iframe');
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '渐变', exact: true }).click();
  await color(page, '起始颜色', '#123456');
  await color(page, '结束颜色', '#abcdef');
  await maximum(page, '渐变方向');
  await expect(preview.locator('[data-lct-part="background"]')).toHaveCSS('background-image',
    'linear-gradient(360deg, rgb(18, 52, 86), rgb(171, 205, 239))');
  await maximum(page, '模糊');
  await expect(preview.locator('[data-lct-part="background"]')).toHaveCSS('filter', 'blur(40px)');
  await page.getByRole('button', { name: '字体', exact: true }).click();
  await maximum(page, '界面字号');
  await maximum(page, '文字粗细');
  await maximum(page, '行高');
  const root = preview.locator('[data-lct-part="root"]');
  await expect(root).toHaveCSS('font-size', '24px');
  await expect(root).toHaveCSS('font-weight', '700');
  await expect(root).toHaveCSS('line-height', '52.8px');
  await maximum(page, '代码字号');
  await expect(preview.locator('[data-lct-part="code-block"]')).toHaveCSS('font-size', '24px');
});
