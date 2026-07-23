// Preregistered probe runner. Usage: node run-shape.mjs r2|r1
// R2: rule stays `data.visibleTo == auth.email`; revocation = admin updates row.visibleTo.
// R1: rule goes from `auth.id != null` to `false` while client stays connected.
import {
  APP_ID, USER_EMAIL, OTHER_EMAIL,
  makeCoreClient, makeAdmin, adminId,
  makeLog, writeReceipts, pushPerms, observeWindow, sleep, redact,
} from './probe-lib.mjs';

const shape = process.argv[2];
if (shape !== 'r1' && shape !== 'r2') {
  console.error('usage: node run-shape.mjs r1|r2');
  process.exit(2);
}

const { events, log } = makeLog();
log('start', { shape, app_id: APP_ID, user_email: USER_EMAIL });

const admin = makeAdmin();

// --- 1. set the pre-revocation view rule ---
const preRule =
  shape === 'r2' ? 'data.visibleTo == auth.email' : 'auth.id != null';
await pushPerms({ probe_items: { allow: { view: preRule } } }, log);

// --- 2. create the target row via admin SDK ---
const rowId = adminId();
const t0 = Date.now();
const txRes = await admin.transact([
  admin.tx.probe_items[rowId].update({
    title: `target-${shape}`,
    visibleTo: USER_EMAIL,
    createdAt: new Date().toISOString(),
  }),
]);
log('admin-create-row-ack', { rowId, txRes, roundtrip_ms: Date.now() - t0 });

// --- 3. mint a token for the test user ---
const userToken = await admin.auth.createToken({ email: USER_EMAIL });
log('token-minted', { email: USER_EMAIL, token_len: String(userToken).length });

// --- 4. live client: sign in + subscribe ---
const db = makeCoreClient();

const state = {
  latestIds: null,
  callbacksAfterAck: [],
  reconnectAfterAck: false,
  ackMs: null,
  allCallbacks: 0,
};

let authedCount = 0;
db.subscribeConnectionStatus((status) => {
  log('connection-status', { status });
  if (status === 'authenticated') authedCount++;
  if (state.ackMs !== null) {
    if (status === 'closed' || status === 'errored' || status === 'connecting') {
      state.reconnectAfterAck = true;
    }
  }
});

await db.auth.signInWithToken(userToken);
const user = await db.getAuth();
log('client-signed-in', { user_email: user?.email, user_id: user?.id });

let resolveDelivered;
const delivered = new Promise((res) => (resolveDelivered = res));

db.subscribeQuery({ probe_items: {} }, (resp) => {
  const ts = new Date().toISOString();
  const t_ms = Date.now();
  state.allCallbacks++;
  if (resp.error) {
    log('subscription-error', { error: resp.error });
    return;
  }
  const items = resp.data?.probe_items ?? [];
  const ids = items.map((i) => i.id);
  state.latestIds = new Set(ids);
  const entry = { ts, t_ms, ids, items };
  log('subscription-callback', { ids, n: items.length });
  if (state.ackMs !== null) state.callbacksAfterAck.push(entry);
  if (ids.includes(rowId)) resolveDelivered();
});

const deliveredInTime = await Promise.race([
  delivered.then(() => true),
  sleep(30000).then(() => false),
]);
if (!deliveredInTime) {
  log('abort', { reason: 'target row not delivered to live client within 30s' });
  writeReceipts(`receipts-${shape}.json`, { shape, app_id: APP_ID, aborted: true, events });
  process.exit(1);
}
log('target-row-delivered', { rowId });

// small settle to make sure we're steady-state
await sleep(2000);

// --- 5. revocation ---
let ackEvent;
if (shape === 'r2') {
  const t1 = Date.now();
  const res = await admin.transact([
    admin.tx.probe_items[rowId].update({ visibleTo: OTHER_EMAIL }),
  ]);
  state.ackMs = Date.now();
  ackEvent = log('revocation-ack', {
    kind: 'admin-update-visibleTo',
    newValue: OTHER_EMAIL,
    txRes: res,
    roundtrip_ms: state.ackMs - t1,
  });
} else {
  const e = await pushPerms({ probe_items: { allow: { view: 'false' } } }, log);
  state.ackMs = Date.now();
  ackEvent = log('revocation-ack', { kind: 'perms-push-view-false' });
}

// --- 6. observation window (T = 120 s, checkpoints 5/15/30/60/120) ---
const verdict = await observeWindow({ state, targetId: rowId, ackMs: state.ackMs, log });

writeReceipts(`receipts-${shape}.json`, {
  shape,
  app_id: APP_ID,
  user_email: USER_EMAIL,
  rowId,
  pre_rule: preRule,
  revocation: shape === 'r2'
    ? { kind: 'admin-update-visibleTo', to: OTHER_EMAIL }
    : { kind: 'perms-push', rule: 'false' },
  verdict,
  events,
});

console.log('FINAL', shape.toUpperCase(), JSON.stringify(verdict));
process.exit(0);
