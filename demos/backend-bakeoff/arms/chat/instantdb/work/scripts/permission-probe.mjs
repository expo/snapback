import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { id, init } from '@instantdb/admin';

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
const data = await admin.query({ channels: {} });
const general = data.channels.find((channel) => channel.name === 'field-notes');
const calibration = data.channels.find(
  (channel) => channel.name === 'calibration',
);
const messageId = id();
await admin
  .asUser({ token: actors.bob.refreshToken })
  .transact(
    admin.tx.messages[messageId]
      .update({
        authorId: actors.bob.id,
        body: 'permission-probe',
        clientNonce: `permission-probe-${messageId}`,
        clientSentAt: new Date(),
      })
      .link({ channel: general.id }),
  );
const read = await admin.query({
  messages: { $: { where: { id: messageId } } },
});
await admin.transact(admin.tx.messages[messageId].delete());
await admin
  .asUser({ token: actors.alice.refreshToken })
  .transact(
    admin.tx.channels[calibration.id].unlink({
      allowedUsers: actors.bob.id,
    }),
  );
await admin.transact(
  admin.tx.channels[calibration.id].link({ allowedUsers: actors.bob.id }),
);
process.stdout.write(
  JSON.stringify({
    ok: read.messages.length === 1,
    membershipUnlinkAuthorized: true,
    messageIdSha256: createHash('sha256').update(messageId).digest('hex'),
  }) + '\n',
);
