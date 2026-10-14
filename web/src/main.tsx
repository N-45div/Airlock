import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are served from our own origin: no visitor request goes to a font CDN.
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { App } from './App.tsx';
import './styles/index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
