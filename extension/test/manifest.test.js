import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_API_BASE, PRODUCT_NAME } from '../config.js';
import { originPattern } from '../lib/settings.js';
import { EXTENSION_DIR, readManifest, referencedFiles, runtimeFiles } from '../scripts/files.mjs';

const manifest = readManifest();
const files = runtimeFiles();
const read = (rel) => readFileSync(path.join(EXTENSION_DIR, rel), 'utf8');
const scripts = files.filter((f) => f.endsWith('.js'));
const pages = files.filter((f) => f.endsWith('.html'));

describe('manifest.json', () => {
  it('is Manifest V3 at 0.1.0, named by the product constant', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.name, PRODUCT_NAME);
    assert.equal(manifest.short_name, PRODUCT_NAME);
    assert.ok(manifest.action.default_title.startsWith(PRODUCT_NAME));
    assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length} characters`);
  });

  it('asks for storage only, plus the server origin', () => {
    assert.deepEqual(manifest.permissions, ['storage']);
    assert.deepEqual(manifest.host_permissions, [originPattern(DEFAULT_API_BASE)]);
    // Only a custom https:// server the person types in, requested at that moment.
    assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://localhost/*']);
    assert.equal(manifest.optional_permissions, undefined);
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.equal(manifest.externally_connectable, undefined);
  });

  it('runs the content script on GitHub and npm only', () => {
    assert.equal(manifest.content_scripts.length, 1);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://github.com/*', 'https://www.npmjs.com/*']);
    assert.equal(manifest.content_scripts[0].all_frames, undefined);
  });

  it('uses a module service worker and an options page', () => {
    assert.equal(manifest.background.type, 'module');
    assert.equal(manifest.options_ui.page, 'options.html');
  });

  it('points only at files that exist and ship', () => {
    for (const file of referencedFiles(manifest)) {
      assert.ok(existsSync(path.join(EXTENSION_DIR, file)), `${file} is missing`);
      assert.ok(files.includes(file), `${file} would be left out of the package`);
    }
  });

  it('has every icon size the store and toolbar need, as real PNGs of that size', () => {
    for (const size of ['16', '32', '48', '128']) {
      const png = readFileSync(path.join(EXTENSION_DIR, manifest.icons[size]));
      assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
      assert.equal(png.readUInt32BE(16), Number(size));
      assert.equal(png.readUInt32BE(20), Number(size));
    }
  });
});

describe('runtime files', () => {
  it('load only files that ship', () => {
    for (const page of pages) {
      for (const [, ref] of read(page).matchAll(/(?:src|href)="([^"#:]+)"/g)) {
        assert.ok(files.includes(ref), `${page} loads ${ref}, which is not in the package`);
      }
    }
    for (const script of scripts) {
      const dir = path.posix.dirname(script);
      for (const [, ref] of read(script).matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        const target = path.posix.normalize(path.posix.join(dir, ref));
        assert.ok(files.includes(target), `${script} imports ${ref}, which is not in the package`);
      }
    }
  });

  it('keep the content script a classic script', () => {
    assert.doesNotMatch(read('content.js'), /^\s*(?:import|export)\s/m);
  });

  it('never build DOM from strings', () => {
    for (const file of [...scripts, ...pages]) {
      assert.doesNotMatch(read(file), /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/, file);
    }
  });

  it('have no emoji and no exclamation marks in what people read', () => {
    for (const file of [...scripts, ...pages, 'popup.css', 'options.css']) {
      assert.doesNotMatch(read(file), /\p{Extended_Pictographic}/u, file);
    }
    for (const page of pages) {
      const text = read(page).replace(/<!doctype[^>]*>|<!--[\s\S]*?-->/gi, '');
      assert.doesNotMatch(text, /!/, page);
    }
    const literals = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
    for (const script of scripts) {
      for (const [literal] of read(script).matchAll(literals)) {
        // A sentence ending in "!" (CSS's " !important" has a space before it).
        assert.doesNotMatch(literal, /[\w.)]!(?:\s|['"`]|$)/, `${script}: ${literal.slice(0, 80)}`);
      }
    }
  });
});
