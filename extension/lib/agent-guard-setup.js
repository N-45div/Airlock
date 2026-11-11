// Turning the agent guard on and off. The guard runs on every https:// page (and localhost), so it
// is never on by default: the person turns it on in Settings, Chrome asks them for access to all
// sites, and only then are the two scripts registered. Turning it off unregisters them.

/** chrome.storage.sync key: the person wants the agent guard on. */
export const AGENT_GUARD_KEY = 'agentGuard';

/** Where the guard runs. The same patterns as the optional host permissions in manifest.json. */
export const GUARD_ORIGINS = ['https://*/*', 'http://localhost/*'];

/** The guard's two scripts: the checks and the wrapper in the page's own world (they must run
 * before any page script, and share that world), and the bridge in the extension's world. */
export const GUARD_SCRIPTS = [
  { id: 'airlock-agent-guard', js: ['lib/agent-tools.js', 'agent-guard.js'], world: 'MAIN' },
  { id: 'airlock-agent-guard-bridge', js: ['agent-guard-bridge.js'], world: 'ISOLATED' },
];

export function guardRegistrations() {
  return GUARD_SCRIPTS.map((s) => ({
    id: s.id,
    js: s.js,
    world: s.world,
    matches: GUARD_ORIGINS,
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
  }));
}

export async function agentGuardWanted() {
  try {
    const stored = await chrome.storage.sync.get(AGENT_GUARD_KEY);
    return stored[AGENT_GUARD_KEY] === true;
  } catch {
    return false;
  }
}

/** Makes the registered scripts match the setting and the permission. Returns whether the guard
 * is running. Safe to call any time (install, browser start, after a settings change). */
export async function syncAgentGuard() {
  const ids = GUARD_SCRIPTS.map((s) => s.id);
  const wanted = await agentGuardWanted();
  const allowed = await chrome.permissions.contains({ origins: GUARD_ORIGINS }).catch(() => false);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => []);
  if (wanted && allowed) {
    if (registered.length === ids.length) return true;
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((r) => r.id) });
    await chrome.scripting.registerContentScripts(guardRegistrations());
    return true;
  }
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((r) => r.id) });
  return false;
}
