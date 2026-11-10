// Types for sinkhole.mjs, which stays plain JavaScript so it runs on the sandbox VM's own Node.

export interface DnsQuery {
  id: number;
  flags: number;
  name: string;
  type: number;
  end: number;
}

export interface SinkholeConfig {
  dnsPort?: number;
  httpPort?: number;
  httpsPort?: number;
  host?: string;
  /** The VM's real resolver, for package registries. */
  upstream?: string;
  upstreamPort?: number;
  /** Host names that resolve for real (and their subdomains). */
  allow?: string[];
  /** JSON-lines log of every lookup and request. */
  log: string;
  /** Holds ca.key and ca.crt; without it there is no HTTPS listener. */
  caDir?: string;
  /** Written with the ports once listening. */
  ready?: string;
}

export function parseQuery(msg: Buffer): DnsQuery | null;
export function buildQuery(id: number, name: string, type?: number): Buffer;
export function sinkAnswer(msg: Buffer, q: DnsQuery, ip?: string): Buffer;
export function isAllowed(name: string, allow: string[]): boolean;
export function makeCa(dir: string): void;
export function startSinkhole(cfg: SinkholeConfig): Promise<{ ports: { dns: number; http: number; https?: number }; close: () => void }>;
