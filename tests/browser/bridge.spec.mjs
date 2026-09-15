import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const contract = JSON.parse(execFileSync(resolve('target/debug/examples/codex_poc.exe'), ['contract'], { encoding: 'utf8' }));
const location = { protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' };
const fixture = `<!doctype html><html><head><style>
  main, aside, .composer-surface-chrome { display:block; width:200px; min-height:60px; }
</style></head><body><aside class="app-shell-left-panel">Sidebar</aside>
<main data-app-shell-main-surface><div class="composer-surface-chrome" data-lct-part="previous">Composer</div>
<div data-message-author-role="user">User</div><div data-message-author-role="assistant">Assistant</div>
<pre><code>const example = true;</code></pre></main></body></html>`;

async function bridge(page, action, overrides = {}) {
  return page.evaluate(({ contract, action, location, overrides }) => {
    // Inject a location binding in the test harness only. Production receives the real app URL.
    const execute = new Function('location', `return ${contract.bridge}`)(location);
    return execute({ action, profile: contract.profile, css: contract.testCss, ...overrides });
  }, { contract, action, location, overrides });
}

test.beforeEach(async ({ page }) => { await page.setContent(fixture); });

test('repeated apply updates one style and computes the test outline', async ({ page }) => {
  expect((await bridge(page, 'probe')).compatible).toBe(true);
  await bridge(page, 'apply');
  await page.evaluate(() => { window.originalStyle = document.getElementById('lostcodextheme-theme'); });
  await bridge(page, 'apply');
  await expect(page.locator('#lostcodextheme-theme')).toHaveCount(1);
  expect(await page.evaluate(() => window.originalStyle === document.getElementById('lostcodextheme-theme'))).toBe(true);
  const evidence = await bridge(page, 'verify');
  expect(evidence.applied).toBe(true);
  expect(evidence.testOutline).toBe(true);
});

test('reapply reconnects owned layers removed during a document rebuild', async ({ page }) => {
  await bridge(page, 'apply');
  await page.evaluate(() => {
    document.getElementById('lostcodextheme-theme').remove();
    document.getElementById('lostcodextheme-background').remove();
  });
  expect((await bridge(page, 'verify')).applied).toBe(false);
  await bridge(page, 'apply');
  expect((await bridge(page, 'verify')).applied).toBe(true);
  await expect(page.locator('#lostcodextheme-theme')).toHaveCount(1);
  await expect(page.locator('#lostcodextheme-background')).toHaveCount(1);
  expect((await bridge(page, 'restore')).restored).toBe(true);
});

test('reapply rejects replacement layers owned by another caller', async ({ page }) => {
  await bridge(page, 'apply');
  await page.evaluate(() => {
    const owned = document.getElementById('lostcodextheme-background');
    const foreign = document.createElement('div');
    foreign.id = owned.id;
    foreign.textContent = 'Foreign background';
    owned.replaceWith(foreign);
  });
  await expect(bridge(page, 'apply')).rejects.toThrow('ownership collision');
  await expect(page.locator('#lostcodextheme-background')).toHaveText('Foreign background');
  await bridge(page, 'restore');
  await expect(page.locator('#lostcodextheme-background')).toHaveText('Foreign background');
});

test('observer tracks selector attributes added and removed without a class change', async ({ page }) => {
  await page.locator('main').evaluate(el => {
    el.insertAdjacentHTML('beforeend', '<div id="late-message">Assistant</div><aside id="late-panel"></aside>');
  });
  await bridge(page, 'apply');
  await page.evaluate(() => {
    document.getElementById('late-message').setAttribute('data-local-conversation-final-assistant', '');
    document.getElementById('late-panel').setAttribute('data-app-shell-focus-area', 'right-panel');
  });
  await expect(page.locator('#late-message')).toHaveAttribute('data-lct-part', 'assistant-message');
  await expect(page.locator('#late-panel')).toHaveAttribute('data-lct-part', 'workspace-shell');
  await page.evaluate(() => {
    document.getElementById('late-message').removeAttribute('data-local-conversation-final-assistant');
    document.getElementById('late-panel').removeAttribute('data-app-shell-focus-area');
  });
  await expect(page.locator('#late-message')).not.toHaveAttribute('data-lct-part');
  await expect(page.locator('#late-panel')).not.toHaveAttribute('data-lct-part');
  await bridge(page, 'restore');
});

test('soft restore removes only owned objects and restores previous marker values', async ({ page }) => {
  await page.evaluate(() => {
    const style = document.createElement('style'); style.id = 'another-theme'; document.head.append(style);
  });
  await bridge(page, 'apply');
  expect((await bridge(page, 'restore')).restored).toBe(true);
  await expect(page.locator('#lostcodextheme-theme')).toHaveCount(0);
  await expect(page.locator('#another-theme')).toHaveCount(1);
  await expect(page.locator('[data-lct-part]')).toHaveCount(1);
  await expect(page.locator('.composer-surface-chrome')).toHaveAttribute('data-lct-part', 'previous');
  expect((await bridge(page, 'restore')).restored).toBe(true);
});

test('observer maps replacement elements and is disconnected on restore', async ({ page }) => {
  await bridge(page, 'apply');
  await page.evaluate(() => {
    document.querySelector('.composer-surface-chrome').outerHTML = '<div class="composer-surface-chrome">Replacement</div>';
  });
  await expect(page.locator('.composer-surface-chrome')).toHaveAttribute('data-lct-part', 'composer');
  await bridge(page, 'restore');
  await page.evaluate(() => { document.querySelector('.composer-surface-chrome').className += ' updated'; });
  await page.waitForTimeout(100);
  await expect(page.locator('[data-lct-part]')).toHaveCount(0);
});

test('unrecognized profile refuses injection without DOM changes', async ({ page }) => {
  const profile = { ...contract.profile, hosts: ['unrecognized'] };
  await expect(bridge(page, 'apply', { profile })).rejects.toThrow('Unverified renderer');
  await expect(page.locator('#lostcodextheme-theme')).toHaveCount(0);
  await expect(page.locator('[data-lct-part]')).toHaveCount(1);
});

for (const id of ['lostcodextheme-theme', 'lostcodextheme-caption-backdrop']) {
test(`${id} ownership collisions fail closed`, async ({ page }) => {
  await page.evaluate(id => {
    const style = document.createElement('style'); style.id = id;
    style.textContent = 'body { color: red; }'; document.head.append(style);
  }, id);
  await expect(bridge(page, 'apply')).rejects.toThrow('ownership collision');
  expect(await page.locator(`#${id}`).textContent()).toBe('body { color: red; }');
});
}

test('message mapping moves from fallback to the native bubble when content mounts', async ({ page }) => {
  await page.locator('[data-message-author-role="user"]').evaluate(el => {
    el.setAttribute('data-local-conversation-user-anchor', 'true');
  });
  await bridge(page, 'apply');
  const row = page.locator('[data-message-author-role="user"]');
  await expect(row).toHaveAttribute('data-lct-part', 'user-message');
  await row.evaluate(el => { el.innerHTML = '<div class="bg-user-message">Mounted message</div><button>Copy</button>'; });
  await expect(row).not.toHaveAttribute('data-lct-part');
  await expect(page.locator('.bg-user-message')).toHaveAttribute('data-lct-part', 'user-message');
  await expect(page.locator('[data-lct-part="user-message"]')).toHaveCount(1);
  await page.locator('.bg-user-message').evaluate(el => el.classList.remove('bg-user-message'));
  await expect(row).toHaveAttribute('data-lct-part', 'user-message');
  await expect(page.locator('[data-lct-part="user-message"]')).toHaveCount(1);
  await bridge(page, 'restore');
  await expect(row).not.toHaveAttribute('data-lct-part');
});

test('upgrading removes the owned legacy caption backdrop and its event listeners', async ({ page }) => {
  await bridge(page, 'apply');
  await page.evaluate(() => {
    const state = window[Symbol.for('lostcodextheme.bridge')];
    state.caption = document.createElement('div');
    state.caption.id = 'lostcodextheme-caption-backdrop';
    state.caption.style.backgroundColor = '#f9f9f9';
    document.body.append(state.caption);
    state.overlay = new EventTarget();
    window.legacyOverlay = state.overlay;
    window.legacyCaptionCalls = 0;
    state.updateCaption = () => window.legacyCaptionCalls++;
    window.addEventListener('resize', state.updateCaption);
    state.overlay.addEventListener('geometrychange', state.updateCaption);
  });
  await expect(page.locator('#lostcodextheme-caption-backdrop')).toHaveCount(1);
  await bridge(page, 'apply');
  await expect(page.locator('#lostcodextheme-caption-backdrop')).toHaveCount(0);
  expect(await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.legacyOverlay.dispatchEvent(new Event('geometrychange'));
    return window.legacyCaptionCalls;
  })).toBe(0);
  expect((await bridge(page, 'verify')).applied).toBe(true);
  await bridge(page, 'restore');
  await expect(page.locator('#lostcodextheme-caption-backdrop')).toHaveCount(0);
});

test('losing all key anchors automatically removes the theme', async ({ page }) => {
  await bridge(page, 'apply');
  await page.evaluate(() => {
    document.querySelector('aside').remove(); document.querySelector('.composer-surface-chrome').remove();
  });
  await expect(page.locator('#lostcodextheme-theme')).toHaveCount(0);
});

test('restore preserves marker edits made by another owner after apply', async ({ page }) => {
  await bridge(page, 'apply');
  await page.locator('aside').evaluate(el => el.setAttribute('data-lct-part', 'new-owner'));
  await bridge(page, 'restore');
  await expect(page.locator('aside')).toHaveAttribute('data-lct-part', 'new-owner');
});
