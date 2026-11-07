#!/usr/bin/env node
// Prints a NEAR account's balance from a public RPC node. Account balances are public data.
const account = process.argv[2];
if (!account) {
  console.error('usage: near-balance <account.near>');
  process.exit(2);
}

async function main() {
  const res = await fetch('https://rpc.mainnet.fastnear.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: account } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.cause?.name ?? 'RPC error');
  const near = Number(BigInt(body.result.amount) / 10n ** 20n) / 1e4;
  console.log(`${account}: ${near} NEAR`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
