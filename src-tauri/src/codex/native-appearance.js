(async function (request) {
  const stateKey = Symbol.for('lostcodextheme.bridge');
  const state = window[stateKey];
  const root = document.body;
  const query = Array.from(new URLSearchParams(location.search)).map(([key, value]) => `${key}=${value}`).join('&');
  const route = `${location.pathname} ${query} ${location.hash}`.toLowerCase();
  const profile = request.profile;
  const mode = root ? getComputedStyle(root).colorScheme : '';
  const current = () => window[stateKey] === state && state?.style?.isConnected
    && root?.getAttribute('data-lct-part') === 'root' && getComputedStyle(root).colorScheme === mode;
  const matchesNative = () => matchMedia('(prefers-color-scheme: dark)').matches === (mode === 'dark');
  if (location.protocol !== 'app:' || !profile.hosts.includes(location.hostname)
    || !['/', '/index.html'].includes(location.pathname)
    || profile.excluded.some(word => route.includes(word))
    || document.documentElement.dataset.codexOs !== 'win32'
    || !['dark', 'light'].includes(mode) || !current()) {
    return { synced: false, reason: 'unverified-renderer' };
  }
  if (request.action === 'verify') {
    return { synced: state.nativeAppearance === mode && matchesNative(), mode };
  }
  if (request.action !== 'sync') return { synced: false, reason: 'unknown-action' };
  if (typeof window.electronBridge?.sendMessageFromView !== 'function') {
    return { synced: false, reason: 'settings-bridge-unavailable' };
  }
  if (state.nativeAppearancePending) return { synced: false, reason: 'sync-in-progress' };
  state.nativeAppearancePending = true;
  const deadline = performance.now() + 1500;

  // This is an explicitly authorized, persistent Codex preference, not an
  // injected style. Never accept arbitrary endpoints, keys or values here.
  function setting(write) {
    if (!current()) return Promise.reject(new Error('renderer-changed'));
    const remaining = deadline - performance.now();
    if (remaining <= 0) return Promise.reject(new Error('settings-timeout'));
    const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
    const requestId = `lostcodextheme-appearance-${nonce}`;
    const operation = write ? 'set-setting' : 'get-setting';
    const body = { key: 'appearanceTheme', ...(write ? { value: mode } : {}) };
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (error) reject(new Error(error)); else resolve(value);
      };
      const onMessage = event => {
        if (event.source !== null && event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== 'fetch-response' || data.requestId !== requestId) return;
        if (data.responseType !== 'success' || data.status !== 200) { finish('settings-rejected'); return; }
        if (typeof data.bodyJsonString !== 'string' || data.bodyJsonString.length > 2048) { finish('invalid-response'); return; }
        try { finish(null, JSON.parse(data.bodyJsonString)); } catch { finish('invalid-response'); }
      };
      const timer = setTimeout(() => finish('settings-timeout'), remaining);
      window.addEventListener('message', onMessage);
      try {
        Promise.resolve(window.electronBridge.sendMessageFromView({
          type: 'fetch', requestId, method: 'POST', url: `vscode://codex/${operation}`,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })).catch(() => finish('settings-send-failed'));
      } catch { finish('settings-send-failed'); }
    });
  }
  const readMode = async () => {
    const result = await setting(false);
    const value = result?.value;
    if (!['system', 'dark', 'light'].includes(value)) throw new Error('invalid-appearance');
    return value;
  };
  try {
    if (await readMode() !== mode) {
      const result = await setting(true);
      if (result?.success !== true) throw new Error('settings-write-failed');
    }
    if (await readMode() !== mode) throw new Error('settings-readback-mismatch');
    while (current() && !matchesNative() && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!current()) throw new Error('renderer-changed');
    if (!matchesNative()) throw new Error('native-palette-mismatch');
    state.nativeAppearance = mode;
    return { synced: true, mode };
  } catch (error) {
    return { synced: false, reason: error.message };
  } finally {
    delete state.nativeAppearancePending;
  }
})
