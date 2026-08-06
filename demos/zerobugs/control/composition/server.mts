/// <reference types="bun" />

import {appendFile, mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {
  SnapbackClient,
  createExternalSessionClient,
} from '@expo/snapback-client';
import {createAssetClient} from '@expo/snapback-client/assets';

import {actorEmail, type ActorId} from '../scripts/bind-actors.mts';
import {mintDevSession} from '../scripts/load-fixture.mts';
import {
  EnvelopeError,
  MUTATION_REF_NAMES,
  parseMutationEnvelope,
  parseQueryEnvelope,
  mutationResultEnvelope,
  queryResultEnvelope,
  type QueryName,
} from './lib/envelopes.mts';
import {markdownError, renderMachineIssueMarkdown} from './lib/markdown.mts';
import {
  tokenDigest,
  verifyUnsubscribeToken,
} from './lib/tokens.mts';

type JsonRecord = Record<string, unknown>;
type GeneratedApi = Record<string, unknown>;
type SessionClient = ReturnType<typeof createExternalSessionClient>;

const CONTROL_ROOT = resolve(import.meta.dirname, '..');
const COMPOSITION_PATH = join(CONTROL_ROOT, 'composition/zerobugs-control-composition.v1.json');
const ARTIFACTS_PATH = join(CONTROL_ROOT, 'snapback/generated/artifacts.json');
const GENERATED_API_PATH = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
const FIXTURE_METADATA_PATH = join(CONTROL_ROOT, 'fixtures/normal-seed-v1/fixture.json');
const FIXTURE_USERS_PATH = join(CONTROL_ROOT, 'fixtures/normal-seed-v1/user.json');
const MAX_ENVELOPE_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const UPLOAD_EXPIRY_SECONDS = 3_600;
const OAUTH_STATE_SECONDS = 600;
const MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
]);
const EFFECT_MUTATIONS = new Set([
  'issue.create', 'issue.update', 'issue.addLabel', 'issue.removeLabel',
  'emoji.addToIssue', 'emoji.addToComment', 'comment.add', 'comment.edit',
]);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function jsonRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} was refused`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: {'cache-control': 'no-store', ...headers},
  });
}

function textResponse(body: string, status: number, contentType: string, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {'content-type': contentType, ...headers},
  });
}

async function boundedJson(request: Request, maximumBytes = MAX_ENVELOPE_BYTES): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpError(413, 'request body exceeds the route bound');
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new HttpError(413, 'request body exceeds the route bound');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'request JSON was refused');
  }
}

function bearerFrom(request: Request): {token: string | null; presented: boolean} {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
    return {token: match?.[1] ?? null, presented: true};
  }
  const cookies = request.headers.get('cookie') ?? '';
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === '__Host-zerobugs-session' || name === 'zerobugs-session') {
      const token = rest.join('=');
      return {token: token || null, presented: true};
    }
  }
  return {token: null, presented: false};
}

function cookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result.set(part.slice(0, index).trim(), part.slice(index + 1));
  }
  return result;
}

function testSecret(name: string, fallback: string): string {
  const configured = process.env[name];
  if (configured) return configured;
  if (process.env.ZERBUGS_TEST_DEFAULTS === '1') return fallback;
  throw new Error(`${name} is required (test defaults require ZERBUGS_TEST_DEFAULTS=1)`);
}

function constantEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function uploadCapability(input: JsonRecord, secret: string): string {
  const payload = Buffer.from(JSON.stringify({
    contentType: input.contentType,
    exp: input.exp,
    key: input.key,
    purpose: 'zerobugs.asset-upload.v1',
    size: input.size,
    sourceUserID: input.sourceUserID,
    v: 1,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyUploadCapability(token: string, secret: string): JsonRecord | null {
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra !== undefined || token.length > 2_048) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let decodedSignature: Buffer;
  try {
    decodedSignature = Buffer.from(supplied, 'base64url');
  } catch {
    return null;
  }
  if (decodedSignature.length !== expected.length || !timingSafeEqual(decodedSignature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JsonRecord;
    if (
      !value || typeof value !== 'object' || Array.isArray(value)
      || !exactKeys(value, ['contentType', 'exp', 'key', 'purpose', 'size', 'sourceUserID', 'v'])
      || value.v !== 1 || value.purpose !== 'zerobugs.asset-upload.v1'
      || typeof value.exp !== 'number' || value.exp < Math.floor(Date.now() / 1_000)
      || typeof value.key !== 'string' || typeof value.sourceUserID !== 'string'
      || typeof value.contentType !== 'string' || !MIME_TYPES.has(value.contentType)
      || !Number.isSafeInteger(value.size) || (value.size as number) < 1 || (value.size as number) > MAX_ASSET_BYTES
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function mimeMatches(contentType: string, bytes: Uint8Array): boolean {
  const ascii = new TextDecoder('utf-8', {fatal: false}).decode(bytes.slice(0, 512));
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v);
  if (contentType === 'image/gif') return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
  if (contentType === 'image/webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (contentType === 'image/svg+xml') return /^(?:\uFEFF|\s)*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(ascii);
  return false;
}

function extensionFor(contentType: string): string {
  return ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  } as Record<string, string>)[contentType] ?? 'bin';
}

async function loadActorMaps(): Promise<{
  actorBySourceID: Map<string, ActorId>;
  actorByGithubID: Map<number, ActorId>;
  githubIDByActor: Map<ActorId, number>;
}> {
  const metadata = JSON.parse(await readFile(FIXTURE_METADATA_PATH, 'utf8')) as {
    actorBindings: Record<ActorId, {sourceUserID: string}>;
  };
  const users = JSON.parse(await readFile(FIXTURE_USERS_PATH, 'utf8')) as Array<{
    id: string;
    githubID: number;
  }>;
  const userByID = new Map(users.map(user => [user.id, user]));
  const actorBySourceID = new Map<string, ActorId>();
  const actorByGithubID = new Map<number, ActorId>();
  const githubIDByActor = new Map<ActorId, number>();
  for (const [actor, binding] of Object.entries(metadata.actorBindings) as Array<[ActorId, {sourceUserID: string}]>) {
    const user = userByID.get(binding.sourceUserID);
    if (!user) throw new Error(`fixture actor ${actor} has no source user`);
    actorBySourceID.set(binding.sourceUserID, actor);
    actorByGithubID.set(user.githubID, actor);
    githubIDByActor.set(actor, user.githubID);
  }
  return {actorBySourceID, actorByGithubID, githubIDByActor};
}

function allowedRedirect(value: string | null, requestOrigin: string): string | null {
  const candidate = value ?? '/';
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
  try {
    const url = new URL(candidate);
    const allowed = new Set([
      requestOrigin,
      ...(process.env.ZERBUGS_OAUTH_REDIRECT_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean),
    ]);
    return allowed.has(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const readyFile = resolve(process.env.SNAPBACK_READY_FILE ?? join(CONTROL_ROOT, '.snapback/dev.ready.json'));
  const gatewayReadyFile = resolve(process.env.ZERBUGS_GATEWAY_READY_FILE ?? join(CONTROL_ROOT, '.snapback/lane5-gateway.ready.json'));
  const captureDir = resolve(process.env.ZERBUGS_CAPTURE_DIR ?? join(CONTROL_ROOT, '.snapback/lane5-captures'));
  const host = process.env.ZERBUGS_GATEWAY_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('ZERBUGS_GATEWAY_HOST must be loopback');
  }
  const portText = process.env.ZERBUGS_GATEWAY_PORT ?? '0';
  if (!/^\d{1,5}$/u.test(portText)) throw new Error('ZERBUGS_GATEWAY_PORT must be 0..65535');
  const port = Number(portText);
  if (port < 0 || port > 65_535) throw new Error('ZERBUGS_GATEWAY_PORT must be 0..65535');
  const unsubscribeSecret = testSecret('ZERBUGS_UNSUBSCRIBE_HMAC_SECRET', 'lane5-test-unsubscribe-secret-v1');
  const uploadSecret = testSecret('ZERBUGS_UPLOAD_HMAC_SECRET', 'lane5-test-upload-secret-v1');
  const captureAuth = testSecret('ZERBUGS_CAPTURE_ADAPTER_AUTH', 'lane5-test-capture-auth-v1');
  const composition = JSON.parse(await readFile(COMPOSITION_PATH, 'utf8')) as JsonRecord;
  const artifacts = JSON.parse(await readFile(ARTIFACTS_PATH, 'utf8')) as JsonRecord;
  const {default: api} = await import(pathToFileURL(GENERATED_API_PATH).href) as {default: GeneratedApi};
  const {actorBySourceID, actorByGithubID, githubIDByActor} = await loadActorMaps();
  const snapbackReady = JSON.parse(await readFile(readyFile, 'utf8')) as {serverUrl?: string};
  if (typeof snapbackReady.serverUrl !== 'string') throw new Error('Snapback ready file has no serverUrl');
  const snapbackBaseUrl = snapbackReady.serverUrl.replace(/\/$/u, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(snapbackBaseUrl)) {
    throw new Error('Snapback ready file must name a loopback server');
  }
  const snapbackHealthResponse = await fetch(`${snapbackBaseUrl}/health`);
  if (!snapbackHealthResponse.ok) throw new Error(`Snapback health refused: ${snapbackHealthResponse.status}`);
  const snapbackHealth = await snapbackHealthResponse.json();
  await mkdir(captureDir, {recursive: true});

  const captureFiles = {
    loops: join(captureDir, 'loops.jsonl'),
    discord: join(captureDir, 'discord.jsonl'),
  } as const;
  const captures = {loops: [] as JsonRecord[], discord: [] as JsonRecord[]};
  const captureByIdentity = new Map<string, JsonRecord>();
  for (const provider of ['loops', 'discord'] as const) {
    try {
      for (const line of (await readFile(captureFiles[provider], 'utf8')).split('\n').filter(Boolean)) {
        const row = JSON.parse(line) as JsonRecord;
        captures[provider].push(row);
        captureByIdentity.set(`${provider}:${String(row.idempotencyKey)}`, row);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const oauthStates = new Map<string, {
    actor: ActorId;
    challenge: string;
    redirect: string;
    expires: number;
  }>();
  const gatewayStartupNonce = randomBytes(16).toString('base64url');

  async function validatedSession(request: Request, required: boolean): Promise<{
    client: SessionClient | SnapbackClient;
    identity: JsonRecord | null;
    authenticated: boolean;
    close: () => Promise<void>;
  }> {
    const carrier = bearerFrom(request);
    if (!carrier.presented && !required) {
      const client = new SnapbackClient(snapbackBaseUrl, {
        custody: 'anonymous-public', adminToken: null, rqsStore: null,
      });
      return {client, identity: null, authenticated: false, close: async () => client.closeAuth()};
    }
    if (!carrier.token) throw new HttpError(401, 'invalid bearer');
    const client = createExternalSessionClient(snapbackBaseUrl, {
      bearerToken: carrier.token,
      clientStoreId: `zerobugs-gateway-${createHash('sha256').update(carrier.token).digest('hex').slice(0, 16)}`,
      rqsStore: null,
    });
    try {
      const self = await client.query(api.gatewayIdentitySelf as never, {args: {}});
      const identity = jsonRecord(self.rows[0], 'session identity');
      return {client, identity, authenticated: true, close: async () => client.closeAuth()};
    } catch {
      await client.closeAuth();
      throw new HttpError(401, 'invalid bearer');
    }
  }

  async function actorSession(actor: ActorId): Promise<{
    client: SessionClient;
    token: string;
    close: () => Promise<void>;
  }> {
    const minted = await mintDevSession(readyFile, actorEmail(actor));
    const client = createExternalSessionClient(minted.baseUrl, {
      bearerToken: minted.token,
      clientStoreId: `zerobugs-gateway-mint-${actor}-${randomBytes(4).toString('hex')}`,
      rqsStore: null,
    });
    return {client, token: minted.token, close: async () => client.closeAuth()};
  }

  async function capture(provider: 'loops' | 'discord', request: Request): Promise<Response> {
    const supplied = request.headers.get('x-zerobugs-capture-auth') ?? '';
    if (!constantEqual(supplied, captureAuth)) throw new HttpError(401, 'capture authorization refused');
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length > 1_024) throw new HttpError(400, 'capture identity refused');
    const body = jsonRecord(await boundedJson(request), 'capture payload');
    const bodyDigest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const mapKey = `${provider}:${idempotencyKey}`;
    const existing = captureByIdentity.get(mapKey);
    if (existing) {
      if (existing.bodyDigest !== bodyDigest) throw new HttpError(409, 'idempotency identity changed payload');
      return jsonResponse({receiptID: existing.receiptID, deduplicated: true});
    }
    const receiptID = `zbr_${createHash('sha256').update(`${provider}\0${idempotencyKey}\0${bodyDigest}`).digest('hex').slice(0, 32)}`;
    const row: JsonRecord = {
      schemaVersion: 'zerobugs-effect-capture.v1',
      provider,
      idempotencyKey,
      bodyDigest,
      body,
      receiptID,
      capturedAt: Date.now(),
      authorizationShape: request.headers.get('authorization')?.startsWith('Bearer ') === true,
    };
    await appendFile(captureFiles[provider], `${JSON.stringify(row)}\n`, {encoding: 'utf8'});
    captures[provider].push(row);
    captureByIdentity.set(mapKey, row);
    return jsonResponse({receiptID, deduplicated: false});
  }

  let publicOrigin = '';
  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();

        if (method === 'GET' && url.pathname === '/health') {
          return jsonResponse({
            schemaVersion: 'zerobugs-control-gateway-health.v1',
            status: 'ok',
            component: {
              id: composition.id,
              version: composition.version,
              runtime: {name: 'bun', version: Bun.version},
              startupNonce: gatewayStartupNonce,
            },
            snapback: {health: snapbackHealth, release: releaseIdentity(artifacts, composition)},
          });
        }

        if (method === 'GET' && url.pathname === '/api/login/github') {
          const redirect = allowedRedirect(url.searchParams.get('redirect'), url.origin);
          if (!redirect) throw new HttpError(400, 'OAuth redirect was refused');
          const fixtureActor = (process.env.ZERBUGS_OAUTH_FIXTURE_ACTOR ?? 'ordinary-user') as ActorId;
          const githubID = githubIDByActor.get(fixtureActor);
          if (githubID === undefined) throw new HttpError(400, 'OAuth fixture actor was refused');
          const state = randomBytes(24).toString('base64url');
          const verifier = randomBytes(32).toString('base64url');
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          oauthStates.set(state, {actor: fixtureActor, challenge, redirect, expires: Date.now() + OAUTH_STATE_SECONDS * 1_000});
          const callback = new URL('/api/login/github/callback', url.origin);
          callback.searchParams.set('code', `local-github-${githubID}`);
          callback.searchParams.set('state', state);
          callback.searchParams.set('code_challenge', challenge);
          return new Response(null, {
            status: 302,
            headers: {
              location: callback.toString(),
              'cache-control': 'no-store',
              'set-cookie': `zerobugs-oauth-state=${state}; HttpOnly; SameSite=Lax; Path=/api/login/github; Max-Age=${OAUTH_STATE_SECONDS}`,
            },
          });
        }

        if (method === 'GET' && url.pathname === '/api/login/github/callback') {
          const state = url.searchParams.get('state') ?? '';
          const code = url.searchParams.get('code') ?? '';
          const challenge = url.searchParams.get('code_challenge') ?? '';
          const stored = oauthStates.get(state);
          oauthStates.delete(state);
          const stateCookie = cookies(request).get('zerobugs-oauth-state');
          const githubMatch = /^local-github-(\d+)$/u.exec(code);
          const githubID = githubMatch ? Number(githubMatch[1]) : NaN;
          const actor = actorByGithubID.get(githubID);
          if (
            !stored || stored.expires < Date.now() || stateCookie !== state
            || !constantEqual(stored.challenge, challenge) || stored.actor !== actor
          ) throw new HttpError(400, 'OAuth callback was refused');
          const session = await actorSession(actor);
          try {
            const self = await session.client.query(api.gatewayIdentitySelf as never, {args: {}});
            const identity = jsonRecord(self.rows[0], 'OAuth identity');
            if (identity.githubID !== githubID) throw new HttpError(400, 'OAuth identity mapping was refused');
          } finally {
            await session.close();
          }
          const cookieName = url.protocol === 'https:' ? '__Host-zerobugs-session' : 'zerobugs-session';
          return new Response(null, {
            status: 302,
            headers: {
              location: stored.redirect,
              'cache-control': 'no-store',
              'set-cookie': `${cookieName}=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${url.protocol === 'https:' ? '; Secure' : ''}`,
            },
          });
        }

        if (method === 'POST' && ['/api/get-queries', '/api/query'].includes(url.pathname)) {
          const envelope = parseQueryEnvelope(await boundedJson(request));
          const session = await validatedSession(request, false);
          try {
            const reference = api[envelope.name];
            if (!reference) throw new HttpError(400, 'query allowlist reference is unavailable');
            const response = await session.client.query(reference as never, {args: envelope.args});
            return jsonResponse(queryResultEnvelope(envelope.name, response.rows));
          } finally {
            await session.close();
          }
        }

        if (method === 'POST' && ['/api/push', '/api/mutate'].includes(url.pathname)) {
          const envelope = parseMutationEnvelope(await boundedJson(request));
          const session = await validatedSession(request, true);
          try {
            const reference = api[MUTATION_REF_NAMES[envelope.name]];
            if (!reference) throw new HttpError(400, 'mutation allowlist reference is unavailable');
            const args = EFFECT_MUTATIONS.has(envelope.name)
              ? {
                  ...envelope.args,
                  compositionClientID: envelope.clientID,
                  compositionMutationID: envelope.mutationID,
                }
              : envelope.args;
            const response = await (session.client as SessionClient).mutate(reference as never, {
              args,
              clientMutationId: `${envelope.clientID}:${envelope.mutationID}`,
              queue: false,
            });
            return jsonResponse(mutationResultEnvelope(envelope.name, response.result));
          } finally {
            await session.close();
          }
        }

        if (method === 'GET' && url.pathname === '/api/unsubscribe') {
          if (url.searchParams.has('email') || url.searchParams.has('id')) {
            throw new HttpError(400, 'unsubscribe capability required');
          }
          const token = url.searchParams.get('token') ?? '';
          const valid = verifyUnsubscribeToken(token, unsubscribeSecret);
          if (!valid) return textResponse('<!doctype html><title>Unsubscribe</title><h1>Link unavailable</h1>', 400, 'text/html; charset=utf-8', {'cache-control': 'no-store'});
          return textResponse(
            `<!doctype html><title>Unsubscribe</title><h1>Confirm unsubscribe</h1><form method="post" action="/api/unsubscribe"><input type="hidden" name="token" value="${token.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"><button type="submit">Unsubscribe</button></form>`,
            200,
            'text/html; charset=utf-8',
            {'cache-control': 'no-store'},
          );
        }

        if (method === 'POST' && url.pathname === '/api/unsubscribe') {
          const contentType = request.headers.get('content-type') ?? '';
          let token = '';
          if (contentType.startsWith('application/json')) {
            const body = jsonRecord(await boundedJson(request, 16 * 1_024), 'unsubscribe body');
            if (!exactKeys(body, ['token']) || typeof body.token !== 'string') throw new HttpError(400, 'unsubscribe capability was refused');
            token = body.token;
          } else if (contentType.startsWith('application/x-www-form-urlencoded')) {
            const raw = await request.text();
            if (raw.length > 16 * 1_024) throw new HttpError(413, 'unsubscribe body exceeds the route bound');
            const form = new URLSearchParams(raw);
            if ([...form.keys()].some(key => key !== 'token')) throw new HttpError(400, 'unsubscribe capability was refused');
            token = form.get('token') ?? '';
          } else {
            throw new HttpError(415, 'unsubscribe content type was refused');
          }
          const claims = verifyUnsubscribeToken(token, unsubscribeSecret);
          const actor = claims ? actorBySourceID.get(claims.user) : undefined;
          if (!claims || !actor) throw new HttpError(400, 'unsubscribe capability was refused');
          const session = await actorSession(actor);
          try {
            await session.client.mutate(api.acceptanceConsumeUnsubscribeToken as never, {
              args: {
                tokenDigest: tokenDigest(token),
                sourceUserID: claims.user,
                issueID: claims.issue,
                usedAt: Date.now(),
              },
              clientMutationId: `unsubscribe:${tokenDigest(token)}`,
              queue: false,
            });
          } catch {
            throw new HttpError(400, 'unsubscribe capability was refused');
          } finally {
            await session.close();
          }
          return textResponse('<!doctype html><title>Unsubscribed</title><h1>Unsubscribed</h1>', 200, 'text/html; charset=utf-8', {'cache-control': 'no-store'});
        }

        if (method === 'POST' && url.pathname === '/api/upload/presigned-url') {
          const session = await validatedSession(request, true);
          try {
            const body = jsonRecord(await boundedJson(request, 16 * 1_024), 'upload intent');
            if (!exactKeys(body, ['contentType', 'size']) || typeof body.contentType !== 'string' || !MIME_TYPES.has(body.contentType)) {
              throw new HttpError(400, 'upload content type was refused');
            }
            if (!Number.isSafeInteger(body.size) || (body.size as number) < 1 || (body.size as number) > MAX_ASSET_BYTES) {
              throw new HttpError(413, 'upload size was refused');
            }
            const sourceUserID = String(session.identity?.sourceUserID ?? '');
            const key = `zba_${randomBytes(24).toString('base64url')}`;
            const token = uploadCapability({
              contentType: body.contentType,
              exp: Math.floor(Date.now() / 1_000) + UPLOAD_EXPIRY_SECONDS,
              key,
              size: body.size,
              sourceUserID,
            }, uploadSecret);
            return jsonResponse({
              url: `${publicOrigin}/api/upload/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`,
              key,
              deliveryUrl: `${publicOrigin}/assets/${encodeURIComponent(key)}`,
            }, 200, {'access-control-allow-origin': '*'});
          } finally {
            await session.close();
          }
        }

        const uploadMatch = /^\/api\/upload\/(zba_[A-Za-z0-9_-]{24,96})$/u.exec(url.pathname);
        if (method === 'OPTIONS' && uploadMatch) {
          return new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-methods': 'PUT, OPTIONS',
              'access-control-allow-headers': 'content-type',
              'access-control-max-age': '3600',
              'cache-control': 'public, max-age=3600',
            },
          });
        }
        if (method === 'PUT' && uploadMatch) {
          const capability = verifyUploadCapability(url.searchParams.get('token') ?? '', uploadSecret);
          if (!capability || capability.key !== uploadMatch[1]) throw new HttpError(403, 'upload capability was refused');
          const contentType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
          if (contentType !== capability.contentType) throw new HttpError(415, 'upload content type did not match its intent');
          const declaredLength = request.headers.get('content-length');
          if (declaredLength !== null && Number(declaredLength) !== capability.size) throw new HttpError(400, 'upload length did not match its intent');
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.byteLength > MAX_ASSET_BYTES) throw new HttpError(413, 'upload exceeds 10 MiB');
          if (bytes.byteLength !== capability.size) throw new HttpError(400, 'upload length did not match its intent');
          if (!mimeMatches(contentType, bytes)) throw new HttpError(415, 'upload bytes did not match the declared content type');
          const actor = actorBySourceID.get(String(capability.sourceUserID));
          if (!actor) throw new HttpError(403, 'upload capability was refused');
          const existingClient = new SnapbackClient(snapbackBaseUrl, {custody: 'anonymous-public', adminToken: null, rqsStore: null});
          try {
            const existing = await existingClient.query(api.gatewayAssetByKey as never, {args: {key: capability.key}});
            if (existing.rows.length > 0) return jsonResponse(
              {key: capability.key, deliveryUrl: `${publicOrigin}/assets/${capability.key}`, deduplicated: true},
              200,
              {'access-control-allow-origin': '*'},
            );
          } finally {
            await existingClient.closeAuth();
          }
          const session = await actorSession(actor);
          try {
            const svgOpaque = contentType === 'image/svg+xml';
            const upload = createAssetClient(session.client).start({
              upload: (svgOpaque ? api.zerobugsSvgUpload : api.zerobugsImageUpload) as never,
              file: new Blob([bytes], {type: svgOpaque ? 'application/octet-stream' : contentType}),
              declaredFilename: `${capability.key}.${extensionFor(contentType)}`,
              declaredContentType: svgOpaque ? 'application/octet-stream' : contentType,
            });
            const completed = await upload.done;
            if (completed.status !== 'ready' || typeof completed.assetId !== 'string') {
              throw new HttpError(502, 'native asset upload did not settle ready');
            }
            await session.client.mutate(api.acceptanceAttachAsset as never, {
              args: {
                key: capability.key,
                assetID: completed.assetId,
                contentType,
                uploadKind: svgOpaque ? 'svg-opaque' : 'image',
                size: bytes.byteLength,
                created: Date.now(),
              },
              clientMutationId: `asset-attach:${capability.key}`,
              queue: false,
            });
            return jsonResponse(
              {key: capability.key, deliveryUrl: `${publicOrigin}/assets/${capability.key}`, deduplicated: false},
              200,
              {'access-control-allow-origin': '*'},
            );
          } finally {
            await session.close();
          }
        }

        const assetMatch = /^\/assets\/(zba_[A-Za-z0-9_-]{24,96})$/u.exec(url.pathname);
        if (method === 'GET' && assetMatch) {
          const client = new SnapbackClient(snapbackBaseUrl, {custody: 'anonymous-public', adminToken: null, rqsStore: null});
          try {
            const found = await client.query(api.gatewayAssetByKey as never, {args: {key: assetMatch[1]}});
            if (found.rows.length !== 1) throw new HttpError(404, 'asset not found');
            const row = jsonRecord(found.rows[0], 'asset attachment');
            const native = await fetch(`${snapbackBaseUrl}/assets/public/${encodeURIComponent(String(row.assetID))}/primary`);
            if (!native.ok || !native.body) throw new HttpError(404, 'asset not found');
            return new Response(native.body, {
              status: 200,
              headers: {
                'content-type': String(row.contentType),
                ...(native.headers.get('content-length')
                  ? {'content-length': native.headers.get('content-length') as string}
                  : {}),
                'cache-control': 'public, max-age=31536000, immutable',
                'access-control-allow-origin': '*',
                'cross-origin-resource-policy': 'cross-origin',
                'x-content-type-options': 'nosniff',
                ...(row.contentType === 'image/svg+xml'
                  ? {'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"}
                  : {}),
              },
            });
          } finally {
            await client.closeAuth();
          }
        }

        const markdownMatch = /^\/p\/([^/]+)\/issue\/([^/]+)\.md$/u.exec(url.pathname);
        if (method === 'GET' && markdownMatch) {
          const authenticatedCarrier = bearerFrom(request).presented;
          let session: Awaited<ReturnType<typeof validatedSession>>;
          try {
            session = await validatedSession(request, false);
          } catch (error) {
            if (error instanceof HttpError && error.status === 401) {
              return textResponse(markdownError(401, 'Authorization was refused.'), 401, 'text/markdown; charset=utf-8', {'cache-control': 'private, no-store'});
            }
            throw error;
          }
          const cache = session.authenticated || authenticatedCarrier
            ? 'private, no-store'
            : 'public, s-maxage=60';
          try {
            let projectName: string;
            let idText: string;
            try {
              projectName = decodeURIComponent(markdownMatch[1]);
              idText = decodeURIComponent(markdownMatch[2]);
            } catch {
              return textResponse(markdownError(404, 'Issue not found.'), 404, 'text/markdown; charset=utf-8', {'cache-control': cache});
            }
            if (!projectName || !idText || idText.length > 256) {
              return textResponse(markdownError(404, 'Issue not found.'), 404, 'text/markdown; charset=utf-8', {'cache-control': cache});
            }
            const numeric = /^\d+$/u.test(idText);
            const numericID = numeric ? Number(idText) : null;
            if (numeric && (!Number.isSafeInteger(numericID) || (numericID as number) < 1)) {
              return textResponse(markdownError(404, 'Issue not found.'), 404, 'text/markdown; charset=utf-8', {'cache-control': cache});
            }
            const detail = await session.client.query(api.issueDetail as never, {
              args: {idField: numeric ? 'shortID' : 'id', id: numeric ? numericID : idText},
            });
            const row = detail.rows[0] as JsonRecord | undefined;
            if (!row || row.value === null) {
              return textResponse(markdownError(404, 'Issue not found.'), 404, 'text/markdown; charset=utf-8', {'cache-control': cache});
            }
            const value = jsonRecord(row.value, 'issue detail');
            const issue = jsonRecord(value.issue, 'issue');
            const project = jsonRecord(value.project, 'project');
            const canonicalProject = String(project.lowerCaseName);
            const canonicalShortID = String(issue.shortID);
            const canonicalPath = `/p/${encodeURIComponent(canonicalProject)}/issue/${encodeURIComponent(canonicalShortID)}.md`;
            if (projectName !== canonicalProject || idText !== canonicalShortID) {
              return new Response(null, {
                status: 308,
                headers: {
                  location: canonicalPath,
                  'cache-control': session.authenticated ? 'private, no-store' : 'public, s-maxage=300',
                },
              });
            }
            const commentsResult = await session.client.query(api.commentsPage as never, {
              args: {issueID: String(issue.id), limit: 1_000, start: null, dir: 'backward', inclusive: false},
            });
            const commentsEnvelope = jsonRecord(commentsResult.rows[0], 'comments page');
            const newest = Array.isArray(commentsEnvelope.items) ? commentsEnvelope.items : [];
            const markdown = renderMachineIssueMarkdown(row, [...newest].reverse());
            return textResponse(markdown, 200, 'text/markdown; charset=utf-8', {
              'cache-control': session.authenticated
                ? 'private, no-store'
                : 'public, s-maxage=300, stale-while-revalidate=3600',
            });
          } finally {
            await session.close();
          }
        }

        if (method === 'POST' && url.pathname === '/__capture/loops') return await capture('loops', request);
        if (method === 'POST' && url.pathname === '/__capture/discord') return await capture('discord', request);
        if (method === 'GET' && url.pathname === '/__capture/receipts') {
          if (!constantEqual(request.headers.get('x-zerobugs-capture-auth') ?? '', captureAuth)) {
            throw new HttpError(401, 'capture authorization refused');
          }
          return jsonResponse({schemaVersion: 'zerobugs-effect-captures.v1', captures});
        }

        return jsonResponse({error: 'route not found'}, 404);
      } catch (error) {
        if (error instanceof EnvelopeError) return jsonResponse({error: error.code}, 400);
        if (error instanceof HttpError) return jsonResponse({error: error.message}, error.status);
        if (
          error && typeof error === 'object'
          && (error as {code?: unknown}).code === 'SNAPBACK_ARGUMENT_VALIDATION_FAILED'
        ) return jsonResponse({error: 'ZERBUGS_OPERATION_ARGUMENTS_INVALID'}, 400);
        return jsonResponse({error: 'gateway request failed'}, 500);
      }
    },
  });
  publicOrigin = `http://${host}:${server.port}`;
  const readiness = {
    schemaVersion: 'zerobugs-control-gateway-ready.v1',
    status: 'ok',
    baseUrl: publicOrigin,
    pid: process.pid,
    component: {
      id: composition.id,
      version: composition.version,
      runtime: {name: 'bun', version: Bun.version},
      startupNonce: gatewayStartupNonce,
    },
    snapback: {health: snapbackHealth, release: releaseIdentity(artifacts, composition)},
  };
  await mkdir(dirname(gatewayReadyFile), {recursive: true});
  await writeFile(gatewayReadyFile, `${JSON.stringify(readiness, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  process.stdout.write(`${JSON.stringify({schemaVersion: readiness.schemaVersion, status: 'ok', baseUrl: publicOrigin, pid: process.pid})}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.stop(true);
    await unlink(gatewayReadyFile).catch(() => undefined);
  };
  process.on('SIGINT', () => void stop().finally(() => process.exit(0)));
  process.on('SIGTERM', () => void stop().finally(() => process.exit(0)));
}

function releaseIdentity(artifacts: JsonRecord, composition: JsonRecord): JsonRecord {
  const declared = jsonRecord(composition.snapbackRelease, 'declared Snapback release identity');
  const result: JsonRecord = {};
  for (const key of ['appId', 'schemaVersion', 'inputsHash', 'schemaHash', 'bundleHash']) {
    if (typeof artifacts[key] !== 'string' || artifacts[key] !== declared[key]) {
      throw new Error(`composition release identity mismatch for ${key}`);
    }
    result[key] = artifacts[key];
  }
  if (declared.targetProfileId !== 'local-dev-sqlite-ibex') {
    throw new Error('composition target profile identity mismatch');
  }
  result.targetProfileId = declared.targetProfileId;
  return result;
}

await main();
