import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { buildCss } from '../../src/theme/css-generator';
import { newDocument } from '../../src/theme/defaults';

test('native sidebar frame follows dragging and zoom without hiding controls or overwriting native state', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const example = resolve('target/debug/examples/codex_poc.exe');
  const contract = JSON.parse(execFileSync(example, ['contract'], { encoding: 'utf8' }));
  const document = newDocument(); document.theme.sidebar.borderWidth = 4;
  document.theme.sidebar.blur = 16;
  document.theme.sidebar.radius = 20; document.theme.sidebar.shadow = true;
  const render = () => execFileSync(example, ['render-css'], { input: buildCss(document.theme), encoding: 'utf8' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(`<!doctype html><html style="--codex-sidebar-preferred-width:275px"><head><style>
    *{box-sizing:border-box}html,body{margin:0;height:100%}
    :root{--spacing-token-sidebar:clamp(240px,var(--codex-sidebar-preferred-width,275px),min(520px,calc(100vw - 320px)))}
    .shell{--app-shell-left-panel-width:var(--app-shell-animated-left-panel-width);display:flex;height:650px;position:relative}
    .shell[data-app-shell-responsive-sidebar=true]{--app-shell-left-panel-width:0px}
    .shell[data-app-shell-responsive-sidebar=true] aside{display:none}
    aside{position:relative;flex-shrink:0;width:var(--app-shell-left-panel-width);padding-top:56px;overflow:visible}
    .contents{height:100%;max-width:100%;overflow:hidden;display:flex;flex-direction:column}
    .slot{position:absolute;top:0;left:0;width:var(--app-shell-left-panel-width);height:52px;display:flex;justify-content:flex-end;gap:4px;padding:8px;z-index:30}
    button{color:inherit;border:0;background:#77887744;cursor:pointer;border-radius:8px}
    .slot button,#help{width:30px;height:30px;flex-shrink:0}
    #task{margin:8px;width:calc(var(--spacing-token-sidebar) - 16px);height:32px;text-align:left;padding:6px}
    footer{margin-top:auto;display:flex;justify-content:flex-end;padding:8px}
    #handle{position:absolute;right:-4px;top:56px;width:8px;height:500px;z-index:40;cursor:col-resize;touch-action:none}
    main{position:relative;flex:1;min-width:0;background:#ddd;padding:24px}
    .composer-surface-chrome{min-height:70px}
  </style></head><body><div class="shell" style="--app-shell-animated-left-panel-width:275px">
  <header class="slot app-header-tint"><button id="search">S</button><button id="bell">B</button></header>
  <aside class="app-shell-left-panel"><div class="contents" style="width:275px;min-width:275px"><button id="task">Conversation</button><footer><button id="help">?</button></footer></div><div id="handle"></div></aside>
  <main data-app-shell-main-surface>Main content<div class="composer-surface-chrome">Composer</div></main></div></body></html>`);
  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.shell')!;
    const contents = document.querySelector<HTMLElement>('.contents')!;
    let dragging = false;
    document.querySelector('#handle')!.addEventListener('pointerdown', event => {
      dragging = true; (event.target as HTMLElement).setPointerCapture((event as PointerEvent).pointerId);
    });
    window.addEventListener('pointermove', event => {
      if (!dragging) return;
      const zoom = Number.parseFloat(getComputedStyle(shell).zoom) || 1;
      const width = Math.max(240, Math.min(520, Math.round(event.clientX / zoom)));
      // Mirrors the native shared shell state, not a theme-owned override.
      document.documentElement.style.setProperty('--codex-sidebar-preferred-width', `${width}px`);
      shell.style.setProperty('--app-shell-animated-left-panel-width', `${width}px`);
      contents.style.width = `${width}px`; contents.style.minWidth = `${width}px`;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
    for (const id of ['search', 'bell', 'help', 'task']) {
      document.getElementById(id)!.addEventListener('click', event => (event.currentTarget as HTMLElement).dataset.clicked = 'true');
    }
  });
  const invoke = (action: string, css: string) => page.evaluate(({ action, css, contract }) => {
    const run = new Function('location', `return ${contract.bridge}`)({ protocol: 'app:', hostname: '-', pathname: '/index.html', search: '', hash: '' });
    return run({ action, css, profile: contract.profile });
  }, { action, css, contract });
  // Reproduce the old parent/child width mismatch with generated CSS alone.
  await invoke('apply', buildCss(document.theme));
  expect(await page.locator('#task').evaluate(el => el.getBoundingClientRect().right > document.querySelector('aside')!.getBoundingClientRect().right)).toBe(true);
  await invoke('apply', render());
  await expect(page.locator('aside')).toHaveCSS('width', '275px');
  await expect(page.locator('aside')).toHaveCSS('border-right-width', '0px');
  expect(await page.locator('aside').evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
  for (const zoom of [1, 0.8, 1.25]) {
    await page.locator('.shell').evaluate((el, value) => (el as HTMLElement).style.zoom = String(value), zoom);
    for (const width of [240, 360, 500]) {
      const handle = (await page.locator('#handle').boundingBox())!;
      expect(await page.locator('#handle').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + 100) === el;
      })).toBe(true);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
      await page.mouse.down(); await page.mouse.move(width * zoom, handle.y + 100, { steps: 6 }); await page.mouse.up();
      await expect(page.locator('aside')).toHaveCSS('width', `${width}px`);
      const geometry = await page.locator('aside').evaluate(el => {
        const panel = el.getBoundingClientRect();
        const right = document.querySelector('main')!.getBoundingClientRect().left;
        const header = document.querySelector('.slot')!.getBoundingClientRect().right;
        const controls = ['search', 'bell', 'help', 'task'].map(id => {
          const node = document.getElementById(id)!; const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { contained: box.left >= panel.left && box.right <= panel.right + 0.5, hit: hit === node || node.contains(hit) };
        });
        return { edgeDifference: Math.abs(panel.right - right), headerDifference: Math.abs(panel.right - header), controls };
      });
      expect(geometry.edgeDifference).toBeLessThan(0.6); expect(geometry.headerDifference).toBeLessThan(0.6);
      expect(geometry.controls.every(control => control.contained && control.hit)).toBe(true);
    }
  }
  await page.locator('.shell').evaluate(el => (el as HTMLElement).style.zoom = '1');
  for (const id of ['search', 'bell', 'help', 'task']) {
    await page.locator(`#${id}`).click(); await expect(page.locator(`#${id}`)).toHaveAttribute('data-clicked', 'true');
  }
  document.theme.sidebar.width = 180;
  await invoke('apply', render()); await expect(page.locator('aside')).toHaveCSS('width', '500px');
  await page.screenshot({ path: testInfo.outputPath('native-sidebar-alignment.png') });
  await page.locator('.shell').evaluate(el => el.setAttribute('data-app-shell-responsive-sidebar', 'true'));
  await expect(page.locator('aside')).toBeHidden();
  expect((await invoke('verify', render())).applied).toBe(true);
  await page.locator('.shell').evaluate(el => el.removeAttribute('data-app-shell-responsive-sidebar'));
  await expect(page.locator('aside')).toHaveCSS('width', '500px');
  expect((await invoke('restore', '')).restored).toBe(true);
  await expect(page.locator('aside')).toHaveCSS('width', '500px');
  expect(await page.locator('html').evaluate(el => (el as HTMLElement).style.getPropertyValue('--codex-sidebar-preferred-width'))).toBe('500px');
});
