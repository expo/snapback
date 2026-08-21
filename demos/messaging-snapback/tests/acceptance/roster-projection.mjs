// Messaging roster-projection acceptance.
//
// @ref LLP 0240#authority-facts-versus-product-facts
// — this proves today's sanctioned app-maintained projection discipline; it
// does not pre-commit to the generated D0.4 projection design.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));
const suite = createSuite('messaging-snapback / roster projection', { expectedChecks: 2 });

const OWNER = 'roster_owner';
const MEMBER_A = 'roster_member_a';
const MEMBER_B = 'roster_member_b';
const LATER_MEMBER = 'roster_later_member';

let server;
let client;

const mutate = (ref, args, userId) => client.mutate(ref, { args, userId });
const query = (ref, args, userId) => client.query(ref, { args, userId });

async function captureRejection(promise, label) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(`${label} unexpectedly fulfilled`);
}

async function assertRosterSynchronized(conversationId, label) {
  // The profile's bounded list is the admitted authority view: it exposes no
  // private row id. Compare it with the ordinary product query after every
  // app-owned transition so a missed companion write fails this acceptance.
  const [authority, projection] = await Promise.all([
    query(api.conversationMemberships.list, { scopeId: conversationId }, OWNER),
    query(api.conversationRoster, { conversationId }, OWNER),
  ]);
  const normalize = (rows) => rows
    .map((row) => `${row.userHandle}:${row.role}`)
    .sort();
  assertEqual(
    normalize(projection.rows),
    normalize(authority.rows),
    `${label}: product roster matches admitted authority roster`,
  );
  return normalize(authority.rows);
}

async function promoteMember(conversationId, userHandle) {
  const roster = await query(api.conversationRoster, { conversationId }, OWNER);
  const current = roster.rows.find((member) => member.userHandle === userHandle);
  if (!current) return { outcome: 'absent' };
  if (current.role === 'moderator') return { outcome: 'unchanged' };
  await mutate(api.conversationMemberships.changeRole, {
    scopeId: conversationId,
    principal: userHandle,
    role: 'moderator',
  }, OWNER);
  return (await mutate(api.promoteConversationMember, {
    conversationId,
    userHandle,
  }, OWNER)).result;
}

async function removeMember(conversationId, userHandle) {
  const roster = await query(api.conversationRoster, { conversationId }, OWNER);
  if (!roster.rows.some((member) => member.userHandle === userHandle)) {
    return { outcome: 'unchanged' };
  }
  await mutate(api.conversationMemberships.remove, {
    scopeId: conversationId,
    principal: userHandle,
  }, OWNER);
  return (await mutate(api.removeConversationMember, {
    conversationId,
    userHandle,
  }, OWNER)).result;
}

await runAcceptance(suite, async () => {
  try {
    server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      provenance: {
        appId: 'messaging-snapback',
        artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
      },
    });
    client = new SnapbackClient(server.baseUrl, server.clientOptions);

    await suite.check('isolated dev server loads the roster-profile artifacts', async () => {
      const schemaLoad = await client.loadSchema(generated('schema.manifest.json'));
      assertEqual(
        schemaLoad.diagnostics.filter(({ severity }) => severity === 'Error' || severity === 'Fatal'),
        [],
        'schema diagnostics',
      );
      const functionsLoad = await client.loadFunctions(generated('functions.manifest.json'));
      assertEqual(
        functionsLoad.diagnostics.filter(({ severity }) => severity === 'Error' || severity === 'Fatal'),
        [],
        'function diagnostics',
      );
      await client.reset();
      assert((await client.health()).ok, 'server health is not ok');
    });

    await suite.check('bootstrap/add/promote/remove/leave stay synchronized and receipts stay frozen', async () => {
      const created = await mutate(api.createGroup, {
        title: 'Roster invariant room',
        creatorHandle: 'caller-asserted-owner',
        creatorName: 'Owner',
        memberHandles: [MEMBER_A],
      }, OWNER);
      const conversationId = created.result;
      assertEqual(
        await assertRosterSynchronized(conversationId, 'bootstrap'),
        [`${MEMBER_A}:member`, `${OWNER}:owner`].sort(),
        'bootstrap seats the exact initial roster',
      );

      assertEqual((await mutate(api.addConversationMember, {
        conversationId, userHandle: MEMBER_B,
      }, OWNER)).result.outcome, 'changed', 'first add changes both rosters');
      assertEqual((await mutate(api.addConversationMember, {
        conversationId, userHandle: MEMBER_B,
      }, OWNER)).result.outcome, 'unchanged', 'repeated add is idempotent');
      await assertRosterSynchronized(conversationId, 'add and retry');

      assertEqual((await promoteMember(conversationId, MEMBER_B)).outcome,
        'changed', 'promotion changes authority and display role');
      assertEqual((await promoteMember(conversationId, MEMBER_B)).outcome,
        'unchanged', 'repeated promotion is idempotent');
      assertEqual((await promoteMember(conversationId, LATER_MEMBER)).outcome,
        'absent', 'promotion has an explicit absent branch');
      await assertRosterSynchronized(conversationId, 'promotion branches');

      const sent = await mutate(api.sendMessage, {
        conversationId,
        authorHandle: OWNER,
        authorName: 'Owner',
        body: 'Frozen recipient check',
      }, OWNER);
      assertEqual((await mutate(api.acknowledgeMessage, {
        messageId: sent.result, kind: 'read',
      }, MEMBER_B)).result.outcome, 'changed', 'first receipt acknowledgement changes state');
      assertEqual((await mutate(api.acknowledgeMessage, {
        messageId: sent.result, kind: 'read',
      }, MEMBER_B)).result.outcome, 'unchanged', 'receipt acknowledgement is idempotent');

      assertEqual((await mutate(api.addConversationMember, {
        conversationId, userHandle: LATER_MEMBER,
      }, OWNER)).result.outcome, 'changed', 'a later join changes both current rosters');
      await assertRosterSynchronized(conversationId, 'later join');
      const laterJoinAck = await captureRejection(mutate(api.acknowledgeMessage, {
        messageId: sent.result, kind: 'read',
      }, LATER_MEMBER), 'later join acknowledgement of an older message');
      assertEqual(
        laterJoinAck.diagnostic?.details?.appCode,
        'MESSAGE_ACK_NOT_RECIPIENT',
        'a later join is not a recipient of an older message',
      );
      assertEqual((await mutate(api.leaveConversation, {
        conversationId,
      }, LATER_MEMBER)).result.outcome, 'changed', 'later member leaves current roster');
      await assertRosterSynchronized(conversationId, 'later join then leave');

      assertEqual((await removeMember(conversationId, MEMBER_B)).outcome,
        'changed', 'first remove changes both rosters');
      assertEqual((await removeMember(conversationId, MEMBER_B)).outcome,
        'unchanged', 'absent remove is idempotent');
      await assertRosterSynchronized(conversationId, 'remove and absent retry');

      assertEqual((await mutate(api.leaveConversation, {
        conversationId,
      }, MEMBER_A)).result.outcome, 'changed', 'first self-leave changes both rosters');
      assertEqual((await mutate(api.leaveConversation, {
        conversationId,
      }, MEMBER_A)).result.outcome, 'unchanged', 'absent self-leave is idempotent');
      assertEqual(
        await assertRosterSynchronized(conversationId, 'leave and absent retry'),
        [`${OWNER}:owner`],
        'only the protected owner remains current',
      );

      const frozen = await query(api.messageRecipientSnapshot, { messageId: sent.result }, OWNER);
      assertEqual(
        [...frozen.rows[0].recipients].sort((a, b) => a.userHandle.localeCompare(b.userHandle)),
        [
          { userHandle: MEMBER_A, roleAtSend: 'member' },
          { userHandle: MEMBER_B, roleAtSend: 'moderator' },
        ].sort((a, b) => a.userHandle.localeCompare(b.userHandle)),
        'later join, leave, and remove do not rewrite send-time recipients',
      );
      assertEqual(
        frozen.rows[0].readBy,
        [MEMBER_B],
        'departed recipient remains in historical read receipts',
      );
    });
  } finally {
    await server?.stop();
  }
});
