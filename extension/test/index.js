// `node --test extension/test/` hands this directory to Node as a module path,
// which loads this file; it imports every *.test.js beside it so that command
// runs the whole suite. `node --test "extension/test/*.test.js"` works too.

import { readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url);
for (const file of readdirSync(here).filter((name) => name.endsWith('.test.js')).sort()) {
  await import(new URL(file, here).href);
}
