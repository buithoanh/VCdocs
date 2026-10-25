import tls from 'node:tls';

const socket = tls.connect({
  host: '127.0.0.1',
  port: 18465,
  servername: 'mail.vcworkspace.test',
  rejectUnauthorized: false,
});
let transcript = '';
socket.on('data', (chunk) => { transcript += chunk.toString('utf8'); });
function waitFor(pattern) {
  return new Promise((resolve, reject) => {
    const check = () => { if (pattern.test(transcript)) { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); socket.off('data', check); socket.off('error', fail); };
    const fail = (error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => fail(new Error(`SMTP timeout waiting ${pattern}: ${transcript.slice(-300)}`)), 5_000);
    socket.on('data', check); socket.on('error', fail); check();
  });
}
await waitFor(/^220/m);
socket.write('EHLO vcworkspace.test\r\n');
await waitFor(/^250 8BITMIME/m);
socket.write('MAIL FROM:<probe@vcworkspace.test>\r\n');
await waitFor(/^503 5\.5\.1 You must authenticate first\./m);
socket.end();
console.log(JSON.stringify({ ok: true, relayTls: true, smtpReachedStalwart: true, unauthenticatedRelayRejected: true }));
