import { useEffect } from 'react';
import { PRODUCT } from './brand.ts';
import { ScanForm } from './home/ScanForm.tsx';
import { Link } from './router.tsx';
import { Card } from './ui/primitives.tsx';

export function NotFound() {
  useEffect(() => {
    document.title = `Page not found · ${PRODUCT}`;
  }, []);

  return (
    <div className="page page--report">
      <Card as="section" pad="lg" aria-labelledby="notfound-title">
        <p className="eyebrow">Not found</p>
        <h1 id="notfound-title" className="missing__title">
          There is nothing at this address
        </h1>
        <p className="missing__text">
          Paste a GitHub link to check a repository, or go back to the <Link to="/">home page</Link>.
        </p>
        <ScanForm />
      </Card>
    </div>
  );
}
