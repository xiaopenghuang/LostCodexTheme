import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { buildCss } from '../../src/theme/css-generator';
import { newDocument } from '../../src/theme/defaults';
import { patchTheme } from '../../src/theme/history';

const example = resolve('target/debug/examples/codex_poc.exe');
const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
const fixture = `<!doctype html><html data-theme="light"><head><style>
  :root, [data-theme] {
    --color-text: #111111; --color-text-secondary: #555555; --color-token-text-primary: #111111;
    --color-token-text-secondary: #555555; --color-surface-secondary: #ffffff;
    --color-background-composer-action-bar: #ffffff; --color-text-warning: #d97706;
  }
  body { margin:0; min-height:700px; display:flex; }
  aside { min-height:600px; } main { flex:1; padding:32px; }
  .native-title, .native-editor, .message-copy { color:var(--color-text); }
  .native-secondary { color:var(--color-token-text-secondary); }
  .native-primary { color:var(--color-token-text-primary); }
  ._ComposerLayoutRoot_test { --composer-layout-surface-background:#ffffff; --composer-editor-placeholder-opacity:0.2; }
  ._ComposerLayoutBody_test { background-color:var(--composer-layout-surface-background); min-height:100px; }
  .native-editor { min-height:45px; } .placeholder::after { content:'Type a message'; opacity:var(--composer-editor-placeholder-opacity); }
  .utility { background-color:var(--color-background-composer-action-bar); }
  .native-warning { color:var(--color-text-warning); } .syntax { color:#a755ee; }
  .popup { background-color:var(--color-surface-secondary); color:var(--color-text); }
</style></head><body>
<aside class="app-shell-left-panel"><p class="native-primary">Workspace</p><p class="native-secondary">Recent tasks</p></aside>
<main data-app-shell-main-surface><section data-theme="light"><h1 class="native-title">What shall we build?</h1>
<div class="utility native-primary">Project folder</div>
<div class="_ComposerLayoutRoot_test" data-composer-surface-variant="opaque" data-composer-radius-variant="default">
<div class="_ComposerLayoutBody_test"><div class="native-editor ProseMirror" contenteditable="true"><p class="placeholder"></p></div>
<span class="native-warning">Permission warning</span></div></div>
<pre><code><span class="syntax">const</span> example = true;</code></pre>
<div data-message-author-role="user"><div data-theme="light" class="message-copy">User message</div></div>
<div data-message-author-role="assistant"><div data-theme="light" class="message-copy">Assistant message</div></div>
<div role="dialog" class="popup">Menu content</div></section></main></body></html>`;

async function invoke(page: import('@playwright/test').Page, action: string, css: string) {
  return page.evaluate(({ action, css, contract }) => {
    const execute = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return execute({ action, css, profile: contract.profile });
  }, { action, css, contract });
}

for (const mode of ['dark', 'light'] as const) {
  test(`native ${mode} palette reaches nested theme scopes without erasing semantic colors`, async ({ page }, testInfo) => {
    let document = newDocument();
    if (mode === 'light') document = patchTheme('global', { appearance: 'light' })(document);
    document = patchTheme('userMessage', { textColor: '#eeccaa' })(document);
    document = patchTheme('assistantMessage', { textColor: '#aabbdd' })(document);
    const base = buildCss(document.theme);
    const css = execFileSync(example, ['render-css'], { input: base, encoding: 'utf8' });
    await page.setContent(fixture);
    // Reproduce the old failure: changing only the body foreground is insufficient.
    await invoke(page, 'apply', base);
    await expect(page.locator('.native-title')).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(page.locator('._ComposerLayoutBody_test')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await invoke(page, 'apply', css);
    const foreground = mode === 'dark' ? 'rgb(230, 232, 229)' : 'rgb(40, 53, 43)';
    const surface = mode === 'dark' ? 'rgb(40, 44, 41)' : 'rgb(251, 252, 249)';
    await expect(page.locator('.native-title')).toHaveCSS('color', foreground);
    await expect(page.locator('aside .native-primary')).toHaveCSS('color', foreground);
    await expect(page.locator('.native-editor')).toHaveCSS('color', foreground);
    await expect(page.locator('[data-message-author-role="user"] .message-copy')).toHaveCSS('color', 'rgb(238, 204, 170)');
    await expect(page.locator('[data-message-author-role="assistant"] .message-copy')).toHaveCSS('color', 'rgb(170, 187, 221)');
    await expect(page.locator('._ComposerLayoutRoot_test')).toHaveCSS('background-color', surface);
    await expect(page.locator('._ComposerLayoutBody_test')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.utility')).toHaveCSS('background-color', surface);
    await expect(page.locator('.popup')).toHaveCSS('background-color', surface);
    expect(await page.locator('.placeholder').evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0.75');
    await expect(page.locator('.native-warning')).toHaveCSS('color', 'rgb(217, 119, 6)');
    await expect(page.locator('.syntax')).toHaveCSS('color', 'rgb(167, 85, 238)');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect((await invoke(page, 'verify', css)).applied).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`native-${mode}-palette.png`) });
    const custom = execFileSync(example, ['render-css'], { input: `${base}\n.native-title { color:#abcdef !important; }`, encoding: 'utf8' });
    await invoke(page, 'apply', custom);
    await expect(page.locator('.native-title')).toHaveCSS('color', 'rgb(171, 205, 239)');
    expect((await invoke(page, 'restore', '')).restored).toBe(true);
    await expect(page.locator('.native-title')).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(page.locator('._ComposerLayoutBody_test')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.native-warning')).toHaveCSS('color', 'rgb(217, 119, 6)');
  });
}
