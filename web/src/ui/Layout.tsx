import { LINKS, PRODUCT } from '../brand.ts';
import { Link } from '../router.tsx';
import { Mark } from './Icon.tsx';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        <Link to="/" className="brand" aria-label={`${PRODUCT} home`}>
          <Mark size={26} />
          <span className="brand__name">{PRODUCT}</span>
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link to="/#how">How it works</Link>
          <a href={LINKS.extension}>Chrome extension</a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <div className="site-footer__brand">
          <Mark size={20} />
          <span className="brand__name">{PRODUCT}</span>
          <span className="site-footer__line">Reads the code. Never runs it.</span>
        </div>
        <nav className="site-footer__links" aria-label="Footer">
          <a href={LINKS.extension}>Chrome extension</a>
          <a href={LINKS.source}>Source on GitHub</a>
        </nav>
        <p className="site-footer__credit">Reviews by Claude · fenced by ArmorIQ</p>
      </div>
    </footer>
  );
}
