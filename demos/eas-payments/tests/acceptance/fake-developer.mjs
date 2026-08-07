// A fake developer endpoint — the thing a customer of the Payments Engine
// would stand up to receive "something changed for this user" pings.
//
// It exists to make three things testable: that the ping body carries only
// { userId, seq }, that it authenticates, and that a failing endpoint is
// retried rather than dropped. `failNext(n)` makes the next n requests fail so
// a test can watch the retry ladder without sleeping.

import { createServer } from 'node:http';

/**
 * @param {{ secret: string }} options
 */
export async function startFakeDeveloper({ secret }) {
  const received = [];
  let failuresRemaining = 0;
  let failForever = false;

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const authorized = req.headers.authorization === `Bearer ${secret}`;
    const willFail = failForever || failuresRemaining > 0;
    if (failuresRemaining > 0) failuresRemaining -= 1;

    received.push({
      authorized,
      body,
      rawBody: raw,
      // Captured so a test can assert the ping is not carrying entitlement
      // state in a header either.
      headerNames: Object.keys(req.headers).sort(),
      outcome: !authorized ? 401 : willFail ? 503 : 200,
    });

    if (!authorized) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (willFail) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'temporarily unavailable' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/webhooks/entitlements`,
    received,

    /** Fail the next n requests with 503, then recover. */
    failNext(n) {
      failuresRemaining = n;
    },
    /** Fail every request until told otherwise. */
    failAlways(on) {
      failForever = on;
    },
    reset() {
      received.length = 0;
      failuresRemaining = 0;
      failForever = false;
    },

    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
