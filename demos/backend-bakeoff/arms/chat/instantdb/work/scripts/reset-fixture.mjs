import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init } from '@instantdb/admin';

const root = resolve(import.meta.dirname, '..');
const target = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/target.json'), 'utf8'),
);
const actors = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/actors.json'), 'utf8'),
);
const admin = init({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});
const receiptDir = resolve(root, '../receipts');
mkdirSync(receiptDir, { recursive: true });
const before = await admin.query({
  channels: { messages: {} },
  messages: {},
  readMarkers: {},
});
const nonSeed = before.messages.filter(
  (message) => !String(message.body).startsWith('seed-'),
);
for (let offset = 0; offset < nonSeed.length; offset += 100) {
  await admin.transact(
    nonSeed
      .slice(offset, offset + 100)
      .map((message) => admin.tx.messages[message.id].delete()),
  );
}
if (before.readMarkers.length) {
  await admin.transact(
    before.readMarkers.map((marker) => admin.tx.readMarkers[marker.id].delete()),
  );
}
for (const channel of before.channels.filter(
  (candidate) => candidate.visibility === 'private',
)) {
  await admin.transact(
    admin.tx.channels[channel.id].link({
      allowedUsers: [actors.alice.id, actors.bob.id],
    }),
  );
}
const after = await admin.query({
  channels: { messages: {} },
  messages: {},
  readMarkers: {},
});
const countsByChannel = Object.fromEntries(
  after.channels.map((channel) => [channel.name, channel.messages.length]),
);
const ok =
  after.channels.length === 4 &&
  after.messages.length === 500 &&
  after.readMarkers.length === 0 &&
  Object.values(countsByChannel).every((count) => count === 125);
const receipt = {
  operation: 'reset-frozen-chat-fixture-after-failed-run',
  targetIdSha256: createHash('sha256').update(target.appId).digest('hex'),
  removedNonSeedMessages: nonSeed.length,
  removedReadMarkers: before.readMarkers.length,
  restoredPrivateMemberships: 2,
  after: {
    channels: after.channels.length,
    messages: after.messages.length,
    readMarkers: after.readMarkers.length,
    messagesByChannel: countsByChannel,
  },
  ok,
  finishedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(receiptDir, `fixture-reset-${Date.now()}.json`),
  JSON.stringify(receipt, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(receipt) + '\n');
process.exit(ok ? 0 : 1);
