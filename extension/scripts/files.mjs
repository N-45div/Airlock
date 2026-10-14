// Which files make up the extension at runtime. Shared by the zip script and
// the manifest checks, so the package and the tests agree.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Top-level files and folders that ship. Everything else (tests, scripts,
 * docs, package.json, zips) stays out of the package. */
const ROOT_FILE = /^(?:manifest\.json|[\w-]+\.(?:js|html|css))$/;
const RUNTIME_DIRS = ['lib', 'icons'];

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Paths (forward slashes, relative to extension/) that go into the package. */
export function runtimeFiles(dir = EXTENSION_DIR) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (RUNTIME_DIRS.includes(name)) files.push(...walk(full, name));
    } else if (ROOT_FILE.test(name)) {
      files.push(name);
    }
  }
  return files;
}

/** Every file manifest.json points at. */
export function referencedFiles(manifest) {
  const files = new Set();
  const addIcons = (icons) => Object.values(icons ?? {}).forEach((f) => files.add(f));
  addIcons(manifest.icons);
  addIcons(manifest.action?.default_icon);
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  if (manifest.options_ui?.page) files.add(manifest.options_ui.page);
  if (manifest.options_page) files.add(manifest.options_page);
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  for (const script of manifest.content_scripts ?? []) {
    for (const f of [...(script.js ?? []), ...(script.css ?? [])]) files.add(f);
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const f of entry.resources ?? []) files.add(f);
  }
  return [...files];
}

export function readManifest(dir = EXTENSION_DIR) {
  return JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
}
