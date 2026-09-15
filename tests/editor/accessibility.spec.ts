import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('editor chrome has accessible controls and readable default text', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:1421');
  await page.getByRole('heading', { name: '整体', exact: true }).waitFor();
  for (const section of ['整体', '背景', '输入框', '消息', '代码块', '字体', '主题', '导入与导出', '设置']) {
    await page.getByRole('button', { name: section === '设置' ? /^设置/ : section, exact: section !== '设置' }).click();
    const result = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations.map(violation => ({ section, id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  }
});
