// A fake local store for the EAS Payments slices — the stand-in for Apple,
// Google, and Stripe.
//
// It exists to make one architectural property testable: the Engine's
// authoritative state comes from *asking the store*, not from the payload that
// triggered the ask. So the store owns its answers, the test mutates them out
// of band with `setState`, and the handler never learns anything except by
// fetching.
//
// Two routes, both bearer-gated:
//   POST /validate                  { store, productId, receipt, environment }
//   GET  /transactions/:storeTxnId
//
// Both return the same document: { storeTxnId, productId, status, environment,
// expiresAt }. A wrong or missing bearer is 401 with no body of interest.

import { createServer } from 'node:http';

const THIRTY_DAYS_MS = 2_592_000_000;

/**
 * @param {{ apiKey: string, now?: number }} options
 */
export async function startFakeStore({ apiKey, now = Date.now() }) {
  // storeTxnId -> transaction document. Seeded lazily by /validate, mutable by
  // the test through setState so slice 3 can flip an answer between calls.
  const transactions = new Map();
  const requests = [];

  const defaultsFor = (storeTxnId, productId, environment) => ({
    storeTxnId,
    productId,
    status: 'active',
    environment,
    expiresAt: now + THIRTY_DAYS_MS,
  });

  const send = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(payload);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const authorized = req.headers.authorization === `Bearer ${apiKey}`;
    requests.push({ method: req.method, path: url.pathname, authorized });

    if (!authorized) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/validate') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: 'invalid json' });
        return;
      }
      const storeTxnId = `${body.store}:${body.receipt}`;
      if (!transactions.has(storeTxnId)) {
        transactions.set(
          storeTxnId,
          defaultsFor(storeTxnId, body.productId, body.environment),
        );
      }
      send(res, 200, transactions.get(storeTxnId));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/transactions/')) {
      const storeTxnId = decodeURIComponent(url.pathname.slice('/transactions/'.length));
      const found = transactions.get(storeTxnId);
      if (!found) {
        send(res, 404, { error: 'unknown transaction' });
        return;
      }
      send(res, 200, found);
      return;
    }

    send(res, 404, { error: 'unknown route' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    now,
    thirtyDaysMs: THIRTY_DAYS_MS,

    /** Preset or overwrite what the store will say about a transaction. */
    setState(storeTxnId, patch) {
      const current = transactions.get(storeTxnId)
        ?? defaultsFor(storeTxnId, patch.productId ?? 'unknown', patch.environment ?? 'sandbox');
      transactions.set(storeTxnId, { ...current, ...patch, storeTxnId });
      return transactions.get(storeTxnId);
    },

    getState(storeTxnId) {
      return transactions.get(storeTxnId) ?? null;
    },

    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
