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
          <Link to="/#how-it-works" className="site-nav__wide">
            How it works
          </Link>
          <a href="/near">On NEAR</a>
          <Link to="/pricing">Pricing</Link>
          <a href={LINKS.extension} className="site-nav__wide">
            Chrome extension
          </a>
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
          <span className="site-footer__line">Checks a stranger's code before it can touch your wallets.</span>
        </div>
        <nav className="site-footer__links" aria-label="Footer">
          <a href={LINKS.extension}>Chrome extension</a>
          <a href={LINKS.source}>Source on GitHub</a>
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
        <p className="site-footer__credit">Reviewed by a model in a TEE on NEAR AI Cloud · verdicts on NEAR</p>
      </div>
    </footer>
  );
}
