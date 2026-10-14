import { useEffect, useRef } from 'react';
import { HomePage } from './home/HomePage.tsx';
import { NotFound } from './NotFound.tsx';
import { PrivacyPage } from './PrivacyPage.tsx';
import { ReportPage } from './report/ReportPage.tsx';
import { parseRoute, usePathname, type Route } from './router.tsx';
import { SiteFooter, SiteHeader } from './ui/Layout.tsx';

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'report':
      return <ReportPage key={route.id} id={route.id} />;
    case 'privacy':
      return <PrivacyPage />;
    case 'missing':
      return <NotFound />;
  }
}

export function App() {
  const pathname = usePathname();
  const main = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);

  // After an in-app navigation (not the first load), start screen readers at the new page.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
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
          <Page route={parseRoute(pathname)} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
