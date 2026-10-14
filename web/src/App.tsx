import { useEffect, useRef } from 'react';
import { HomePage } from './home/HomePage.tsx';
import { NotFound } from './NotFound.tsx';
import { ReportPage } from './report/ReportPage.tsx';
import { parseRoute, usePathname } from './router.tsx';
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
          {route.name === 'home' ? (
            <HomePage />
          ) : route.name === 'report' ? (
            <ReportPage key={route.id} id={route.id} />
          ) : (
            <NotFound />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
