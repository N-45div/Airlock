// Puts a "Check before you run" button on GitHub repository pages and npm
// package pages. A classic script (MV3 content scripts can't be modules), so
// repository detection and every network call go through the background
// worker, which shares lib/repo.js and lib/api.js with the popup.
//
// Placement, most specific first:
//   GitHub repo home   ul[data-testid="repo-header-actions"]  (Sponsor/Watch/Fork/Star)
//   GitHub, older UI   #repository-container-header ul.pagehead-actions
//   npm package        after the sidebar "Repository" link (a[aria-labelledby~="repository-link"])
//   anything else      a small pill fixed to the bottom-right corner
// The UI lives in a closed shadow root, so page CSS can't reach it and its
// CSS can't leak out. Remote text is only ever set with textContent.

(() => {
  'use strict';

  const HOST_ATTR = 'data-airlock-ext';
  const THEME_ATTR = 'data-airlock-theme';
  const INSTANCE = crypto.randomUUID();
  const PRODUCT = chrome.runtime.getManifest().name;
  const IS_GITHUB = location.hostname === 'github.com';
  const IS_NPM = location.hostname === 'www.npmjs.com';
  /** How long to wait for the page to draw its header before using the pill. */
  const ANCHOR_WAIT_MS = 1500;
  const MESSAGE_MS = 12_000;

  const state = {
    href: null,
    linksKey: null,
    repoUrl: null,
    /** verdictView from lib/api.js, or null */
    result: null,
    /** repoUrl -> { id, key } for checks started from this tab */
    started: new Map(),
    dismissed: new Set(),
    busy: false,
    message: '',
    seq: 0,
    navAt: Date.now(),
  };

  let host = null;
  let hostKind = null;
  let ui = null;
  let detecting = Promise.resolve();
  let ready = false;
  let dead = false;
  let timer = 0;
  let messageTimer = 0;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  function alive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  async function send(msg) {
    if (!alive()) {
      teardown();
      return { ok: false, error: '' };
    }
    try {
      const res = await chrome.runtime.sendMessage(msg);
      return res || { ok: false, error: `${PRODUCT} did not answer. Try again.` };
    } catch {
      if (!alive()) teardown();
      return { ok: false, error: `${PRODUCT} was updated or restarted. Reload this page to use it.` };
    }
  }

  // ---- Reading the page -------------------------------------------------

  function npmRepositoryLink() {
    return (
      document.querySelector('a[aria-labelledby~="repository-link"]') ||
      document.querySelector('a[aria-labelledby~="repository"]') ||
      document.getElementById('repository-link')?.closest('a') ||
      document.getElementById('repository')?.nextElementSibling?.querySelector('a[href]') ||
      null
    );
  }

  function collectRepositoryLinks() {
    if (!IS_NPM) return [];
    const links = [];
    const add = (a) => {
      const href = a?.getAttribute('href');
      if (href && !links.includes(href)) links.push(href);
    };
    document.querySelectorAll('a[aria-labelledby~="repository-link"], a[aria-labelledby~="repository"]').forEach(add);
    add(document.getElementById('repository-link')?.closest('a'));
    add(document.getElementById('repository')?.nextElementSibling?.querySelector('a[href]'));
    return links.slice(0, 5);
  }

  function findAnchor() {
    if (IS_GITHUB) {
      const list =
        document.querySelector('ul[data-testid="repo-header-actions"]') ||
        document.querySelector('#repository-container-header ul.pagehead-actions');
      if (list) return { kind: 'list', parent: list };
    } else if (IS_NPM) {
      const link = npmRepositoryLink();
      const block = link && (link.closest('p') || link.parentElement);
      if (block?.parentElement) return { kind: 'after', ref: block };
    }
    return { kind: 'floating' };
  }

  function currentTheme() {
    if (IS_GITHUB) {
      const mode = document.documentElement.getAttribute('data-color-mode');
      if (mode === 'dark' || mode === 'light') return mode;
      return darkQuery.matches ? 'dark' : 'light';
    }
    // Sites without a theme switch (npm): follow what the page actually paints.
    for (const el of [document.body, document.documentElement]) {
      const bg = el && getComputedStyle(el).backgroundColor;
      const rgb = bg && /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(bg);
      if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0.5)) {
        const [r, g, b] = rgb.slice(1, 4).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
      }
    }
    // A transparent page sits on the browser's canvas, which is only dark
    // when the page opts into a dark color scheme.
    const scheme = getComputedStyle(document.documentElement).colorScheme || '';
    return scheme.includes('dark') && (!scheme.includes('light') || darkQuery.matches) ? 'dark' : 'light';
  }

  // ---- The button -------------------------------------------------------

  const CSS = `
    :host { all: initial; }
    :host {
      --fg: #1f2328; --muted: #59636e; --bg: #f6f8fa; --bg-hover: #eef1f4; --border: #d1d9e0;
      --surface: #ffffff; --focus: #0969da; --shadow: 0 8px 24px rgba(66, 74, 83, 0.14);
      --safe-bg: #dafbe1; --safe-border: #4ac26b; --safe-fg: #116329;
      --caution-bg: #fff8c5; --caution-border: #d4a72c; --caution-fg: #7d4e00;
      --danger-bg: #ffebe9; --danger-border: #ff8182; --danger-fg: #a40e26;
    }
    :host([${THEME_ATTR}="dark"]) {
      --fg: #f0f6fc; --muted: #9198a1; --bg: #212830; --bg-hover: #2a313c; --border: #3d444d;
      --surface: #151b23; --focus: #4493f8; --shadow: 0 8px 24px rgba(1, 4, 9, 0.6);
      --safe-bg: #12301c; --safe-border: #2ea043; --safe-fg: #3fb950;
      --caution-bg: #33270b; --caution-border: #bb8009; --caution-fg: #d29922;
      --danger-bg: #3a1618; --danger-border: #da3633; --danger-fg: #ff7b72;
    }
    .wrap {
      position: relative; display: inline-flex; align-items: center; gap: 6px;
      font: 500 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      color: var(--fg);
    }
    button { font: inherit; margin: 0; }
    .main {
      appearance: none; display: inline-flex; align-items: center; gap: 6px;
      height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg); color: var(--fg); cursor: pointer; white-space: nowrap;
    }
    .main:hover { background: var(--bg-hover); }
    .main:focus-visible, .hide:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .main[aria-disabled="true"] { cursor: progress; opacity: 0.75; }
    .main[data-tone="safe"] { background: var(--safe-bg); border-color: var(--safe-border); color: var(--safe-fg); }
    .main[data-tone="caution"] { background: var(--caution-bg); border-color: var(--caution-border); color: var(--caution-fg); }
    .main[data-tone="dangerous"] { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-fg); }
    .main[data-tone]:hover { filter: brightness(0.97); }
    svg { flex: none; display: block; }
    .floating .main { height: 32px; padding: 0 14px; border-radius: 16px; box-shadow: var(--shadow); }
    .hide {
      appearance: none; width: 24px; height: 24px; padding: 0; border-radius: 12px; cursor: pointer;
      border: 1px solid var(--border); background: var(--surface); color: var(--muted);
      font-size: 15px; line-height: 1; box-shadow: var(--shadow);
    }
    .hide:hover { color: var(--fg); }
    .msg {
      position: absolute; top: calc(100% + 6px); right: 0; z-index: 1;
      width: max-content; max-width: 280px; padding: 8px 10px; border-radius: 6px;
      border: 1px solid var(--danger-border); background: var(--surface); color: var(--fg);
      box-shadow: var(--shadow); font-weight: 400; white-space: normal; overflow-wrap: anywhere;
    }
    .after .msg { left: 0; right: auto; }
    .floating .msg { top: auto; bottom: calc(100% + 6px); }
    [hidden] { display: none !important; }
  `;

  function glyph() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': 'true', focusable: 'false' })) {
      svg.setAttribute(k, v);
    }
    const shapes = [
      { x: '1', y: '1', width: '14', height: '14', rx: '3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
      { x: '4.25', y: '4.25', width: '3', height: '7.5', rx: '0.75', fill: 'currentColor' },
      { x: '8.75', y: '4.25', width: '3', height: '7.5', rx: '0.75', fill: 'currentColor' },
    ];
    for (const attrs of shapes) {
      const rect = document.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries(attrs)) rect.setAttribute(k, v);
      svg.append(rect);
    }
    return svg;
  }

  function setStyles(el, styles) {
    for (const [k, v] of Object.entries({ margin: '0', padding: '0', 'list-style': 'none', ...styles })) {
      el.style.setProperty(k, v, 'important');
    }
  }

  function createHost(kind) {
    const el = document.createElement(kind === 'list' ? 'li' : 'div');
    el.setAttribute(HOST_ATTR, INSTANCE);
    setStyles(el, {
      list: { display: 'inline-flex', 'align-items': 'center' },
      after: { display: 'flex', margin: '0 0 12px' },
      floating: { position: 'fixed', right: '16px', bottom: '16px', 'z-index': '2147483600' },
    }[kind]);
    // An <li> can't hold a shadow root, so the list item wraps a <span> that does.
    let shadowEl = el;
    if (kind === 'list') {
      shadowEl = document.createElement('span');
      setStyles(shadowEl, { display: 'inline-flex', 'align-items': 'center' });
      el.append(shadowEl);
    }
    const root = shadowEl.attachShadow({ mode: 'closed' });
    const css = document.createElement('style');
    css.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = `wrap ${kind}`;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', PRODUCT);
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'main';
    const label = document.createElement('span');
    main.append(glyph(), label);
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    msg.hidden = true;
    wrap.append(main);
    let hide = null;
    if (kind === 'floating') {
      hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'hide';
      hide.textContent = '×';
      hide.title = `Hide ${PRODUCT} on this repository`;
      hide.setAttribute('aria-label', hide.title);
      hide.addEventListener('click', onHide);
      wrap.append(hide);
    }
    wrap.append(msg);
    root.append(css, wrap);
    main.addEventListener('click', onMainClick);
    ui = { main, label, msg, hide, shadowEl };
    host = el;
    hostKind = kind;
    applyTheme();
    render();
    return el;
  }

  function render() {
    if (!ui) return;
    const { main, label, msg } = ui;
    const started = state.repoUrl ? state.started.get(state.repoUrl) : null;
    const result = state.result;
    let text;
    let title;
    let spoken;
    if (state.busy) {
      text = 'Starting a check…';
      title = '';
    } else if (result) {
      text = result.label;
      title = result.headline ? `${result.headline}\n\nOpen the ${PRODUCT} report.` : `Open the ${PRODUCT} report.`;
      spoken = `${PRODUCT}: ${result.label}. ${result.headline} Open the report.`;
    } else if (started) {
      text = 'Check in progress';
      title = `Open the live ${PRODUCT} report.`;
    } else {
      text = 'Check before you run';
      title = `${PRODUCT} has a fenced AI agent read this repository and tells you whether it is safe to run. Nothing runs on your computer.`;
    }
    label.textContent = text;
    main.title = title;
    main.setAttribute('aria-label', spoken || `${PRODUCT}: ${text}`);
    if (result && !state.busy) main.dataset.tone = result.verdict;
    else delete main.dataset.tone;
    main.setAttribute('aria-disabled', String(state.busy));
    msg.textContent = state.message;
    msg.hidden = !state.message;
  }

  function showMessage(text) {
    state.message = text || '';
    clearTimeout(messageTimer);
    if (state.message) {
      messageTimer = setTimeout(() => {
        state.message = '';
        render();
      }, MESSAGE_MS);
    }
    render();
  }

  async function onMainClick() {
    const repoUrl = state.repoUrl;
    if (state.busy || !repoUrl) return;
    showMessage('');
    const started = state.started.get(repoUrl);
    if (state.result || started) {
      const report = state.result ? { id: state.result.id } : { id: started.id, key: started.key };
      const res = await send({ type: 'airlock:open-report', ...report });
      if (!res.ok) showMessage(res.error);
      return;
    }
    state.busy = true;
    render();
    const res = await send({ type: 'airlock:check', url: repoUrl });
    state.busy = false;
    if (res.ok) state.started.set(repoUrl, { id: res.id, key: res.key });
    if (state.repoUrl === repoUrl && !res.ok) showMessage(res.error);
    else render();
  }

  function onHide() {
    if (state.repoUrl) state.dismissed.add(state.repoUrl);
    removeHost();
  }

  function applyTheme() {
    if (ui) ui.shadowEl.setAttribute(THEME_ATTR, currentTheme());
  }

  function removeHost() {
    if (host) host.remove();
    host = null;
    hostKind = null;
    ui = null;
  }

  function removeStrays() {
    for (const el of document.querySelectorAll(`[${HOST_ATTR}]`)) {
      if (el !== host) el.remove();
    }
  }

  function place(anchor) {
    if (!host || hostKind !== anchor.kind) {
      removeHost();
      createHost(anchor.kind);
    }
    if (anchor.kind === 'list') {
      if (host.parentElement !== anchor.parent) anchor.parent.append(host);
    } else if (anchor.kind === 'after') {
      if (anchor.ref.nextElementSibling !== host) anchor.ref.after(host);
    } else if (host.parentElement !== document.body) {
      document.body.append(host);
    }
    removeStrays();
  }

  function placeOrRemove() {
    if (!state.repoUrl || !document.body) {
      removeHost();
      return;
    }
    const anchor = findAnchor();
    if (anchor.kind === 'floating') {
      if (state.dismissed.has(state.repoUrl)) {
        removeHost();
        return;
      }
      const waited = Date.now() - state.navAt;
      if (hostKind !== 'floating' && waited < ANCHOR_WAIT_MS) {
        if (host && !host.isConnected) removeHost();
        schedule(ANCHOR_WAIT_MS - waited + 50);
        return;
      }
    }
    place(anchor);
  }

  // ---- Keeping up with the page ------------------------------------------

  async function lookup(repoUrl) {
    const res = await send({ type: 'airlock:lookup', url: repoUrl, reason: 'page' });
    if (dead || state.repoUrl !== repoUrl) return;
    state.result = res.ok ? res.result || null : null;
    render();
  }

  async function detect(href, links) {
    const seq = ++state.seq;
    const res = await send({ type: 'airlock:detect', href, repositoryLinks: links });
    if (dead || seq !== state.seq) return;
    const repoUrl = res.ok && typeof res.repoUrl === 'string' ? res.repoUrl : null;
    if (repoUrl === state.repoUrl) return;
    state.repoUrl = repoUrl;
    state.result = null;
    state.busy = false;
    showMessage('');
    if (repoUrl) void lookup(repoUrl);
  }

  async function tick() {
    timer = 0;
    if (dead) return;
    if (!alive()) {
      teardown();
      return;
    }
    const href = location.href;
    const links = collectRepositoryLinks();
    const linksKey = links.join('\n');
    if (href !== state.href || linksKey !== state.linksKey) {
      if (href !== state.href) state.navAt = Date.now();
      state.href = href;
      state.linksKey = linksKey;
      detecting = detect(href, links);
      await detecting;
      if (dead) return;
    }
    placeOrRemove();
    applyTheme();
  }

  function schedule(delay = 200) {
    if (dead || !ready) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Wait for an idle moment so GitHub and npm finish hydrating first.
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void tick(), { timeout: 1000 });
      else void tick();
    }, delay);
  }

  const onNavigate = () => schedule(50);
  const onMutation = () => schedule();
  const domObserver = new MutationObserver(onMutation);
  const themeObserver = new MutationObserver(applyTheme);
  const NAV_EVENTS = ['turbo:load', 'turbo:render', 'turbo:frame-load', 'pjax:end'];

  /** The popup asks which repository this tab shows. If the button hasn't
   * started yet (page still loading), work it out on the spot. */
  function onPopupMessage(msg, _sender, sendResponse) {
    if (!msg || msg.type !== 'airlock:page-repo') return false;
    (async () => {
      await detecting;
      if (state.href === location.href && state.repoUrl) return { repoUrl: state.repoUrl };
      const res = await send({ type: 'airlock:detect', href: location.href, repositoryLinks: collectRepositoryLinks() });
      return { repoUrl: res.ok && typeof res.repoUrl === 'string' ? res.repoUrl : null };
    })().then(sendResponse, () => sendResponse({ repoUrl: null }));
    return true;
  }

  function teardown() {
    if (dead) return;
    dead = true;
    clearTimeout(timer);
    clearTimeout(messageTimer);
    domObserver.disconnect();
    themeObserver.disconnect();
    darkQuery.removeEventListener('change', applyTheme);
    for (const name of NAV_EVENTS) document.removeEventListener(name, onNavigate);
    window.removeEventListener('popstate', onNavigate);
    try {
      window.navigation?.removeEventListener('navigatesuccess', onNavigate);
      chrome.runtime.onMessage.removeListener(onPopupMessage);
    } catch {
      // The extension context may already be gone.
    }
    removeHost();
  }

  function start() {
    if (ready || dead) return;
    ready = true;
    schedule(0);
  }

  // A copy left behind by an earlier version of the extension.
  for (const el of document.querySelectorAll(`[${HOST_ATTR}]`)) el.remove();

  chrome.runtime.onMessage.addListener(onPopupMessage);
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode'] });
  darkQuery.addEventListener('change', applyTheme);
  for (const name of NAV_EVENTS) document.addEventListener(name, onNavigate);
  window.addEventListener('popstate', onNavigate);
  try {
    window.navigation?.addEventListener('navigatesuccess', onNavigate);
  } catch {
    // Older Chrome without the Navigation API; the observer covers it.
  }

  // Start once the page has loaded (or after a short wait if a slow image
  // holds the load event), so the button isn't inserted mid-hydration.
  if (document.readyState === 'complete') start();
  else {
    window.addEventListener('load', start, { once: true });
    setTimeout(start, 2500);
  }
})();
