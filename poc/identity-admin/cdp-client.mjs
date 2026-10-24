export async function connectCdpTarget(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  const subscriptions = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    } else if (message.method) {
      for (const resolve of listeners.get(message.method) ?? []) resolve(message.params);
      listeners.delete(message.method);
      for (const notify of subscriptions.get(message.method) ?? []) notify(message.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const event = (method, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP_EVENT_TIMEOUT:${method}`)), timeoutMs);
    const wrapped = (value) => { clearTimeout(timeout); resolve(value); };
    listeners.set(method, [...(listeners.get(method) ?? []), wrapped]);
  });
  const subscribe = (method, notify) => {
    subscriptions.set(method, [...(subscriptions.get(method) ?? []), notify]);
    return () => subscriptions.set(method, (subscriptions.get(method) ?? []).filter((candidate) => candidate !== notify));
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  return { target, socket, send, event, subscribe, evaluate };
}

export async function connectCdp(url) {
  const port = process.env.CDP_PORT || '19222';
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  return connectCdpTarget(target);
}

export const controlsExpression = `(() => {
  const result = [];
  const walk = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (element.matches('input,button,a')) result.push({
        tag: element.tagName, type: element.type || '', name: element.name || '',
        id: element.id || '', text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 120),
      });
      if (element.shadowRoot) walk(element.shadowRoot);
    }
  };
  walk(document);
  return { url: location.href, title: document.title, controls: result };
})()`;
