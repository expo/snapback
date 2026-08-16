#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import { createAssetClient } from '../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';

import { loadGeneratedApi, loadGeneratedJson } from './generated-artifacts.mjs';
import { installM1Fixtures } from './seed-m1.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(backendDir, '..', '..', '..');
const fixtureRoot = join(repoRoot, 'benchmarks', 'fixtures', 'social-messenger');
const api = await loadGeneratedApi();
const schemaManifest = loadGeneratedJson('schema.manifest.json');
const mediaManifest = JSON.parse(readFileSync(join(fixtureRoot, 'media', 'manifest.json'), 'utf8'));

function passwordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  return new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
}

function fixturePersonas() {
  const source = JSON.parse(readFileSync(join(fixtureRoot, 'personas.json'), 'utf8'));
  if (source.version !== '0.1.0-p1' || !Array.isArray(source.starter) || source.starter.length !== 8) {
    throw new Error('Coterie M2 requires the eight social-messenger starter identities');
  }
  return source.starter;
}

function tokensFor(line) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    while (line[index] === ' ' || line[index] === '\t') index += 1;
    if (index >= line.length) break;
    if (line[index] === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < line.length) {
        const character = line[index];
        if (!escaped && character === '"') {
          index += 1;
          break;
        }
        escaped = !escaped && character === '\\';
        if (character !== '\\') escaped = false;
        index += 1;
      }
      tokens.push(JSON.parse(line.slice(start, index)));
    } else {
      const start = index;
      while (index < line.length && line[index] !== ' ' && line[index] !== '\t') index += 1;
      tokens.push(line.slice(start, index));
    }
  }
  return tokens;
}

function sourceDigest(line) {
  return createHash('sha256').update(line).digest('hex');
}

function starterActions() {
  const lines = readFileSync(join(fixtureRoot, 'starter-m2.log'), 'utf8')
    .trim()
    .split('\n');
  return lines.map((line) => {
    const [timestamp, actor, verb, ...args] = tokensFor(line);
    return { timestamp, actor, verb, args, line, digest: sourceDigest(line) };
  });
}

function expectedMediaDigest(relativePath) {
  const filename = basename(relativePath);
  const expected = mediaManifest.artifacts?.[filename]?.sha256;
  if (typeof expected !== 'string') throw new Error(`missing media digest for ${relativePath}`);
  const observed = createHash('sha256')
    .update(readFileSync(join(fixtureRoot, relativePath)))
    .digest('hex');
  if (observed !== expected) throw new Error(`${relativePath} bytes do not match ${expected}`);
  return expected;
}

function mediaTypeFor(relativePath) {
  const extension = extname(relativePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.mp4') return 'video/mp4';
  throw new Error(`unsupported fixture media type: ${relativePath}`);
}

async function uploadFixtureMedia(client, relativePath, upload) {
  const bytes = readFileSync(join(fixtureRoot, relativePath));
  const mediaType = mediaTypeFor(relativePath);
  const task = createAssetClient(client).start({
    upload,
    file: new Blob([bytes], { type: mediaType }),
    declaredFilename: basename(relativePath),
    declaredContentType: mediaType,
  });
  const terminal = await task.done;
  if (terminal.status !== 'ready') {
    throw new Error(`fixture media ${relativePath} failed: ${JSON.stringify(terminal.diagnostic ?? terminal)}`);
  }
  return terminal.assetId;
}

async function assetIsReady(client, assetId) {
  try {
    const record = await createAssetClient(client).record(assetId);
    return record.availability === 'ready'
      && record.integrityGrade === 'end-to-end-verified'
      && record.digestAlgorithm === 'sha256'
      && typeof record.digest === 'string'
      && record.digest.length === 64;
  } catch {
    return false;
  }
}

function postActionShape(action, postIds) {
  if (action.verb === 'reply') {
    const [fixtureId, parentFixtureId, body] = action.args;
    const parentId = postIds.get(parentFixtureId);
    if (!parentId) throw new Error(`reply ${fixtureId} cannot resolve parent ${parentFixtureId}`);
    return {
      fixtureId,
      kind: 'text',
      body,
      mediaPaths: [],
      parentId,
    };
  }
  const [fixtureId, kind, body, mediaToken] = action.args;
  return {
    fixtureId,
    kind,
    body,
    mediaPaths: mediaToken ? mediaToken.split(',') : [],
    parentId: undefined,
  };
}

async function existingPostMatches(client, action, shape, post) {
  if (!post) return false;
  if (
    post.fixtureDigest !== action.digest
    || post.kind !== shape.kind
    || post.body !== shape.body
    || (post.parentId ?? null) !== (shape.parentId ?? null)
  ) return false;
  const media = (await client.query(api.getMyFixturePostMedia, {
    args: { postId: post._id },
  })).rows;
  if (media.length !== shape.mediaPaths.length) return false;
  for (let position = 0; position < shape.mediaPaths.length; position += 1) {
    const path = shape.mediaPaths[position];
    const expectedKind = shape.kind === 'video' ? 'video' : 'image';
    const row = media.find((candidate) => (
      candidate.mediaKind === expectedKind && candidate.position === position
    ));
    if (
      !row
      || row.sourceDigest !== expectedMediaDigest(path)
      || !await assetIsReady(client, row.assetId)
    ) return false;
  }
  return true;
}

async function ensurePost(client, action, postIds) {
  const shape = postActionShape(action, postIds);
  const existing = (await client.query(api.getMyFixturePost, {
    args: { fixtureId: shape.fixtureId },
  })).rows[0] ?? null;
  if (await existingPostMatches(client, action, shape, existing)) {
    return { fixtureId: shape.fixtureId, postId: existing._id, disposition: 'matched' };
  }

  const imagePaths = shape.kind === 'images' ? shape.mediaPaths : [];
  const videoPath = shape.kind === 'video' ? shape.mediaPaths[0] : undefined;
  const imageAssetIds = [];
  for (const path of imagePaths) {
    imageAssetIds.push(await uploadFixtureMedia(client, path, api.postImageUpload));
  }
  const videoAssetId = videoPath
    ? await uploadFixtureMedia(client, videoPath, api.postVideoUpload)
    : undefined;
  const outcome = (await client.mutate(api.ensureFixturePost, {
    args: {
      fixtureId: shape.fixtureId,
      fixtureDigest: action.digest,
      kind: shape.kind,
      body: shape.body,
      imageAssetIds,
      imageSourceDigests: imagePaths.map(expectedMediaDigest),
      ...(videoAssetId ? { videoAssetId, videoSourceDigest: expectedMediaDigest(videoPath) } : {}),
      ...(shape.parentId ? { parentId: shape.parentId } : {}),
    },
  })).result;
  return { fixtureId: shape.fixtureId, ...outcome };
}

export async function installM2Fixtures({ baseUrl, runId = 'install' }) {
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('http')) {
    throw new TypeError('installM2Fixtures requires a Snapback baseUrl');
  }
  const m1 = await installM1Fixtures({ baseUrl, runId: `m2-${runId}` });
  const clients = new Map();
  const profiles = new Map();
  try {
    for (const persona of fixturePersonas()) {
      const client = passwordClient(baseUrl, `coterie-m2-${runId}-${persona.id}`);
      clients.set(persona.id, client);
      await client.authPasswordSignIn({ email: persona.email, password: persona.password });
      const profile = (await client.query(api.getMyProfile, { args: {} })).rows[0];
      if (!profile || profile.fixtureId !== persona.id) {
        throw new Error(`fixture principal ${persona.id} has no matching profile`);
      }
      profiles.set(persona.id, profile);
    }

    const postIds = new Map();
    const report = { m1, follows: [], posts: [], likes: [], reposts: [] };
    for (const action of starterActions()) {
      const client = clients.get(action.actor);
      if (!client) throw new Error(`unknown fixture actor ${action.actor}`);
      if (action.verb === 'follow') {
        const [targetActor, state, mutationId] = action.args;
        if (state !== 'set') throw new Error(`starter follow ${mutationId} is not set-state`);
        const target = profiles.get(targetActor);
        const disposition = (await client.mutate(api.ensureFixtureFollow, {
          args: {
            profileId: target._id,
            mutationId,
            sourceDigest: action.digest,
          },
        })).result;
        report.follows.push({ mutationId, disposition });
      } else if (action.verb === 'post' || action.verb === 'reply') {
        const outcome = await ensurePost(client, action, postIds);
        postIds.set(outcome.fixtureId, outcome.postId);
        report.posts.push(outcome);
      } else if (action.verb === 'like') {
        const [postFixtureId, state, mutationId] = action.args;
        if (state !== 'set') throw new Error(`starter like ${mutationId} is not set-state`);
        const postId = postIds.get(postFixtureId);
        const disposition = (await client.mutate(api.ensureFixtureLike, {
          args: { postId, mutationId, sourceDigest: action.digest },
        })).result;
        report.likes.push({ mutationId, disposition });
      } else if (action.verb === 'repost') {
        const [postFixtureId, state, mutationId] = action.args;
        if (state !== 'set') throw new Error(`starter repost ${mutationId} is not set-state`);
        const postId = postIds.get(postFixtureId);
        const disposition = (await client.mutate(api.ensureFixtureRepost, {
          args: { postId, mutationId, sourceDigest: action.digest },
        })).result;
        report.reposts.push({ mutationId, disposition });
      } else {
        throw new Error(`unsupported M2 fixture action ${action.verb}`);
      }
    }
    return report;
  } finally {
    await Promise.allSettled([...clients.values()].map((client) => client.closeAuth()));
  }
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
    process.stderr.write('usage: node demos/coterie/snapback/seed-m2.mjs --url http://127.0.0.1:<port>\n');
    process.exitCode = 2;
  } else {
    const report = await installM2Fixtures({ baseUrl, runId: `cli-${Date.now()}` });
    process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
  }
}
