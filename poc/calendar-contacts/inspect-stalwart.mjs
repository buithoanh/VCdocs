// Chat16 debug: list the admin object types exposed by the chat16 Stalwart and
// dump the (non-secret) shape of selected objects. Read-only.
import { adminJmap } from './mail-lib.mjs';

const { session, call } = await adminJmap();
const objects = process.argv.slice(2);
console.log('capabilities', Object.keys(session.capabilities));
console.log('accounts', JSON.stringify(session.accounts).slice(0, 600));
for (const object of objects) {
  const res = await call([[`x:${object}/query`, {}, 'q'], [`x:${object}/get`, { '#ids': { resultOf: 'q', name: `x:${object}/query`, path: '/ids' } }, 'g']], { allowErrors: true });
  console.log(object, JSON.stringify(res, (k, v) => (/secret|password|hash/i.test(k) ? '***' : v)).slice(0, 4000));
}
