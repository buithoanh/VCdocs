// Chat19: record the model card BEFORE `ollama pull` (owner approval covers one
// small CPU-friendly model). Reads only the public Ollama registry manifest,
// config and license/params blobs (a few KB), never the model weights.
// After the pull, `node model-card.mjs --verify` checks the local digest matches.
import { createHash } from 'node:crypto';
import { execFileAsync, readEvidence, writeEvidence } from './lib.mjs';

const name = 'qwen3';
const tag = '4b-instruct-2507-q4_K_M';
const registry = `https://registry.ollama.ai/v2/library/${name}`;
const accept = { Accept: 'application/vnd.docker.distribution.manifest.v2+json' };
const get = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`REGISTRY_${r.status}:${url}`);
  return r;
};

if (process.argv.includes('--verify')) {
  const card = await readEvidence('model-card.json');
  const { stdout } = await execFileAsync('ollama', ['list']);
  const { stdout: show } = await execFileAsync('ollama', ['show', `${name}:${tag}`]);
  const { stdout: modelfile } = await execFileAsync('ollama', ['show', '--modelfile', `${name}:${tag}`]);
  const fromBlob = /FROM\s+\S*sha256-([0-9a-f]{64})/.exec(modelfile)?.[1];
  const matches = fromBlob === card.weights.digest.replace('sha256:', '');
  const lic = (await execFileAsync('ollama', ['show', '--license', `${name}:${tag}`])).stdout;
  await writeEvidence('model-card.json', {
    ...card,
    verifiedAfterPull: {
      ollamaList: stdout.trim().split('\n'),
      show: show.trim().split('\n').map((l) => l.trim()).filter(Boolean),
      localWeightsDigestMatchesManifest: matches,
      localLicenseIsApache2: /Apache License\s+Version 2\.0/.test(lic),
    },
  });
  if (!matches) throw new Error('MODEL_DIGEST_MISMATCH');
  console.log(`verified ${name}:${tag}: weights digest matches manifest, license Apache-2.0=${/Apache License/.test(lic)}`);
  process.exit(0);
}

const manifestRes = await get(`${registry}/manifests/${tag}`, { headers: accept });
const manifestText = await manifestRes.text();
const manifest = JSON.parse(manifestText);
const config = await (await get(`${registry}/blobs/${manifest.config.digest}`)).json();
const layer = (kind) => manifest.layers.find((l) => l.mediaType.endsWith(`.${kind}`));
const license = await (await get(`${registry}/blobs/${layer('license').digest}`)).text();
const params = await (await get(`${registry}/blobs/${layer('params').digest}`)).json();
const totalBytes = manifest.layers.reduce((s, l) => s + l.size, 0) + manifest.config.size;
await writeEvidence('model-card.json', {
  recordedBeforePull: true,
  name: `${name}:${tag}`,
  aliasSameDigest: `${name}:4b-instruct`,
  source: {
    ollamaLibrary: `https://ollama.com/library/${name}:${tag}`,
    registryManifest: `${registry}/manifests/${tag}`,
    manifestSha256: `sha256:${createHash('sha256').update(manifestText).digest('hex')}`,
    upstream: 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507 (Qwen team, Alibaba Cloud), GGUF Q4_K_M quantisation by Ollama',
  },
  config,
  weights: { digest: layer('model').digest, bytes: layer('model').size, gib: +(layer('model').size / 2 ** 30).toFixed(2) },
  downloadTotalBytes: totalBytes,
  license: {
    spdx: 'Apache-2.0',
    blobDigest: layer('license').digest,
    firstLine: license.trim().split('\n')[0].trim(),
    isApache2: /Apache License\s+Version 2\.0/.test(license),
    note: 'Permissive; commercial use allowed; keep NOTICE/licence text when redistributing. Not Qwen Research License (that applies to Qwen2.5-3B, not chosen).',
  },
  defaultParams: params,
  why: [
    '4.0B parameters, Q4_K_M ≈ 2.3 GiB weights: fits CPU RAM of a small server; non-thinking instruct variant (no <think> blocks through the OpenAI-compatible API)',
    'Qwen3 is trained on 119 languages incl. Vietnamese; 256K native context (we cap num_ctx at 8192 for CPU)',
    'Apache-2.0 licence (permissive), unlike gemma3 (Gemma Terms of Use, plus 0.85 GB vision projector) or qwen2.5:3b (Qwen Research License)',
  ],
  rejected: {
    'gemma3:4b': 'Gemma Terms of Use (custom, use restrictions); 3.35 GB incl. vision projector',
    'qwen2.5:3b': 'Qwen Research License (non-commercial) for the 3B size',
    'llama3.2:3b': 'Llama 3.2 Community License (custom, acceptable-use policy); weaker Vietnamese',
    'qwen3:4b': 'hybrid thinking model: emits reasoning by default, slower on CPU',
    'qwen3.5:4b': 'newer but ships a 0.68 GB vision projector; not needed for text-only read tasks',
  },
  embeddingModel: 'none pulled: Context Chat backend not feasible offline (see handoff); retrieval uses Nextcloud search as the asker',
});
console.log(`model card recorded: ${name}:${tag} weights ${(layer('model').size / 1e9).toFixed(2)} GB, total ${(totalBytes / 1e9).toFixed(2)} GB, licence ${license.trim().split('\n')[0].trim()}`);
