import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Journal, body, json, sha256, equalSecret, insist, readJson } from './common.mjs';
import { PaymentProvider } from './payment.mjs';

const mediaDir = fileURLToPath(new URL('../../fixtures/team-workspace/media/', import.meta.url));
export async function loadMedia() {
  const manifest = await readJson(join(mediaDir, 'manifest.json'));
  return Promise.all(manifest.assets.map(async asset => {
    const source = await readFile(join(mediaDir, asset.file));
    const bytes = asset.encoding === 'base64' ? Buffer.from(source.toString().trim(), 'base64') : source;
    insist(bytes.length === asset.bytes && sha256(bytes) === asset.sha256, 'MEDIA_HASH_MISMATCH');
    return { ...asset, data: bytes };
  }));
}

export async function startServices({ directory, adminToken, serviceToken, signingSecret, webhookUrl,
  port = 0, autoRetry = true, retryMs = 100, timeoutMs = 2000 }) {
  insist([adminToken, serviceToken, signingSecret].every(x => typeof x === 'string' && x.length >= 16), 'FIXTURE_TOKENS_REQUIRED');
  insist(new Set([adminToken, serviceToken, signingSecret]).size === 3, 'FIXTURE_TOKENS_MUST_DIFFER');
  const journal = await Journal.open(join(directory, 'provider.ndjson'));
  const provider = new PaymentProvider(journal, { webhookUrl, signingSecret, retryMs, timeoutMs });
  const assets = await loadMedia();
  const emails = new Map(), extracts = new Map(), faults = [];
  for (const record of journal.records) {
    if (record.kind === 'email.accepted') emails.set(record.key, record);
    if (record.kind === 'extract.accepted') extracts.set(record.key, record);
  }
  let tail = Promise.resolve(), stopped = false;
  const serial = (fn) => { const task = tail.then(fn); tail = task.catch(() => {}); return task; };
  const authenticate = (request, admin = false) => insist(equalSecret(request.headers.authorization,
    'Bearer ' + (admin ? adminToken : serviceToken)), 'UNAUTHORIZED');
  const faultFor = target => {
    const i = faults.findIndex(f => f.target === target && f.count > 0);
    if (i < 0) return null;
    faults[i].count--; return faults[i];
  };
  const respond = async (response, value, fault) => {
    if (fault?.kind === 'drop') { response.destroy(); return; }
    if (fault?.kind === 'delay') await new Promise(r => setTimeout(r, fault.delayMs));
    json(response, 200, value);
  };
  const server = http.createServer((request, response) => {
    serial(async () => {
      const url = new URL(request.url, 'http://127.0.0.1');
      const admin = url.pathname.startsWith('/admin/') || url.pathname.startsWith('/payment/');
      authenticate(request, admin);
      if (request.method === 'GET' && url.pathname === '/admin/email') {
        const recipient = url.searchParams.get('recipient');
        json(response, 200, { messages: [...emails.values()].filter(x => !recipient || x.message.to === recipient) });
      } else if (request.method === 'GET' && url.pathname === '/payment/status') {
        json(response, 200, provider.inspect());
      } else if (request.method === 'POST' && url.pathname === '/admin/faults') {
        const f = JSON.parse(await body(request, 16384));
        insist(['email', 'extract', 'payment-events', 'payment-deliveries'].includes(f.target)
          && ['drop', 'delay', '503'].includes(f.kind) && Number.isSafeInteger(f.count)
          && f.count > 0 && f.count <= 1000 && (f.kind !== 'delay' ||
            Number.isSafeInteger(f.delayMs) && f.delayMs >= 0 && f.delayMs <= 10000), 'INVALID_FAULT');
        faults.push(f); json(response, 200, { accepted: true });
      } else if (request.method === 'POST' && url.pathname === '/payment/deliveries') {
        const input = JSON.parse(await body(request, 65536));
        const fault = faultFor('payment-deliveries');
        if (fault?.kind === '503') { json(response, 503, { code: 'INJECTED_UNAVAILABLE' }); return; }
        const batch = await provider.enqueue(input, request.headers['idempotency-key']);
        await respond(response, { batchId: batch.id, deliveryIds: batch.deliveries.map(x => x.id) }, fault);
      } else if (request.method === 'POST' && url.pathname === '/payment/tick') {
        await provider.tick({ force: true }); json(response, 200, provider.inspect());
      } else if (request.method === 'POST' && ['/email', '/extract', '/payment/events'].includes(url.pathname)) {
        const target = { '/email': 'email', '/extract': 'extract', '/payment/events': 'payment-events' }[url.pathname];
        const raw = await body(request);
        const fault = faultFor(target);
        if (fault?.kind === '503') { json(response, 503, { code: 'INJECTED_UNAVAILABLE' }); return; }
        const key = request.headers['idempotency-key'];
        insist(typeof key === 'string' && key.length > 0 && key.length <= 512, 'IDEMPOTENCY_KEY_REQUIRED');
        let result;
        if (target === 'payment-events') {
          result = await provider.create(JSON.parse(raw), key);
        } else {
          const collection = target === 'email' ? emails : extracts;
          const digest = sha256(raw), previous = collection.get(key);
          if (previous) {
            insist(previous.digest === digest, 'IDEMPOTENCY_INPUT_CHANGED'); result = previous;
          } else if (target === 'email') {
            const message = JSON.parse(raw);
            insist(['to', 'subject', 'body'].every(k => typeof message[k] === 'string' && message[k].length > 0)
              && Object.keys(message).every(k => ['to', 'subject', 'body'].includes(k))
              && /^[^\s@]+@workroom\.test$/.test(message.to), 'INVALID_EMAIL');
            result = { kind: 'email.accepted', key, digest, id: 'email-' + (emails.size + 1), message, time: Date.now() };
          } else {
            const asset = assets.find(x => x.sha256 === digest);
            insist(asset, 'UNKNOWN_FIXTURE_BYTES');
            result = { kind: 'extract.accepted', key, digest, sha256: digest, text: asset.text, contentType: asset.contentType };
          }
          if (!previous) { await journal.append(result); collection.set(key, result); }
        }
        await respond(response, result, fault);
      } else json(response, 404, { code: 'NOT_FOUND' });
    }).catch(error => {
      if (response.destroyed) return;
      const code = error.code ?? 'INVALID_REQUEST';
      json(response, code === 'UNAUTHORIZED' ? 401 : code === 'IDEMPOTENCY_INPUT_CHANGED' ? 409
        : code === 'BODY_TOO_LARGE' ? 413 : 400, { code });
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let timer;
  const schedule = () => {
    if (autoRetry && !stopped) timer = setTimeout(() => {
      serial(() => provider.tick()).catch(error => { server.emit('fixtureError', error); }).finally(schedule);
    }, retryMs);
  };
  schedule();
  return {
    url: `http://127.0.0.1:${server.address().port}`, server,
    async close() {
      stopped = true; if (timer) clearTimeout(timer);
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      await tail; await journal.close();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  insist(configPath, 'USAGE: node services.mjs /absolute/path/to/local-config.json');
  const service = await startServices(await readJson(configPath));
  console.log(JSON.stringify({ url: service.url, loopbackOnly: true }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));
}
