import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  actorEmail,
  dbForTarget,
  namespace,
  readTarget,
  receiptsDir,
  runtimeDir,
  sha256,
  waitFor,
  writeJson,
} from './lib.mjs';

const target = readTarget();
const db = dbForTarget(target);
const fixture = JSON.parse(readFileSync(resolve(runtimeDir, 'fixture.json'), 'utf8'));
const alice = db.asUser({ email: actorEmail('alice') });
const bob = db.asUser({ email: actorEmail('bob') });
const query = {
  invitations: { $: { where: { eventId: fixture.contendedEventId } } },
};
const startedAt = new Date().toISOString();
const initialPayloads = [];
const postWritePayloads = [];
const restorationPayloads = [];
let phase = 'initial';

function plain(value) {
  const serialized = JSON.stringify(value, (key, item) => {
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        body: item.body,
        stack: item.stack?.split('\n').slice(0, 4).join('\n'),
      };
    }
    return item;
  });
  return JSON.parse(
    serialized
      .replaceAll(target.adminToken, '[ADMIN_TOKEN]')
      .replaceAll(target.appId, '[APP_ID]'),
  );
}

function capture(payload) {
  const record = {
    receivedAt: new Date().toISOString(),
    phase,
    payload: plain(payload),
  };
  if (phase === 'initial') initialPayloads.push(record);
  else if (phase === 'false-write' || phase === 'false-window') postWritePayloads.push(record);
  else restorationPayloads.push(record);
}

const subscription = bob.subscribeQuery(query, capture);
let falseWrite;
let hostFalseRead;
let freshBobRead;
let hostTrueRead;
let restoreWrite;
let diagnosticError = null;

try {
  await waitFor(
    () =>
      initialPayloads.some(
        (record) =>
          record.payload?.type !== 'error' &&
          record.payload?.data?.invitations?.length === 49,
      ),
    { timeoutMs: 12000, intervalMs: 50 },
  );

  phase = 'false-write';
  falseWrite = {
    invokedAt: new Date().toISOString(),
  };
  await alice.transact(
    alice.tx.events[fixture.contendedEventId].update({ guestListVisible: false }),
  );
  falseWrite.acknowledgedAt = new Date().toISOString();
  phase = 'false-window';

  const hostState = await alice.query({
    events: { $: { where: { id: fixture.contendedEventId } } },
  });
  hostFalseRead = {
    readAt: new Date().toISOString(),
    eventCount: hostState.events.length,
    guestListVisible: hostState.events[0]?.guestListVisible,
  };

  try {
    const fresh = await bob.query(query);
    freshBobRead = {
      completedAt: new Date().toISOString(),
      kind: 'success',
      payload: plain({ type: 'result', data: fresh }),
    };
  } catch (error) {
    freshBobRead = {
      completedAt: new Date().toISOString(),
      kind: 'error',
      payload: plain(error),
    };
  }

  const windowEndsAt = Date.now() + 12000;
  while (Date.now() < windowEndsAt) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
} catch (error) {
  diagnosticError = plain(error);
} finally {
  phase = 'restore-write';
  restoreWrite = { invokedAt: new Date().toISOString() };
  await db.transact(
    db.tx.events[fixture.contendedEventId].update({ guestListVisible: true }),
  );
  restoreWrite.acknowledgedAt = new Date().toISOString();
  phase = 'restored';
  const restored = await alice.query({
    events: { $: { where: { id: fixture.contendedEventId } } },
  });
  hostTrueRead = {
    readAt: new Date().toISOString(),
    eventCount: restored.events.length,
    guestListVisible: restored.events[0]?.guestListVisible,
  };
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  subscription.close();
}

const freshCount =
  freshBobRead?.kind === 'success'
    ? freshBobRead.payload?.data?.invitations?.length
    : null;
const postWriteCounts = postWritePayloads
  .filter((record) => record.payload?.type !== 'error')
  .map((record) => record.payload?.data?.invitations?.length);
const postWriteErrors = postWritePayloads.filter((record) => record.payload?.type === 'error');
let classification = 'inconclusive';
if (hostFalseRead?.guestListVisible === false && freshCount === 49) {
  classification = 'active-disclosure';
} else if (
  hostFalseRead?.guestListVisible === false &&
  freshBobRead?.kind === 'success' &&
  freshCount === 0 &&
  !postWriteCounts.includes(0)
) {
  classification = 'stream-only-invalidation';
} else if (
  hostFalseRead?.guestListVisible === false &&
  freshBobRead?.kind === 'error'
) {
  classification = 'authorization-error';
}

const receipt = {
  schemaVersion: 1,
  diagnostic: 'PARTY-05 already-connected guest-list revocation',
  startedAt,
  finishedAt: new Date().toISOString(),
  targetIdSha256: sha256(target.appId),
  deployedConfigurationChanged: false,
  targetDataChanges: [
    'events[contended].guestListVisible true -> false',
    'events[contended].guestListVisible false -> true',
  ],
  initialProof: {
    expectedCount: 49,
    payloads: initialPayloads,
  },
  falseWrite,
  authoritativeHostReadWhileFalse: hostFalseRead,
  freshBobReadWhileFalse: freshBobRead,
  postWriteSseWindowMs: 12000,
  postWriteSsePayloads: postWritePayloads,
  restoration: {
    restoreWrite,
    authoritativeHostRead: hostTrueRead,
    ssePayloads: restorationPayloads,
  },
  classification,
  classificationInputs: {
    freshBobCountWhileFalse: freshCount,
    postWriteSuccessCounts: postWriteCounts,
    postWriteErrorCount: postWriteErrors.length,
  },
  diagnosticError,
  credentialValuesPresent: false,
};
writeJson(resolve(receiptsDir, 'guest-list-revocation-diagnostic.json'), receipt);
process.stdout.write(`${JSON.stringify({
  classification,
  authoritativeFalse: hostFalseRead?.guestListVisible,
  freshBobCountWhileFalse: freshCount,
  postWriteSuccessCounts: postWriteCounts,
  postWriteErrorCount: postWriteErrors.length,
  restored: hostTrueRead?.guestListVisible,
})}\n`);
