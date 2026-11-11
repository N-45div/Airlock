// The agent guard: Airlock in front of the tools a page offers to AI agents (WebMCP).
// Runs in the page's own JavaScript world at document_start, before any page script, when the
// person turns it on in Settings (registered with chrome.scripting, never on by default).
//
//   - Wraps document.modelContext.registerTool. Each tool is checked (lib/agent-tools.js) before
//     the browser sees it: a tool that steers the agent or asks for a seed phrase is never
//     registered; one that moves money or signs is registered with its execute wrapped, so every
//     call, from any agent, waits for the person to press Allow.
//   - Watches <form toolname> (the declarative API): a blocked form loses its toolname, and a form
//     that moves money loses toolautosubmit, so the person presses submit.
//   - Reports what it saw to agent-guard-bridge.js, which passes it to the popup.
//
// It is a guard rail inside the page, not a sandbox: a page written to work around it can.
// Nothing here talks to the network.

(() => {
  'use strict';

  const api = globalThis.AirlockAgentTools;
  try {
    delete globalThis.AirlockAgentTools;
  } catch {
    // Not configurable: leave it.
  }
  if (!api || globalThis.__airlockAgentGuard) return;
  Object.defineProperty(globalThis, '__airlockAgentGuard', { value: true });

  let documentContext = null;
  try {
    documentContext = document.modelContext || null;
  } catch {
    documentContext = null;
  }
  // Chrome 149-151 named it navigator.modelContext; later versions removed it.
  let navigatorContext = null;
  try {
    navigatorContext = 'modelContext' in navigator ? navigator.modelContext : null;
  } catch {
    navigatorContext = null;
  }
  if (!documentContext && !navigatorContext) return; // WebMCP is off in this browser: nothing to guard.

  const REPORT_KIND = 'airlock:agent-tools';
  const origin = location.origin === 'null' ? location.href.slice(0, 60) : location.origin;
  // Taken now, before page scripts can replace them.
  const apply = Reflect.apply;
  const promiseThen = Promise.prototype.then;
  const setTimer = setTimeout;
  const clearTimer = clearTimeout;
  const postMessage = window.postMessage.bind(window);
  const createElement = document.createElement.bind(document);
  const stringify = JSON.stringify;
  const ObjectAssign = Object.assign;

  // The built-ins lib/agent-tools.js leans on. A page that swaps one out could make every check
  // pass, so if any has changed by the time a tool arrives, that page's tools are held back.
  const INTRINSICS = [
    [RegExp.prototype, 'test'],
    [RegExp.prototype, 'exec'],
    [String.prototype, 'replace'],
    [String.prototype, 'slice'],
    [String.prototype, 'toLowerCase'],
    [Array.prototype, 'some'],
    [Array.prototype, 'find'],
    [Array.prototype, 'map'],
    [Array.prototype, 'join'],
    [Array.prototype, 'reduce'],
    [Array.prototype, 'slice'],
    [Array.prototype, 'push'],
    [Array.prototype, 'indexOf'],
    [Array, 'from'],
    [Object, 'entries'],
    [Object, 'keys'],
    [JSON, 'parse'],
  ];
  const pristine = [];
  for (let i = 0; i < INTRINSICS.length; i++) pristine[i] = INTRINSICS[i][0][INTRINSICS[i][1]];
  function tampered() {
    for (let i = 0; i < INTRINSICS.length; i++) if (INTRINSICS[i][0][INTRINSICS[i][1]] !== pristine[i]) return true;
    return false;
  }
  const TAMPERED = {
    level: 'block',
    reasons: [{ level: 'block', code: 'tampered', text: 'The page changed JavaScript built-ins that Airlock\'s checks rely on, so its tools are held back.' }],
  };
  const check = (meta) => (tampered() ? TAMPERED : api.checkTool(meta));

  /** name -> { name, level, reasons, source, status, calls } */
  const tools = new Map();
  let reportTimer = 0;

  function report() {
    apply(clearTimer, window, [reportTimer]);
    reportTimer = apply(setTimer, window, [() => {
      const list = Array.from(tools.values()).map((t) => ({
        name: t.name,
        level: t.level,
        source: t.source,
        status: t.status,
        reasons: t.reasons.map((r) => ({ level: r.level, text: r.text })),
        calls: t.calls,
      }));
      postMessage({ kind: REPORT_KIND, origin, tools: list }, '*');
    }, 50]);
  }

  function record(meta, verdict, source, status) {
    const prev = tools.get(meta.name);
    tools.set(meta.name, { name: meta.name || '(unnamed)', level: verdict.level, reasons: verdict.reasons, source, status, calls: prev ? prev.calls : { allowed: 0, blocked: 0 } });
    report();
  }

  // ---- Asking the person ------------------------------------------------------------------

  let queue = Promise.resolve();

  /** Shows the request in a closed shadow root and resolves true only on a real click on Allow. */
  function askPerson(meta, verdict, input, signal) {
    const run = () =>
      new Promise((resolve) => {
        const host = createElement('airlock-agent-guard');
        host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block';
        const shadow = host.attachShadow({ mode: 'closed' });
        const style = createElement('style');
        style.textContent = `
          :host { all: initial; }
          .scrim { position: fixed; inset: 0; background: rgba(7, 8, 12, 0.55); display: grid; place-items: center; font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
          .card { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box; background: #111318; color: #f2f3f7; border: 1px solid rgba(255, 143, 134, 0.45); border-radius: 16px; padding: 22px 24px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6); }
          .eyebrow { font: 600 12px/1.2 ui-monospace, Consolas, monospace; letter-spacing: 0.12em; text-transform: uppercase; color: #b3baff; }
          h2 { margin: 10px 0 6px; font-size: 20px; line-height: 1.25; font-weight: 650; }
          .tool { font-family: ui-monospace, Consolas, monospace; color: #ff8f86; }
          p { margin: 6px 0; color: #b9bcc8; }
          ul { margin: 10px 0; padding-left: 18px; color: #f2f3f7; }
          li { margin: 4px 0; }
          pre { margin: 10px 0 0; padding: 10px 12px; max-height: 140px; overflow: auto; background: #07080c; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; font: 12.5px/1.45 ui-monospace, Consolas, monospace; color: #b9bcc8; white-space: pre-wrap; word-break: break-word; }
          .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
          button { font: inherit; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.18); background: transparent; color: #f2f3f7; }
          button.block { background: #ff8f86; color: #07080c; border-color: #ff8f86; }
          button:focus-visible { outline: 2px solid #8d99ff; outline-offset: 2px; }
        `;
        const el = (tag, cls, text) => {
          const n = createElement(tag);
          if (cls) n.className = cls;
          if (text !== undefined) n.textContent = text;
          return n;
        };
        const scrim = el('div', 'scrim');
        const card = el('div', 'card');
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-modal', 'true');
        card.append(el('div', 'eyebrow', 'Airlock · AI agent guard'));
        const h = el('h2');
        h.append('An AI agent wants to run ', el('span', 'tool', meta.name), ' on this site');
        card.append(h, el('p', '', origin));
        const ul = el('ul');
        for (const r of verdict.reasons) ul.append(el('li', '', r.text));
        card.append(ul);
        let shown = '';
        try {
          shown = stringify(input, null, 2) ?? '';
        } catch {
          shown = String(input);
        }
        if (shown && shown !== '{}') card.append(el('p', '', 'With these inputs:'), el('pre', '', shown.length > 1200 ? `${shown.slice(0, 1200)}…` : shown));
        const actions = el('div', 'actions');
        const allow = el('button', '', 'Allow once');
        const block = el('button', 'block', 'Block');
        allow.type = 'button';
        block.type = 'button';
        actions.append(allow, block);
        card.append(actions);
        scrim.append(card);
        shadow.append(style, scrim);

        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          host.remove();
          resolve(ok);
        };
        // Only a real click counts: a page script calling .click() makes an untrusted event.
        allow.addEventListener('click', (e) => e.isTrusted && finish(true));
        block.addEventListener('click', (e) => e.isTrusted && finish(false));
        signal?.addEventListener?.('abort', () => finish(false), { once: true });
        (document.body || document.documentElement).append(host);
        block.focus();
      });
    const next = apply(promiseThen, queue, [run, run]);
    queue = apply(promiseThen, next, [undefined, () => {}]);
    return next;
  }

  // ---- The imperative API ------------------------------------------------------------------

  function wrapTool(tool, meta, verdict) {
    const original = tool.execute;
    const copy = ObjectAssign({}, tool, {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    });
    copy.execute = async function (input, client) {
      const entry = tools.get(meta.name);
      const ok = await askPerson(meta, verdict, input, client && client.signal);
      if (entry) {
        entry.calls[ok ? 'allowed' : 'blocked'] += 1;
        report();
      }
      if (ok !== true) throw new DOMException('The person blocked this tool call in Airlock.', 'NotAllowedError');
      return apply(original, tool, [input, client]);
    };
    return copy;
  }

  function guardRegister(registerTool) {
    return function (tool, options) {
      let meta;
      try {
        meta = api.describeTool(tool);
      } catch {
        // A tool Airlock can't read isn't one an agent should get.
        return Promise.resolve(undefined);
      }
      const verdict = check(meta);
      if (verdict.level === 'block') {
        record(meta, verdict, 'script', 'blocked');
        return Promise.resolve(undefined);
      }
      record(meta, verdict, 'script', verdict.level === 'ask' ? 'asks-you' : 'allowed');
      const toRegister = verdict.level === 'ask' && typeof tool.execute === 'function' ? wrapTool(tool, meta, verdict) : tool;
      return apply(registerTool, this, [toRegister, options]);
    };
  }

  function patch(context) {
    if (!context) return;
    const proto = Object.getPrototypeOf(context);
    const original = proto && proto.registerTool;
    if (typeof original !== 'function') return;
    const guarded = guardRegister(original);
    // On the prototype, so ModelContext.prototype.registerTool.call(...) goes through it too.
    try {
      Object.defineProperty(proto, 'registerTool', { value: guarded, writable: false, configurable: false });
    } catch {
      try {
        Object.defineProperty(context, 'registerTool', { value: guarded, writable: false, configurable: false });
      } catch {
        // Left unguarded; nothing else to do from here.
      }
    }
  }

  patch(documentContext);
  if (navigatorContext && navigatorContext !== documentContext) patch(navigatorContext);

  // ---- The declarative API -----------------------------------------------------------------

  function guardForm(form) {
    const name = form.getAttribute('toolname');
    if (!name) return;
    let meta;
    try {
      meta = api.describeForm(form);
    } catch {
      return;
    }
    const verdict = check(meta);
    if (verdict.level === 'block') {
      form.removeAttribute('toolname');
      form.setAttribute('data-airlock-blocked-tool', name);
      record(meta, verdict, 'form', 'blocked');
    } else if (verdict.level === 'ask') {
      form.removeAttribute('toolautosubmit');
      record(meta, verdict, 'form', 'you-submit');
    } else {
      record(meta, verdict, 'form', 'allowed');
    }
  }

  const scan = (rootNode) => {
    if (rootNode.matches && rootNode.matches('form[toolname]')) guardForm(rootNode);
    if (rootNode.querySelectorAll) for (const form of rootNode.querySelectorAll('form[toolname]')) guardForm(form);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        const form = r.target.closest ? r.target.closest('form') : null;
        if (form) guardForm(form);
      } else for (const node of r.addedNodes) if (node.nodeType === 1) scan(node);
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['toolname', 'tooldescription', 'toolautosubmit', 'toolparamdescription', 'toolparamtitle'],
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(document), { once: true });
  else scan(document);

  // An empty report as soon as the page has WebMCP, so the popup knows the guard is here.
  report();
})();
