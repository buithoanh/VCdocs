import { connectCdp, controlsExpression } from './cdp-client.mjs';

const cdp = await connectCdp('http://portal.localtest.me:18122/login');
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(JSON.stringify(await cdp.evaluate(controlsExpression), null, 2));
console.log(await cdp.evaluate(`document.body.innerHTML.slice(0, 15000)`));
cdp.socket.close();
