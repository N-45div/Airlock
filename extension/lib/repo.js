// Works out which GitHub repository a page is about. Pure functions, shared
// by the background worker (for the content script) and the popup.
// Every function returns a canonical https://github.com/owner/name or null.

/** Same rule as the server (server/fetch-repo.ts), so a URL that passes here
 * is one the server accepts. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** First path segments that are GitHub's own pages, not an owner. */
export const GITHUB_RESERVED = new Set([
  'about', 'account', 'apps', 'blog', 'careers', 'codespaces', 'collections', 'contact',
  'copilot', 'customer-stories', 'dashboard', 'discussions', 'education', 'enterprise',
  'enterprises', 'events', 'explore', 'features', 'gist', 'gists', 'git-guides',
  'github-copilot', 'home', 'issues', 'join', 'login', 'logout', 'marketplace', 'mobile',
  'new', 'nonprofit', 'notifications', 'organizations', 'orgs', 'partners',
  'password_reset', 'premium-support', 'pricing', 'pulls', 'readme', 'repositories',
  'resources', 'search', 'security', 'sessions', 'settings', 'signup', 'site', 'sitemap',
  'solutions', 'sponsors', 'stars', 'team', 'teams', 'topics', 'trending', 'users',
  'watching',
]);

function cleanRepoName(raw) {
  const name = raw.endsWith('.git') ? raw.slice(0, -4) : raw;
  if (!NAME.test(name) || name === '.' || name === '..') return null;
  return name;
}

/** owner/name from the first two path segments, or null. */
function fromSegments(pathname) {
  const [owner, rawName] = pathname.split('/').filter(Boolean);
  if (!owner || !rawName) return null;
  if (!NAME.test(owner) || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
  const name = cleanRepoName(rawName);
  if (!name) return null;
  return `https://github.com/${owner}/${name}`;
}

function isGitHubHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'github.com' || host === 'www.github.com';
}

/** A github.com page address (any page inside a repo) to its repo. */
export function repoFromGitHubUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!isGitHubHost(url.hostname)) return null;
  return fromSegments(url.pathname);
}

/**
 * The repository link npm shows in a package's sidebar, in any shape the
 * package.json "repository" field allows: git+https://github.com/o/r.git,
 * git://, git+ssh://git@, git@github.com:o/r.git, github:o/r, or a link
 * into a subfolder (/tree/main/packages/x).
 */
export function normalizeRepositoryLink(link) {
  let text = typeof link === 'string' ? link.trim() : '';
  if (!text || text.length > 2048) return null;
  text = text.replace(/^git\+/i, '');
  const shorthand = /^github:(.+)$/i.exec(text);
  if (shorthand) text = `https://github.com/${shorthand[1]}`;
  const scp = /^(?:[\w.-]+@)?github\.com:(?!\/\/)(.+)$/i.exec(text);
  if (scp) text = `https://github.com/${scp[1]}`;
  text = text.replace(/^(?:git|ssh):\/\/(?:[^@/]+@)?/i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  return repoFromGitHubUrl(text);
}

/** The package name from an npm page path, or null if it isn't a package page.
 * Handles /package/name, /package/@scope/name and /package/name/v/1.2.3. */
export function npmPackageFromPath(pathname) {
  const parts = String(pathname).split('/').filter(Boolean);
  if (parts[0] !== 'package' || !parts[1]) return null;
  let name;
  try {
    name = decodeURIComponent(parts[1]);
    if (name.startsWith('@')) {
      if (name.includes('/')) return validNpmName(name);
      if (!parts[2]) return null;
      name = `${name}/${decodeURIComponent(parts[2])}`;
    }
  } catch {
    return null;
  }
  return validNpmName(name);
}

function validNpmName(name) {
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name) && name.length <= 214
    ? name
    : null;
}

/**
 * The repository a page is about. `repositoryLinks` are the hrefs the content
 * script found in npm's "Repository" sidebar section (empty on GitHub).
 */
export function repoFromPage({ href, repositoryLinks = [] } = {}) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (isGitHubHost(host)) return repoFromGitHubUrl(href);
  if (host === 'www.npmjs.com' || host === 'npmjs.com') {
    if (!npmPackageFromPath(url.pathname)) return null;
    for (const link of Array.isArray(repositoryLinks) ? repositoryLinks : []) {
      const repo = normalizeRepositoryLink(link);
      if (repo) return repo;
    }
  }
  return null;
}

/**
 * What someone typed into the popup's box. Returns { ok: true, url } or
 * { ok: false, error } with a sentence to show them.
 */
export function parseRepoInput(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return { ok: false, error: 'Paste the address of a GitHub repository.' };
  if (/^(?:https?:\/\/)?(?:www\.)?npmjs\.com\//i.test(text)) {
    return {
      ok: false,
      error: 'That is an npm page. Open it and use the button next to its repository link, or paste the github.com address.',
    };
  }
  // owner/name on its own.
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text) && !text.split('/')[0].includes('.')) {
    const url = fromSegments(text);
    return url ? { ok: true, url } : { ok: false, error: 'That does not look like owner/name of a GitHub repository.' };
  }
  const url = normalizeRepositoryLink(text);
  if (url) return { ok: true, url };
  return { ok: false, error: 'Paste a GitHub repository address, like github.com/owner/name.' };
}

/** "owner/name" for display. */
export function repoLabel(url) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(url ?? '');
  return match ? match[1] : String(url ?? '');
}
