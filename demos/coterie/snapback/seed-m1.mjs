#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SnapbackClient,
} from '../../../packages/snapback-client/index.mjs';
import { createAssetClient } from '../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';

import { loadGeneratedApi, loadGeneratedJson } from './generated-artifacts.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(backendDir, '..', '..', '..');
const fixtureRoot = join(repoRoot, 'benchmarks', 'fixtures', 'social-messenger');
const productionApi = await loadGeneratedApi();
const schemaManifest = loadGeneratedJson('schema.manifest.json');
const mediaManifest = JSON.parse(readFileSync(join(fixtureRoot, 'media', 'manifest.json'), 'utf8'));

function diagnosticCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

function createPasswordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
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

function fixturePersonas() {
  const source = JSON.parse(readFileSync(join(fixtureRoot, 'personas.json'), 'utf8'));
  if (source.version !== '0.1.0-p1' || !Array.isArray(source.starter) || source.starter.length !== 8) {
    throw new Error('Coterie M1 requires social-messenger personas version 0.1.0-p1 with eight starter identities');
  }
  return source.starter;
}

function profileSnapshot(row) {
  return {
    id: row._id,
    ownerId: row.ownerId,
    fixtureId: row.fixtureId ?? null,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    location: row.location,
    link: row.link,
    avatar: row.avatar ?? null,
    version: row._version,
    updatedAt: row._updatedAt,
  };
}

function expectedAvatarDigest(persona) {
  const filename = basename(persona.profile.avatar);
  const digest = mediaManifest.artifacts?.[filename]?.sha256;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`fixture ${persona.id} has no expected avatar digest for ${filename}`);
  }
  const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
  const observed = createHash('sha256').update(bytes).digest('hex');
  if (observed !== digest) {
    throw new Error(`fixture ${persona.id} avatar bytes do not match ${digest}`);
  }
  return digest;
}

async function avatarMatchesFixture(client, row, expectedDigest) {
  if (
    !row
    || typeof row.avatar !== 'string'
    || row.avatar.length === 0
    || row.avatarSourceDigest !== expectedDigest
  ) return false;
  try {
    const record = await createAssetClient(client).record(row.avatar);
    return record.availability === 'ready'
      && record.integrityGrade === 'end-to-end-verified'
      && record.digestAlgorithm === 'sha256'
      && typeof record.digest === 'string'
      && record.digest.length === 64;
  } catch {
    return false;
  }
}

export async function installM1Fixtures({
  baseUrl,
  runId = 'install',
  generatedApi = productionApi,
}) {
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('http')) {
    throw new TypeError('installM1Fixtures requires a Snapback baseUrl');
  }

  const profiles = [];
  const accounts = [];
  for (const persona of fixturePersonas()) {
    const fixture = createPasswordClient(baseUrl, `coterie-m1-${runId}-${persona.id}`);
    const avatarDigest = expectedAvatarDigest(persona);
    try {
      let accountDisposition = 'created';
      let rows = [];
      try {
        await fixture.client.authPasswordSignup({
          email: persona.email,
          password: persona.password,
        });
      } catch (error) {
        if (diagnosticCode(error) !== 'SNAPBACK_AUTH_PASSWORD_EXISTS') throw error;
        const signin = await fixture.client.authPasswordSignIn({
          email: persona.email,
          password: persona.password,
        });
        rows = (await fixture.client.query(generatedApi.getMyProfile, { args: {} })).rows;
        const current = rows[0];
        const fixtureMatches = rows.length === 1
          && current
          && current.ownerId === signin.session.userId
          && current.fixtureId === persona.id
          && current.handle === persona.profile.handle
          && current.displayName === persona.profile.displayName
          && current.bio === persona.profile.bio
          && current.location === persona.profile.location
          && current.link === persona.profile.link
          && await avatarMatchesFixture(fixture.client, current, avatarDigest);
        if (fixtureMatches) {
          accounts.push({ id: persona.id, email: persona.email, disposition: 'matched' });
          profiles.push(profileSnapshot(current));
          continue;
        }
        accountDisposition = 'repaired';
      }

      const profileId = (await fixture.client.mutate(generatedApi.ensureMyProfile, {
        args: {
          fixtureId: persona.id,
          handle: persona.profile.handle,
          displayName: persona.profile.displayName,
          bio: persona.profile.bio,
          location: persona.profile.location,
          link: persona.profile.link,
        },
      })).result;

      rows = (await fixture.client.query(generatedApi.getMyProfile, { args: {} })).rows;
      if (rows.length !== 1 || rows[0]._id !== profileId) {
        throw new Error(`fixture ${persona.id} did not resolve its own profile`);
      }
      if (!await avatarMatchesFixture(fixture.client, rows[0], avatarDigest)) {
        const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
        const assets = createAssetClient(fixture.client);
        const upload = assets.start({
          upload: generatedApi.avatarUpload,
          file: new Blob([bytes], { type: 'image/png' }),
          declaredFilename: `${persona.id}-avatar.png`,
          declaredContentType: 'image/png',
        });
        const terminal = await upload.done;
        if (terminal.status !== 'ready') {
          throw new Error(`fixture ${persona.id} avatar failed: ${JSON.stringify(terminal.diagnostic ?? terminal)}`);
        }
        await fixture.client.mutate(generatedApi.attachMyAvatar, {
          args: {
            profileId,
            assetId: terminal.assetId,
            sourceDigest: avatarDigest,
          },
        });
        rows = (await fixture.client.query(generatedApi.getMyProfile, { args: {} })).rows;
      }
      if (!await avatarMatchesFixture(fixture.client, rows[0], avatarDigest)) {
        throw new Error(`fixture ${persona.id} avatar digest does not match ${avatarDigest}`);
      }

      accounts.push({ id: persona.id, email: persona.email, disposition: accountDisposition });
      profiles.push(profileSnapshot(rows[0]));
    } finally {
      await fixture.client.closeAuth();
    }
  }

  profiles.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
  return { accounts, profiles };
}

function cliBaseUrl(argv) {
  const index = argv.indexOf('--url');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return process.env.SNAPBACK_URL ?? null;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const baseUrl = cliBaseUrl(process.argv.slice(2));
  if (!baseUrl) {
    process.stderr.write('usage: node demos/coterie/snapback/seed-m1.mjs --url http://127.0.0.1:<port>\n');
    process.exitCode = 2;
  } else {
    const report = await installM1Fixtures({ baseUrl, runId: `cli-${Date.now()}` });
    process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
  }
}
