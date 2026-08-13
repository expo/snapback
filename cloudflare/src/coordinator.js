// The app coordinator Durable Object for the LLP 0040 Cloudflare narrow proof.
//
// It owns, in one object and one embedded SQLite database (LLP 0014
// §Resolution — everything on Durable Objects):
//   - the app instance and its tables (app_*),
//   - the DK-2 commit-version counter (the per-app version authority),
//   - the change journal,
//   - the storage-backed subscription registry (one-way door 4),
//   - every server-held WebSocket, through the Hibernation API.
//
// A committed mutation allocates the next version and writes all affected rows
// plus the journal append in ONE `storage.transactionSync`, so LLP 0007's
// gap-free visibility holds by construction (LLP 0040 §Version contract). The
// live path pushes from that commit, never from polling. The normal network
// profile adds no timer, so the object can hibernate while holding live
// sockets (LLP 0040 §Idle economics). LLP 0167 non-normal profiles are the
// explicit exception: a waitUntil-anchored deadline timer keeps the object
// active for at most 30 seconds, then hibernation eligibility returns.
//
// Durable Objects interleave requests at await points, and the handler seam is
// an await — so every invocation-bearing entry point (query, mutation,
// subscribe) runs under one coordinator-local mutex (`runExclusive`). One
// handler executes, commits, and fans out at a time; captured read sets are
// recorded but not yet validated, so serialization is what enforces the
// isolation the manifest declares (`coordinator-serialized-invocations`,
// ENG-23575). The re-entrant /_snapback/host-call path deliberately stays OUTSIDE the
// mutex: it is how the invocation holding the mutex makes progress.
//
// Handler code runs in a SEPARATE, globally stripped isolate — the
// single-sourced LLP 0048 harness Worker (HANDLER binding) — reached over an
// async, RPC-shaped seam. Handlers touch storage only through the `ctx`
// surface served back here as host calls; they never receive a Durable Object
// storage handle, env, or ambient global (LLP 0009, verified by the
// ambient-power denial test).

import { HostContext, physicalIndexName, physicalTableName, validateWriteValues } from './host-ops.js';
import { nextNominalAfter } from './cron-utils.js';
import { SUBSCRIPTION_LIMITS, SUBSCRIPTION_TEST_CEILINGS } from './limits.js';
import { compileSubscriptionSelections, SUBSCRIPTION_FUNCTION_INDEX } from './subscription-selection.js';
import { wireDiagnostic, wireErrorResponse } from './wire-diagnostic.js';
import {
  NetworkProfileState,
  markProfiledResponse,
  networkProfileClockNowMs,
  networkProfileStartupDiagnostic,
  networkProfileStatus,
  parseNetworkProfile,
} from './network-profile.js';
import {
  DEFAULT_MAX_PENDING_INVOCATIONS,
  classifyHandlerPlatformFailure,
  classifyPlatformError,
  overloadedFailure,
  platformFailureError,
  platformFailureResponse,
  valueTooLargeFailure,
} from './platform-errors.js';
import {
  admitDeclaredRefusal,
  parseHandlerEnvelope,
  restoreDenialWitness,
} from '../../packages/snapback-harness/envelope.mjs';
import { ID_PREFIXES, mintId } from '../../packages/snapback-contract/ids.mjs';
import { createIdentifierRemediationSet } from '../../packages/snapback-client/remediation.mjs';
import {
  CLOUDFLARE_TARGET_PROFILE,
  strictDeclarationsTargetRefusal,
} from './target-admission.js';
import { admitOutboundDestination, isRedirectStatus } from './outbound-destination.js';
// RQS — the Cloudflare arm (LLP 0090 rollout step 4, ENG-25455). The token/
// digest algebra is the shared packages/snapback-client/rqs.mjs module,
// re-exported through rqs-host.mjs (never forked); rqs-host adds this arm's
// eligibility derivation, HostPlan-subset evaluation, params-v1, routes
// validation, DO-storage keyring, and token verification.
import {
  RESUME_TOKEN_MAX_AGE_MS,
  activeResumeKey,
  argsHash as rqsArgsHash,
  compileHostPlanStorageQuery,
  decodeAndVerifyToken,
  digestOfRows,
  ensureResumeKeyTable,
  evaluateHostPlanQuery,
  functionRouteArgTypes,
  functionRouteNestedArgTypes,
  generationDigest,
  hostPlanQuery,
  mintTokenWire,
  publicInlineFact,
  queryArtifactHash,
  refusal as rqsRefusal,
  resumeConfigIdentity,
  rqsEligibleDigestKind,
  sha256Identity,
  substituteParamsV1,
  validateRoutesManifest,
} from './rqs-host.mjs';
// The deploy-time app selector (LLP 0049 Phase 0): 'snapback-app' is an
// aliased module specifier — wrangler config `alias` (and the Miniflare
// harness's esbuild alias) resolve it to exactly one checked-in app bundle
// (../app/notes.app.js or ../app/all-aboard.app.js) at build time. The
// Workers runtime forbids dynamic evaluation, so selection is a build fact,
// never a runtime flag.
import {
  appMeta,
  bundleHash,
  capabilityManifest,
  schema,
  functions,
  seed as appSeed,
  config as appConfig,
  cron as appCron,
  deploymentIdentity,
  acknowledgedExperimentalCapabilities,
  // The route→query manifest compiled into the Worker (LLP 0092 §0C.1's 0C
  // artifact, this arm's deploy-time analog of the local ensure admission).
  // `null` on bundles that declare no routes.
  routesManifest as appRoutesManifest,
} from 'snapback-app';

const APP_SCHEMA_HASH = schema.schemaHash;
const APP_BUNDLE_HASH = bundleHash;
// The Cloudflare arm compiles app artifacts into the Worker, so module load is
// its earliest admission seam. Refuse before a Durable Object or data-plane
// route can exist; the immutable flag must never become unenforced serving
// state on this target.
const COMPILED_SCHEMA_ADMISSION_REFUSAL = strictDeclarationsTargetRefusal(schema, {
  targetProfile: CLOUDFLARE_TARGET_PROFILE,
  enforcesStrictDeclarations: false,
});
if (COMPILED_SCHEMA_ADMISSION_REFUSAL) {
  throw codedError(
    COMPILED_SCHEMA_ADMISSION_REFUSAL.code,
    COMPILED_SCHEMA_ADMISSION_REFUSAL.message,
    COMPILED_SCHEMA_ADMISSION_REFUSAL.details,
  );
}
const APP_TABLES = new Set(schema.tables.map((table) => table.name));
const APP_SCHEMA_TABLES = new Map(schema.tables.map((table) => [table.name, table]));
const CHANGE_JOURNAL_RETAIN_VERSIONS = 1000;
const MAX_ROW_BYTES = Number(capabilityManifest.runtimeFacts.maxRowBytes);
const MAX_REQUEST_BYTES = Math.max(4_000_000, MAX_ROW_BYTES * 2);

// The LLP 0094 §0A.1 kit app-data routes as served by this coordinator.
// Every non-2xx JSON failure on these paths rides the versioned ErrorResponse
// (error.response.schema.json) — the §0C.6 governance decision; the LLP 0040
// proof routes (/query, /mutation, /live/stream) and the /_snapback/* system
// and testing lanes are outside that rule and keep their pinned shapes.
const KIT_ENVELOPE_ROUTE =
  /^\/(?:query|mutation|action)\/[A-Za-z0-9_-]+$|^\/live\/[A-Za-z0-9_.-]+\/(?:subscribe|unsubscribe|stream)$|^\/outbox\/[A-Za-z0-9_.-]+$|^\/connection\/open$|^\/app\/(?:ensure|bundle)$/;

// parseJsonObjectRequest option bundle for kit routes (§0C.6 item 7).
const KIT_PARSE = { errorDialect: 'kit' };
// Internal-only discriminator: JSON.stringify ignores symbol keys, so action
// wire envelopes cannot accidentally expose the pre-handler classification.
const ACTION_PRE_HANDLER_REFUSAL = Symbol('action-pre-handler-refusal');
const MAX_HOST_RESPONSE_BYTES = 1_000_000;
// The closed v1 target-capability registry (LLP 0058; nine ids). Only ids
// this registry knows participate in admission: an unknown string is a
// grammar problem for codegen, never silent target authority.
const KNOWN_TARGET_CAPABILITY_IDS = new Set([
  'auth.sessions.v1',
  'bounded_response_stream_v1',
  'cron',
  'cron_action_run_mutation',
  'host_plan_runtime',
  'ibex_ctx_db_host_bridge',
  'live_subscriptions',
  'mutation_read_set_validation',
  'permission_epoch_resync',
]);
const SUPPORTED_TARGET_CAPABILITIES = new Set(capabilityManifest.supportedCapabilities || []);
// @ref LLP 0058#capability-maturity — maturity annotations over the served
// support set (absent field = every emitted id is stable), plus the app
// bundle's explicit experimental acknowledgments. An experimental entry is
// not plain support: resolution refuses a requirement on it unless the
// deploy-time-compiled bundle acknowledged the experimental contract.
const TARGET_CAPABILITY_MATURITY = capabilityManifest.capabilityMaturity || {};
const ACKNOWLEDGED_EXPERIMENTAL_CAPABILITIES = new Set(
  acknowledgedExperimentalCapabilities || []
);
const ACTION_STREAM_TOTAL_BYTES_MAX = 1024 * 1024;
const ACTION_STREAM_BUFFER_BYTES_MAX = 64 * 1024;
const ACTION_STREAM_CHUNK_BYTES_MAX = 16 * 1024;
const ACTION_STREAM_WALL_MS = 30_000;
const ACTION_STREAM_IDLE_MS = 5_000;
const ACTION_STREAM_OPEN_MAX = 4;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const MAX_ACTION_TIMEOUT_MS = 15 * 60 * 1000;
const SUBSCRIPTION_SCHEMA_VERSION = 3;
const CRON_CLAIM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STARTUP_REFUSAL_ALARM_RETRY_MS = 60_000;
const DEFAULT_CONNECTION_GRANT_LIMIT = 1024;
const MAX_CONNECTION_GRANT_LIMIT = 4096;
const DEFAULT_CONNECTION_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONNECTION_OPEN_RATE_PER_MINUTE = 120;
const MAX_CONNECTION_ID_BYTES = 128;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ANONYMOUS_AUTH_PROJECTION = Object.freeze({
  userId: null,
  sessionId: null,
  isAuthenticated: false,
  kind: 'anonymous',
  actorKind: 'anonymous',
});
const CONNECTION_AUTH_PROJECTION = Object.freeze({
  userId: null,
  sessionId: null,
  isAuthenticated: false,
  kind: 'anonymous',
  actorKind: 'connection-grant',
});
const OPERATOR_AUTH_PROJECTION = Object.freeze({
  userId: null,
  sessionId: null,
  isAuthenticated: false,
  kind: 'anonymous',
  actorKind: 'operator-token',
});
const SYSTEM_AUTH_PROJECTION = Object.freeze({
  userId: null,
  sessionId: null,
  isAuthenticated: false,
  kind: 'anonymous',
  actorKind: 'system',
});
// Wire-version negotiation (LLP 0094 §0B). The token is byte-identical to
// the kit-stream subprotocol; classification is exact-token (LLP 0064).
// @ref LLP 0094#0b3-the-wireversion-open-time-offer — hosted B1: the open
//   decoder must READ the offer (its open decoder is otherwise open, the
//   §0C.3 silent-feature-off hazard) and echo the bound version, the hosted
//   arm's only runtime version witness.
const WIRE_VERSION_V1 = 'snapback.v1';
const SUPPORTED_WIRE_VERSIONS = Object.freeze([WIRE_VERSION_V1]);
const WIRE_VERSION_CANDIDATE_PREFIX = 'snapback.v';
const WIRE_VERSION_BEARER_CARRIER_PREFIX = 'snapback.connection-token.';

// The `/connection/open` offer member, classified per the §0B.3 matrix.
// The member is declared to be a wire version, so any present value that is
// not exactly a supported token — wrong string, wrong type, or conflicting
// camelCase/snake_case duplicates — is unknown, never silently ignored.
function classifyOpenWireVersionOffer(payload) {
  const camel = payload.wireVersion;
  const snake = payload.wire_version;
  if (camel === undefined && snake === undefined) return { kind: 'absent' };
  if (camel !== undefined && snake !== undefined && camel !== snake) {
    return { kind: 'unknown' };
  }
  const offered = camel !== undefined ? camel : snake;
  // The Rust authority is Option<String>, whose generated input schema
  // admits null and whose decoder maps null to the absent class. Preserve
  // that exact schema/decoder behavior on the open-decoded hosted arm.
  if (offered === null) return { kind: 'absent' };
  if (typeof offered === 'string' && SUPPORTED_WIRE_VERSIONS.includes(offered)) {
    return { kind: 'known', token: offered };
  }
  return { kind: 'unknown' };
}

// The kit-stream subprotocol offer set, reduced to the first matching row of
// the §0B.4 precedence table ("bound version present wins"; classification
// precedes equality, so an offer set with no known candidate can never be a
// mismatch). The bearer carrier is excluded before candidate matching;
// unrelated subprotocols are ignored; duplicates are harmless.
function classifySocketWireVersionOffer(entries, bound) {
  let seenCandidate = false;
  let seenKnown = false;
  for (const entry of entries) {
    if (entry.startsWith(WIRE_VERSION_BEARER_CARRIER_PREFIX)) continue;
    if (!entry.startsWith(WIRE_VERSION_CANDIDATE_PREFIX)) continue;
    seenCandidate = true;
    if (entry === bound) return 'bound';
    if (SUPPORTED_WIRE_VERSIONS.includes(entry)) seenKnown = true;
  }
  if (seenKnown) return 'known-mismatch';
  if (seenCandidate) return 'unknown';
  return 'absent';
}
const UTF8_ENCODER = new TextEncoder();
const MAX_LIVE_SOCKET_FRAME_BYTES = 64 * 1024;
const MAX_CRON_DIAGNOSTIC_BYTES = 1024;
const CRON_STATUS_RESPONSE_HEADERS = Object.freeze({
  'cache-control': 'private, no-store',
  vary: 'x-snapback-admin-token',
});
// Public cron status is deliberately a closed classification surface. The
// retained/operator diagnostic may carry scrubbed bounded detail, but
// arbitrary handler or exception text must never mint a new code.
const PUBLIC_CRON_ERROR_CODES = new Set([
  'SNAPBACK_ACTION_MUTATION_UNKNOWN',
  'SNAPBACK_ACTION_RATE_LIMITED',
  'SNAPBACK_ACTION_REPLAY_DIVERGED',
  'SNAPBACK_ACTION_RESET_ABORTED',
  'SNAPBACK_ACTION_TIMEOUT',
  'SNAPBACK_ACTION_UNKNOWN',
  'SNAPBACK_FUNCTION_KIND_MISMATCH',
]);
// LLP 0092 §0D.2 pinned bundle limits (server policy knobs) and §0D.2's
// step-2 interim anonymous rate posture (one shared anonymous bucket).
const BUNDLE_LIMIT_ROWS = 5000;
const BUNDLE_LIMIT_BYTES = 4 * 1024 * 1024;
const BUNDLE_LIMIT_TIME_MS = 2000;
const BUNDLE_RATE_PER_MINUTE = 60;
const FAN_OUT_FAILURE_CODES = Object.freeze([
  'SNAPBACK_LIVE_FANOUT_QUERY_FAILED',
  'SNAPBACK_LIVE_FANOUT_SERIALIZATION_FAILED',
  'SNAPBACK_LIVE_FANOUT_SEND_FAILED',
  'SNAPBACK_LIVE_FANOUT_INTERNAL_FAILED',
]);

// Workers exposes Web Crypto digests but not node:crypto timingSafeEqual.
// Hash both inputs to equal-length byte arrays, then compare every byte so
// token length and the first mismatching position do not short-circuit.
async function constantTimeTokenEqual(expected, presented) {
  const [expectedDigest, presentedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', UTF8_ENCODER.encode(String(expected))),
    crypto.subtle.digest('SHA-256', UTF8_ENCODER.encode(String(presented))),
  ]);
  const left = new Uint8Array(expectedDigest);
  const right = new Uint8Array(presentedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export class Coordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    // Live invocations keyed by host-call token, so a re-entrant /_snapback/host-call
    // (routed back from the handler isolate) finds its HostContext. Purely
    // in-memory and request-scoped: nothing across eviction depends on it.
    this.activeInvocations = new Map();
    // The invocation mutex (ENG-23575): queue each invocation-bearing request
    // so handler execution + commit + fan-out (and subscription snapshot +
    // registration) are one critical section each. The tail returns to null
    // when idle instead of becoming a permanent cross-request Promise chain;
    // the old chain inherited request context until Cloudflare's service-
    // binding depth limit surfaced under parallel bursts (ENG-23849).
    this.invocationTail = null;
    this.pendingInvocations = 0;
    this.maxPendingInvocations = configuredPendingInvocationLimit(env);
    // Fresh per in-memory instance, never persisted: lets a remote client
    // observe a real platform eviction (the marker changes across a quiet
    // window) — the LLP 0040 decisive-evidence run reads it off /health.
    this.bootMarker = crypto.randomUUID();
    this.startupError = null;
    this.testCronStopAfterClaimRemaining = env.SNAPBACK_TEST_CRON_STOP_AFTER_CLAIM === '1' ? 1 : 0;
    this.testCronInterruptDuringActionRemaining = env.SNAPBACK_TEST_CRON_INTERRUPT_DURING_ACTION === '1' ? 1 : 0;
    this.testCronStopBeforeFinishRemaining = env.SNAPBACK_TEST_CRON_STOP_BEFORE_FINISH === '1' ? 1 : 0;
    this.testCronStopAfterTerminalUpdateRemaining =
      env.SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE === '1' ? 1 : 0;
    this.testFanOutQueryFailuresRemaining = configuredTestFailureCount(env.SNAPBACK_TEST_FANOUT_QUERY_FAILURES, env);
    this.testFanOutSerializationFailuresRemaining = configuredTestFailureCount(
      env.SNAPBACK_TEST_FANOUT_SERIALIZATION_FAILURES,
      env
    );
    this.testFanOutSendFailuresRemaining = configuredTestFailureCount(env.SNAPBACK_TEST_FANOUT_SEND_FAILURES, env);
    this.fanOutFailureCounters = Object.fromEntries(FAN_OUT_FAILURE_CODES.map((code) => [code, 0]));
    // RQS observability (LLP 0090 §Scalability: attempted/admitted/refused by
    // coded cause, rung taken, tokens minted). In-memory per instance — the
    // counters are diagnostics, never admission state.
    this.rqsStats = {
      attempted: 0,
      currentAsOfAnswers: 0,
      freshReplaceAnswers: 0,
      tokensMinted: 0,
      mintRefusals: 0,
      refused: {},
    };
    this.rqsGenerationCache = null;
    this.rqsRoutesCache = undefined;
    this.rqsFactsCache = new Map();
    this.rqsBundleRateWindow = [];
    this.testSocketLimitOverrides = null;
    // Runtime selections are deliberately in-memory. A DO reconstruction —
    // including eviction or WebSocket hibernation wake — is this arm's
    // definition of restart: the env profile is re-applied and an API-set
    // override disappears. GET/health plus response markers make that
    // reversion observable instead of silently pretending the override is
    // durable (LLP 0167, Fable round-3 finding 5).
    this.networkProfiles = new NetworkProfileState(env);
    this.liveDeliveryTails = new Map();
    this.liveReleaseDeadlineByConnection = new Map();
    this.initializeSchema();
    if (!this.startupError && this.networkProfiles.startupError) {
      this.startupError = networkProfileStartupDiagnostic(this.networkProfiles.startupError);
    }
    // Hibernated sockets survive Worker deployments. Reconcile pre-cap state
    // at construction as well as on HTTP requests so a socket-originated wake
    // cannot keep an old over-limit registry alive indefinitely.
    this.socketLimitError = this.reconcileAcceptedSocketBounds();
  }

  // Serialize `task` behind every previously queued invocation. Bound the
  // accepted queue below Cloudflare's request-chain limit so excess work gets
  // a stable retryable result instead of a late platform exception. Failures
  // propagate to the caller but never poison the tail.
  runExclusive(task) {
    if (this.pendingInvocations >= this.maxPendingInvocations) {
      return Promise.reject(
        platformFailureError(
          overloadedFailure({
            reason: 'coordinator_admission_limit',
            pendingInvocations: this.pendingInvocations,
            maxPendingInvocations: this.maxPendingInvocations,
          })
        )
      );
    }

    this.pendingInvocations += 1;
    let run;
    if (this.invocationTail === null) {
      // Invoke directly in the new request's context whenever the mutex was
      // idle. Promise.resolve().then(task) would create another inherited
      // continuation — the failure mode measured in LLP 0050.
      try {
        run = Promise.resolve(task());
      } catch (error) {
        run = Promise.reject(error);
      }
    } else {
      run = this.invocationTail.then(() => task());
    }
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.invocationTail = settled;
    return run.finally(() => {
      this.pendingInvocations -= 1;
      if (this.invocationTail === settled) this.invocationTail = null;
    });
  }

  servablePrecondition() {
    if (this.socketLimitError) {
      this.socketLimitError = this.reconcileAcceptedSocketBounds();
    }
    return this.startupError || this.socketLimitError;
  }

  preparedResponse(response, egress = null, fanOut = []) {
    return { preparedNetworkEgress: true, response, egress, fanOut };
  }

  prepareResultResponse(response, lane, readyAtMs = networkProfileClockNowMs()) {
    return this.preparedResponse(response, this.networkProfiles.admitResult(lane, readyAtMs));
  }

  async waitForRelease(deadlineMs) {
    const remainingMs = deadlineMs - networkProfileClockNowMs();
    if (remainingMs <= 0) return;
    // The wait is attached to DurableObjectState.waitUntil by the outer
    // release layer. A pending <=30 s timer intentionally keeps the object
    // active and therefore temporarily ineligible for hibernation; once the
    // deadline releases, no timer remains and normal hibernation resumes.
    // This is the explicit delivery contract missing from floating work in
    // ENG-23576 (LLP 0167, Fable round-3 finding 1).
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }

  reserveLiveDelivery(member, encoded, egress) {
    const connectionId = member.connectionId;
    let clampedEgress = egress;
    if (egress) {
      const predecessor = this.liveReleaseDeadlineByConnection.get(connectionId);
      const releaseAtMs = Math.max(egress.releaseAtMs, predecessor ?? 0);
      this.liveReleaseDeadlineByConnection.set(connectionId, releaseAtMs);
      clampedEgress = Object.freeze({ snapshot: egress.snapshot, releaseAtMs });
    }

    // Reserve FIFO position while still under the serialized preparation
    // phase, but do not start wall-clock waiting. The activation promise is
    // resolved only by the outer release layer after runExclusive settles.
    const predecessor = this.liveDeliveryTails.get(connectionId) || Promise.resolve();
    let activate;
    const activation = new Promise((resolve) => { activate = resolve; });
    const delivery = predecessor
      .then(() => activation)
      .then(async () => {
        if (clampedEgress) await this.waitForRelease(clampedEgress.releaseAtMs);
        // Per-member isolation: one dead hibernation socket must not suppress
        // delivery to the remainder of the fan-out group.
        if (!this.currentFanOutMembers([member]).length) return;
        try {
          if (this.testFanOutSendFailuresRemaining > 0) {
            this.testFanOutSendFailuresRemaining -= 1;
            throw codedError('SNAPBACK_TEST_FANOUT_SEND_FAILED', 'injected fan-out send failure');
          }
          member.ws.send(encoded);
        } catch (_) {
          this.recordFanOutFailure('SNAPBACK_LIVE_FANOUT_SEND_FAILED');
          closeSocketWithDiagnostic(member.ws, 1011, 'SNAPBACK_LIVE_FANOUT_SEND_FAILED');
        }
      });
    this.liveDeliveryTails.set(connectionId, delivery);
    const cleanup = () => {
      if (this.liveDeliveryTails.get(connectionId) === delivery) {
        this.liveDeliveryTails.delete(connectionId);
        this.liveReleaseDeadlineByConnection.delete(connectionId);
      }
    };
    delivery.then(cleanup, cleanup);
    return { activate, delivery, profiled: clampedEgress !== null };
  }

  activatePreparedFanOut(reservations) {
    if (!Array.isArray(reservations) || reservations.length === 0) return Promise.resolve();
    for (const reservation of reservations) reservation.activate();
    const delivery = Promise.all(reservations.map((reservation) => reservation.delivery)).then(() => undefined);
    // Anchoring is mandatory even when the HTTP response returns first. This
    // is the real-Workers delivery contract; the wait itself begins only
    // after the serialized phase handed the carrier to this outer layer.
    this.ctx.waitUntil(delivery);
    return delivery;
  }

  async releasePrepared(value) {
    if (!value || value.preparedNetworkEgress !== true) return value;
    const delivery = this.activatePreparedFanOut(value.fanOut);
    if (value.egress) {
      // Ack and fan-out are released independently against absolute
      // commit-relative deadlines. Never await fan-out before starting the
      // ack wait, or the ack delay would stack behind the live lane.
      await this.waitForRelease(value.egress.releaseAtMs);
      return markProfiledResponse(value.response, value.egress);
    }
    // Preserve the pre-profile normal contract that fan-out settles before
    // its mutation response, while still keeping physical sends outside the
    // coordinator mutex.
    await delivery;
    return value.response;
  }

  networkProfileErrorResponse(error) {
    return json(networkProfileStatus(error), wireErrorResponse(
      wireDiagnostic(
        error.snapbackCode || 'SNAPBACK_NETWORK_PROFILE_INVALID',
        String(error.message || error),
        error.snapbackDetails ?? null,
      ),
    ));
  }

  // Startup is intentionally two-phase. The metadata table is the only DDL
  // allowed before deployment identity and system-schema versions have been
  // inspected. In particular, a newly-declared UNIQUE index must not throw in
  // the constructor before /health can explain the stale deployment and
  // authenticated /reset can rebuild it.
  initializeSchema() {
    try {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS _snapback_meta (key TEXT PRIMARY KEY, value TEXT)`);
      this.startupError =
        this.validateDeploymentMetadata() ||
        this.validateSubscriptionsSchemaVersion() ||
        // Legacy v0-v2 registries can predate all hosted subscription caps.
        // Refuse over-limit common rows before migrateSubscriptionsSchema()
        // performs its copy; health/reset must remain available even when the
        // old table is far too large to migrate safely.
        this.validatePersistedSubscriptionBounds();
    } catch (error) {
      // Foundational table drift must not prevent the Durable Object from
      // constructing. /health explains the refusal and authenticated /reset
      // rebuilds the owned schema even when readMeta()/currentVersion() cannot
      // interpret an unknown future layout.
      this.startupError = staleArtifact(
        (error && error.snapbackCode) || 'SNAPBACK_CLOUDFLARE_FOUNDATION_SCHEMA_INVALID',
        'the durable metadata/version schema is incompatible; inspect health and reset or migrate before serving this deployment',
        { cause: String((error && error.message) || error) }
      );
      return;
    }
    if (this.startupError) return;
    try {
      this.ensureCurrentSchema();
      this.startupError = this.validatePersistedSubscriptionBounds();
      if (this.startupError) return;
      this.writeDeploymentMetadata();
    } catch (error) {
      this.startupError = staleArtifact(
        (error && error.snapbackCode) || 'SNAPBACK_CLOUDFLARE_SCHEMA_RECONCILIATION_FAILED',
        'the durable schema could not be reconciled; inspect health and reset or migrate before serving this deployment',
        { cause: String((error && error.message) || error) }
      );
    }
  }

  ensureCurrentSchema() {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)`
    );
    this.sql.exec(`INSERT OR IGNORE INTO _snapback_version (id, version) VALUES (1, 0)`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_changes (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         version INTEGER NOT NULL,
         table_name TEXT NOT NULL,
         row_id TEXT NOT NULL,
         op TEXT NOT NULL,
         row_json TEXT,
         changed_at_ms INTEGER NOT NULL
       )`
    );
    // Fixed-cardinality post-commit delivery diagnostics. The code set is
    // closed in FAN_OUT_FAILURE_CODES, so a failing stream cannot create an
    // unbounded label/key space. Recording is best effort and never changes
    // the already-committed mutation outcome.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_fanout_diagnostics (
         code TEXT PRIMARY KEY,
         count INTEGER NOT NULL,
         last_at_ms INTEGER NOT NULL
       )`
    );
    // Storage-backed subscription registry (one-way door 4): query identity,
    // args, and connection id — rehydrated lazily on wake. In-memory
    // registries die at eviction while their sockets live on. The identity
    // uniqueness is the idempotence contract for React StrictMode/retry paths.
    // Connection grants for the kit wire protocol (ENG-23442 shape): ids are
    // server-granted capabilities paired with a bearer token. Durable, so a
    // grant survives eviction/hibernation exactly like the subscriptions
    // that reference it.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_connections (
         connection_id TEXT PRIMARY KEY,
         token TEXT NOT NULL,
         opened_at_ms INTEGER NOT NULL,
         socket_session_id TEXT
       )`
    );
    this.ensureColumn('_snapback_connections', 'socket_session_id', 'TEXT');
    // The lineage's explicit wire-version binding (LLP 0094 §0B.3): the bound
    // token when the first open carried a known offer, NULL for a legacy
    // (offerless-open) lineage. Fixed at first open; no re-open changes it.
    this.ensureColumn('_snapback_connections', 'wire_version', 'TEXT');
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_connection_admission (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         window_started_at_ms INTEGER NOT NULL,
         count INTEGER NOT NULL
       )`
    );
    const hadSubscriptions = this.tableExists('_snapback_subscriptions');
    if (!hadSubscriptions) {
      this.createSubscriptionsTable('_snapback_subscriptions');
      this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION));
    } else {
      this.migrateSubscriptionsSchema();
    }
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS ${SUBSCRIPTION_FUNCTION_INDEX} ON _snapback_subscriptions (function_name)`
    );
    // Pool rotation cursors (LLP 0049 §Config And Secrets, OQ1): coordinator-
    // local durable metadata, NEVER values. Applied modulo the current member
    // count at grant time, so a pool edit can never strand a cursor out of
    // range. Deliberately not cleared by destructive reset — config metadata
    // is deployment state, not app data.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_config_cursors (
         entry_name TEXT PRIMARY KEY,
         cursor INTEGER NOT NULL
       )`
    );
    // Durable cron state (LLP 0028 §Scheduler state / LLP 0049 Phase 3):
    // per-job activation + nominal schedule + last-run ledger summary, and
    // the claim table whose stable idempotency key (jobName, scheduledAt)
    // makes DO-alarm auto-retry safe — a duplicate wakeup for an
    // already-claimed slot must not double-fetch or double-commit.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_cron_state (
         job_name TEXT PRIMARY KEY,
         armed INTEGER NOT NULL DEFAULT 0,
         next_nominal_at_ms INTEGER,
         last_run_id TEXT,
         last_scheduled_at_ms INTEGER,
         last_trigger TEXT,
         last_outcome TEXT,
         last_duration_ms INTEGER,
         last_error_code TEXT,
         last_error TEXT,
         last_finished_at_ms INTEGER
       )`
    );
    this.ensureColumn('_snapback_cron_state', 'last_error_code', 'TEXT');
    this.migrateCronDiagnostics();
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_cron_claims (
         idempotency_key TEXT PRIMARY KEY,
         job_name TEXT NOT NULL,
         scheduled_at_ms INTEGER NOT NULL,
         run_id TEXT NOT NULL,
         claimed_at_ms INTEGER NOT NULL,
         state TEXT NOT NULL,
         lease_expires_at_ms INTEGER,
         attempt INTEGER NOT NULL DEFAULT 1
       )`
    );
    this.ensureColumn('_snapback_cron_claims', 'lease_expires_at_ms', 'INTEGER');
    this.ensureColumn('_snapback_cron_claims', 'attempt', 'INTEGER NOT NULL DEFAULT 1');
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_snapback_cron_claims_job ON _snapback_cron_claims (job_name, scheduled_at_ms)');
    this.ensureActionLimitSchema();
    // @ref LLP 0028#scheduler-state-and-run-ledger — stable scheduled
    // idempotency reaches each nested mutation's commit transaction.
    // Stable results for nested mutations issued by retryable scheduled
    // actions. The row is inserted in the SAME transaction as the mutation
    // commit, closing the crash-after-commit/before-cron-finish gap: a retry
    // replays the prior result instead of committing the mutation twice.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_action_mutation_results (
         action_idempotency_key TEXT NOT NULL,
         sequence INTEGER NOT NULL,
         mutation_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         result_json TEXT NOT NULL,
         commit_version INTEGER NOT NULL,
         PRIMARY KEY (action_idempotency_key, sequence)
       )`
    );
    // The RQS resume keyring (LLP 0091 §0A.1 custody: coordinator DO
    // storage, transactional with the data it protects; rotation never
    // requires a deploy). Deliberately NOT dropped by destructive reset —
    // like _snapback_config_cursors it is deployment security state, not app
    // data; reset invalidates outstanding tokens through the versionStream
    // rotation instead. Key loss is availability-only.
    ensureResumeKeyTable(this.sql);
    for (const table of schema.tables) {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${this.physicalTable(table.name)} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`
      );
      this.ensureDeclaredIndexes(table);
    }
  }

  ensureActionLimitSchema() {
    const columns = [...this.sql.exec('PRAGMA table_info(_snapback_action_limits)')]
      .map((record) => String(record.name));
    // The old table keyed only by action name. It contains disposable
    // minute-window counters, so rebuilding it is both atomic and safer than
    // preserving the globally shared abuse bucket during this schema repair.
    if (columns.length > 0 && !columns.includes('caller_key')) {
      this.sql.exec('DROP TABLE _snapback_action_limits');
    }
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_action_limits (
         action_name TEXT NOT NULL,
         caller_key TEXT NOT NULL,
         window_started_at_ms INTEGER NOT NULL,
         count INTEGER NOT NULL,
         PRIMARY KEY (action_name, caller_key)
      )`
    );
  }

  createSubscriptionsTable(name) {
    this.sql.exec(
      `CREATE TABLE ${name} (
         subscription_id TEXT PRIMARY KEY,
         connection_id TEXT NOT NULL,
         function_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         socket_session_id TEXT,
         UNIQUE(connection_id, function_name, args_json)
       )`
    );
  }

  validateSubscriptionsSchemaVersion() {
    if (!this.tableExists('_snapback_subscriptions')) return null;
    const raw = this.readMeta('subscriptions_schema_version');
    if (raw == null) return null; // legacy v0 is a known migration source
    if (!/^[0-9]+$/.test(raw) || Number(raw) > SUBSCRIPTION_SCHEMA_VERSION) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_SCHEMA_UNSUPPORTED',
        'the durable subscription registry has an unknown schema version; reset or migrate before serving it',
        { expectedAtMost: SUBSCRIPTION_SCHEMA_VERSION, actual: raw }
      );
    }
    return null;
  }

  migrateSubscriptionsSchema() {
    const current = Number(this.readMeta('subscriptions_schema_version') || 0);
    if (current === SUBSCRIPTION_SCHEMA_VERSION) {
      if (!this.tableHasColumn('_snapback_subscriptions', 'socket_session_id')) {
        throw codedError(
          'SNAPBACK_SUBSCRIPTION_SCHEMA_INVALID',
          `subscription schema v${SUBSCRIPTION_SCHEMA_VERSION} is missing socket_session_id`
        );
      }
      return;
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DROP TABLE IF EXISTS _snapback_subscriptions_next');
      this.testSubscriptionMigrationFault('after-drop-next');
      this.createSubscriptionsTable('_snapback_subscriptions_next');
      this.testSubscriptionMigrationFault('after-create-next');
      this.sql.exec(
        `INSERT OR IGNORE INTO _snapback_subscriptions_next
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         SELECT s.subscription_id, s.connection_id, s.function_name, s.args_json, c.socket_session_id
         FROM _snapback_subscriptions s
         LEFT JOIN _snapback_connections c ON c.connection_id = s.connection_id
         WHERE c.connection_id IS NULL OR c.socket_session_id IS NOT NULL
         ORDER BY subscription_id`
      );
      this.testSubscriptionMigrationFault('after-copy');
      this.sql.exec('DROP TABLE _snapback_subscriptions');
      this.testSubscriptionMigrationFault('after-drop-source');
      this.sql.exec('ALTER TABLE _snapback_subscriptions_next RENAME TO _snapback_subscriptions');
      this.testSubscriptionMigrationFault('after-rename');
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS ${SUBSCRIPTION_FUNCTION_INDEX} ON _snapback_subscriptions (function_name)`
      );
      this.testSubscriptionMigrationFault('after-index');
      this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION));
      this.testSubscriptionMigrationFault('after-version');
    });
  }

  validatePersistedSubscriptionBounds() {
    if (!this.tableExists('_snapback_subscriptions')) return null;
    const columns = new Set(
      [...this.sql.exec('PRAGMA table_info(_snapback_subscriptions)')].map((record) => String(record.name))
    );
    const missingCommonColumns = ['subscription_id', 'connection_id', 'function_name', 'args_json'].filter(
      (column) => !columns.has(column)
    );
    if (missingCommonColumns.length > 0) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_SCHEMA_INVALID',
        'the durable subscription registry is missing columns common to every supported schema version; reset or migrate before serving it',
        { missingColumns: missingCommonColumns }
      );
    }
    const globalLimit = this.subscriptionGlobalLimit();
    const globalCount = Number(
      [...this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')][0]?.count || 0
    );
    if (globalCount > globalLimit) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT_EXCEEDED',
        'the persisted subscription registry exceeds this deployment\'s enforced global limit; reset or migrate before serving it',
        { limit: globalLimit, actual: globalCount }
      );
    }
    const connectionLimit = this.subscriptionPerConnectionLimit();
    const oversizedConnections = [...this.sql.exec(
      `SELECT connection_id, COUNT(*) AS count FROM _snapback_subscriptions
       GROUP BY connection_id HAVING COUNT(*) > ? ORDER BY count DESC LIMIT 1`,
      connectionLimit
    )];
    if (oversizedConnections.length > 0) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT_EXCEEDED',
        'a persisted connection exceeds this deployment\'s enforced subscription limit; reset or migrate before serving it',
        {
          connectionId: String(oversizedConnections[0].connection_id),
          limit: connectionLimit,
          actual: Number(oversizedConnections[0].count),
        }
      );
    }
    const argsLimit = this.subscriptionArgsBytesLimit();
    const oversizedRawArgs = [...this.sql.exec(
      `SELECT subscription_id, length(CAST(args_json AS BLOB)) AS actual_bytes
       FROM _snapback_subscriptions
       WHERE length(CAST(args_json AS BLOB)) > ?
       ORDER BY subscription_id LIMIT 1`,
      argsLimit
    )];
    if (oversizedRawArgs.length > 0) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_ARGS_LIMIT_EXCEEDED',
        'a persisted subscription exceeds this deployment\'s enforced argument limit; reset or migrate before serving it',
        {
          subscriptionId: String(oversizedRawArgs[0].subscription_id),
          limitBytes: argsLimit,
          actualBytes: Number(oversizedRawArgs[0].actual_bytes),
        }
      );
    }
    for (const row of this.sql.exec('SELECT subscription_id, args_json FROM _snapback_subscriptions ORDER BY subscription_id')) {
      const raw = String(row.args_json);
      let canonical;
      try {
        canonical = canonicalJson(JSON.parse(raw));
      } catch (_) {
        return staleArtifact(
          'SNAPBACK_SUBSCRIPTION_ARGS_INVALID',
          'a persisted subscription carries invalid JSON arguments; reset or migrate before serving it',
          { subscriptionId: String(row.subscription_id) }
        );
      }
      const actualBytes = Math.max(UTF8_ENCODER.encode(raw).byteLength, UTF8_ENCODER.encode(canonical).byteLength);
      if (actualBytes > argsLimit) {
        return staleArtifact(
          'SNAPBACK_SUBSCRIPTION_ARGS_LIMIT_EXCEEDED',
          'a persisted subscription exceeds this deployment\'s enforced argument limit; reset or migrate before serving it',
          { subscriptionId: String(row.subscription_id), limitBytes: argsLimit, actualBytes }
        );
      }
    }
    return null;
  }

  testSubscriptionMigrationFault(step) {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSubscriptionMigrationFailureAt === step) {
      throw codedError('SNAPBACK_TEST_SUBSCRIPTION_MIGRATION_FAILURE', `injected subscription migration failure at ${step}`);
    }
  }

  tableExists(name) {
    return [...this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name)].length > 0;
  }

  ensureColumn(table, column, declaration) {
    const columns = [...this.sql.exec(`PRAGMA table_info(${table})`)];
    if (columns.some((record) => String(record.name) === column)) return;
    this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }

  tableHasColumn(table, column) {
    if (!this.tableExists(table)) return false;
    return [...this.sql.exec(`PRAGMA table_info(${table})`)].some((record) => String(record.name) === column);
  }

  ensureDeclaredIndexes(table) {
    const fields = new Set((table.fields || []).map((field) => field.name));
    for (const index of table.indexes || []) {
      if (!index || !Array.isArray(index.fields) || index.fields.length === 0) {
        throw new Error(`SNAPBACK_SCHEMA_EMPTY_INDEX: ${table.name}.${index && index.name}`);
      }
      const expressions = index.fields.map((field) => {
        if (field !== '_id' && !fields.has(field)) {
          throw new Error(`SNAPBACK_UNKNOWN_FIELD: index ${table.name}.${index.name} references ${field}`);
        }
        return field === '_id' ? 'id' : `json_extract(row_json, '$.${field}')`;
      });
      const unique = index.unique ? 'UNIQUE ' : '';
      const name = physicalIndexName(table.name, index.name);
      const expectedSql = `CREATE ${unique}INDEX ${name} ON ${this.physicalTable(table.name)} (${expressions.join(', ')})`;
      let existingSql = null;
      for (const record of this.sql.exec("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", name)) {
        existingSql = record.sql == null ? null : String(record.sql);
      }
      if (existingSql !== null && normalizeSqlDefinition(existingSql) !== normalizeSqlDefinition(expectedSql)) {
        this.sql.exec(`DROP INDEX ${name}`);
        existingSql = null;
      }
      if (existingSql === null) this.sql.exec(expectedSql);
    }
  }

  storageLayoutForTest() {
    let subscriptionRootPage = null;
    let temporaryTablePresent = false;
    for (const record of this.sql.exec(
      "SELECT name, rootpage FROM sqlite_master WHERE type = 'table' AND name IN ('_snapback_subscriptions', '_snapback_subscriptions_next')"
    )) {
      if (String(record.name) === '_snapback_subscriptions') subscriptionRootPage = Number(record.rootpage);
      if (String(record.name) === '_snapback_subscriptions_next') temporaryTablePresent = true;
    }
    let subscriptionCount = 0;
    for (const record of this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')) {
      subscriptionCount = Number(record.count);
    }
    const indexes = [...this.sql.exec(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )].map((record) => ({ name: String(record.name), table: String(record.tbl_name) }));
    return {
      subscriptionSchemaVersion: Number(this.readMeta('subscriptions_schema_version') || 0),
      subscriptionRootPage,
      subscriptionCount,
      temporaryTablePresent,
      indexes,
    };
  }

  indexPlanForTest(payload) {
    const table = APP_SCHEMA_TABLES.get(String(payload.table || ''));
    if (!table) return kitError(400, 'SNAPBACK_UNKNOWN_TABLE', `unknown table ${payload.table}`);
    const index = (table.indexes || []).find((entry) => entry.name === String(payload.index || ''));
    if (!index) return kitError(400, 'SNAPBACK_QUERY_UNKNOWN_INDEX', `unknown index ${table.name}.${payload.index}`);
    const field = index.fields[0];
    const expression = field === '_id' ? 'id' : `json_extract(row_json, '$.${field}')`;
    const details = [];
    for (const record of this.sql.exec(
      `EXPLAIN QUERY PLAN SELECT row_json FROM ${this.physicalTable(table.name)}
       INDEXED BY ${physicalIndexName(table.name, index.name)} WHERE ${expression} = ?`,
      payload.value == null ? '' : payload.value
    )) {
      details.push(String(record.detail || ''));
    }
    return json(200, { table: table.name, index: index.name, details });
  }

  schemaHardeningForTest(payload) {
    const operation = String(payload.operation || '');
    const indexedTable = schema.tables.find((table) => (table.indexes || []).length > 0) || null;
    const declaredIndex = indexedTable && indexedTable.indexes[0];
    const indexName = declaredIndex ? physicalIndexName(indexedTable.name, declaredIndex.name) : null;
    if (operation === 'corrupt-index') {
      if (!indexName) return json(400, { ok: false, code: 'SNAPBACK_TEST_INDEX_UNAVAILABLE' });
      this.sql.exec(`DROP INDEX IF EXISTS ${indexName}`);
      this.sql.exec(
        `CREATE UNIQUE INDEX ${indexName} ON ${this.physicalTable(indexedTable.name)}
           (id, json_extract(row_json, '$.${declaredIndex.fields[0]}'))`
      );
    } else if (operation === 'reconcile-index') {
      if (!indexedTable) return json(400, { ok: false, code: 'SNAPBACK_TEST_INDEX_UNAVAILABLE' });
      this.ensureDeclaredIndexes(indexedTable);
    } else if (operation === 'create-retired-table') {
      this.sql.exec('CREATE TABLE IF NOT EXISTS app_retired_fixture (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)');
      this.sql.exec("INSERT OR REPLACE INTO app_retired_fixture (id, row_json) VALUES ('retired', '{\"secret\":true}')");
    } else if (operation === 'future-subscriptions') {
      this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION + 100));
      this.startupError = this.validateSubscriptionsSchemaVersion();
    } else if (operation === 'corrupt-foundation-meta') {
      this.sql.exec('DROP TABLE _snapback_meta');
      this.sql.exec('CREATE TABLE _snapback_meta (future_key TEXT PRIMARY KEY, future_value TEXT)');
      this.initializeSchema();
      return json(200, { ok: true, startupError: this.startupError });
    } else if (operation === 'corrupt-foundation-version') {
      this.sql.exec('DROP TABLE _snapback_version');
      this.sql.exec('CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, future_version INTEGER NOT NULL)');
      this.initializeSchema();
      return json(200, { ok: true, startupError: this.startupError });
    } else if (operation === 'reinitialize') {
      this.initializeSchema();
    } else if (operation === 'create-socketless-kit-orphan') {
      this.sql.exec(
        `INSERT OR REPLACE INTO _snapback_connections
           (connection_id, token, opened_at_ms, socket_session_id) VALUES ('orphan-kit', 'orphan-token', ?, NULL)`,
        Date.now()
      );
      this.sql.exec(
        `INSERT OR REPLACE INTO _snapback_subscriptions
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         VALUES ('orphan-sub', 'orphan-kit', ?, '{}', NULL)`,
        this.alarmJobs()[0]?.activation?.whileLive?.[0] || functions.find((fn) => fn.kind === 'LiveQuery')?.name || 'missing'
      );
    } else if (operation === 'insert-legacy-subscription') {
      this.sql.exec(
        `INSERT INTO _snapback_subscriptions
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         VALUES (?, ?, ?, ?, NULL)`,
        String(payload.subscriptionId || `legacy_${crypto.randomUUID()}`),
        String(payload.connectionId || 'legacy-proof'),
        String(payload.functionName || functions.find((fn) => fn.kind === 'LiveQuery')?.name || 'missing'),
        String(payload.argsJson || '{}')
      );
      if (payload.schemaVersion != null) {
        this.writeMeta('subscriptions_schema_version', String(payload.schemaVersion));
      }
    }
    const indexSql = indexName
      ? [...this.sql.exec("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", indexName)]
          .map((record) => String(record.sql || ''))[0] || null
      : null;
    const ownedTables = [...this.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\' ORDER BY name"
    )].map((record) => String(record.name));
    return json(200, {
      ok: true,
      startupError: this.startupError,
      indexSql,
      ownedTables,
      orphanPresent: [...this.sql.exec(
        "SELECT 1 FROM _snapback_subscriptions WHERE subscription_id = 'orphan-sub'"
      )].length > 0,
      subscriptionSchemaVersion: Number(this.readMeta('subscriptions_schema_version') || 0),
    });
  }

  expectedMetadata() {
    return {
      schema_hash: deploymentIdentity.schemaHash,
      bundle_hash: deploymentIdentity.bundleHash,
      inputs_hash: deploymentIdentity.inputsHash,
    };
  }

  readMeta(key) {
    const records = [...this.sql.exec('SELECT value FROM _snapback_meta WHERE key = ?', key)];
    return records.length === 0 ? null : String(records[0].value);
  }

  writeMeta(key, value) {
    this.sql.exec(
      `INSERT INTO _snapback_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      String(value)
    );
  }

  hasPersistentAppState() {
    if (this.currentVersion() > 0) return true;
    const owned = [...this.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'app\\_%' ESCAPE '\\' OR name IN ('_snapback_changes', '_snapback_subscriptions'))"
    )];
    for (const record of owned) {
      const name = String(record.name);
      if (!/^(?:app_[A-Za-z_][A-Za-z0-9_]*|_snapback_changes|_snapback_subscriptions)$/.test(name)) continue;
      const counts = [...this.sql.exec(`SELECT COUNT(*) AS count FROM "${name}"`)];
      if (counts.some((count) => Number(count.count) > 0)) return true;
    }
    return false;
  }

  validateDeploymentMetadata() {
    const expected = this.expectedMetadata();
    const nonEmpty = this.hasPersistentAppState();
    for (const [key, expectedValue] of Object.entries(expected)) {
      const storedValue = this.readMeta(key);
      if (storedValue == null && nonEmpty) {
        return staleArtifact(
          'SNAPBACK_STALE_CLOUDFLARE_ARTIFACT_METADATA',
          `stored app state has no ${key}; reset or migrate before serving this deployment`,
          { key, expected: expectedValue, actual: null }
        );
      }
      if (storedValue != null && storedValue !== expectedValue) {
        return staleArtifact(
          key === 'schema_hash'
            ? 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH'
            : key === 'bundle_hash'
              ? 'SNAPBACK_STALE_CLOUDFLARE_BUNDLE_HASH'
              : 'SNAPBACK_STALE_CLOUDFLARE_INPUTS_HASH',
          `stored ${key} does not match this deployment; reset or migrate before serving it`,
          { key, expected: expectedValue, actual: storedValue }
        );
      }
    }
    return null;
  }

  writeDeploymentMetadata() {
    for (const [key, value] of Object.entries(this.expectedMetadata())) {
      this.writeMeta(key, value);
    }
  }

  // Every table name that reaches SQL identifier position goes through the
  // manifest-derived gate, even schema-sourced ones (ENG-23578).
  physicalTable(table) {
    const physical = physicalTableName(table, APP_TABLES);
    if (!physical) {
      throw new Error(`SNAPBACK_HANDLER_HOST_CALL_INVALID: table "${table}" is not declared in the app schema`);
    }
    return physical;
  }

  currentVersion() {
    if (!this.tableExists('_snapback_version')) return 0;
    const records = [...this.sql.exec('SELECT version FROM _snapback_version WHERE id = 1')];
    return records.length === 0 ? 0 : Number(records[0].version);
  }

  healthVersion() {
    try {
      return this.currentVersion();
    } catch (_) {
      return null;
    }
  }

  appGeneration() {
    const raw = this.readMeta('app_generation');
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  nextResetGeneration() {
    try {
      const next = this.appGeneration() + 1;
      return Number.isSafeInteger(next) && next > 0 ? next : 1;
    } catch (_) {
      return 1;
    }
  }

  newId() {
    return crypto.randomUUID();
  }

  // The hosted proof has dev/anonymous authority only, but the shared
  // MutationResponse still binds every settlement to one server-derived
  // authority cohort. Persist the cohort across DO eviction and rotate it on
  // destructive reset (which drops _snapback_meta), exactly like the data
  // version stream below. Session generation is therefore honestly zero.
  //
  // @ref LLP 0039#replay-parity-and-the-authority-instance-id — settlement
  //   output names its owning authority even on a target without replay
  // @ref LLP 0148#d5-one-registry-one-minting-helper — shared `aut_` mint
  authorityDescriptor() {
    const key = 'authority_instance_id';
    let authorityInstanceId = this.readMeta(key);
    if (!authorityInstanceId) {
      authorityInstanceId = mintId(ID_PREFIXES.authorityInstance);
      this.writeMeta(key, authorityInstanceId);
    }
    return {
      descriptorVersion: 1,
      authorityInstanceId,
      sessionGeneration: 0,
    };
  }

  functionByName(name) {
    const fn = functions.find((entry) => entry.name === name);
    if (!fn) return null;
    if (fn.testingOnly === true && this.env.SNAPBACK_TESTING !== '1') return null;
    // @ref LLP 0076#target-contract — capability admission resolves against
    // the SAME served instance manifest this deployment publishes, before
    // any handler code can run. This target is deploy-time compiled, so
    // function resolution is its loader seam: /app/ensure only hash-gates
    // posted artifacts and never installs them, which is why the check
    // lives here rather than in kitEnsureApp.
    for (const capability of fn.requiredCapabilities || []) {
      if (!KNOWN_TARGET_CAPABILITY_IDS.has(capability)) continue;
      if (!SUPPORTED_TARGET_CAPABILITIES.has(capability)) {
        throw codedError(
          'SNAPBACK_CAPABILITY_UNSUPPORTED',
          `${name} requires capability ${capability}, which the served instance manifest does not support`
        );
      }
      // @ref LLP 0058#capability-maturity — an experimental entry is not
      // plain support; the bundle must have acknowledged the experimental
      // contract for the requirement to admit.
      const maturity = TARGET_CAPABILITY_MATURITY[capability];
      if (
        maturity
        && maturity !== 'stable'
        && !ACKNOWLEDGED_EXPERIMENTAL_CAPABILITIES.has(capability)
      ) {
        throw codedError(
          'SNAPBACK_CAPABILITY_UNSUPPORTED',
          `${name} requires capability ${capability}, which this target supports only at ${maturity} maturity; the app bundle must acknowledge it`
        );
      }
    }
    return fn;
  }

  // --- RQS: generation, versionStream, eligibility, tokens ----------------
  // (LLP 0090 rollout step 4; contracts LLP 0091 0A/0B + LLP 0092 0C/0D.)

  /// The data version stream identity on this arm (LLP 0091 §0A.7): a
  /// coordinator-minted UUID in _snapback_meta, rotated by destructive
  /// /reset (reset drops _snapback_meta, so the next read mints a fresh
  /// stream and every outstanding token refuses SNAPBACK_RESUME_STREAM_MISMATCH).
  rqsVersionStream() {
    const stored = this.readMeta('rqs_version_stream');
    if (stored) return stored;
    const minted = crypto.randomUUID();
    this.writeMeta('rqs_version_stream', minted);
    return minted;
  }

  /// The LLP 0091 §0A.6 generation digest for this served instance. Every
  /// component is deploy-time compiled, so the digest is instance-constant:
  /// deploymentIdentity = the generated artifact's inputsHash, schemaIdentity
  /// = its schemaHash, functions/capability identities = the served arrays'
  /// canonical hashes, plus the resume-relevant config identity (journal
  /// prune policy, auth mode, route-manifest hash, digest-contract version).
  rqsGeneration() {
    if (this.rqsGenerationCache !== null) return this.rqsGenerationCache;
    try {
      const routes = this.rqsRoutes();
      const config = resumeConfigIdentity(
        `retain-versions:${CHANGE_JOURNAL_RETAIN_VERSIONS}`,
        'cloudflare-connection-grant-v1',
        routes ? sha256Identity(routes) : 'none'
      );
      this.rqsGenerationCache = generationDigest(
        deploymentIdentity.inputsHash,
        deploymentIdentity.schemaHash,
        sha256Identity(functions),
        sha256Identity(capabilityManifest),
        config
      );
    } catch (_) {
      // A non-canonicalizable served manifest disables minting/admission
      // (availability-only; every resume takes rung 3).
      this.rqsGenerationCache = undefined;
    }
    return this.rqsGenerationCache;
  }

  /// The compiled routes manifest, validated once (fail closed): an invalid
  /// compiled manifest is treated as absent — bundle requests refuse
  /// SNAPBACK_BUNDLE_ROUTE_UNKNOWN and Channel A serves the plain shell —
  /// the deploy-time analog of the local arm's ensure-time refusal.
  rqsRoutes() {
    if (this.rqsRoutesCache !== undefined) return this.rqsRoutesCache;
    if (!appRoutesManifest) {
      this.rqsRoutesCache = null;
      return null;
    }
    const error = validateRoutesManifest(
      appRoutesManifest,
      (name) => functions.find((fn) => fn.name === name) || null,
      APP_SCHEMA_TABLES
    );
    if (error) {
      try { console.warn('snapback rqs routes manifest invalid (treated as absent):', error); } catch (_) {}
      this.rqsRoutesCache = null;
      this.rqsRoutesError = error;
      return null;
    }
    this.rqsRoutesCache = appRoutesManifest;
    return this.rqsRoutesCache;
  }

  evaluateHostPlanRows(plan, args) {
    const compiled = compileHostPlanStorageQuery(plan, args);
    if (compiled === null) {
      // Defensive compatibility for a future HostPlan residue. The admitted
      // Cloudflare grammar is currently all Eq/order/limit and never takes
      // this branch; an extension must remain correct before it is fast.
      const stored = [...this.sql.exec(`SELECT row_json FROM ${this.physicalTable(plan.table)}`)]
        .map((record) => JSON.parse(record.row_json));
      return evaluateHostPlanQuery(plan, args, stored);
    }
    if (compiled.empty) return [];
    const host = new HostContext({
      sql: this.sql,
      mode: 'query',
      nowMs: Date.now(),
      epoch: 'host-plan-query',
      newId: null,
      tables: APP_TABLES,
      schemaTables: APP_SCHEMA_TABLES,
    });
    try {
      return host.storageQuery(this.physicalTable(plan.table), compiled.plan);
    } catch (error) {
      // The previous strict-JS evaluator answered no rows for a mismatched
      // caller value. Preserve that behavior while valid typed values take
      // the indexed SQL path.
      if (error?.snapbackCode === 'SNAPBACK_QUERY_FILTER_VALUE_INVALID') return [];
      throw error;
    }
  }

  /// Per-function derived RQS facts (cached): the rqsEligible digest kind,
  /// the publicInline disclosure fact, and the interim content-derived
  /// queryArtifact identity (LLP 0091 step-1 amendment item 3, standing).
  rqsFunctionFacts(fn) {
    const cached = this.rqsFactsCache.get(fn.name);
    if (cached) return cached;
    let queryArtifact = null;
    try {
      queryArtifact = queryArtifactHash(fn);
    } catch (_) {
      queryArtifact = null;
    }
    const facts = {
      digestKind: rqsEligibleDigestKind(fn, APP_SCHEMA_TABLES),
      publicInline: publicInlineFact(fn, APP_SCHEMA_TABLES),
      queryArtifact,
    };
    this.rqsFactsCache.set(fn.name, facts);
    return facts;
  }

  rqsCountRefusal(code) {
    this.rqsStats.refused[code] = (this.rqsStats.refused[code] || 0) + 1;
    return code;
  }

  /// Mint one shared resume token at (queryArtifact, argsHash, version,
  /// contentDigest) — LLP 0091 §0A.5. Returns null on any mint impediment
  /// (best-effort; absence only costs a future resume).
  rqsMintResume(facts, args, version, rows) {
    if (!facts.digestKind || !facts.queryArtifact) return null;
    const generation = this.rqsGeneration();
    if (!generation) return null;
    try {
      const contentDigest = digestOfRows(facts.digestKind, rows);
      const hashedArgs = rqsArgsHash(args ?? {});
      const now = Date.now();
      const key = activeResumeKey(this.sql, now);
      const body = {
        app: appMeta.name,
        generation,
        versionStream: this.rqsVersionStream(),
        version,
        queryArtifact: facts.queryArtifact,
        argsHash: hashedArgs,
        digestKind: facts.digestKind,
        contentDigest,
        issuedAt: now,
      };
      const token = mintTokenWire(key.secret, key.keyId, body);
      if (token.length > 1024) return null; // never mint what admission would refuse
      this.rqsStats.tokensMinted += 1;
      return {
        token,
        meta: {
          app: body.app,
          version,
          contentDigest,
          generation,
          versionStream: body.versionStream,
          queryArtifact: body.queryArtifact,
          argsHash: hashedArgs,
        },
      };
    } catch (_) {
      // Mint-time canonicalization refusal (LLP 0091 §0A.2): no token, never
      // a wrong digest.
      this.rqsStats.mintRefusals += 1;
      return null;
    }
  }

  /// LLP 0090 D1.1 admission for a presented token: cryptographic
  /// verification, then every identity axis against the served instance and
  /// the subscription being opened, in the local arm's order. Any error
  /// answers with rung 3 under its per-cause code — never a subscribe
  /// failure.
  rqsAdmitResume(presented, fn, facts, args) {
    const tokenWire = presented?.resume?.token;
    const decoded = decodeAndVerifyToken(this.sql, tokenWire, Date.now(), RESUME_TOKEN_MAX_AGE_MS);
    if (decoded.error) return { error: decoded.error };
    const body = decoded.body;
    if (body.app !== appMeta.name) return { error: rqsRefusal.APP_MISMATCH };
    const generation = this.rqsGeneration();
    if (!generation || body.generation !== generation) return { error: rqsRefusal.GENERATION_STALE };
    if (body.versionStream !== this.rqsVersionStream()) return { error: rqsRefusal.STREAM_MISMATCH };
    if (!facts.queryArtifact || body.queryArtifact !== facts.queryArtifact) {
      return { error: rqsRefusal.QUERY_MISMATCH };
    }
    let hashedArgs = null;
    try {
      hashedArgs = rqsArgsHash(args ?? {});
    } catch (_) {
      return { error: rqsRefusal.QUERY_MISMATCH };
    }
    if (body.argsHash !== hashedArgs) return { error: rqsRefusal.QUERY_MISMATCH };
    if (!facts.digestKind) return { error: rqsRefusal.NOT_ELIGIBLE };
    if (
      body.digestKind !== facts.digestKind
      || !body.contentDigest.startsWith(`${facts.digestKind}:`)
    ) {
      return { error: rqsRefusal.DIGEST_KIND_MISMATCH };
    }
    if (body.version > this.currentVersion()) return { error: rqsRefusal.VERSION_IMPLAUSIBLE };
    return { body };
  }

  /// The admission-ladder decision for one subscribe (LLP 0090 D1.3, rungs
  /// 1 & 3 on this arm): fresh token mint, then — for an admitted token —
  /// the rung-1 global no-commit proof (same version AND same content
  /// digest at head). Everything runs under the invocation mutex between
  /// snapshot and registration, so no commit can fall between proof,
  /// registration, and the answer (the atomicity rule).
  ///
  /// Rung-1 table-set proofs (certified dependency summaries) and rung-2
  /// witness delta replay are deliberately deferred on this arm: the
  /// Cloudflare live wire is replace-only (fan-out re-queries and pushes
  /// live_replace; there is no live_delta lane to answer a replay on), so a
  /// version behind head always answers rung 3.
  /// TODO(rqs-rung2-cloudflare): revisit when this arm grows a delta lane —
  /// the witness algebra is already shared via rqs.mjs (LLP 0090 D1.3).
  rqsResumeDecision(fn, args, rows, version, presented) {
    const facts = this.rqsFunctionFacts(fn);
    const resume = this.rqsMintResume(facts, args, version, rows);
    if (!presented) return { resume, currentAsOf: false, refusalCode: null };
    this.rqsStats.attempted += 1;
    const admitted = this.rqsAdmitResume(presented, fn, facts, args);
    if (admitted.error) {
      this.rqsStats.freshReplaceAnswers += 1;
      return { resume, currentAsOf: false, refusalCode: this.rqsCountRefusal(admitted.error) };
    }
    const body = admitted.body;
    if (
      resume !== null
      && body.version === version
      && body.contentDigest === resume.meta.contentDigest
    ) {
      this.rqsStats.currentAsOfAnswers += 1;
      return { resume, currentAsOf: true, refusalCode: null };
    }
    // Same version but a different digest would mean the result is not a
    // pure function of (state, args); it and every behind-head token take
    // rung 3 (fresh replace) on this arm.
    this.rqsStats.freshReplaceAnswers += 1;
    return { resume, currentAsOf: false, refusalCode: null };
  }

  /// POST /app/bundle — read mode (LLP 0092 §0D.1/§0D.5). The coordinator
  /// DO's single-threaded execution under the invocation mutex is the
  /// serialization cut; eligible entries evaluate natively (HostPlan subset,
  /// no awaits), so every snapshot and every minted token share one commit
  /// version by construction.
  ///
  /// Register mode is deferred on this arm: the pending-registration owner
  /// of the LLP 0031 amendment needs a credentialed caller class
  /// (sender-key thumbprint + replay epoch) that the Cloudflare connection
  /// grant machinery does not carry yet, so EVERY register request — this
  /// arm has no credentialed bundle callers at all — refuses
  /// SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL and the client retries in
  /// read mode (never a silent mode substitution).
  /// TODO(rqs-register-cloudflare): land with the LLP 0077-class credential
  /// story for this arm (LLP 0092 §0D.3).
  appBundle(payload) {
    // Closed ErrorResponse on this kit route (LLP 0094 §0C.6 governance):
    // no top-level ok marker; the SNAPBACK_BUNDLE_* family classifies as
    // "realtime" in wire-diagnostic.js, preserving the served subsystem.
    const failure = (status, code, message) => kitError(status, code, message);
    const mode = payload.mode === undefined ? 'read' : payload.mode;
    if (mode !== 'read' && mode !== 'register') {
      return failure(400, 'SNAPBACK_BUNDLE_MODE_INVALID', 'mode must be "read" or "register"');
    }
    if (mode === 'read' && payload.idempotencyKey !== undefined) {
      return failure(400, 'SNAPBACK_BUNDLE_MODE_INVALID', 'idempotencyKey is register-mode only');
    }
    if (mode === 'register') {
      return failure(
        403,
        'SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL',
        'register mode requires a credentialed caller; this arm serves read mode only — retry in read mode'
      );
    }
    // Step-2 interim anonymous rate posture: one shared anonymous bucket
    // (per-client-address keying is OQ-A; the gateway Channel A seam applies
    // its own address-keyed degrade budget).
    const nowMs = Date.now();
    while (this.rqsBundleRateWindow.length > 0 && nowMs - this.rqsBundleRateWindow[0] >= 60_000) {
      this.rqsBundleRateWindow.shift();
    }
    if (this.rqsBundleRateWindow.length >= BUNDLE_RATE_PER_MINUTE) {
      return failure(429, 'SNAPBACK_BUNDLE_RATE_LIMITED', 'anonymous bundle request rate exceeded');
    }
    this.rqsBundleRateWindow.push(nowMs);
    const manifest = this.rqsRoutes();
    const entry = manifest?.routes.find((candidate) => candidate.route === payload.route) || null;
    if (!entry) {
      return failure(404, 'SNAPBACK_BUNDLE_ROUTE_UNKNOWN', 'route pattern is absent from the served route manifest');
    }
    // Anonymous read admission re-checks the compiled publicInline facts,
    // never the route-manifest author's word (LLP 0090 Authorization scope).
    const specs = entry.queries.map((spec) => ({
      spec,
      fn: this.functionByName(spec.function),
    }));
    if (specs.some(({ fn }) => (
      !fn
      || fn.authRequirement !== 'public'
      || !this.rqsFunctionFacts(fn).publicInline
    ))) {
      return failure(
        403,
        'SNAPBACK_BUNDLE_NOT_PUBLIC',
        'route names a query that is not explicitly public and publicInline',
      );
    }
    const params = payload.params;
    if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params)
      || Object.values(params).some((value) => typeof value !== 'string'))) {
      return failure(400, 'SNAPBACK_BUNDLE_PARAMS_INVALID', 'params must be an object of strings');
    }
    if (this.env.SNAPBACK_TESTING === '1' && this.env.SNAPBACK_TEST_BUNDLE_FAIL === '1') {
      return failure(500, 'SNAPBACK_BUNDLE_QUERY_FAILED', 'injected bundle evaluation failure');
    }
    const started = Date.now();
    const commitVersion = this.currentVersion();
    const generation = this.rqsGeneration();
    const versionStream = this.rqsVersionStream();
    const entries = [];
    let totalRows = 0;
    let totalBytes = 0;
    for (const { spec, fn } of specs) {
      const substituted = substituteParamsV1(
        spec.args || {},
        params || {},
        functionRouteArgTypes(fn, APP_SCHEMA_TABLES),
        functionRouteNestedArgTypes(fn)
      );
      if (substituted.error) {
        return failure(400, 'SNAPBACK_BUNDLE_PARAMS_INVALID', substituted.error);
      }
      const plan = hostPlanQuery(fn);
      if (!plan) {
        // publicInline entails the HostPlan subset on this arm, so this is
        // unreachable; fail atomically if it ever is not.
        return failure(500, 'SNAPBACK_BUNDLE_QUERY_FAILED', `${fn.name} is not natively evaluable`);
      }
      let rows;
      try {
        rows = this.evaluateHostPlanRows(plan, substituted.args);
      } catch (_) {
        return failure(500, 'SNAPBACK_BUNDLE_QUERY_FAILED', `evaluating ${fn.name} failed`);
      }
      totalRows += rows.length;
      if (totalRows > BUNDLE_LIMIT_ROWS) {
        return failure(413, 'SNAPBACK_BUNDLE_LIMIT_ROWS', `bundles are limited to ${BUNDLE_LIMIT_ROWS} rows`);
      }
      try {
        totalBytes += UTF8_ENCODER.encode(JSON.stringify(rows)).byteLength;
      } catch (_) {
        return failure(500, 'SNAPBACK_BUNDLE_QUERY_FAILED', `serializing ${fn.name} rows failed`);
      }
      if (totalBytes > BUNDLE_LIMIT_BYTES) {
        return failure(413, 'SNAPBACK_BUNDLE_LIMIT_BYTES', `bundles are limited to ${BUNDLE_LIMIT_BYTES} serialized row bytes`);
      }
      const facts = this.rqsFunctionFacts(fn);
      entries.push({
        function: fn.name,
        args: substituted.args,
        rows,
        // Present iff rqsEligible; null otherwise, both modes (§0D.1's
        // closed per-entry union).
        resume: this.rqsMintResume(facts, substituted.args, commitVersion, rows),
      });
    }
    if (Date.now() - started > BUNDLE_LIMIT_TIME_MS) {
      return failure(413, 'SNAPBACK_BUNDLE_LIMIT_TIME', `bundle evaluation exceeded ${BUNDLE_LIMIT_TIME_MS} ms`);
    }
    return json(200, { commitVersion, generation, versionStream, entries });
  }

  // --- HTTP + WebSocket routing ------------------------------------------

  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      return await this.route(request);
    } catch (error) {
      // A thrown coded refusal (e.g. capability admission at function
      // resolution) surfaces as a typed diagnostic, never a bare 500. Kit
      // routes emit the versioned ErrorResponse (LLP 0094 §0C.7 governance);
      // proof/system lanes keep the top-level ok marker.
      if (error && typeof error.snapbackCode === 'string') {
        const status = error.snapbackCode === 'SNAPBACK_CAPABILITY_UNSUPPORTED' ? 503 : 400;
        const message = String(error.message || 'coded refusal');
        if (KIT_ENVELOPE_ROUTE.test(path)) {
          return kitError(status, error.snapbackCode, message, error.snapbackDetails ?? null);
        }
        return json(status, {
          ok: false,
          diagnostic: wireDiagnostic(error.snapbackCode, message),
        });
      }
      const failure = classifyPlatformError(error, { maxRowBytes: MAX_ROW_BYTES });
      if (failure) return platformFailureResponse(path, failure);
      throw error;
    }
  }

  async route(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const startupRefusal = this.servablePrecondition();

    // A deployment/state mismatch refuses the data plane (fail closed) but
    // leaves /health for diagnosis, app/reset for recovery, and config/status
    // for operator config diagnosis (deployment config, not app data).
    // System paths live under /_snapback/* (LLP 0031 invariant; the hosted
    // migration is LLP 0094 §0A.3).
    if (
      startupRefusal &&
      path !== '/health' &&
      path !== '/_snapback/api/app/reset' &&
      path !== '/_snapback/test/corrupt-meta' &&
      path !== '/_snapback/test/schema-hardening' &&
      path !== '/_snapback/test/connection-state' &&
      path !== '/_snapback/test/socket-limit-upgrade' &&
      path !== '/_snapback/api/config/status' &&
      path !== '/_snapback/api/debug/network-profile'
    ) {
      // Kit routes carry the versioned ErrorResponse; the proof/system lanes
      // keep the pinned {ok:false, code, message, details} refusal shape.
      if (KIT_ENVELOPE_ROUTE.test(path)) {
        return kitError(409, startupRefusal.code, startupRefusal.message, startupRefusal.details ?? null);
      }
      return json(409, startupRefusal);
    }
    if (path === '/_snapback/api/config/status') {
      return this.adminReadGated(request, () => this.configStatus());
    }
    if (path === '/_snapback/api/debug/network-profile') {
      if (request.method === 'GET') {
        return this.adminReadGated(request, () => json(200, this.networkProfiles.active()));
      }
      return this.adminGated(request, () => this.withJsonValue(request, (selection) => {
        try {
          return json(200, this.networkProfiles.activate(parseNetworkProfile(selection), 'api'));
        } catch (error) {
          return this.networkProfileErrorResponse(error);
        }
      }), 'PUT');
    }
    if (path === '/_snapback/api/cron/status') {
      return this.cronStatus(request);
    }
    // Admin-gated manual run trigger on the existing SNAPBACK_ADMIN_TOKEN
    // POST surface (LLP 0049 §Warm Polling / ENG-23587) — never a public
    // run-now route. Manual runs are ordinary one-shot actions: they neither
    // consume a scheduled slot nor allocate recoverable claim/replay rows.
    if (path === '/_snapback/api/cron/run') {
      return this.adminGated(request, () => this.withJsonObject(request, async (payload) => {
        const job = this.alarmJobs().find((entry) => entry.name === String(payload.job || ''));
        if (!job) {
          return json(404, { ok: false, code: 'SNAPBACK_CRON_JOB_UNKNOWN', message: `no alarm job ${payload.job}` });
        }
        const outcome = await this.runCronJob(job, 'manual', Date.now());
        return json(200, { ok: true, ...outcome });
      }));
    }
    if (path === '/_snapback/host-call') {
      return this.serveHostCall(request);
    }
    if (path === '/health') {
      if (startupRefusal) {
        return json(409, {
          ...startupRefusal,
          version: this.healthVersion(),
          // Deployment verification must still be able to distinguish a
          // fully bound new version from a stripped bootstrap version while
          // the data plane is correctly refusing stale persistent state.
          bindings: {
            handler: Boolean(this.env.HANDLER),
            actionHandler: Boolean(this.env.ACTION_HANDLER),
          },
          workerVersion: workerVersionMetadata(this.env),
          networkProfile: this.networkProfiles.active(),
        });
      }
      return json(200, {
        ok: true,
        version: this.currentVersion(),
        schemaHash: deploymentIdentity.schemaHash,
        bundleHash: deploymentIdentity.bundleHash,
        clientArtifactIdentity: { schemaHash: APP_SCHEMA_HASH, bundleHash: APP_BUNDLE_HASH },
        objectBoot: this.bootMarker,
        // Deploy-probe surface (ENG-23732): a live gateway serving the
        // bootstrap pass (services stripped) reports handler:false here, so
        // deploy.sh can detect it instead of every query 500ing later.
        bindings: {
          handler: Boolean(this.env.HANDLER),
          actionHandler: Boolean(this.env.ACTION_HANDLER),
        },
        workerVersion: workerVersionMetadata(this.env),
        networkProfile: this.networkProfiles.active(),
      });
    }
    if (path === '/_snapback/api/app/reset') {
      // Destructive admin surface: token-gated and POST-only (ENG-23587),
      // and under the invocation mutex — a reset interleaving with an
      // in-flight mutation would let pre-reset buffered writes commit into
      // the freshly reset store (ENG-23575's rationale applies here too).
      return this.adminGated(request, () =>
        this.runExclusive(async () => {
          try {
            return await this.reset();
          } catch (error) {
            return json(500, {
              ok: false,
              code: (error && error.snapbackCode) || 'SNAPBACK_RESET_FAILED',
              message: 'the atomic reset failed; the previous state was preserved',
              ...(this.env.SNAPBACK_TESTING === '1'
                ? { details: { cause: String((error && error.message) || error) } }
                : {}),
            });
          }
        })
      );
    }
    if (path === '/_snapback/test/corrupt-meta') {
      return this.testingGated(request, () =>
        this.withJsonObject(request, (payload) => this.corruptMetaForTest(payload))
      );
    }
    // Testing-only action invocation (LLP 0049 Phase 1): exercises the
    // action grant path — descriptor construction, fail-closed handles,
    // MISSING/UNDECLARED codes — before Phase 2 lands the public action
    // route with host-mediated egress. Never available without
    // SNAPBACK_TESTING=1; the capability manifest keeps outbound_actions as
    // a declared gap.
    if (path === '/_snapback/test/action') {
      return this.testingGated(request, () => this.withJsonObject(request, async (payload) => {
        const outcome = await this.executeAction(payload.name, payload.args || {}, 'test');
        if (!outcome.ok) return json(200, { ok: false, code: outcome.diagnostic.code, message: outcome.diagnostic.message });
        return json(200, { ok: true, result: outcome.result });
      }));
    }
    // Testing-only alarm trigger: fires the dispatcher exactly as a DO alarm
    // wakeup would, so the Miniflare acceptance can exercise duplicate-slot
    // claims and no-demand early-outs deterministically.
    if (path === '/_snapback/test/alarm') {
      return this.testingGated(request, async () => {
        await this.alarm();
        return json(200, { fired: true });
      });
    }
    if (path === '/_snapback/test/run-cron') {
      return this.testingGated(request, () => this.withJsonObject(request, async (payload) => {
        const job = this.alarmJobs().find((entry) => entry.name === String(payload.job || 'warmPoll'));
        if (!job) return json(404, { ok: false, code: 'SNAPBACK_CRON_JOB_UNKNOWN' });
        // ENG-24365 test seam: cron functions are deploy-time declarations,
        // so the exhaustive function-kind matrix needs a testing-only way to
        // substitute the action target while retaining the real cron runner.
        // The enclosing testingGated boundary makes this unavailable on a
        // production deployment.
        let selectedJob = typeof payload.actionOverride === 'string'
          ? { ...job, action: payload.actionOverride }
          : job;
        if (typeof payload.rawErrorOverride === 'string') {
          selectedJob = { ...selectedJob, testThrowMessage: payload.rawErrorOverride };
        }
        const trigger = payload.trigger === 'scheduled' ? 'scheduled' : 'manual';
        const scheduledAtMs = Number.isSafeInteger(payload.scheduledAtMs) && payload.scheduledAtMs >= 0
          ? payload.scheduledAtMs
          : Date.now();
        const outcome = await this.runCronJob(selectedJob, trigger, scheduledAtMs);
        return json(200, { ok: true, ...outcome });
      }, { allowEmpty: true }));
    }
    if (path === '/_snapback/test/cron-claims') {
      return this.testingGated(request, () => {
        const claims = [...this.sql.exec('SELECT * FROM _snapback_cron_claims ORDER BY scheduled_at_ms, idempotency_key')];
        let mutationResults = 0;
        for (const record of this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_action_mutation_results')) {
          mutationResults = Number(record.count);
        }
        const cronState = [...this.sql.exec('SELECT * FROM _snapback_cron_state ORDER BY job_name')];
        return json(200, { claims, mutationResults, cronState });
      });
    }
    if (path === '/_snapback/test/migrate-legacy-cron-diagnostic') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        const job = this.alarmJobs()[0];
        if (!job) return json(404, { ok: false, code: 'SNAPBACK_TEST_CRON_JOB_MISSING' });
        this.writeCronState(job.name, {
          last_run_id: crypto.randomUUID(),
          last_scheduled_at_ms: Date.now(),
          last_trigger: 'scheduled',
          last_outcome: 'failed',
          last_duration_ms: 1,
          last_error_code: payload.errorCode ?? null,
          last_error: String(payload.error ?? ''),
          last_finished_at_ms: Date.now(),
        });
        this.migrateCronDiagnostics();
        return json(200, { ok: true, state: this.readCronState(job.name) });
      }));
    }
    if (path === '/_snapback/test/fanout-diagnostics') {
      return this.testingGated(request, () => json(200, this.fanOutDiagnostics()));
    }
    // @ref LLP 0028#scheduler-state-and-run-ledger — deterministic test
    // evidence must cross the durable nominal-state and DO-alarm seam, not
    // stop at the pure next-slot arithmetic helper.
    if (path === '/_snapback/test/cron-nominal-reconciliation') {
      return this.testingGated(request, () =>
        this.withJsonObject(request, (payload) => this.cronNominalReconciliationForTest(payload))
      );
    }
    if (path === '/_snapback/test/expire-cron-claims') {
      return this.testingGated(request, () => {
        this.sql.exec("UPDATE _snapback_cron_claims SET lease_expires_at_ms = 0 WHERE state = 'claimed'");
        return json(200, { expired: true });
      });
    }
    // @ref LLP 0028#scheduler-state-and-run-ledger — retention may remove
    // terminal claims and their replay rows, never a stale lease that still
    // represents recoverable work. Advance only the pruning clock so the
    // acceptance can prove both sides without a seven-day sleep.
    if (path === '/_snapback/test/prune-cron-claims') {
      return this.testingGated(request, () => {
        const simulatedNowMs = Date.now() + CRON_CLAIM_RETENTION_MS + 1_000;
        this.pruneCronClaims(simulatedNowMs);
        return json(200, { pruned: true, simulatedNowMs });
      });
    }
    if (path === '/_snapback/test/storage-layout') {
      return this.testingGated(request, () => json(200, this.storageLayoutForTest()));
    }
    if (path === '/_snapback/test/schema-hardening') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => this.schemaHardeningForTest(payload)));
    }
    if (path === '/_snapback/test/connection-state') {
      return this.testingGated(request, () => json(200, {
        connections: [...this.sql.exec('SELECT connection_id, opened_at_ms, socket_session_id FROM _snapback_connections ORDER BY connection_id')],
        subscriptions: [...this.sql.exec(
          `SELECT subscription_id, connection_id, socket_session_id, function_name, args_json
           FROM _snapback_subscriptions ORDER BY subscription_id`,
        )],
        acceptedSocketCount: this.ctx.getWebSockets().length,
      }));
    }
    if (path === '/_snapback/test/socket-limit-upgrade') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        const requested = {
          acceptedSockets: Number(payload.acceptedSockets),
          legacyProofSockets: Number(payload.legacyProofSockets),
          socketsPerConnection: Number(payload.socketsPerConnection),
        };
        for (const [key, value] of Object.entries(requested)) {
          if (!Number.isSafeInteger(value) || value <= 0 || value > SUBSCRIPTION_TEST_CEILINGS[key]) {
            return json(400, { ok: false, code: 'SNAPBACK_TEST_SOCKET_LIMIT_INVALID', key });
          }
        }
        this.testSocketLimitOverrides = requested;
        this.socketLimitError = this.reconcileAcceptedSocketBounds();
        return json(200, {
          ok: this.socketLimitError === null,
          socketLimitError: this.socketLimitError,
          acceptedSocketCount: this.ctx.getWebSockets().length,
        });
      }));
    }
    if (path === '/_snapback/test/subscription-linearization') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        const functionName = String(
          payload.functionName || functions.find((fn) => fn.kind === 'LiveQuery')?.name || 'missing'
        );
        const candidate = {
          connectionId: 'linearization-candidate',
          functionName,
          argsJson: canonicalJson({ boardId: 'candidate' }),
        };
        const stagedAdmission = this.subscriptionAdmission(candidate);
        if (!stagedAdmission.ok) {
          return json(409, { ok: false, stage: 'admission', stagedAdmission });
        }
        this.sql.exec(
          `INSERT INTO _snapback_subscriptions
             (subscription_id, connection_id, function_name, args_json, socket_session_id)
           VALUES ('linearization-filler', 'linearization-filler', ?, ?, NULL)`,
          functionName,
          canonicalJson({ boardId: 'filler' })
        );
        const persisted = this.persistSubscription(candidate);
        const rows = [...this.sql.exec(
          `SELECT subscription_id FROM _snapback_subscriptions
           WHERE connection_id IN ('linearization-candidate', 'linearization-filler')
           ORDER BY subscription_id`
        )].map((record) => String(record.subscription_id));
        return json(200, { ok: true, stagedAdmission, persisted, rows });
      }, { allowEmpty: true }));
    }
    if (path === '/_snapback/test/expire-connections') {
      return this.testingGated(request, async () => {
        this.sql.exec('UPDATE _snapback_connections SET opened_at_ms = 0 WHERE socket_session_id IS NULL');
        const reaped = this.reapExpiredConnections();
        await this.reconcileCronActivation();
        return json(200, { reaped, remaining: this.connectionCount() });
      });
    }
    if (path === '/_snapback/test/age-connections') {
      return this.testingGated(request, () => {
        this.sql.exec('UPDATE _snapback_connections SET opened_at_ms = 0 WHERE socket_session_id IS NULL');
        return json(200, { aged: true });
      });
    }
    if (path === '/_snapback/test/index-plan') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => this.indexPlanForTest(payload)));
    }
    if (path === '/_snapback/test/subscription-migration') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        if (payload.forceLegacy !== false) {
          this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION - 1));
        }
        this.testSubscriptionMigrationFailureAt = payload.failAt || null;
        let error = null;
        try {
          this.migrateSubscriptionsSchema();
        } catch (caught) {
          error = {
            code: caught.snapbackCode || 'SNAPBACK_TEST_SUBSCRIPTION_MIGRATION_FAILED',
            message: String(caught.message || caught),
          };
        } finally {
          this.testSubscriptionMigrationFailureAt = null;
        }
        return json(200, { ok: error === null, error, layout: this.storageLayoutForTest() });
      }));
    }
    // Testing-only payload echo: the exact secretsJson the coordinator would
    // attach for a function — the descriptors-only fact is asserted by test,
    // not by convention (LLP 0049 Phase 1 exit evidence).
    if (path === '/_snapback/test/secrets-payload') {
      return this.testingGated(request, () => this.withJsonObject(request, async (payload) => {
        const fn = this.functionByName(payload.name);
        if (!fn) return json(404, { error: `no function ${payload.name}` });
        const mode = payload.mode || (fn.kind === 'Action' ? 'action' : 'query');
        const secretsJson = mode === 'action' ? this.buildActionGrantsJson(fn, { advance: false }) : null;
        return json(200, { name: fn.name, mode, secretsJson });
      }));
    }
    // RQS testing surfaces (rollout step 4 acceptance): mint a genuinely
    // MAC'd token with overridden identity fields (negative admission
    // fixtures — stale generation, rotated stream, expired issuedAt), and a
    // bounded stats/facts projection.
    if (path === '/_snapback/test/rqs-mint') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => this.runExclusive(async () => {
        const fn = this.functionByName(String(payload.function || ''));
        if (!fn) return json(404, { error: `no function ${payload.function}` });
        const args = (payload && payload.args) || {};
        const result = await this.invokeHandler(fn.name, 'query', args);
        if (!result.ok) return json(400, { error: result.code || 'query failed' });
        const facts = this.rqsFunctionFacts(fn);
        const version = result.observedVersion ?? this.currentVersion();
        const overrides = (payload && payload.overrides) || {};
        const now = Date.now();
        let contentDigest;
        let digestKind = overrides.digestKind || facts.digestKind || 'mset1';
        try {
          contentDigest = overrides.contentDigest || digestOfRows(digestKind, result.value);
        } catch (_) {
          return json(400, { error: 'rows are not digestable' });
        }
        let hashedArgs;
        try {
          hashedArgs = overrides.argsHash || rqsArgsHash(args);
        } catch (_) {
          return json(400, { error: 'args are not canonicalizable' });
        }
        const body = {
          app: overrides.app || appMeta.name,
          generation: overrides.generation || this.rqsGeneration() || 'gen1:unavailable',
          versionStream: overrides.versionStream || this.rqsVersionStream(),
          version: Number.isSafeInteger(overrides.version) ? overrides.version : version,
          queryArtifact: overrides.queryArtifact || facts.queryArtifact || 'sha256:unavailable',
          argsHash: hashedArgs,
          digestKind,
          contentDigest,
          issuedAt: Number.isSafeInteger(overrides.issuedAt) ? overrides.issuedAt : now,
        };
        const key = activeResumeKey(this.sql, now);
        return json(200, { token: mintTokenWire(key.secret, key.keyId, body), body });
      })));
    }
    if (path === '/_snapback/test/rqs-stats') {
      return this.testingGated(request, () => {
        this.rqsRoutes();
        let keyCount = 0;
        try {
          for (const record of this.sql.exec(`SELECT COUNT(*) AS count FROM _snapback_rqs_keys`)) {
            keyCount = Number(record.count);
          }
        } catch (_) {}
        return json(200, {
          stats: this.rqsStats,
          generation: this.rqsGeneration() || null,
          versionStream: this.rqsVersionStream(),
          keyCount,
          routesError: this.rqsRoutesError || null,
        });
      });
    }
    // The RQS bundle endpoint (LLP 0092 §0D.1; forwarded by the gateway
    // like the other app-data JSON routes). Read mode only on this arm —
    // see appBundle for the register-mode deferral.
    if (path === '/app/bundle') {
      return this.withJsonObject(request, (payload) => this.runExclusive(() => this.appBundle(payload)), KIT_PARSE);
    }
    if (path === '/query') {
      return this.withProfiledJsonObject(
        request,
        'queryResponse',
        async (payload) => {
          const authority = await this.dataPlaneAuthority(
            request,
            payload,
            this.functionByName(payload.name),
          );
          if (authority.denied) return authority.denied;
          return this.runExclusive(() => this.handleQuery(payload, authority));
        },
      );
    }
    if (path === '/mutation') {
      return this.withProfiledJsonObject(
        request,
        'mutationAck',
        async (payload) => {
          const authority = await this.dataPlaneAuthority(
            request,
            payload,
            this.functionByName(payload.name),
          );
          if (authority.denied) return authority.denied;
          return this.runExclusive(() => this.handleMutation(payload, authority));
        },
      );
    }
    if (path === '/live/stream') {
      return this.acceptLiveSocket(request);
    }
    // --- kit wire protocol (LLP 0049 Phase 0) -----------------------------
    // The generated Contract surface speaks the local server's protocol
    // through demos/_kit/client.mjs; these routes are that protocol's
    // Cloudflare projection, so the browser surface runs on generated
    // bindings with no hand-written data path (§Realtime And Browser
    // Surface). Proof-protocol routes above stay untouched — they are
    // LLP 0040's pinned regression surface.
    {
      const kitQuery = path.match(/^\/query\/([A-Za-z0-9_-]+)$/);
      if (kitQuery) {
        return this.withProfiledJsonObject(
          request,
          'queryResponse',
          async (payload) => {
            const authority = await this.dataPlaneAuthority(
              request,
              payload,
              this.functionByName(kitQuery[1]),
              { kit: true },
            );
            if (authority.denied) return authority.denied;
            return this.runExclusive(() => this.kitQuery(kitQuery[1], payload, authority));
          },
          KIT_PARSE,
        );
      }
      const kitMutation = path.match(/^\/mutation\/([A-Za-z0-9_-]+)$/);
      if (kitMutation) {
        return this.withProfiledJsonObject(
          request,
          'mutationAck',
          async (payload) => {
            const authority = await this.dataPlaneAuthority(
              request,
              payload,
              this.functionByName(kitMutation[1]),
              { kit: true },
            );
            if (authority.denied) return authority.denied;
            return this.runExclusive(() => this.kitMutation(kitMutation[1], payload, authority));
          },
          KIT_PARSE,
        );
      }
      // The generated client.action transport (LLP 0049 Phase 2). NOT wrapped
      // in runExclusive: executeAction stages under the mutex, runs the
      // handler and its external fetch off it, and reacquires per mutation
      // commit — a slow 511 round-trip must never stall this object's
      // queries, mutations, or live pushes.
      const kitAction = path.match(/^\/action\/([A-Za-z0-9_-]+)$/);
      if (kitAction) {
        // @ref LLP 0167#observation-semantics--what-a-delay-means — action
        //   body/staging refusals are commitless results admitted on the
        //   query-response lane; handler-origin action responses retain the
        //   existing no-action-response-lane behavior.
        return this.withProfiledJsonObject(request, 'queryResponse', async (payload) => {
          const authority = await this.dataPlaneAuthority(
            request,
            payload,
            this.functionByName(kitAction[1]),
            { kit: true },
          );
          if (authority.denied) return authority.denied;
          const outcome = await this.executeAction(
            kitAction[1],
            (payload && payload.args) || {},
            'manual',
            authority,
          );
          // The kind-mismatch refusal is a non-2xx kit-route failure and rides
          // the versioned ErrorResponse; ordinary action outcomes (including
          // failed ones) keep their 200 outcome envelope.
          let response;
          if (outcome.diagnostic?.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH') {
            response = kitError(400, outcome.diagnostic.code, outcome.diagnostic.message, outcome.diagnostic.details ?? null);
          } else {
            response = json(200, outcome);
          }
          return outcome[ACTION_PRE_HANDLER_REFUSAL]
            ? response
            : this.preparedResponse(response);
        }, KIT_PARSE);
      }
      if (path === '/connection/open') {
        return this.withJsonObject(request, (payload) => this.runExclusive(() => this.kitOpenConnection(payload)), KIT_PARSE);
      }
      if (path === '/app/ensure') {
        return this.withJsonObject(request, (payload) => this.runExclusive(() => this.kitEnsureApp(payload)), KIT_PARSE);
      }
      const kitSubscribe = path.match(/^\/live\/([A-Za-z0-9_-]+)\/subscribe$/);
      if (kitSubscribe) {
        return this.withJsonObject(request, async (payload) => {
          const denied = await this.verifyConnection(payload.connection_id, request.headers.get('x-snapback-connection-token'));
          if (denied) return denied;
          return this.releasePrepared(await this.runExclusive(() => this.kitSubscribe(
            kitSubscribe[1],
            payload,
            { callerKey: `connection:${payload.connection_id}`, authProjection: CONNECTION_AUTH_PROJECTION },
          )));
        }, KIT_PARSE);
      }
      const kitUnsubscribe = path.match(/^\/live\/([A-Za-z0-9_-]+)\/unsubscribe$/);
      if (kitUnsubscribe) {
        return this.withJsonObject(request, async (payload) => {
          const denied = await this.verifyConnection(payload.connection_id, request.headers.get('x-snapback-connection-token'));
          if (denied) return denied;
          return this.runExclusive(() => this.kitUnsubscribe(payload));
        }, KIT_PARSE);
      }
      const kitStream = path.match(/^\/live\/([A-Za-z0-9_.-]+)\/stream$/);
      if (kitStream) {
        return this.acceptKitSocket(request, decodeURIComponent(kitStream[1]), url);
      }
      const kitOutbox = path.match(/^\/outbox\/([A-Za-z0-9_.-]+)$/);
      if (kitOutbox) {
        const denied = await this.verifyConnection(
          decodeURIComponent(kitOutbox[1]),
          request.headers.get('x-snapback-connection-token')
        );
        if (denied) return denied;
        // No durable outbox on this target: socket loss recovers through the
        // kit's fresh snapshot-with-subscribe, and the HTTP poll fallback
        // drains empty. Declared in the capability manifest, not silent.
        return json(200, []);
      }
    }
    if (path === '/_snapback/api/object/evict') {
      // CI surrogate for real eviction (LLP 0040 §Acceptance): discard all
      // in-memory state so the next commit must rehydrate from storage.
      // Admin-gated: an open /evict lets any client invalidate a
      // decisive-evidence measurement run (ENG-23587).
      return this.adminGated(request, () =>
        this.runExclusive(() => {
          this.activeInvocations.clear();
          // Match a real DO reconstruction for LLP 0167 runtime selection:
          // eviction/hibernation wake reapplies the deployment env and clears
          // an API override. Durable app/subscription state remains intact.
          this.networkProfiles = new NetworkProfileState(this.env);
          return json(200, { evicted: true });
        })
      );
    }
    return json(404, { error: 'not found' });
  }

  // The shared-secret gate for the destructive admin endpoints, the same
  // pattern /_snapback/host-call uses for its per-invocation token (ENG-23587). Fails
  // closed: no configured token means no admin surface at all.
  async adminGated(request, run, expectedMethod = 'POST') {
    if (request.method !== expectedMethod) {
      return json(405, { ok: false, code: 'SNAPBACK_ADMIN_METHOD_NOT_ALLOWED', message: `admin endpoint requires ${expectedMethod}` });
    }
    const expected = this.env.SNAPBACK_ADMIN_TOKEN;
    if (typeof expected !== 'string' || expected.length === 0) {
      return json(403, {
        ok: false,
        code: 'SNAPBACK_ADMIN_DISABLED',
        message: 'no SNAPBACK_ADMIN_TOKEN is configured; the admin surface is disabled',
      });
    }
    const presented = request.headers.get('x-snapback-admin-token') || '';
    if (!(await constantTimeTokenEqual(expected, presented))) {
      return json(403, { ok: false, code: 'SNAPBACK_ADMIN_TOKEN_INVALID', message: 'missing or invalid admin token' });
    }
    return run();
  }

  async adminReadGated(request, run) {
    if (request.method !== 'GET') {
      return json(405, { ok: false, code: 'SNAPBACK_ADMIN_METHOD_NOT_ALLOWED', message: 'admin reads are GET-only' });
    }
    const expected = this.env.SNAPBACK_ADMIN_TOKEN;
    if (typeof expected !== 'string' || expected.length === 0) {
      return json(403, {
        ok: false,
        code: 'SNAPBACK_ADMIN_DISABLED',
        message: 'no SNAPBACK_ADMIN_TOKEN is configured; the admin surface is disabled',
      });
    }
    const presented = request.headers.get('x-snapback-admin-token') || '';
    if (!(await constantTimeTokenEqual(expected, presented))) {
      return json(403, { ok: false, code: 'SNAPBACK_ADMIN_TOKEN_INVALID', message: 'missing or invalid admin token' });
    }
    return run();
  }

  async hasAdminReadAuthority(request) {
    const expected = this.env.SNAPBACK_ADMIN_TOKEN;
    if (typeof expected !== 'string' || expected.length === 0) return false;
    return constantTimeTokenEqual(expected, request.headers.get('x-snapback-admin-token') || '');
  }

  // @ref LLP 0172#verified-current-behavior — only an explicit `public`
  // declaration is anonymous on this hosted proof. A legacy omission is not
  // treated as permission to expose the operation across a public gateway.
  //
  // A connection grant is an unguessable, expiring request capability, not a
  // user session. It admits the non-public operation but deliberately projects
  // anonymous authority to the handler; the Cloudflare profile still makes no
  // hosted-auth or resolved-user claim.
  async dataPlaneAuthority(request, payload, fn, { kit = false } = {}) {
    const deny = (status, code, message, details = null) => ({
      denied: kit
        ? kitError(status, code, message, details)
        : json(status, { ok: false, code, message, ...(details ? { details } : {}) }),
    });
    const presentedAdmin = request.headers.get('x-snapback-admin-token');
    if (presentedAdmin !== null) {
      const expected = this.env.SNAPBACK_ADMIN_TOKEN;
      if (typeof expected !== 'string' || expected.length === 0) {
        return deny(403, 'SNAPBACK_ADMIN_DISABLED', 'no SNAPBACK_ADMIN_TOKEN is configured');
      }
      if (!(await constantTimeTokenEqual(expected, presentedAdmin))) {
        return deny(403, 'SNAPBACK_ADMIN_TOKEN_INVALID', 'missing or invalid admin token');
      }
      return { callerKey: 'operator', authProjection: OPERATOR_AUTH_PROJECTION };
    }

    const connectionId = payload && typeof payload.connection_id === 'string'
      ? payload.connection_id
      : '';
    const presentedConnection = request.headers.get('x-snapback-connection-token');
    if (connectionId || presentedConnection !== null) {
      const denied = await this.verifyConnection(connectionId, presentedConnection);
      if (denied) return { denied };
      return {
        callerKey: `connection:${connectionId}`,
        authProjection: CONNECTION_AUTH_PROJECTION,
      };
    }

    if (fn && fn.authRequirement === 'public') {
      const address = request.headers.get('cf-connecting-ip') || 'unknown';
      return { callerKey: `address:${address}`, authProjection: ANONYMOUS_AUTH_PROJECTION };
    }
    return deny(
      401,
      'SNAPBACK_AUTH_REQUIRED',
      'this function requires an admin token or a connection grant issued by POST /connection/open',
    );
  }

  testingGated(request, run) {
    if (this.env.SNAPBACK_TESTING !== '1') {
      return json(404, { error: 'not found' });
    }
    if (request.method !== 'POST') {
      return json(405, { ok: false, code: 'SNAPBACK_TEST_METHOD_NOT_ALLOWED', message: 'test endpoints are POST-only' });
    }
    return run();
  }

  async withJsonObject(request, run, options = {}) {
    const parsed = await parseJsonObjectRequest(request, options);
    if (!parsed.ok) return parsed.response;
    return run(parsed.value);
  }

  async withProfiledJsonObject(request, lane, run, options = {}) {
    const parsed = await parseJsonObjectRequest(request, options);
    if (!parsed.ok) {
      return this.releasePrepared(this.prepareResultResponse(parsed.response, lane));
    }
    const result = await run(parsed.value);
    const prepared = result?.preparedNetworkEgress === true
      ? result
      : this.prepareResultResponse(result, lane);
    return this.releasePrepared(prepared);
  }

  async withJsonValue(request, run) {
    const parsed = await parseJsonObjectRequest(request, { allowAny: true });
    if (!parsed.ok) return parsed.response;
    return run(parsed.value);
  }

  async corruptMetaForTest(payload) {
    if (payload.forceAlarmDue === true) {
      const job = this.alarmJobs()[0];
      if (job) this.writeCronState(job.name, { armed: 1, next_nominal_at_ms: Date.now() - 1 });
    }
    this.sql.exec(
      `INSERT INTO _snapback_meta (key, value) VALUES ('schema_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      payload.schemaHash || 'stale-schema'
    );
    this.sql.exec(
      `INSERT INTO _snapback_meta (key, value) VALUES ('bundle_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      payload.bundleHash || deploymentIdentity.bundleHash
    );
    this.sql.exec('UPDATE _snapback_version SET version = 1 WHERE id = 1');
    this.startupError = this.validateDeploymentMetadata();
    if (payload.fireAlarm === true) await this.alarm();
    return json(200, {
      startupError: this.startupError,
      ...(payload.fireAlarm === true ? { alarmAtMs: await this.ctx.storage.getAlarm() } : {}),
    });
  }

  // --- config / secrets backend (LLP 0049 Phase 1, LLP 0036 deploy-time-binding)

  // Mechanical, app-scoped binding name: caltrainFeed on all-aboard maps to
  // SNAPBACK_SECRET_ALL_ABOARD_CALTRAIN_FEED. The binding name is not an app
  // API — app code still asks for ctx.secrets.rotating('caltrainFeed').
  secretBindingName(entryName) {
    const upper = (value) =>
      String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toUpperCase();
    return `SNAPBACK_SECRET_${upper(appMeta.name)}_${upper(entryName)}`;
  }

  // Pool member count for a declared entry, from the gateway Worker's secret
  // bindings (OQ2: the Coordinator's env IS the gateway env). One JSON-array
  // Worker secret per pooled entry (OQ1); a bare string counts as a
  // single-member pool. Never returns values to callers that report state.
  poolMembers(entryName) {
    const raw = this.env[this.secretBindingName(entryName)];
    if (typeof raw !== 'string' || raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((value) => typeof value === 'string' && value.length > 0);
    } catch (_) {
      // Not JSON: treat the raw string as a single-member pool.
    }
    return [raw];
  }

  configGeneration() {
    const raw = this.env.SNAPBACK_CONFIG_GENERATION;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  // The rotation cursor advances once per grant construction (per action
  // invocation that uses the entry) and is applied modulo the CURRENT member
  // count, so pool edits cannot strand it (LLP 0049 OQ1). `advance: false`
  // peeks without consuming — observation surfaces (status, the testing
  // payload echo) must not rotate the pool.
  nextRotationCursor(entryName, { advance = true } = {}) {
    let cursor = 0;
    for (const record of this.sql.exec(
      'SELECT cursor FROM _snapback_config_cursors WHERE entry_name = ?',
      entryName
    )) {
      cursor = Number(record.cursor);
    }
    if (advance) {
      this.sql.exec(
        `INSERT INTO _snapback_config_cursors (entry_name, cursor) VALUES (?, ?)
         ON CONFLICT(entry_name) DO UPDATE SET cursor = excluded.cursor`,
        entryName,
        cursor + 1
      );
    }
    return cursor;
  }

  declaredConfigEntry(entryName) {
    return (appConfig || []).find((entry) => entry.name === entryName) || null;
  }

  // Action-only redacted grant descriptors (LLP 0049 §Config And Secrets):
  // entry names, set/missing state, member count, and fresh opaque capability
  // ids — NEVER values or forgeable rotation cursors. The cursor-to-value
  // authority stays in the invocation-scoped coordinator map; the handler
  // isolate's ctx.secrets builds fail-closed descriptor handles from the
  // opaque ids (descriptorsOnly), and the local values-in-secretsJson shape
  // never ports to this profile.
  buildActionGrants(fn, { advance = true } = {}) {
    // @ref LLP 0036#runtime-exposure-d5-d8 — grants are invocation-scoped
    // opaque capabilities, not forgeable config-entry descriptors.
    const uses = Array.isArray(fn.uses) ? fn.uses : [];
    const entries = {};
    const capabilities = new Map();
    for (const entryName of uses) {
      if (!this.declaredConfigEntry(entryName)) continue;
      const members = this.poolMembers(entryName);
      const rotatingCursor = members.length > 0 ? this.nextRotationCursor(entryName, { advance }) % members.length : 0;
      const firstCapabilityId = `sec_${crypto.randomUUID()}`;
      const rotatingCapabilityId = `sec_${crypto.randomUUID()}`;
      capabilities.set(firstCapabilityId, { entryName, cursor: 0 });
      capabilities.set(rotatingCapabilityId, { entryName, cursor: rotatingCursor });
      entries[entryName] = {
        set: members.length > 0,
        memberCount: members.length,
        firstCapabilityId,
        rotatingCapabilityId,
      };
    }
    return { secretsJson: JSON.stringify({ descriptorsOnly: true, entries }), capabilities };
  }

  buildActionGrantsJson(fn, options = {}) {
    return this.buildActionGrants(fn, options).secretsJson;
  }

  // The value-resolution boundary (Phase 2 host-mediated fetch unwraps
  // through this, and ONLY this): descriptor -> value, coordinator-side.
  resolveSecretValue(entryName, cursor) {
    const members = this.poolMembers(entryName);
    if (members.length === 0) return null;
    const index = Number.isInteger(cursor) ? ((cursor % members.length) + members.length) % members.length : 0;
    return members[index];
  }

  // GET /_snapback/api/config/status — declarations, set/missing state, grant
  // relationships, pool member counts, rotation cursors, the active config
  // generation (the SNAPBACK_CONFIG_GENERATION attestation carrier), and the
  // declaration hash. Values never appear here (asserted by acceptance).
  async configStatus() {
    const declarations = [];
    for (const entry of appConfig || []) {
      const members = this.poolMembers(entry.name);
      let cursor = 0;
      for (const record of this.sql.exec(
        'SELECT cursor FROM _snapback_config_cursors WHERE entry_name = ?',
        entry.name
      )) {
        cursor = Number(record.cursor);
      }
      declarations.push({
        name: entry.name,
        description: entry.description || null,
        required: !!entry.required,
        pool: !!entry.pool,
        binding: this.secretBindingName(entry.name),
        state: members.length > 0 ? 'set' : 'missing',
        poolMembers: members.length,
        rotationCursor: members.length > 0 ? cursor % members.length : 0,
      });
    }
    const grants = {};
    for (const fn of functions) {
      if (fn.testingOnly === true && this.env.SNAPBACK_TESTING !== '1') continue;
      if (fn.kind === 'Action' && Array.isArray(fn.uses) && fn.uses.length > 0) {
        grants[fn.name] = [...fn.uses];
      }
    }
    const declarationText = JSON.stringify(
      (appConfig || []).map((entry) => ({ name: entry.name, required: !!entry.required, pool: !!entry.pool }))
    );
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(declarationText));
    const declarationHash = [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return json(200, {
      backend: 'deploy-time-binding',
      profile: 'cloudflare-do-sqlite-v8',
      generation: this.configGeneration(),
      declarationHash: `sha256:${declarationHash}`,
      // The platform version/deployment identifier is reported when the
      // platform exposes one to the running Worker; the Workers runtime has
      // no ambient self-version API today, so this is honestly null.
      platformVersionId: null,
      declarations,
      grants,
    });
  }

  // --- action execution (LLP 0049 Phase 2) --------------------------------

  // Execute one action: stage under the serialization mutex (the fn/state
  // checks), run the handler OFF it, reacquire per host call — runMutation
  // re-enters through runExclusive, and host fetch rides the un-chained
  // /_snapback/host-call path — with wall-clock watchdog parity to the local
  // SNAPBACK_ACTION_TIMEOUT posture. No Durable Object transaction is ever
  // held across the external fetch: transactionSync appears only inside
  // commit(), which runs under the mutex after the fetch settled.
  async executeAction(name, args, trigger, options = {}) {
    const staged = await this.runExclusive(() => {
      const fn = this.functionByName(name);
      if (!fn) {
        return { error: { code: 'SNAPBACK_ACTION_UNKNOWN', message: `${name} is not an action on this app` } };
      }
      if (fn.kind !== 'Action') {
        return {
          error: {
            code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
            message: `${name} is declared ${fn.kind}, not action`,
            details: { function: name, declaredKind: fn.kind, requestedMode: 'action' },
          },
        };
      }
      const limited = this.claimActionBudget(name, trigger, options.callerKey);
      if (limited) return { error: limited };
      return { fn, appGeneration: this.appGeneration() };
    });
    if (staged.error) {
      return {
        ok: false,
        function: name,
        kind: 'Action',
        diagnostic: staged.error,
        [ACTION_PRE_HANDLER_REFUSAL]: true,
      };
    }
    const timeoutMs = this.actionTimeoutMs();
    const control = {
      abandoned: false,
      code: null,
      message: null,
      host: null,
      abortController: new AbortController(),
      appGeneration: staged.appGeneration,
    };
    let timer = null;
    const watchdog = new Promise((resolve) => {
      timer = setTimeout(
        () => {
          const message = `action ${name} exceeded the ${timeoutMs}ms wall-clock budget; the invocation failed`;
          control.abandoned = true;
          control.code = 'SNAPBACK_ACTION_TIMEOUT';
          control.message = message;
          if (control.host) control.host.abandon(control.code, message);
          control.abortController.abort(control.code);
          resolve({
            ok: false,
            code: 'SNAPBACK_ACTION_TIMEOUT',
            message,
          });
        },
        timeoutMs
      );
    });
    let result;
    try {
      const sanitizedArgs = { ...(args || {}) };
      if (this.env.SNAPBACK_TESTING !== '1') {
        delete sanitizedArgs.pollBudgetMs;
        delete sanitizedArgs.feedUrl;
        delete sanitizedArgs.baseUrl;
        delete sanitizedArgs.timeoutMs;
        delete sanitizedArgs.url;
        delete sanitizedArgs.source;
        sanitizedArgs.trigger = trigger === 'scheduled' ? 'cron' : 'manual';
      }
      result = await Promise.race([
        this.invokeHandler(name, 'action', sanitizedArgs, {
          trigger,
          control,
          jobName: options.jobName || null,
          authProjection: options.authProjection || (
            trigger === 'scheduled' ? SYSTEM_AUTH_PROJECTION : OPERATOR_AUTH_PROJECTION
          ),
          // Only retryable scheduler claims get a durable replay identity.
          // Public/manual actions are single attempts and must not leave an
          // unbounded result ledger behind.
          actionIdempotencyKey: options.idempotencyKey || null,
        }),
        watchdog,
      ]);
    } finally {
      clearTimeout(timer);
    }
    const resetFailure = this.actionGenerationFailure(control);
    if (resetFailure) result = resetFailure;
    if (!result.ok) {
      return {
        ok: false,
        function: name,
        kind: 'Action',
        diagnostic: { code: result.code, message: result.message, ...(result.details ? { details: result.details } : {}) },
      };
    }
    return { ok: true, function: name, kind: 'Action', result: result.value };
  }

  actionTimeoutMs() {
    const raw = Number(this.env.SNAPBACK_ACTION_TIMEOUT_MS);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ACTION_TIMEOUT_MS;
    return Math.min(Math.floor(raw), MAX_ACTION_TIMEOUT_MS);
  }

  actionGenerationFailure(control) {
    if (!control || control.appGeneration === this.appGeneration()) return null;
    const message = 'the app was reset while this action was running; its buffered work was discarded';
    control.abandoned = true;
    control.code = 'SNAPBACK_ACTION_RESET_ABORTED';
    control.message = message;
    if (control.host) control.host.abandon(control.code, message);
    if (!control.abortController.signal.aborted) control.abortController.abort(control.code);
    return { ok: false, code: control.code, message };
  }

  claimActionBudget(name, trigger, callerKey = null) {
    const scheduled = trigger === 'scheduled';
    const configured = Number(
      scheduled
        ? this.env.SNAPBACK_SCHEDULED_ACTION_RATE_LIMIT_PER_MINUTE
        : this.env.SNAPBACK_ACTION_RATE_LIMIT_PER_MINUTE,
    );
    const limit = Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 600) : 60;
    const bucket = scheduled ? 'scheduled-reserve' : String(callerKey || `internal:${trigger}`);
    const nowMs = Date.now();
    const windowMs = 60_000;
    let row = null;
    for (const record of this.sql.exec(
      'SELECT * FROM _snapback_action_limits WHERE action_name = ? AND caller_key = ?',
      name,
      bucket,
    )) row = record;
    const windowStartedAt = row ? Number(row.window_started_at_ms) : nowMs;
    const inWindow = nowMs - windowStartedAt >= 0 && nowMs - windowStartedAt < windowMs;
    const count = inWindow && row ? Number(row.count) : 0;
    if (count >= limit) {
      return {
        code: 'SNAPBACK_ACTION_RATE_LIMITED',
        message: `action ${name} exceeded the ${limit}-per-minute ${scheduled ? 'scheduled reserve' : 'caller'} budget`,
        details: { retryable: true, retryAfterMs: Math.max(1, windowMs - (nowMs - windowStartedAt)) },
      };
    }
    this.sql.exec(
      `INSERT INTO _snapback_action_limits (action_name, caller_key, window_started_at_ms, count) VALUES (?, ?, ?, ?)
       ON CONFLICT(action_name, caller_key) DO UPDATE
       SET window_started_at_ms = excluded.window_started_at_ms, count = excluded.count`,
      name,
      bucket,
      inWindow ? windowStartedAt : nowMs,
      count + 1
    );
    return null;
  }

  // The action's durable leg: a FULL nested mutation invocation — handler,
  // commit, fan-out — executed under the invocation mutex (the caller wraps
  // this in runExclusive). Returns the mutation handler's value; a failure
  // carries its code back into the action as a coded error.
  async runMutationForAction(name, args, parentHost = null, replay = null, authProjection = null) {
    const resetFailure = parentHost && this.actionGenerationFailure(parentHost.control);
    if (resetFailure) return resetFailure;
    const fn = this.functionByName(name);
    if (!fn) {
      return { ok: false, code: 'SNAPBACK_ACTION_MUTATION_UNKNOWN', message: `${name} is not a mutation on this app` };
    }
    if (fn.kind !== 'Mutation') {
      return {
        ok: false,
        code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
        message: `${name} is declared ${fn.kind}, not mutation`,
      };
    }
    const argsJson = canonicalJson(args || {});
    if (replay && replay.actionIdempotencyKey != null) {
      const replays = [...this.sql.exec(
        `SELECT mutation_name, args_json, result_json
         FROM _snapback_action_mutation_results
         WHERE action_idempotency_key = ? AND sequence = ?`,
        replay.actionIdempotencyKey,
        replay.sequence
      )];
      for (const record of replays) {
        if (String(record.mutation_name) !== name) {
          return {
            ok: false,
            code: 'SNAPBACK_ACTION_REPLAY_DIVERGED',
            message: `scheduled action replay diverged at mutation ${replay.sequence}`,
          };
        }
        // The retry may have re-fetched fresher bytes and therefore derive
        // different mutation arguments. The stable action key + sequence is
        // the idempotency authority: return the already-committed result and
        // never apply a second write. Keep the original args for diagnosis.
        if (String(record.args_json) !== argsJson) {
          console.warn('snapback scheduled action replay reused prior mutation result with changed args', name, replay.sequence);
        }
        return { ok: true, value: JSON.parse(String(record.result_json)) };
      }
    }
    const result = await this.invokeHandler(name, 'mutation', args, { authProjection });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    // OQ4 proposed ruling, kept leg: this is a deterministic, internal
    // test-only micro-seam for the watchdog/commit race, not an LLP 0167
    // egress profile. It holds a completed nested mutation immediately before
    // its synchronous commit boundary. Preserve its clamp-style seam
    // convention, now under the same 30,000 ms safety ceiling as profiles.
    // Production has no delay; the abandonment recheck below is the rule.
    const testDelayMs = this.env.SNAPBACK_TESTING === '1'
      ? Number(this.env.SNAPBACK_TEST_NESTED_COMMIT_DELAY_MS)
      : 0;
    if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.floor(testDelayMs), 30_000)));
    }
    // This check and commit execute in the same runExclusive critical
    // section with no await between them. If the parent watchdog won while
    // the nested handler was pending, its writes are discarded atomically.
    const abandoned = parentHost && (this.actionGenerationFailure(parentHost.control) || parentHost.abandonedFailure());
    if (abandoned) return abandoned;
    const resultJson = canonicalJson(result.value);
    const commit = this.commit(result.host, replay && replay.actionIdempotencyKey != null
      ? (committed) => {
          this.sql.exec(
            `INSERT INTO _snapback_action_mutation_results
               (action_idempotency_key, sequence, mutation_name, args_json, result_json, commit_version)
             VALUES (?, ?, ?, ?, ?, ?)`,
            replay.actionIdempotencyKey,
            replay.sequence,
            name,
            argsJson,
            resultJson,
            committed.version
          );
        }
      : null);
    const commitEgress = commit.committedAtMs == null
      ? null
      : this.networkProfiles.admitCommit(commit.committedAtMs);
    const preparedFanOut = await this.prepareFanOut(commit, commitEgress);
    return {
      ok: true,
      value: result.value,
      preparedFanOut,
      profiledFanOut: commitEgress !== null,
    };
  }

  // @ref LLP 0076#target-contract — the Cloudflare adapter owns response
  // readers in the trusted coordinator; the stripped action isolate sees
  // only opaque ids and one pull-bounded Uint8Array per host call.
  createActionResponseStreams(control, capabilities) {
    const streams = new Map();
    const closed = new Map();
    // Invocation-wide host-retained byte accounting (LLP 0076 §Surface): the
    // carry-over slices stashed across pulls, summed over every cursor.
    // Kernel/network buffers are excluded by definition; the visible handoff
    // chunk is bounded separately at 16 KiB.
    const scope = { bufferedBytes: 0 };
    return {
      hasOpen: () => streams.size > 0,
      open: (request) => this.openActionResponseStream(request, control, streams, capabilities, scope),
      read: (streamId) => this.readActionResponseStream(streamId, streams, closed, scope),
      cancel: (streamId) => this.cancelActionResponseStream(streamId, streams, closed),
      closeAll: async () => {
        const pending = [...streams.values()].map((stream) => this.closeActionResponseStream(stream));
        streams.clear();
        await Promise.allSettled(pending);
      },
    };
  }

  actionStreamFailure(code, operation, message, details = {}) {
    return {
      ok: false,
      code,
      message,
      details: {
        operation,
        repair: 'guide/backend/actions-and-fetch#stream-a-response',
        ...details,
      },
    };
  }

  async openActionResponseStream(request, control, streams, capabilities, scope) {
    if (streams.size >= ACTION_STREAM_OPEN_MAX) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'open',
        'the action already owns the maximum number of open response streams',
        { limit: ACTION_STREAM_OPEN_MAX, received: 'additional stream' },
      );
    }
    // @ref LLP 0076#settlement-and-retry — the StreamAttemptV1 control plane
    // (lease, terminalizer, durable pre-mark) is not implemented on this
    // target yet. Refusing a presented attempt token fails closed: an author
    // must never believe the late-effect fence holds where it does not.
    if (request.attemptToken != null) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'the stream attempt control plane is not available on this target',
        { expected: 'no attemptToken on this target profile', received: 'a stream attempt token' },
      );
    }
    const urlText = String(request.url || '');
    const destination = admitOutboundDestination(urlText);
    if (!destination.ok) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream destination was refused by the Cloudflare outbound policy',
        { expected: 'a public absolute HTTP(S) destination', received: destination.reason },
      );
    }
    const url = destination.url;
    const method = String(request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream received an unsupported HTTP method',
        { expected: 'GET|HEAD|POST|PUT|PATCH|DELETE', received: 'unsupported method' },
      );
    }
    const headerEntries = Object.entries(request.headers || {});
    if (
      headerEntries.length > 64
      || headerEntries.some(([name, value]) => (
        !name || name.length > 256 || String(value).length > 8192
        || /[\u0000-\u001f\u007f]/.test(name) || /[\r\n]/.test(String(value))
      ))
    ) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream headers exceeded the safe shape',
        { expected: 'at most 64 bounded single-line headers', received: 'invalid header shape' },
      );
    }
    const body = request.body == null ? null : String(request.body);
    if (
      request.idempotencyKey != null
      && (
        String(request.idempotencyKey).length === 0
        || UTF8_ENCODER.encode(String(request.idempotencyKey)).byteLength > 8192
        || /[\r\n]/.test(String(request.idempotencyKey))
      )
    ) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream received an invalid idempotency key',
        { expected: 'a non-empty single-line key <= 8192 bytes', received: 'invalid idempotency key shape' },
      );
    }
    if (body && UTF8_ENCODER.encode(body).byteLength > ACTION_STREAM_TOTAL_BYTES_MAX) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'open',
        'ctx.fetchStream request body exceeded the v1 byte limit',
        { limitBytes: ACTION_STREAM_TOTAL_BYTES_MAX, received: 'oversized body' },
      );
    }
    const headers = Object.fromEntries(headerEntries.map(([name, value]) => [name, String(value)]));
    if (request.idempotencyKey != null && !headerEntries.some(([name]) => name.toLowerCase() === 'idempotency-key')) {
      headers['Idempotency-Key'] = String(request.idempotencyKey);
    }
    // @ref LLP 0036#runtime-exposure-d5-d8 — the same opaque placement seam
    // as ordinary host-mediated fetch (LLP 0049 §Action Egress): descriptors
    // unwrap to values HERE and only here, into the query-param or header the
    // slot names. The opened metadata below returns the handler-authored URL,
    // never the host-substituted one, so no resolved value re-enters the
    // isolate; stream refusal details are static and value-free by shape.
    for (const slot of request.secretSlots || []) {
      const descriptor = slot && slot.secret;
      const capabilityId = descriptor && descriptor.capabilityId;
      const capability = typeof capabilityId === 'string' && capabilities instanceof Map
        ? capabilities.get(capabilityId)
        : null;
      if (!capability) {
        return this.actionStreamFailure(
          'SNAPBACK_ACTION_STREAM_INVALID',
          'open',
          'a stream secret slot carried no resolvable descriptor',
          { expected: 'an invocation-scoped secret descriptor', received: 'unresolvable slot' },
        );
      }
      const value = this.resolveSecretValue(capability.entryName, capability.cursor);
      if (value == null) {
        return this.actionStreamFailure(
          'SNAPBACK_CONFIG_MISSING',
          'open',
          `${capability.entryName} has no value set`,
          { expected: 'a configured secret value', received: 'unset entry' },
        );
      }
      if (slot.placement === 'query-param') {
        url.searchParams.set(String(slot.name), value);
      } else if (slot.placement === 'header') {
        headers[String(slot.name)] = value;
      } else {
        return this.actionStreamFailure(
          'SNAPBACK_ACTION_STREAM_INVALID',
          'open',
          'unsupported stream secret placement',
          { expected: 'query-param|header', received: 'unsupported placement kind' },
        );
      }
    }
    const controller = new AbortController();
    const abortForAction = () => controller.abort(control?.code || 'SNAPBACK_ACTION_TIMEOUT');
    if (control?.abortController?.signal.aborted) abortForAction();
    else control?.abortController?.signal.addEventListener('abort', abortForAction, { once: true });
    const metadataTimer = setTimeout(() => controller.abort('SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT'), ACTION_STREAM_IDLE_MS);
    let response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: body == null ? undefined : body,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (_) {
      clearTimeout(metadataTimer);
      control?.abortController?.signal.removeEventListener('abort', abortForAction);
      const timedOut = controller.signal.aborted && controller.signal.reason === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT';
      // @ref LLP 0076#author-decisions--2026-07-23 — decision 5: safe
      // methods are idempotent by grammar; a bare authored idempotency key
      // no longer confers retry semantics, and this host cannot prove a
      // pre-send failure through fetch(), so every non-safe transport loss
      // stays at the fail-safe ambiguous classification.
      const retrySafe = method === 'GET' || method === 'HEAD';
      return this.actionStreamFailure(
        timedOut
          ? 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT'
          : retrySafe
            ? 'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED'
            : 'SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS',
        'open',
        timedOut
          ? 'the upstream did not produce response metadata within the idle limit'
          : retrySafe
            ? 'the upstream request failed before response metadata was available'
            : 'the non-idempotent upstream request lost transport after initiation',
        { received: 'transport failure', retrySafe },
      );
    }
    clearTimeout(metadataTimer);
    if (isRedirectStatus(response.status)) {
      try { await response.body?.cancel(); } catch (_) {}
      control?.abortController?.signal.removeEventListener('abort', abortForAction);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream refuses upstream redirects on the Cloudflare profile',
        { received: `HTTP ${response.status}` },
      );
    }
    const streamId = crypto.randomUUID();
    let reader = null;
    let byob = false;
    if (response.body) {
      try {
        reader = response.body.getReader({ mode: 'byob' });
        byob = true;
      } catch (_) {
        reader = response.body.getReader();
      }
    }
    const now = Date.now();
    streams.set(streamId, {
      reader,
      byob,
      controller,
      abortForAction,
      actionSignal: control?.abortController?.signal || null,
      openedAt: now,
      lastByteAt: now,
      totalBytes: 0,
      buffered: new Uint8Array(0),
      pulling: false,
      scope,
    });
    const responseHeaders = {};
    let headerCount = 0;
    for (const [name, value] of response.headers.entries()) {
      if (headerCount >= 64) break;
      responseHeaders[name] = String(value).slice(0, 8192);
      headerCount += 1;
    }
    return {
      ok: true,
      value: {
        streamId,
        status: response.status,
        statusText: response.statusText,
        // The handler-authored URL, never the host-substituted one: the
        // latter is a secret-bearing representation even when encoded.
        url: urlText,
        headers: responseHeaders,
      },
    };
  }

  // The pre/post-pull leg of the per-read authority fence on this target
  // (LLP 0076 §Authority and lifecycle): the action-abandonment signal is
  // revalidated before the pull is dispatched and again after bytes arrive,
  // so a terminalization that lands during a blocked pull discards the late
  // bytes rather than handing them to the isolate.
  actionStreamAbandonRefusal(stream, when) {
    if (!stream.actionSignal || !stream.actionSignal.aborted) return null;
    const reason = stream.actionSignal.reason;
    const code = typeof reason === 'string' && reason.startsWith('SNAPBACK_')
      ? reason
      : 'SNAPBACK_ACTION_TIMEOUT';
    return this.actionStreamFailure(
      code,
      'read',
      'the action invocation was terminalized; stream bytes are discarded',
      { received: when },
    );
  }

  async readActionResponseStream(streamId, streams, closed, scope) {
    const stream = streams.get(streamId);
    if (!stream) {
      if (closed.has(streamId)) {
        return {
          ok: true,
          value: { done: true, bytes: [], totalBytes: closed.get(streamId), elapsedMs: 0, deltaMs: 0 },
        };
      }
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'read',
        'the response stream id is unknown to this action invocation',
        { expected: 'an open invocation-local stream', received: 'unknown stream id' },
      );
    }
    const preAbandoned = this.actionStreamAbandonRefusal(stream, 'terminalized before pull');
    if (preAbandoned) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return preAbandoned;
    }
    // One in-flight pull per cursor (LLP 0076 §Surface): the shared bridge
    // reader serializes read(), and the host refuses an overlap structurally.
    if (stream.pulling) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'read',
        'the response stream already has a pull in flight',
        { expected: 'one in-flight pull per cursor', received: 'overlapping pull' },
      );
    }
    const now = Date.now();
    if (now - stream.openedAt >= ACTION_STREAM_WALL_MS) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_TIMEOUT',
        'read',
        'the response stream exceeded its wall-clock limit',
        { limitMs: ACTION_STREAM_WALL_MS, received: 'wall limit elapsed' },
      );
    }
    if (now - stream.lastByteAt >= ACTION_STREAM_IDLE_MS) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT',
        'read',
        'the response stream exceeded its idle limit',
        { limitMs: ACTION_STREAM_IDLE_MS, received: 'idle limit elapsed' },
      );
    }
    if (stream.buffered.byteLength > 0) {
      const deltaMs = Date.now() - stream.lastByteAt;
      const visible = stream.buffered.slice(0, ACTION_STREAM_CHUNK_BYTES_MAX);
      stream.buffered = stream.buffered.slice(visible.byteLength);
      scope.bufferedBytes -= visible.byteLength;
      stream.totalBytes += visible.byteLength;
      stream.lastByteAt = Date.now();
      return this.actionStreamChunk(streamId, stream, visible, streams, closed, deltaMs);
    }
    if (!stream.reader) {
      const elapsedMs = Date.now() - stream.openedAt;
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return { ok: true, value: { done: true, bytes: [], totalBytes: stream.totalBytes, elapsedMs, deltaMs: 0 } };
    }
    const wallRemaining = Math.max(1, ACTION_STREAM_WALL_MS - (Date.now() - stream.openedAt));
    const waitMs = Math.min(ACTION_STREAM_IDLE_MS, wallRemaining);
    let timer;
    const timed = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timeout: true }), waitMs);
    });
    stream.pulling = true;
    let outcome;
    try {
      const reading = (stream.byob
        ? stream.reader.read(new Uint8Array(ACTION_STREAM_CHUNK_BYTES_MAX))
        : stream.reader.read())
        .then((value) => ({ value }), () => ({ failed: true }));
      outcome = await Promise.race([reading, timed]);
    } finally {
      stream.pulling = false;
      clearTimeout(timer);
    }
    if (outcome.timeout) {
      const wallExpired = Date.now() - stream.openedAt >= ACTION_STREAM_WALL_MS;
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        wallExpired ? 'SNAPBACK_ACTION_STREAM_TIMEOUT' : 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT',
        'read',
        wallExpired
          ? 'the response stream exceeded its wall-clock limit'
          : 'the upstream produced no response bytes within the idle limit',
        wallExpired
          ? { limitMs: ACTION_STREAM_WALL_MS, received: 'read timeout' }
          : { limitMs: ACTION_STREAM_IDLE_MS, received: 'read timeout' },
      );
    }
    if (outcome.failed) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED',
        'read',
        'the upstream response stream failed while reading',
        { received: 'transport read failure' },
      );
    }
    // Post-pull revalidation: late bytes from a pull that was blocked across
    // an action terminalization are discarded, never handed to the isolate.
    const postAbandoned = this.actionStreamAbandonRefusal(stream, 'terminalized during pull');
    if (postAbandoned) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return postAbandoned;
    }
    if (outcome.value.done) {
      const elapsedMs = Date.now() - stream.openedAt;
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return { ok: true, value: { done: true, bytes: [], totalBytes: stream.totalBytes, elapsedMs, deltaMs: 0 } };
    }
    const bytes = new Uint8Array(
      outcome.value.value.buffer,
      outcome.value.value.byteOffset,
      outcome.value.value.byteLength,
    );
    if (bytes.byteLength > ACTION_STREAM_BUFFER_BYTES_MAX) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'read',
        'the upstream produced a chunk larger than the v1 buffer ceiling',
        { limitBytes: ACTION_STREAM_BUFFER_BYTES_MAX, received: 'oversized upstream chunk' },
      );
    }
    const deltaMs = Date.now() - stream.lastByteAt;
    const visible = bytes.slice(0, ACTION_STREAM_CHUNK_BYTES_MAX);
    stream.buffered = bytes.slice(visible.byteLength);
    scope.bufferedBytes += stream.buffered.byteLength;
    stream.totalBytes += visible.byteLength;
    stream.lastByteAt = Date.now();
    // Invocation-wide host-retained accounting (LLP 0076 §Surface): the sum
    // of carry-over slices across every cursor stays under the 64 KiB
    // application-visible ceiling; kernel/network buffers are out of scope.
    if (scope.bufferedBytes > ACTION_STREAM_BUFFER_BYTES_MAX) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'read',
        'host-retained stream bytes exceeded the v1 buffered ceiling',
        { limitBytes: ACTION_STREAM_BUFFER_BYTES_MAX, received: 'invocation-wide buffered overflow' },
      );
    }
    return this.actionStreamChunk(streamId, stream, visible, streams, closed, deltaMs);
  }

  async actionStreamChunk(streamId, stream, bytes, streams, closed, deltaMs) {
    if (stream.totalBytes > ACTION_STREAM_TOTAL_BYTES_MAX) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'read',
        'the upstream response exceeded the v1 total-byte limit',
        { limitBytes: ACTION_STREAM_TOTAL_BYTES_MAX, received: 'oversized response' },
      );
    }
    return {
      ok: true,
      value: {
        done: false,
        bytes: Array.from(bytes),
        totalBytes: stream.totalBytes,
        // @ref LLP 0076#author-decisions--2026-07-23 — decision 6: the
        // host-owned monotonic progress clock on every read result.
        elapsedMs: Date.now() - stream.openedAt,
        deltaMs,
      },
    };
  }

  async finishActionResponseStream(streamId, stream, streams, closed) {
    if (stream.scope && stream.buffered) {
      stream.scope.bufferedBytes -= stream.buffered.byteLength;
      stream.buffered = new Uint8Array(0);
    }
    streams.delete(streamId);
    closed.set(streamId, stream.totalBytes);
    await this.closeActionResponseStream(stream);
  }

  async closeActionResponseStream(stream) {
    stream.actionSignal?.removeEventListener('abort', stream.abortForAction);
    try { await stream.reader?.cancel(); } catch (_) {}
    try { stream.controller.abort('SNAPBACK_ACTION_STREAM_CANCELLED'); } catch (_) {}
  }

  async cancelActionResponseStream(streamId, streams, closed) {
    const stream = streams.get(streamId);
    if (stream) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return { ok: true, value: null };
    }
    if (closed.has(streamId)) return { ok: true, value: null };
    return this.actionStreamFailure(
      'SNAPBACK_ACTION_STREAM_INVALID',
      'cancel',
      'the response stream id is unknown to this action invocation',
      { expected: 'an invocation-local stream', received: 'unknown stream id' },
    );
  }

  // The host-mediated fetch boundary (LLP 0049 §Action Egress): descriptors
  // unwrap to values HERE and only here; placement slots cover query-param
  // (511's api_key) and header (directions' Authorization); and every
  // diagnostic that re-enters the isolate — error messages, the final URL,
  // even the upstream body — is redacted first. The coordinator owns the
  // scrub; handler-side redaction remains defense in depth, not the line.
  // @ref LLP 0251#cloudflare-degradation-and-existing-claims — the last host-owned boundary admits the
  // authored destination before placing secret values and refuses redirects.
  // Workers has no DNS-resolution/pinning primitive, so this profile enforces
  // hostname and IP-literal policy only; DNS rebinding remains an explicit
  // residual rather than a claimed multi-tenant SSRF boundary.
  async hostActionFetch(request, capabilities, control) {
    if (control && control.abandoned) {
      return { ok: false, code: control.code || 'SNAPBACK_ACTION_TIMEOUT', message: control.message || 'action abandoned' };
    }
    const urlText = String(request.url || '');
    const destination = admitOutboundDestination(urlText);
    if (!destination.ok) {
      return {
        ok: false,
        code: destination.code,
        message: `host fetch destination refused: ${destination.reason}`,
      };
    }
    const url = destination.url;
    const headers = {};
    for (const [key, value] of Object.entries(request.headers || {})) {
      headers[String(key)] = String(value);
    }
    const resolvedValues = [];
    for (const slot of request.secretSlots || []) {
      const descriptor = slot && slot.secret;
      const capabilityId = descriptor && descriptor.capabilityId;
      const capability = typeof capabilityId === 'string' && capabilities instanceof Map
        ? capabilities.get(capabilityId)
        : null;
      if (!capability) {
        return { ok: false, code: 'SNAPBACK_HOST_FETCH_SLOT_INVALID', message: 'a secret slot carried no descriptor' };
      }
      const value = this.resolveSecretValue(capability.entryName, capability.cursor);
      if (value == null) {
        return { ok: false, code: 'SNAPBACK_CONFIG_MISSING', message: `${capability.entryName} has no value set` };
      }
      resolvedValues.push(value);
      if (slot.placement === 'query-param') {
        url.searchParams.set(String(slot.name), value);
      } else if (slot.placement === 'header') {
        headers[String(slot.name)] = value;
      } else {
        return {
          ok: false,
          code: 'SNAPBACK_HOST_FETCH_SLOT_INVALID',
          message: `unsupported secret placement ${slot.placement}`,
        };
      }
    }
    const redact = (text) => {
      let out = String(text ?? '');
      for (const value of resolvedValues) {
        for (const pattern of secretRedactionPatterns(value)) out = out.replace(pattern, '[redacted]');
      }
      return out;
    };
    const timeoutMs = Math.min(
      Number.isFinite(Number(request.timeoutMs)) && Number(request.timeoutMs) > 0
        ? Number(request.timeoutMs)
        : 15_000,
      this.actionTimeoutMs()
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('SNAPBACK_HOST_FETCH_TIMEOUT'), timeoutMs);
    const abortForAction = () => controller.abort(control && control.code ? control.code : 'SNAPBACK_ACTION_TIMEOUT');
    if (control && control.abortController) {
      if (control.abortController.signal.aborted) abortForAction();
      else control.abortController.signal.addEventListener('abort', abortForAction, { once: true });
    }
    try {
      const response = await fetch(url.toString(), {
        method: String(request.method || 'GET'),
        headers,
        body: request.body == null ? undefined : String(request.body),
        signal: controller.signal,
        redirect: 'manual',
      });
      if (isRedirectStatus(response.status)) {
        try { await response.body?.cancel(); } catch (_) {}
        return {
          ok: false,
          code: 'SNAPBACK_HOST_FETCH_REDIRECT_REFUSED',
          message: `host fetch refused upstream redirect status ${response.status}`,
        };
      }
      const boundedBody = await readBoundedTextStream(response.body, MAX_HOST_RESPONSE_BYTES);
      if (!boundedBody.ok) {
        return {
          ok: false,
          code: boundedBody.code,
          message: boundedBody.message,
        };
      }
      const bodyText = boundedBody.text;
      return {
        ok: true,
        value: {
          status: response.status,
          ok: response.ok,
          // Return the handler-authored URL, never the host-substituted URL.
          // The latter is a secret-bearing representation even when encoded.
          url: urlText,
          bodyText: redact(bodyText),
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: 'SNAPBACK_HOST_FETCH_FAILED',
        message: `host fetch to ${urlText} failed: ${redact((error && error.message) || error)}`,
      };
    } finally {
      clearTimeout(timer);
      if (control && control.abortController) {
        control.abortController.signal.removeEventListener('abort', abortForAction);
      }
    }
  }

  // --- warm polling: demand-armed DO alarm + hardened durable runner ------
  // (LLP 0049 Phase 3 / LLP 0028): subscribe arms the alarm, last-unsubscribe
  // cancels it, so an idle deployment takes ZERO warm-poll wakeups — the
  // ratified supersession of the minute-static-wakeup default. One alarm per
  // object (LLP 0014): alarm() is a dispatcher over every armed job's next
  // nominal time. No setInterval, no always-awake loop; the alarm and the
  // hibernating sockets coexist. No last-subscriber linger window — LLP 0028
  // does not define one, and this implementation does not introduce one.

  alarmJobs() {
    return (appCron || []).filter(
      (job) => job.enabled !== false && job.targetWakeup && job.targetWakeup.kind === 'DynamicAlarm'
    );
  }

  jobIntervalMs(job) {
    // Testing-only cadence override so the Miniflare acceptance can observe
    // scheduled ticks without real 60s waits; never read on real deploys.
    if (this.env.SNAPBACK_TESTING === '1') {
      const override = Number(this.env.SNAPBACK_CRON_INTERVAL_OVERRIDE_MS);
      if (Number.isFinite(override) && override > 0) return override;
    }
    return Number(job.schedule && job.schedule.everyMs) || 60_000;
  }

  cronDemand(job) {
    const whileLive = (job.activation && job.activation.whileLive) || [];
    if (job.activation && job.activation.kind !== 'WhileLive') return 1;
    if (whileLive.length === 0) return 0;
    const placeholders = whileLive.map(() => '?').join(', ');
    const counts = [...this.sql.exec(
      `SELECT COUNT(*) AS count
       FROM _snapback_subscriptions s
       LEFT JOIN _snapback_connections c ON c.connection_id = s.connection_id
       WHERE s.function_name IN (${placeholders})
         AND (
           (c.connection_id IS NULL AND s.socket_session_id IS NULL) OR
           (s.socket_session_id IS NOT NULL AND s.socket_session_id = c.socket_session_id)
         )`,
      ...whileLive
    )];
    return counts.length === 0 ? 0 : Number(counts[0].count);
  }

  readCronState(jobName) {
    const records = [...this.sql.exec('SELECT * FROM _snapback_cron_state WHERE job_name = ?', jobName)];
    return records.length === 0 ? null : records[0];
  }

  writeCronState(jobName, fields) {
    this.sql.exec('INSERT OR IGNORE INTO _snapback_cron_state (job_name, armed) VALUES (?, 0)', jobName);
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    this.sql.exec(
      `UPDATE _snapback_cron_state SET ${assignments} WHERE job_name = ?`,
      ...keys.map((key) => fields[key]),
      jobName
    );
  }

  migrateCronDiagnostics() {
    for (const state of this.sql.exec(
      'SELECT job_name, last_error_code, last_error FROM _snapback_cron_state',
    )) {
      const previousError = String(state.last_error || '');
      const error = this.sanitizeCronDiagnostic(previousError);
      let errorCode = this.sanitizeCronDiagnosticCode(state.last_error_code);
      if (error.length === 0) errorCode = null;
      else if (errorCode === null) errorCode = 'SNAPBACK_CRON_ACTION_FAILED';
      if (error !== previousError || errorCode !== (state.last_error_code ?? null)) {
        this.sql.exec(
          `UPDATE _snapback_cron_state
           SET last_error_code = ?, last_error = ?
           WHERE job_name = ?`,
          errorCode,
          error,
          String(state.job_name),
        );
      }
    }
  }

  // Reconcile activation with current demand, then recompute the single
  // object alarm. Called from every subscribe/unsubscribe/close/reset seam.
  async reconcileCronActivation() {
    const nowMs = Date.now();
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      const armed = state ? Number(state.armed) === 1 : false;
      const demand = this.cronDemand(job);
      if (demand > 0 && !armed) {
        // First subscriber after idle: run a catch-up poll promptly when the
        // data is already stale (LLP 0028's missed-ticks → run once on
        // recovery), otherwise wait out the remainder of the interval.
        const interval = this.jobIntervalMs(job);
        const lastFinished = state ? Number(state.last_finished_at_ms || 0) : 0;
        const stale = nowMs - lastFinished >= interval;
        const nextNominal = stale ? nowMs : lastFinished + interval;
        this.writeCronState(job.name, { armed: 1, next_nominal_at_ms: nextNominal });
      } else if (demand === 0 && armed) {
        this.writeCronState(job.name, { armed: 0, next_nominal_at_ms: null });
      }
    }
    await this.recomputeAlarm();
  }

  // The one-alarm-per-object dispatcher's arming half: the object alarm is
  // min(next nominal) over armed jobs, or absent when none is armed.
  async recomputeAlarm(nowMs = Date.now()) {
    let next = null;
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      if (!state || Number(state.armed) !== 1 || state.next_nominal_at_ms == null) continue;
      const nominal = Number(state.next_nominal_at_ms);
      let wakeAt = nominal;
      const key = `${job.name}@${nominal}`;
      for (const claim of this.sql.exec(
        'SELECT state, lease_expires_at_ms FROM _snapback_cron_claims WHERE idempotency_key = ?',
        key
      )) {
        if (String(claim.state) === 'claimed' && Number(claim.lease_expires_at_ms || 0) > nowMs) {
          wakeAt = Number(claim.lease_expires_at_ms);
        }
      }
      if (next === null || wakeAt < next) next = wakeAt;
    }
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
      return null;
    } else {
      const alarmAtMs = Math.max(next, nowMs + 1);
      await this.ctx.storage.setAlarm(alarmAtMs);
      return alarmAtMs;
    }
  }

  // The DO alarm handler — the dispatcher's firing half. A wakeup with no
  // work (demand vanished, or nothing due yet) early-outs without any
  // external fetch; a due armed job runs through the claimed runner.
  async alarm() {
    if (this.servablePrecondition()) {
      // @ref LLP 0028#amendment-2026-07-23-platform-alarms-are-lossy-the-durable-schedule-table-stays-authoritative —
      //   refusal skips execution but preserves a future wakeup over the
      //   unchanged durable nominal instead of silently dropping the job.
      await this.ctx.storage.setAlarm(Date.now() + STARTUP_REFUSAL_ALARM_RETRY_MS);
      return;
    }
    const nowMs = Date.now();
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      if (!state || Number(state.armed) !== 1 || state.next_nominal_at_ms == null) continue;
      if (this.cronDemand(job) === 0) {
        this.writeCronState(job.name, { armed: 0, next_nominal_at_ms: null });
        continue;
      }
      const nominal = Number(state.next_nominal_at_ms);
      if (nominal > nowMs + 50) continue; // not due: spurious/early wakeup
      await this.runCronJob(job, 'scheduled', nominal);
    }
    await this.reconcileCronActivation();
  }

  // The hardened durable runner (LLP 0028 §Scheduler state): claim the slot
  // by its stable idempotency key (jobName, scheduledAt) BEFORE executing.
  // DO-alarm auto-retry re-runs the whole handler, so a duplicate wakeup for
  // an already-claimed slot advances the schedule without fetching or
  // committing again. Manual run-now is deliberately outside this durable
  // replay protocol: it is one ordinary action attempt and leaves no orphaned
  // claim or nested-mutation replay rows after a client/request failure.
  async runCronJob(job, trigger, scheduledAtMs, idempotencyKey = null) {
    if (trigger === 'manual') return this.runManualCronJob(job, scheduledAtMs);
    const runGeneration = this.appGeneration();
    const runId = crypto.randomUUID();
    const key = idempotencyKey || `${job.name}@${scheduledAtMs}`;
    const claim = this.claimCronSlot(job, key, scheduledAtMs, runId);
    const interval = this.jobIntervalMs(job);
    if (claim.terminal) {
      if (!idempotencyKey) this.advanceNominal(job, scheduledAtMs, interval);
      return { duplicate: true, terminal: true, idempotencyKey: key };
    }
    if (!claim.acquired) {
      // A live lease is not completion. Keep the nominal slot in place; the
      // alarm dispatcher re-arms at the lease boundary and recovers it if the
      // owning attempt never reaches a terminal update.
      return { duplicate: true, inFlight: true, leaseExpiresAtMs: claim.leaseExpiresAtMs, idempotencyKey: key };
    }
    if (this.env.SNAPBACK_TESTING === '1' && this.testCronStopAfterClaimRemaining > 0) {
      this.testCronStopAfterClaimRemaining -= 1;
      return { duplicate: false, claimedOnly: true, runId, idempotencyKey: key };
    }
    const startedAt = Date.now();
    let outcome = 'ok';
    let errorCode = null;
    let errorText = '';
    // Testing-only upstream override so the Miniflare acceptance can point
    // scheduled runs at a local mock 511; never read on real deploys.
    const args = { trigger: 'cron' };
    if (this.env.SNAPBACK_TESTING === '1' && typeof this.env.SNAPBACK_TEST_FEED_URL === 'string') {
      args.feedUrl = this.env.SNAPBACK_TEST_FEED_URL;
      // Short synthetic cadences (SNAPBACK_CRON_INTERVAL_OVERRIDE_MS) would
      // otherwise be swallowed by the app's 180s upstream-poll budget
      // (ENG-23642) — relax it for testing runs only. The app clamps this to
      // its production ceiling, so it can never RAISE the budget.
      args.pollBudgetMs = 0;
    }
    try {
      const result = await this.executeAction(job.action, args, trigger, {
        idempotencyKey: `cron:${key}`,
        jobName: job.name,
      });
      if (!result.ok) {
        if (
          this.env.SNAPBACK_TESTING === '1' &&
          result.diagnostic.code === 'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED'
        ) {
          return { duplicate: false, interruptedDuringAction: true, runId, idempotencyKey: key };
        }
        outcome = 'failed';
        errorCode = result.diagnostic.code;
        errorText = `${result.diagnostic.code}: ${result.diagnostic.message}`;
      }
    } catch (error) {
      outcome = 'failed';
      errorCode = 'SNAPBACK_CRON_ACTION_FAILED';
      errorText = String((error && error.message) || error);
    }
    if (this.appGeneration() !== runGeneration) {
      return { duplicate: false, runId, outcome: 'reset', resetAbandoned: true, idempotencyKey: key };
    }
    if (this.env.SNAPBACK_TESTING === '1' && this.testCronStopBeforeFinishRemaining > 0) {
      this.testCronStopBeforeFinishRemaining -= 1;
      return { duplicate: false, interruptedBeforeFinish: true, runId, outcome, idempotencyKey: key };
    }
    const finishedAt = Date.now();
    const completion = this.commitCronCompletion({
      job,
      trigger,
      scheduledAtMs,
      idempotencyKey,
      key,
      runId,
      interval,
      outcome,
      errorCode,
      errorText,
      startedAt,
      finishedAt,
    });
    if (completion.interruptedAfterTerminalUpdate) {
      return {
        duplicate: false,
        interruptedAfterTerminalUpdate: true,
        runId,
        outcome,
        idempotencyKey: key,
      };
    }
    if (!completion.committed) {
      return {
        duplicate: false,
        supersededClaim: true,
        runId,
        outcome: 'superseded',
        idempotencyKey: key,
      };
    }
    return { duplicate: false, runId, outcome, idempotencyKey: key };
  }

  // @ref LLP 0028#scheduler-state-and-run-ledger — a terminal claim is
  // observable completion only together with its run summary and next
  // nominal. A crash at any statement boundary must roll back all three.
  commitCronCompletion({
    job,
    trigger,
    scheduledAtMs,
    idempotencyKey,
    key,
    runId,
    interval,
    outcome,
    errorCode,
    errorText,
    startedAt,
    finishedAt,
  }) {
    const retainedError = this.sanitizeCronDiagnostic(errorText);
    const retainedErrorCode = this.sanitizeCronDiagnosticCode(errorCode);
    let committed = false;
    let interruptedAfterTerminalUpdate = false;
    try {
      this.ctx.storage.transactionSync(() => {
        const claim = [...this.sql.exec(
          'SELECT state, run_id FROM _snapback_cron_claims WHERE idempotency_key = ?',
          key,
        )][0];
        if (!claim || String(claim.state) !== 'claimed' || String(claim.run_id) !== runId) return;

        this.sql.exec(
          `UPDATE _snapback_cron_claims SET state = ?, lease_expires_at_ms = NULL
           WHERE idempotency_key = ? AND run_id = ?`,
          outcome === 'ok' ? 'done' : 'failed',
          key,
          runId,
        );
        if (
          this.env.SNAPBACK_TESTING === '1' &&
          this.testCronStopAfterTerminalUpdateRemaining > 0
        ) {
          this.testCronStopAfterTerminalUpdateRemaining -= 1;
          const fault = new Error('injected interruption after terminal claim update');
          fault.code = 'SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE';
          throw fault;
        }
        this.writeCronState(job.name, {
          last_run_id: runId,
          last_scheduled_at_ms: scheduledAtMs,
          last_trigger: trigger,
          last_outcome: outcome,
          last_duration_ms: finishedAt - startedAt,
          last_error_code: retainedErrorCode,
          last_error: retainedError,
          last_finished_at_ms: finishedAt,
        });
        if (!idempotencyKey) {
          this.advanceNominal(job, scheduledAtMs, interval, finishedAt);
        }
        this.pruneCronClaims(finishedAt);
        committed = true;
      });
    } catch (error) {
      if (error?.code !== 'SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE') throw error;
      interruptedAfterTerminalUpdate = true;
    }
    return { committed, interruptedAfterTerminalUpdate };
  }

  async runManualCronJob(job, scheduledAtMs) {
    const runGeneration = this.appGeneration();
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    let outcome = 'ok';
    let errorCode = null;
    let errorText = '';
    try {
      if (
        this.env.SNAPBACK_TESTING === '1'
        && typeof job.testThrowMessage === 'string'
      ) {
        throw new Error(job.testThrowMessage);
      }
      const result = await this.executeAction(job.action, this.cronActionArgs(), 'manual', { jobName: job.name });
      if (!result.ok) {
        outcome = 'failed';
        errorCode = result.diagnostic.code;
        errorText = `${result.diagnostic.code}: ${result.diagnostic.message}`;
      }
    } catch (error) {
      outcome = 'failed';
      errorCode = 'SNAPBACK_CRON_ACTION_FAILED';
      errorText = String((error && error.message) || error);
    }
    if (this.appGeneration() !== runGeneration) {
      return { duplicate: false, runId, outcome: 'reset', resetAbandoned: true };
    }
    const finishedAt = Date.now();
    const retainedError = this.sanitizeCronDiagnostic(errorText);
    const retainedErrorCode = this.sanitizeCronDiagnosticCode(errorCode);
    this.writeCronState(job.name, {
      last_run_id: runId,
      last_scheduled_at_ms: scheduledAtMs,
      last_trigger: 'manual',
      last_outcome: outcome,
      last_duration_ms: finishedAt - startedAt,
      last_error_code: retainedErrorCode,
      last_error: retainedError,
      last_finished_at_ms: finishedAt,
    });
    return { duplicate: false, runId, outcome };
  }

  cronActionArgs() {
    const args = { trigger: 'cron' };
    if (this.env.SNAPBACK_TESTING === '1' && typeof this.env.SNAPBACK_TEST_FEED_URL === 'string') {
      args.feedUrl = this.env.SNAPBACK_TEST_FEED_URL;
      args.pollBudgetMs = 0;
    }
    return args;
  }

  cronLeaseMs() {
    const configured = Number(this.env.SNAPBACK_CRON_CLAIM_LEASE_MS);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isFinite(configured) && configured > 0) return configured;
    return Math.max(60_000, this.actionTimeoutMs() + 5_000);
  }

  claimCronSlot(job, key, scheduledAtMs, runId) {
    const nowMs = Date.now();
    const leaseExpiresAtMs = nowMs + this.cronLeaseMs();
    let result = null;
    this.ctx.storage.transactionSync(() => {
      let existing = null;
      for (const record of this.sql.exec('SELECT * FROM _snapback_cron_claims WHERE idempotency_key = ?', key)) {
        existing = record;
      }
      if (!existing) {
        this.sql.exec(
          `INSERT INTO _snapback_cron_claims
             (idempotency_key, job_name, scheduled_at_ms, run_id, claimed_at_ms, state, lease_expires_at_ms, attempt)
           VALUES (?, ?, ?, ?, ?, 'claimed', ?, 1)`,
          key,
          job.name,
          scheduledAtMs,
          runId,
          nowMs,
          leaseExpiresAtMs
        );
        result = { acquired: true, terminal: false, leaseExpiresAtMs, attempt: 1 };
        return;
      }
      const state = String(existing.state);
      if (state === 'done' || state === 'failed') {
        result = { acquired: false, terminal: true, state };
        return;
      }
      const currentLease = Number(existing.lease_expires_at_ms || 0);
      if (state === 'claimed' && currentLease > nowMs) {
        result = { acquired: false, terminal: false, leaseExpiresAtMs: currentLease };
        return;
      }
      const attempt = Math.max(1, Number(existing.attempt || 1)) + 1;
      this.sql.exec(
        `UPDATE _snapback_cron_claims
         SET run_id = ?, claimed_at_ms = ?, state = 'claimed', lease_expires_at_ms = ?, attempt = ?
         WHERE idempotency_key = ?`,
        runId,
        nowMs,
        leaseExpiresAtMs,
        attempt,
        key
      );
      result = { acquired: true, terminal: false, leaseExpiresAtMs, attempt };
    });
    return result;
  }

  pruneCronClaims(nowMs) {
    this.sql.exec(
      `DELETE FROM _snapback_action_mutation_results
       WHERE action_idempotency_key IN (
         SELECT 'cron:' || idempotency_key FROM _snapback_cron_claims
         WHERE state IN ('done', 'failed') AND claimed_at_ms < ?
       )`,
      nowMs - CRON_CLAIM_RETENTION_MS
    );
    this.sql.exec(
      `DELETE FROM _snapback_cron_claims
       WHERE state IN ('done', 'failed') AND claimed_at_ms < ?`,
      nowMs - CRON_CLAIM_RETENTION_MS
    );
  }

  // Advance to the next FUTURE nominal slot: one catch-up run per recovery,
  // never a stampede of missed ticks (LLP 0028).
  advanceNominal(job, fromNominalMs, intervalMs, nowMs = Date.now()) {
    const next = nextNominalAfter(fromNominalMs, intervalMs, nowMs);
    this.writeCronState(job.name, { next_nominal_at_ms: next });
    return next;
  }

  async cronNominalReconciliationForTest(payload) {
    const job = this.alarmJobs()[0];
    if (!job) {
      return json(404, { ok: false, code: 'SNAPBACK_TEST_CRON_JOB_MISSING' });
    }
    const previousNominalMs = payload.previousNominalMs;
    const intervalMs = payload.intervalMs;
    const nowMs = payload.nowMs;
    if (
      !Number.isSafeInteger(previousNominalMs) ||
      previousNominalMs < 0 ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs <= 0 ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0
    ) {
      return json(400, {
        ok: false,
        code: 'SNAPBACK_TEST_CRON_NOMINAL_INVALID',
        message: 'previousNominalMs, intervalMs, and nowMs must be non-negative safe integers; intervalMs must be positive',
      });
    }

    this.writeCronState(job.name, { armed: 1, next_nominal_at_ms: previousNominalMs });
    const nextNominalAtMs = this.advanceNominal(job, previousNominalMs, intervalMs, nowMs);
    if (!Number.isSafeInteger(nextNominalAtMs)) {
      return json(400, {
        ok: false,
        code: 'SNAPBACK_TEST_CRON_NOMINAL_INVALID',
        message: 'the resulting nominal time must be a safe integer',
      });
    }
    const scheduledAlarmAtMs = await this.recomputeAlarm(nowMs);
    const persisted = this.readCronState(job.name);
    const storedAlarmAtMs = await this.ctx.storage.getAlarm();
    return json(200, {
      ok: true,
      job: job.name,
      previousNominalMs,
      intervalMs,
      nowMs,
      nextNominalAtMs,
      persistedNextNominalAtMs: Number(persisted.next_nominal_at_ms),
      scheduledAlarmAtMs,
      storedAlarmAtMs,
    });
  }

  // GET /_snapback/api/cron/status has a public operational projection and a more useful
  // admin-token projection. Public callers see only bounded classifications;
  // the gateway forwards the original headers so an operator can see the
  // scrubbed, bounded detail retained here.
  // @ref LLP 0060#diagnostics-and-observability — public diagnostics never
  // expose credentials or unbounded application failure text.
  async cronStatus(request) {
    if (request.method !== 'GET') {
      return json(405, {
        ok: false,
        code: 'SNAPBACK_CRON_STATUS_METHOD_NOT_ALLOWED',
        message: 'cron status is GET-only',
      }, CRON_STATUS_RESPONSE_HEADERS);
    }
    const includeOperatorDetail = await this.hasAdminReadAuthority(request);
    const jobs = [];
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      const demand = this.cronDemand(job);
      jobs.push({
        name: job.name,
        action: job.action,
        everyMs: this.jobIntervalMs(job),
        wakeup: 'durable-object-alarm',
        activation: {
          kind: (job.activation && job.activation.kind) || 'AlwaysOn',
          whileLive: (job.activation && job.activation.whileLive) || [],
          state: state && Number(state.armed) === 1 ? 'armed' : 'inactive:no-demand',
          demand,
        },
        nextRun:
          state && Number(state.armed) === 1 && state.next_nominal_at_ms != null
            ? { nominalAtMs: Number(state.next_nominal_at_ms) }
            : null,
        lastRun: state && state.last_run_id
          ? this.cronLastRunProjection(state, includeOperatorDetail)
          : null,
      });
    }
    return json(200, { jobs }, CRON_STATUS_RESPONSE_HEADERS);
  }

  cronLastRunProjection(state, includeOperatorDetail) {
    const error = this.sanitizeCronDiagnostic(state.last_error || '');
    const retainedCode = this.sanitizeCronDiagnosticCode(state.last_error_code);
    const errorCode = error.length === 0
      ? null
      : PUBLIC_CRON_ERROR_CODES.has(retainedCode)
        ? retainedCode
        : 'SNAPBACK_CRON_ACTION_FAILED';
    const projected = {
      scheduledAtMs: Number(state.last_scheduled_at_ms),
      trigger: String(state.last_trigger || ''),
      outcome: String(state.last_outcome || ''),
      durationMs: Number(state.last_duration_ms || 0),
      errorCode,
      finishedAtMs: Number(state.last_finished_at_ms || 0),
    };
    if (includeOperatorDetail) {
      projected.runId = String(state.last_run_id);
      projected.errorCode = retainedCode || errorCode;
      projected.error = error;
    }
    return projected;
  }

  sanitizeCronDiagnostic(value) {
    let text = String(value || '');
    const sensitive = new Set();
    if (typeof this.env.SNAPBACK_ADMIN_TOKEN === 'string') sensitive.add(this.env.SNAPBACK_ADMIN_TOKEN);
    for (const entry of appConfig || []) {
      for (const member of this.poolMembers(entry.name)) sensitive.add(member);
    }
    for (const secret of sensitive) {
      if (!secret) continue;
      for (const pattern of secretRedactionPatterns(secret)) text = text.replace(pattern, '[redacted]');
    }
    // Redact against the exact configured bytes before normalizing controls;
    // otherwise a secret containing a newline or tab changes shape first and
    // evades every raw/escaped redaction pattern.
    text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
    return boundUtf8Text(text, MAX_CRON_DIAGNOSTIC_BYTES);
  }

  sanitizeCronDiagnosticCode(value) {
    const code = String(value || '');
    if (code.length === 0) return null;
    return PUBLIC_CRON_ERROR_CODES.has(code) || code === 'SNAPBACK_CRON_ACTION_FAILED'
      ? code
      : 'SNAPBACK_CRON_ACTION_FAILED';
  }

  // --- handler invocation across the RPC seam ----------------------------

  // The invocation settlement budget (ENG-23605): how long the handler
  // server waits for the handler's completion envelope before reporting
  // didNotSettle. Deployment-tunable via the SNAPBACK_SETTLEMENT_TIMEOUT_MS
  // binding (the twin harness lowers it to keep the hangForever corpus case
  // fast); the default mirrors the local twin's posture of always having a
  // deadline rather than trusting handlers to settle. Actions legitimately
  // park on external fetches, and their wall-clock authority is the
  // executeAction watchdog (actionTimeoutMs) — the settlement deadline sits
  // just above it so it only catches the never-settling shape, never
  // slow-but-legal egress.
  settlementTimeoutMs(mode) {
    const configured = Number(this.env.SNAPBACK_SETTLEMENT_TIMEOUT_MS);
    const base = Number.isFinite(configured) && configured > 0 ? configured : 10_000;
    return mode === 'action' ? Math.max(base, this.actionTimeoutMs() + 1_000) : base;
  }

  async invokeHandler(fnName, mode, args, options = {}) {
    const fn = this.functionByName(fnName);
    if (!fn) {
      const candidates = functions
        .filter((candidate) => candidate.testingOnly !== true || this.env.SNAPBACK_TESTING === '1')
        .map((candidate) => candidate.name)
        .sort()
        .slice(0, 8);
      // @ref LLP 0146#oq6-author-ruling--2026-08-10 — hosted construction
      // uses the exact compiled bundle identity at the authorization-aware
      // refusal site; the rejected spelling is not reflected.
      return {
        ok: false,
        code: 'SNAPBACK_HANDLER_EXPORT_MISSING',
        message: 'the requested function is not in the served function manifest',
        details: {
          artifactHash: APP_BUNDLE_HASH,
          candidateFunctions: candidates,
          candidatesTruncated: candidates.length < functions.length,
          remediationSet: createIdentifierRemediationSet({
            artifactHash: APP_BUNDLE_HASH,
            target: 'function',
            replacements: candidates,
          }),
        },
      };
    }
    if (!functionKindMatchesMode(fn.kind, mode)) {
      return {
        ok: false,
        code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
        message: `${fnName} is declared ${fn.kind}, not ${mode}`,
        details: { function: fnName, declaredKind: fn.kind, requestedMode: mode },
      };
    }
    // HostPlan queries evaluate natively on the coordinator (LLP 0090 step
    // 4): the plan is declarative — no handler isolate, no awaits — which is
    // both what makes the rqsEligible closed-inputs fact honest on this arm
    // (no opaque JavaScript ran) and what gives bundle evaluation its
    // single-commit cut for free.
    if (mode === 'query') {
      const plan = hostPlanQuery(fn);
      if (plan) {
        try {
          const rows = this.evaluateHostPlanRows(plan, args || {});
          return { ok: true, value: rows, observedVersion: this.currentVersion() };
        } catch (error) {
          return {
            ok: false,
            code: 'SNAPBACK_HOST_PLAN_EVALUATION_FAILED',
            message: `evaluating the ${fnName} host plan failed: ${String((error && error.message) || error)}`,
          };
        }
      }
    }
    // Grants are action-only (LLP 0036): queries and mutations receive
    // secretsJson null and therefore no ctx.secrets at all.
    const grants = mode === 'action' ? this.buildActionGrants(fn) : { secretsJson: null, capabilities: new Map() };
    const secretsJson = grants.secretsJson;
    const runJson =
      mode === 'action'
        ? JSON.stringify({
            runId: crypto.randomUUID(),
            trigger: options.trigger || 'manual',
            jobName: options.jobName || null,
          })
        : null;
    const token = crypto.randomUUID();
    const epoch = `${Date.now()}-${token}`;
    let host;
    const hostStreams = mode === 'action'
      ? this.createActionResponseStreams(options.control || null, grants.capabilities)
      : null;
    const control = options.control || null;
    const actionIdempotencyKey = mode === 'action' && options.actionIdempotencyKey != null
      ? String(options.actionIdempotencyKey)
      : null;
    let actionMutationSequence = 0;
    host = new HostContext({
      sql: this.sql,
      mode,
      nowMs: Date.now(),
      epoch,
      newId: () => this.newId(),
      tables: APP_TABLES,
      schemaTables: APP_SCHEMA_TABLES,
      control,
      // Action-only host capabilities (LLP 0049 Phase 2). runMutation
      // reacquires the invocation mutex per commit — the ENG-23324 pattern:
      // the action itself executes OFF the mutex, so a slow external fetch
      // never stalls queries, mutations, or live pushes on this object.
      runMutation:
        mode === 'action'
          ? async (name, mutationArgs) => {
              const outcome = await this.runExclusive(() => {
                if (
                  options.trigger === 'scheduled' &&
                  this.env.SNAPBACK_TESTING === '1' &&
                  this.testCronInterruptDuringActionRemaining > 0
                ) {
                  this.testCronInterruptDuringActionRemaining -= 1;
                  return {
                    ok: false,
                    code: 'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED',
                    message: 'injected cron interruption during action execution',
                  };
                }
                const abandoned = this.actionGenerationFailure(control) || host.abandonedFailure();
                if (abandoned) return abandoned;
                const sequence = actionMutationSequence;
                actionMutationSequence += 1;
                return this.runMutationForAction(
                  name,
                  mutationArgs,
                  host,
                  { actionIdempotencyKey, sequence },
                  options.authProjection,
                );
              });
              const delivery = this.activatePreparedFanOut(outcome.preparedFanOut || []);
              // Normal keeps the old awaited-fanout contract. Under an active
              // profile, live release is waitUntil-anchored and the internal
              // host-call result does not queue behind observation latency.
              if (!outcome.profiledFanOut) await delivery;
              const { preparedFanOut: _prepared, profiledFanOut: _profiled, ...publicOutcome } = outcome;
              return publicOutcome;
            }
          : null,
      hostFetch: mode === 'action' ? (request) => this.hostActionFetch(request, grants.capabilities, control) : null,
      hostStreams,
    });
    if (control) {
      control.host = host;
      this.actionGenerationFailure(control);
      if (control.abandoned) host.abandon(control.code, control.message);
    }
    this.activeInvocations.set(token, host);
    // Actions run on their own handler Worker when the deploy carries one
    // (ACTION_HANDLER): the handler server chains invocations per isolate
    // for rejection-ledger attribution (ENG-23585), so an action parked on a
    // slow host fetch would otherwise queue every query/mutation/fan-out
    // invocation behind it — the Cloudflare analogue of the local DK-4
    // fresh-VM action fence.
    const handlerService = mode === 'action' && this.env.ACTION_HANDLER ? this.env.ACTION_HANDLER : this.env.HANDLER;
    try {
      const response = await handlerService.fetch('http://handler/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          export: fn.export,
          argsJson: JSON.stringify(args || {}),
          // Unattributed re-evaluations (notably durable live fan-out after
          // wake) must never acquire system authority by omission. True
          // scheduler/action-system calls pass SYSTEM_AUTH_PROJECTION
          // explicitly; the conservative fallback remains anonymous.
          authJson: JSON.stringify(options.authProjection || ANONYMOUS_AUTH_PROJECTION),
          mode,
          runJson,
          secretsJson,
          epoch,
          token,
          // The handler server's settlement deadline (ENG-23605). Without
          // it a never-settling handler parks this fetch forever AND wedges
          // the handler isolate's invocation chain — every later invocation
          // on that isolate queues behind the hang. The local twin has
          // always passed one (src/workerd_exec.rs); this closes the same
          // hole on the deployed path, and the twin corpus's hangForever
          // case now converges to SNAPBACK_HANDLER_DID_NOT_SETTLE here.
          settlementTimeoutMs: this.settlementTimeoutMs(mode),
          // The host-routing header entry.mjs echoes onto every host call so
          // the gateway routes it back to THIS coordinator object.
          hostHeaders: { 'x-snapback-do-id': this.ctx.id.toString() },
        }),
      });
      const result = await response.json();
      // The checks below mirror src/workerd_exec.rs order for the twin leg:
      // fatal → unhandled rejections → detection support → envelope.
      if (result.fatal) {
        return { ok: false, code: 'SNAPBACK_V8_RUNNER_INVOKE_FAILED', message: result.fatal };
      }
      if (result.didNotSettle) {
        return {
          ok: false,
          code: 'SNAPBACK_HANDLER_DID_NOT_SETTLE',
          message: 'handler did not settle before the harness deadline; the invocation failed and committed no writes',
        };
      }
      if (result.unhandledRejections && result.unhandledRejections.length > 0) {
        return {
          ok: false,
          code: 'SNAPBACK_HANDLER_UNHANDLED_REJECTION',
          message: 'handler completed with unhandled promise rejection(s) — the invocation failed and committed no writes',
          details: { rejections: result.unhandledRejections },
        };
      }
      if (result.rejectionDetectionSupported === false) {
        // Fail closed exactly as the twin does (ENG-23586): without rejection
        // detection, a detached chain's partial writes could commit unseen
        // (the ENG-23361 hole), so the invocation is refused instead.
        return {
          ok: false,
          code: 'SNAPBACK_V8_REJECTION_DETECTION_UNAVAILABLE',
          message:
            'the handler isolate could not install unhandled-rejection detection; the LLP 0009 conformance floor requires it on every engine',
        };
      }
      const decoded = parseHandlerEnvelope(result.envelope);
      // @ref LLP 0144#invariants-for-any-extension — the handler envelope is
      //   a claim only. This deploy-time host admits it against the exact
      //   function definition selected above, or folds it fail-closed.
      const admitted = admitDeclaredRefusal(fn.refusals, decoded, { functionName: fn.export });
      // 0137 a4-f5 hosted mirror (issues/20260801-hosted-action-denial-
      // witness-parity.md): a nested mutation's trusted denial recorded at
      // the host-op dispatch is restored past the envelope fold only when
      // the handler's raw claim matches — same seam order as the Rust leg
      // (admit_declared_refusal, then restore_denial_witness). The witness
      // is recorded in action mode only, so this is vacuous elsewhere.
      const witnessed = restoreDenialWitness(host.takeDenialWitness(), decoded.claimedCode ?? null, admitted);
      const parsed = classifyHandlerPlatformFailure(witnessed, { maxRowBytes: MAX_ROW_BYTES });
      return { ...parsed, host, observedVersion: host.observedVersion || this.currentVersion() };
    } finally {
      await host?.closeResponseStreams();
      this.activeInvocations.delete(token);
    }
  }

  // The re-entrant host-call endpoint: the handler isolate's ctx host calls
  // land here (routed by the gateway using x-snapback-do-id). Reads and
  // buffering only — the commit happens after the handler settles. Never
  // behind the invocation mutex: the invocation holding the mutex progresses
  // through these calls.
  async serveHostCall(request) {
    const token = request.headers.get('x-snapback-host-token') || '';
    const parsedBody = await parseJsonObjectRequest(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.value;
    const host = this.activeInvocations.get(token);
    if (!host) {
      return json(200, {
        ok: false,
        code: 'SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT',
        message: 'no live invocation for this host-call token',
      });
    }
    const rawOp = String(body.rawOp || '');
    const sep = rawOp.indexOf('|');
    if (sep < 0) {
      return json(200, { ok: false, code: 'SNAPBACK_HANDLER_HOST_CALL_MALFORMED', message: 'host call not issued through ctx' });
    }
    const callEpoch = rawOp.slice(0, sep);
    const op = rawOp.slice(sep + 1);
    if (callEpoch !== host.epoch) {
      return json(200, {
        ok: false,
        code: 'SNAPBACK_HANDLER_STALE_CONTINUATION',
        message: 'a continuation from a prior invocation attempted a host call; rejected',
      });
    }
    let args = {};
    try {
      args = JSON.parse(body.argsJson || '{}');
    } catch (_) {
      return json(200, { ok: false, code: 'SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON', message: 'bad args json' });
    }
    // Awaited: the action-only ops (host.fetch, action.runMutation) are
    // async — the external fetch runs OUTSIDE the invocation mutex on this
    // un-chained path, and runMutation reacquires the mutex itself.
    return json(200, await host.handle(op, args));
  }

  // --- query -------------------------------------------------------------

  async handleQuery(payload, authority) {
    const result = await this.invokeHandler(payload.name, 'query', payload.args, authority);
    const response = !result.ok
      ? json(result.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH' ? 400 : 200, failure(result))
      : json(200, { ok: true, version: result.observedVersion ?? this.currentVersion(), rows: result.value });
    return this.prepareResultResponse(response, 'queryResponse');
  }

  // --- mutation + commit -------------------------------------------------

  async handleMutation(payload, authority) {
    const result = await this.invokeHandler(payload.name, 'mutation', payload.args, authority);
    if (!result.ok) {
      return this.prepareResultResponse(
        json(result.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH' ? 400 : 200, failure(result)),
        'mutationAck',
      );
    }
    const commit = this.commit(result.host);
    const commitEgress = commit.committedAtMs == null
      ? null
      : this.networkProfiles.admitCommit(commit.committedAtMs);
    const fanOut = await this.prepareFanOut(commit, commitEgress);
    const response = json(200, {
      ok: true,
      version: commit.version,
      changedCount: commit.changes.length,
      result: result.value,
    });
    const ackEgress = commit.committedAtMs == null
      ? this.networkProfiles.admitResult('mutationAck')
      : commitEgress?.forLane('mutationAck') ?? null;
    return this.preparedResponse(response, ackEgress, fanOut);
  }

  // Version allocation + row writes + journal append as ONE local
  // transaction (LLP 0007 gap-free visibility by construction). The version
  // advances only when the EFFECTIVE changeset is non-empty — a mutation
  // whose writes all degrade to no-ops (patch on a missing row, empty-values
  // patch, delete of a missing row) keeps the current version, matching
  // src/storage.rs (ENG-23583).
  commit(host, transactionTail = null) {
    if (host.writes.length === 0 && typeof transactionTail !== 'function') {
      return { version: this.currentVersion(), changes: [], committedAtMs: null };
    }
    const nowMs = Date.now();
    const currentVersion = this.currentVersion();
    const nextVersion = currentVersion + 1;
    const changes = [];
    this.ctx.storage.transactionSync(() => {
      for (const write of host.writes) {
        const table = this.physicalTable(write.table);
        if (write.kind === 'insert') {
          const row = { _id: write.id, _version: nextVersion, _createdAt: nowMs, _updatedAt: nowMs, ...write.values };
          const rowJson = this.serializeRow(write.table, row);
          this.sql.exec(`INSERT INTO ${table} (id, row_json) VALUES (?, ?)`, write.id, rowJson);
          this.recordChange(nextVersion, write.table, write.id, 'insert', rowJson, nowMs);
          changes.push({ table: write.table, id: write.id, op: 'insert' });
        } else if (write.kind === 'patch') {
          // Empty-values patches are no-ops on the local target
          // (src/storage.rs); they must not journal or advance the version
          // here either.
          if (Object.keys(write.values).length === 0) continue;
          const existing = this.readRow(table, write.id);
          if (existing) {
            const row = { ...existing, ...write.values, _id: write.id, _version: nextVersion, _updatedAt: nowMs };
            const rowJson = this.serializeRow(write.table, row);
            this.sql.exec(`UPDATE ${table} SET row_json = ? WHERE id = ?`, rowJson, write.id);
            this.recordChange(nextVersion, write.table, write.id, 'patch', rowJson, nowMs);
            changes.push({ table: write.table, id: write.id, op: 'patch' });
          }
        } else if (write.kind === 'delete') {
          // A delete of a missing row is a no-op change-wise, as on the local
          // target (delete_document returns false → nothing journaled).
          const existing = this.readRow(table, write.id);
          if (existing) {
            this.sql.exec(`DELETE FROM ${table} WHERE id = ?`, write.id);
            this.recordChange(nextVersion, write.table, write.id, 'delete', null, nowMs);
            changes.push({ table: write.table, id: write.id, op: 'delete' });
          }
        }
      }
      if (changes.length > 0) {
        this.sql.exec('UPDATE _snapback_version SET version = ? WHERE id = 1', nextVersion);
        // Bounded journal (delta consumers beyond the retention window get a
        // resync, not unbounded storage growth).
        this.sql.exec(
          'DELETE FROM _snapback_changes WHERE version <= ?',
          nextVersion - CHANGE_JOURNAL_RETAIN_VERSIONS
        );
      }
      if (typeof transactionTail === 'function') {
        transactionTail({ version: changes.length > 0 ? nextVersion : currentVersion, changes });
      }
    });
    return {
      version: changes.length > 0 ? nextVersion : currentVersion,
      changes,
      // A changeset-free success is commitless and therefore uses result
      // readiness as its mutation-ack basis (LLP 0167 observation semantics).
      committedAtMs: changes.length > 0 ? networkProfileClockNowMs() : null,
    };
  }

  serializeRow(table, row) {
    const rowJson = JSON.stringify(row);
    const actualBytes = UTF8_ENCODER.encode(rowJson).byteLength;
    if (actualBytes > MAX_ROW_BYTES) {
      throw platformFailureError(valueTooLargeFailure({ limitBytes: MAX_ROW_BYTES, actualBytes, table }));
    }
    return rowJson;
  }

  readRow(table, id) {
    const records = [...this.sql.exec(`SELECT row_json FROM ${table} WHERE id = ?`, id)];
    return records.length === 0 ? null : JSON.parse(records[0].row_json);
  }

  recordChange(version, tableName, rowId, op, rowJson, nowMs) {
    this.sql.exec(
      `INSERT INTO _snapback_changes (version, table_name, row_id, op, row_json, changed_at_ms) VALUES (?, ?, ?, ?, ?, ?)`,
      version,
      tableName,
      rowId,
      op,
      rowJson,
      nowMs
    );
  }

  // --- kit wire protocol handlers (LLP 0049 Phase 0) ----------------------

  // Fail-closed connection-token gate for connection-scoped kit operations.
  // Returns a diagnostic Response when denied, null when the grant is valid —
  // the same code the kit client keys its grant-refresh recovery on.
  async verifyConnection(connectionId, presentedToken) {
    if (!connectionId || typeof connectionId !== 'string') {
      return kitError(400, 'SNAPBACK_CONNECTION_ID_REQUIRED', 'a connection id is required');
    }
    const grant = this.readConnectionGrant(connectionId);
    const expired = Boolean(
      grant && grant.socketSessionId === null && grant.openedAtMs <= Date.now() - this.connectionGrantTtlMs()
    );
    if (expired) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
        this.sql.exec('DELETE FROM _snapback_connections WHERE connection_id = ? AND socket_session_id IS NULL', connectionId);
      });
      if (typeof this.ctx.waitUntil === 'function') this.ctx.waitUntil(this.reconcileCronActivation());
    }
    const stored = grant && !expired ? grant.token : null;
    if (!stored || !presentedToken || !(await constantTimeTokenEqual(stored, presentedToken))) {
      return kitError(
        401,
        'SNAPBACK_CONNECTION_TOKEN_INVALID',
        'connection-scoped operations require the connection token issued by POST /connection/open'
      );
    }
    return null;
  }

  readConnectionToken(connectionId) {
    const grant = this.readConnectionGrant(connectionId);
    return grant && grant.token;
  }

  readConnectionGrant(connectionId) {
    const records = [...this.sql.exec(
      'SELECT token, opened_at_ms, socket_session_id, wire_version FROM _snapback_connections WHERE connection_id = ?',
      connectionId
    )];
    if (records.length === 0) return null;
    return {
      token: String(records[0].token),
      openedAtMs: Number(records[0].opened_at_ms),
      socketSessionId: records[0].socket_session_id == null ? null : String(records[0].socket_session_id),
      // Explicit binding witness; null = legacy lineage (implicitly v1 for
      // the §0B.4 socket-equality rule, never echoed).
      wireVersion: records[0].wire_version == null ? null : String(records[0].wire_version),
    };
  }

  connectionGrantLimit() {
    const configured = Number(this.env.SNAPBACK_CONNECTION_GRANT_LIMIT);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isSafeInteger(configured) && configured > 0) {
      return Math.min(configured, MAX_CONNECTION_GRANT_LIMIT);
    }
    return DEFAULT_CONNECTION_GRANT_LIMIT;
  }

  connectionGrantTtlMs() {
    const configured = Number(this.env.SNAPBACK_CONNECTION_GRANT_TTL_MS);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isFinite(configured) && configured > 0) return configured;
    return DEFAULT_CONNECTION_GRANT_TTL_MS;
  }

  subscriptionGlobalLimit() {
    return this.testingBoundedLimit(
      'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT',
      SUBSCRIPTION_LIMITS.globalCount,
      SUBSCRIPTION_TEST_CEILINGS.globalCount
    );
  }

  subscriptionPerConnectionLimit() {
    return this.testingBoundedLimit(
      'SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT',
      SUBSCRIPTION_LIMITS.perConnectionCount,
      SUBSCRIPTION_TEST_CEILINGS.perConnectionCount
    );
  }

  subscriptionArgsBytesLimit() {
    return this.testingBoundedLimit(
      'SNAPBACK_SUBSCRIPTION_ARGS_BYTES',
      SUBSCRIPTION_LIMITS.canonicalArgsBytes,
      SUBSCRIPTION_TEST_CEILINGS.canonicalArgsBytes
    );
  }

  legacyProofSocketLimit() {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSocketLimitOverrides?.legacyProofSockets) {
      return this.testSocketLimitOverrides.legacyProofSockets;
    }
    return this.testingBoundedLimit(
      'SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT',
      SUBSCRIPTION_LIMITS.legacyProofSockets,
      SUBSCRIPTION_TEST_CEILINGS.legacyProofSockets
    );
  }

  acceptedSocketLimit() {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSocketLimitOverrides?.acceptedSockets) {
      return this.testSocketLimitOverrides.acceptedSockets;
    }
    return this.testingBoundedLimit(
      'SNAPBACK_ACCEPTED_SOCKET_LIMIT',
      SUBSCRIPTION_LIMITS.acceptedSockets,
      SUBSCRIPTION_TEST_CEILINGS.acceptedSockets
    );
  }

  socketsPerConnectionLimit() {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSocketLimitOverrides?.socketsPerConnection) {
      return this.testSocketLimitOverrides.socketsPerConnection;
    }
    return this.testingBoundedLimit(
      'SNAPBACK_SOCKETS_PER_CONNECTION_LIMIT',
      SUBSCRIPTION_LIMITS.socketsPerConnection,
      SUBSCRIPTION_TEST_CEILINGS.socketsPerConnection
    );
  }

  testingBoundedLimit(binding, fallback, ceiling) {
    const configured = Number(this.env[binding]);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isSafeInteger(configured) && configured > 0) {
      return Math.min(configured, ceiling);
    }
    return fallback;
  }

  reconcileAcceptedSocketBounds() {
    const sockets = this.ctx.getWebSockets();
    const staleKitSockets = [];
    const proofSockets = [];
    const physicalKitCounts = new Map();
    for (const socket of sockets) {
      let protocol = 'proof';
      let connectionId = null;
      let socketSessionId = null;
      try {
        protocol = this.socketProtocolFor(socket);
        connectionId = this.connectionIdFor(socket);
        socketSessionId = this.socketSessionFor(socket);
      } catch (_) {
        staleKitSockets.push(socket);
        continue;
      }
      if (protocol !== 'kit') {
        proofSockets.push(socket);
        continue;
      }
      if (connectionId) {
        physicalKitCounts.set(connectionId, (physicalKitCounts.get(connectionId) || 0) + 1);
      }
      let currentSession = null;
      try {
        currentSession = connectionId ? this.currentSocketSession(connectionId) : null;
      } catch (_) {}
      if (!connectionId || !socketSessionId || socketSessionId !== currentSession) {
        staleKitSockets.push(socket);
        continue;
      }
    }

    // Session-replaced kit sockets are never legitimate demand. Ask the
    // platform to retire them first even when aggregate counts are in range.
    for (const socket of staleKitSockets) {
      try { socket.close(1008, 'socket session replaced'); } catch (_) {}
    }

    const proofLimit = this.legacyProofSocketLimit();
    const perConnectionLimit = this.socketsPerConnectionLimit();
    const totalLimit = this.acceptedSocketLimit();
    const overConnection = [...physicalKitCounts.entries()]
      .filter(([, count]) => count > perConnectionLimit)
      .sort(([left], [right]) => left.localeCompare(right));
    const violated =
      sockets.length > totalLimit ||
      proofSockets.length > proofLimit ||
      overConnection.length > 0;
    if (!violated) return null;

    // Upgrade policy: if an older deployment left ANY category over its new
    // hard bound, close the complete hibernation registry. A partial keep-set
    // cannot be chosen authoritatively for legacy proof sockets; disconnect +
    // normal client reconnect is deterministic and leaves no hidden excess.
    for (const socket of sockets) {
      try { socket.close(1012, 'socket limits changed; reconnect'); } catch (_) {}
    }
    return staleArtifact(
      'SNAPBACK_SOCKET_LIMIT_RECONCILIATION_PENDING',
      'hibernated sockets from an older deployment exceed the enforced limits; all were closed and clients may retry after cleanup completes',
      {
        policy: 'close-all-and-retry',
        actualAcceptedSockets: sockets.length,
        maxAcceptedSockets: totalLimit,
        actualLegacyProofSockets: proofSockets.length,
        maxLegacyProofSockets: proofLimit,
        maxSocketsPerConnection: perConnectionLimit,
        overLimitConnections: overConnection.map(([connectionId, count]) => ({ connectionId, count })),
      }
    );
  }

  subscriptionAdmission({ connectionId, functionName, argsJson, supersedes = null, socketSessionId = null }) {
    const argsBytes = UTF8_ENCODER.encode(argsJson).byteLength;
    const argsLimit = this.subscriptionArgsBytesLimit();
    if (argsBytes > argsLimit) {
      return {
        ok: false,
        status: 413,
        code: 'SNAPBACK_SUBSCRIPTION_ARGS_TOO_LARGE',
        message: `canonical subscription arguments exceed the ${argsLimit}-byte durable limit`,
        details: { limitBytes: argsLimit, actualBytes: argsBytes },
      };
    }

    const existing = [...this.sql.exec(
      `SELECT subscription_id FROM _snapback_subscriptions
       WHERE connection_id = ? AND function_name = ? AND args_json = ?`,
      connectionId,
      functionName,
      argsJson
    )];
    if (existing.length > 0) {
      return { ok: true, existingId: String(existing[0].subscription_id), argsBytes };
    }

    let releasesSlot = false;
    if (typeof supersedes === 'string' && supersedes.length > 0) {
      const replaced = socketSessionId == null
        ? [...this.sql.exec(
            `SELECT 1 FROM _snapback_subscriptions
             WHERE subscription_id = ? AND connection_id = ?`,
            supersedes,
            connectionId
          )]
        : [...this.sql.exec(
            `SELECT 1 FROM _snapback_subscriptions
             WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?`,
            supersedes,
            connectionId,
            socketSessionId
          )];
      releasesSlot = replaced.length > 0;
    }

    const globalCount = Number(
      [...this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')][0]?.count || 0
    );
    const connectionCount = Number(
      [...this.sql.exec(
        'SELECT COUNT(*) AS count FROM _snapback_subscriptions WHERE connection_id = ?',
        connectionId
      )][0]?.count || 0
    );
    const release = releasesSlot ? 1 : 0;
    const globalLimit = this.subscriptionGlobalLimit();
    if (globalCount - release >= globalLimit) {
      return {
        ok: false,
        status: 429,
        code: 'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT',
        message: `the durable subscription registry is limited to ${globalLimit} rows`,
        details: { limit: globalLimit },
      };
    }
    const connectionLimit = this.subscriptionPerConnectionLimit();
    if (connectionCount - release >= connectionLimit) {
      return {
        ok: false,
        status: 429,
        code: 'SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT',
        message: `one connection is limited to ${connectionLimit} durable subscriptions`,
        details: { limit: connectionLimit },
      };
    }
    return { ok: true, existingId: null, argsBytes };
  }

  persistSubscription({ connectionId, functionName, argsJson, supersedes = null, socketSessionId = null }) {
    let outcome = null;
    this.ctx.storage.transactionSync(() => {
      // Re-run admission at the write linearization point. runExclusive
      // already serializes every ordinary subscribe path, but this closes the
      // invariant locally if a future caller stages its snapshot elsewhere.
      const admission = this.subscriptionAdmission({
        connectionId,
        functionName,
        argsJson,
        supersedes,
        socketSessionId,
      });
      if (!admission.ok) {
        outcome = admission;
        return;
      }
      let superseded = null;
      let supersessionRefusal = null;
      if (typeof supersedes === 'string' && supersedes.length > 0) {
        const supersessionTarget = socketSessionId == null
          ? [...this.sql.exec(
              `SELECT subscription_id FROM _snapback_subscriptions
               WHERE subscription_id = ? AND connection_id = ?`,
              supersedes,
              connectionId
            )]
          : [...this.sql.exec(
              `SELECT subscription_id FROM _snapback_subscriptions
               WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?`,
              supersedes,
              connectionId,
              socketSessionId
            )];
        if (supersessionTarget.length > 0) {
          superseded = supersedes;
        } else {
          supersessionRefusal = 'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN';
        }
        if (socketSessionId == null) {
          this.sql.exec(
            'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ?',
            supersedes,
            connectionId
          );
        } else {
          this.sql.exec(
            'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
            supersedes,
            connectionId,
            socketSessionId
          );
        }
      }
      this.sql.exec(
        `INSERT INTO _snapback_subscriptions
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, function_name, args_json)
         DO UPDATE SET socket_session_id = excluded.socket_session_id`,
        `sub_${crypto.randomUUID()}`,
        connectionId,
        functionName,
        argsJson,
        socketSessionId
      );
      const rows = [...this.sql.exec(
        'SELECT subscription_id FROM _snapback_subscriptions WHERE connection_id = ? AND function_name = ? AND args_json = ?',
        connectionId,
        functionName,
        argsJson
      )];
      outcome = {
        ok: true,
        subscriptionId: String(rows[0].subscription_id),
        superseded,
        supersessionRefusal,
      };
    });
    return outcome;
  }

  reapExpiredConnections(nowMs = Date.now()) {
    const cutoff = nowMs - this.connectionGrantTtlMs();
    const expired = [];
    for (const record of this.sql.exec(
      'SELECT connection_id FROM _snapback_connections WHERE socket_session_id IS NULL AND opened_at_ms <= ?',
      cutoff
    )) expired.push(String(record.connection_id));
    if (expired.length === 0) return 0;
    this.ctx.storage.transactionSync(() => {
      for (const connectionId of expired) {
        this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
        this.sql.exec(
          'DELETE FROM _snapback_connections WHERE connection_id = ? AND socket_session_id IS NULL AND opened_at_ms <= ?',
          connectionId,
          cutoff
        );
      }
    });
    return expired.length;
  }

  connectionCount() {
    const records = [...this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_connections')];
    return records.length === 0 ? 0 : Number(records[0].count);
  }

  claimConnectionOpenBudget() {
    const configured = Number(this.env.SNAPBACK_CONNECTION_OPEN_RATE_PER_MINUTE);
    const limit = this.env.SNAPBACK_TESTING === '1' && Number.isSafeInteger(configured) && configured > 0
      ? Math.min(configured, 600)
      : DEFAULT_CONNECTION_OPEN_RATE_PER_MINUTE;
    const nowMs = Date.now();
    const rows = [...this.sql.exec('SELECT window_started_at_ms, count FROM _snapback_connection_admission WHERE id = 1')];
    const row = rows[0] || null;
    const inWindow = Boolean(row && nowMs - Number(row.window_started_at_ms) >= 0 && nowMs - Number(row.window_started_at_ms) < 60_000);
    const count = inWindow ? Number(row.count) : 0;
    if (count >= limit) {
      return kitError(
        429,
        'SNAPBACK_CONNECTION_OPEN_RATE_LIMIT',
        `new connection grants are limited to ${limit} per minute; reuse an existing bearer or retry later`
      );
    }
    this.sql.exec(
      `INSERT INTO _snapback_connection_admission (id, window_started_at_ms, count) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET window_started_at_ms = excluded.window_started_at_ms, count = excluded.count`,
      inWindow ? Number(row.window_started_at_ms) : nowMs,
      count + 1
    );
    return null;
  }

  // POST /connection/open (ENG-23442 shape): tests/local fixtures adopt a free
  // caller-readable label, while production always mints the wire id. In every
  // profile a caller presenting a granted id's current token reopens it
  // idempotently; a collision never rotates another connection's bearer.
  async kitOpenConnection(payload) {
    const requested = typeof payload.connectionId === 'string' && payload.connectionId.length > 0
      ? payload.connectionId
      : null;
    if (
      requested !== null &&
      (!CONNECTION_ID_PATTERN.test(requested) || UTF8_ENCODER.encode(requested).byteLength > MAX_CONNECTION_ID_BYTES)
    ) {
      return kitError(
        400,
        'SNAPBACK_CONNECTION_ID_INVALID',
        `connection ids must use only ASCII letters, digits, underscores, or hyphens and fit in ${MAX_CONNECTION_ID_BYTES} UTF-8 bytes`
      );
    }
    // §0C.5 alignment (LLP 0094): unknown authInvalidationProtocol values
    // refuse instead of silently degrading; absent keeps degrading to legacy.
    // (This arm implements no invalidation surface, so a known offer of 1 is
    // read but yields no authorizationInvalidation member, exactly as today.)
    const invalidationCamel = payload.authInvalidationProtocol;
    const invalidationSnake = payload.auth_invalidation_protocol;
    const invalidationAliasesConflict = invalidationCamel !== undefined
      && invalidationSnake !== undefined
      && invalidationCamel !== invalidationSnake;
    const invalidationOffer = invalidationCamel !== undefined
      ? invalidationCamel
      : invalidationSnake;
    if (
      invalidationAliasesConflict
      || (invalidationOffer !== undefined && invalidationOffer !== null && invalidationOffer !== 1)
    ) {
      return kitError(
        400,
        'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED',
        'this server understands authInvalidationProtocol 1 only; omit the field to open a legacy connection'
      );
    }
    // Offer matrix (LLP 0094 §0B.3): known binds and is echoed, unknown
    // refuses (classification precedence: an unknown candidate on a re-open
    // refuses here, never MISMATCH), absent opens a legacy lineage.
    const wireOffer = classifyOpenWireVersionOffer(payload);
    if (wireOffer.kind === 'unknown') {
      return kitError(
        400,
        'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
        `the offered wireVersion is not supported by this server; supported versions: ${SUPPORTED_WIRE_VERSIONS.join(', ')}`
      );
    }
    const reaped = this.reapExpiredConnections();
    if (reaped > 0) await this.reconcileCronActivation();
    const previousToken = typeof payload.previousToken === 'string' ? payload.previousToken : null;
    const requestedGrant = requested === null ? null : this.readConnectionGrant(requested);
    const requestedToken = requestedGrant && requestedGrant.token;
    if (requestedToken && previousToken === requestedToken) {
      // Re-open matrix (LLP 0094 §0B.3): binding is immutable for the
      // lineage. A known offer unequal to the bound version — explicit, or
      // the implicit v1 of a legacy lineage — refuses and leaves the
      // existing connection, socket, and subscriptions undisturbed; a
      // confirming v1 offer on a legacy lineage never upgrades it.
      const lineageWireVersion = requestedGrant.wireVersion;
      if (wireOffer.kind === 'known' && wireOffer.token !== (lineageWireVersion ?? WIRE_VERSION_V1)) {
        return kitError(
          400,
          'SNAPBACK_WIRE_VERSION_MISMATCH',
          "the wire-version offer does not equal this connection lineage's bound version; open a fresh connection to change versions"
        );
      }
      this.sql.exec('UPDATE _snapback_connections SET opened_at_ms = ? WHERE connection_id = ?', Date.now(), requested);
      return json(200, {
        connectionId: requested,
        connectionToken: requestedToken,
        // Echo ⇔ explicitly bound lineage (§0B.3): emitted on every re-open
        // of an explicit lineage, never on a legacy one.
        ...(lineageWireVersion ? { wireVersion: lineageWireVersion } : {}),
      });
    }
    if (this.connectionCount() >= this.connectionGrantLimit()) {
      return kitError(
        429,
        'SNAPBACK_CONNECTION_GRANT_LIMIT',
        'the durable connection-grant budget is full; close/reuse a grant or retry after idle grants expire'
      );
    }
    const rateLimited = this.claimConnectionOpenBudget();
    if (rateLimited) return rateLimited;
    // Trusted tests/local fixtures retain readable labels. Hosted production
    // always mints an unguessable wire id; a returned minted id can still be
    // reopened idempotently with its bearer through the branch above.
    const suggested = this.env.SNAPBACK_TESTING === '1' && requested !== null
      ? requested
      : `conn_${crypto.randomUUID()}`;
    const stored = this.readConnectionToken(suggested);
    const connectionId = stored ? `conn_${crypto.randomUUID()}` : suggested;
    const token = crypto.randomUUID();
    const boundWireVersion = wireOffer.kind === 'known' ? wireOffer.token : null;
    this.sql.exec(
      `INSERT INTO _snapback_connections (connection_id, token, opened_at_ms, wire_version) VALUES (?, ?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET token = excluded.token, opened_at_ms = excluded.opened_at_ms,
         wire_version = excluded.wire_version`,
      connectionId,
      token,
      Date.now(),
      boundWireVersion
    );
    return json(200, {
      connectionId,
      connectionToken: token,
      ...(boundWireVersion ? { wireVersion: boundWireVersion } : {}),
    });
  }

  // POST /app/ensure (LLP 0034 §5 semantics, Cloudflare projection): app code
  // is deploy-time compiled, so provisioning different artifacts is
  // impossible — a hash match reports 'matched', a mismatch reports 'gated'
  // (the honest "this profile cannot provision what you posted"), and the
  // seed half seeds only when every seed target table is empty.
  kitEnsureApp(payload) {
    // @ref LLP 0034#5 —
    // production provisioning is identity-gated and host-owned.
    const posted = payload || {};
    const strictDeclarationsRefusal = strictDeclarationsTargetRefusal(posted.schema, {
      targetProfile: CLOUDFLARE_TARGET_PROFILE,
      enforcesStrictDeclarations: false,
    });
    if (strictDeclarationsRefusal) {
      return kitError(
        400,
        strictDeclarationsRefusal.code,
        strictDeclarationsRefusal.message,
        strictDeclarationsRefusal.details,
      );
    }
    const schemaState = !posted.schema
      ? 'skipped-absent'
      : posted.schema.schemaHash === APP_SCHEMA_HASH
        ? 'matched'
        : 'gated';
    const functionsState = !posted.functions
      ? 'skipped-absent'
      : posted.functions.bundleHash === APP_BUNDLE_HASH
        ? 'matched'
        : 'gated';
    let seedState = 'skipped-absent';
    if (posted.seed && (!appSeed || canonicalJson(posted.seed) !== canonicalJson(appSeed))) {
      return kitError(
        403,
        'SNAPBACK_UNTRUSTED_SEED',
        'the Cloudflare production profile accepts only its compiled deployment seed'
      );
    }
    const identityMatched = schemaState === 'matched' && functionsState === 'matched';
    const testingProfile = this.env.SNAPBACK_TESTING === '1';
    if (appSeed && (identityMatched || testingProfile)) {
      // Caller bytes are never the seed source: even when an older generated
      // client posts the same seed for compatibility, the host uses the
      // compiled artifact after proving equality above.
      seedState = this.seedIfEmpty(appSeed) ? 'seeded' : 'skipped-nonempty';
    } else if (posted.seed || appSeed) {
      seedState = 'gated';
    }
    return json(200, {
      schema: schemaState,
      functions: functionsState,
      seed: seedState,
      profile: CLOUDFLARE_TARGET_PROFILE,
    });
  }

  // Host-side deterministic seeding (LLP 0049 Phase 0): seed rows carry
  // explicit ids (the demo's generated seed.json), inserted in one local
  // transaction at version 1 — mutation handlers address these rows by
  // stable id (patch-shaped upserts), so the seed is the schema's ground
  // state, not an app mutation.
  seedIfEmpty(seedSource) {
    const prepared = this.prepareSeed(seedSource);
    if (prepared.length === 0) return false;
    const names = [...new Set(prepared.map((entry) => entry.table))];
    for (const name of names) {
      const counts = [...this.sql.exec(`SELECT COUNT(*) AS count FROM ${this.physicalTable(name)}`)];
      if (counts.some((record) => Number(record.count) > 0)) return false;
    }
    this.ctx.storage.transactionSync(() => {
      this.applyPreparedSeed(prepared, Date.now());
    });
    return true;
  }

  prepareSeed(seedSource) {
    const tables = seedSource && seedSource.tables;
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return [];
    const prepared = [];
    for (const [name, rows] of Object.entries(tables)) {
      if (!APP_TABLES.has(name)) {
        throw codedError('SNAPBACK_UNKNOWN_TABLE', `seed references unknown table ${name}`);
      }
      if (!Array.isArray(rows)) {
        throw codedError('SNAPBACK_SEED_INVALID', `seed table ${name} must be an array`);
      }
      for (const input of rows) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw codedError('SNAPBACK_SEED_INVALID', `seed row for ${name} must be an object`);
        }
        let id = this.newId();
        if (Object.hasOwn(input, '_id')) {
          if (typeof input._id !== 'string' || input._id.length === 0) {
            throw codedError(
              'SNAPBACK_SEED_INVALID',
              `seed _id for ${name} must be a nonempty string`
            );
          }
          id = input._id;
        }
        const values = { ...input };
        delete values._id;
        const validated = validateWriteValues(APP_SCHEMA_TABLES, name, values, { insert: true });
        if (!validated.ok) throw codedError(validated.code, validated.message, validated.details);
        prepared.push({ table: name, id, values: validated.values });
      }
    }
    return prepared;
  }

  applyPreparedSeed(prepared, nowMs) {
    for (const entry of prepared) {
      const physical = this.physicalTable(entry.table);
      const stored = {
        ...entry.values,
        _id: entry.id,
        _version: 1,
        _createdAt: nowMs,
        _updatedAt: nowMs,
      };
      this.sql.exec(
        `INSERT INTO ${physical} (id, row_json) VALUES (?, ?)`,
        entry.id,
        this.serializeRow(entry.table, stored)
      );
    }
    if (prepared.length > 0 && this.currentVersion() < 1) {
      this.sql.exec('UPDATE _snapback_version SET version = 1 WHERE id = 1');
    }
  }

  // POST /query/:name — the kit's QueryOutput shape { version, rows }.
  async kitQuery(name, payload, authority) {
    const result = await this.invokeHandler(name, 'query', (payload && payload.args) || {}, authority);
    const response = !result.ok
      ? kitFailure(result)
      : json(200, { version: result.observedVersion ?? this.currentVersion(), rows: result.value });
    return this.prepareResultResponse(response, 'queryResponse');
  }

  // POST /mutation/:name — the committed MutationResponse envelope
  // { version, changed_count, result, receipt }.
  // @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — item 1: the hosted arm emits the required terminal
  //   mutation receipt (mutation.output.schema.json), mirroring the local
  //   record_mutation_commit facts (src/local.rs). Every field is honest on
  //   this arm: the id is minted per invocation (hosted has no
  //   client-mutation replay ledger, so clientMutationId is never echoed),
  //   affectedTables comes from the DECLARED write set (null when none is
  //   declared — explicitly unknown, never a silently-empty list), and
  //   correlation echoes the caller's opaque value verbatim.
  async kitMutation(name, payload, authority) {
    const receivedAtMs = Date.now();
    // Mint/read before invoking the handler: a metadata failure must not turn
    // an already-committed mutation into an ambiguous missing response.
    const authorityDescriptor = this.authorityDescriptor();
    const result = await this.invokeHandler(name, 'mutation', (payload && payload.args) || {}, authority);
    if (!result.ok) return this.prepareResultResponse(kitFailure(result), 'mutationAck');
    const commit = this.commit(result.host);
    const commitEgress = commit.committedAtMs == null
      ? null
      : this.networkProfiles.admitCommit(commit.committedAtMs);
    const fanOut = await this.prepareFanOut(commit, commitEgress);
    const fn = this.functionByName(name);
    const declaredTables =
      fn && Array.isArray(fn.tables) && fn.tables.length > 0 ? [...fn.tables] : null;
    const receipt = {
      kind: 'mutation',
      mutationId: `mut_${crypto.randomUUID().replaceAll('-', '')}`,
      mutation: name,
      outcome: 'confirmed',
      rollbackReason: null,
      affectedTables: declaredTables,
      snapshotVersion: commit.version,
      transport: 'http',
      correlation: payload && payload.correlation !== undefined ? payload.correlation : null,
      receivedAtMs,
    };
    const response = json(200, {
      version: commit.version,
      changed_count: commit.changes.length,
      result: result.value,
      authorityDescriptor,
      receipt,
    });
    const ackEgress = commit.committedAtMs == null
      ? this.networkProfiles.admitResult('mutationAck')
      : commitEgress?.forLane('mutationAck') ?? null;
    return this.preparedResponse(response, ackEgress, fanOut);
  }

  // POST /live/:name/subscribe — snapshot-with-subscribe under the invocation
  // mutex (the ENG-23575 rationale: the snapshot, the version read, and the
  // registry insert must not interleave with a commit). The registry row is
  // keyed by the granted connection id, so a kit socket for that connection
  // receives this subscription's fan-out.
  async kitSubscribe(name, payload, authority) {
    const fn = this.functionByName(name);
    if (!fn) {
      return kitError(400, 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY', `${name} is not a live query`);
    }
    if (fn.kind !== 'LiveQuery') {
      return kitError(400, 'SNAPBACK_FUNCTION_KIND_MISMATCH', `${name} is declared ${fn.kind}, not live query`);
    }
    const args = (payload && payload.input && payload.input.args) || {};
    const connectionId = String(payload.connection_id || '');
    const socketSessionId = this.currentSocketSession(connectionId);
    if (!socketSessionId) {
      return kitError(
        409,
        'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
        'a current authenticated WebSocket session is required before subscribing'
      );
    }
    const argsJson = canonicalJson(args);
    const admission = this.subscriptionAdmission({
      connectionId,
      functionName: name,
      argsJson,
      supersedes: typeof payload.supersedes === 'string' ? payload.supersedes : null,
      socketSessionId,
    });
    if (!admission.ok) {
      return kitError(admission.status, admission.code, admission.message, admission.details);
    }
    const result = await this.invokeHandler(name, 'query', args, authority);
    if (!result.ok) return kitFailure(result);
    if (this.currentSocketSession(connectionId) !== socketSessionId) {
      return kitError(
        409,
        'SNAPBACK_CONNECTION_SESSION_REPLACED',
        'the WebSocket session was replaced while the subscription snapshot was loading; retry on the current session'
      );
    }
    const version = result.observedVersion ?? this.currentVersion();
    // RQS token resume rides the subscribe input (LLP 0091 §0B.4 — not a new
    // route; the gateway's KIT_ROUTE already forwards this path, which is
    // the §0B.5 "forwarded from day one, by construction" obligation).
    const presented = (payload.input && (payload.input.resumeFromToken || payload.input.resume_from_token)) || null;
    const decision = this.rqsResumeDecision(fn, args, result.value, version, presented);
    const persisted = this.persistSubscription({
      connectionId,
      functionName: name,
      argsJson,
      supersedes: typeof payload.supersedes === 'string' ? payload.supersedes : null,
      socketSessionId,
    });
    if (!persisted.ok) {
      return kitError(persisted.status, persisted.code, persisted.message, persisted.details);
    }
    // Subscribe arms the demand-gated warm poll (LLP 0049 Phase 3).
    await this.reconcileCronActivation();
    if (decision.currentAsOf) {
      // Rung 1: no rows re-sent; the durable current_as_of frame rides the
      // connection's live socket (this arm's durable lane) and the subscribe
      // output carries no snapshot (LLP 0091 rung-2 amendment W4 step 5's
      // rows-free answer shape, applied to rung 1).
      const frame = {
        kind: 'current_as_of',
        subscription_id: persisted.subscriptionId,
        function: name,
        version,
        resume: decision.resume,
      };
      for (const socket of this.ctx.getWebSockets(connectionId)) {
        try {
          if (this.socketProtocolFor(socket) === 'kit'
            && this.socketSessionFor(socket) === socketSessionId) {
            socket.send(JSON.stringify(frame));
          }
        } catch (_) {}
      }
      return this.preparedResponse(json(200, {
        subscription_id: persisted.subscriptionId,
        snapshot: null,
        current_as_of: { version, resume: decision.resume },
        permission_epochs: {},
        ...(persisted.superseded ? { superseded: persisted.superseded } : {}),
        ...(persisted.supersessionRefusal ? { supersessionRefusal: persisted.supersessionRefusal } : {}),
      }), this.networkProfiles.admitTestSubscriptionStage());
    }
    return this.preparedResponse(json(200, {
      subscription_id: persisted.subscriptionId,
      snapshot: { version, rows: result.value },
      permission_epochs: {},
      ...(decision.resume ? { resume: decision.resume } : {}),
      ...(decision.refusalCode ? { resumeRefusal: decision.refusalCode } : {}),
      ...(persisted.superseded ? { superseded: persisted.superseded } : {}),
      ...(persisted.supersessionRefusal ? { supersessionRefusal: persisted.supersessionRefusal } : {}),
    }), this.networkProfiles.admitTestSubscriptionStage());
  }

  async kitUnsubscribe(payload) {
    const connectionId = String(payload.connection_id || '');
    const socketSessionId = this.currentSocketSession(connectionId);
    if (!socketSessionId) {
      return kitError(
        409,
        'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
        'a current authenticated WebSocket session is required before unsubscribing'
      );
    }
    // @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — item 2: the committed LiveUnsubscribeOutput shape
    //   (subscription_id + disposed). Unlike the local arm, an unknown or
    //   foreign id is not an error here (the session-scoped delete is the
    //   ownership cut): it answers disposed:false honestly.
    const subscriptionId = String(payload.subscription_id || '');
    const existing = [...this.sql.exec(
      'SELECT 1 AS present FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
      subscriptionId,
      connectionId,
      socketSessionId
    )];
    this.sql.exec(
      'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
      subscriptionId,
      connectionId,
      socketSessionId
    );
    // Last-unsubscribe cancels the warm-poll alarm (LLP 0049 Phase 3).
    await this.reconcileCronActivation();
    return json(200, { subscription_id: subscriptionId, disposed: existing.length > 0 });
  }

  // GET /live/:connectionId/stream — the kit's managed shared socket. The
  // token gate runs BEFORE the upgrade. Browser WebSockets cannot set
  // headers, so their token rides only the
  // `snapback.connection-token.<token>` subprotocol; non-browser clients may
  // use the explicit header. Query credentials are refused. The upgrade must
  // offer the connection's bound wire version (LLP 0094 §0B.4) and the socket
  // echoes it — a browser fails the connection when it offered subprotocols
  // and the server echoed none.
  async acceptKitSocket(request, connectionId, url) {
    // @ref LLP 0031#connection-capability-grants — browser bearer transport
    // is the subprotocol; URL credentials are outside the grant contract.
    if (request.headers.get('upgrade') !== 'websocket') {
      return kitError(426, 'SNAPBACK_UPGRADE_REQUIRED', 'expected websocket upgrade');
    }
    const protocols = (request.headers.get('sec-websocket-protocol') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const tokenProtocol = protocols.find((value) => value.startsWith('snapback.connection-token.'));
    const queryToken = url.searchParams.get('connection_token');
    if (queryToken && !request.headers.get('x-snapback-connection-token') && !tokenProtocol) {
      return kitError(
        401,
        'SNAPBACK_CONNECTION_TOKEN_QUERY_FORBIDDEN',
        'WebSocket connection tokens must use the connection-token header or snapback.connection-token subprotocol'
      );
    }
    const presented =
      request.headers.get('x-snapback-connection-token') ||
      (tokenProtocol ? tokenProtocol.slice('snapback.connection-token.'.length) : null);
    const denied = await this.verifyConnection(connectionId, presented);
    if (denied) return denied;
    // Wire-version classification (LLP 0094 §0B.4), after the credential
    // gate so protocol semantics are never disclosed to unauthenticated
    // callers, before the upgrade so every refusal is a pre-upgrade HTTP
    // response. The bound version is the lineage's explicit binding or the
    // implicit v1 of a legacy lineage.
    // @ref LLP 0094#0b4-socket-offer-requirement-and-the-equality-rule —
    //   classification precedes equality; the absent-class refusal is the B3
    //   bridge closure. The `/live/stream` proof socket is exempt and its
    //   handler (acceptLiveSocket) is deliberately untouched.
    const boundWireVersion = this.readConnectionGrant(connectionId)?.wireVersion ?? WIRE_VERSION_V1;
    const wireOffer = classifySocketWireVersionOffer(protocols, boundWireVersion);
    if (wireOffer === 'known-mismatch') {
      return kitError(
        400,
        'SNAPBACK_WIRE_VERSION_MISMATCH',
        "the socket wire-version offer does not equal this connection's bound version"
      );
    }
    if (wireOffer === 'unknown') {
      return kitError(
        400,
        'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
        `the socket offer contains no wire-version token this server supports; supported versions: ${SUPPORTED_WIRE_VERSIONS.join(', ')}`
      );
    }
    if (wireOffer === 'absent') {
      return kitError(
        400,
        'SNAPBACK_WIRE_VERSION_REQUIRED',
        `kit stream upgrades must offer the ${WIRE_VERSION_V1} wire-version subprotocol`
      );
    }
    const connectionSocketLimit = this.socketsPerConnectionLimit();
    const priorConnectionSockets = this.ctx.getWebSockets(connectionId).filter((socket) => {
      try {
        return this.socketProtocolFor(socket) === 'kit';
      } catch (_) {
        return false;
      }
    });
    // A reconnect is a replacement, not an additional resource claim. Close
    // every older tagged socket before checking the physical fail-safe caps;
    // otherwise undetected network loss can strand a grant at its cap and
    // permanently reject legitimate reconnects.
    for (const socket of priorConnectionSockets) {
      try {
        socket.close(1008, 'socket session replaced');
      } catch (_) {}
    }
    // Count everything the runtime still reports after close requests. Some
    // runtimes unregister synchronously and others do so after this handler;
    // the latter get a retryable 429 for this attempt, never a soft cap that
    // admits limit + 1 physical sockets.
    const connectionSockets = this.ctx.getWebSockets(connectionId).filter((socket) => {
      try {
        return this.socketProtocolFor(socket) === 'kit';
      } catch (_) {
        return false;
      }
    }).length;
    if (connectionSockets >= connectionSocketLimit) {
      return kitError(
        429,
        'SNAPBACK_CONNECTION_SOCKET_LIMIT',
        `one connection grant is limited to ${connectionSocketLimit} accepted WebSockets`,
        { limit: connectionSocketLimit }
      );
    }
    const socketLimit = this.acceptedSocketLimit();
    if (this.ctx.getWebSockets().length >= socketLimit) {
      return kitError(
        429,
        'SNAPBACK_ACCEPTED_SOCKET_LIMIT',
        `the coordinator is limited to ${socketLimit} accepted WebSockets`,
        { limit: socketLimit }
      );
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const socketSessionId = `wss_${crypto.randomUUID()}`;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'UPDATE _snapback_connections SET socket_session_id = ?, opened_at_ms = ? WHERE connection_id = ?',
        socketSessionId,
        Date.now(),
        connectionId
      );
      // A replacement socket owns a new session. Rows from the obsolete
      // session cannot represent demand and must not survive until its close
      // event (which may never arrive after hibernation/network loss).
      this.sql.exec(
        'DELETE FROM _snapback_subscriptions WHERE connection_id = ? AND socket_session_id IS NOT NULL AND socket_session_id <> ?',
        connectionId,
        socketSessionId
      );
    });
    this.ctx.acceptWebSocket(server, [connectionId]);
    server.serializeAttachment({ connectionId, protocol: 'kit', socketSessionId });
    await this.reconcileCronActivation();
    // The offer set reaching here contains the bound version (§0B.4 row 1):
    // select and echo it. Since B3 an offerless upgrade never reaches this
    // line, so the echo is unconditional.
    const headers = { 'sec-websocket-protocol': boundWireVersion };
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  // --- live subscriptions ------------------------------------------------

  acceptLiveSocket(request) {
    const proofSockets = this.ctx.getWebSockets().filter((socket) => {
      try {
        return this.socketProtocolFor(socket) === 'proof';
      } catch (_) {
        return false;
      }
    }).length;
    const socketLimit = this.legacyProofSocketLimit();
    if (proofSockets >= socketLimit) {
      return requestDiagnostic(
        429,
        'SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT',
        `the legacy proof WebSocket surface is limited to ${socketLimit} live sockets`,
        { limit: socketLimit }
      );
    }
    const totalSocketLimit = this.acceptedSocketLimit();
    if (this.ctx.getWebSockets().length >= totalSocketLimit) {
      return requestDiagnostic(
        429,
        'SNAPBACK_ACCEPTED_SOCKET_LIMIT',
        `the coordinator is limited to ${totalSocketLimit} accepted WebSockets`,
        { limit: totalSocketLimit }
      );
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const connectionId = crypto.randomUUID();
    // Hibernation API: acceptWebSocket (NOT server.accept()) so the object can
    // be evicted while holding the socket (LLP 0040 §Hibernation). The
    // per-socket attachment carries only connection identity (≤16 KB) — the
    // subscription registry lives in SQLite.
    this.ctx.acceptWebSocket(server, [connectionId]);
    server.serializeAttachment({ connectionId, protocol: 'proof' });
    return new Response(null, { status: 101, webSocket: client });
  }

  connectionIdFor(ws) {
    const attachment = ws.deserializeAttachment();
    return attachment && attachment.connectionId;
  }

  socketProtocolFor(ws) {
    const attachment = ws.deserializeAttachment();
    // Sockets accepted before the kit protocol existed carry no tag; they are
    // proof-protocol by construction.
    return (attachment && attachment.protocol) || 'proof';
  }

  socketSessionFor(ws) {
    const attachment = ws.deserializeAttachment();
    return attachment && attachment.socketSessionId;
  }

  currentSocketSession(connectionId) {
    const records = [...this.sql.exec(
      'SELECT socket_session_id FROM _snapback_connections WHERE connection_id = ?',
      connectionId
    )];
    return records.length === 0 || records[0].socket_session_id == null
      ? null
      : String(records[0].socket_session_id);
  }

  async webSocketMessage(ws, message) {
    const startupRefusal = this.servablePrecondition();
    if (startupRefusal) {
      const reason = this.startupError ? 'coordinator startup refused' : 'socket limits reconciling';
      try { ws.close(1013, reason); } catch (_) {}
      return;
    }
    // @ref LLP 0013#transport-contract — refuse over-limit or open-shaped
    // frames at the socket boundary before parsing or touching storage.
    const decoded = decodeLiveSocketFrame(message);
    if (!decoded.ok) {
      closeSocketWithDiagnostic(ws, decoded.closeCode, decoded.code);
      return;
    }
    const validated = validateLiveSocketFrame(decoded.value);
    if (!validated.ok) {
      closeSocketWithDiagnostic(ws, 1008, validated.code);
      return;
    }
    const parsed = validated.value;
    try {
      const connectionId = this.connectionIdFor(ws);
      if (this.socketProtocolFor(ws) === 'kit') {
        const socketSessionId = this.socketSessionFor(ws);
        if (!socketSessionId || socketSessionId !== this.currentSocketSession(connectionId)) {
          try { ws.close(1008, 'socket session replaced'); } catch (_) {}
          return;
        }
      }
      if (parsed.type === 'subscribe') {
        // Under the invocation mutex: the snapshot query, the version read, and
        // the registry insert must not interleave with a commit, or the rows
        // the snapshot carried predate a commit whose fan-out never saw the
        // registration — a silently skipped delta (ENG-23575).
        const socketSessionId = this.socketProtocolFor(ws) === 'kit' ? this.socketSessionFor(ws) : null;
        await this.runExclusive(() => {
          if (socketSessionId && socketSessionId !== this.currentSocketSession(connectionId)) return;
          return this.subscribe(ws, connectionId, parsed, socketSessionId);
        });
        await this.reconcileCronActivation();
      } else if (parsed.type === 'unsubscribe') {
        if (this.socketProtocolFor(ws) === 'kit') {
          this.sql.exec(
            'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
            parsed.subscriptionId,
            connectionId,
            this.socketSessionFor(ws)
          );
        } else {
          this.sql.exec('DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ?', parsed.subscriptionId, connectionId);
        }
        await this.reconcileCronActivation();
      } else if (parsed.type === 'ping') {
        // The kit heartbeat expects the local server's `kind` field (any frame
        // refreshes its freshness budget); the proof protocol pins `type`.
        if (this.socketProtocolFor(ws) === 'kit') {
          ws.send(JSON.stringify({ kind: 'pong', requestId: parsed.requestId, serverTimeMs: Date.now() }));
        } else {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      }
    } catch (_) {
      closeSocketWithDiagnostic(ws, 1011, 'SNAPBACK_LIVE_FRAME_PROCESSING_FAILED');
    }
  }

  async subscribe(ws, connectionId, parsed, socketSessionId = null) {
    // @ref LLP 0094#0a1-app-data-routes-root — §0C.6 item 6: every in-band reply on a KIT socket
    //   is kind-tagged kit dialect (matching current_as_of/pong); errors
    //   carry the fully-filled committed Diagnostic. Proof sockets keep the
    //   LLP 0040 pinned type-tagged frames byte-for-byte.
    const isKit = this.socketProtocolFor(ws) === 'kit';
    const sendKitError = (code, message, details = null) =>
      ws.send(JSON.stringify({ kind: 'error', diagnostic: wireDiagnostic(code, message, details) }));
    const fn = this.functionByName(parsed.name);
    if (!fn) {
      if (isKit) {
        sendKitError('SNAPBACK_LIVE_NOT_A_LIVE_QUERY', `${parsed.name} is not a live query`, { function: parsed.name });
      } else {
        ws.send(JSON.stringify({ type: 'error', code: 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY', name: parsed.name }));
      }
      return;
    }
    // @ref LLP 0040#whole-codebase-review-hardening-2026-07-12-eng-24341eng-24369--eng-24387eng-24388 —
    // every invocation boundary reports the same stable diagnostic for a
    // known function whose declared kind is incompatible with the route.
    if (fn.kind !== 'LiveQuery') {
      const message = `${parsed.name} is declared ${fn.kind}, not live query`;
      const details = { function: parsed.name, declaredKind: fn.kind, requestedMode: 'live-query' };
      if (isKit) {
        sendKitError('SNAPBACK_FUNCTION_KIND_MISMATCH', message, details);
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
          message,
          details,
          name: parsed.name,
        }));
      }
      return;
    }
    if (!isKit && fn.authRequirement !== 'public') {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'SNAPBACK_AUTH_REQUIRED',
        message: 'this live query requires a connection grant or admin authority',
        name: parsed.name,
      }));
      return;
    }
    const argsJson = canonicalJson(parsed.args || {});
    const admission = this.subscriptionAdmission({
      connectionId,
      functionName: parsed.name,
      argsJson,
      supersedes: typeof parsed.supersedes === 'string' ? parsed.supersedes : null,
      socketSessionId,
    });
    if (!admission.ok) {
      if (isKit) {
        sendKitError(admission.code, admission.message, admission.details ?? null);
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: admission.code,
          message: admission.message,
          ...(admission.details ? { details: admission.details } : {}),
        }));
      }
      return;
    }
    // Authoritative initial snapshot BEFORE any delta (LLP 0040 §Acceptance):
    // run the query, record the subscription at the resulting version, then
    // send the snapshot tagged with that version.
    const result = await this.invokeHandler(parsed.name, 'query', parsed.args, {
      authProjection: isKit ? CONNECTION_AUTH_PROJECTION : ANONYMOUS_AUTH_PROJECTION,
    });
    if (!result.ok) {
      if (isKit) {
        sendKitError(result.code, result.message, result.details ?? null);
      } else {
        ws.send(JSON.stringify({ type: 'error', code: result.code, message: result.message }));
      }
      return;
    }
    if (socketSessionId && socketSessionId !== this.currentSocketSession(connectionId)) return;
    const version = result.observedVersion ?? this.currentVersion();
    // RQS: fresh token + the D1.3 admission ladder (rungs 1 & 3), decided
    // under the same mutex hold as snapshot and registration (LLP 0090's
    // atomic answer-and-register rule).
    const decision = this.rqsResumeDecision(
      fn,
      parsed.args || {},
      result.value,
      version,
      parsed.resumeFromToken || null
    );
    const persisted = this.persistSubscription({
      connectionId,
      functionName: parsed.name,
      argsJson,
      supersedes: typeof parsed.supersedes === 'string' ? parsed.supersedes : null,
      socketSessionId,
    });
    if (!persisted.ok) {
      if (isKit) {
        sendKitError(persisted.code, persisted.message, persisted.details ?? null);
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          code: persisted.code,
          message: persisted.message,
          ...(persisted.details ? { details: persisted.details } : {}),
        }));
      }
      return;
    }
    if (decision.currentAsOf) {
      // Rung 1: the caller's held rows are current as of `version` — advance
      // the token without re-sending rows (LLP 0091 §0B.2). Only ever sent
      // to a subscriber that presented resumeFromToken, so decode ability is
      // implied by the request.
      ws.send(JSON.stringify(
        isKit
          ? {
              kind: 'current_as_of',
              subscription_id: persisted.subscriptionId,
              function: parsed.name,
              version,
              resume: decision.resume,
            }
          : {
              type: 'current_as_of',
              subscriptionId: persisted.subscriptionId,
              function: parsed.name,
              version,
              resume: decision.resume,
            }
      ));
      return;
    }
    ws.send(
      JSON.stringify(
        isKit
          ? {
              // Kit-dialect snapshot reply: kind-tagged with the same
              // snake_case members as the kit live_replace/current_as_of
              // frames; no proof-only connectionKey (the kit socket already
              // knows its connection identity).
              kind: 'snapshot',
              subscription_id: persisted.subscriptionId,
              function: parsed.name,
              version,
              rows: result.value,
              ...(decision.resume ? { resume: decision.resume } : {}),
              ...(decision.refusalCode ? { resumeRefusal: decision.refusalCode } : {}),
            }
          : {
              type: 'snapshot',
              subscriptionId: persisted.subscriptionId,
              function: parsed.name,
              version,
              rows: result.value,
              connectionKey: connectionId,
              ...(decision.resume ? { resume: decision.resume } : {}),
              ...(decision.refusalCode ? { resumeRefusal: decision.refusalCode } : {}),
            }
      )
    );
  }

  // Prepare fan-out under the coordinator serialization authority: rehydrate
  // durable subscriptions, re-run each query, serialize immutable frames,
  // stamp the commit-relative live deadline, and reserve per-connection FIFO
  // position. Physical waits and sends happen only after runExclusive returns.
  // @ref LLP 0167#observation-semantics--what-a-delay-means — two-phase
  //   release keeps observation latency out of commit admission.
  async prepareFanOut(commit, commitEgress) {
    if (commit.changes.length === 0) return [];
    // @ref LLP 0008#realtime-delivery — post-commit positive-data loss tears
    // down the affected socket and recovers through a fresh reconnect snapshot.
    try {
      // @ref LLP 0008#reactivity-and-read-sets — a false-positive re-query is
      // acceptable, while suppressing a possibly affected subscription is a
      // correctness bug. Declarations are not enforced ceilings, and this arm
      // does not yet persist the captured dependency witness with each durable
      // subscription, so conservatively select every live function. The
      // indexed registry queries below still limit work to functions that have
      // active subscriptions, and grouping shares one re-query across equal
      // function/argument shapes.
      const affectedFunctions = new Set(
        functions
          .filter((fn) => fn.kind === 'LiveQuery')
          .map((fn) => fn.name)
      );
      const sockets = this.ctx.getWebSockets();
      const byConnection = new Map();
      for (const ws of sockets) {
        const id = this.connectionIdFor(ws);
        if (!id) continue;
        if (this.socketProtocolFor(ws) === 'kit') {
          const session = this.socketSessionFor(ws);
          if (!session || session !== this.currentSocketSession(id)) continue;
        }
        byConnection.set(id, ws);
      }
      const subs = [];
      const affectedNames = [...affectedFunctions];
      if (affectedNames.length === 0) return [];
      for (const selection of compileSubscriptionSelections(affectedNames)) {
        for (const record of this.sql.exec(selection.sql, ...selection.params)) {
          subs.push(record);
        }
      }
      const groups = new Map();
      for (const sub of subs) {
        if (!affectedFunctions.has(sub.function_name)) continue;
        const ws = byConnection.get(sub.connection_id);
        if (!ws) continue;
        if (
          this.socketProtocolFor(ws) === 'kit' &&
          String(sub.socket_session_id || '') !== String(this.socketSessionFor(ws) || '')
        ) continue;
        const key = `${sub.function_name}\0${sub.args_json}`;
        let group = groups.get(key);
        if (!group) {
          group = { functionName: String(sub.function_name), argsJson: String(sub.args_json), members: [] };
          groups.set(key, group);
        }
        group.members.push({
          ws,
          subscriptionId: String(sub.subscription_id),
          protocol: this.socketProtocolFor(ws),
          connectionId: String(sub.connection_id),
          socketSessionId: sub.socket_session_id == null ? null : String(sub.socket_session_id),
        });
      }
      const pushes = [];
      for (const group of groups.values()) {
        // A woken object may have no live HostContext; re-run the query through
        // a fresh query invocation and share the result across identical
        // subscription shapes.
        pushes.push(this.prepareReplaceGroup(group, commitEgress?.forLane('liveDelta') ?? null));
      }
      return (await Promise.all(pushes)).flat();
    } catch (_) {
      try { this.recordFanOutFailure('SNAPBACK_LIVE_FANOUT_INTERNAL_FAILED'); } catch (_) {}
      try {
        for (const ws of this.ctx.getWebSockets()) {
          closeSocketWithDiagnostic(ws, 1011, 'SNAPBACK_LIVE_FANOUT_INTERNAL_FAILED');
        }
      } catch (_) {}
      return [];
    }
  }

  async prepareReplaceGroup(group, liveEgress) {
    let result;
    try {
      if (this.testFanOutQueryFailuresRemaining > 0) {
        this.testFanOutQueryFailuresRemaining -= 1;
        throw codedError('SNAPBACK_TEST_FANOUT_QUERY_FAILED', 'injected fan-out query failure');
      }
      result = await this.invokeHandler(group.functionName, 'query', JSON.parse(group.argsJson));
    } catch (_) {
      this.recoverFanOutGroup(group, 'SNAPBACK_LIVE_FANOUT_QUERY_FAILED');
      return [];
    }
    if (!result.ok) {
      this.recoverFanOutGroup(group, 'SNAPBACK_LIVE_FANOUT_QUERY_FAILED');
      return [];
    }

    const version = result.observedVersion ?? this.currentVersion();
    // RQS token refresh on the live path (LLP 0091 §0A.5): one mint per
    // result-change, shared across the entire fan-out group — the group IS
    // the (queryArtifact, argsHash) identity, so a single ResumeWire rides
    // every member's live_replace frame. Non-eligible groups mint nothing.
    let groupResume = null;
    try {
      const fn = this.functionByName(group.functionName);
      if (fn) {
        const facts = this.rqsFunctionFacts(fn);
        if (facts.digestKind) {
          groupResume = this.rqsMintResume(facts, JSON.parse(group.argsJson), version, result.value);
        }
      }
    } catch (_) {
      groupResume = null; // refresh is best-effort; delivery never depends on it
    }
    let encodedMembers;
    try {
      if (this.testFanOutSerializationFailuresRemaining > 0) {
        this.testFanOutSerializationFailuresRemaining -= 1;
        throw codedError('SNAPBACK_TEST_FANOUT_SERIALIZATION_FAILED', 'injected fan-out serialization failure');
      }
      encodedMembers = this.currentFanOutMembers(group.members).map((member) => {
        // Frame shape follows the socket's wire protocol: the kit client
        // consumes the local server's snake_case `kind` frames; the proof
        // acceptance suite pins the original camelCase `type` frames.
        // @ref LLP 0167#honesty-requirements — a delayed frame names its
        // profile from the immutable admission snapshot (kit snake_case
        // matches the Rust arm's generated wire field; proof frames carry
        // the same optional member on the legacy camelCase shape).
        const profileMarker = liveEgress && liveEgress.snapshot?.profile?.name !== 'normal'
          ? liveEgress.snapshot.profile.name
          : null;
        const frame = member.protocol === 'kit'
          ? {
              kind: 'live_replace',
              subscription_id: member.subscriptionId,
              function: group.functionName,
              version,
              rows: result.value,
              ...(groupResume ? { resume: groupResume } : {}),
              ...(profileMarker ? { network_profile: profileMarker } : {}),
            }
          : {
              type: 'live_replace',
              subscriptionId: member.subscriptionId,
              function: group.functionName,
              version,
              rows: result.value,
              ...(groupResume ? { resume: groupResume } : {}),
              ...(profileMarker ? { networkProfile: profileMarker } : {}),
            };
        return { member, encoded: JSON.stringify(frame) };
      });
    } catch (_) {
      this.recoverFanOutGroup(group, 'SNAPBACK_LIVE_FANOUT_SERIALIZATION_FAILED');
      return [];
    }
    return encodedMembers.map(({ member, encoded }) =>
      this.reserveLiveDelivery(member, encoded, liveEgress));
  }

  currentFanOutMembers(members) {
    return members.filter((member) =>
      member.protocol !== 'kit' ||
      member.socketSessionId === this.currentSocketSession(member.connectionId)
    );
  }

  recoverFanOutGroup(group, code) {
    this.recordFanOutFailure(code);
    for (const member of this.currentFanOutMembers(group.members)) {
      closeSocketWithDiagnostic(member.ws, 1011, code);
    }
  }

  recordFanOutFailure(code) {
    if (!Object.hasOwn(this.fanOutFailureCounters, code)) return;
    let persisted = false;
    try {
      this.sql.exec(
        `INSERT INTO _snapback_fanout_diagnostics (code, count, last_at_ms) VALUES (?, 1, ?)
         ON CONFLICT(code) DO UPDATE SET
           count = CASE WHEN count < ? THEN count + 1 ELSE count END,
           last_at_ms = excluded.last_at_ms`,
        code,
        Date.now(),
        Number.MAX_SAFE_INTEGER
      );
      persisted = true;
    } catch (_) {}
    if (!persisted) {
      this.fanOutFailureCounters[code] = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.fanOutFailureCounters[code] + 1
      );
    }
    try { console.warn('snapback live fan-out recovery', code); } catch (_) {}
  }

  fanOutDiagnostics() {
    const counters = { ...this.fanOutFailureCounters };
    try {
      for (const record of this.sql.exec('SELECT code, count FROM _snapback_fanout_diagnostics')) {
        const code = String(record.code);
        if (!Object.hasOwn(counters, code)) continue;
        counters[code] = Math.min(Number.MAX_SAFE_INTEGER, counters[code] + Number(record.count || 0));
      }
    } catch (_) {}
    return {
      counters,
      total: Math.min(
        Number.MAX_SAFE_INTEGER,
        Object.values(counters).reduce((sum, count) => sum + count, 0)
      ),
    };
  }

  async webSocketClose(ws) {
    const connectionId = this.connectionIdFor(ws);
    if (connectionId) {
      if (this.socketProtocolFor(ws) === 'kit') {
        const closingSession = this.socketSessionFor(ws);
        const currentSession = this.currentSocketSession(connectionId);
        if (currentSession && closingSession !== currentSession) return;
        this.sql.exec(
          'UPDATE _snapback_connections SET socket_session_id = NULL, opened_at_ms = ? WHERE connection_id = ? AND socket_session_id = ?',
          Date.now(),
          connectionId,
          closingSession
        );
        this.sql.exec(
          'DELETE FROM _snapback_subscriptions WHERE connection_id = ? AND socket_session_id = ?',
          connectionId,
          closingSession
        );
      } else {
        this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
      }
      // A departing socket may have been the last live subscriber: cancel
      // the warm-poll alarm so the idle object hibernates with zero wakeups.
      await this.reconcileCronActivation();
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  abandonActionsForReset() {
    for (const host of this.activeInvocations.values()) {
      if (host.mode !== 'action' || !host.control) continue;
      const message = 'the app was reset while this action was running; its buffered work was discarded';
      host.abandon('SNAPBACK_ACTION_RESET_ABORTED', message);
      if (host.control.abortController && !host.control.abortController.signal.aborted) {
        host.control.abortController.abort('SNAPBACK_ACTION_RESET_ABORTED');
      }
    }
  }

  resetOwnedTables() {
    const systemTables = [
      '_snapback_meta',
      '_snapback_changes',
      '_snapback_fanout_diagnostics',
      '_snapback_version',
      '_snapback_subscriptions_next',
      '_snapback_subscriptions',
      '_snapback_connections',
      '_snapback_connection_admission',
      '_snapback_cron_state',
      '_snapback_cron_claims',
      '_snapback_action_limits',
      '_snapback_action_mutation_results',
    ];
    const appTables = [...this.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\'"
    )].map((record) => String(record.name));
    for (const table of systemTables) {
      try {
        this.sql.exec(`DROP TABLE IF EXISTS ${table}`);
      } catch (error) {
        throw codedError('SNAPBACK_RESET_SCHEMA_REBUILD_FAILED', `could not drop ${table}: ${String(error && error.message || error)}`);
      }
    }
    for (const name of appTables) {
      if (!/^app_[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw codedError('SNAPBACK_RESET_OWNED_TABLE_INVALID', 'an owned app table has an invalid identifier');
      }
      try {
        this.sql.exec(`DROP TABLE "${name}"`);
      } catch (error) {
        throw codedError('SNAPBACK_RESET_SCHEMA_REBUILD_FAILED', `could not drop ${name}: ${String(error && error.message || error)}`);
      }
    }
  }

  async reset() {
    // Validate and serialize the compiled seed before the destructive
    // boundary. Any invalid artifact leaves the complete pre-reset state.
    const preparedSeed = appSeed ? this.prepareSeed(appSeed) : [];
    let seeded = false;
    const nextGeneration = this.nextResetGeneration();
    // @ref LLP 0028#scheduler-state-and-run-ledger — reset is an action
    // abandonment boundary; its generation is checked again at nested commit.
    this.ctx.storage.transactionSync(() => {
      this.resetOwnedTables();
      this.testResetFault('after-journal');
      this.sql.exec(`CREATE TABLE _snapback_meta (key TEXT PRIMARY KEY, value TEXT)`);
      // Recreate every known runtime table from this deployment. This does not
      // interpret an unknown future subscription schema and cannot retain a
      // retired app_* table or stale same-name index definition. Config cursor
      // state is deployment-owned and intentionally survives app reset.
      this.ensureCurrentSchema();
      this.testResetFault('after-runtime-state');
      this.testResetFault('after-app-rows');
      this.writeDeploymentMetadata();
      this.writeMeta('app_generation', String(nextGeneration));
      if (preparedSeed.length > 0) {
        this.applyPreparedSeed(preparedSeed, Date.now());
        seeded = true;
      }
      this.testResetFault('after-seed');
    });
    // Actions execute off the coordinator mutex. Publish abandonment only
    // after the SQL reset commits (a rolled-back reset must not kill valid
    // work). No await separates the commit from this loop, and queued nested
    // commits cannot enter until this reset releases the mutex. The persisted
    // generation also catches staged-but-not-yet-registered actions.
    this.abandonActionsForReset();
    // Only publish the recovered startup posture after the transaction
    // commits; a rolled-back reset must retain its stale refusal too.
    this.startupError = null;
    // Subscriptions and cron state are gone: drop any armed object alarm.
    const cleanupWarnings = [];
    try {
      if (this.env.SNAPBACK_TESTING === '1' && this.env.SNAPBACK_TEST_RESET_POST_COMMIT_ALARM_FAILURE === '1') {
        throw codedError('SNAPBACK_RESET_ALARM_CLEANUP_FAILED', 'injected post-commit alarm cleanup failure');
      }
      await this.reconcileCronActivation();
    } catch (error) {
      // The SQL transaction above is the reset linearization point. Alarm
      // cleanup is recoverable (a stale alarm wakes once, observes no armed
      // state, and disarms); it must never turn a committed reset into a 500
      // that falsely promises the old state survived.
      cleanupWarnings.push({
        code: (error && error.snapbackCode) || 'SNAPBACK_RESET_ALARM_CLEANUP_DEFERRED',
        message: 'reset committed, but alarm cleanup was deferred to the next coordinator wake',
      });
      console.warn('snapback reset post-commit alarm cleanup deferred', String((error && error.message) || error));
    }
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const frame =
          this.socketProtocolFor(ws) === 'kit'
            ? { kind: 'resync_required', reason: 'reset' }
            : { type: 'resync_required', reason: 'reset' };
        ws.send(JSON.stringify(frame));
      } catch (_) {}
    }
    return json(200, {
      reset: true,
      seeded,
      cleanup: cleanupWarnings.length === 0 ? 'complete' : 'deferred',
      ...(cleanupWarnings.length > 0 ? { warnings: cleanupWarnings } : {}),
    });
  }

  testResetFault(step) {
    if (this.env.SNAPBACK_TESTING === '1' && this.env.SNAPBACK_TEST_RESET_FAIL_AFTER === step) {
      throw codedError('SNAPBACK_RESET_INJECTED_FAILURE', `injected reset failure at ${step}`);
    }
  }
}

// A stale-deployment refusal (SNAPBACK_STALE_CLOUDFLARE_*): served on every
// data-plane request until the operator resets or migrates, never silently
// served over mismatched persistent state.
function staleArtifact(code, message, details) {
  return { ok: false, code, message, details };
}

function codedError(code, message, details = null) {
  const error = new Error(`${code}: ${message}`);
  error.snapbackCode = code;
  error.snapbackDetails = details;
  return error;
}

function functionKindMatchesMode(kind, mode) {
  if (mode === 'query') return kind === 'Query' || kind === 'LiveQuery';
  if (mode === 'mutation') return kind === 'Mutation';
  if (mode === 'action') return kind === 'Action';
  return false;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value ?? {}));
}

function decodeLiveSocketFrame(message) {
  let text;
  if (typeof message === 'string') {
    if (utf8ByteLengthExceeds(message, MAX_LIVE_SOCKET_FRAME_BYTES)) {
      return { ok: false, closeCode: 1009, code: 'SNAPBACK_LIVE_FRAME_TOO_LARGE' };
    }
    text = message;
  } else {
    let bytes;
    if (message instanceof ArrayBuffer) {
      bytes = new Uint8Array(message);
    } else if (ArrayBuffer.isView(message)) {
      bytes = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    } else {
      return { ok: false, closeCode: 1003, code: 'SNAPBACK_LIVE_FRAME_TYPE_UNSUPPORTED' };
    }
    if (bytes.byteLength > MAX_LIVE_SOCKET_FRAME_BYTES) {
      return { ok: false, closeCode: 1009, code: 'SNAPBACK_LIVE_FRAME_TOO_LARGE' };
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      return { ok: false, closeCode: 1007, code: 'SNAPBACK_LIVE_FRAME_INVALID_UTF8' };
    }
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (_) {
    return { ok: false, closeCode: 1007, code: 'SNAPBACK_LIVE_FRAME_INVALID_JSON' };
  }
  return { ok: true, value };
}

function utf8ByteLengthExceeds(value, limitBytes) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) {
      bytes += 1;
    } else if (unit <= 0x7ff) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      // BMP code points and unpaired surrogates both occupy three bytes under
      // TextEncoder's well-formed replacement behavior.
      bytes += 3;
    }
    if (bytes > limitBytes) return true;
  }
  return false;
}

function validateLiveSocketFrame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
  }
  const keys = Object.keys(value);
  const hasClosedKeys = (required, optional = []) => {
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
  };
  if (value.type === 'subscribe') {
    if (
      !hasClosedKeys(['type', 'name', 'args'], ['supersedes', 'resumeFromToken']) ||
      typeof value.name !== 'string' ||
      value.name.length === 0 ||
      !value.args ||
      typeof value.args !== 'object' ||
      Array.isArray(value.args) ||
      (Object.hasOwn(value, 'supersedes') && (typeof value.supersedes !== 'string' || value.supersedes.length === 0)) ||
      // RQS token resume rides the subscribe frame (LLP 0091 §0B.4). The
      // optional membershipWitness key is accepted for wire compatibility
      // but never upgrades the answer on this arm (rung 2 deferred; see
      // rqsResumeDecision).
      (Object.hasOwn(value, 'resumeFromToken') && !isValidResumeFromToken(value.resumeFromToken))
    ) {
      return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
    }
    return { ok: true, value };
  }
  if (value.type === 'unsubscribe') {
    if (
      !hasClosedKeys(['type', 'subscriptionId']) ||
      typeof value.subscriptionId !== 'string' ||
      value.subscriptionId.length === 0
    ) {
      return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
    }
    return { ok: true, value };
  }
  if (value.type === 'ping') {
    if (
      !hasClosedKeys(['type'], ['requestId']) ||
      (Object.hasOwn(value, 'requestId') && typeof value.requestId !== 'string')
    ) {
      return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
    }
    return { ok: true, value };
  }
  return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
}

function isValidResumeFromToken(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => key === 'resume' || key === 'membershipWitness')) return false;
  const resume = value.resume;
  if (!resume || typeof resume !== 'object' || Array.isArray(resume)) return false;
  if (typeof resume.token !== 'string' || resume.token.length === 0 || resume.token.length > 1024) return false;
  return true;
}

function closeSocketWithDiagnostic(ws, closeCode, diagnosticCode) {
  try { ws.close(closeCode, diagnosticCode); } catch (_) {}
}

function configuredTestFailureCount(value, env) {
  if (env.SNAPBACK_TESTING !== '1') return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 0;
}

function boundUtf8Text(value, limitBytes) {
  const text = String(value || '');
  const encoded = UTF8_ENCODER.encode(text);
  if (encoded.byteLength <= limitBytes) return text;
  const suffix = '...[truncated]';
  const suffixBytes = UTF8_ENCODER.encode(suffix).byteLength;
  let end = Math.max(0, limitBytes - suffixBytes);
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${new TextDecoder().decode(encoded.subarray(0, end))}${suffix}`;
}

function secretRedactionPatterns(value) {
  const raw = String(value || '');
  if (!raw) return [];
  const normalized = new Set([raw]);
  try { normalized.add(raw.normalize('NFC')); } catch (_) {}
  try { normalized.add(raw.normalize('NFD')); } catch (_) {}
  const patterns = [];

  // Match one whole normalized secret while permitting each UTF-16 code unit
  // to appear either raw or as a JSON Unicode escape. Building the alternation
  // per unit covers full and partially escaped strings, surrogate-pair escapes
  // for astral characters, and mixed hex casing (the regexp is insensitive)
  // without ever redacting a mere prefix of the secret.
  for (const candidate of normalized) {
    const units = [];
    for (let index = 0; index < candidate.length; index += 1) {
      const unit = candidate.charCodeAt(index);
      const alternatives = [
        regexEscape(candidate[index]),
        jsonBackslashEscapePattern(`u${unit.toString(16).padStart(4, '0')}`),
      ];
      const shortEscape = jsonShortEscape(unit);
      if (shortEscape) alternatives.push(jsonBackslashEscapePattern(shortEscape.slice(1)));
      units.push(`(?:${alternatives.join('|')})`);
    }
    patterns.push(new RegExp(units.join(''), 'gi'));
  }

  const variants = new Set(normalized);
  // Include two reversible URL/form encoding layers; proxies and JSON APIs
  // commonly echo an already-encoded query value after encoding it again.
  for (let round = 0; round < 2; round += 1) {
    for (const candidate of [...variants]) {
      try { variants.add(encodeURIComponent(candidate)); } catch (_) {}
      try {
        const params = new URLSearchParams();
        params.set('v', candidate);
        variants.add(params.toString().slice(2));
      } catch (_) {}
    }
  }
  for (const encoded of [...variants].sort((left, right) => right.length - left.length)) {
    if (encoded.length > 0 && !normalized.has(encoded)) patterns.push(new RegExp(regexEscape(encoded), 'gi'));
  }
  return patterns;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonBackslashEscapePattern(suffix) {
  // `\\+` in the regexp means one-or-more literal backslashes. A JSON body
  // that itself carries a textual `\uXXXX` escape doubles that backslash;
  // accepting either depth (and further reversible JSON wrapping) prevents
  // the encoding layer from becoming a redaction bypass.
  return `\\\\+${regexEscape(suffix)}`;
}

function jsonShortEscape(unit) {
  if (unit === 0x08) return '\\b';
  if (unit === 0x09) return '\\t';
  if (unit === 0x0a) return '\\n';
  if (unit === 0x0c) return '\\f';
  if (unit === 0x0d) return '\\r';
  if (unit === 0x22) return '\\"';
  if (unit === 0x2f) return '\\/';
  if (unit === 0x5c) return '\\\\';
  return null;
}

function normalizeSqlDefinition(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function workerVersionMetadata(env) {
  const metadata = env && env.SNAPBACK_VERSION_METADATA;
  if (!metadata || typeof metadata !== 'object' || typeof metadata.id !== 'string' || metadata.id.length === 0) {
    return null;
  }
  return {
    id: metadata.id,
    tag: typeof metadata.tag === 'string' ? metadata.tag : '',
    timestamp: typeof metadata.timestamp === 'string' ? metadata.timestamp : '',
  };
}

async function readBoundedTextStream(stream, limitBytes) {
  if (stream === null) return { ok: true, text: '' };
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limitBytes) {
        await reader.cancel('SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE');
        return {
          ok: false,
          code: 'SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE',
          message: `host fetch response exceeded ${limitBytes} bytes`,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch (_) {
    try { await reader.cancel('SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8'); } catch (_) {}
    return {
      ok: false,
      code: 'SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8',
      message: 'host fetch response was not valid UTF-8',
    };
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  // A normal object's magic __proto__ setter can swallow an owned JSON key,
  // making the persisted subscription args differ from the initial query.
  // Null-prototype output preserves every JSON-owned key through stringify.
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function configuredPendingInvocationLimit(env) {
  const configured = Number(env.SNAPBACK_MAX_PENDING_INVOCATIONS);
  // A zero-capacity queue is a deterministic testing seam for the admission
  // envelope. Production always accepts at least one invocation, and no
  // override may raise the cap above the request-chain-safe default.
  if (env.SNAPBACK_TESTING === '1' && configured === 0) return 0;
  if (Number.isSafeInteger(configured) && configured > 0) {
    return Math.min(configured, DEFAULT_MAX_PENDING_INVOCATIONS);
  }
  return DEFAULT_MAX_PENDING_INVOCATIONS;
}

function failure(result) {
  const body = { ok: false, code: result.code, message: result.message };
  if (result.details) body.details = result.details;
  return body;
}

// Kit-protocol errors carry the local server's ApiError envelope — a non-2xx
// status with a structured `diagnostic` — which demos/_kit/client.mjs turns
// into its coded Error (and keys grant refresh on).
// @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — item 3: the inner Diagnostic is fully filled
//   (code/severity/subsystem/message/details), matching the versioned
//   error.response.schema.json envelope.
function kitError(status, code, message, details = null) {
  return json(status, wireErrorResponse(wireDiagnostic(code, message, details)));
}

function kitFailure(result) {
  return json(
    clientFailureCode(result.code) ? 400 : 500,
    wireErrorResponse(wireDiagnostic(result.code, result.message, result.details ?? null)),
  );
}

function clientFailureCode(code) {
  return new Set([
    'SNAPBACK_FUNCTION_KIND_MISMATCH',
    'SNAPBACK_UNKNOWN_TABLE',
    'SNAPBACK_UNKNOWN_FIELD',
    'SNAPBACK_QUERY_UNKNOWN_INDEX',
    'SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED',
    'SNAPBACK_QUERY_FILTER_VALUE_INVALID',
    'SNAPBACK_QUERY_IN_ITEMS_EXCEEDED',
    'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED',
    'SNAPBACK_QUERY_LIMIT_INVALID',
    'SNAPBACK_FIELD_MISSING',
    'SNAPBACK_FIELD_TYPE_MISMATCH',
    'SNAPBACK_SYSTEM_FIELD_WRITE',
  ]).has(code);
}

function requestDiagnostic(status, code, message, details = null) {
  const diagnostic = { code, message, ...(details ? { details } : {}) };
  // Keep both the proof protocol's top-level code and the pinned diagnostic
  // member so every proof/system JSON endpoint keeps one stable 4xx shape.
  // Kit routes never take this branch: their parse refusals ride the
  // versioned ErrorResponse via kitError (LLP 0094 §0C.7).
  return json(status, { ok: false, code, message, diagnostic });
}

async function parseJsonObjectRequest(request, { allowEmpty = false, allowAny = false, errorDialect = 'proof' } = {}) {
  // @ref LLP 0094#0c7-errorresponse-format-version-and-forward-skew-2026-08-08 — kit-route parse refusals emit the versioned
  //   ErrorResponse; the LLP 0040 proof/system lanes keep their pinned
  //   {ok, code, message, diagnostic} shape.
  const refuse = errorDialect === 'kit' ? kitError : requestDiagnostic;
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      response: refuse(
        413,
        'SNAPBACK_REQUEST_TOO_LARGE',
        `JSON request body exceeds the ${MAX_REQUEST_BYTES}-byte limit`,
        { limitBytes: MAX_REQUEST_BYTES }
      ),
    };
  }

  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    if (allowEmpty && request.body === null) return { ok: true, value: {} };
    return {
      ok: false,
      response: refuse(
        415,
        'SNAPBACK_CONTENT_TYPE_UNSUPPORTED',
        'JSON endpoints require Content-Type: application/json'
      ),
    };
  }

  let text = '';
  let totalBytes = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_REQUEST_BYTES) {
          await reader.cancel('SNAPBACK_REQUEST_TOO_LARGE');
          return {
            ok: false,
            response: refuse(
              413,
              'SNAPBACK_REQUEST_TOO_LARGE',
              `JSON request body exceeds the ${MAX_REQUEST_BYTES}-byte limit`,
              { limitBytes: MAX_REQUEST_BYTES }
            ),
          };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (_) {
      try {
        await reader.cancel('SNAPBACK_UTF8_INVALID');
      } catch (_) {}
      return {
        ok: false,
        response: refuse(400, 'SNAPBACK_UTF8_INVALID', 'request body is not valid UTF-8'),
      };
    }
  }
  if (text.trim().length === 0) {
    if (allowEmpty) return { ok: true, value: {} };
    return {
      ok: false,
      response: refuse(400, 'SNAPBACK_JSON_BODY_REQUIRED', 'a JSON object request body is required'),
    };
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (_) {
    return {
      ok: false,
      response: refuse(400, 'SNAPBACK_JSON_INVALID', 'request body is not valid JSON'),
    };
  }
  if (!allowAny && (!value || typeof value !== 'object' || Array.isArray(value))) {
    return {
      ok: false,
      response: refuse(400, 'SNAPBACK_JSON_OBJECT_REQUIRED', 'request body must be a JSON object'),
    };
  }
  return { ok: true, value };
}

function json(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
