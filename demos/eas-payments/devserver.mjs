// EAS Payments — local dev server for the first end-user client.
//
// Not a test. This is the acceptance harness's startup (fake store + a real
// snapback server + schema/functions load + seed) held open behind a small
// HTTP proxy, so a real client app can drive the purchase -> entitlement loop
// without an SDK. There is no SDK yet, so the app speaks plain JSON to this
// process and never holds the admin token.
//
// Two route namespaces, deliberately separated (decision 11):
//   runtime    (/products, /buy, /entitlements)  — what the end-user app uses,
//              keyed by an app user id.
//   management (/admin/*)                        — what the developer dashboard
//              uses. In production this is the project-secret-key API; the POC
//              collapses that distinction and this proxy stands in for it.
//
// Run: node demos/eas-payments/devserver.mjs
// Uncommitted: this is a local demo driver, not part of the repo's surface.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient } from '../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../_kit/generated-artifacts.mjs';
import { startServer } from '../_kit/server-process.mjs';
import { startFakeStore } from './tests/acceptance/fake-store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const backendDir = join(here, 'snapback');
const generatedRoot = join(backendDir, 'generated');

const PORT = Number(process.env.PORT ?? 8787);
const STORE_KEY = 'fake-store-key-slice-2';

const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');
const schemaManifest = gen('schema.manifest.json');
const functionManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

// --- startup (mirrors tests/acceptance/headless.mjs) --------------------------

const store = await startFakeStore({ apiKey: STORE_KEY });
console.log(`[devserver] fake store  ${store.baseUrl}`);

const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  cronDisabled: true,
  // Generation opting in does not grant the process network authority; the
  // runtime is the security boundary and needs its own opt-in. Jobs stay inert
  // too — this demo has no webhook endpoint to deliver to.
  env: { SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_JOBS_DISABLED: '1' },
  provenance: {
    appId: 'eas-payments',
    artifactsPath: join(generatedRoot, 'artifacts.json'),
  },
});
console.log(`[devserver] snapback    ${server.baseUrl}`);

const db = new SnapbackClient(server.baseUrl, server.clientOptions);

const schemaRes = await db.loadSchema(schemaManifest);
const schemaErrors = schemaRes.diagnostics.filter(
  (d) => d.severity === 'Error' || d.severity === 'Fatal',
);
if (schemaErrors.length > 0) {
  throw new Error(`schema load failed: ${JSON.stringify(schemaErrors)}`);
}
await db.loadFunctions(functionManifest);

// Config entries are declared in the function manifest, so the deployment
// value can only be set once that manifest is loaded.
const setConfig = async (entry, value) => {
  const res = await fetch(`${server.baseUrl}/_snapback/api/config/set`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify({ entry, value }),
  });
  if (!res.ok) throw new Error(`config set failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};
await setConfig('storeValidation', STORE_KEY);

await db.reset();
await db.seed(seed);
console.log('[devserver] seeded      pro_monthly, pro_annual, plus_monthly, coins_100');

// --- HTTP proxy ---------------------------------------------------------------

// Who the dashboard's writes are attributed to.
//
// The catalog mutations are `auth: 'authenticated'`, which is the strongest
// requirement the closed vocabulary offers, so they need an identity — and
// there is no secret tier to name a management one. This constant stands in for
// the project secret key a real deployment would authenticate with. The engine
// would accept any authenticated user here; what makes these management-only is
// that they are reachable through /admin/* on this proxy and nowhere else.
const DASHBOARD_USER = 'dashboard';

// path -> the mutation it commits. Every route is a POST with a JSON body whose
// keys are the mutation's own arguments, so there is nothing to translate.
const CATALOG_WRITES = {
  // Not catalog, but the same shape: a management POST whose JSON body is the
  // mutation's own arguments. The developer calls this when they have given the
  // user what they bought (slice 13).
  '/admin/fulfillment/acknowledge': api.acknowledgeConsumption,
  '/admin/packages/create': api.createPackage,
  '/admin/packages/update': api.updatePackage,
  '/admin/packages/delete': api.deletePackage,
  '/admin/products/create': api.createProduct,
  '/admin/products/update': api.updateProduct,
  '/admin/products/delete': api.deleteProduct,
  '/admin/entitlements/create': api.createEntitlement,
  '/admin/entitlements/update': api.updateEntitlement,
  '/admin/entitlements/delete': api.deleteEntitlement,
  '/admin/mappings/add': api.addProductEntitlement,
  '/admin/mappings/remove': api.removeProductEntitlement,
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

// The developer dashboard is its own client codebase living outside this repo;
// serving its single file here is only so the POC needs one process.
const DASHBOARD_FILE = join(
  process.env.HOME ?? '',
  'projects',
  'eas-payments-dashboard',
  'index.html',
);

const proxy = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    // --- runtime API (the end-user app) --------------------------------------

    // The storefront. One row per PACKAGE — the cross-platform thing a user
    // picks — each carrying the store SKUs it is sold as, so the client can
    // resolve "Pro, monthly" to the SKU for the platform it is running on.
    // That resolution is the client's job precisely because it is the only
    // party that knows which store it is talking to.
    if (req.method === 'GET' && path === '/products') {
      const [packages, products] = await Promise.all([
        db.query(api.listPackages, {}),
        db.query(api.listProducts, {}),
      ]);
      send(res, 200, packages.rows.map((pkg) => ({
        packageId: pkg.packageId,
        title: pkg.title,
        kind: pkg.kind,
        skus: products.rows
          .filter((sku) => sku.packageId === pkg.packageId)
          .map((sku) => ({ store: sku.store, productId: sku.productId })),
      })));
      return;
    }

    if (req.method === 'POST' && path === '/buy') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const { userId, productId } = body;
      // The client names a STORE SKU and the store that issued it (slice 12) —
      // never a package. `apple` stays the default only because this proxy
      // predates the SKU model and the Expo client simulates Apple purchases.
      const storeName = body.store ?? 'apple';
      if (!userId || !productId) {
        send(res, 400, { error: 'userId and productId (a store SKU) are required' });
        return;
      }
      // A simulated purchase: a unique receipt the fake store has never seen,
      // which it therefore mints as a fresh active 30-day transaction.
      const receipt = `receipt_${userId}_${productId}_${Date.now()}`;
      const out = await db.action(api.validateReceipt, {
        args: {
          storeBaseUrl: store.baseUrl,
          productId,
          store: storeName,
          receipt,
          environment: 'sandbox',
        },
        userId,
      });
      if (!out.ok) {
        send(res, 400, { ok: false, diagnostic: out.diagnostic ?? null });
        return;
      }
      send(res, 200, { ok: true, result: out.result });
      return;
    }

    if (req.method === 'GET' && path === '/entitlements') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        send(res, 400, { error: 'userId is required' });
        return;
      }
      const { rows } = await db.query(api.getEntitlements, { userId });
      send(res, 200, rows);
      return;
    }

    // The purchase audit. Runtime, not management: the app shows the user their
    // own coins, and a consumable is invisible to /entitlements by design.
    if (req.method === 'GET' && path === '/purchases') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        send(res, 400, { error: 'userId is required' });
        return;
      }
      const { rows } = await db.query(api.listPurchases, { userId });
      send(res, 200, rows);
      return;
    }

    // --- management API (the developer dashboard) ----------------------------

    if (req.method === 'GET' && path === '/admin/changes') {
      const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? 0) || 0;
      const { rows } = await db.query(api.pollChanges, { args: { sinceSeq } });
      send(res, 200, rows);
      return;
    }

    // The catalog graph in one payload: entitlement definitions, products with
    // their per-store ids, and the edges between them. Three reads rather than
    // one join, because the join belongs to the dashboard — a developer looking
    // at a mis-sold bundle wants to see an edge pointing at a product that does
    // not exist, and a server-side join would silently drop it.
    if (req.method === 'GET' && path === '/admin/catalog') {
      const [packages, products, entitlements, productEntitlements] = await Promise.all([
        db.query(api.listPackages, {}),
        db.query(api.listProducts, {}),
        db.query(api.listEntitlements, {}),
        db.query(api.listProductEntitlements, {}),
      ]);
      send(res, 200, {
        packages: packages.rows,
        products: products.rows,
        entitlements: entitlements.rows,
        productEntitlements: productEntitlements.rows,
      });
      return;
    }

    // The catalog write surface. One shape for all eight, because they differ
    // only in which mutation they name — the interesting decisions all live in
    // the handlers, not here.
    //
    // A refusal comes back as 400 with the stable diagnostic CODE, not prose:
    // the dashboard distinguishes "that id is taken"
    // (SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION) from a guard failure
    // (SNAPBACK_HANDLER_FAILED), and a message string is not a contract.
    if (req.method === 'POST' && CATALOG_WRITES[path]) {
      const body = JSON.parse((await readBody(req)) || '{}');
      try {
        const out = await db.mutate(CATALOG_WRITES[path], {
          args: body,
          userId: DASHBOARD_USER,
        });
        send(res, 200, { ok: true, result: out.result });
      } catch (error) {
        send(res, 400, {
          ok: false,
          code: error?.diagnostic?.code ?? 'UNKNOWN',
          message: String(error?.message ?? error),
        });
      }
      return;
    }

    // One customer's derived entitlements, read through the SAME query the app
    // uses. The dashboard must not get a second opinion: if a developer and
    // their user ever disagree about what is granted, the bug is real and this
    // route would have hidden it behind a management-only derivation.
    if (req.method === 'GET' && path === '/admin/customer') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        send(res, 400, { error: 'userId is required' });
        return;
      }
      const { rows } = await db.query(api.getEntitlements, { userId });
      send(res, 200, { userId, entitlements: rows });
      return;
    }

    // The customer directory (slice 13). Derived from `transactions`, not from
    // the change feed: a consumable-only buyer used to be invisible here,
    // because a consumable grants nothing and therefore never ticked the
    // entitlement feed. They had paid us and did not appear.
    if (req.method === 'GET' && path === '/admin/customers') {
      const { rows } = await db.query(api.listCustomers, {});
      send(res, 200, rows);
      return;
    }

    // The delivery ledger — one row per webhook ATTEMPT, so the retry ladder is
    // visible after the fact rather than only in the job's own state.
    //
    // The engine has had this query since slice 5; the devserver simply never
    // exposed it, which is why the dashboard's Delivery column carried a
    // "no endpoint" marker until slice 13.
    if (req.method === 'GET' && path === '/admin/deliveries') {
      const { rows } = await db.query(api.listDeliveries, {});
      send(res, 200, rows);
      return;
    }

    // The same audit under the management namespace. The dashboard is a
    // developer tool inspecting someone else's purchases, so it reads it here
    // rather than borrowing the app's runtime route — in production these are
    // two different APIs with two different keys (decision 11).
    if (req.method === 'GET' && path === '/admin/purchases') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        send(res, 400, { error: 'userId is required' });
        return;
      }
      const { rows } = await db.query(api.listPurchases, { userId });
      send(res, 200, rows);
      return;
    }

    // --- the dashboard client itself ----------------------------------------

    if (req.method === 'GET' && (path === '/' || path === '/dashboard')) {
      try {
        const html = readFileSync(DASHBOARD_FILE, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...CORS });
        res.end(html);
      } catch {
        send(res, 404, { error: `dashboard not found at ${DASHBOARD_FILE}` });
      }
      return;
    }

    send(res, 404, { error: `unknown route ${req.method} ${path}` });
  } catch (error) {
    send(res, 500, { error: String(error?.message ?? error), diagnostic: error?.diagnostic ?? null });
  }
});

await new Promise((resolve, reject) => {
  proxy.once('error', reject);
  proxy.listen(PORT, '0.0.0.0', resolve);
});
console.log(`[devserver] ready on :${PORT}`);
console.log('[devserver]   runtime    GET /products (packages+skus)  POST /buy {userId,store,productId}  GET /entitlements?userId=  GET /purchases?userId=');
console.log('[devserver]   management GET /admin/changes?sinceSeq=  GET /admin/customers  GET /admin/purchases?userId=');
console.log('[devserver]              GET /admin/deliveries');
console.log('[devserver]              GET /admin/catalog  GET /admin/customer?userId=');
for (const route of Object.keys(CATALOG_WRITES)) console.log(`[devserver]              POST ${route}`);
console.log('[devserver]   dashboard  GET /  (serves ~/projects/eas-payments-dashboard/index.html)');

const shutdown = async () => {
  console.log('\n[devserver] shutting down');
  proxy.close();
  try { await server.stop(); } catch {}
  try { await store.close(); } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
