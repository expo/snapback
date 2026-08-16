#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createExternalSessionClient,
  SnapbackClient,
} from '../../../packages/snapback-client/index.mjs';
import { createAssetClient } from '../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';
import { startServer } from '../../_kit/server-process.mjs';

import { loadGeneratedApi, loadGeneratedJson } from './generated-artifacts.mjs';
import { installM1Fixtures } from './seed-m1.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(backendDir, '..', '..', '..');
const sharedMediaDir = join(repoRoot, 'benchmarks', 'fixtures', 'social-messenger', 'media');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? '/Users/ccheever/projects/snapback/target/debug/snapback',
);
const api = await loadGeneratedApi();
const schema = loadGeneratedJson('schema.manifest.json');
const functions = loadGeneratedJson('functions.manifest.json');

function code(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

function applicationCode(error) {
  return error?.diagnostic?.details?.appCode ?? error?.details?.appCode ?? null;
}

function passwordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
  return { client, coordinator };
}

async function expectCode(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.equal(code(error), expected, error?.stack ?? String(error));
    return true;
  });
}

async function expectAppCode(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.equal(code(error), 'SNAPBACK_APP_REFUSAL', error?.stack ?? String(error));
    assert.equal(applicationCode(error), expected, error?.stack ?? String(error));
    return true;
  });
}

async function requireUploadAdmission(task) {
  await new Promise((resolveAdmission, rejectAdmission) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      rejectAdmission(new Error('timed out waiting for avatar upload admission'));
    }, 10_000);
    unsubscribe = task.subscribe((snapshot) => {
      if (snapshot.status === 'uploading') {
        clearTimeout(timeout);
        unsubscribe();
        task.pause();
        resolveAdmission();
      } else if (snapshot.status === 'failed' || snapshot.status === 'rejected') {
        clearTimeout(timeout);
        unsubscribe();
        rejectAdmission(new Error(`avatar upload was not admitted: ${JSON.stringify(snapshot.diagnostic)}`));
      }
    });
  });
}

test('Coterie Snapback M1 backend', { timeout: 300_000 }, async (t) => {
  assert(existsSync(runtimeBinary), `prebuilt runtime is missing: ${runtimeBinary}`);
  const scratch = mkdtempSync(join(tmpdir(), 'coterie-m1-'));
  const clients = [];
  let server = null;
  t.after(async () => {
    await Promise.allSettled(clients.map((client) => client.closeAuth()));
    let stopError = null;
    try {
      await server?.stop();
    } catch (error) {
      stopError = error;
    }
    let cleanupError = null;
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error;
    }
    if (stopError && cleanupError) {
      throw new AggregateError([stopError, cleanupError], 'server stop and scratch cleanup both failed');
    }
    if (stopError) throw stopError;
    if (cleanupError) throw cleanupError;
  });

  const stagedRuntime = join(scratch, 'snapback-runtime');
  // Keep the charter-pinned binary exact while giving the lifecycle kit a
  // sandbox-owned location for its digest-bound readiness sidecar.
  symlinkSync(runtimeBinary, stagedRuntime);
  const carrier = join(scratch, 'startup-artifacts.json');
  writeFileSync(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
    { mode: 0o600 },
  );

  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    serverBinary: stagedRuntime,
  });
  const useClient = (id) => {
    const fixture = passwordClient(server.baseUrl, `coterie-test-${id}`);
    clients.push(fixture.client);
    return fixture;
  };

  let alice;
  let bob;
  let aliceProfile;
  let aliceBearer;
  let bobProfileId;

  await t.test('email/password signup creates a durable authenticated session', async () => {
    alice = useClient('alice-signup');
    const signup = await alice.client.authPasswordSignup({
      email: 'm1-alice@example.test',
      password: 'CoterieAlice!2026',
    });
    assert.equal(signup.session.provider, 'local-password');
    assert.equal(signup.session.userId, alice.coordinator.authority.userId);
    assert.equal(signup.recoveryCodes.length, 8);
    const profileId = (await alice.client.mutate(api.ensureMyProfile, {
      args: {
        handle: 'acceptance_alice',
        displayName: 'Acceptance Alice',
        bio: 'First M1 acceptance persona.',
        location: 'Oakland, CA',
        link: 'https://example.test/alice',
      },
    })).result;
    const rows = (await alice.client.query(api.getMyProfile, { args: {} })).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]._id, profileId);
    aliceProfile = rows[0];

    const capture = alice.coordinator.capture();
    aliceBearer = alice.coordinator.credentialFor(capture).bearer;
    const fresh = createExternalSessionClient(server.baseUrl, {
      bearerToken: aliceBearer,
      rqsStore: null,
      offlineQueue: false,
    });
    clients.push(fresh);
    const freshRows = (await fresh.query(api.getMyProfile, { args: {} })).rows;
    assert.equal(freshRows.length, 1);
    assert.equal(freshRows[0]._id, profileId);
  });

  await t.test('password policy accepts eight characters and rejects seven', async () => {
    const boundary = useClient('password-boundary');
    await expectCode(
      () => boundary.client.authPasswordSignup({
        email: 'm1-password-boundary@example.test',
        password: 'A7x!9qZ',
      }),
      'SNAPBACK_AUTH_PASSWORD_POLICY',
    );
    const signup = await boundary.client.authPasswordSignup({
      email: 'm1-password-boundary@example.test',
      password: 'A7x!9qZ2',
    });
    assert.equal(signup.session.provider, 'local-password');
  });

  await t.test('email/password login restores the same principal', async () => {
    const login = useClient('alice-login');
    const signin = await login.client.authPasswordSignIn({
      email: 'm1-alice@example.test',
      password: 'CoterieAlice!2026',
    });
    assert.equal(signin.session.userId, alice.coordinator.authority.userId);
    assert.equal((await login.client.query(api.getMyProfile, { args: {} })).rows[0]._id, aliceProfile._id);
  });

  await t.test('wrong-password login is rejected uniformly', async () => {
    const wrong = useClient('alice-wrong-password');
    await expectCode(
      () => wrong.client.authPasswordSignIn({
        email: 'm1-alice@example.test',
        password: 'DefinitelyWrong!2026',
      }),
      'SNAPBACK_AUTH_CREDENTIAL_INVALID',
    );
  });

  await t.test('a second account cannot claim a duplicate normalized handle', async () => {
    bob = useClient('bob-signup');
    await bob.client.authPasswordSignup({
      email: 'm1-bob@example.test',
      password: 'CoterieBob!2026',
    });
    await expectAppCode(
      () => bob.client.mutate(api.ensureMyProfile, {
        args: {
          handle: ' Acceptance_Alice ',
          displayName: 'Acceptance Bob',
          bio: '',
          location: '',
          link: '',
        },
      }),
      'DUPLICATE_HANDLE',
    );
    bobProfileId = (await bob.client.mutate(api.ensureMyProfile, {
      args: {
        handle: 'acceptance_bob',
        displayName: 'Acceptance Bob',
        bio: 'Second M1 acceptance persona.',
        location: 'Berkeley, CA',
        link: 'https://example.test/bob',
      },
    })).result;
  });

  await t.test('profile field limits accept exact boundaries and reject values outside them', async () => {
    const atMinimum = {
      profileId: aliceProfile._id,
      handle: 'abc',
      displayName: 'A',
      bio: '',
      location: '',
      link: '',
    };
    await alice.client.mutate(api.editProfile, { args: atMinimum });
    const atMaximum = {
      profileId: aliceProfile._id,
      handle: 'h'.repeat(20),
      displayName: 'D'.repeat(50),
      bio: 'B'.repeat(200),
      location: 'L'.repeat(50),
      link: 'https://example.test/profile',
    };
    await alice.client.mutate(api.editProfile, { args: atMaximum });

    const rejected = [
      ['handle min-1', { ...atMaximum, handle: 'ab' }],
      ['handle max+1', { ...atMaximum, handle: 'h'.repeat(21) }],
      ['handle alphabet', { ...atMaximum, handle: 'bad-handle' }],
      ['display name min-1', { ...atMaximum, displayName: '' }],
      ['display name max+1', { ...atMaximum, displayName: 'D'.repeat(51) }],
      ['bio max+1', { ...atMaximum, bio: 'B'.repeat(201) }],
      ['location max+1', { ...atMaximum, location: 'L'.repeat(51) }],
      ['link is one URL', { ...atMaximum, link: 'https://one.test https://two.test' }],
    ];
    for (const [label, args] of rejected) {
      await expectCode(
        () => alice.client.mutate(api.editProfile, { args }),
        'SNAPBACK_HANDLER_FAILED',
      ).catch((error) => {
        error.message = `${label}: ${error.message}`;
        throw error;
      });
    }
  });

  await t.test('profile edits succeed for the owner and expose typed ownership and duplicate refusals', async () => {
    await expectAppCode(
      () => bob.client.mutate(api.editProfile, {
        args: {
          profileId: aliceProfile._id,
          handle: 'stolen_alice',
          displayName: 'Not Alice',
          bio: '',
          location: '',
          link: '',
        },
      }),
      'PROFILE_NOT_OWNED',
    );
    await expectAppCode(
      () => bob.client.mutate(api.editProfile, {
        args: {
          profileId: bobProfileId,
          handle: 'h'.repeat(20),
          displayName: 'Acceptance Bob',
          bio: '',
          location: '',
          link: '',
        },
      }),
      'DUPLICATE_HANDLE',
    );
    await alice.client.mutate(api.editProfile, {
      args: {
        profileId: aliceProfile._id,
        handle: 'acceptance_alice',
        displayName: 'Alice Edited',
        bio: 'Owner-authorized edit.',
        location: 'San Francisco, CA',
        link: 'https://example.test/alice-edited',
      },
    });
    const edited = (await alice.client.query(api.getMyProfile, { args: {} })).rows[0];
    assert.equal(edited.displayName, 'Alice Edited');
    assert.equal(edited.bio, 'Owner-authorized edit.');
  });

  await t.test('avatar admission accepts PNG/JPEG/WebP through 10 MB and rejects max+1', async () => {
    const avatarIntent = functions.assetUploadIntents.find(({ exportedName }) => (
      exportedName === 'avatarUpload'
    ));
    assert(avatarIntent, 'avatarUpload intent is generated');
    assert.deepEqual(avatarIntent.accept, {
      maxBytes: 10_000_000,
      mediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });

    const assets = createAssetClient(alice.client);
    const atLimit = assets.start({
      upload: api.avatarUpload,
      file: new Blob([new Uint8Array(10_000_000)], { type: 'image/webp' }),
      declaredFilename: 'at-limit.webp',
      declaredContentType: 'image/webp',
    });
    await requireUploadAdmission(atLimit);
    await atLimit.cancel();

    const tooLarge = assets.start({
      upload: api.avatarUpload,
      file: new Blob([new Uint8Array(10_000_001)], { type: 'image/webp' }),
      declaredFilename: 'too-large.webp',
      declaredContentType: 'image/webp',
    });
    const terminal = await tooLarge.done;
    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.diagnostic?.code, 'SNAPBACK_ASSET_TRANSFER_FAILED');
    assert.equal(terminal.assetId, null, 'max+1 refuses during admission before reserving an asset');
  });

  await t.test('avatar upload finalizes and rejects attachment by another principal', async () => {
    const bytes = readFileSync(join(sharedMediaDir, 'avatar-alice.png'));
    const sourceDigest = createHash('sha256').update(bytes).digest('hex');
    const upload = createAssetClient(alice.client).start({
      upload: api.avatarUpload,
      file: new Blob([bytes], { type: 'image/png' }),
      declaredFilename: 'acceptance-avatar.png',
      declaredContentType: 'image/png',
    });
    const terminal = await upload.done;
    assert.equal(terminal.status, 'ready', JSON.stringify(terminal.diagnostic ?? terminal));
    await expectAppCode(
      () => bob.client.mutate(api.attachMyAvatar, {
        args: {
          profileId: aliceProfile._id,
          assetId: terminal.assetId,
          sourceDigest,
        },
      }),
      'PROFILE_NOT_OWNED',
    );
    await alice.client.mutate(api.attachMyAvatar, {
      args: {
        profileId: aliceProfile._id,
        assetId: terminal.assetId,
        sourceDigest,
      },
    });
    const attached = (await alice.client.query(api.getMyProfile, { args: {} })).rows[0];
    assert.equal(attached.avatar, terminal.assetId);
    assert.equal(attached.avatarSourceDigest, sourceDigest);
    const delivered = await fetch(
      `${server.baseUrl}/assets/public/${encodeURIComponent(terminal.assetId)}/thumb`,
    );
    assert.equal(delivered.status, 200);
  });

  await t.test('public handle lookup returns only the public M1 projection', async () => {
    const anonymous = new SnapbackClient(server.baseUrl, {
      authClientProtocol: 1,
      custody: 'anonymous-public',
      adminToken: null,
      clientStoreId: 'coterie-test-public-lookup',
      rqsStore: null,
      offlineQueue: false,
    });
    clients.push(anonymous);
    const rows = (await anonymous.query(api.getProfileByHandle, {
      args: { handle: 'acceptance_alice' },
    })).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      'avatar',
      'bio',
      'displayName',
      'handle',
      'link',
      'location',
    ]);
    assert.equal(rows[0].handle, 'acceptance_alice');
    assert.equal(rows[0].displayName, 'Alice Edited');
  });

  await t.test('logout revokes the already-proven captured session bearer server-side', async () => {
    await alice.client.authLogout();
    const stale = createExternalSessionClient(server.baseUrl, {
      bearerToken: aliceBearer,
      rqsStore: null,
      offlineQueue: false,
    });
    clients.push(stale);
    await expectCode(
      () => stale.query(api.getMyProfile, { args: {} }),
      'SNAPBACK_AUTH_SESSION_EXPIRED',
    );
  });

  await t.test('the deterministic M1 fixture installer is idempotent', async () => {
    const first = await installM1Fixtures({ baseUrl: server.baseUrl, runId: 'first' });
    const second = await installM1Fixtures({ baseUrl: server.baseUrl, runId: 'second' });
    assert.equal(first.accounts.length, 8);
    assert.equal(second.accounts.length, 8);
    assert(first.accounts.every(({ disposition }) => disposition === 'created'));
    assert(second.accounts.every(({ disposition }) => disposition === 'matched'));
    assert.equal(first.profiles.length, 8);
    assert.deepEqual(second.profiles, first.profiles);
    assert(first.profiles.every(({ avatar }) => typeof avatar === 'string' && avatar.length > 0));
  });
});
