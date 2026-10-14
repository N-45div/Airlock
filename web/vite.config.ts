import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { PRODUCT, TAGLINE } from './src/brand.ts';

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Fills the product name into index.html, so the name lives in one constant. */
function brand(): Plugin {
  return {
    name: 'airlock-brand',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%PRODUCT%', escapeHtml(PRODUCT)).replaceAll('%TAGLINE%', escapeHtml(TAGLINE)),
    },
  };
}

export default defineConfig({
  plugins: [react(), brand()],
  server: {
    port: 5173,
    // The API runs separately in development; live updates stream through this proxy.
    proxy: { '/api': { target: 'http://127.0.0.1:8787' } },
  },
  build: {
    // The server's CSP allows only same-origin scripts and fonts (font-src 'self', no data:),
    // so nothing is inlined: every asset ships as its own file under /assets.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
