// Team Chat local pressure acceptance.
//
// @ref LLP 0063#next-application-pressure-tests — this suite exercises the
// implemented-local rows in pressure-profile.v1.json. It is not a STEP6.CHAT
// production or hosted witness.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance, assert, assertEqual, assertThrows } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(
  readFileSync(join(backendDir, 'generated', name), 'utf8'),
);
const artifactIndex = generated('artifacts.json');
const pressureProfile = JSON.parse(readFileSync(join(here, '..', '..', 'pressure-profile.v1.json'), 'utf8'));
const receiptPressureRows = pressureProfile.pressures.filter(({ id }) =>
  id === 'membership-changes' || id === 'pagination');
const snapbackRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();

const OWNER = 'user_owner';
const MEMBERS = Array.from(
  { length: 31 },
  (_, index) => `user_member_${String(index + 1).padStart(2, '0')}`,
);
const FIRST_MEMBER = MEMBERS[0];
const UNRELATED = 'user_unrelated';
const suite = createSuite('team-chat / local pressure kernel', { expectedChecks: 11 });
const cleanups = [];
let server;
let db;
let roomId;
let secondRoomId;
let memberRoomLive;
let memberSeatsLive;
let preRemovalCursor;

const mutate = (ref, args, userId) => db.mutate(ref, { args, userId });
const query = (ref, args, userId) => db.query(ref, { args, userId });

await runAcceptance(suite, async () => {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    provenance: {
      appId: 'team-chat',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  cleanups.push(() => server.stop());
  db = new SnapbackClient(server.baseUrl, server.clientOptions);

  await suite.check('isolated server loads the committed team-chat artifacts', async () => {
    const schemaLoad = await db.loadSchema(generated('schema.manifest.json'));
    assertEqual(
      schemaLoad.diagnostics.filter(({ severity }) => severity === 'Error' || severity === 'Fatal'),
      [],
      'schema diagnostics',
    );
    await db.loadFunctions(generated('functions.manifest.json'));
    await db.reset();
    const health = await db.health();
    assert(health.ok, 'server health is not ok');
    return {
      launchRung: server.launch.rung,
      identityVerdict: server.identity.verdict,
    };
  });

  await suite.check('room bootstrap atomically creates the room and owner seat', async () => {
    const created = await mutate(
      api.createRoom,
      { title: 'Compiler Club', displayName: 'Owner' },
      OWNER,
    );
    assert(typeof created.result === 'string' && created.result.length > 0, 'room id missing');
    roomId = created.result;
    const room = await query(api.roomDetails, { roomId }, OWNER);
    assertEqual(room.rows.map(({ title }) => title), ['Compiler Club'], 'owner room visibility');
    const list = await query(api.listMyRooms, {}, OWNER);
    assertEqual(
      list.rows.map(({ status, displayName }) => [status, displayName]),
      [['owner', 'Owner']],
      'owner participant row',
    );
    return { roomId };
  });

  await suite.check('an invitation is visible product state but grants no room read', async () => {
    await mutate(
      api.inviteMember,
      { roomId, userId: FIRST_MEMBER, displayName: 'Member 01' },
      OWNER,
    );
    const list = await query(api.listMyRooms, {}, FIRST_MEMBER);
    assertEqual(list.rows.map(({ status }) => status), ['invited'], 'invite card');
    assertEqual(
      (await query(api.roomDetails, { roomId }, FIRST_MEMBER)).rows,
      [],
      'pending invitation leaked the room',
    );
    assertEqual(
      (await query(api.roomMessages, { roomId }, FIRST_MEMBER)).rows,
      [],
      'pending invitation leaked room messages',
    );
  });

  await suite.check('self-accept grants the protected room and live message surface', async () => {
    memberRoomLive = await db.liveQuery(api.roomMessages, {
      connectionId: 'team_chat_first_member_room',
      args: { roomId },
      userId: FIRST_MEMBER,
    });
    cleanups.push(() => memberRoomLive.dispose());
    memberSeatsLive = await db.liveQuery('_snapback.myMemberships', {
      connectionId: 'team_chat_first_member_seats',
      args: { membership: 'roomMembers' },
      userId: FIRST_MEMBER,
    });
    cleanups.push(() => memberSeatsLive.dispose());
    assertEqual(memberRoomLive.rows, [], 'pending member live query must start empty');
    assertEqual(
      memberSeatsLive.rows.map(({ resource, role }) => [resource, role]),
      [[roomId, 'invited']],
      'pending invitation appears only in the caller-owned seat projection',
    );
    await mutate(api.acceptInvite, { roomId }, FIRST_MEMBER);
    assertEqual(
      (await query(api.roomDetails, { roomId }, FIRST_MEMBER)).rows.map(({ title }) => title),
      ['Compiler Club'],
      'accepted member room visibility',
    );
    await mutate(api.sendMessage, { roomId, body: 'welcome' }, OWNER);
    assertEqual(
      (await memberRoomLive.poll()).map(({ body }) => body),
      ['welcome'],
      'accepted member live room message',
    );
    assertEqual(
      (await memberSeatsLive.poll()).map(({ resource, role }) => [resource, role]),
      [[roomId, 'member']],
      'accepted membership appears in the host-owned self projection',
    );
  });

  await suite.check('the room admits the preregistered 32-recipient local cohort', async () => {
    for (let index = 1; index < MEMBERS.length; index += 1) {
      const userId = MEMBERS[index];
      await mutate(
        api.inviteMember,
        { roomId, userId, displayName: `Member ${String(index + 1).padStart(2, '0')}` },
        OWNER,
      );
      await mutate(api.acceptInvite, { roomId }, userId);
    }
    const receipt = await mutate(api.sendMessage, { roomId, body: 'fan-out-32' }, OWNER);
    assertEqual(receipt.result.recipients, 32, 'fan-out recipient count');
    const unreadCounts = await Promise.all(MEMBERS.map(async (userId) => (
      await query(api.unreadDeliveries, {}, userId)
    ).rows.length));
    assertEqual(
      unreadCounts,
      [2, ...Array.from({ length: 30 }, () => 1)],
      'the original member receives both messages and the later cohort receives the fan-out message',
    );
    assertEqual(
      (await query(api.unreadDeliveries, {}, OWNER)).rows.length,
      0,
      'sender deliveries are read',
    );
    return { activeRecipients: receipt.result.recipients };
  });

  await suite.check('room-at-a-time read settlement clears only the recipient inbox', async () => {
    const cleared = await mutate(api.markRoomRead, { roomId }, FIRST_MEMBER);
    assertEqual(cleared.result.changed, 2, 'changed unread rows');
    assertEqual(
      (await query(api.unreadDeliveries, {}, FIRST_MEMBER)).rows,
      [],
      'first member unread rows remain',
    );
    assertEqual(
      (await query(api.unreadDeliveries, {}, MEMBERS[1])).rows.length,
      1,
      'another member unread state changed',
    );
  });

  await suite.check('opaque recipient inbox cursors page without overlap', async () => {
    for (let index = 0; index < 20; index += 1) {
      await mutate(api.sendMessage, { roomId, body: `history-${String(index).padStart(2, '0')}` }, OWNER);
    }
    const page1 = await query(api.firstInboxPage, {}, FIRST_MEMBER);
    assertEqual(page1.rows.length, 10, 'first page length');
    assert(typeof page1.cursor === 'string' && page1.cursor.startsWith('sbpc1.'), 'first cursor is opaque');
    const page2 = await query(api.nextInboxPage, { after: page1.cursor }, FIRST_MEMBER);
    assertEqual(page2.rows.length, 10, 'second page length');
    assert(typeof page2.cursor === 'string' && page2.cursor.startsWith('sbpc1.'), 'second cursor is opaque');
    const page3 = await query(api.nextInboxPage, { after: page2.cursor }, FIRST_MEMBER);
    assertEqual(page3.rows.length, 2, 'terminal page length');
    assertEqual(page3.cursor ?? null, null, 'terminal page cursor');
    const ids = [...page1.rows, ...page2.rows, ...page3.rows].map(({ _id }) => _id);
    assertEqual(new Set(ids).size, 22, 'pagination overlap');
    await assertThrows(
      () => query(api.nextInboxPage, { after: page1.cursor }, MEMBERS[1]),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'cross-recipient cursor must fail closed',
    );
    return { rows: ids.length, pages: 3 };
  });

  await suite.check('membership-scoped room history traverses three pages and fences cursor custody', async () => {
    const page1 = await query(api.firstRoomMessagePage, { roomId }, FIRST_MEMBER);
    assertEqual(page1.rows.length, 10, 'first room page length');
    assert(typeof page1.cursor === 'string' && page1.cursor.startsWith('sbpc1.'), 'room cursor is opaque');
    const page2 = await query(
      api.nextRoomMessagePage,
      { roomId, after: page1.cursor },
      FIRST_MEMBER,
    );
    assertEqual(page2.rows.length, 10, 'second room page length');
    const page3 = await query(
      api.nextRoomMessagePage,
      { roomId, after: page2.cursor },
      FIRST_MEMBER,
    );
    assertEqual(page3.rows.length, 2, 'terminal room page length');
    assertEqual(page3.cursor ?? null, null, 'terminal room cursor');
    const ids = [...page1.rows, ...page2.rows, ...page3.rows].map(({ _id }) => _id);
    assertEqual(new Set(ids).size, 22, 'room page overlap');
    await assertThrows(
      () => query(api.nextRoomMessagePage, { roomId, after: page1.cursor }, MEMBERS[1]),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'cross-user room cursor must fail closed',
    );
    secondRoomId = (await mutate(
      api.createRoom,
      { title: 'Other Room', displayName: 'Owner' },
      OWNER,
    )).result;
    await assertThrows(
      () => query(
        api.nextRoomMessagePage,
        { roomId: secondRoomId, after: page1.cursor },
        FIRST_MEMBER,
      ),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'cross-room cursor must fail closed',
    );
    preRemovalCursor = page1.cursor;
    return { rows: ids.length, pages: 3, refusalCode: 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID' };
  });

  await suite.check('owner removal cuts room, seat, history cursor, delivery, and send authority together', async () => {
    const removed = await mutate(
      api.ownerRemoveMember,
      { roomId, targetPrincipal: FIRST_MEMBER },
      OWNER,
    );
    assertEqual(removed.result, null, 'principal-addressed removal result');
    assertEqual(await memberRoomLive.poll(), [], 'protected room did not blank at removal cut');
    assertEqual(await memberSeatsLive.poll(), [], 'self-membership seat did not drop at removal cut');
    assertEqual(
      (await query(api.firstRoomMessagePage, { roomId }, FIRST_MEMBER)).rows,
      [],
      'fresh former-member room-history page',
    );
    assertEqual(
      (await query(api.firstInboxPage, {}, FIRST_MEMBER)).rows,
      [],
      'owner removal did not purge product delivery custody',
    );
    await assertThrows(
      () => query(
        api.nextRoomMessagePage,
        { roomId, after: preRemovalCursor },
        FIRST_MEMBER,
      ),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'pre-removal cursor must fail closed',
    );
    await assertThrows(
      () => mutate(api.sendMessage, { roomId, body: 'after owner removal' }, FIRST_MEMBER),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'removed member send must be denied',
    );
    const fanout = await mutate(api.sendMessage, { roomId, body: 'after removal boundary' }, OWNER);
    assertEqual(fanout.result.recipients, 31, 'removed member remained in fan-out');
    assertEqual(
      (await query(api.unreadDeliveries, {}, FIRST_MEMBER)).rows,
      [],
      'post-boundary delivery reached removed member',
    );
    const absentAgain = await mutate(
      api.ownerRemoveMember,
      { roomId, targetPrincipal: FIRST_MEMBER },
      OWNER,
    );
    assertEqual(absentAgain.result, null, 'absent-target removal result differs');
    await mutate(
      api.inviteMember,
      { roomId, userId: FIRST_MEMBER, displayName: 'Member 01 returns' },
      OWNER,
    );
    await mutate(api.acceptInvite, { roomId }, FIRST_MEMBER);
    await assertThrows(
      () => query(
        api.nextRoomMessagePage,
        { roomId, after: preRemovalCursor },
        FIRST_MEMBER,
      ),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'rejoin revived pre-removal cursor',
    );
    return {
      refusalCodes: [
        'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
        'SNAPBACK_AUTH_PERMISSION_DENIED',
      ],
    };
  });

  await suite.check('self-leave purges retained room deliveries and revokes room authority', async () => {
    const left = await mutate(api.leaveRoom, { roomId }, FIRST_MEMBER);
    assertEqual(left.result.removedDeliveries, 0, 'rejoined member acquired retained deliveries');
    assertEqual(
      (await query(api.firstInboxPage, {}, FIRST_MEMBER)).rows,
      [],
      'former member retained inbox',
    );
    assertEqual(
      (await query(api.roomMessages, { roomId }, FIRST_MEMBER)).rows,
      [],
      'former member retained room history',
    );
    await assertThrows(
      () => mutate(api.sendMessage, { roomId, body: 'after leave' }, FIRST_MEMBER),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'former member send must be denied',
    );
    await mutate(
      api.inviteMember,
      { roomId, userId: FIRST_MEMBER, displayName: 'Member 01 returns' },
      OWNER,
    );
    await mutate(api.acceptInvite, { roomId }, FIRST_MEMBER);
    assertEqual(
      (await query(api.roomDetails, { roomId }, FIRST_MEMBER)).rows.map(({ title }) => title),
      ['Compiler Club'],
      're-invited member room visibility',
    );
  });

  await suite.check('subsequent fan-out includes the rejoined member and excludes unrelated principals', async () => {
    const sent = await mutate(api.sendMessage, { roomId, body: 'remaining members' }, OWNER);
    assertEqual(sent.result.recipients, 32, 'post-rejoin recipient count');
    assertEqual(
      (await query(api.unreadDeliveries, {}, FIRST_MEMBER)).rows.map(({ body }) => body),
      ['remaining members'],
      'rejoined member inbox',
    );
    assertEqual(
      (await query(api.listMyRooms, {}, UNRELATED)).rows,
      [],
      'unrelated principal room list',
    );
    assertEqual(
      (await query(api.roomMessages, { roomId }, UNRELATED)).rows,
      [],
      'unrelated principal room messages',
    );
    return { activeRecipients: sent.result.recipients };
  });
}, {
  cleanups,
  reportExtra: {
    demo: 'team-chat',
    profileId: 'team-chat/local-pressure-v0',
    targetProfile: 'local-dev-sqlite-ibex',
    snapbackRevision,
    generatedArtifactHashes: {
      inputsHash: artifactIndex.inputsHash,
      bundleHash: artifactIndex.bundleHash,
      schemaHash: artifactIndex.schemaHash,
    },
    pressureRows: receiptPressureRows,
    refusalCodes: [
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'SNAPBACK_AUTH_PERMISSION_DENIED',
    ],
    claimEligible: false,
    roadmapClaim: 'STEP6.CHAT',
  },
});
