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
// expiresAt?, graceUntil?, resumesAt? }. A wrong or missing bearer is 401 with
// no body of interest.
//
// `status` is the normalized lifecycle vocabulary the engine validates:
// 'active' | 'grace' | 'retry_hold' | 'paused' | 'pending' | 'expired' |
// 'revoked'. The three horizon fields are genuinely optional — a pending
// purchase has no expiry yet — and a real store omits them the same way.
//
// Scripted transitions (`script` + `advance`) exist because the lifecycle is
// about a subscription MOVING between states, and a test that can only set one
// state at a time cannot express "recovers" versus "lapses". Advancing is
// explicit rather than read-triggered so the suite decides exactly when the
// store changes its mind — `applyStoreState` reads once per call, and a
// self-advancing fixture would couple the transition to the number of fetches.

import { createServer } from 'node:http';

const THIRTY_DAYS_MS = 2_592_000_000;
const SIXTY_DAYS_MS = 5_184_000_000;

// The canonical lifecycle scripts, as ordered patches. `null` in a patch means
// "clear this field", which is what makes a recovery genuinely clear the grace
// window instead of leaving a stale one behind.
//
// Every offset is derived from the store's fixed `now`, so a script is
// deterministic: the same name yields the same documents on every run.
function scriptSteps(name, now) {
  const past = now - 1_000;
  const soon = now + THIRTY_DAYS_MS;
  const far = now + SIXTY_DAYS_MS;
  // Billing failed: the paid window has closed (expiresAt in the past) and the
  // store is holding access open until graceUntil.
  const intoGrace = { status: 'grace', expiresAt: past, graceUntil: far, resumesAt: null };
  if (name === 'active->grace->active') {
    return [
      { status: 'active', expiresAt: soon, graceUntil: null, resumesAt: null },
      intoGrace,
      // Recovered: a fresh paid window, and the grace window is cleared.
      { status: 'active', expiresAt: far, graceUntil: null, resumesAt: null },
    ];
  }
  if (name === 'active->grace->expired') {
    return [
      { status: 'active', expiresAt: soon, graceUntil: null, resumesAt: null },
      intoGrace,
      // The store itself gives up: a store-driven expiry, no sweep involved.
      { status: 'expired', expiresAt: past, graceUntil: null, resumesAt: null },
    ];
  }
  if (name === 'active->grace->lapse') {
    return [
      { status: 'active', expiresAt: soon, graceUntil: null, resumesAt: null },
      intoGrace,
      // Still 'grace' at the store, but the window has closed. This is the
      // clock-substitute for "time passed": the suite cannot advance the real
      // clock, so it moves the deadline into the past instead and lets the
      // expiry sweep be the thing that notices.
      { status: 'grace', expiresAt: past, graceUntil: past, resumesAt: null },
    ];
  }
  if (name === 'active->retry_hold->active') {
    return [
      { status: 'active', expiresAt: soon, graceUntil: null, resumesAt: null },
      // Access off, subscription alive. expiresAt stays in the past on purpose:
      // a date-only sweep would treat this as expired, and it must not.
      { status: 'retry_hold', expiresAt: past, graceUntil: null, resumesAt: null },
      { status: 'active', expiresAt: far, graceUntil: null, resumesAt: null },
    ];
  }
  if (name === 'active->paused->active') {
    return [
      { status: 'active', expiresAt: soon, graceUntil: null, resumesAt: null },
      // resumesAt is a future RESUME, not a deadline — the trap a sweep reading
      // "any future timestamp" as an expiry would fall into.
      { status: 'paused', expiresAt: past, graceUntil: null, resumesAt: far },
      { status: 'active', expiresAt: far, graceUntil: null, resumesAt: null },
    ];
  }
  if (name === 'pending->active') {
    return [
      // No expiresAt at all: nothing has been bought yet.
      { status: 'pending', expiresAt: null, graceUntil: null, resumesAt: null },
      { status: 'active', expiresAt: far, graceUntil: null, resumesAt: null },
    ];
  }
  if (name === 'pending->canceled') {
    return [
      { status: 'pending', expiresAt: null, graceUntil: null, resumesAt: null },
      // 'canceled' is not in the engine's vocabulary, and deliberately so: a
      // payment that never cleared is 'revoked', not 'expired'. Expired means a
      // window closed, and this one never opened.
      { status: 'revoked', expiresAt: null, graceUntil: null, resumesAt: null },
    ];
  }
  throw new Error('unknown transition script: ' + name);
}

// Apply one script step, honouring `null` as a field deletion so a document can
// genuinely lose its graceUntil rather than carry a stale one.
function applyPatch(current, patch) {
  const next = { ...current };
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete next[key];
    else next[key] = patch[key];
  }
  return next;
}

/**
 * @param {{ apiKey: string, now?: number }} options
 */
export async function startFakeStore({ apiKey, now = Date.now() }) {
  // storeTxnId -> transaction document. Seeded lazily by /validate, mutable by
  // the test through setState so slice 3 can flip an answer between calls.
  const transactions = new Map();
  const requests = [];
  // storeTxnId -> { steps, at }. Installed by `script`, stepped by `advance`.
  const scripts = new Map();

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
    sixtyDaysMs: SIXTY_DAYS_MS,

    /** Preset or overwrite what the store will say about a transaction. */
    setState(storeTxnId, patch) {
      const current = transactions.get(storeTxnId)
        ?? defaultsFor(storeTxnId, patch.productId ?? 'unknown', patch.environment ?? 'sandbox');
      transactions.set(storeTxnId, applyPatch({ ...current }, { ...patch, storeTxnId }));
      return transactions.get(storeTxnId);
    },

    getState(storeTxnId) {
      return transactions.get(storeTxnId) ?? null;
    },

    /**
     * Install a named lifecycle script and apply its FIRST step immediately, so
     * the transaction exists in its opening state before anyone fetches it.
     * Returns the opening document.
     */
    script(storeTxnId, name, { productId = 'unknown', environment = 'sandbox' } = {}) {
      const steps = scriptSteps(name, now);
      scripts.set(storeTxnId, { steps, at: 0 });
      const base = transactions.get(storeTxnId)
        ?? defaultsFor(storeTxnId, productId, environment);
      transactions.set(storeTxnId, applyPatch({ ...base, storeTxnId }, steps[0]));
      return transactions.get(storeTxnId);
    },

    /**
     * Advance to the next scripted step. Throws past the end rather than
     * silently repeating the last state — a test that over-advances is asserting
     * on a transition the script never described.
     */
    advance(storeTxnId) {
      const script = scripts.get(storeTxnId);
      if (!script) throw new Error('no script installed for ' + storeTxnId);
      const next = script.at + 1;
      if (next >= script.steps.length) {
        throw new Error(`script for ${storeTxnId} has no step after ${script.at}`);
      }
      script.at = next;
      transactions.set(
        storeTxnId,
        applyPatch(transactions.get(storeTxnId), script.steps[next]),
      );
      return transactions.get(storeTxnId);
    },

    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
