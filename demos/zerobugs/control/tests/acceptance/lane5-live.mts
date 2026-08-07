import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {createExternalSessionClient} from '@expo/snapback-client';

import {
  ACTOR_IDS,
  bindActorsAgainstReadyFile,
  emitActorBindingReceipt,
  type ActorId,
} from '../../scripts/bind-actors.mts';
import {loadFixtureAgainstReadyFile} from '../../scripts/load-fixture.mts';
import {deliverTick} from '../../composition/effects/deliver.mts';
import {
  renderIntentDeliveries,
  type IntentSnapshot,
  type RenderedDelivery,
} from '../../composition/effects/payloads.mts';
import {
  signUnsubscribeToken,
} from '../../composition/lib/tokens.mts';

type JsonObject = Record<string, unknown>;
type JsonRow = Record<string, unknown>;
type Client = ReturnType<typeof createExternalSessionClient>;
type CheckReceipt = {id: string; status: 'pass' | 'fail'; error?: string};
type GatewayProcess = ReturnType<typeof Bun.spawn>;

const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const GENERATED_API_PATH = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
const ARTIFACTS_PATH = join(CONTROL_ROOT, 'snapback/generated/artifacts.json');
const COMPOSITION_PATH = join(CONTROL_ROOT, 'composition/zerobugs-control-composition.v1.json');
const SERVER_PATH = join(CONTROL_ROOT, 'composition/server.mts');
const EXPECTED_CHECKS = 16;
const PROJECT_ID = 'iCNlS2qEpzYWEes1RTf-D';
const INTERNAL_ISSUE_ID = 'zbav1_internal_issue';
const LANE5_ISSUE_ID = 'zb_lane5_issue_v1';
const LANE5_COMMENT_ID = 'zb_lane5_comment_v1';
const LANE5_ISSUE_EMOJI_ID = 'zb_lane5_issue_emoji_v1';
const LANE5_COMMENT_EMOJI_ID = 'zb_lane5_comment_emoji_v1';
const CLIENT_ID = 'lane5-client';
const UNSUBSCRIBE_SECRET = 'lane5-test-unsubscribe-secret-v1';
const UPLOAD_SECRET = 'lane5-test-upload-secret-v1';
const CAPTURE_AUTH = 'lane5-test-capture-auth-v1';
const LOOPS_TRANSACTIONAL_ID = 'lane5-test-transactional-v1';

const IMAGE_BYTES = new Map<string, Uint8Array>([
  ['image/jpeg', Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z', 'base64')],
  ['image/png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8wwACLGCSAQANBAECv1AVswAAAABJRU5ErkJggg==', 'base64')],
  ['image/gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')],
  ['image/webp', Buffer.from('UklGRiIAAABXRUJQVlA4ICAAAADQAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA', 'base64')],
  ['image/svg+xml', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="red" d="M0 0h2v2H0z"/></svg>')],
]);

function record(value: unknown, label: string): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is an object`);
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} is a string`);
  return value;
}

function number(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `${label} is a number`);
  assert(Number.isFinite(value), `${label} is finite`);
  return value;
}

function errorText(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 2_048 ? value : `${value.slice(0, 2_048)}…`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function waitForSettledStart(readyFile: string): Promise<{serverUrl: string}> {
  const deadline = Date.now() + 30_000;
  let lastError = 'readiness descriptor has not appeared';
  while (Date.now() < deadline) {
    try {
      const firstText = await readFile(readyFile, 'utf8');
      const ready = record(JSON.parse(firstText), 'readiness descriptor');
      const serverUrl = text(ready.serverUrl, 'ready.serverUrl');
      assert.match(serverUrl, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/u);
      const advertised = text(ready.impersonationCapabilityFile, 'ready.impersonationCapabilityFile');
      assert.equal(advertised, `${readyFile}.impersonation`);
      assert.match((await readFile(advertised, 'utf8')).trim(), /^sbic_[A-Za-z0-9_-]+\.[0-9a-f]{8}$/u);
      assert.equal(await readFile(readyFile, 'utf8'), firstText, 'readiness stayed stable');
      return {serverUrl};
    } catch (error) {
      lastError = errorText(error);
      await delay(50);
    }
  }
  throw new Error(`settled server start timed out: ${lastError}`);
}

async function waitForGateway(readyFile: string, process: GatewayProcess): Promise<JsonObject> {
  const deadline = Date.now() + 30_000;
  let lastError = 'gateway readiness has not appeared';
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`gateway exited before readiness with code ${process.exitCode}`);
    }
    try {
      const first = await readFile(readyFile, 'utf8');
      const ready = record(JSON.parse(first), 'gateway readiness');
      assert.equal(ready.status, 'ok');
      assert.match(text(ready.baseUrl, 'gateway baseUrl'), /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u);
      const health = await fetch(`${ready.baseUrl}/health`, {signal: AbortSignal.timeout(2_000)});
      assert.equal(health.status, 200);
      assert.equal(await readFile(readyFile, 'utf8'), first, 'gateway readiness stayed stable');
      return ready;
    } catch (error) {
      lastError = errorText(error);
      await delay(50);
    }
  }
  throw new Error(`gateway start timed out: ${lastError}`);
}

function bearer(token: string): HeadersInit {
  return {authorization: `Bearer ${token}`};
}

async function json(response: Response, label: string): Promise<JsonObject> {
  return record(await response.json(), label);
}

async function postJson(
  url: string,
  body: unknown,
  headers: HeadersInit = {},
): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

function cookiePair(setCookie: string | null, name: string): string {
  assert(setCookie, `${name} cookie exists`);
  const pair = setCookie.split(';', 1)[0];
  assert(pair.startsWith(`${name}=`), `${name} cookie has the expected name`);
  return pair;
}

function intentRows(audit: JsonObject): JsonRow[] {
  assert(Array.isArray(audit.notificationIntent));
  return audit.notificationIntent as JsonRow[];
}

function attemptRows(audit: JsonObject): JsonRow[] {
  assert(Array.isArray(audit.notificationAttempt));
  return audit.notificationAttempt as JsonRow[];
}

function addedRows(before: readonly JsonRow[], after: readonly JsonRow[]): JsonRow[] {
  const ids = new Set(before.map(row => text(row.physicalID, 'row physicalID')));
  return after.filter(row => !ids.has(text(row.physicalID, 'row physicalID')));
}

function effectArgs(args: JsonObject, mutationID: string): JsonObject {
  return {
    ...args,
    compositionClientID: CLIENT_ID,
    compositionMutationID: mutationID,
  };
}

async function mutateEffect(
  client: Client,
  reference: unknown,
  args: JsonObject,
  mutationID: string,
): Promise<JsonObject> {
  const response = await client.mutate(reference as never, {
    args: effectArgs(args, mutationID),
    clientMutationId: `${CLIENT_ID}:${mutationID}`,
    queue: false,
  });
  return record(response.result, `${mutationID} mutation result`);
}

async function configureActionSecrets(readyFile: string, serverUrl: string): Promise<void> {
  const ready = record(JSON.parse(await readFile(readyFile, 'utf8')), 'ready descriptor');
  const tokenFile = text(ready.adminTokenFile, 'ready.adminTokenFile');
  const adminToken = (await readFile(tokenFile, 'utf8')).trim();
  const values = new Map([
    ['loopsApiKey', 'lane5-test-loops-provider-token-v1'],
    ['discordWebhookToken', 'lane5-test-discord-provider-token-v1'],
    ['captureAdapterAuth', CAPTURE_AUTH],
  ]);
  for (const [entry, value] of values) {
    const response = await postJson(
      `${serverUrl}/_snapback/api/config/set`,
      {entry, value},
      {'x-snapback-admin-token': adminToken},
    );
    assert.equal(response.status, 200, `config entry ${entry} was accepted by the local deployment`);
    const receipt = await json(response, `${entry} config receipt`);
    assert(!JSON.stringify(receipt).includes(value), `${entry} config receipt does not disclose its value`);
  }
}

async function captureReceipt(baseUrl: string): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}/__capture/receipts`, {
    headers: {'x-zerobugs-capture-auth': CAPTURE_AUTH},
  });
  assert.equal(response.status, 200);
  return await json(response, 'capture receipt');
}

function allCaptures(receipt: JsonObject): JsonRow[] {
  const captures = record(receipt.captures, 'capture provider groups');
  assert(Array.isArray(captures.loops));
  assert(Array.isArray(captures.discord));
  return [...captures.loops as JsonRow[], ...captures.discord as JsonRow[]];
}

function addedCaptures(before: readonly JsonRow[], after: readonly JsonRow[]): JsonRow[] {
  const identities = new Set(before.map(row => `${row.provider}:${row.idempotencyKey}`));
  return after.filter(row => !identities.has(`${row.provider}:${row.idempotencyKey}`));
}

function rendered(intent: JsonRow, baseUrl: string): RenderedDelivery[] {
  return renderIntentDeliveries(intent as IntentSnapshot, {
    publicOrigin: baseUrl,
    unsubscribeSecret: UNSUBSCRIBE_SECRET,
    loopsTransactionalID: LOOPS_TRANSACTIONAL_ID,
    expiresAt: Math.floor(number(intent.created, 'intent created') / 1_000) + 30 * 24 * 60 * 60,
  });
}

function assertCaptured(
  intents: readonly JsonRow[],
  captures: readonly JsonRow[],
  baseUrl: string,
): void {
  const expected = intents.flatMap(intent => rendered(intent, baseUrl));
  assert.equal(captures.length, expected.length, 'capture count equals the rendered target count');
  assert.equal(new Set(captures.map(row => `${row.provider}:${row.idempotencyKey}`)).size, captures.length);
  for (const delivery of expected) {
    const capture = captures.find(row => (
      row.provider === delivery.provider && row.idempotencyKey === delivery.idempotencyKey
    ));
    assert(capture, `${delivery.provider} captured ${delivery.idempotencyKey}`);
    assert.deepEqual(capture.body, delivery.body, 'capture payload equals the inventory renderer');
    assert.equal(capture.authorizationShape, true, 'provider capture received a bearer-shaped provider credential');
    if (delivery.channel === 'email') {
      assert.match(delivery.idempotencyKey, /^[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+:[^:]+@[^:]+$/u);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    delay(milliseconds).then(() => { throw new Error(`${label} timed out`); }),
  ]);
}

async function main(): Promise<void> {
  const readyFile = resolve(process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE);
  const {default: api} = await import(pathToFileURL(GENERATED_API_PATH).href) as {
    default: Record<string, unknown>;
  };
  const checks: CheckReceipt[] = [];
  let bound: Awaited<ReturnType<typeof bindActorsAgainstReadyFile>> | null = null;
  let gatewayProcess: GatewayProcess | null = null;
  let gatewayReady: JsonObject | null = null;
  let tempRoot: string | null = null;
  let initialAudit: JsonObject | null = null;
  let gatewayIdentity: JsonObject | null = null;

  const check = async (id: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      checks.push({id, status: 'pass'});
    } catch (error) {
      checks.push({id, status: 'fail', error: errorText(error)});
    }
  };

  const actor = (id: ActorId) => {
    const session = bound?.sessions.get(id);
    assert(session, `${id} session exists`);
    return session;
  };

  const audit = async (): Promise<JsonObject> => {
    const response = await actor('crew-admin').client.query(api.lane4StateAudit as never, {args: {}});
    assert.equal(response.rows.length, 1);
    return record(response.rows[0], 'Lane 5 state audit');
  };

  try {
    await check('settled-start-fresh-fixture-and-bindings', async () => {
      const settled = await waitForSettledStart(readyFile);
      // Required config entries must be supplied before app data opens: the
      // sessions auth-mode transition stays pending (SNAPBACK_AUTH_MODE_PENDING
      // on app-data) while required deployment config is missing.
      await configureActionSecrets(readyFile, settled.serverUrl);
      const loaded = await loadFixtureAgainstReadyFile(readyFile);
      bound = await bindActorsAgainstReadyFile(readyFile);
      await emitActorBindingReceipt(bound.receipt);
      assert.equal(loaded.counts.issue, 517);
      assert.equal(Object.keys(bound.receipt.actors).length, ACTOR_IDS.length);
      assert.equal(actor('creator').baseUrl, settled.serverUrl);
      initialAudit = await audit();
      assert.equal(intentRows(initialAudit).length, 0, 'fresh fixture has no intent rows');
      assert.equal(attemptRows(initialAudit).length, 0, 'fresh fixture has no attempt rows');
    });

    await check('composition-manifest-gateway-health-and-release-identity', async () => {
      assert(bound, 'actor bindings are available');
      tempRoot = await mkdtemp(join(tmpdir(), 'zerobugs-lane5-'));
      const gatewayReadyFile = join(tempRoot, 'gateway.ready.json');
      const captureDir = join(tempRoot, 'captures');
      gatewayProcess = Bun.spawn([process.execPath, SERVER_PATH], {
        cwd: CONTROL_ROOT,
        env: {
          ...process.env,
          SNAPBACK_READY_FILE: readyFile,
          ZERBUGS_GATEWAY_HOST: '127.0.0.1',
          ZERBUGS_GATEWAY_PORT: '0',
          ZERBUGS_GATEWAY_READY_FILE: gatewayReadyFile,
          ZERBUGS_CAPTURE_DIR: captureDir,
          ZERBUGS_TEST_DEFAULTS: '1',
          ZERBUGS_UNSUBSCRIBE_HMAC_SECRET: UNSUBSCRIBE_SECRET,
          ZERBUGS_UPLOAD_HMAC_SECRET: UPLOAD_SECRET,
          ZERBUGS_CAPTURE_ADAPTER_AUTH: CAPTURE_AUTH,
          ZERBUGS_LOOPS_TRANSACTIONAL_ID: LOOPS_TRANSACTIONAL_ID,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      gatewayReady = await waitForGateway(gatewayReadyFile, gatewayProcess);
      const baseUrl = text(gatewayReady.baseUrl, 'gateway baseUrl');
      const healthResponse = await fetch(`${baseUrl}/health`);
      const health = await json(healthResponse, 'gateway health');
      assert.equal(health.schemaVersion, 'zerobugs-control-gateway-health.v1');
      const composition = record(JSON.parse(await readFile(COMPOSITION_PATH, 'utf8')), 'composition');
      assert.equal((composition.routes as unknown[]).length, 9);
      assert.equal(composition.status, 'supported-local-control');
      const artifacts = record(JSON.parse(await readFile(ARTIFACTS_PATH, 'utf8')), 'generated artifacts');
      const snapback = record(health.snapback, 'health Snapback identity');
      const release = record(snapback.release, 'health release identity');
      for (const key of ['appId', 'schemaVersion', 'inputsHash', 'schemaHash', 'bundleHash']) {
        assert.equal(release[key], artifacts[key], `health binds generated ${key}`);
      }
      assert.equal(release.targetProfileId, 'local-dev-sqlite-ibex');
      assert.equal(record(health.component, 'gateway component').startupNonce, record(gatewayReady.component, 'ready component').startupNonce);
      gatewayIdentity = {component: health.component, snapback: health.snapback};
    });

    const gatewayBase = () => text(gatewayReady?.baseUrl, 'gateway baseUrl');

    await check('route-01-02-local-github-oauth-shape', async () => {
      const refused = await fetch(`${gatewayBase()}/api/login/github?redirect=${encodeURIComponent('https://attacker.invalid/')}`, {redirect: 'manual'});
      assert.equal(refused.status, 400);

      const negativeStart = await fetch(`${gatewayBase()}/api/login/github?redirect=%2Fnegative`, {redirect: 'manual'});
      assert.equal(negativeStart.status, 302);
      const negativeCookie = cookiePair(negativeStart.headers.get('set-cookie'), 'zerobugs-oauth-state');
      const negativeLocation = new URL(text(negativeStart.headers.get('location'), 'negative callback location'));
      negativeLocation.searchParams.set('code_challenge', 'wrong-pkce-challenge');
      const negativeCallback = await fetch(negativeLocation, {redirect: 'manual', headers: {cookie: negativeCookie}});
      assert.equal(negativeCallback.status, 400);
      assert.equal(negativeCallback.headers.get('set-cookie'), null);

      const start = await fetch(`${gatewayBase()}/api/login/github?redirect=%2Foauth-complete`, {redirect: 'manual'});
      assert.equal(start.status, 302);
      const stateCookie = cookiePair(start.headers.get('set-cookie'), 'zerobugs-oauth-state');
      const callback = await fetch(text(start.headers.get('location'), 'callback location'), {
        redirect: 'manual',
        headers: {cookie: stateCookie},
      });
      assert.equal(callback.status, 302);
      assert.equal(callback.headers.get('location'), '/oauth-complete');
      const sessionCookie = cookiePair(callback.headers.get('set-cookie'), 'zerobugs-session');
      const adopted = await postJson(`${gatewayBase()}/api/query`, {
        version: 'zerobugs.query.v1', name: 'allProjects', args: {limit: 10, start: null},
      }, {cookie: sessionCookie});
      assert.equal(adopted.status, 200, 'OAuth cookie carries a genuine bound Snapback session');
    });

    await check('route-05-get-queries-alias', async () => {
      const envelope = {version: 'zerobugs.query.v1', name: 'allProjects', args: {limit: 10, start: null}};
      const response = await postJson(`${gatewayBase()}/api/get-queries`, envelope);
      assert.equal(response.status, 200);
      const body = await json(response, 'get-queries response');
      assert.equal(body.version, 'zerobugs.result.v1');
      assert(Array.isArray(body.rows) && body.rows.length === 1);
      const malformed = await postJson(`${gatewayBase()}/api/get-queries`, {...envelope, auth: {role: 'crew'}});
      assert.equal(malformed.status, 400);
      const invalidArgs = await postJson(`${gatewayBase()}/api/get-queries`, {
        ...envelope,
        args: {...envelope.args, callerRole: 'crew'},
      });
      assert.equal(invalidArgs.status, 400, 'generated-ref argument widening is a client refusal');
    });

    await check('route-06-query-alias-auth-malformed-and-oversized', async () => {
      const envelope = {version: 'zerobugs.query.v1', name: 'allProjects', args: {limit: 10, start: null}};
      assert.equal((await postJson(`${gatewayBase()}/api/query`, envelope)).status, 200);
      assert.equal((await postJson(`${gatewayBase()}/api/query`, envelope, bearer('invalid-bearer'))).status, 401);
      const oversized = await fetch(`${gatewayBase()}/api/query`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({padding: 'x'.repeat(1024 * 1024)}),
      });
      assert.equal(oversized.status, 413);
    });

    await check('route-04-mutate-alias-and-trigger-identity', async () => {
      const envelope = {
        version: 'zerobugs.mutation.v1',
        name: 'issue.create',
        args: {
          id: LANE5_ISSUE_ID,
          title: 'Lane 5 versioned composition',
          description: 'Durable routes, assets, and effect delivery.',
          created: 1,
          modified: 2,
          projectID: PROJECT_ID,
        },
        clientID: CLIENT_ID,
        mutationID: 'trigger-01-issue-create',
      };
      const response = await postJson(`${gatewayBase()}/api/mutate`, envelope, bearer(actor('creator').token));
      assert.equal(response.status, 200);
      const body = await json(response, 'mutate response');
      const result = record(body.result, 'mutate result');
      assert.equal(result.intentKey, 'notification:issueCreate:lane5-client:trigger-01-issue-create');
      assert.equal((await postJson(`${gatewayBase()}/api/mutate`, envelope)).status, 401);
    });

    await check('route-03-push-alias-session-custody', async () => {
      const envelope = {
        version: 'zerobugs.mutation.v1',
        name: 'notification.update',
        args: {issueID: LANE5_ISSUE_ID, subscribed: 'subscribe', created: Date.now()},
        clientID: CLIENT_ID,
        mutationID: 'subscribe-assignee',
      };
      assert.equal((await postJson(`${gatewayBase()}/api/push`, envelope, bearer(actor('assignee').token))).status, 200);
      const malformed = await postJson(
        `${gatewayBase()}/api/push`,
        {...envelope, userID: actor('crew-admin').principal},
        bearer(actor('assignee').token),
      );
      assert.equal(malformed.status, 400);
    });

    await check('route-09-machine-markdown-public-parity', async () => {
      const issues = JSON.parse(await readFile(join(CONTROL_ROOT, 'fixtures/normal-seed-v1/issue.json'), 'utf8')) as JsonRow[];
      const comments = JSON.parse(await readFile(join(CONTROL_ROOT, 'fixtures/normal-seed-v1/comment.json'), 'utf8')) as JsonRow[];
      const projects = JSON.parse(await readFile(join(CONTROL_ROOT, 'fixtures/normal-seed-v1/project.json'), 'utf8')) as JsonRow[];
      // Compiled fixture reference fields carry `_id` placeholders, not source
      // ids: match comment.issueID against the issue row's `_id`.
      const issue = issues.find(candidate => comments.some(comment => comment.issueID === candidate._id));
      assert(issue, 'fixture has a public issue with comments');
      const project = projects.find(candidate => candidate._id === issue.projectID);
      assert(project, 'fixture issue project exists');
      const canonical = `/p/${project.lowerCaseName}/issue/${issue.shortID}.md`;
      const response = await fetch(`${gatewayBase()}${canonical}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/markdown/u);
      const markdown = await response.text();
      for (const structure of [
        'schema: zerobugs-machine-issue.v1',
        `id: ${JSON.stringify(issue.id)}`,
        `shortID: ${issue.shortID}`,
        '## Description',
        '## Labels',
        '## Reactions',
        '## Comments',
      ]) assert(markdown.includes(structure), `Markdown contains ${structure}`);
      const expectedComments = Math.min(1_000, comments.filter(comment => comment.issueID === issue._id).length);
      assert(markdown.includes(`commentCount: ${expectedComments}`));
      const sourceRedirect = await fetch(`${gatewayBase()}/p/${project.lowerCaseName}/issue/${issue.id}.md`, {redirect: 'manual'});
      assert.equal(sourceRedirect.status, 308);
      assert.equal(sourceRedirect.headers.get('location'), canonical);
      assert.equal((await fetch(`${gatewayBase()}/p/${project.lowerCaseName}/issue/0.md`)).status, 404);
      const invalid = await fetch(`${gatewayBase()}${canonical}`, {headers: bearer('invalid-bearer')});
      assert.equal(invalid.status, 401);
      assert.equal(invalid.headers.get('cache-control'), 'private, no-store');
    });

    await check('route-09-machine-markdown-internal-crew-gate', async () => {
      const anonymous = await fetch(`${gatewayBase()}/p/zero/issue/9183001.md`);
      assert.equal(anonymous.status, 404);
      assert.match(await anonymous.text(), /^# 404\n/u);
      const ordinary = await fetch(`${gatewayBase()}/p/zero/issue/9183001.md`, {headers: bearer(actor('ordinary-user').token)});
      assert.equal(ordinary.status, 404);
      const crew = await fetch(`${gatewayBase()}/p/zero/issue/9183001.md`, {headers: bearer(actor('crew-admin').token)});
      assert.equal(crew.status, 200);
      assert.equal(crew.headers.get('cache-control'), 'private, no-store');
      assert((await crew.text()).includes('policy-extension-v1 internal issue'));
    });

    await check('effect-eight-trigger-classes-exact-capture-and-internal-recipients', async () => {
      assert(initialAudit, 'initial audit exists');
      const labels = JSON.parse(await readFile(join(CONTROL_ROOT, 'fixtures/normal-seed-v1/label.json'), 'utf8')) as JsonRow[];
      // Compiled projectID references carry the project `_id` placeholder.
      const projectsForLabels = JSON.parse(await readFile(join(CONTROL_ROOT, 'fixtures/normal-seed-v1/project.json'), 'utf8')) as JsonRow[];
      const labelProject = projectsForLabels.find(candidate => candidate.id === PROJECT_ID);
      assert(labelProject, 'fixture project exists for label selection');
      const label = labels.find(candidate => candidate.projectID === labelProject._id);
      assert(label, 'fixture label exists');
      await mutateEffect(actor('creator').client, api.issueUpdate, {
        id: LANE5_ISSUE_ID, title: 'Lane 5 updated issue', modified: 3,
      }, 'trigger-02-issue-update');
      await mutateEffect(actor('creator').client, api.issueAddLabel, {
        issueID: LANE5_ISSUE_ID, labelID: label.id, projectID: PROJECT_ID,
      }, 'trigger-03-issue-add-label');
      await mutateEffect(actor('creator').client, api.issueRemoveLabel, {
        issueID: LANE5_ISSUE_ID, labelID: label.id,
      }, 'trigger-04-issue-remove-label');
      await mutateEffect(actor('ordinary-user').client, api.emojiAddToIssue, {
        id: LANE5_ISSUE_EMOJI_ID, unicode: '👍', annotation: 'thumbs up',
        subjectID: LANE5_ISSUE_ID, created: 4,
      }, 'trigger-05-emoji-issue');
      await mutateEffect(actor('creator').client, api.commentAdd, {
        id: LANE5_COMMENT_ID, issueID: LANE5_ISSUE_ID,
        body: 'Lane 5 deterministic comment.', created: 5,
      }, 'trigger-06-comment-add');
      await mutateEffect(actor('assignee').client, api.emojiAddToComment, {
        id: LANE5_COMMENT_EMOJI_ID, unicode: '🚀', annotation: 'rocket',
        subjectID: LANE5_COMMENT_ID, created: 6,
      }, 'trigger-07-emoji-comment');
      await mutateEffect(actor('creator').client, api.commentEdit, {
        id: LANE5_COMMENT_ID, body: 'Lane 5 deterministic comment, edited.',
      }, 'trigger-08-comment-edit');
      await mutateEffect(actor('crew-admin').client, api.issueUpdate, {
        id: INTERNAL_ISSUE_ID, title: 'policy-extension-v1 internal issue — delivered', modified: 7,
      }, 'internal-recipient-proof');

      const beforeIntents = intentRows(initialAudit);
      const afterMutation = await audit();
      const intents = addedRows(beforeIntents, intentRows(afterMutation));
      assert.equal(intents.length, 9);
      assert.equal(new Set(intents.map(intent => intent.trigger)).size, 8, 'all eight trigger classes are present');
      const internal = intents.find(intent => intent.issueID === INTERNAL_ISSUE_ID);
      assert(internal, 'internal update intent exists');
      const recipients = record(JSON.parse(text(internal.recipientSnapshot, 'internal recipient snapshot')), 'internal recipients');
      assert.deepEqual(
        (recipients.recipients as JsonRow[]).map(row => row.sourceUserID),
        [bound?.receipt.actors['removed-member'].sourceUserID],
        'internal delivery releases only subscribed crew recipients',
      );
      assert.equal(internal.discordEligible, false);

      const report = await deliverTick({
        readyFile,
        gatewayReadyFile: join(tempRoot as string, 'gateway.ready.json'),
        fault: 'none',
        maxIntents: 128,
      });
      assert.equal(report.ambiguous, 0);
      assert.equal(report.retryable, 0);
      const captures = allCaptures(await captureReceipt(gatewayBase()));
      assertCaptured(intents, captures, gatewayBase());
      const settled = await audit();
      for (const intent of intents) {
        const row = intentRows(settled).find(candidate => candidate.physicalID === intent.physicalID);
        assert.equal(row?.state, 'delivered');
      }
    });

    await check('effect-fault-before-send-retries-from-durable-intent-once', async () => {
      const beforeAudit = await audit();
      const beforeCaptures = allCaptures(await captureReceipt(gatewayBase()));
      await mutateEffect(actor('creator').client, api.issueUpdate, {
        id: LANE5_ISSUE_ID, description: 'Fault-before-send durable retry.', modified: 8,
      }, 'fault-before-send');
      const pendingAudit = await audit();
      const [intent] = addedRows(intentRows(beforeAudit), intentRows(pendingAudit));
      assert(intent, 'fault-before intent is durable before the worker runs');
      const first = await deliverTick({
        readyFile,
        gatewayReadyFile: join(tempRoot as string, 'gateway.ready.json'),
        fault: 'fail-before-send',
        maxIntents: 16,
      });
      assert.equal(first.retryable, 1);
      const afterFirst = await audit();
      assert.equal(intentRows(afterFirst).find(row => row.physicalID === intent.physicalID)?.state, 'pending');
      assert(attemptRows(afterFirst).some(row => row.intentID === intent.physicalID && row.state === 'retryable'));
      await deliverTick({
        readyFile,
        gatewayReadyFile: join(tempRoot as string, 'gateway.ready.json'),
        fault: 'none',
        maxIntents: 16,
      });
      const captured = addedCaptures(beforeCaptures, allCaptures(await captureReceipt(gatewayBase())));
      assertCaptured([intent], captured, gatewayBase());
      assert.equal(intentRows(await audit()).find(row => row.physicalID === intent.physicalID)?.state, 'delivered');
    });

    await check('effect-fault-after-send-is-explicitly-ambiguous-and-fenced', async () => {
      const beforeAudit = await audit();
      const beforeCaptures = allCaptures(await captureReceipt(gatewayBase()));
      await mutateEffect(actor('creator').client, api.issueUpdate, {
        id: LANE5_ISSUE_ID, description: 'Fault-after-send ambiguity fence.', modified: 9,
      }, 'fault-after-send');
      const [intent] = addedRows(intentRows(beforeAudit), intentRows(await audit()));
      assert(intent, 'fault-after intent is durable');
      const first = await deliverTick({
        readyFile,
        gatewayReadyFile: join(tempRoot as string, 'gateway.ready.json'),
        fault: 'fail-after-send-before-receipt',
        maxIntents: 16,
      });
      assert.equal(first.ambiguous, 1);
      const afterFirst = await audit();
      assert.equal(intentRows(afterFirst).find(row => row.physicalID === intent.physicalID)?.state, 'ambiguous');
      assert(attemptRows(afterFirst).some(row => (
        row.intentID === intent.physicalID && row.state === 'ambiguous' && row.ambiguous === true
      )));
      const capturedOnce = addedCaptures(beforeCaptures, allCaptures(await captureReceipt(gatewayBase())));
      assertCaptured([intent], capturedOnce, gatewayBase());
      await deliverTick({
        readyFile,
        gatewayReadyFile: join(tempRoot as string, 'gateway.ready.json'),
        fault: 'none',
        maxIntents: 16,
      });
      const afterReplay = addedCaptures(beforeCaptures, allCaptures(await captureReceipt(gatewayBase())));
      assert.deepEqual(afterReplay, capturedOnce, 'ambiguous target is fenced from replay');
    });

    await check('route-08-safe-unsubscribe-get-post-expiry-forgery-replay', async () => {
      const sourceUserID = text(
        bound?.receipt.actors.assignee.sourceUserID,
        'assignee source user id',
      );
      const token = signUnsubscribeToken({
        user: sourceUserID,
        issue: LANE5_ISSUE_ID,
        exp: Math.floor(Date.now() / 1_000) + 600,
      }, UNSUBSCRIBE_SECRET);
      const before = await audit();
      const confirmation = await fetch(`${gatewayBase()}/api/unsubscribe?token=${encodeURIComponent(token)}`);
      assert.equal(confirmation.status, 200);
      assert((await confirmation.text()).includes('Confirm unsubscribe'));
      assert.deepEqual(await audit(), before, 'GET confirmation is read-only');
      const applied = await postJson(`${gatewayBase()}/api/unsubscribe`, {token});
      assert.equal(applied.status, 200);
      const after = await audit();
      const subscriptions = after.issueNotifications as JsonRow[];
      assert(subscriptions.some(row => (
        row.userID === sourceUserID && row.issueID === LANE5_ISSUE_ID && row.subscribed === false
      )));
      const expired = signUnsubscribeToken({
        user: sourceUserID,
        issue: LANE5_ISSUE_ID,
        exp: Math.floor(Date.now() / 1_000) - 1,
      }, UNSUBSCRIBE_SECRET);
      const forged = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
      const refusals = await Promise.all([token, expired, forged].map(candidate => (
        postJson(`${gatewayBase()}/api/unsubscribe`, {token: candidate})
      )));
      const refusalBodies = await Promise.all(refusals.map(response => response.text()));
      assert(refusals.every(response => response.status === 400));
      assert.equal(new Set(refusalBodies).size, 1, 'replay, expiry, and forgery share one refusal shape');
      const bare = await fetch(`${gatewayBase()}/api/unsubscribe?email=someone%40example.invalid&id=1`);
      assert.equal(bare.status, 400);
      const bareMutation = await postJson(`${gatewayBase()}/api/unsubscribe`, {
        email: 'someone@example.invalid', shortID: 1,
      });
      assert.equal(bareMutation.status, 400);
      assert.deepEqual(await audit(), after, 'refused capabilities and bare email/shortID perform no write');
    });

    await check('route-07-upload-five-types-server-policy-delivery-and-cleanup', async () => {
      const unauthenticated = await postJson(`${gatewayBase()}/api/upload/presigned-url`, {contentType: 'image/png', size: 1});
      assert.equal(unauthenticated.status, 401);
      const oversized = await postJson(
        `${gatewayBase()}/api/upload/presigned-url`,
        {contentType: 'image/png', size: 10 * 1024 * 1024 + 1},
        bearer(actor('creator').token),
      );
      assert.equal(oversized.status, 413);
      const unknown = await postJson(
        `${gatewayBase()}/api/upload/presigned-url`,
        {contentType: 'text/html', size: 10},
        bearer(actor('creator').token),
      );
      assert.equal(unknown.status, 400);

      const keys: string[] = [];
      for (const [contentType, bytes] of IMAGE_BYTES) {
        const presign = await postJson(
          `${gatewayBase()}/api/upload/presigned-url`,
          {contentType, size: bytes.byteLength},
          bearer(actor('creator').token),
        );
        assert.equal(presign.status, 200, `${contentType} presign succeeds`);
        const intent = await json(presign, `${contentType} presign`);
        keys.push(text(intent.key, `${contentType} key`));
        const preflight = await fetch(text(intent.url, `${contentType} upload URL`), {
          method: 'OPTIONS',
          headers: {origin: 'http://example.invalid', 'access-control-request-method': 'PUT'},
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
        const upload = await fetch(text(intent.url, `${contentType} upload URL`), {
          method: 'PUT',
          headers: {'content-type': contentType},
          body: bytes,
        });
        assert.equal(upload.status, 200, `${contentType} upload finalizes`);
        const delivered = await fetch(text(intent.deliveryUrl, `${contentType} delivery URL`));
        assert.equal(delivered.status, 200, `${contentType} delivery is public`);
        assert.equal(delivered.headers.get('content-type'), contentType);
        assert.equal(delivered.headers.get('access-control-allow-origin'), '*');
        assert((await delivered.arrayBuffer()).byteLength > 0);
      }

      const mismatchBytes = IMAGE_BYTES.get('image/png') as Uint8Array;
      const mismatchPresign = await postJson(
        `${gatewayBase()}/api/upload/presigned-url`,
        {contentType: 'image/png', size: mismatchBytes.byteLength},
        bearer(actor('creator').token),
      );
      const mismatch = await json(mismatchPresign, 'mismatch presign');
      const mismatchUpload = await fetch(text(mismatch.url, 'mismatch upload URL'), {
        method: 'PUT',
        headers: {'content-type': 'image/gif'},
        body: mismatchBytes,
      });
      assert.equal(mismatchUpload.status, 415);
      const badMagic = new Uint8Array(mismatchBytes.byteLength);
      badMagic.set(new TextEncoder().encode('GIF89a'));
      const badMagicPresignResponse = await postJson(
        `${gatewayBase()}/api/upload/presigned-url`,
        {contentType: 'image/png', size: badMagic.byteLength},
        bearer(actor('creator').token),
      );
      const badMagicPresign = await json(badMagicPresignResponse, 'bad-magic presign');
      const badMagicUpload = await fetch(text(badMagicPresign.url, 'bad-magic upload URL'), {
        method: 'PUT',
        headers: {'content-type': 'image/png'},
        body: badMagic,
      });
      assert.equal(badMagicUpload.status, 415, 'declared MIME with mismatched bytes is refused');
      const cleanup = await actor('crew-admin').client.query(api.acceptanceAssetCleanupInventory as never, {args: {}});
      assert.deepEqual(
        new Set((cleanup.rows as JsonRow[]).map(row => row.key)),
        new Set(keys),
        'typed attachment aliases enumerate the exact owned cleanup set',
      );
    });

    await check('all-eight-nontriggers-produce-no-delivery', async () => {
      const beforeAudit = await audit();
      const beforeCaptures = allCaptures(await captureReceipt(gatewayBase()));
      await actor('crew-admin').client.mutate(api.emojiRemove as never, {
        args: {id: LANE5_ISSUE_EMOJI_ID}, clientMutationId: 'lane5-nontrigger-emoji-remove', queue: false,
      });
      await actor('creator').client.mutate(api.commentRemove as never, {
        args: {id: LANE5_COMMENT_ID}, clientMutationId: 'lane5-nontrigger-comment-remove', queue: false,
      });
      await actor('crew-admin').client.mutate(api.labelCreate as never, {
        args: {id: 'zb_lane5_label_v1', name: 'lane-5-label', projectID: PROJECT_ID},
        clientMutationId: 'lane5-nontrigger-label-create', queue: false,
      });
      await actor('crew-admin').client.mutate(api.labelCreateAndAddToIssue as never, {
        args: {
          issueID: LANE5_ISSUE_ID,
          labelID: 'zb_lane5_joined_label_v1',
          labelName: 'lane-5-joined-label',
          projectID: PROJECT_ID,
        },
        clientMutationId: 'lane5-nontrigger-label-create-add', queue: false,
      });
      await actor('creator').client.mutate(api.viewStateSet as never, {
        args: {issueID: LANE5_ISSUE_ID, viewed: Date.now()},
        clientMutationId: 'lane5-nontrigger-view-state', queue: false,
      });
      await actor('creator').client.mutate(api.userPrefSet as never, {
        args: {key: 'zerobugs-lane5.v1', value: '{"lane5":true}'},
        clientMutationId: 'lane5-nontrigger-user-pref', queue: false,
      });
      await actor('crew-admin').client.mutate(api.issueDelete as never, {
        args: {id: LANE5_ISSUE_ID}, clientMutationId: 'lane5-nontrigger-issue-delete', queue: false,
      });
      const afterAudit = await audit();
      assert.equal(intentRows(afterAudit).length, intentRows(beforeAudit).length, 'seven final nontriggers add no intent');
      // notification.update was the eighth non-trigger and was already exercised
      // through /api/push before the first delivery tick; its no-intent result is
      // included in the same before/after intent accounting above.
      const report = await deliverTick({
        readyFile,
        gatewayReadyFile: join(tempRoot as string, 'gateway.ready.json'),
        fault: 'none',
        maxIntents: 16,
      });
      assert.equal(report.leasedIntents, 0);
      assert.deepEqual(allCaptures(await captureReceipt(gatewayBase())), beforeCaptures);
    });
  } catch (error) {
    checks.push({id: 'harness-unexpected-failure', status: 'fail', error: errorText(error)});
  } finally {
    await check('gateway-shutdown-port-process-and-file-cleanup', async () => {
      assert(gatewayProcess && gatewayReady && tempRoot, 'gateway process and owned paths exist');
      const baseUrl = text(gatewayReady.baseUrl, 'gateway cleanup baseUrl');
      gatewayProcess.kill('SIGTERM');
      assert.equal(await withTimeout(gatewayProcess.exited, 10_000, 'gateway exit'), 0);
      await assert.rejects(access(join(tempRoot, 'gateway.ready.json')));
      await assert.rejects(fetch(`${baseUrl}/health`, {signal: AbortSignal.timeout(1_000)}));
      await rm(tempRoot, {recursive: true, force: true});
      await assert.rejects(access(tempRoot));
    });
    const closed = await Promise.allSettled(bound ? [bound.close()] : []);
    const closeFailure = closed.find(result => result.status === 'rejected');
    if (closeFailure?.status === 'rejected') {
      checks.push({id: 'client-close', status: 'fail', error: errorText(closeFailure.reason)});
    }
  }

  const status = checks.length === EXPECTED_CHECKS && checks.every(check => check.status === 'pass')
    ? 'ok'
    : 'failed';
  const output = {
    schemaVersion: 'zerobugs-lane5-live.v1',
    status,
    expectedChecks: EXPECTED_CHECKS,
    executedChecks: checks.length,
    gatewayIdentity,
    checks,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (status !== 'ok') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 1;
});
