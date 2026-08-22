// Messaging roster-projection acceptance.
//
// @ref LLP 0240#authority-facts-versus-product-facts
// — this proves today's partial app-maintained projection boundary. D0.4 has
// selected platform-generated facts, but that design has not shipped.

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
const suite = createSuite('messaging-snapback / roster projection', { expectedChecks: 4 });

const OWNER = 'roster_owner';
const MEMBER_A = 'roster_member_a';
const MEMBER_B = 'roster_member_b';
const LATER_MEMBER = 'roster_later_member';
const OUTSIDER = 'roster_outsider';
const OUTSIDER_MEMBER = 'roster_outsider_member';
const PREFLIGHT_ADD_MEMBER = 'roster_preflight_add_member';
const PREFLIGHT_LEAVE_MEMBER = 'roster_preflight_leave_member';

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

async function assertRosterSynchronized(conversationId, label, viewer = OWNER) {
  // The profile's bounded list is the admitted authority view: it exposes no
  // private row id. Compare it with the ordinary product query after every
  // app-owned transition so a missed companion write fails this acceptance.
  const [authority, projection] = await Promise.all([
    query(api.conversationMemberships.list, { scopeId: conversationId }, viewer),
    query(api.conversationRoster, { conversationId }, viewer),
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

async function reconcileRoster(conversationId, userId = OWNER) {
  return (await mutate(api.reconcileConversationRoster, { conversationId }, userId)).result;
}

function assertPermissionDenied(error, label) {
  assertEqual(
    error.diagnostic?.code,
    'SNAPBACK_AUTH_PERMISSION_DENIED',
    `${label}: permission denial`,
  );
}

function assertAppRefusal(error, appCode, label) {
  assertEqual(error.diagnostic?.code, 'SNAPBACK_APP_REFUSAL', `${label}: app refusal`);
  assertEqual(error.diagnostic?.details?.appCode, appCode, `${label}: app code`);
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

    let conversationId;
    let sentMessageId;

    await suite.check('atomic paths and explicit reconciliation keep current and historical facts distinct', async () => {
      const inboxBeforeFailedBootstrap = await query(api.myConversations, {}, OWNER);
      const failedBootstrap = await captureRejection(mutate(api.createGroup, {
        title: 'Must roll back',
        creatorHandle: 'caller-asserted-owner',
        creatorName: 'Owner',
        memberHandles: [''],
      }, OWNER), 'bootstrap with an invalid initial principal');
      assertEqual(
        failedBootstrap.diagnostic?.code,
        'SNAPBACK_MEMBERSHIP_NULL_AXIS',
        'invalid initial seat refuses the bootstrap transaction',
      );
      assertEqual(
        (await query(api.myConversations, {}, OWNER)).rows.length,
        inboxBeforeFailedBootstrap.rows.length,
        'failed bootstrap leaves no partial owner inbox edge',
      );

      const created = await mutate(api.createGroup, {
        title: 'Roster invariant room',
        creatorHandle: 'caller-asserted-owner',
        creatorName: 'Owner',
        memberHandles: [MEMBER_A],
      }, OWNER);
      conversationId = created.result;
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

      await mutate(api.conversationMemberships.changeRole, {
        scopeId: conversationId,
        principal: MEMBER_B,
        role: 'moderator',
      }, OWNER);
      const staleRoleSend = await captureRejection(mutate(api.sendMessage, {
        conversationId,
        authorHandle: OWNER,
        authorName: 'Owner',
        body: 'Must not send through stale role projection',
      }, OWNER), 'send after direct role change');
      assertAppRefusal(staleRoleSend, 'CONVERSATION_ROSTER_DRIFT', 'direct role change');
      assertEqual((await reconcileRoster(conversationId)).outcome,
        'changed', 'promotion reconciliation updates the display role');
      assertEqual((await reconcileRoster(conversationId)).outcome,
        'unchanged', 'reconciliation retry is idempotent');
      await assertRosterSynchronized(conversationId, 'promotion reconciliation');

      const sent = await mutate(api.sendMessage, {
        conversationId,
        authorHandle: OWNER,
        authorName: 'Owner',
        body: 'Frozen recipient check',
      }, OWNER);
      sentMessageId = sent.result;
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
      assertEqual((await mutate(api.leaveConversation, {
        conversationId,
      }, LATER_MEMBER)).result.outcome, 'unchanged', 'self-leave retry is idempotent');
      await assertRosterSynchronized(conversationId, 'later join then leave');

      const frozen = await query(api.messageRecipientSnapshot, {
        conversationId,
        messageId: sent.result,
      }, OWNER);
      assertEqual(
        [...frozen.rows[0].recipients].sort((a, b) => a.userHandle.localeCompare(b.userHandle)),
        [
          { userHandle: MEMBER_A, roleAtSend: 'member' },
          { userHandle: MEMBER_B, roleAtSend: 'moderator' },
        ].sort((a, b) => a.userHandle.localeCompare(b.userHandle)),
        'later join and leave do not rewrite send-time recipients',
      );
      assertEqual(
        frozen.rows[0].readBy,
        [MEMBER_B],
        'departed recipient remains in historical read receipts',
      );
    });

    await suite.check('authenticated identity and current room admission fence every roster and receipt read', async () => {
      const anonymousInbox = await captureRejection(
        query(api.myConversations, {}, undefined),
        'anonymous inbox',
      );
      assertEqual(anonymousInbox.diagnostic?.code, 'SNAPBACK_AUTH_REQUIRED', 'inbox requires auth');
      const anonymousConversation = await captureRejection(
        query(api.conversationById, { conversationId }, undefined),
        'anonymous conversation read',
      );
      assertEqual(
        anonymousConversation.diagnostic?.code,
        'SNAPBACK_AUTH_REQUIRED',
        'public conversation id does not bypass authentication',
      );
      const anonymousMessages = await captureRejection(
        query(api.conversationMessages, { conversationId }, undefined),
        'anonymous message feed read',
      );
      assertEqual(
        anonymousMessages.diagnostic?.code,
        'SNAPBACK_AUTH_REQUIRED',
        'public conversation id does not expose the message feed anonymously',
      );

      const ownerInbox = await query(api.myConversations, {}, OWNER);
      assert(ownerInbox.rows.some((row) => row._id === conversationId), 'auth-derived owner inbox');
      const forgedViewer = await captureRejection(
        Promise.resolve().then(() => query(
          api.myConversations,
          { viewerHandle: MEMBER_A },
          OWNER,
        )),
        'caller-supplied viewer handle',
      );
      assertEqual(
        forgedViewer.diagnostic?.code,
        'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
        'caller-supplied viewer handle is not accepted by the generated contract',
      );

      const outsiderRoster = await captureRejection(
        query(api.conversationRoster, { conversationId }, OUTSIDER),
        'outsider roster read',
      );
      assertPermissionDenied(outsiderRoster, 'outsider roster read');
      const outsiderConversation = await captureRejection(
        query(api.conversationById, { conversationId }, OUTSIDER),
        'outsider conversation read',
      );
      assertPermissionDenied(outsiderConversation, 'outsider conversation read');
      const outsiderMessages = await captureRejection(
        query(api.conversationMessages, { conversationId }, OUTSIDER),
        'outsider message feed read',
      );
      assertPermissionDenied(outsiderMessages, 'outsider message feed read');
      const outsiderSnapshot = await captureRejection(
        query(api.messageRecipientSnapshot, { conversationId, messageId: sentMessageId }, OUTSIDER),
        'outsider snapshot read',
      );
      assertPermissionDenied(outsiderSnapshot, 'outsider snapshot read');

      const otherRoom = await mutate(api.createGroup, {
        title: 'Other private room',
        creatorHandle: 'caller-asserted-outsider',
        creatorName: 'Outsider',
        memberHandles: [OUTSIDER_MEMBER],
      }, OUTSIDER);
      const otherSent = await mutate(api.sendMessage, {
        conversationId: otherRoom.result,
        authorHandle: OUTSIDER,
        authorName: 'Outsider',
        body: 'Other room secret',
      }, OUTSIDER);
      const otherRoomRoster = await captureRejection(
        query(api.conversationRoster, { conversationId: otherRoom.result }, OWNER),
        'other-room roster read',
      );
      assertPermissionDenied(otherRoomRoster, 'other-room roster read');
      const otherRoomConversation = await captureRejection(
        query(api.conversationById, { conversationId: otherRoom.result }, OWNER),
        'other-room conversation read',
      );
      assertPermissionDenied(otherRoomConversation, 'other-room conversation read');
      const otherRoomMessages = await captureRejection(
        query(api.conversationMessages, { conversationId: otherRoom.result }, OWNER),
        'other-room message feed read',
      );
      assertPermissionDenied(otherRoomMessages, 'other-room message feed read');
      const otherRoomSnapshot = await captureRejection(
        query(api.messageRecipientSnapshot, {
          conversationId: otherRoom.result,
          messageId: otherSent.result,
        }, OWNER),
        'other-room snapshot read',
      );
      assertPermissionDenied(otherRoomSnapshot, 'other-room snapshot read');

      assertEqual(
        (await query(api.conversationRoster, { conversationId }, MEMBER_A)).rows.length,
        3,
        'current member reads the admitted roster',
      );
      assertEqual(
        (await query(api.messageRecipientSnapshot, {
          conversationId,
          messageId: sentMessageId,
        }, MEMBER_A)).rows.length,
        1,
        'current member reads admitted historical receipts',
      );
      const admittedConversation = await query(api.conversationById, { conversationId }, MEMBER_A);
      assert(
        !Object.hasOwn(admittedConversation.rows[0], 'memberHandles'),
        'admitted conversation metadata contains no duplicate roster dump',
      );
    });

    await suite.check('bypass/interruption drift fails sends closed and idempotent repair covers every generated writer', async () => {
      const unauthorized = await captureRejection(mutate(
        api.conversationMemberships.remove,
        { scopeId: conversationId, principal: MEMBER_B },
        MEMBER_A,
      ), 'unauthorized generated remove');
      assertEqual(
        unauthorized.diagnostic?.code,
        'SNAPBACK_MEMBERSHIP_TRANSITION_DENIED',
        'unauthorized generated remove is denied by the membership transition policy',
      );

      // Failpoint: the authoritative removal commits, then the process loses
      // the projection call. The stale row must never feed a new snapshot.
      await mutate(api.conversationMemberships.remove, {
        scopeId: conversationId,
        principal: MEMBER_B,
      }, OWNER);
      const interruptedSend = await captureRejection(mutate(api.sendMessage, {
        conversationId,
        authorHandle: OWNER,
        authorName: 'Owner',
        body: 'Must not include a removed recipient',
      }, OWNER), 'send after interrupted removal');
      assertAppRefusal(interruptedSend, 'CONVERSATION_ROSTER_DRIFT', 'interrupted removal');
      const removalRepair = await reconcileRoster(conversationId);
      assertEqual(removalRepair.removed, 1, 'retry removes the stale product member');
      assertEqual((await reconcileRoster(conversationId)).outcome,
        'unchanged', 'repeated removal repair is idempotent');
      const repairedSend = await mutate(api.sendMessage, {
        conversationId,
        authorHandle: OWNER,
        authorName: 'Owner',
        body: 'Recipient set after repair',
      }, OWNER);
      const repairedSnapshot = await query(
        api.messageRecipientSnapshot,
        { conversationId, messageId: repairedSend.result },
        OWNER,
      );
      assert(
        !repairedSnapshot.rows[0].recipients.some((row) => row.userHandle === MEMBER_B),
        'removed member never enters the post-repair snapshot',
      );

      assertEqual((await mutate(api.addConversationMember, {
        conversationId, userHandle: PREFLIGHT_ADD_MEMBER,
      }, OWNER)).result.outcome, 'changed', 'preflight member starts synchronized');
      await mutate(api.conversationMemberships.remove, {
        scopeId: conversationId,
        principal: PREFLIGHT_ADD_MEMBER,
      }, OWNER);
      assertEqual((await mutate(api.addConversationMember, {
        conversationId, userHandle: PREFLIGHT_ADD_MEMBER,
      }, OWNER)).result.outcome,
      'changed', 'app add repairs a stale projected seat after direct remove');
      await assertRosterSynchronized(conversationId, 'remove then app add');
      await mutate(api.conversationMemberships.remove, {
        scopeId: conversationId,
        principal: PREFLIGHT_ADD_MEMBER,
      }, OWNER);
      await reconcileRoster(conversationId);

      await mutate(api.conversationMemberships.invite, {
        scopeId: conversationId,
        principal: PREFLIGHT_LEAVE_MEMBER,
        role: 'member',
        joinedAt: 1,
      }, OWNER);
      assertEqual((await mutate(api.leaveConversation, {
        conversationId,
      }, PREFLIGHT_LEAVE_MEMBER)).result.outcome,
      'changed', 'app leave follows authority when the projection seat is missing');
      assertEqual((await mutate(api.leaveConversation, {
        conversationId,
      }, PREFLIGHT_LEAVE_MEMBER)).result.outcome,
      'unchanged', 'missing-projection leave retry is idempotent');
      await assertRosterSynchronized(conversationId, 'direct invite then app leave');

      await mutate(api.conversationMemberships.invite, {
        scopeId: conversationId,
        principal: LATER_MEMBER,
        role: 'member',
        joinedAt: 1,
      }, OWNER);
      const inviteDrift = await captureRejection(mutate(api.sendMessage, {
        conversationId,
        authorHandle: OWNER,
        authorName: 'Owner',
        body: 'Invite bypass drift',
      }, OWNER), 'send after direct invite');
      assertAppRefusal(inviteDrift, 'CONVERSATION_ROSTER_DRIFT', 'direct invite');
      assertEqual((await reconcileRoster(conversationId)).inserted, 1, 'invite repair inserts projection');

      await mutate(api.conversationMemberships.transferOwner, {
        scopeId: conversationId,
        principal: LATER_MEMBER,
      }, OWNER);
      const formerOwnerRepair = await captureRejection(
        reconcileRoster(conversationId, OWNER),
        'former owner reconciliation after transfer',
      );
      assertPermissionDenied(formerOwnerRepair, 'former owner reconciliation after transfer');
      assertEqual((await reconcileRoster(conversationId, LATER_MEMBER)).updated,
        2, 'new owner repairs both transfer role changes');

      await mutate(api.conversationMemberships.leave, { scopeId: conversationId }, OWNER);
      const leaveDrift = await captureRejection(mutate(api.sendMessage, {
        conversationId,
        authorHandle: LATER_MEMBER,
        authorName: 'New owner',
        body: 'Leave bypass drift',
      }, LATER_MEMBER), 'send after direct leave');
      assertAppRefusal(leaveDrift, 'CONVERSATION_ROSTER_DRIFT', 'direct leave');
      assertEqual((await reconcileRoster(conversationId, LATER_MEMBER)).removed,
        1, 'leave repair removes the stale projection');
      assertEqual(
        await assertRosterSynchronized(conversationId, 'all generated writer repairs', LATER_MEMBER),
        [`${LATER_MEMBER}:owner`, `${MEMBER_A}:member`].sort(),
        'authority and projection converge after transfer and leave',
      );
    });
  } finally {
    await server?.stop();
  }
});
