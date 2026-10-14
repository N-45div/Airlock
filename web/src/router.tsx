// Client-side routing on the history API: a handful of routes need no library.

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export type Route = { name: 'home' } | { name: 'report'; id: string } | { name: 'privacy' } | { name: 'missing' };

const NAVIGATE = 'airlock:navigate';

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '/index.html') return { name: 'home' };
  if (pathname === '/privacy' || pathname === '/privacy/') return { name: 'privacy' };
  const match = /^\/r\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  if (match?.[1]) return { name: 'report', id: match[1] };
  return { name: 'missing' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

const currentPath = () => window.location.pathname;

/** The current path; re-renders on back, forward and navigate(). */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): void {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const samePage = url.pathname === window.location.pathname;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATE));
  if (url.hash) {
    // Let the new page render, then bring the anchor into view.
    requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
  } else if (!samePage) {
    window.scrollTo(0, 0);
  }
}

/** An in-app link: a real <a href>, so it works with a middle click, a new tab and no JavaScript. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
