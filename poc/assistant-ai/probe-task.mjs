// Chat19 debug: run one TaskProcessing task as a persona and print status,
// timing and output (fake data only; no credential printed).
// Usage: node probe-task.mjs <persona> <taskType> <text>
import { client, ocs, runTask, tp } from './lib.mjs';

const [persona = 'member-a', type = 'core:text2text', ...rest] = process.argv.slice(2);
const c = await client(persona);
if (type === 'types') {
  console.log(Object.keys(ocs(await c.request('GET', tp('/tasktypes')))?.types ?? {}).sort().join('\n'));
} else {
  const r = await runTask(c, type, { input: rest.join(' ') || 'Xin chào, hãy giới thiệu ngắn gọn về bạn.' });
  console.log(JSON.stringify(r, null, 2));
}
