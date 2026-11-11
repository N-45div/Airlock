// Passes the agent guard's report (agent-guard.js, in the page's world) to the extension, so the
// popup can show which tools this page offers to AI agents and what Airlock did with each.
// Runs in the extension's isolated world at document_start, only when the person has turned the
// agent guard on. The report is page-side information: the guard enforces in the page; this only
// displays. Everything is size-capped and checked for shape before it is passed on.

(() => {
  'use strict';

  const KIND = 'airlock:agent-tools';
  const LEVELS = ['ok', 'note', 'ask', 'block'];
  const STATUSES = ['allowed', 'asks-you', 'blocked', 'you-submit'];
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const count = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 1e6) : 0);

  function clean(data) {
    if (!data || data.kind !== KIND || !Array.isArray(data.tools)) return null;
    return {
      origin: text(data.origin, 200),
      tools: data.tools.slice(0, 50).map((t) => ({
        name: text(t && t.name, 120) || '(unnamed)',
        level: LEVELS.includes(t && t.level) ? t.level : 'ok',
        status: STATUSES.includes(t && t.status) ? t.status : 'allowed',
        source: t && t.source === 'form' ? 'form' : 'script',
        reasons: Array.isArray(t && t.reasons)
          ? t.reasons.slice(0, 8).map((r) => ({ level: LEVELS.includes(r && r.level) ? r.level : 'note', text: text(r && r.text, 300) }))
          : [],
        calls: { allowed: count(t && t.calls && t.calls.allowed), blocked: count(t && t.calls && t.calls.blocked) },
      })),
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const report = clean(event.data);
    if (!report) return;
    try {
      chrome.runtime.sendMessage({ type: 'airlock:agent-tools', ...report }).catch(() => {});
    } catch {
      // The extension was reloaded; this page keeps its old scripts until it reloads too.
    }
  });
})();
