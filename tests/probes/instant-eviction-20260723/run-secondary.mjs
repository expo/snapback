// Secondary observation: fresh client instance (new process), same user.
// Records whether the target row is served on reconnect after revocation.
// Usage: node run-secondary.mjs <shape> <rowId>
import {
  APP_ID, USER_EMAIL,
  makeCoreClient, makeAdmin,
  makeLog, writeReceipts, sleep,
} from './probe-lib.mjs';

const shape = process.argv[2];
const rowId = process.argv[3];
if (!shape || !rowId) {
  console.error('usage: node run-secondary.mjs <shape> <rowId>');
  process.exit(2);
}

const { events, log } = makeLog();
log('secondary-start', { shape, app_id: APP_ID, rowId, user_email: USER_EMAIL });

const admin = makeAdmin();
const userToken = await admin.auth.createToken({ email: USER_EMAIL });
log('token-minted', { email: USER_EMAIL });

const db = makeCoreClient();
db.subscribeConnectionStatus((status) => log('connection-status', { status }));
await db.auth.signInWithToken(userToken);
const user = await db.getAuth();
log('client-signed-in', { user_email: user?.email });

let latest = null;
db.subscribeQuery({ probe_items: {} }, (resp) => {
  if (resp.error) {
    log('subscription-error', { error: resp.error });
    return;
  }
  const ids = (resp.data?.probe_items ?? []).map((i) => i.id);
  latest = ids;
  log('subscription-callback', { ids, target_present: ids.includes(rowId) });
});

await sleep(20000);
const served = latest === null ? null : latest.includes(rowId);
const result = { shape, rowId, row_served_on_fresh_client: served, latest_ids: latest };
log('secondary-final', result);
writeReceipts(`receipts-${shape}-secondary.json`, { ...result, events });
console.log('SECONDARY FINAL', JSON.stringify(result));
process.exit(0);
