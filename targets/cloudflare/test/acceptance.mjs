// LLP 0040 acceptance suite (Miniflare regression surface). It drives the
// proof end to end and asserts the RFC's accepted-proof checklist that is
// checkable without real Cloudflare:
//
//   - query, mutate, subscribe, disconnect, resubscribe from a client;
//   - a cold-start subscription delivers the authoritative snapshot BEFORE any
//     delta (ordering asserted, not assumed);
//   - a JS handler executes in V8 and cannot reach fetch/env/bindings nor a
//     Durable Object storage handle (two-direction ambient denial);
//   - a mutation reaches a live subscriber without polling storage on a timer;
//   - after in-memory state is discarded (the CI surrogate for eviction) a
//     committed mutation still reaches the still-connected subscriber
//     (subscription rehydration from persisted rows);
//   - commit versions are gap-free within the app stream;
//   - reset/seed works;
//   - the capability manifest is served and validates against its JSON Schema.
//
// The decisive idle-economics, real-eviction, and billing evidence is
// deferred to real Cloudflare (LLP 0040 §Measurements evidence split) and is
// NOT claimed here.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { startProof } from './harness.mjs';
import { classifyHandlerPlatformFailure, classifyPlatformError } from '../src/platform-errors.js';
import { SUBSCRIPTION_LIMITS } from '../src/limits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const EXPECTED_CHECKS = 53;

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail: condition ? undefined : detail });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${condition ? '' : ` — ${detail ?? ''}`}`);
}

async function main() {
  const client = await startProof();
  try {
    // -- capability manifest served + schema-valid --------------------------
    const manifest = await client.inspect();
    check('capability manifest served with the proof profile id',
      manifest.targetProfileId === 'cloudflare-do-sqlite-v8' &&
        manifest.offlineRetention === false && manifest.optimisticReplay === false &&
        manifest.supportedArtifactVersions?.join(',') === 'snapback.v0' &&
        manifest.supportedAuthModes?.join(',') === 'dev' &&
        manifest.supportedArtifactAuthPairs?.length === 1 &&
        manifest.supportedArtifactAuthPairs[0]?.schemaVersion === 'snapback.v0' &&
        manifest.supportedArtifactAuthPairs[0]?.authMode === 'dev' &&
        manifest.supportedCapabilities?.join(',') === 'live_subscriptions' &&
        !Object.hasOwn(manifest, 'authProtocols') &&
        manifest.hostedAuth?.externalTls === 'unavailable' &&
        manifest.hostedAuth?.effectiveSource === 'unavailable' &&
        manifest.hostedAuth?.authenticationThrottle === 'unavailable' &&
        manifest.hostedAuth?.sessionInvalidation === 'unavailable' &&
        manifest.hostedAuth?.clientCredentialPosture === 'unavailable',
      JSON.stringify({
        targetProfileId: manifest.targetProfileId,
        offlineRetention: manifest.offlineRetention,
        optimisticReplay: manifest.optimisticReplay,
        supportedArtifactVersions: manifest.supportedArtifactVersions,
        supportedAuthModes: manifest.supportedAuthModes,
        supportedArtifactAuthPairs: manifest.supportedArtifactAuthPairs,
        supportedCapabilities: manifest.supportedCapabilities,
        authProtocols: manifest.authProtocols,
        hostedAuth: manifest.hostedAuth,
      }));
    check('manifest names code_hot_load as a missing capability',
      Array.isArray(manifest.capabilityGaps) && manifest.capabilityGaps.includes('code_hot_load'),
      JSON.stringify(manifest.capabilityGaps));
    check('manifest does not claim deployed auth impersonation',
      manifest.authImpersonation === false,
      JSON.stringify({ authImpersonation: manifest.authImpersonation }));
    check('manifest reports the coordinator-serialized mutation isolation actually deployed',
      manifest.mutationIsolationMode === 'coordinator-serialized-invocations',
      JSON.stringify({ mutationIsolationMode: manifest.mutationIsolationMode }));
    check('manifest lists the auth/isolation gaps behind the Cloudflare proof target',
      manifest.capabilityGaps.includes('external_auth') &&
        manifest.capabilityGaps.includes('auth_impersonation') &&
        manifest.capabilityGaps.includes('handler_captured_read_set_validation'),
      JSON.stringify(manifest.capabilityGaps));
    const subscriptionLimit = manifest.resourceLimits.find((entry) => entry.name === 'maximum_subscription_count');
    check('manifest advertises the exact subscription ceilings enforced by the coordinator',
      subscriptionLimit?.status === 'Enforced' &&
        manifest.runtimeFacts?.maxSubscriptionsGlobal === SUBSCRIPTION_LIMITS.globalCount &&
        manifest.runtimeFacts?.maxSubscriptionsPerConnection === SUBSCRIPTION_LIMITS.perConnectionCount &&
        manifest.runtimeFacts?.maxSubscriptionArgsBytes === SUBSCRIPTION_LIMITS.canonicalArgsBytes &&
        manifest.runtimeFacts?.maxLegacyProofSockets === SUBSCRIPTION_LIMITS.legacyProofSockets &&
        manifest.runtimeFacts?.maxAcceptedSockets === SUBSCRIPTION_LIMITS.acceptedSockets &&
        manifest.runtimeFacts?.maxSocketsPerConnection === SUBSCRIPTION_LIMITS.socketsPerConnection,
      JSON.stringify({ subscriptionLimit, runtimeFacts: manifest.runtimeFacts, expected: SUBSCRIPTION_LIMITS }));

    const schema = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'schemas/capability.manifest.schema.json'), 'utf8')
    );
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const valid = validate(manifest);
    check('capability manifest validates against its generated JSON Schema',
      valid, JSON.stringify(validate.errors));

    // Every module selectable through the snapback-app alias must satisfy the
    // coordinator's uniform named-export contract. This second bundle is a
    // fast, load-bearing guard for the conformance fixture specifically: a
    // missing deploymentIdentity fails here at esbuild time before the much
    // longer three-engine twin regeneration reaches CI.
    const twin = await startProof({ app: 'twin' });
    try {
      const twinHealth = await twin.health();
      check('conformance twin app bundle supplies the coordinator deployment identity',
        twinHealth.ok === true &&
          twinHealth.schemaHash === 'conformance-twin-v0' &&
          twinHealth.bundleHash === 'conformance-twin-bundle-v1',
        JSON.stringify(twinHealth));
    } finally {
      await twin.dispose();
    }

    // -- reset/seed ---------------------------------------------------------
    await client.reset();
    const staleSocket = await client.openLiveSocket();
    const corrupt = await client.corruptMeta({ schemaHash: 'stale-notes-app-v0' });
    check('a stale stored schema hash is detected instead of overwritten on startup',
      corrupt.status === 200 && corrupt.body.startupError?.code === 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH',
      JSON.stringify(corrupt));
    const staleQuery = await client.query('listNotes', { boardId: 'b1' });
    staleSocket.send({ type: 'ping' });
    const staleSocketClose = await staleSocket.waitForClose();
    check('HTTP and retained-socket data-plane requests fail closed while the stored schema hash is stale',
      staleQuery.ok === false &&
        staleQuery.code === 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH' &&
        staleSocketClose.code === 1013,
      JSON.stringify({ staleQuery, staleSocketClose }));
    const staleHealth = await client.health();
    check('health exposes the stale deployment diagnostic for operator recovery',
      staleHealth.ok === false && staleHealth.code === 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH',
      JSON.stringify(staleHealth));
    await client.reset();
    const empty = await client.query('listNotes', { boardId: 'b1' });
    check('reset leaves an empty board', empty.ok && empty.rows.length === 0, JSON.stringify(empty));

    // -- mutation executes a JS handler in V8, commits a version ------------
    const first = await client.mutation('addNote', { boardId: 'b1', text: 'hello from V8', authorId: 'u1' });
    check('mutation runs the V8 handler and commits', first.ok && first.version >= 1 && first.changedCount === 1,
      JSON.stringify(first));

    const listed = await client.query('listNotes', { boardId: 'b1' });
    check('query returns the committed row', listed.ok && listed.rows.length === 1 && listed.rows[0].text === 'hello from V8',
      JSON.stringify(listed));

    // -- gap-free versions --------------------------------------------------
    const v1 = first.version;
    const second = await client.mutation('addNote', { boardId: 'b1', text: 'second' });
    check('commit versions are gap-free within the app stream', second.version === v1 + 1,
      `v1=${v1} v2=${second.version}`);

    // -- admin surface fails closed (ENG-23587) ------------------------------
    const bareReset = await client.adminWithoutToken('/_snapback/api/app/reset');
    check('an unauthenticated /_snapback/api/app/reset is refused', bareReset.status === 403 && bareReset.body.ok === false,
      JSON.stringify(bareReset));
    const bareEvict = await client.adminWithoutToken('/_snapback/api/object/evict');
    check('an unauthenticated /_snapback/api/object/evict is refused', bareEvict.status === 403 && bareEvict.body.ok === false,
      JSON.stringify(bareEvict));
    const getReset = await client.adminWithoutToken('/_snapback/api/app/reset', 'GET');
    check('a GET /_snapback/api/app/reset is refused (POST-only)', getReset.status === 405, JSON.stringify(getReset));
    const survived = await client.query('listNotes', { boardId: 'b1' });
    check('data survives the refused admin calls', survived.ok && survived.rows.length === 2,
      JSON.stringify({ count: survived.rows?.length }));

    // -- health reports service bindings for the deploy probe (ENG-23732) ----
    const bindingHealth = await client.health();
    check('health reports the HANDLER binding for the deploy probe',
      bindingHealth.bindings?.handler === true,
      JSON.stringify(bindingHealth.bindings));

    // -- no-op commits keep the version (ENG-23583) --------------------------
    const versionBefore = (await client.health()).version;
    const missingPatch = await client.mutation('touchNote', { id: 'never-existed' });
    check('a patch on a missing row commits as a no-op', missingPatch.ok && missingPatch.changedCount === 0,
      JSON.stringify(missingPatch));
    check('a no-op mutation does not advance the version', missingPatch.version === versionBefore,
      `before=${versionBefore} after=${missingPatch.version}`);
    const existingId = listed.rows[0]._id;
    const emptyPatch = await client.mutation('touchNote', { id: existingId, values: {} });
    check('an empty-values patch on an existing row is also a no-op',
      emptyPatch.ok && emptyPatch.changedCount === 0 && emptyPatch.version === versionBefore,
      JSON.stringify(emptyPatch));

    // -- off-schema tables are refused, not spliced into SQL (ENG-23578) -----
    const badTable = await client.mutation('probeBadTable', {});
    const badMessage = badTable.ok && badTable.result ? String(badTable.result.message || '') : JSON.stringify(badTable);
    check('an off-schema table name is refused with the stable host-call code',
      badTable.ok && badTable.result && badTable.result.inserted === false &&
        badMessage.indexOf('SNAPBACK_UNKNOWN_TABLE') === 0,
      badMessage);

    // -- error-code taxonomy matches the Rust hosts (ENG-23586) --------------
    const invented = await client.mutation('addNote', { boardId: 'b1' });
    check('a handler-invented failure folds to SNAPBACK_HANDLER_FAILED',
      invented.ok === false && invented.code === 'SNAPBACK_HANDLER_FAILED' &&
        !Object.hasOwn(invented, 'failureCarrier'),
      JSON.stringify(invented));
    const inventedKit = await client.kitMutation('addNote', { boardId: 'b1' });
    check('ordinary kit handler failures do not expose the private failure carrier',
      inventedKit.status === 500 &&
        inventedKit.body.diagnostic?.code === 'SNAPBACK_HANDLER_FAILED' &&
        !Object.hasOwn(inventedKit.body, 'failureCarrier') &&
        !Object.hasOwn(inventedKit.body.diagnostic, 'failureCarrier'),
      JSON.stringify(inventedKit));

    // -- detached rejection after a host call fails closed (ENG-23584) -------
    const preDetached = await client.query('listNotes', { boardId: 'b1' });
    const detached = await client.mutation('addNoteDetachedFailure', { boardId: 'b1' });
    check('a detached rejection parked on a host call fails the mutation',
      detached.ok === false && detached.code === 'SNAPBACK_HANDLER_UNHANDLED_REJECTION',
      JSON.stringify(detached));
    const postDetached = await client.query('listNotes', { boardId: 'b1' });
    check('the failed mutation committed none of its detached writes',
      postDetached.rows.length === preDetached.rows.length,
      JSON.stringify({ before: preDetached.rows.length, after: postDetached.rows.length }));

    // -- concurrency: interleaved invocations stay attributable --------------
    // One guilty mutation and one clean query in flight together: only the
    // guilty one may fail (ENG-23585), and concurrent clean mutations must
    // both commit, serialized to distinct versions (ENG-23574/ENG-23575).
    const [guilty, clean] = await Promise.all([
      client.mutation('addNoteDetachedFailure', { boardId: 'b1' }),
      client.query('listNotes', { boardId: 'b1' }),
    ]);
    check('a concurrent clean query does not inherit the guilty invocation rejection',
      clean.ok === true && guilty.ok === false && guilty.code === 'SNAPBACK_HANDLER_UNHANDLED_REJECTION',
      JSON.stringify({ guilty, cleanOk: clean.ok }));
    const [m1, m2] = await Promise.all([
      client.mutation('addNote', { boardId: 'b1', text: 'race-1' }),
      client.mutation('addNote', { boardId: 'b1', text: 'race-2' }),
    ]);
    check('concurrent mutations serialize to distinct, adjacent versions',
      m1.ok && m2.ok && Math.abs(m1.version - m2.version) === 1,
      JSON.stringify({ v1: m1.version, v2: m2.version }));

    const burst = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        client.mutation('addNote', { boardId: 'b1', text: `bounded-burst-${index}` })
      )
    );
    const burstCommits = burst.filter((result) => result.ok);
    const burstOverloads = burst.filter((result) => result.code === 'SNAPBACK_OVERLOADED');
    const burstVersions = burstCommits.map((result) => result.version).sort((left, right) => left - right);
    check('a 32-way burst commits gap-free or returns only structured retryable admission overloads',
      burstOverloads.length > 0 && burstCommits.length + burstOverloads.length === burst.length &&
        burstVersions.every((version, index) => index === 0 || version === burstVersions[index - 1] + 1) &&
        burstOverloads.every((result) => result.details?.retryable === true && result.details?.backoff === true &&
          result.details?.maxPendingInvocations < result.details?.serviceBindingInvocationLimit),
      JSON.stringify({ committed: burstCommits.length, overloaded: burstOverloads.length, burstVersions }));

    // -- platform limits are stable input/pressure results (ENG-23849) ------
    const versionBeforeOversize = (await client.health()).version;
    const oversizedAuthorId = 'x'.repeat(2_500_000);
    const oversized = await client.mutation('addNote', {
      boardId: 'b1',
      text: 'must not commit',
      authorId: oversizedAuthorId,
    });
    check('an oversized proof-protocol write returns SNAPBACK_VALUE_TOO_LARGE JSON',
      oversized.ok === false && oversized.code === 'SNAPBACK_VALUE_TOO_LARGE' &&
        oversized.details?.retryable === false &&
        oversized.details?.limitBytes === manifest.runtimeFacts.maxRowBytes &&
        oversized.details?.actualBytes > oversized.details?.limitBytes,
      JSON.stringify(oversized));
    const versionAfterOversize = (await client.health()).version;
    check('an oversized write rolls back without advancing the commit version',
      versionAfterOversize === versionBeforeOversize,
      JSON.stringify({ before: versionBeforeOversize, after: versionAfterOversize }));
    const oversizedKit = await client.kitMutation('addNote', {
      boardId: 'b1',
      text: 'must not commit either',
      authorId: oversizedAuthorId,
    });
    check('the kit protocol receives the same structured size diagnostic with HTTP 413',
      oversizedKit.status === 413 && oversizedKit.body.diagnostic?.code === 'SNAPBACK_VALUE_TOO_LARGE' &&
        oversizedKit.body.diagnostic?.details?.limitBytes === manifest.runtimeFacts.maxRowBytes,
      JSON.stringify(oversizedKit));
    const afterOversize = await client.mutation('addNote', { boardId: 'b1', text: 'coordinator remains healthy' });
    check('a valid mutation succeeds immediately after an oversized write is rejected',
      afterOversize.ok === true && afterOversize.version === versionBeforeOversize + 1,
      JSON.stringify(afterOversize));

    const depthCarrier = { errorClass: 'DepthSentinel' };
    const valueLimitCarrier = { errorClass: 'ValueLimitSentinel' };
    const classifiedDepth = classifyHandlerPlatformFailure({
      ok: false,
      code: 'SNAPBACK_HANDLER_FAILED',
      message: 'Subrequest depth limit exceeded. This request recursed through Workers too many times.',
      failureCarrier: depthCarrier,
    });
    const unrelatedHandlerFailure = classifyHandlerPlatformFailure({
      ok: false,
      code: 'SNAPBACK_HANDLER_FAILED',
      message: 'ordinary app exception',
    });
    const directDepth = classifyPlatformError(
      new Error('Subrequest depth limit exceeded. This request recursed through Workers too many times.')
    );
    const handlerValueLimit = classifyHandlerPlatformFailure(
      {
        ok: false,
        code: 'SNAPBACK_VALUE_TOO_LARGE',
        message: 'host call exceeded the row limit',
        failureCarrier: valueLimitCarrier,
      },
      { maxRowBytes: manifest.runtimeFacts.maxRowBytes }
    );
    check('service-binding depth failures classify as retryable overload without folding unrelated handler failures',
      classifiedDepth.code === 'SNAPBACK_OVERLOADED' && classifiedDepth.details?.retryable === true &&
        classifiedDepth.details?.backoff === true && directDepth.code === 'SNAPBACK_OVERLOADED' &&
        directDepth.details?.reason === 'service_binding_subrequest_depth' &&
        classifiedDepth.failureCarrier === depthCarrier &&
        handlerValueLimit.code === 'SNAPBACK_VALUE_TOO_LARGE' &&
        handlerValueLimit.details?.limitBytes === manifest.runtimeFacts.maxRowBytes &&
        handlerValueLimit.failureCarrier === valueLimitCarrier &&
        unrelatedHandlerFailure.code === 'SNAPBACK_HANDLER_FAILED',
      JSON.stringify({ classifiedDepth, directDepth, handlerValueLimit, unrelatedHandlerFailure }));

    // -- ambient-power denial (two directions) ------------------------------
    // The handler bundle has no denial handler itself; we prove denial by
    // deploying a probe via a second board mutation whose handler tries fetch.
    // Instead, drive the denial through the dedicated probe app is out of
    // scope here; the harness twin covers the exhaustive matrix. We assert the
    // manifest posture and one live proof below (a mutation cannot reach fetch
    // because the isolate is stripped — a fetch attempt would surface as a
    // handler failure). Covered exhaustively in crates/snapback/tests/workerd_twin_v0.rs.
    check('manifest declares hosted_untrusted_code still a gap (denial by discipline, not platform)',
      manifest.capabilityGaps.includes('hosted_untrusted_code'), JSON.stringify(manifest.capabilityGaps));

    // The two-direction ambient-power denial, run against the DEPLOYED handler
    // isolate (LLP 0040 §Acceptance): ambient globals and host-object
    // reach-through are all unreachable — the handler's only power is ctx.
    const probe = await client.query('probeAmbient', {});
    const reachable = probe.ok ? probe.rows.filter((row) => row.reachable).map((row) => row.name) : ['<query failed>'];
    check('the deployed V8 handler cannot reach fetch/env/bindings nor host storage handles',
      probe.ok && reachable.length === 0, `reachable: ${JSON.stringify(reachable)}`);

    // -- null/missing optional-field filters: pushdown and overlay agree -----
    // ENG-23606: `eq('authorId', null)` (and range filters over a null field)
    // must return the SAME rows whether the invocation reads through the SQL
    // pushdown (no buffered writes) or the buffered-overlay matchFilter path.
    // Canonical semantics are SQL three-valued logic, matching the Rust
    // hosts' filter_matches_row: null/missing never matches any operator.
    await client.reset();
    await client.mutation('addNote', { boardId: 'b-null', text: 'null author' });
    await client.mutation('addNote', { boardId: 'b-null', text: 'authored', authorId: 'u1' });
    const byAuthor = await client.query('listNotesByAuthor', { authorId: 'u1' });
    check('an authorId filter still matches real values on the pushdown path',
      byAuthor.ok && byAuthor.rows.length === 1 && byAuthor.rows[0].text === 'authored',
      JSON.stringify(byAuthor));
    const byNullAuthor = await client.query('listNotesByAuthor', { authorId: null });
    check('eq(null) on an optional field matches nothing on the pushdown path (SQL semantics)',
      byNullAuthor.ok && byNullAuthor.rows.length === 0,
      JSON.stringify(byNullAuthor));
    const nullProbe = await client.mutation('probeNullSemantics', { boardId: 'b-null' });
    const probeCounts = nullProbe.ok ? nullProbe.result : null;
    check('eq(null) agrees across pushdown and buffered-overlay paths within one mutation',
      probeCounts !== null && probeCounts.eqNullBefore === 0 && probeCounts.eqNullAfter === 0,
      JSON.stringify(nullProbe));
    check('range filters over a null field agree across pushdown and buffered-overlay paths',
      probeCounts !== null && probeCounts.ltBefore === 1 && probeCounts.ltAfter === 1,
      JSON.stringify(nullProbe));
    const byNullAfterCommit = await client.query('listNotesByAuthor', { authorId: null });
    check('the committed null-author probe row stays excluded from eq(null) after commit',
      byNullAfterCommit.ok && byNullAfterCommit.rows.length === 0,
      JSON.stringify(byNullAfterCommit));

    // -- live subscription: snapshot before delta ---------------------------
    await client.reset();
    await client.mutation('addNote', { boardId: 'b2', text: 'pre-existing' });
    const socket = await client.openLiveSocket();
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b2' } });
    const snapshot = await socket.waitFor('snapshot');
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b2' } });
    const duplicateSnapshot = await socket.waitFor('snapshot');
    check('duplicate live subscribes reuse the existing subscription id',
      duplicateSnapshot.subscriptionId === snapshot.subscriptionId,
      JSON.stringify({ first: snapshot.subscriptionId, second: duplicateSnapshot.subscriptionId }));
    check('cold-start subscription delivers an authoritative snapshot first',
      snapshot.type === 'snapshot' && snapshot.rows.length === 1 && typeof snapshot.version === 'number',
      JSON.stringify(snapshot));
    check('subscription snapshot exposes the connection key (reconnect diagnostics)',
      typeof snapshot.connectionKey === 'string' && snapshot.connectionKey.length > 0,
      JSON.stringify(snapshot));

    // -- mutation reaches the live subscriber without polling ---------------
    const beforeDelta = Date.now();
    const liveMutation = await client.mutation('addNote', { boardId: 'b2', text: 'live update' });
    const delta = await socket.waitFor('live_replace');
    check('a commit pushes a live_replace to the subscriber (no polling timer)',
      delta.type === 'live_replace' && delta.rows.some((row) => row.text === 'live update'),
      JSON.stringify(delta));
    check('the live delta is tagged with a version at or beyond the committed mutation',
      delta.version >= liveMutation.version, `mutation=${liveMutation.version} delta=${delta.version}`);
    check('live delivery is prompt (push, not interval-polled)',
      Date.now() - beforeDelta < 2000, `${Date.now() - beforeDelta}ms`);

    // -- eviction surrogate: subscription rehydrates from persisted rows -----
    await client.evict();
    await client.mutation('addNote', { boardId: 'b2', text: 'after eviction' });
    const afterEviction = await socket.waitFor('live_replace');
    check('after the in-memory state is discarded, a commit still reaches the subscriber (rehydration)',
      afterEviction.rows.some((row) => row.text === 'after eviction'),
      JSON.stringify(afterEviction));

    // -- disconnect + resubscribe -------------------------------------------
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const socket2 = await client.openLiveSocket();
    socket2.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b2' } });
    const snapshot2 = await socket2.waitFor('snapshot');
    check('resubscribe after disconnect delivers a fresh authoritative snapshot',
      snapshot2.rows.length >= 3, JSON.stringify({ count: snapshot2.rows.length }));
    socket2.close();
  } finally {
    await client.dispose();
  }

  // The real request-chain cap exists only on Cloudflare. A testing-only
  // zero-capacity admission seam deterministically pins both public envelope
  // shapes in Miniflare; LLP 0050's remote burst remains the platform proof.
  const saturated = await startProof({ bindings: { SNAPBACK_MAX_PENDING_INVOCATIONS: '0' } });
  try {
    const proofOverload = await saturated.mutation('addNote', { boardId: 'burst', text: 'retry me' });
    check('proof-protocol admission failure is SNAPBACK_OVERLOADED and retryable with backoff',
      proofOverload.code === 'SNAPBACK_OVERLOADED' && proofOverload.details?.retryable === true &&
        proofOverload.details?.backoff === true && proofOverload.details?.reason === 'coordinator_admission_limit',
      JSON.stringify(proofOverload));
    const kitOverload = await saturated.kitMutation('addNote', { boardId: 'burst', text: 'retry me too' });
    check('kit-protocol admission failure is a structured HTTP 503 overload diagnostic',
      kitOverload.status === 503 && kitOverload.body.diagnostic?.code === 'SNAPBACK_OVERLOADED' &&
        kitOverload.body.diagnostic?.details?.retryable === true,
      JSON.stringify(kitOverload));
  } finally {
    await saturated.dispose();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const shortfall = total === 0
    ? 'zero checks ran'
    : total !== EXPECTED_CHECKS
      ? `ran ${total}/${EXPECTED_CHECKS} expected checks`
      : null;
  const report = {
    title: 'LLP 0040 Cloudflare narrow proof — Miniflare acceptance',
    surface: 'miniflare-regression',
    passed,
    total,
    expectedChecks: EXPECTED_CHECKS,
    ok: passed === total && shortfall === null,
    results,
  };
  if (shortfall) report.shortfall = shortfall;
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('acceptance harness crashed:', error);
  process.exit(2);
});
