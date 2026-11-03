// Lists the NEAR AI Cloud models the private reviewer can use: models that run in a
// TEE with attestation and support tool calls. The catalog is public; no key needed.
//   npm run models

export const CLOUD_API = process.env.NEARAI_BASE_URL ?? 'https://cloud-api.near.ai/v1';

interface Cost {
  amount: number;
  scale: number;
  currency: string;
}

interface CatalogModel {
  modelId: string;
  inputCostPerToken: Cost;
  outputCostPerToken: Cost;
  metadata: {
    verifiable?: boolean;
    attestationSupported?: boolean;
    contextLength?: number;
    supportedFeatures?: string[] | null;
    aliases?: string[];
  };
}

export interface PrivateModel {
  id: string;
  contextLength: number;
  /** US dollars per million tokens. */
  inputPerMillion: number;
  outputPerMillion: number;
  structuredOutputs: boolean;
}

const perMillion = (c: Cost) => (c.amount / 10 ** c.scale) * 1_000_000;

/** Models that run in an attested TEE and can call tools, cheapest input first. */
export async function listPrivateModels(fetchImpl: typeof fetch = fetch): Promise<PrivateModel[]> {
  const res = await fetchImpl(`${CLOUD_API}/model/list?limit=200`);
  if (!res.ok) throw new Error(`NEAR AI Cloud model list answered ${res.status}`);
  const body = (await res.json()) as { models?: CatalogModel[] };
  return (body.models ?? [])
    .filter((m) => m.metadata.verifiable && m.metadata.attestationSupported && m.metadata.supportedFeatures?.includes('tools'))
    .map((m) => ({
      id: m.modelId,
      contextLength: m.metadata.contextLength ?? 0,
      inputPerMillion: perMillion(m.inputCostPerToken),
      outputPerMillion: perMillion(m.outputCostPerToken),
      structuredOutputs: !!m.metadata.supportedFeatures?.some((f) => f === 'structured_outputs' || f === 'json_mode'),
    }))
    .sort((a, b) => a.inputPerMillion - b.inputPerMillion || a.id.localeCompare(b.id));
}

if (import.meta.main) {
  const models = await listPrivateModels();
  console.log(`${models.length} NEAR AI Cloud models with TEE attestation and tool calls:\n`);
  console.log(`${'model'.padEnd(48)} ${'context'.padStart(9)}  ${'$/M in'.padStart(7)}  ${'$/M out'.padStart(7)}  json`);
  for (const m of models) {
    console.log(
      `${m.id.padEnd(48)} ${String(m.contextLength).padStart(9)}  ${m.inputPerMillion.toFixed(2).padStart(7)}  ${m.outputPerMillion.toFixed(2).padStart(7)}  ${m.structuredOutputs ? 'yes' : 'no'}`,
    );
  }
}
