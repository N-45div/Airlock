// One command that checks this hackathon entry with no API key and no network:
//   npm run judge
// 1. Every receipt in fixtures/receipts and bench/receipts verifies offline (Intel TDX quote,
//    key and nonce binding, reply signatures, decrypted verdict, and the sample files where the
//    sample ships with Airlock).
// 2. The test suite passes, including tampered receipts, the private engine, the fixture hygiene
//    check and Airlock's baseline tests.
// Exits 0 only if both pass.

import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Receipt } from './receipt.ts';
import { FIXTURES, sampleDir, verifyReceipt } from './verify-receipt.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = path.join(root, 'bench', 'receipts');

async function receiptFiles(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
}

const ARCHIVE = path.join(root, 'bench', 'archive');
const archived: string[] = [];
for (const run of (await readdir(ARCHIVE).catch(() => [] as string[])).sort()) {
  archived.push(...(await receiptFiles(path.join(ARCHIVE, run))).filter((f) => !f.endsWith('results.json')));
}
const files = [...(await receiptFiles(FIXTURES)), ...(await receiptFiles(BENCH)), ...archived];
let verified = 0;
const failures: string[] = [];
for (const file of files) {
  const receipt = JSON.parse(await readFile(file, 'utf8')) as Receipt;
  const dir = await sampleDir(receipt);
  const checks = await verifyReceipt(receipt, dir ? { repoDir: dir } : {});
  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) verified += 1;
  else failures.push(`${path.relative(root, file)}: ${failed.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
}

const test = spawnSync(process.execPath, ['--no-warnings', '--test', 'server/test/*.test.ts'], { cwd: root, encoding: 'utf8', env: { ...process.env, NEARAI_API_KEY: '' } });
const out = `${test.stdout}\n${test.stderr}`;
const count = (label: string) => Number(out.match(new RegExp(`^ℹ ${label} (\\d+)`, 'm'))?.[1] ?? NaN);
const tests = count('tests');
const passed = count('pass');
const testsOk = test.status === 0 && tests > 0 && passed === tests;

console.log('Airlock Private: judge check (no key, no network)\n');
console.log(`  receipts  ${verified}/${files.length} verified offline (${(await receiptFiles(FIXTURES)).length} fixture, ${(await receiptFiles(BENCH)).length} benchmark, ${archived.length} from earlier runs)`);
console.log(`  tests     ${passed}/${tests} passed (receipts, tampering, private engine, fixture hygiene, baseline)`);
for (const f of failures) console.log(`  FAIL      ${f}`);
if (!testsOk) console.log(out.split('\n').filter((l) => /✖|not ok|Error/.test(l)).slice(0, 20).map((l) => `  ${l}`).join('\n'));
const ok = files.length > 0 && failures.length === 0 && testsOk;
console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
