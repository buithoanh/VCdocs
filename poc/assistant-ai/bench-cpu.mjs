// Chat19 CPU baseline (fake data). Measures, on the host Ollama:
//  - native /api/generate with the CPU-only alias (num_gpu 0): prompt and
//    generation tokens/s, load time, for a short summary and a RAG-size prompt,
//    default threads vs num_thread 4 (small-VM proxy);
//  - runner memory (RSS) and `ollama ps`;
//  - end-to-end latency through Nextcloud TaskProcessing (schedule → result)
//    for a summary and a RAG answer, plus 3 concurrent RAG asks (queueing with
//    one worker);
//  - one Apple-GPU (Metal) reference run of the base tag, labelled as such.
// Writes evidence/bench-cpu.json.
import { execFileAsync, client, ollamaHost, runTask, writeEvidence } from './lib.mjs';
import { ask, buildPrompt, collectAll, rank } from './rag-lib.mjs';
import { teamAFiles } from './corpus.mjs';
import { cpus, totalmem } from 'node:os';

const cpuModel = 'vcws-qwen3-4b-cpu:latest';
const baseModel = 'qwen3:4b-instruct-2507-q4_K_M';
const summaryPrompt = `Tóm tắt văn bản sau trong 3 câu tiếng Việt:\n\n${teamAFiles['ke-hoach-du-an-song-hong.md']}\n${teamAFiles['bao-cao-quy-3-team-a.md']}`;
const memberA = await client('member-a');
const corpus = await collectAll(memberA);
const ragQuestion = 'Ngân sách dự án Sông Hồng là bao nhiêu, ai chủ trì và các rủi ro chính là gì?';
const ragPrompt = buildPrompt(ragQuestion, rank(corpus, ragQuestion, 4));

async function runnerRss() {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', 'Ollama.app|ollama (serve|runner)']);
    let kb = 0;
    for (const pid of stdout.trim().split('\n').filter(Boolean)) {
      const { stdout: rss } = await execFileAsync('ps', ['-o', 'rss=', '-p', pid]);
      kb += Number(rss.trim()) || 0;
    }
    return +(kb / 1024).toFixed(0);
  } catch { return null; }
}
async function generate(model, prompt, options = {}) {
  let peakRss = 0;
  const timer = setInterval(async () => { const r = await runnerRss(); if (r) peakRss = Math.max(peakRss, r); }, 500);
  const t0 = Date.now();
  const res = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: `[lần chạy ${Date.now()}-${Math.random().toString(36).slice(2, 8)}]\n${prompt}`, stream: false, options: { temperature: 0.2, num_predict: 256, ...options } }),
    signal: AbortSignal.timeout(900000),
  });
  const j = await res.json();
  clearInterval(timer);
  const ns = (x) => x / 1e9;
  return {
    wallMs: Date.now() - t0,
    loadS: +ns(j.load_duration ?? 0).toFixed(2),
    promptTokens: j.prompt_eval_count,
    promptTokPerS: j.prompt_eval_duration ? +(j.prompt_eval_count / ns(j.prompt_eval_duration)).toFixed(1) : null,
    genTokens: j.eval_count,
    genTokPerS: j.eval_duration ? +(j.eval_count / ns(j.eval_duration)).toFixed(1) : null,
    totalS: +ns(j.total_duration ?? 0).toFixed(2),
    peakRunnerRssMiB: peakRss || await runnerRss(),
  };
}
async function stopModels() {
  for (const m of [cpuModel, baseModel]) await execFileAsync('ollama', ['stop', m]).catch(() => {});
}

const out = {
  host: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGiB: +(totalmem() / 2 ** 30).toFixed(0), ollama: (await (await fetch(`${ollamaHost}/api/version`)).json()).version },
  prompts: { summaryChars: summaryPrompt.length, ragChars: ragPrompt.length },
  native: {},
};

await stopModels();
for (const [label, options] of [['cpu-default-threads', {}], ['cpu-4-threads', { num_thread: 4 }]]) {
  out.native[label] = { summary: [], rag: [] };
  for (let i = 0; i < 3; i += 1) out.native[label].summary.push(await generate(cpuModel, summaryPrompt, options));
  for (let i = 0; i < 3; i += 1) out.native[label].rag.push(await generate(cpuModel, ragPrompt, options));
  await stopModels(); // next variant starts cold (thread count is fixed at load)
}
out.ollamaPsDuringCpu = await (async () => { await generate(cpuModel, 'Xin chào', {}); return (await execFileAsync('ollama', ['ps'])).stdout.trim().split('\n'); })();

// End-to-end through Nextcloud (CPU alias, default threads, model warm).
out.nextcloud = { summary: [], rag: [], concurrentRag3: null };
for (let i = 0; i < 3; i += 1) {
  const r = await runTask(memberA, 'core:text2text:summary', { input: `${teamAFiles['ke-hoach-du-an-song-hong.md']}\n${teamAFiles['bao-cao-quy-3-team-a.md']}` });
  out.nextcloud.summary.push({ ms: r.ms, pickedUpMs: r.firstRunningMs, status: r.status, outChars: (r.output?.output ?? '').length });
}
for (let i = 0; i < 3; i += 1) {
  const r = await ask(memberA, ragQuestion, { docs: corpus });
  out.nextcloud.rag.push({ ms: r.ms, status: r.status, promptChars: r.promptChars, cited: r.citations.map((c) => c.n) });
}
{
  const t0 = Date.now();
  const rs = await Promise.all([0, 1, 2].map(() => ask(memberA, ragQuestion, { docs: corpus })));
  out.nextcloud.concurrentRag3 = { wallMs: Date.now() - t0, each: rs.map((r) => r.ms), note: 'one taskprocessing:worker → tasks run one after another' };
}

// Reference only: Apple GPU (Metal) offload of the base tag on this Mac.
await stopModels();
out.metalReferenceNotBaseline = { summary: [], rag: [] };
for (let i = 0; i < 2; i += 1) out.metalReferenceNotBaseline.summary.push(await generate(baseModel, summaryPrompt, {}));
for (let i = 0; i < 2; i += 1) out.metalReferenceNotBaseline.rag.push(await generate(baseModel, ragPrompt, {}));
out.ollamaPsDuringMetal = (await execFileAsync('ollama', ['ps'])).stdout.trim().split('\n');
await stopModels();

await writeEvidence('bench-cpu.json', out);
const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [label, v] of Object.entries(out.native)) {
  console.log(`${label}: summary gen ${med(v.summary.map((x) => x.genTokPerS))} tok/s prompt ${med(v.summary.map((x) => x.promptTokPerS))} tok/s total ${med(v.summary.map((x) => x.totalS))} s | rag gen ${med(v.rag.map((x) => x.genTokPerS))} prompt ${med(v.rag.map((x) => x.promptTokPerS))} total ${med(v.rag.map((x) => x.totalS))} s; peak RSS ${Math.max(...[...v.summary, ...v.rag].map((x) => x.peakRunnerRssMiB ?? 0))} MiB; cold load ${v.summary[0].loadS} s`);
}
console.log(`nextcloud summary ms ${out.nextcloud.summary.map((x) => x.ms)}; rag ms ${out.nextcloud.rag.map((x) => x.ms)}; 3 concurrent ${out.nextcloud.concurrentRag3.wallMs} ms (${out.nextcloud.concurrentRag3.each})`);
console.log(`metal ref: summary gen ${med(out.metalReferenceNotBaseline.summary.map((x) => x.genTokPerS))} tok/s, rag total ${med(out.metalReferenceNotBaseline.rag.map((x) => x.totalS))} s`);
