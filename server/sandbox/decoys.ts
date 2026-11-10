// Decoy wallets and keys for the sandbox's home folder. Each sits where real software keeps the
// real thing on Linux, and carries a marker unique to the run, so code that opens one has gone
// looking for a wallet or a key: no install step has a reason to. Nothing here is a real secret.

import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

export type DecoyKind = 'browser-wallet' | 'desktop-wallet' | 'cli-wallet' | 'browser-data' | 'ssh-key' | 'cloud-key' | 'env-file' | 'shell-history';

export interface Decoy {
  /** What a person would call it: "MetaMask (Chrome)". */
  label: string;
  kind: DecoyKind;
  /** The decoy file, relative to the home folder. */
  file: string;
  /** A folder that only this wallet keeps, relative to home: opening it counts as reaching for the wallet. */
  folder?: string;
  content: (marker: string) => string;
}

/** The home folder inside the sandbox. */
export const HOME = '/home/dev';

const EXTENSIONS: [string, string][] = [
  ['MetaMask', 'nkbihfbeogaeaoehlefnkodbefgpgknn'],
  ['Phantom', 'bfnaelmomeimhlpmgjnjophhpkkoljpa'],
  ['Coinbase Wallet', 'hnfanknocfeofbddgcijnmhnfnkdnaad'],
  ['Rabby', 'acmacodkjbdgmoleebolmdjonilkdbch'],
  ['Keplr', 'dmkamcknogkgcdfhhbddcghachkejeap'],
];
const BROWSERS: [string, string][] = [
  ['Chrome', '.config/google-chrome/Default'],
  ['Brave', '.config/BraveSoftware/Brave-Browser/Default'],
];

const vault = (m: string) => `{"KeyringController":{"vault":"{\\"data\\":\\"${m}\\",\\"iv\\":\\"${m.slice(-16)}\\",\\"salt\\":\\"${m.slice(0, 16)}\\"}"}}`;

export const DECOYS: Decoy[] = [
  ...BROWSERS.flatMap(([browser, profile]) =>
    EXTENSIONS.map(([wallet, id]): Decoy => ({
      label: `${wallet} (${browser})`,
      kind: 'browser-wallet',
      file: `${profile}/Local Extension Settings/${id}/000003.log`,
      folder: `${profile}/Local Extension Settings/${id}`,
      content: vault,
    })),
  ),
  { label: 'Saved passwords (Chrome)', kind: 'browser-data', file: '.config/google-chrome/Default/Login Data', content: (m) => `SQLite format 3\0${m}` },
  { label: 'Cookies (Chrome)', kind: 'browser-data', file: '.config/google-chrome/Default/Network/Cookies', content: (m) => `SQLite format 3\0${m}` },
  { label: 'Saved passwords (Firefox)', kind: 'browser-data', file: '.mozilla/firefox/k3x9q2ld.default-release/logins.json', content: (m) => `{"logins":[{"encryptedPassword":"${m}"}]}` },
  { label: 'Exodus wallet', kind: 'desktop-wallet', file: '.config/Exodus/exodus.wallet/seed.seco', folder: '.config/Exodus/exodus.wallet', content: (m) => `SECO${m}` },
  { label: 'Electrum wallet', kind: 'desktop-wallet', file: '.electrum/wallets/default_wallet', folder: '.electrum/wallets', content: (m) => `{"keystore":{"seed":"${m}"}}` },
  { label: 'Atomic wallet', kind: 'desktop-wallet', file: '.config/atomic/Local Storage/leveldb/000003.log', folder: '.config/atomic/Local Storage/leveldb', content: vault },
  { label: 'NEAR CLI keys', kind: 'cli-wallet', file: '.near-credentials/mainnet/dev-treasury.near.json', folder: '.near-credentials', content: (m) => `{"account_id":"dev-treasury.near","public_key":"ed25519:${m}","private_key":"ed25519:${m}"}` },
  { label: 'NEAR CLI keys', kind: 'cli-wallet', file: '.near-credentials/testnet/dev-treasury.testnet.json', content: (m) => `{"account_id":"dev-treasury.testnet","private_key":"ed25519:${m}"}` },
  { label: 'Solana CLI keypair', kind: 'cli-wallet', file: '.config/solana/id.json', folder: '.config/solana', content: (m) => `[${Array.from(Buffer.from(m.padEnd(64, '0').slice(0, 64))).join(',')}]` },
  { label: 'Ethereum keystore', kind: 'cli-wallet', file: '.ethereum/keystore/UTC--2026-01-01T00-00-00.000000000Z--3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', folder: '.ethereum/keystore', content: (m) => `{"address":"3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be","crypto":{"ciphertext":"${m}"}}` },
  { label: 'Foundry keystore', kind: 'cli-wallet', file: '.foundry/keystores/deployer', folder: '.foundry/keystores', content: (m) => `{"crypto":{"ciphertext":"${m}"}}` },
  { label: 'Sui keystore', kind: 'cli-wallet', file: '.sui/sui_config/sui.keystore', content: (m) => `["${Buffer.from(m).toString('base64')}"]` },
  { label: 'Aptos CLI key', kind: 'cli-wallet', file: '.aptos/config.yaml', content: (m) => `profiles:\n  default:\n    private_key: "0x${Buffer.from(m).toString('hex').slice(0, 64)}"\n` },
  { label: 'SSH key', kind: 'ssh-key', file: '.ssh/id_ed25519', content: (m) => `-----BEGIN OPENSSH PRIVATE KEY-----\n${Buffer.from(m).toString('base64')}\n-----END OPENSSH PRIVATE KEY-----\n` },
  { label: 'SSH key (RSA)', kind: 'ssh-key', file: '.ssh/id_rsa', content: (m) => `-----BEGIN RSA PRIVATE KEY-----\n${Buffer.from(m).toString('base64')}\n-----END RSA PRIVATE KEY-----\n` },
  { label: 'AWS keys', kind: 'cloud-key', file: '.aws/credentials', content: (m) => `[default]\naws_access_key_id = AKIA${m.slice(0, 16).toUpperCase()}\naws_secret_access_key = ${m}\n` },
  { label: 'Google Cloud key', kind: 'cloud-key', file: '.config/gcloud/application_default_credentials.json', content: (m) => `{"type":"authorized_user","refresh_token":"${m}"}` },
  { label: 'GitHub CLI token', kind: 'cloud-key', file: '.config/gh/hosts.yml', content: (m) => `github.com:\n    oauth_token: gho_${m}\n` },
  { label: 'Another project’s .env', kind: 'env-file', file: 'projects/defi-bot/.env', content: (m) => `PRIVATE_KEY=0x${Buffer.from(m).toString('hex').slice(0, 64)}\nMNEMONIC="${m}"\n` },
  { label: 'Shell history', kind: 'shell-history', file: '.bash_history', content: (m) => `export PRIVATE_KEY=${m}\nnear login\n` },
];

/** A marker that ties anything carrying it to this run. */
export function newMarker(): string {
  return `AIRLOCK-DECOY-${randomBytes(12).toString('hex')}`;
}

/**
 * Each decoy carries its own token, derived from the run's marker and its path, so bytes caught
 * leaving the sandbox say which wallet or key was inside them. 32 characters: every decoy format
 * keeps all of it, including the ones that store it as hex or as a Solana byte array.
 */
export function decoyToken(marker: string, decoy: Decoy): string {
  return `AIRLOCK${createHash('sha256').update(`${marker}\0${decoy.file}`).digest('hex').slice(0, 25)}`;
}

/** Every decoy's token for this run. */
export function decoyTokens(marker: string): { label: string; file: string; token: string }[] {
  return DECOYS.map((d) => ({ label: d.label, file: d.file, token: decoyToken(marker, d) }));
}

/** The decoy files to write, at absolute paths under `home`. */
export function decoyFiles(marker: string, home = HOME): { path: string; content: string }[] {
  return DECOYS.map((d) => ({ path: path.posix.join(home, d.file), content: d.content(decoyToken(marker, d)) }));
}

/** The decoy a path belongs to, if any: the file itself, or a folder only that wallet keeps. */
export function matchDecoy(target: string, home = HOME): Decoy | undefined {
  const p = path.posix.normalize(target);
  const inside = (rel: string) => {
    const base = path.posix.join(home, rel);
    return p === base || p.startsWith(`${base}/`);
  };
  return DECOYS.find((d) => inside(d.file)) ?? DECOYS.find((d) => d.folder && inside(d.folder));
}

/** "~/.config/solana/id.json" */
export function homeRelative(target: string, home = HOME): string {
  return target === home || target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target;
}
