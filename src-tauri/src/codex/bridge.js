(function (request) {
  const key = Symbol.for('lostcodextheme.bridge');
  const styleId = 'lostcodextheme-theme';
  const backgroundId = 'lostcodextheme-background';
  const captionId = 'lostcodextheme-caption-backdrop';
  const attribute = 'data-lct-part';
  const profile = request.profile;
  const existing = window[key];

  function ownershipCollision(state) {
    return [[styleId, state?.style], [backgroundId, state?.background], [captionId, state?.caption]]
      .some(([id, owned]) => Array.from(document.querySelectorAll(`#${id}`)).some(element => element !== owned));
  }

  function removeLegacyCaption(state) {
    state.caption?.remove();
    if (state.updateCaption) {
      window.removeEventListener('resize', state.updateCaption);
      state.overlay?.removeEventListener('geometrychange', state.updateCaption);
    }
    delete state.caption;
    delete state.updateCaption;
    delete state.overlay;
  }

  function restore() {
    const state = window[key];
    if (!state) return { restored: true };
    state.observer?.disconnect();
    if (state.frame) cancelAnimationFrame(state.frame);
    state.style.remove();
    state.background?.remove();
    removeLegacyCaption(state);
    for (const [element, saved] of state.markers) {
      if (element.getAttribute(attribute) !== saved.part) continue;
      if (saved.before === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, saved.before);
    }
    state.markers.clear();
    delete window[key];
    return { restored: !document.getElementById(styleId) && !document.getElementById(backgroundId) && !document.getElementById(captionId) };
  }

  if (request.action === 'restore') return restore();

  function probe() {
    const route = Array.from(new URLSearchParams(location.search))
      .map(([name, value]) => `${name}=${value}`).join('&');
    const surface = `${location.pathname} ${route} ${location.hash}`.toLowerCase();
    const mainUrl = location.protocol === 'app:' && profile.hosts.includes(location.hostname)
      && ['/', '/index.html'].includes(location.pathname)
      && !profile.excluded.some(word => surface.includes(word));
    const counts = {};
    const visible = {};
    for (const [part, selector] of profile.parts) {
      const elements = Array.from(document.querySelectorAll(selector));
      counts[part] = elements.length;
      visible[part] = elements.some(element => {
        const box = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && css.visibility !== 'hidden' && css.display !== 'none';
      });
    }
    return { compatible: mainUrl && visible.main && (visible.sidebar || visible.composer),
      foreground: document.visibilityState === 'visible', counts };
  }

  const evidence = probe();
  if (request.action === 'probe') return evidence;
  if (!evidence.compatible) throw new Error('Unverified renderer; no injection performed');

  if (request.action === 'verify') {
    const state = window[key];
    const computed = getComputedStyle(document.documentElement);
    return { ...evidence, applied: Boolean(state && !ownershipCollision(state) && state.style.isConnected
      && state.background?.isConnected && state.style.textContent === request.css && state.style.sheet?.cssRules.length > 0),
      testOutline: computed.outlineColor === 'rgb(255, 45, 85)' && computed.outlineWidth === '3px' };
  }
  if (request.action !== 'apply') throw new Error('Unknown bridge action');
  if (ownershipCollision(existing)) throw new Error('Style ownership collision');

  const state = existing || { markers: new Map(), style: document.createElement('style'), background: document.createElement('div'), frame: 0 };
  function mapParts() {
    const wanted = new Map();
    wanted.set(state.background, 'background');
    for (const [part, selector] of profile.parts) {
      for (const element of document.querySelectorAll(selector)) {
        if (!wanted.has(element)) wanted.set(element, part);
      }
    }
    for (const [element, saved] of state.markers) {
      if (wanted.get(element) === saved.part) continue;
      if (element.getAttribute(attribute) === saved.part) {
        if (saved.before === null) element.removeAttribute(attribute);
        else element.setAttribute(attribute, saved.before);
      }
      state.markers.delete(element);
    }
    for (const [element, part] of wanted) {
      if (!state.markers.has(element)) {
        state.markers.set(element, { part, before: element.getAttribute(attribute) });
        element.setAttribute(attribute, part);
      }
    }
  }

  try {
    // Remove the old opaque caption patch on upgrade without changing native
    // controls or app preferences. Window glyphs use Codex's native appearance.
    removeLegacyCaption(state);
    if (!existing) {
      state.style.id = styleId;
      state.background.id = backgroundId;
      state.background.setAttribute('aria-hidden', 'true');
      // The image layer never owns pointer or keyboard interaction, even before CSS is written.
      state.background.style.pointerEvents = 'none';
      window[key] = state;
    }
    // A same-context document rebuild can detach owned layers without resetting the bridge.
    if (!state.style.isConnected) document.head.append(state.style);
    if (!state.background.isConnected) document.body.prepend(state.background);
    state.style.textContent = request.css;
    mapParts();
    if (!state.observer) {
      state.observer = new MutationObserver(() => {
        if (state.frame) return;
        state.frame = requestAnimationFrame(() => {
          state.frame = 0;
          if (!probe().compatible) { restore(); return; }
          mapParts();
        });
      });
      // Track every profile attribute, but never our own marker writes.
      const attributes = new Set(['class']);
      for (const [, selector] of profile.parts) {
        for (const match of selector.matchAll(/\[\s*([\w-]+)/g)) attributes.add(match[1]);
      }
      attributes.delete(attribute);
      state.observer.observe(document.documentElement, { childList: true, subtree: true,
        attributes: true, attributeFilter: Array.from(attributes) });
    }
    return { ...evidence, applied: true };
  } catch (error) {
    restore();
    throw error;
  }
})
