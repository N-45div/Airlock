// Airlock's own tools for the AI agent in the browser (WebMCP): on this site, an agent can look up a
// repository's verdict on NEAR, or start a check, the same way a person would. Registered only when
// the browser has WebMCP (document.modelContext); nothing changes for anyone else.
//
// Chrome runs WebMCP as an origin trial: a token for this origin, set at build time as
// VITE_WEBMCP_TRIAL_TOKEN, turns it on for every visitor; without one it works where
// chrome://flags/#enable-webmcp-testing is on.

import { startScan } from './api.ts';
import { nearView, RECORDER, registryIdOf, type OnchainVerdict } from './near.ts';
import { navigate } from './router.tsx';

interface ModelContextLike {
  registerTool(tool: object): Promise<unknown>;
}

const LABEL: Record<string, string> = { safe: 'Looks safe', caution: 'Be careful', dangerous: "Don't run it" };

/** "github.com/owner/name", "owner/name" or a GitHub URL -> https://github.com/owner/name, or null. */
export function githubUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let text = input.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) text = `github.com/${text}`;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)$/i.exec(text);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

const repositoryInput = {
  type: 'object',
  properties: {
    repository: { type: 'string', description: 'A public GitHub repository, like https://github.com/owner/name' },
  },
  required: ['repository'],
};

export function registerAirlockTools(): void {
  const mc = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (!mc) return;

  void mc
    .registerTool({
      name: 'get_near_verdict',
      title: 'Airlock verdict on NEAR',
      description:
        "Looks up Airlock's latest verdict for a public GitHub repository in the airlock-verdicts.testnet contract on NEAR: Looks safe, Be careful or Don't run it, with the reviewing model and when. Read-only.",
      inputSchema: repositoryInput,
      // Verdicts are about code written by strangers; the repository name is theirs.
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ repository }: { repository?: unknown }) => {
        const url = githubUrl(repository);
        const id = url ? registryIdOf(url) : null;
        if (!url || !id) return 'That is not a public GitHub repository address. Use https://github.com/owner/name.';
        const v = await nearView<OnchainVerdict | null>('get_latest', { repo: id, recorder: RECORDER });
        if (!v) return `No Airlock verdict on NEAR for ${id} yet. The check_repository tool starts one.`;
        const when = new Date(v.recorded_at_ms).toISOString().slice(0, 10);
        return `${LABEL[v.verdict] ?? v.verdict}: verdict #${v.id} for ${v.repo} at commit ${v.revision.slice(0, 7)}, ${v.findings} finding${v.findings === 1 ? '' : 's'}, by ${v.model} in a NEAR AI Cloud TEE, recorded ${when}. Details: ${location.origin}/near?repo=${encodeURIComponent(id)}`;
      },
    })
    .catch(() => {});

  void mc
    .registerTool({
      name: 'check_repository',
      title: 'Check a repository with Airlock',
      description:
        'Starts an Airlock check of a public GitHub repository and opens its report on this page. A private AI review in a TEE reads the code; the report takes a minute or two.',
      inputSchema: repositoryInput,
      annotations: { readOnlyHint: false },
      execute: async ({ repository }: { repository?: unknown }) => {
        const url = githubUrl(repository);
        if (!url) return 'That is not a public GitHub repository address. Use https://github.com/owner/name.';
        const to = await startScan(url);
        navigate(to);
        return `Started. The report is open at ${location.origin}${to}`;
      },
    })
    .catch(() => {});
}

/** The origin trial token, if this build has one, as Chrome expects it: a meta tag in the head. */
export function enableWebMcpTrial(): void {
  const token = import.meta.env.VITE_WEBMCP_TRIAL_TOKEN as string | undefined;
  if (!token) return;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'origin-trial';
  meta.content = token;
  document.head.append(meta);
}
