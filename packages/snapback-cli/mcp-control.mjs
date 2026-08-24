// The LLP 0042 control-plane MCP server: newline-delimited JSON-RPC 2.0 over
// stdio, exposing the pinned control-plane tools plus the generated app-data
// catalog. Lifecycle tools embed the CLI's process-lifecycle helpers; served
// operations project 1:1 over `POST /_snapback/api/host-ops`.
//
// @ref LLP 0042#control-plane-server — lifecycle is CLI-embedded (spawn with
//   --ready-file, HostReadyDescriptor consumption, nonce-verified stop); the
//   served operations proxy the host-ops HTTP surface, never a second dialect.
// @ref LLP 0042#implementation-decisions-recorded-for-sc-1b-2026-07-23 — ships
//   inside @expo/snapback-cli; the app-data catalog is derived deterministically at
//   server start from the codegen-emitted artifacts.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  diagnosticError,
  managedAdminToken,
  native,
  readReadyDescriptor,
  resolveRuntimeBinary,
  runtimeSpawnEnvironment,
  validateDevTarget,
  waitForReady,
} from './index.mjs';
import { stopProcessGroup } from './process-teardown.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SCHEMA_VERSION = 'snapback.v0';
const INPUT_SCHEMA_VALIDATOR = new Ajv2020({ allErrors: true, strict: false });
// Every MCP tool returns the same structured host-operations envelope. Keep
// one output schema object so pinned control tools and generated app-data
// tools cannot drift into distinct result dialects.
//
// @ref LLP 0024#result-envelope — MCP structuredContent is the shared
// hostOpsResult envelope, including understood ok:false outcomes.
export const HOST_OPS_RESULT_OUTPUT_SCHEMA = {
  type: 'object',
  required: [
    'schemaVersion', 'resultKind', 'requestId', 'operation', 'ok', 'target',
    'authority', 'artifacts', 'data', 'diagnostics', 'next',
  ],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    resultKind: { const: 'hostOpsResult' },
    requestId: { type: 'string' },
    operation: { type: 'string' },
    ok: { type: 'boolean' },
    target: { type: 'object' },
    authority: { type: ['object', 'null'] },
    artifacts: { type: 'object' },
    data: true,
    diagnostics: { type: 'array', items: { type: 'object' } },
    next: { type: 'array' },
  },
};
// @ref LLP 0167#profile-model — MCP projects Rust's finite built-in
// vocabulary and delay ceiling through a Rust-checked package artifact.
const NETWORK_PROFILE_AUTHORITY = readJson(join(
  dirname(fileURLToPath(import.meta.url)),
  'network-profile-authority.json',
));
// The native response charges the complete HostOpsResult, while maxBytes
// bounds its nested export-page data. Target/authority/artifact fields are
// fixed-shape; this allowance is asserted by the native HTTP proof fixture.
const TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE = 64 * 1024;
// @ref LLP 0024#authority-tuple — the five pinned modes; the local slice
// serves the first four and refuses servicePrincipal honestly.
const LOCAL_AUTHORITY_MODES = ['none', 'unauthenticated', 'devUser', 'devAdminBypass'];
const CONTROL_CATALOG_URI = 'snapback-controls://catalog';
const CONTROL_INSTANCE_URI = 'snapback-controls://instance';
const CONTROL_OPERATION_URI_PREFIX = 'snapback-controls://operation/';

// These declarations are the MCP-resource projection facts consumed by the
// control-catalog compiler. Content still comes from the native binary at
// request time; this array contains names/annotations only, never a catalog
// or Guide snapshot.
//
// @ref LLP 0184#4-agent-discovery-and-setup — the control server re-serves
// build-matched resources from its co-installed native runtime.
export const CONTROL_RESOURCES = [
  {
    operation: 'control.catalog.read',
    uri: CONTROL_CATALOG_URI,
    name: 'control-catalog',
    title: 'Snapback control catalog — searchable index',
    description: 'Search operation, title, and intents in the exact catalog embedded in the co-installed native binary.',
    annotations: { readOnlyHint: true },
  },
  {
    operation: 'control.catalog.describe',
    uriTemplate: `${CONTROL_OPERATION_URI_PREFIX}{operation}`,
    name: 'control-operation',
    title: 'Describe one Snapback control operation',
    description: 'Read one complete build-catalog row by stable operation id.',
    annotations: { readOnlyHint: true },
  },
  {
    operation: 'control.catalog.instance.read',
    uri: CONTROL_INSTANCE_URI,
    name: 'control-catalog-instance',
    title: 'Running Snapback instance availability snapshot',
    description: 'Read the admin-gated instance projection and refuse unless its catalogDigest matches this native build.',
    annotations: { readOnlyHint: true },
  },
];

const AUTHORITY_INPUT_SCHEMA = {
  type: 'object',
  required: ['mode'],
  additionalProperties: false,
  properties: {
    mode: { enum: [...LOCAL_AUTHORITY_MODES, 'servicePrincipal'] },
    userId: { type: 'string', description: 'app user id; required for devUser' },
    roles: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string', description: 'required for devAdminBypass' },
  },
};

const DATA_PATCH_AUTHORITY_INPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode', 'actorPrincipal', 'effectivePrincipal', 'localDevOnly',
        'adminBypass', 'scope', 'reason',
      ],
      properties: {
        mode: { const: 'devUser' },
        actorPrincipal: { type: 'null' },
        effectivePrincipal: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'roles'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            roles: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        localDevOnly: { const: true },
        adminBypass: { const: false },
        scope: { type: 'null' },
        reason: { type: ['string', 'null'] },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode', 'actorPrincipal', 'effectivePrincipal', 'localDevOnly',
        'adminBypass', 'scope', 'reason',
      ],
      properties: {
        mode: { const: 'devAdminBypass' },
        actorPrincipal: { type: 'null' },
        effectivePrincipal: { type: 'null' },
        localDevOnly: { const: true },
        adminBypass: { const: true },
        scope: { type: 'null' },
        reason: { type: 'string', minLength: 1 },
      },
    },
  ],
};

const DATA_PATCH_INPUT_PROPERTIES = {
  table: { type: 'string', minLength: 1 },
  rowId: { type: 'string', minLength: 1 },
  expectedVersion: { type: 'integer', minimum: 0 },
  patch: { type: 'object' },
  authority: DATA_PATCH_AUTHORITY_INPUT_SCHEMA,
  reason: { type: 'string', minLength: 1 },
};

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function dataPatchInputDigest(input) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalJson(input))).digest('hex')}`;
}

function diagnostic(code, message, details = undefined) {
  return {
    code,
    severity: 'error',
    subsystem: 'mcp-control',
    message,
    ...(details === undefined ? {} : { details }),
  };
}

function requestId() {
  return `mcp_${randomUUID().replaceAll('-', '')}`;
}

function encodedAdminPathSegment(value, argument) {
  if (typeof value !== 'string' || value.length === 0 || /[/?#]/.test(value)) {
    throw diagnosticError(
      'SNAPBACK_MCP_ARGUMENT_INVALID',
      `${argument} must be a non-empty URL path segment without /, ?, or #`,
      { argument },
    );
  }
  return encodeURIComponent(value);
}

function packageVersion() {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), 'package.json');
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// @ref LLP 0024#generated-app-data-mcp-catalog — deterministic
// `snapback_fn_<functionId>` names: sanitize to lowercase ASCII letters,
// digits, underscores; on collision append a stable short hash of the
// original function id and emit a diagnostic.
export function functionToolName(functionId, taken) {
  const sanitized = functionId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const name = `snapback_fn_${sanitized}`;
  if (!taken.has(name)) return { toolName: name, collided: false };
  const hash = createHash('sha256').update(functionId).digest('hex').slice(0, 8);
  return { toolName: `${name}_${hash}`, collided: true };
}

// Derive the app-data catalog from the codegen-emitted artifacts. A pure
// function of `<backend>/generated`; no separate committed catalog artifact.
export function buildAppDataCatalog(backendRoot) {
  const generated = join(backendRoot, 'generated');
  const manifestPath = join(generated, 'functions.manifest.json');
  const diagnostics = [];
  if (!existsSync(manifestPath)) {
    diagnostics.push(diagnostic(
      'SNAPBACK_MCP_CATALOG_ARTIFACTS_MISSING',
      `no generated function manifest at ${manifestPath}; run \`snapback generate\` first`,
      { manifestPath },
    ));
    return { catalog: null, diagnostics };
  }
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const capabilityPath = join(generated, 'capability.manifest.json');
  const capability = existsSync(capabilityPath) ? readJson(capabilityPath) : null;
  const gaps = new Set(capability?.capabilityGaps ?? []);
  const taken = new Set();
  const entries = [];
  for (const fn of manifest.functions ?? []) {
    const { toolName, collided } = functionToolName(fn.id, taken);
    taken.add(toolName);
    if (collided) {
      diagnostics.push(diagnostic(
        'SNAPBACK_MCP_TOOL_NAME_COLLISION',
        `sanitized tool name for ${fn.id} collided; appended a stable hash`,
        { functionId: fn.id, toolName },
      ));
    }
    const argsSchemaPath = join(generated, 'operations', `${fn.name}.args.schema.json`);
    let inputSchema = { type: 'object' };
    if (existsSync(argsSchemaPath)) {
      inputSchema = readJson(argsSchemaPath);
    } else {
      diagnostics.push(diagnostic(
        'SNAPBACK_MCP_ARGS_SCHEMA_MISSING',
        `no generated args schema for ${fn.id}; accepting any object`,
        { functionId: fn.id, argsSchemaPath },
      ));
    }
    const kind = fn.kind === 'Mutation' ? 'mutation' : fn.kind === 'Action' ? 'action' : 'query';
    const requiredCapabilities = fn.requiredCapabilities ?? [];
    entries.push({
      toolName,
      functionId: fn.id,
      title: fn.exportedName ?? fn.name,
      description: `Generated ${kind} ${fn.id} (auth: ${fn.authRequirement}; `
        + `syncability: ${fn.syncabilityClass}; capabilities: ${requiredCapabilities.join(', ') || 'none'})`,
      inputSchema,
      outputSchema: HOST_OPS_RESULT_OUTPUT_SCHEMA,
      kind,
      requiredCapabilities,
      capabilityGaps: requiredCapabilities.filter((name) => gaps.has(name)),
      syncabilityClass: fn.syncabilityClass ?? null,
      authorityRequired: kind === 'query'
        ? { explicitTuple: false, allowedModes: LOCAL_AUTHORITY_MODES }
        : { explicitTuple: true, allowedModes: LOCAL_AUTHORITY_MODES },
      dryRunSupported: false,
      sourceSpan: fn.sourceSpan ?? null,
      bundleHash: manifest.bundleHash ?? null,
    });
  }
  return {
    catalog: {
      schemaVersion: SCHEMA_VERSION,
      catalogKind: 'appDataMcpCatalog',
      appId: manifest.appId,
      bundleHash: manifest.bundleHash ?? null,
      functionManifestHash: `sha256:${createHash('sha256').update(manifestText).digest('hex')}`,
      generatedAt: new Date().toISOString(),
      targetProfile: capability?.targetProfileId ?? null,
      capabilitySummary: {
        supported: capability?.supportedCapabilities ?? [],
        gaps: [...gaps],
      },
      defaultAuthorityPolicy: {
        local: { queries: 'default', mutations: 'explicit-authority-tuple' },
        hosted: { queries: 'servicePrincipal', mutations: 'rejected-until-hosted-gates' },
      },
      entries,
    },
    diagnostics,
  };
}

export const CONTROL_TOOLS = [
  {
    name: 'snapback_start',
    operation: 'host.start',
    title: 'Start or attach to the local Snapback server',
    description: 'Spawn the native server with --ready-file and wait for the readiness descriptor, or attach to a running server named by an existing descriptor.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_stop',
    operation: 'host.stop',
    title: 'Stop the local Snapback server',
    description: 'Stop the server named by the readiness descriptor via the nonce-verified native stop.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_restart',
    operation: 'host.restart',
    title: 'Restart the local Snapback server',
    description: 'Stop then start with one request id and one result envelope.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_inspect',
    operation: 'app.inspect',
    title: 'Inspect the running app',
    description: 'Runtime state, loaded artifacts, and recent diagnostics (data.recentInvocations).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_network_profile_get',
    operation: 'debug.networkProfileGet',
    title: 'Read the active network condition profile',
    description: 'Return the active profile and activation provenance through debug.networkProfileGet.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_network_profile_set',
    operation: 'debug.networkProfileSet',
    title: 'Set the active network condition profile',
    description: 'Activate a built-in name or inline profile through the server shared activation gate.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['profile'],
      properties: {
        profile: {
          oneOf: [
            { type: 'string', enum: [...NETWORK_PROFILE_AUTHORITY.builtinNames] },
            {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'mutationAckDelayMs', 'liveDeltaDelayMs', 'queryResponseDelayMs'],
              properties: {
                name: { type: 'string' },
                mutationAckDelayMs: { type: 'integer', minimum: 0, maximum: NETWORK_PROFILE_AUTHORITY.delayCeilingMs },
                liveDeltaDelayMs: { type: 'integer', minimum: 0, maximum: NETWORK_PROFILE_AUTHORITY.delayCeilingMs },
                queryResponseDelayMs: { type: 'integer', minimum: 0, maximum: NETWORK_PROFILE_AUTHORITY.delayCeilingMs },
                jitterMs: { type: 'integer', minimum: 0, maximum: NETWORK_PROFILE_AUTHORITY.delayCeilingMs, default: 0 },
              },
            },
          ],
        },
        operatorPrincipal: {
          type: 'string',
          description: 'Optional authenticated local operator principal; requires the process-bound impersonation capability.',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_telemetry_stats',
    operation: 'telemetry.stats',
    title: 'Read aggregate telemetry health',
    description: 'Counts, error rates, latency percentiles, coverage, and variance from the typed telemetry.stats operation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string' }, name: { type: 'string' },
        fromMs: { type: 'integer' }, toMs: { type: 'integer' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_telemetry_events',
    operation: 'telemetry.events',
    title: 'Read a bounded telemetry event page',
    description: 'Filter and page raw telemetry events through an automatically minted scoped, budgeted secret-read lease.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string' }, name: { type: 'string' }, status: { type: 'integer' },
        code: { type: 'string' }, correlation: { type: 'string' },
        fromMs: { type: 'integer' }, toMs: { type: 'integer' }, text: { type: 'string' },
        cursorRecordedTsMs: { type: 'integer' }, cursorId: { type: 'integer' },
        order: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_telemetry_export',
    operation: 'telemetry.export',
    title: 'Export one bounded telemetry page',
    description: 'Read one immutable-snapshot export page with declared row/byte ceilings and an opaque continuation token.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string' }, name: { type: 'string' }, status: { type: 'integer' },
        code: { type: 'string' }, correlation: { type: 'string' },
        fromMs: { type: 'integer' }, toMs: { type: 'integer' }, text: { type: 'string' },
        continuationToken: { type: 'string' },
        maxRows: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 4194304, default: 4194304 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_errors_issues',
    operation: 'errors.issues',
    title: 'List error issues',
    description: 'Read structural issue titles and counters; defaults may be narrowed with the release-sequence since preset.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string', enum: ['open', 'resolved', 'ignored', 'regressed'] },
        kind: { type: 'string' }, name: { type: 'string' }, subsystem: { type: 'string' },
        failureDisposition: { type: 'string' }, release: { type: 'string' }, since: { type: 'string' },
        fromMs: { type: 'integer' }, toMs: { type: 'integer' },
        order: { type: 'string', enum: ['lastSeen', 'count'], default: 'lastSeen' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_errors_issue',
    operation: 'errors.issue',
    title: 'Inspect one error issue',
    description: 'Read raw retained templates and stack heads through an automatically minted scoped, budgeted secret-read lease.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issue'],
      properties: { issue: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_errors_transition',
    operation: 'errors.transition',
    title: 'Transition error issue state',
    description: 'Apply one state-sequence CAS, or atomically resolve open/regressed issues older than a release.',
    inputSchema: {
      oneOf: [
        {
          type: 'object', additionalProperties: false,
          required: ['issue', 'to', 'expectSeq'],
          properties: {
            issue: { type: 'string' },
            to: { type: 'string', enum: ['open', 'resolved', 'ignored'] },
            expectSeq: { type: 'integer', minimum: 0 },
          },
        },
        {
          type: 'object', additionalProperties: false,
          required: ['selector', 'to'],
          properties: {
            selector: {
              type: 'object', additionalProperties: false,
              required: ['openBefore'], properties: { openBefore: { type: 'string' } },
            },
            to: { const: 'resolved' },
          },
        },
      ],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_reset',
    operation: 'app.reset',
    title: 'Reset local app state',
    description: 'Deterministically clear local app state, optionally applying a seed. Destructive; requires an explicit authority tuple.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['authority'],
      properties: { seed: { type: 'object' }, authority: AUTHORITY_INPUT_SCHEMA },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_data_patch_preview',
    operation: 'data.patch.preview',
    title: 'Preview one bounded direct row patch',
    description: 'Validate an existing-row closed field patch and retain its short-lived apply capability privately inside this MCP process. Local non-production primary targets only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['table', 'rowId', 'expectedVersion', 'patch', 'authority', 'reason'],
      properties: DATA_PATCH_INPUT_PROPERTIES,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_data_patch_apply',
    operation: 'data.patch.apply',
    title: 'Apply one previewed bounded direct row patch',
    description: 'Consume the privately retained apply capability selected by its non-authorizing id and commit the exact previewed patch. Destructive; local non-production primary targets only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'table', 'rowId', 'expectedVersion', 'patch', 'authority', 'reason',
        'applyTokenId',
      ],
      properties: {
        ...DATA_PATCH_INPUT_PROPERTIES,
        applyTokenId: {
          type: 'string',
          pattern: '^sha256:[0-9a-f]{64}$',
          description: 'Non-authorizing id returned by snapback_data_patch_preview.',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_load_schema',
    operation: 'schema.load',
    title: 'Load the generated schema manifest',
    description: 'POST schema.load with the generated schema manifest (defaults to <backend>/generated/schema.manifest.json).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { schemaPath: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_load_functions',
    operation: 'functions.load',
    title: 'Load the generated function manifest',
    description: 'POST functions.load with the generated function manifest (defaults to <backend>/generated/functions.manifest.json).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { functionsPath: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_run_function',
    operation: 'function.run',
    title: 'Run one generated function',
    description: 'Run a generated query or mutation by function id. Mutations require an explicit authority tuple.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['function'],
      properties: {
        function: { type: 'string', description: 'function id or unique exported name' },
        args: { type: 'object' },
        authority: AUTHORITY_INPUT_SCHEMA,
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_remediation_apply',
    operation: 'remediation.apply',
    title: 'Apply one generation-fenced remediation item',
    description: 'Consume an exact machine-applicable item from diagnostic.details.remediationSet and return its repaired identifier without invoking or mutating application state.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'artifactHash', 'item'],
      properties: {
        schemaVersion: { const: 'snapback.remediation-apply.v1' },
        artifactHash: { type: 'string', pattern: '^sha256:[0-9a-f]{16}([0-9a-f]{48})?$' },
        item: {
          type: 'object',
          required: ['kind', 'riskClass', 'machineApplicable', 'requiresApproval', 'authorityEffect', 'precondition', 'action'],
          properties: {
            kind: { type: 'string' },
            riskClass: { type: 'string' },
            machineApplicable: { type: 'boolean' },
            requiresApproval: { type: 'boolean' },
            authorityEffect: { type: 'string' },
            precondition: { type: 'object' },
            action: { type: 'object' },
          },
        },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  // --- LLP 0184 Phase 2 P1: read and diagnose ------------------------------
  {
    name: 'snapback_data_scan',
    operation: 'data.scan',
    title: 'Bounded read-only table scan',
    description: 'Project DataQuery as shipped: table, limit, offset. No cursor exists on this route — offset paging is not stable under concurrent writes; a row may shift pages between two calls. Mints a scoped, budgeted secret-read lease automatically.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['table'],
      properties: {
        table: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_asset_list',
    operation: 'asset.list',
    title: 'List assets by availability state',
    description: 'asset.list — pending | ready | rejected | deleted (omitted lists all).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { state: { type: 'string', enum: ['pending', 'ready', 'rejected', 'deleted'] } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_asset_inspect',
    operation: 'asset.inspect',
    title: 'Inspect one asset',
    description: "asset.inspect — one asset's lifecycle, receipts, quota, reference edges, and ledger claims. Never byte samples, staging keys, or bearer URLs.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['assetId'],
      properties: {
        assetId: { type: 'string' },
        userId: { type: 'string', description: 'Read as this app user (owner/via-references authorization); omitted reads as the operator.' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_asset_retry',
    operation: 'asset.retry',
    title: 'Re-drive pending asset work',
    description: 'asset.retry — generation-fenced re-drive of pending publication and ledger work; never reopens a terminal attempt.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['assetId'],
      properties: { assetId: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_config_status',
    operation: 'config.status',
    title: 'Read config status',
    description: "config.status — the full per-entry state machine: names, states, generations, diagnostics. Never values.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_config_plan',
    operation: 'config.plan',
    title: 'Dry-run a config entry write',
    description: 'config.plan — write locus, required credentials, the apply boundary, and whether this transport would accept a value write. No write occurs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { entry: { type: 'string', description: 'Narrow to one declared entry; omitted plans every entry.' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_config_verify',
    operation: 'config.verify',
    title: 'Verify one config entry',
    description: "config.verify — run the entry's probe action. Reports ok/not-ok and the probe diagnostic; never the configured value.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['entry'],
      properties: { entry: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_cron_list',
    operation: 'cron.list',
    title: 'List cron jobs',
    description: 'Read declared cron identities and current activation/next/last scheduler posture. Omits run ids, handler diagnostics/results, and jitter seeds.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_jobs_list',
    operation: 'jobs.list',
    title: 'List one-off jobs',
    description: 'jobs.list — the bounded one-off job inspection page (read-only).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_jobs_show',
    operation: 'jobs.show',
    title: 'Show one job',
    description: "jobs.show — one job's full recorded state by id (read-only).",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_acceptance_run',
    operation: 'acceptance.run',
    title: 'Run the local acceptance suite (unbuilt)',
    description: 'Pinned by LLP 0024; the runner is deferred, so this returns the structured SNAPBACK_HOST_OP_UNIMPLEMENTED envelope.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { profile: { type: 'string' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  // @ref LLP 0184#p2-controlled-mutations — config.unset carries no secret
  // value, so it needs no secret carrier (unlike config.set, which stays
  // cliOnly for v1 per §Product contract); LLP 0036 pairs a 1:1
  // snapback_config_* MCP mapping with the CLI verb.
  {
    name: 'snapback_config_unset',
    operation: 'config.unset',
    title: 'Unset a config entry',
    description: 'Remove one config entry\'s stored value. Carries only the entry identifier; no value crosses the wire.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['entry'],
      properties: { entry: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_cron_tick',
    operation: 'cron.tick',
    title: 'Force-claim and run every due cron job',
    description: 'Typed projection of the admin-gated forced cron dispatch route. Bounded to currently-due jobs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_cron_run',
    operation: 'cron.runOne',
    title: 'Force-run one named cron job',
    description: 'Force-claim and run one cron job by name, regardless of its schedule.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['name'],
      properties: { name: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_ephemeral_cleanup',
    operation: 'ephemeral.cleanup',
    title: 'Preview or apply bounded ephemeral expiry cleanup',
    description: 'Count or remove entries whose expiry deadline is at/before an explicit cutoff. The tool binds the request to the current server startup and returns a room-count receipt.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['dryRun', 'maxEntries'],
      oneOf: [
        { required: ['olderThanMs'] },
        { required: ['cutoffTimestampMs'] },
      ],
      properties: {
        olderThanMs: { type: 'integer', minimum: 0, description: 'Select entries whose expiry deadline is at least this old.' },
        cutoffTimestampMs: { type: 'integer', minimum: 0, description: 'Select entries whose expiry deadline is at or before this Unix millisecond timestamp.' },
        dryRun: { type: 'boolean', description: 'True previews without deletion; false applies ordinary expiry removals.' },
        maxEntries: { type: 'integer', minimum: 1, maximum: 10_000 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_jobs_drain',
    operation: 'jobs.drain',
    title: 'Drain due one-off jobs',
    description: 'Claim and run due one-off jobs under an injected clock (nowMs) and bounded cascade waves (maxWaves).',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        nowMs: { type: 'integer', description: 'Injected drain clock, epoch ms. Absent means wall clock.' },
        maxWaves: { type: 'integer', minimum: 1 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  // @ref LLP 0184#p2-controlled-mutations — an explicit debug perturbation
  // of one live connection, never application disconnect authority. The
  // underlying route carries no request body; `reason` is recorded in this
  // tool's own receipt, not acknowledged by the server.
  {
    name: 'snapback_connection_disconnect',
    operation: 'connection.disconnect',
    title: 'Force-disconnect one live connection (debug perturbation)',
    description: 'Force-close one connection by id for local debugging. This is not application disconnect authority.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['connectionId', 'reason'],
      properties: {
        connectionId: { type: 'string' },
        reason: { type: 'string', description: 'Why this debug perturbation is being invoked; recorded in the receipt.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  // @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — the
  // inspected room incarnation and entry generation are one fence, and the
  // receipt discloses that application authorization was never evaluated.
  {
    name: 'snapback_ephemeral_operator_delete',
    operation: 'ephemeral.operatorDelete',
    title: 'Operator-bypass delete of one ephemeral entry (debug/repair)',
    description: 'Administrator delete of a specifically inspected ephemeral entry, fenced on BOTH the room scope epoch and entry generation together. Never evaluates application authorization — this is an explicit operator bypass, disclosed as such in the receipt. Distinct from an application deleting its own ephemeral entry.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['collection', 'scope', 'entryKey', 'expectedScopeEpoch', 'expectedEntryGeneration', 'reason'],
      properties: {
        collection: { type: 'string' },
        scope: { type: 'object', description: 'The room scope, e.g. {"boardId":"board-1"}.' },
        entryKey: { type: 'string' },
        expectedScopeEpoch: { type: 'integer', description: 'Fails closed if this does not match the room\'s current epoch.' },
        expectedEntryGeneration: { type: 'integer', description: 'Fails closed if this does not match the entry\'s current generation. Epoch and generation are both required and both checked — generation alone is not fencing-safe against a reborn room.' },
        reason: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  // @ref LLP 0184#b-forced-live-resync--add-now — v1 targets exactly one
  // subscription, fenced by connectionId + subscriptionId (the same UUIDv7
  // identity the operator inspect projection already exposes) plus the
  // running server's startupNonce, filled in from this server's own
  // readiness descriptor — never a caller-supplied value, so an agent
  // cannot fence a request against a server other than the one this MCP
  // process is actually managing. Connection-wide targeting is explicitly
  // out of v1 scope (OQ4). Local non-production only; refused on a primary
  // hosted/production target or a derived instance until LLP 0158 grants
  // recognition for this purpose.
  {
    name: 'snapback_live_force_resync',
    operation: 'debug.live.forceResync',
    title: 'Force one live subscription to resync (debug perturbation)',
    description: 'Force one live subscription through the normal resync_required recovery path for local debugging. Changes no application data.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['connectionId', 'subscriptionId', 'reason'],
      properties: {
        connectionId: { type: 'string' },
        subscriptionId: { type: 'string' },
        reason: { type: 'string', description: 'Why this debug perturbation is being invoked; recorded in the receipt.' },
        clearRetained: { type: 'boolean', description: 'Also discard retained rows on the client rather than keep them until the fresh snapshot lands. Defaults to false.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  // @ref LLP 0184#p2-controlled-mutations — direct MCP tools for the
  // already-shipped asset delete/GC/key-rotation/export/import CLI paths.
  // asset.list/inspect/retry are the P1 read/diagnose projection (a
  // parallel LLP 0184 workstream) and are intentionally not added here.
  // These all route through the host-ops multiplexer, exactly like the
  // shipped CLI (`snapback assets ...`).
  {
    name: 'snapback_asset_delete',
    operation: 'asset.delete',
    title: 'Delete one asset',
    description: 'Explicit authorized delete through asset.delete; refuses while typed references remain.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['assetId'],
      properties: {
        assetId: { type: 'string' },
        userId: { type: 'string', description: 'Delete as this app user (owner authority); omitted deletes as the operator.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'snapback_asset_gc_sweep',
    operation: 'asset.gcSweep',
    title: 'Run asset reclamation and publication maintenance',
    description: 'Run every asset reclamation and publication-maintenance class at an explicit injected millisecond timestamp.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['nowMs'],
      properties: { nowMs: { type: 'integer', description: 'Injected Unix time in milliseconds; required so runs are deterministic.' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_asset_rotate_signing_key',
    operation: 'asset.rotateSigningKey',
    title: 'Rotate the asset delivery signing key',
    description: 'Retire every signing key and mint a fresh one; every outstanding signed URL stops validating.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_asset_export_cut',
    operation: 'asset.exportCut',
    title: 'Export a consistent asset cut',
    description: 'Write the consistent-cut manifest and every referenced blob object, digest-verified, into an empty directory on the server host.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['dir'],
      properties: { dir: { type: 'string', description: 'Absolute path of an empty (or absent) export directory, on the server host.' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'snapback_asset_import_cut',
    operation: 'asset.importCut',
    title: 'Validate or apply an exported asset cut',
    description: 'Validate an export directory (refuse-partial); with apply, restore it onto an empty asset state (requires SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1 server-side).',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['dir'],
      properties: {
        dir: { type: 'string', description: 'Absolute path of the export directory to validate or apply, on the server host.' },
        apply: { type: 'boolean', default: false, description: 'Apply the validated cut (empty-target restore).' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

// This tool intentionally lives only on mcp-control. The Rust `snapback mcp`
// server remains resource-only; the control server wraps the native CLI's
// exact-symbol-first, Markdown-section-second Guide lookup.
//
// @ref LLP 0042#dated-amendment-network-profile-control-tools-2026-08-04-proposed —
// the resource-first Guide server exposes no tools; tools belong here.
export const GUIDE_SEARCH_TOOL = {
  name: 'snapback_guide_search',
  operation: 'guide.search',
  title: 'Search the build-matched Snapback Guide',
  description: 'Search exact API symbols first, then matching Guide sections, using the co-installed native binary.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      slice: { type: 'integer', minimum: 1, default: 1 },
    },
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

function appDataToolInputSchema(entry) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['args'],
    properties: {
      args: entry.inputSchema,
      authority: AUTHORITY_INPUT_SCHEMA,
    },
  };
}

export function requireMatchingControlCatalogIdentity(catalog, instance) {
  const buildDigest = catalog?.catalogDigest;
  const instanceDigest = instance?.catalogDigest;
  if (typeof buildDigest !== 'string' || typeof instanceDigest !== 'string') {
    throw diagnosticError(
      'SNAPBACK_MCP_CONTROL_CATALOG_IDENTITY_INVALID',
      'the build catalog or instance projection has no catalogDigest',
      { buildDigest: buildDigest ?? null, instanceDigest: instanceDigest ?? null },
    );
  }
  if (buildDigest !== instanceDigest) {
    throw diagnosticError(
      'SNAPBACK_MCP_CONTROL_CATALOG_IDENTITY_MISMATCH',
      'the co-installed native build catalog does not match the running instance projection; refusing to combine them',
      { buildDigest, instanceDigest },
    );
  }
  return { catalog, instance };
}

export class McpControlServer {
  constructor(options = {}) {
    this.backendRoot = resolve(options.backendDirectory ?? 'snapback');
    this.projectRoot = resolve(options.projectRoot ?? dirname(this.backendRoot));
    const stateRoot = join(this.projectRoot, '.snapback');
    // @ref LLP 0042#open-questions — the first slice binds one project root
    // per server process, which makes snapback_stop's target unambiguous.
    this.readyFile = resolve(options.readyFile ?? join(stateRoot, 'dev.ready.json'));
    this.database = resolve(options.database ?? join(stateRoot, 'dev.sqlite3'));
    this.env = options.env;
    this.runtimeBinary = options.runtimeBinary;
    this.spawnSync = options.spawnSync ?? spawnSync;
    this.runtime = null;
    this.child = null;
    this.managed = false;
    this.dataPatchTokens = new Map();
    this.nativeCatalogCache = null;
    this.nativeControlDescriptionCache = new Map();
    this.nativeGuideCache = new Map();
    this.nativeGuideSearchCache = new Map();
    this.toolValidators = new Map();
    const { catalog, diagnostics } = buildAppDataCatalog(this.backendRoot);
    this.catalog = catalog;
    this.catalogDiagnostics = diagnostics;
  }

  resolveRuntime() {
    this.runtime ??= resolveRuntimeBinary({ runtimeBinary: this.runtimeBinary });
    return this.runtime;
  }

  nativeResourceUnavailable(error) {
    const underlying = error?.diagnostic ?? diagnostic(
      error?.code ?? 'SNAPBACK_RUNTIME_BINARY_MISSING',
      error?.message ?? String(error),
    );
    return diagnostic(
      'SNAPBACK_MCP_NATIVE_DOCUMENTATION_UNAVAILABLE',
      'Guide and control-catalog resources are unavailable because no compatible co-installed native Snapback binary could provide the build-matched bytes',
      { underlying },
    );
  }

  runNativeJson(args, code, message) {
    const runtime = this.resolveRuntime();
    const result = native(runtime.binary, args, {
      cwd: this.projectRoot,
      env: this.env,
    });
    if (result.status !== 0) {
      throw diagnosticError(code, message, {
        status: result.status,
        signal: result.signal ?? null,
        stderr: result.stderr?.slice(0, 2_000) ?? '',
      });
    }
    try {
      return { value: JSON.parse(result.stdout), text: result.stdout.trimEnd() };
    } catch (cause) {
      const error = diagnosticError(code, `${message}: native output was not JSON`, {});
      error.cause = cause;
      throw error;
    }
  }

  nativeControlCatalog() {
    if (this.nativeCatalogCache !== null) return this.nativeCatalogCache;
    const output = this.runNativeJson(
      ['controls', 'list', '--json'],
      'SNAPBACK_MCP_CONTROL_CATALOG_UNAVAILABLE',
      'the co-installed native control catalog could not be read',
    );
    if (output.value?.schemaVersion !== 'snapback.control-catalog.v1'
      || typeof output.value?.catalogDigest !== 'string'
      || !Array.isArray(output.value?.entries)) {
      throw diagnosticError(
        'SNAPBACK_MCP_CONTROL_CATALOG_INVALID',
        'the co-installed native binary returned an invalid control catalog',
        {},
      );
    }
    this.nativeCatalogCache = output;
    return this.nativeCatalogCache;
  }

  nativeControlDescription(operation) {
    const catalogDigest = this.nativeControlCatalog().value.catalogDigest;
    const cacheKey = `${catalogDigest}:${operation}`;
    const cached = this.nativeControlDescriptionCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const output = this.runNativeJson(
      ['controls', 'describe', operation, '--json'],
      'SNAPBACK_MCP_CONTROL_DESCRIPTION_UNAVAILABLE',
      `the co-installed native control row ${operation} could not be read`,
    );
    if (output.value?.catalogDigest !== catalogDigest) {
      throw diagnosticError(
        'SNAPBACK_MCP_CONTROL_CATALOG_IDENTITY_MISMATCH',
        `the co-installed native control row ${operation} does not match the cached build catalog`,
        { buildDigest: catalogDigest, descriptionDigest: output.value?.catalogDigest ?? null },
      );
    }
    this.nativeControlDescriptionCache.set(cacheKey, output);
    return output;
  }

  nativeGuideRequest(method, params = {}) {
    const catalogDigest = this.nativeControlCatalog().value.catalogDigest;
    const cacheKey = `${catalogDigest}:${method}:${JSON.stringify(canonicalJson(params))}`;
    const cached = this.nativeGuideCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const runtime = this.resolveRuntime();
    const request = { jsonrpc: '2.0', id: 1, method, params };
    const result = this.spawnSync(runtime.binary, ['mcp'], {
      cwd: this.projectRoot,
      env: runtimeSpawnEnvironment(runtime.binary, this.env),
      encoding: 'utf8',
      input: `${JSON.stringify(request)}\n`,
      timeout: 30_000,
    });
    if (result.status !== 0) {
      throw diagnosticError(
        'SNAPBACK_MCP_NATIVE_GUIDE_UNAVAILABLE',
        'the co-installed native Guide MCP server could not provide build-matched resources',
        {
          status: result.status,
          signal: result.signal ?? null,
          stderr: result.stderr?.slice(0, 2_000) ?? '',
        },
      );
    }
    let response;
    try {
      response = JSON.parse(result.stdout.trim());
    } catch (cause) {
      const error = diagnosticError(
        'SNAPBACK_MCP_NATIVE_GUIDE_INVALID',
        'the co-installed native Guide MCP server returned invalid JSON',
        {},
      );
      error.cause = cause;
      throw error;
    }
    if (response?.error) {
      throw diagnosticError(
        'SNAPBACK_MCP_NATIVE_GUIDE_UNAVAILABLE',
        `the co-installed native Guide MCP server refused ${method}: ${response.error.message}`,
        { nativeErrorCode: response.error.code },
      );
    }
    const output = response?.result;
    this.nativeGuideCache.set(cacheKey, output);
    return output;
  }

  nativeGuideSearch(query, slice) {
    const catalogDigest = this.nativeControlCatalog().value.catalogDigest;
    const cacheKey = `${catalogDigest}:${query}:${slice}`;
    const cached = this.nativeGuideSearchCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const envelope = this.runNativeJson(
      ['guide', query, '--slice', String(slice), '--json'],
      'SNAPBACK_MCP_GUIDE_SEARCH_UNAVAILABLE',
      'the co-installed native Guide search could not run',
    ).value;
    this.nativeGuideSearchCache.set(cacheKey, envelope);
    return envelope;
  }

  controlResourceCatalog(catalog) {
    const identity = {
      'snapback/catalogDigest': catalog.catalogDigest,
      'snapback/readOnly': true,
    };
    const resources = [
      {
        uri: CONTROL_CATALOG_URI,
        name: 'control-catalog',
        title: 'Snapback control catalog — searchable index',
        description: 'Search operation ids, titles, and intents; bytes come from the co-installed native binary.',
        mimeType: 'application/json',
        annotations: { readOnlyHint: true },
        _meta: { ...identity, 'snapback/operation': 'control.catalog.read' },
      },
      {
        uri: CONTROL_INSTANCE_URI,
        name: 'control-catalog-instance',
        title: 'Running Snapback instance availability snapshot',
        description: 'Requires a running ready-file target and refuses a catalogDigest mismatch.',
        mimeType: 'application/json',
        annotations: { readOnlyHint: true },
        _meta: { ...identity, 'snapback/operation': 'control.catalog.instance.read' },
      },
    ];
    for (const entry of catalog.entries) {
      resources.push({
        uri: `${CONTROL_OPERATION_URI_PREFIX}${encodedAdminPathSegment(entry.operation, 'operation')}`,
        name: entry.operation,
        title: entry.title,
        description: `Complete control-catalog row for ${entry.operation}`,
        mimeType: 'application/json',
        annotations: { readOnlyHint: true },
        _meta: { ...identity, 'snapback/operation': 'control.catalog.describe' },
      });
    }
    return resources;
  }

  controlResourceTemplates(catalog) {
    return [{
      uriTemplate: `${CONTROL_OPERATION_URI_PREFIX}{operation}`,
      name: 'control-operation',
      title: 'Describe one Snapback control operation',
      description: 'Substitute an operation id from snapback-controls://catalog.',
      mimeType: 'application/json',
      annotations: { readOnlyHint: true },
      _meta: {
        'snapback/catalogDigest': catalog.catalogDigest,
        'snapback/operation': 'control.catalog.describe',
        'snapback/readOnly': true,
      },
    }];
  }

  async readControlResource(uri) {
    if (typeof uri !== 'string') return null;
    if (uri === CONTROL_CATALOG_URI) {
      const { value, text } = this.nativeControlCatalog();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text,
          _meta: {
            'snapback/catalogDigest': value.catalogDigest,
            'snapback/readOnly': true,
          },
        }],
      };
    }
    if (uri === CONTROL_INSTANCE_URI) {
      const { value: catalog } = this.nativeControlCatalog();
      const { ok, status, payload } = await this.adminFetch(
        'GET',
        '/_snapback/api/control-catalog/instance',
      );
      if (!ok) {
        throw diagnosticError(
          'SNAPBACK_MCP_CONTROL_INSTANCE_UNAVAILABLE',
          `the running instance projection returned HTTP ${status}`,
          { status, payload },
        );
      }
      requireMatchingControlCatalogIdentity(catalog, payload);
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(payload, null, 2),
          _meta: {
            'snapback/catalogDigest': catalog.catalogDigest,
            'snapback/startupNonce': payload.startupNonce,
            'snapback/readOnly': true,
          },
        }],
      };
    }
    if (uri.startsWith(CONTROL_OPERATION_URI_PREFIX)) {
      let operation;
      try {
        operation = decodeURIComponent(uri.slice(CONTROL_OPERATION_URI_PREFIX.length));
      } catch {
        throw diagnosticError('SNAPBACK_MCP_CONTROL_OPERATION_INVALID', 'control operation URI is invalid', { uri });
      }
      if (!operation || operation.includes('/')) {
        throw diagnosticError('SNAPBACK_MCP_CONTROL_OPERATION_INVALID', 'control operation URI is invalid', { uri });
      }
      const { value, text } = this.nativeControlDescription(operation);
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text,
          _meta: {
            'snapback/catalogDigest': value.catalogDigest,
            'snapback/operation': operation,
            'snapback/readOnly': true,
          },
        }],
      };
    }
    return null;
  }

  currentDescriptor() {
    if (!existsSync(this.readyFile)) {
      throw diagnosticError(
        'SNAPBACK_MCP_SERVER_NOT_RUNNING',
        `no readiness descriptor at ${this.readyFile}; call snapback_start first`,
        { readyFile: this.readyFile, next: [{ kind: 'callTool', tool: 'snapback_start' }] },
      );
    }
    return validateDevTarget(readReadyDescriptor(this.readyFile), {
      readyFile: this.readyFile,
      database: this.database,
    });
  }

  envelope(operation, overrides = {}) {
    return {
      schemaVersion: SCHEMA_VERSION,
      resultKind: 'hostOpsResult',
      requestId: overrides.requestId ?? requestId(),
      operation,
      ok: false,
      target: {
        appId: this.catalog?.appId ?? '',
        appRoot: this.projectRoot,
        targetProfile: this.catalog?.targetProfile ?? 'local-dev-sqlite-ibex',
        serverUrl: overrides.serverUrl ?? null,
      },
      authority: null,
      artifacts: { schemaHash: null, bundleHash: null, databaseVersion: null },
      data: {},
      diagnostics: [],
      next: [],
      ...overrides,
    };
  }

  // Authority-tuple gate for reset and mutations (queries pass without one).
  // Returns { refusal } with a structured envelope on rejection; the refusal
  // is still a successful MCP tool result per the shared-envelope rule.
  //
  // @ref LLP 0042#authority — devAdminBypass requires an explicit recorded
  //   reason; hosted servicePrincipal stays rejected until its gates land.
  checkAuthority(authority, { required, operation, tool }) {
    const retry = (example) => [{ kind: 'retryWithAuthority', tool, authorityExample: example }];
    if (authority === undefined || authority === null) {
      if (!required) return {};
      return {
        refusal: this.envelope(operation, {
          diagnostics: [diagnostic(
            'SNAPBACK_MCP_AUTHORITY_REQUIRED',
            `${tool} mutates app state and requires an explicit authority tuple`,
            { tool },
          )],
          next: retry({ mode: 'devUser', userId: '<app user id>' }),
        }),
      };
    }
    if (typeof authority !== 'object' || typeof authority.mode !== 'string') {
      return {
        refusal: this.envelope(operation, {
          diagnostics: [diagnostic('SNAPBACK_MCP_AUTHORITY_INVALID', 'authority must be an object with a mode', { tool })],
          next: retry({ mode: 'devUser', userId: '<app user id>' }),
        }),
      };
    }
    if (authority.mode === 'servicePrincipal') {
      return {
        refusal: this.envelope(operation, {
          diagnostics: [diagnostic(
            'SNAPBACK_MCP_AUTHORITY_MODE_UNAVAILABLE',
            'servicePrincipal authority is not served by the local control-plane slice',
            { tool, mode: authority.mode },
          )],
          next: retry({ mode: 'devUser', userId: '<app user id>' }),
        }),
      };
    }
    if (!LOCAL_AUTHORITY_MODES.includes(authority.mode)) {
      return {
        refusal: this.envelope(operation, {
          diagnostics: [diagnostic(
            'SNAPBACK_MCP_AUTHORITY_MODE_UNKNOWN',
            `unknown authority mode ${authority.mode}`,
            { tool, allowedModes: LOCAL_AUTHORITY_MODES },
          )],
          next: retry({ mode: 'devUser', userId: '<app user id>' }),
        }),
      };
    }
    const devUserId = authority.userId ?? authority.effectivePrincipal?.userId;
    if (authority.mode === 'devUser' && typeof devUserId !== 'string') {
      return {
        refusal: this.envelope(operation, {
          diagnostics: [diagnostic('SNAPBACK_MCP_AUTHORITY_INVALID', 'devUser authority requires a userId', { tool })],
          next: retry({ mode: 'devUser', userId: '<app user id>' }),
        }),
      };
    }
    if (authority.mode === 'devAdminBypass' && !(typeof authority.reason === 'string' && authority.reason.trim())) {
      return {
        refusal: this.envelope(operation, {
          diagnostics: [diagnostic(
            'SNAPBACK_MCP_AUTHORITY_REASON_REQUIRED',
            'devAdminBypass requires an explicit recorded reason',
            { tool },
          )],
          next: retry({ mode: 'devAdminBypass', reason: '<why this bypass is needed>' }),
        }),
      };
    }
    return {};
  }

  // Impersonated operations (a caller-selected userId) additionally require
  // the process-bound impersonation capability. Mirror the native CLI's
  // discovery rules: the descriptor may only name the mechanical
  // `<ready-file>.impersonation` sibling, and the live server must still
  // report the descriptor's startupNonce before the sibling is read.
  async impersonationCapability(descriptor) {
    const advertised = descriptor.impersonationCapabilityFile;
    const expected = `${this.readyFile}.impersonation`;
    if (typeof advertised !== 'string' || resolve(advertised) !== expected) {
      throw diagnosticError(
        'SNAPBACK_MCP_IMPERSONATION_UNAVAILABLE',
        'the readiness descriptor names no mechanical impersonation capability sibling',
        { expected },
      );
    }
    let health;
    try {
      health = await (await fetch(`${descriptor.serverUrl.replace(/\/$/, '')}/health`)).json();
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_IMPERSONATION_UNAVAILABLE', 'the descriptor server no longer answers /health', {});
      error.cause = cause;
      throw error;
    }
    if (typeof descriptor.startupNonce !== 'string'
      || health?.binary?.startupNonce !== descriptor.startupNonce) {
      throw diagnosticError(
        'SNAPBACK_MCP_IMPERSONATION_UNAVAILABLE',
        'the live server does not report the descriptor startupNonce; refusing to read the capability sibling',
        {},
      );
    }
    const value = readFileSync(expected, 'utf8').trim();
    if (!value) {
      throw diagnosticError('SNAPBACK_MCP_IMPERSONATION_UNAVAILABLE', 'the impersonation capability sibling is empty', { expected });
    }
    return value;
  }

  // POST one served operation over the host-ops HTTP surface. The auto-minted
  // admin token travels in `x-snapback-admin-token`, exactly as the native
  // CLI presents it. Returns whatever JSON body the server produced; throws a
  // transport diagnostic only when no body exists.
  //
  // @ref LLP 0024#http-projection — the response body is the result envelope,
  //   including ok:false app-level failures.
  // `scopeFlag` names a boolean secret-read-mint flag (e.g. 'telemetry-events');
  // pass null and a value-carrying `scopeArgs` instead for a scope that takes
  // an argument (e.g. data.scan's `--table <name>`, LLP 0184 P1).
  secretReadLease(scopeFlag, rowBudget, byteBudget, scopeArgs = null) {
    const runtime = this.resolveRuntime();
    const descriptor = this.currentDescriptor();
    const adminToken = managedAdminToken(descriptor, this.database);
    const result = native(runtime.binary, [
      'secret-read-mint', '--ready-file', this.readyFile,
      ...(scopeArgs ?? [`--${scopeFlag}`]),
      '--row-budget', String(rowBudget), '--byte-budget', String(byteBudget),
    ], {
      cwd: this.projectRoot,
      env: adminToken
        ? { ...(this.env ?? process.env), SNAPBACK_ADMIN_TOKEN: adminToken }
        : this.env,
    });
    if (result.status !== 0) {
      throw diagnosticError(
        'SNAPBACK_MCP_SECRET_READ_MINT_FAILED',
        'native scoped secret-read lease mint failed',
        { status: result.status, stderr: result.stderr?.slice(0, 2_000) ?? '' },
      );
    }
    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch (cause) {
      const error = diagnosticError(
        'SNAPBACK_MCP_SECRET_READ_MINT_FAILED',
        'native scoped secret-read lease mint returned invalid JSON',
        {},
      );
      error.cause = cause;
      throw error;
    }
    if (typeof response.lease !== 'string' || !response.lease) {
      throw diagnosticError(
        'SNAPBACK_MCP_SECRET_READ_MINT_FAILED',
        'native scoped secret-read lease mint returned no lease',
        {},
      );
    }
    return response.lease;
  }

  async postHostOp(body, { secretReadLease = null } = {}) {
    const descriptor = this.currentDescriptor();
    const adminToken = managedAdminToken(descriptor, this.database);
    const impersonatedUserId = typeof body.userId === 'string' && body.userId
      ? body.userId
      : body.input?.authority?.mode === 'devUser'
        ? body.input.authority.effectivePrincipal?.userId
        : null;
    const impersonation = typeof impersonatedUserId === 'string' && impersonatedUserId
      ? await this.impersonationCapability(descriptor)
      : null;
    const url = `${descriptor.serverUrl.replace(/\/$/, '')}/_snapback/api/host-ops`;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(adminToken ? { 'x-snapback-admin-token': adminToken } : {}),
          ...(impersonation ? { 'x-snapback-impersonation-capability': impersonation } : {}),
          ...(secretReadLease ? { 'x-snapback-secret-read-lease': secretReadLease } : {}),
          // @ref LLP 0167#authority-one-activation-chokepoint — this source
          // hint affects provenance only; native activation policy remains authoritative.
          'x-snapback-network-profile-source': 'mcp',
        },
        body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, requestId: requestId(), ...body }),
      });
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_TRANSPORT_FAILED', `host-ops request to ${url} failed: ${cause.message}`, { url });
      error.cause = cause;
      throw error;
    }
    try {
      return await response.json();
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_TRANSPORT_FAILED', `host-ops response from ${url} was not JSON (HTTP ${response.status})`, { url, status: response.status });
      error.cause = cause;
      throw error;
    }
  }

  // A direct SystemApi admin route (data.scan, config.*, jobs.*) — distinct
  // from postHostOp's `/_snapback/api/host-ops` multiplexer, since these
  // routes are their own typed endpoints returning their own JSON shape
  // (TableScan, ConfigStatus, ...), not a `hostOpsResult` envelope.
  //
  // @ref LLP 0184#p1-read-and-diagnose — thin projections over the existing
  //   admin API, never a second dialect.
  async adminFetch(method, path, { query = {}, body, secretReadLease = null } = {}) {
    const descriptor = this.currentDescriptor();
    const adminToken = managedAdminToken(descriptor, this.database);
    const url = new URL(`${descriptor.serverUrl.replace(/\/$/, '')}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(adminToken ? { 'x-snapback-admin-token': adminToken } : {}),
          ...(secretReadLease ? { 'x-snapback-secret-read-lease': secretReadLease } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_TRANSPORT_FAILED', `request to ${url} failed: ${cause.message}`, { url: String(url) });
      error.cause = cause;
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_TRANSPORT_FAILED', `response from ${url} was not JSON (HTTP ${response.status})`, { url: String(url), status: response.status });
      error.cause = cause;
      throw error;
    }
    return { ok: response.ok, status: response.status, payload };
  }

  // Wraps an adminFetch call in the shared result envelope so every direct
  // tool — host-ops multiplexed or not — returns the same shape (§Design/4:
  // "the ordinary subsystem result envelope ... rather than projection-
  // specific prose").
  async adminResult(operation, method, path, options = {}) {
    try {
      const { ok, status, payload } = await this.adminFetch(method, path, options);
      return this.toolResult(this.envelope(operation, {
        ok,
        data: ok ? (payload ?? {}) : {},
        diagnostics: ok
          ? []
          : [payload?.diagnostic ?? diagnostic(
            'SNAPBACK_MCP_ADMIN_REQUEST_FAILED',
            `admin request to ${path} failed with HTTP ${status}`,
            { status, payload },
          )],
      }));
    } catch (error) {
      return this.toolResult(this.envelope(operation, {
        diagnostics: [error.diagnostic ?? diagnostic(error?.code ?? 'SNAPBACK_MCP_ADMIN_REQUEST_FAILED', error?.message ?? String(error))],
      }), { isError: true });
    }
  }

  // Close LLP 0184 §Design/2's disclosed, temporary "no projection creates
  // authority" exception for host.start/host.stop/host.restart: until this
  // gate existed, the MCP path stopped or restarted the local server on
  // local process/filesystem access plus the startup nonce alone, with no
  // admin credential proof at all — while the HTTP host-ops path enforces
  // an AdminRead floor (§Design/2, `RoutePolicy::AdminRead` on
  // `/_snapback/api/host-ops` in `src/server.rs`) before any operation,
  // including `app.inspect`, is dispatched. This probes that exact
  // route+gate with the descriptor's managed admin token, so a stop/restart
  // caller must hold the identical credential an HTTP AdminRead/AdminWrite
  // caller would need — not a new, MCP-only authority mode.
  //
  // @ref LLP 0184#2-derived-ownership-not-a-second-registry — the named,
  //   temporary MCP/HTTP authority-gap exception this closes for
  //   host.start/host.stop/host.restart specifically.
  async requireAdminCredentialForLifecycle(operation, toolName) {
    let probe;
    try {
      probe = await this.postHostOp({ operation: 'app.inspect' });
    } catch (error) {
      return {
        refusal: this.envelope(operation, {
          diagnostics: [error.diagnostic ?? diagnostic(
            'SNAPBACK_MCP_ADMIN_CREDENTIAL_REQUIRED',
            `${toolName} requires the same admin-credential proof the host-ops HTTP surface requires: ${error.message}`,
            { tool: toolName },
          )],
        }),
      };
    }
    if (probe.ok !== true) {
      return {
        refusal: this.envelope(operation, {
          diagnostics: probe.diagnostics?.length
            ? probe.diagnostics
            : [diagnostic(
              'SNAPBACK_MCP_ADMIN_CREDENTIAL_REQUIRED',
              `${toolName} requires the same admin-credential proof the host-ops HTTP surface requires; the live server refused the admin-token-authenticated probe`,
              { tool: toolName },
            )],
        }),
      };
    }
    return {};
  }

  // POST an admin-gated route outside the host-ops multiplexer (config,
  // cron, jobs, connection disconnect all predate/sit beside the host-ops
  // surface — LLP 0184 §P2 projects each existing route as-is, not through
  // it). Same admin-token presentation as postHostOp; the response body is
  // whatever JSON (or none, for a 204) that route already returns.
  async postAdminRoute(path, body, descriptor = this.currentDescriptor()) {
    const adminToken = managedAdminToken(descriptor, this.database);
    const url = `${descriptor.serverUrl.replace(/\/$/, '')}${path}`;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(adminToken ? { 'x-snapback-admin-token': adminToken } : {}),
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_TRANSPORT_FAILED', `admin request to ${url} failed: ${cause.message}`, { url });
      error.cause = cause;
      throw error;
    }
    let json = null;
    if (response.status !== 204) {
      try {
        json = await response.json();
      } catch (cause) {
        const error = diagnosticError(
          'SNAPBACK_MCP_TRANSPORT_FAILED',
          `admin response from ${url} was not JSON (HTTP ${response.status})`,
          { url, status: response.status },
        );
        error.cause = cause;
        throw error;
      }
    }
    return { ok: response.ok, status: response.status, body: json };
  }

  // Wrap a non-host-ops admin route result in the same envelope shape every
  // other control tool returns, so a caller need not special-case these five
  // operations. On failure, the server's own ApiError diagnostic (present at
  // `body.diagnostic`) is surfaced verbatim rather than replaced.
  adminRouteEnvelope(operation, id, result) {
    return this.envelope(operation, {
      requestId: id,
      ok: result.ok,
      data: result.ok ? (result.body ?? {}) : {},
      diagnostics: result.ok
        ? []
        : [result.body?.diagnostic ?? diagnostic(
          'SNAPBACK_MCP_ADMIN_ROUTE_FAILED',
          `admin route returned HTTP ${result.status} with no structured diagnostic`,
          { status: result.status },
        )],
    });
  }

  async waitForExit(pid, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    return false;
  }

  async startEnvelope(id) {
    try {
      mkdirSync(dirname(this.readyFile), { recursive: true });
      let descriptor;
      let attached = false;
      if (existsSync(this.readyFile)) {
        descriptor = this.currentDescriptor();
        attached = true;
      } else {
        const runtime = this.resolveRuntime();
        const childEnvironment = runtimeSpawnEnvironment(runtime.binary, this.env);
        // @ref LLP 0301#2-origin-admission--the-path-split-implemented — the
        // posture is lifecycle-owner input, never ambient.
        delete childEnvironment.SNAPBACK_DEV_ADMISSION_POSTURE;
        const child = spawn(runtime.binary, ['start', '--ready-file', this.readyFile, '--db', this.database], {
          cwd: this.projectRoot,
          env: childEnvironment,
          stdio: 'ignore',
        });
        this.child = child;
        this.managed = true;
        try {
          descriptor = validateDevTarget(await waitForReady(this.readyFile, child), {
            readyFile: this.readyFile,
            database: this.database,
          });
        } catch (error) {
          await stopProcessGroup(child);
          this.child = null;
          this.managed = false;
          throw error;
        }
      }
      // Prove reachability and capture runtime state through the same served
      // surface every other operation uses.
      const inspect = await this.postHostOp({ operation: 'app.inspect' });
      return this.envelope('host.start', {
        requestId: id,
        ok: inspect.ok === true,
        serverUrl: descriptor.serverUrl,
        artifacts: inspect.artifacts ?? { schemaHash: null, bundleHash: null, databaseVersion: null },
        data: {
          attached,
          managed: this.managed,
          pid: descriptor.pid,
          serverUrl: descriptor.serverUrl,
          readyFile: this.readyFile,
          database: this.database,
          runtimeState: inspect.data?.runtimeState ?? null,
        },
        diagnostics: inspect.diagnostics ?? [],
      });
    } catch (error) {
      return this.envelope('host.start', {
        requestId: id,
        diagnostics: [error.diagnostic ?? diagnostic('SNAPBACK_MCP_START_FAILED', error.message)],
      });
    }
  }

  async stopEnvelope(id) {
    if (!existsSync(this.readyFile)) {
      return this.envelope('host.stop', {
        requestId: id,
        diagnostics: [diagnostic(
          'SNAPBACK_MCP_SERVER_NOT_RUNNING',
          `no readiness descriptor at ${this.readyFile}`,
          { readyFile: this.readyFile },
        )],
        next: [{ kind: 'callTool', tool: 'snapback_start' }],
      });
    }
    let pid = null;
    try {
      pid = readReadyDescriptor(this.readyFile).pid;
    } catch {
      // The native stop reports the invalid descriptor itself.
    }
    // @ref LLP 0184#2-derived-ownership-not-a-second-registry — the stop leg
    // (also the mutating half of snapback_restart) requires the same
    // admin-credential proof the host-ops HTTP surface requires, closing the
    // disclosed MCP/HTTP authority gap. Checked before the native stop, so a
    // caller without the credential never signals the process.
    const { refusal } = await this.requireAdminCredentialForLifecycle('host.stop', 'snapback_stop');
    if (refusal) return { ...refusal, requestId: id };
    const runtime = this.resolveRuntime();
    // The native stop verifies the live startupNonce before signaling, so a
    // stale descriptor never routes a signal to a reused PID.
    const result = native(runtime.binary, ['stop', '--ready-file', this.readyFile], {
      cwd: this.projectRoot,
      env: this.env,
    });
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_MCP_STOP_FAILED', 'native stop produced no envelope', {
        status: result.status,
        stderr: result.stderr?.slice(0, 2_000) ?? '',
      });
      error.cause = cause;
      throw error;
    }
    if (envelope.ok && pid !== null) {
      envelope.data = { ...envelope.data, exited: await this.waitForExit(pid) };
    }
    if (envelope.ok) {
      this.child = null;
      this.managed = false;
    }
    return { ...envelope, requestId: id };
  }

  toolDefinition(name) {
    const control = [...CONTROL_TOOLS, GUIDE_SEARCH_TOOL].find((tool) => tool.name === name);
    if (control) return control;
    const entry = (this.catalog?.entries ?? []).find((candidate) => candidate.toolName === name);
    if (!entry) return null;
    return {
      name,
      operation: 'function.run',
      inputSchema: appDataToolInputSchema(entry),
    };
  }

  invalidArgumentsResult(tool, operation, errors) {
    const required = errors
      .filter((error) => error.keyword === 'required')
      .map((error) => error.params?.missingProperty)
      .filter((field) => typeof field === 'string');
    return this.toolResult(this.envelope(operation, {
      diagnostics: [diagnostic(
        'SNAPBACK_MCP_ARGUMENT_INVALID',
        `${tool} arguments do not match its declared inputSchema`,
        {
          tool,
          errors: errors.map((error) => ({
            instancePath: error.instancePath,
            keyword: error.keyword,
            message: error.message,
            params: error.keyword === 'required'
              ? { missingProperty: error.params?.missingProperty }
              : error.keyword === 'type'
                ? { type: error.params?.type }
                : {},
          })),
        },
      )],
      next: [{ kind: 'retryWithInput', tool, required }],
    }));
  }

  validateToolArguments(definition, args) {
    let validate = this.toolValidators.get(definition.name);
    if (validate === undefined) {
      validate = INPUT_SCHEMA_VALIDATOR.compile(definition.inputSchema);
      this.toolValidators.set(definition.name, validate);
    }
    return validate(args)
      ? null
      : this.invalidArgumentsResult(
        definition.name,
        definition.operation,
        validate.errors ?? [],
      );
  }

  async callTool(name, args) {
    const id = requestId();
    const definition = this.toolDefinition(name);
    if (definition === null) return null;
    const invalid = this.validateToolArguments(definition, args);
    if (invalid !== null) return invalid;
    switch (name) {
      case 'snapback_start':
        return this.toolResult(await this.startEnvelope(id));
      case 'snapback_stop':
        return this.toolResult(await this.stopEnvelope(id));
      case 'snapback_restart': {
        // One request id and one envelope for the whole restart attempt.
        const previous = await this.stopEnvelope(id);
        const current = previous.ok ? await this.startEnvelope(id) : this.envelope('host.start', { requestId: id });
        return this.toolResult(this.envelope('host.restart', {
          requestId: id,
          ok: previous.ok === true && current.ok === true,
          serverUrl: current.target?.serverUrl ?? null,
          data: {
            restartReason: typeof args.reason === 'string' ? args.reason : 'mcp-restart',
            previous: previous.data ?? {},
            current: current.data ?? {},
          },
          diagnostics: [...(previous.diagnostics ?? []), ...(current.diagnostics ?? [])],
        }));
      }
      case 'snapback_inspect':
        return this.servedResult({ operation: 'app.inspect' });
      case 'snapback_network_profile_get':
        return this.servedResult({ operation: 'debug.networkProfileGet' });
      case 'snapback_network_profile_set':
        // @ref LLP 0042#control-plane-server — control tools are thin
        // projections over host-ops; the server owns parsing, authority, the
        // activation gate, refusal codes, and the returned envelope.
        return this.servedResult({
          operation: 'debug.networkProfileSet',
          input: args.profile,
          ...(typeof args.operatorPrincipal === 'string' && args.operatorPrincipal
            ? { userId: args.operatorPrincipal }
            : {}),
        });
      case 'snapback_guide_search': {
        const guideSearchEnvelope = this.nativeGuideSearch(args.query, args.slice ?? 1);
        return this.toolResult(this.envelope('guide.search', {
          ok: true,
          data: { guideSearch: guideSearchEnvelope },
        }));
      }
      case 'snapback_telemetry_stats':
        return this.servedResult({ operation: 'telemetry.stats', input: args });
      case 'snapback_telemetry_events': {
        const limit = Number.isInteger(args.limit) ? args.limit : 100;
        const lease = this.secretReadLease('telemetry-events', limit, 4 * 1024 * 1024);
        return this.servedResult(
          { operation: 'telemetry.events', input: { ...args, limit } },
          { secretReadLease: lease },
        );
      }
      case 'snapback_telemetry_export': {
        const maxRows = Number.isInteger(args.maxRows) ? args.maxRows : 100;
        const maxBytes = Number.isInteger(args.maxBytes) ? args.maxBytes : 4 * 1024 * 1024;
        const lease = this.secretReadLease(
          'telemetry-export',
          maxRows,
          maxBytes + TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE,
        );
        return this.servedResult(
          { operation: 'telemetry.export', input: { ...args, maxRows, maxBytes } },
          { secretReadLease: lease },
        );
      }
      case 'snapback_errors_issues': {
        const limit = Number.isInteger(args.limit) ? args.limit : 100;
        return this.servedResult({ operation: 'errors.issues', input: { ...args, limit } });
      }
      case 'snapback_errors_issue': {
        const lease = this.secretReadLease('errors-issue', 1_000, 4 * 1024 * 1024);
        return this.servedResult(
          { operation: 'errors.issue', input: args },
          { secretReadLease: lease },
        );
      }
      case 'snapback_errors_transition':
        return this.servedResult({ operation: 'errors.transition', input: args });
      case 'snapback_reset': {
        const { refusal } = this.checkAuthority(args.authority, {
          required: true,
          operation: 'app.reset',
          tool: name,
        });
        if (refusal) return this.toolResult(refusal);
        return this.servedResult({
          operation: 'app.reset',
          ...(args.seed ? { seed: args.seed } : {}),
          authority: args.authority,
        });
      }
      case 'snapback_data_patch_preview':
        return this.dataPatchPreviewResult(name, args);
      case 'snapback_data_patch_apply':
        return this.dataPatchApplyResult(name, args);
      case 'snapback_load_schema':
        return this.loadArtifactResult(name, 'schema.load', 'schema', args.schemaPath ?? join(this.backendRoot, 'generated', 'schema.manifest.json'));
      case 'snapback_load_functions':
        return this.loadArtifactResult(name, 'functions.load', 'functions', args.functionsPath ?? join(this.backendRoot, 'generated', 'functions.manifest.json'));
      case 'snapback_run_function':
        return this.runFunctionResult(name, args.function, args.args ?? {}, args.authority);
      case 'snapback_remediation_apply':
        return this.servedResult({ operation: 'remediation.apply', input: args });
      // --- LLP 0184 Phase 2 P1: read and diagnose --------------------------
      case 'snapback_data_scan': {
        const limit = Number.isInteger(args.limit) ? args.limit : 50;
        const offset = Number.isInteger(args.offset) ? args.offset : 0;
        const tablePath = encodedAdminPathSegment(args.table, 'table');
        const lease = this.secretReadLease(null, limit, 4 * 1024 * 1024, ['--table', args.table]);
        return this.adminResult('data.scan', 'GET', `/_snapback/api/data/${tablePath}`, {
          query: { limit, offset },
          secretReadLease: lease,
        });
      }
      case 'snapback_asset_list':
        return this.servedResult({ operation: 'asset.list', input: { ...(args.state ? { state: args.state } : {}) } });
      case 'snapback_asset_inspect':
        return this.servedResult({
          operation: 'asset.inspect',
          input: { assetId: args.assetId },
          ...(typeof args.userId === 'string' && args.userId ? { userId: args.userId } : {}),
        });
      case 'snapback_asset_retry':
        return this.servedResult({ operation: 'asset.retry', input: { assetId: args.assetId } });
      case 'snapback_config_status':
        return this.adminResult('config.status', 'GET', '/_snapback/api/config/status');
      case 'snapback_config_plan':
        return this.adminResult('config.plan', 'GET', '/_snapback/api/config/plan', {
          query: { ...(typeof args.entry === 'string' && args.entry ? { entry: args.entry } : {}) },
        });
      case 'snapback_config_verify':
        return this.adminResult('config.verify', 'POST', '/_snapback/api/config/verify', {
          body: { entry: args.entry },
        });
      case 'snapback_cron_list':
        return this.servedResult({ operation: 'cron.list' });
      case 'snapback_jobs_list':
        return this.adminResult('jobs.list', 'GET', '/_snapback/api/jobs');
      case 'snapback_jobs_show':
        return this.adminResult(
          'jobs.show',
          'GET',
          `/_snapback/api/jobs/${encodedAdminPathSegment(args.id, 'id')}`,
        );
      case 'snapback_acceptance_run':
        // @ref LLP 0042#acceptance-suite-execution--exposed-runner-deferred —
        // exposed-but-honest: the server registers the pinned-unbuilt
        // operation, so this proxies host-ops like every served tool and
        // relays the server's SNAPBACK_HOST_OP_UNIMPLEMENTED envelope
        // instead of fabricating one in-process.
        return this.servedResult({
          operation: 'acceptance.run',
          ...(typeof args.profile === 'string' ? { args: { profile: args.profile } } : {}),
        });
      // @ref LLP 0184#p2-controlled-mutations — the five P2 typed
      // projections below sit outside the host-ops multiplexer, so they go
      // through postAdminRoute rather than servedResult/postHostOp.
      case 'snapback_config_unset': {
        const result = await this.postAdminRoute('/_snapback/api/config/unset', {
          entry: args.entry,
          source: 'mcp',
        });
        return this.toolResult(this.adminRouteEnvelope('config.unset', id, result));
      }
      case 'snapback_cron_tick': {
        const result = await this.postAdminRoute('/_snapback/api/cron/tick', {});
        return this.toolResult(this.adminRouteEnvelope('cron.tick', id, {
          ...result,
          body: result.ok ? { runs: result.body } : result.body,
        }));
      }
      case 'snapback_cron_run': {
        const namePath = encodedAdminPathSegment(args.name, 'name');
        const result = await this.postAdminRoute(`/_snapback/api/cron/${namePath}/run`, {});
        return this.toolResult(this.adminRouteEnvelope('cron.runOne', id, result));
      }
      case 'snapback_ephemeral_cleanup': {
        const startupNonce = this.currentDescriptor().startupNonce;
        const body = {
          dryRun: args.dryRun === true,
          maxEntries: args.maxEntries,
          startupNonce,
          ...(Number.isInteger(args.olderThanMs) ? { olderThanMs: args.olderThanMs } : {}),
          ...(Number.isInteger(args.cutoffTimestampMs) ? { cutoffTimestampMs: args.cutoffTimestampMs } : {}),
        };
        const result = await this.postAdminRoute('/_snapback/api/ephemeral/cleanup', body);
        return this.toolResult(this.adminRouteEnvelope('ephemeral.cleanup', id, result));
      }
      case 'snapback_jobs_drain': {
        const body = {};
        if (Number.isInteger(args.nowMs)) body.nowMs = args.nowMs;
        if (Number.isInteger(args.maxWaves)) body.maxWaves = args.maxWaves;
        const result = await this.postAdminRoute('/_snapback/api/jobs/drain', body);
        return this.toolResult(this.adminRouteEnvelope('jobs.drain', id, result));
      }
      case 'snapback_connection_disconnect': {
        // The route carries no request body; `reason` is recorded in this
        // tool's own receipt (§P2's "never presented as application
        // disconnect authority" — the server acknowledges only the
        // disconnect itself, not a reason).
        const connectionPath = encodedAdminPathSegment(args.connectionId, 'connectionId');
        const result = await this.postAdminRoute(
          `/_snapback/api/connections/${connectionPath}/disconnect`,
          { reason: args.reason },
        );
        return this.toolResult(this.adminRouteEnvelope('connection.disconnect', id, {
          ...result,
          body: result.ok ? { connectionId: args.connectionId, reason: args.reason } : result.body,
        }));
      }
      case 'snapback_ephemeral_operator_delete': {
        // Keep the URL, administrator token, and startup nonce on one
        // descriptor snapshot. The server independently rejects a stale
        // process identity before touching the room store.
        const descriptor = this.currentDescriptor();
        const result = await this.postAdminRoute('/_snapback/api/ephemeral/operator/delete', {
          collection: args.collection,
          scope: args.scope,
          entryKey: args.entryKey,
          expectedScopeEpoch: args.expectedScopeEpoch,
          expectedEntryGeneration: args.expectedEntryGeneration,
          reason: args.reason,
          startupNonce: descriptor.startupNonce,
        }, descriptor);
        return this.toolResult(this.adminRouteEnvelope('ephemeral.operatorDelete', id, result));
      }
      case 'snapback_live_force_resync': {
        // @ref LLP 0184#b-forced-live-resync--add-now — startupNonce comes
        // only from this server's own readiness descriptor, never from
        // caller-supplied args; the server independently verifies it
        // matches the running process before touching any subscription.
        const descriptor = this.currentDescriptor();
        return this.servedResult({
          operation: 'debug.live.forceResync',
          input: {
            connectionId: args.connectionId,
            subscriptionId: args.subscriptionId,
            reason: args.reason,
            clearRetained: args.clearRetained === true,
            startupNonce: descriptor.startupNonce,
          },
        });
      }
      // @ref LLP 0184#p2-controlled-mutations — asset delete/GC/key-rotation/
      // export/import direct MCP tools; all route through the host-ops
      // multiplexer exactly like the shipped CLI.
      case 'snapback_asset_delete':
        return this.servedResult({
          operation: 'asset.delete',
          input: { assetId: args.assetId },
          ...(typeof args.userId === 'string' && args.userId ? { userId: args.userId } : {}),
        });
      case 'snapback_asset_gc_sweep':
        return this.servedResult({ operation: 'asset.gcSweep', input: { nowMs: args.nowMs } });
      case 'snapback_asset_rotate_signing_key':
        return this.servedResult({ operation: 'asset.rotateSigningKey' });
      case 'snapback_asset_export_cut':
        return this.servedResult({ operation: 'asset.exportCut', input: { dir: args.dir } });
      case 'snapback_asset_import_cut':
        return this.servedResult({
          operation: 'asset.importCut',
          input: { dir: args.dir, apply: args.apply === true },
        });
      default: {
        const entry = (this.catalog?.entries ?? []).find((candidate) => candidate.toolName === name);
        if (!entry) return null;
        // @ref LLP 0024#generated-app-data-mcp-catalog — a catalog entry does
        // not imply permission: mutations run only with an explicit tuple.
        const { refusal } = this.checkAuthority(args.authority, {
          required: entry.kind !== 'query',
          operation: 'function.run',
          tool: name,
        });
        if (refusal) return this.toolResult(refusal);
        return this.runFunctionResult(name, entry.functionId, args.args ?? {}, args.authority, { checked: true });
      }
    }
  }

  async dataPatchPreviewResult(tool, args) {
    const { refusal } = this.checkAuthority(args.authority, {
      required: true,
      operation: 'data.patch.preview',
      tool,
    });
    if (refusal) return this.toolResult(refusal);
    const payload = await this.postHostOp({ operation: 'data.patch.preview', input: args });
    if (payload?.ok === true && typeof payload.data?.applyToken === 'string') {
      const applyTokenId = payload.data.applyTokenId;
      const expiresAtMs = payload.data.applyTokenExpiresAtMs;
      if (typeof applyTokenId === 'string' && Number.isSafeInteger(expiresAtMs)) {
        // @ref LLP 0184#a-bounded-direct-row-patch--add-now — MCP retains the
        //   live single-use capability in a bounded process-local store and
        //   exposes only its non-authorizing id.
        this.pruneDataPatchTokens();
        while (this.dataPatchTokens.size >= 64) {
          this.dataPatchTokens.delete(this.dataPatchTokens.keys().next().value);
        }
        this.dataPatchTokens.set(applyTokenId, {
          token: payload.data.applyToken,
          inputDigest: dataPatchInputDigest(args),
          expiresAtMs,
        });
      }
      const scrubbed = JSON.parse(JSON.stringify(payload));
      delete scrubbed.data.applyToken;
      return this.toolResult(scrubbed, { isError: scrubbed?.resultKind !== 'hostOpsResult' });
    }
    return this.toolResult(payload, { isError: payload?.resultKind !== 'hostOpsResult' });
  }

  async dataPatchApplyResult(tool, args) {
    const { refusal } = this.checkAuthority(args.authority, {
      required: true,
      operation: 'data.patch.apply',
      tool,
    });
    if (refusal) return this.toolResult(refusal);
    this.pruneDataPatchTokens();
    const { applyTokenId, ...input } = args;
    const retained = this.dataPatchTokens.get(applyTokenId);
    if (!retained || retained.inputDigest !== dataPatchInputDigest(input)) {
      return this.toolResult(this.envelope('data.patch.apply', {
        diagnostics: [diagnostic(
          'SNAPBACK_MCP_DATA_PATCH_TOKEN_UNAVAILABLE',
          'no matching live preview capability is retained by this MCP process',
          { applyTokenId: typeof applyTokenId === 'string' ? applyTokenId : null },
        )],
        next: [{ kind: 'callTool', tool: 'snapback_data_patch_preview' }],
      }));
    }
    // Drop before transport so retries can never replay the capability even
    // if the response is lost. Native still owns atomic compare-and-consume.
    this.dataPatchTokens.delete(applyTokenId);
    return this.servedResult({
      operation: 'data.patch.apply',
      input: { ...input, applyToken: retained.token },
    });
  }

  pruneDataPatchTokens(nowMs = Date.now()) {
    for (const [id, retained] of this.dataPatchTokens) {
      if (retained.expiresAtMs <= nowMs) this.dataPatchTokens.delete(id);
    }
  }

  async loadArtifactResult(tool, operation, field, path) {
    const artifactPath = resolve(path);
    if (!existsSync(artifactPath)) {
      return this.toolResult(this.envelope(operation, {
        diagnostics: [diagnostic(
          'SNAPBACK_MCP_ARTIFACT_MISSING',
          `no generated artifact at ${artifactPath}`,
          { tool, artifactPath },
        )],
        next: [{ kind: 'runCommand', command: 'snapback generate' }],
      }));
    }
    return this.servedResult({ operation, [field]: readJson(artifactPath) });
  }

  async runFunctionResult(tool, functionRef, functionArgs, authority, { checked = false } = {}) {
    if (typeof functionRef !== 'string' || !functionRef) {
      return this.toolResult(this.envelope('function.run', {
        diagnostics: [diagnostic('SNAPBACK_MCP_INPUT_INVALID', `${tool} requires a function id`, { tool })],
        next: [{ kind: 'retryWithInput', tool, required: ['function'] }],
      }));
    }
    if (!checked) {
      const entry = (this.catalog?.entries ?? []).find(
        (candidate) => candidate.functionId === functionRef || candidate.title === functionRef,
      );
      const { refusal } = this.checkAuthority(authority, {
        required: entry !== undefined && entry.kind !== 'query',
        operation: 'function.run',
        tool,
      });
      if (refusal) return this.toolResult(refusal);
    }
    return this.servedResult({
      operation: 'function.run',
      function: functionRef,
      args: functionArgs,
      ...(authority?.mode === 'devUser' ? { userId: authority.userId } : {}),
      ...(authority ? { authority } : {}),
    });
  }

  async servedResult(body, options) {
    const payload = await this.postHostOp(body, options);
    // An ok:false envelope is a successful tool result; only a body that is
    // not a host-ops envelope (an auth/protocol refusal produced before the
    // core ran) projects as an MCP tool error.
    return this.toolResult(payload, { isError: payload?.resultKind !== 'hostOpsResult' });
  }

  toolResult(envelope, { isError = false } = {}) {
    return {
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      structuredContent: envelope,
      isError,
    };
  }

  listTools() {
    const control = [...CONTROL_TOOLS, GUIDE_SEARCH_TOOL].map(({
      name, title, description, inputSchema, annotations, operation,
    }) => ({
      name,
      title,
      description,
      inputSchema,
      outputSchema: HOST_OPS_RESULT_OUTPUT_SCHEMA,
      annotations,
      _meta: { 'snapback/operation': operation },
    }));
    const appData = (this.catalog?.entries ?? []).map((entry) => ({
      name: entry.toolName,
      title: entry.title,
      description: entry.description,
      inputSchema: appDataToolInputSchema(entry),
      outputSchema: entry.outputSchema,
      annotations: {
        readOnlyHint: entry.kind === 'query',
        destructiveHint: entry.kind !== 'query',
        openWorldHint: false,
      },
      _meta: {
        functionId: entry.functionId,
        capabilityGaps: entry.capabilityGaps,
        syncabilityClass: entry.syncabilityClass,
      },
    }));
    return {
      tools: [...control, ...appData],
      _meta: {
        'snapback/appDataCatalog': this.catalog,
        'snapback/catalogDiagnostics': this.catalogDiagnostics,
      },
    };
  }

  listResources() {
    const resources = [];
    const diagnostics = [];
    let catalog = null;
    try {
      catalog = this.nativeControlCatalog().value;
      resources.push(...this.controlResourceCatalog(catalog));
    } catch (error) {
      diagnostics.push(this.nativeResourceUnavailable(error));
    }
    try {
      const guide = this.nativeGuideRequest('resources/list');
      resources.push(...(guide?.resources ?? []));
    } catch (error) {
      diagnostics.push(this.nativeResourceUnavailable(error));
    }
    return {
      resources,
      _meta: {
        ...(catalog ? { 'snapback/catalogDigest': catalog.catalogDigest } : {}),
        'snapback/resourceDiagnostics': diagnostics,
      },
    };
  }

  listResourceTemplates() {
    const diagnostics = [];
    let resourceTemplates = [];
    try {
      const catalog = this.nativeControlCatalog().value;
      resourceTemplates = this.controlResourceTemplates(catalog);
    } catch (error) {
      diagnostics.push(this.nativeResourceUnavailable(error));
    }
    try {
      const guide = this.nativeGuideRequest('resources/templates/list');
      resourceTemplates.push(...(guide?.resourceTemplates ?? []));
    } catch (error) {
      diagnostics.push(this.nativeResourceUnavailable(error));
    }
    return {
      resourceTemplates,
      _meta: { 'snapback/resourceDiagnostics': diagnostics },
    };
  }

  async readResource(uri) {
    const control = await this.readControlResource(uri);
    if (control) return control;
    if (typeof uri === 'string' && uri.startsWith('snapback-guide://')) {
      return this.nativeGuideRequest('resources/read', { uri });
    }
    return null;
  }

  async handleRequest(request) {
    const id = request?.id;
    const method = request?.method;
    const success = (result) => ({ jsonrpc: '2.0', id, result });
    const failure = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (request?.jsonrpc !== '2.0' || typeof method !== 'string') {
      return id === undefined ? null : failure(-32600, 'Invalid Request');
    }
    if (method.startsWith('notifications/')) return null;
    if (id === undefined) return null;
    switch (method) {
      case 'initialize':
        return success({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: { name: 'snapback-control', version: packageVersion() },
          instructions: 'Control-plane tools project LLP 0024 host operations; '
            + 'snapback_fn_* tools are the generated app-data catalog. Every result '
            + 'is the shared hostOpsResult envelope; ok:false envelopes are '
            + 'app-level failures, not tool errors. Start Guide discovery at '
            + 'snapback-guide://page/meta.capabilities, then read '
            + 'snapback-guide://manifest for the identity handshake. Use '
            + 'snapback-controls://catalog for operating controls; all are supplied '
            + 'by the co-installed native binary.',
        });
      case 'ping':
        return success({});
      case 'resources/list':
        return success(this.listResources());
      case 'resources/templates/list':
        return success(this.listResourceTemplates());
      case 'resources/read': {
        try {
          const result = await this.readResource(request.params?.uri);
          if (result === null) return failure(-32002, `Resource not found: ${request.params?.uri}`);
          return success(result);
        } catch (error) {
          const detail = error?.diagnostic
            ?? diagnostic(error?.code ?? 'SNAPBACK_MCP_RESOURCE_UNAVAILABLE', error?.message ?? String(error));
          return failure(-32001, `${detail.code}: ${detail.message}`);
        }
      }
      case 'tools/list':
        return success(this.listTools());
      case 'tools/call': {
        try {
          const result = await this.callTool(request.params?.name, request.params?.arguments ?? {});
          if (result === null) return failure(-32602, `Unknown tool: ${request.params?.name}`);
          return success(result);
        } catch (error) {
          // Transport-level failure: preserve isError while keeping declared
          // structuredContent in the shared hostOpsResult shape.
          const detail = error?.diagnostic
            ?? diagnostic(error?.code ?? 'SNAPBACK_MCP_TOOL_FAILED', error?.message ?? String(error));
          const definition = this.toolDefinition(request.params?.name);
          const envelope = this.envelope(definition?.operation ?? request.params?.name ?? 'unknown', {
            diagnostics: [detail],
          });
          return success(this.toolResult(envelope, { isError: true }));
        }
      }
      default:
        return failure(-32601, 'Method not found');
    }
  }

  async close() {
    // Never leave a managed child orphaned behind a disconnected MCP client.
    if (this.managed && this.child && this.child.exitCode === null) {
      const child = this.child;
      let stopped = null;
      try {
        stopped = await this.stopEnvelope(requestId());
      } catch { /* owned-process fallback below */ }
      if (stopped?.ok !== true || child.exitCode === null) await stopProcessGroup(child);
    }
  }
}

export async function runMcpControl(options = {}) {
  const server = new McpControlServer(options);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let response;
      try {
        response = await server.handleRequest(JSON.parse(line));
      } catch {
        response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      }
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  } finally {
    await server.close();
  }
  return 0;
}
