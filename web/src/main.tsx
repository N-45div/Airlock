import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT } from './brand.ts';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <main>{PRODUCT}</main>
    </StrictMode>,
  );
}
