// Team Chat authority-profile acceptance.
//
// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — this is
// the server/codegen witness for the generated profile namespace, opaque
// roster custody, post-commit transition receipts, and exact-one-owner races.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance, assert, assertEqual, assertThrows } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { AdminClient } from '../../../../packages/snapback-admin-client/index.mjs';
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
const FIRST = 'user_member_01';
const SECOND = 'user_member_02';
const THIRD = 'user_member_03';
const UNRELATED = 'user_unrelated';
const suite = createSuite('team-chat / generated authority profile', { expectedChecks: 10 });
const cleanups = [];
let server;
let db;
let admin;
let roomId;
let secondRoomId;
let currentOwner;
const mutationEnvelopes = [];
const privateRoomMemberIds = new Set();

const transitions = (output) => output.authorityTransitions ?? [];
const mutateOn = async (client, ref, args, userId) => {
  const output = await client.mutate(ref, { args, userId });
  mutationEnvelopes.push(structuredClone(output));
  return output;
};
const mutate = (ref, args, userId) => mutateOn(db, ref, args, userId);
const query = (ref, args, userId) => db.query(ref, { args, userId });
const roleByPrincipal = (rows) => Object.fromEntries(rows.map(({ userId, role }) => [userId, role]));
const refusalBytes = async (ref, args, userId, code, message) => {
  const response = await fetch(`${server.baseUrl}/query/${encodeURIComponent(ref.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      args,
      auth: SnapbackClient.auth(userId),
      read_set: [],
      expectedGeneration: ref.expectedGeneration,
    }),
  });
  const payload = Buffer.from(await response.arrayBuffer());
  assert(!response.ok, `${message}: request unexpectedly succeeded`);
  let decoded;
  try {
    decoded = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new Error(`${message}: refusal was not JSON`);
  }
  assertEqual(decoded?.diagnostic?.code, code, `${message}: refusal code`);
  return payload;
};
const findExactPrivateRoomMemberId = (value, path = '$') => {
  if (typeof value === 'string' && privateRoomMemberIds.has(value)) return { path, value };
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findExactPrivateRoomMemberId(value[index], `${path}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const found = findExactPrivateRoomMemberId(child, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
};
const collectPrivateRoomMemberIds = async () => {
  const scan = await admin.scanTable('roomMembersV2', 500, 0);
  assertEqual(scan.total, scan.rows.length, 'private roomMembersV2 probe was not exhaustive');
  for (const row of scan.rows) {
    assert(typeof row._id === 'string' && row._id.length > 0, 'private roomMembersV2 probe omitted _id');
    privateRoomMemberIds.add(row._id);
  }
  assert(privateRoomMemberIds.size > 0, 'private roomMembersV2 probe found no ids');
};

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
  admin = new AdminClient(`${server.baseUrl}/_snapback/api`, { token: server.adminToken });

  await suite.check('isolated server loads the generated authority-profile artifacts', async () => {
    const schemaLoad = await db.loadSchema(generated('schema.manifest.json'));
    assertEqual(
      schemaLoad.diagnostics.filter(({ severity }) => severity === 'Error' || severity === 'Fatal'),
      [],
      'schema diagnostics',
    );
    const functionsLoad = await db.loadFunctions(generated('functions.manifest.json'));
    assertEqual(
      functionsLoad.diagnostics.filter(({ severity }) => severity === 'Error' || severity === 'Fatal'),
      [],
      'function diagnostics',
    );
    await db.reset();
    assert((await db.health()).ok, 'server health is not ok');
    const state = await db.inspect();
    const loadedNames = state.functions.functions.map(({ name }) => name);
    assert(
      loadedNames.includes('createRoom'),
      `createRoom did not load: ${loadedNames.join(', ')}; response=${JSON.stringify(functionsLoad)}`,
    );
    for (const operation of [
      'list', 'myRole', 'invite', 'join', 'leave', 'changeRole', 'transferOwner', 'remove',
    ]) {
      assert(api.roomMembersV2[operation]?.artifactKind === 'functionReference', `${operation} ref missing`);
    }
    return { launchRung: server.launch.rung, identityVerdict: server.identity.verdict };
  });

  await suite.check('bootstrap owner is visible through list and myRole without private fields', async () => {
    roomId = (await mutate(api.createRoom, { title: 'Compiler Club' }, OWNER)).result;
    secondRoomId = (await mutate(api.createRoom, { title: 'Cursor Boundary' }, OWNER)).result;
    const roster = await query(api.roomMembersV2.list, { scopeId: roomId }, OWNER);
    assertEqual(roster.rows, [{ userId: OWNER, role: 'owner' }], 'initial roster');
    assertEqual(
      (await query(api.roomMembersV2.myRole, { scopeId: roomId }, OWNER)).rows,
      [{ role: 'owner', status: 'active' }],
      'owner role projection',
    );
    assert(!Object.hasOwn(roster.rows[0], '_id'), 'private membership id escaped');
    assert(!Object.hasOwn(roster.rows[0], 'grantedByActor'), 'private provenance escaped');
    return { roomId };
  });

  await suite.check('invite is receipted while pending authority remains non-enumerating', async () => {
    const invited = await mutate(api.roomMembersV2.invite, {
      scopeId: roomId,
      principal: FIRST,
      role: 'invited',
    }, OWNER);
    assertEqual(transitions(invited).length, 1, 'invite receipt count');
    assertEqual(transitions(invited)[0].predecessor, null, 'invite predecessor');
    assertEqual(transitions(invited)[0].successor, { role: 'invited', status: 'invited' }, 'invite successor');
    assertEqual(
      (await query(api.roomMembersV2.myRole, { scopeId: roomId }, FIRST)).rows,
      [{ role: 'invited', status: 'invited' }],
      'pending caller role',
    );
    await assertThrows(
      () => query(api.roomMembersV2.list, { scopeId: roomId }, FIRST),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'pending principal enumerated the roster',
    );
    await assertThrows(
      () => query(api.roomMembersV2.list, {
        scopeId: roomId,
        page: { after: 'not-a-cursor', limit: 2 },
      }, UNRELATED),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'outsider learned cursor validity before role admission',
    );
    let absentScopeId = `${roomId.slice(0, -1)}${roomId.endsWith('0') ? '1' : '0'}`;
    if (absentScopeId === secondRoomId) {
      absentScopeId = `${roomId.slice(0, -1)}${roomId.endsWith('2') ? '3' : '2'}`;
    }
    const listUnauthorized = await refusalBytes(
      api.roomMembersV2.list,
      { scopeId: roomId },
      UNRELATED,
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'outsider roster refusal',
    );
    const listAbsent = await refusalBytes(
      api.roomMembersV2.list,
      { scopeId: absentScopeId },
      UNRELATED,
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'absent-scope roster refusal',
    );
    assert(listUnauthorized.equals(listAbsent), 'list non-enumeration refusal bytes differ');
    const myRoleUnauthorized = await refusalBytes(
      api.roomMembersV2.myRole,
      { scopeId: roomId },
      UNRELATED,
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'outsider myRole refusal',
    );
    const myRoleAbsent = await refusalBytes(
      api.roomMembersV2.myRole,
      { scopeId: absentScopeId },
      UNRELATED,
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'absent-scope myRole refusal',
    );
    assert(myRoleUnauthorized.equals(myRoleAbsent), 'myRole non-enumeration refusal bytes differ');
  });

  await suite.check('join promotes invitations and returns only committed transition receipts', async () => {
    const joined = await mutate(api.roomMembersV2.join, {
      scopeId: roomId,
      invitation: 'member',
    }, FIRST);
    assertEqual(transitions(joined).length, 1, 'join receipt count');
    assertEqual(transitions(joined)[0].predecessor, { role: 'invited', status: 'invited' }, 'join predecessor');
    assertEqual(transitions(joined)[0].successor, { role: 'member', status: 'active' }, 'join successor');
    for (const principal of [SECOND, THIRD]) {
      await mutate(api.roomMembersV2.invite, {
        scopeId: roomId,
        principal,
        role: 'invited',
      }, OWNER);
      await mutate(api.roomMembersV2.join, {
        scopeId: roomId,
        invitation: 'member',
      }, principal);
    }
    assertEqual(
      (await query(api.roomMembersV2.myRole, { scopeId: roomId }, FIRST)).rows,
      [{ role: 'member', status: 'active' }],
      'joined caller role',
    );
  });

  await suite.check('changeRole is transition-derived and its receipt names the public subject', async () => {
    await assertThrows(
      () => mutate(api.roomMembersV2.changeRole, {
        scopeId: roomId,
        principal: SECOND,
        role: 'admin',
      }, FIRST),
      'SNAPBACK_MEMBERSHIP_TRANSITION_DENIED',
      'plain member changed another member role',
    );
    await assertThrows(
      () => mutate(api.roomMembersV2.changeRole, {
        scopeId: roomId,
        principal: SECOND,
        role: 'owner',
      }, OWNER),
      'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
      'ordinary role change created an owner',
    );
    const changed = await mutate(api.roomMembersV2.changeRole, {
      scopeId: roomId,
      principal: FIRST,
      role: 'admin',
    }, OWNER);
    assertEqual(transitions(changed).length, 1, 'changeRole receipt count');
    assertEqual(transitions(changed)[0].subject, FIRST, 'changeRole subject');
    assertEqual(transitions(changed)[0].predecessor.role, 'member', 'changeRole predecessor');
    assertEqual(transitions(changed)[0].successor.role, 'admin', 'changeRole successor');
  });

  await suite.check('opaque roster cursors bind scope, caller, ordering, and generation', async () => {
    await collectPrivateRoomMemberIds();
    const page1 = await query(api.roomMembersV2.list, {
      scopeId: roomId,
      page: { limit: 2 },
    }, OWNER);
    assertEqual(page1.rows.length, 2, 'first roster page length');
    assert(typeof page1.cursor === 'string', 'roster cursor is missing');
    const cursorParts = page1.cursor.split('.');
    assertEqual(cursorParts.length, 3, 'sealed roster cursor segment count');
    assertEqual(cursorParts[0], 'sbpc2', 'sealed roster cursor version tag');
    const decodedCursorPayload = Buffer.from(cursorParts[2], 'base64url');
    for (const privateValue of [
      ...privateRoomMemberIds, OWNER, FIRST, SECOND, THIRD, UNRELATED,
    ]) {
      assert(
        !decodedCursorPayload.equals(Buffer.from(privateValue, 'utf8')),
        `base64-decoded cursor payload exactly exposed ${privateValue}`,
      );
    }
    let decodedCursorJson = null;
    try {
      decodedCursorJson = JSON.parse(decodedCursorPayload.toString('utf8'));
    } catch {
      // Ciphertext is intentionally not JSON.
    }
    assertEqual(decodedCursorJson, null, 'base64-decoded cursor exposed readable JSON');
    const page2 = await query(api.roomMembersV2.list, {
      scopeId: roomId,
      page: { after: page1.cursor, limit: 2 },
    }, OWNER);
    assertEqual(page2.rows.length, 2, 'second roster page length');
    assertEqual(page2.cursor ?? null, null, 'terminal roster cursor');
    const principals = [...page1.rows, ...page2.rows].map(({ userId }) => userId);
    assertEqual(new Set(principals).size, 4, 'roster pagination overlap');
    await assertThrows(
      () => query(api.roomMembersV2.list, {
        scopeId: secondRoomId,
        page: { after: page1.cursor, limit: 2 },
      }, OWNER),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'cross-scope roster cursor was accepted',
    );
    await assertThrows(
      () => query(api.roomMembersV2.list, {
        scopeId: roomId,
        page: { after: page1.cursor, limit: 2 },
      }, SECOND),
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'cross-caller roster cursor was accepted',
    );
    return { pages: 2, rows: principals.length };
  });

  await suite.check('message delivery reads the canonical roster without crossing owner custody', async () => {
    const sent = await mutate(api.sendMessage, { roomId, body: 'one roster' }, OWNER);
    assertEqual(sent.result.rosterSize, 4, 'canonical roster read');
    assertEqual(sent.result.recipients, 1, 'owner-stamped delivery count');
    assertEqual(
      (await query(api.unreadDeliveries, {}, FIRST)).rows.map(({ body }) => body),
      [],
      'cross-owner delivery escaped the owner-write boundary',
    );
  });

  await suite.check('transferOwner commits its two authority transitions atomically', async () => {
    const transferred = await mutate(api.roomMembersV2.transferOwner, {
      scopeId: roomId,
      principal: FIRST,
    }, OWNER);
    assertEqual(transitions(transferred).length, 2, 'transfer receipt count');
    assertEqual(
      new Set(transitions(transferred).map(({ subject }) => subject)),
      new Set([OWNER, FIRST]),
      'transfer receipt subjects',
    );
    const roles = roleByPrincipal((await query(api.roomMembersV2.list, { scopeId: roomId }, FIRST)).rows);
    assertEqual(roles[FIRST], 'owner', 'target did not become owner');
    assertEqual(roles[OWNER], 'admin', 'predecessor owner did not become admin');
    currentOwner = FIRST;
  });

  await suite.check('Rust two-plan owner-transfer race pins conflict and one owner in each raced database', async () => {
    const raceProof = execFileSync('cargo', [
      'test',
      '--lib',
      'storage::tests::membership_write_tests::transfer_owner_races_target_removal_and_concurrent_transfer_in_both_orders',
      '--',
      '--exact',
      '--nocapture',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, RUST_MIN_STACK: '16777216' },
    });
    assert(
      /test storage::tests::membership_write_tests::transfer_owner_races_target_removal_and_concurrent_transfer_in_both_orders \.\.\. ok/u.test(raceProof),
      'the exact two-plan kernel race did not pass',
    );
    assert(/test result: ok\. 1 passed; 0 failed/u.test(raceProof), 'the two-plan race result count drifted');
    return { loserCode: 'SNAPBACK_MUTATION_CONFLICT', ownerCardinalityWitness: 'Rust raced databases' };
  });

  await suite.check('remove and leave keep actual private row ids out of complete mutation envelopes', async () => {
    const removable = OWNER;
    const removed = await mutate(api.roomMembersV2.remove, {
      scopeId: roomId,
      principal: removable,
    }, currentOwner);
    assertEqual(transitions(removed).length, 1, 'remove receipt count');
    assertEqual(transitions(removed)[0].successor, null, 'remove successor');

    const afterRemove = (await query(api.roomMembersV2.list, { scopeId: roomId }, currentOwner)).rows;
    const leaver = afterRemove.find(({ userId, role }) => userId !== currentOwner && role !== 'owner').userId;
    const left = await mutate(api.roomMembersV2.leave, { scopeId: roomId }, leaver);
    assertEqual(transitions(left).length, 1, 'leave receipt count');
    assertEqual(transitions(left)[0].subject, leaver, 'leave subject');
    assertEqual(transitions(left)[0].successor, null, 'leave successor');
    const leaked = findExactPrivateRoomMemberId(mutationEnvelopes);
    assert(
      leaked === null,
      `actual private membership row id escaped anywhere in mutation envelopes: ${JSON.stringify(leaked)}`,
    );
  });
}, {
  cleanups,
  reportExtra: {
    demo: 'team-chat',
    profileId: 'team-chat/authority-profile-b2a',
    targetProfile: 'local-dev-sqlite-ibex',
    snapbackRevision,
    generatedArtifactHashes: {
      inputsHash: artifactIndex.inputsHash,
      bundleHash: artifactIndex.bundleHash,
      schemaHash: artifactIndex.schemaHash,
    },
    pressureRows: receiptPressureRows,
    refusalCodes: [
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID',
      'SNAPBACK_MEMBERSHIP_TRANSITION_DENIED',
      'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
      'SNAPBACK_AUTHORITY_TRANSFER_OWNER_DENIED',
      'SNAPBACK_MUTATION_CONFLICT',
    ],
    claimEligible: false,
    roadmapClaim: 'STEP6.CHAT',
  },
});
