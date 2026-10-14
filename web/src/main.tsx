import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT } from './brand.ts';
import './styles/index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <main className="wrap">{PRODUCT}</main>
    </StrictMode>,
  );
}
