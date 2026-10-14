import { useEffect, useRef } from 'react';
import { parseRoute, usePathname } from './router.tsx';
import { HomePage } from './home/HomePage.tsx';
import { SiteFooter, SiteHeader } from './ui/Layout.tsx';

export function App() {
  const pathname = usePathname();
  const route = parseRoute(pathname);
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // After an in-app navigation, start screen readers at the new page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" ref={main} tabIndex={-1}>
        <div className="wrap">
          {route.name === 'home' ? <HomePage /> : route.name === 'report' ? <p>Report {route.id}</p> : <p>Not found</p>}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
