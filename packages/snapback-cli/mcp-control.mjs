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

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  diagnosticError,
  managedAdminToken,
  native,
  readReadyDescriptor,
  resolveRuntimeBinary,
  scrubDynamicLoaderEnvironment,
  validateDevTarget,
  waitForReady,
} from './index.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SCHEMA_VERSION = 'snapback.v0';
// The native response charges the complete HostOpsResult, while maxBytes
// bounds its nested export-page data. Target/authority/artifact fields are
// fixed-shape; this allowance is asserted by the native HTTP proof fixture.
const TELEMETRY_EXPORT_HOST_ENVELOPE_ALLOWANCE = 64 * 1024;
// @ref LLP 0024#authority-tuple — the five pinned modes; the local slice
// serves the first four and refuses servicePrincipal honestly.
const LOCAL_AUTHORITY_MODES = ['none', 'unauthenticated', 'devUser', 'devAdminBypass'];

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
      // The codegen artifacts carry no return-shape schema yet.
      outputSchema: 'unknown',
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
  if (entries.some((entry) => entry.outputSchema === 'unknown')) {
    diagnostics.push({
      ...diagnostic(
        'SNAPBACK_MCP_OUTPUT_SCHEMA_UNKNOWN',
        'generated artifacts declare no return shapes; catalog outputSchema is "unknown"',
      ),
      severity: 'note',
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

const CONTROL_TOOLS = [
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
    name: 'snapback_acceptance_run',
    operation: 'acceptance.run',
    title: 'Run the local acceptance suite (unbuilt)',
    description: 'Pinned by LLP 0024; the runner is deferred, so this returns the structured SNAPBACK_HOST_OP_UNIMPLEMENTED envelope.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { profile: { type: 'string' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

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
    this.runtime = null;
    this.child = null;
    this.managed = false;
    const { catalog, diagnostics } = buildAppDataCatalog(this.backendRoot);
    this.catalog = catalog;
    this.catalogDiagnostics = diagnostics;
  }

  resolveRuntime() {
    this.runtime ??= resolveRuntimeBinary({ runtimeBinary: this.runtimeBinary });
    return this.runtime;
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
    if (authority.mode === 'devUser' && typeof authority.userId !== 'string') {
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
  secretReadLease(scopeFlag, rowBudget, byteBudget) {
    const runtime = this.resolveRuntime();
    const descriptor = this.currentDescriptor();
    const adminToken = managedAdminToken(descriptor, this.database);
    const result = native(runtime.binary, [
      'secret-read-mint', '--ready-file', this.readyFile,
      ...(adminToken ? ['--token', adminToken] : []),
      `--${scopeFlag}`, '--row-budget', String(rowBudget), '--byte-budget', String(byteBudget),
    ], { cwd: this.projectRoot, env: this.env });
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
    const impersonation = typeof body.userId === 'string' && body.userId
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
        const child = spawn(runtime.binary, ['start', '--ready-file', this.readyFile, '--db', this.database], {
          cwd: this.projectRoot,
          env: scrubDynamicLoaderEnvironment(this.env),
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
          if (child.exitCode === null) child.kill('SIGTERM');
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

  async callTool(name, args) {
    const id = requestId();
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
      case 'snapback_load_schema':
        return this.loadArtifactResult(name, 'schema.load', 'schema', args.schemaPath ?? join(this.backendRoot, 'generated', 'schema.manifest.json'));
      case 'snapback_load_functions':
        return this.loadArtifactResult(name, 'functions.load', 'functions', args.functionsPath ?? join(this.backendRoot, 'generated', 'functions.manifest.json'));
      case 'snapback_run_function':
        return this.runFunctionResult(name, args.function, args.args ?? {}, args.authority);
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
    const control = CONTROL_TOOLS.map(({ name, title, description, inputSchema, annotations, operation }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations,
      _meta: { 'snapback/operation': operation },
    }));
    const appData = (this.catalog?.entries ?? []).map((entry) => ({
      name: entry.toolName,
      title: entry.title,
      description: entry.description,
      inputSchema: entry.inputSchema,
      annotations: {
        readOnlyHint: entry.kind === 'query',
        destructiveHint: entry.kind !== 'query',
        openWorldHint: false,
      },
      _meta: { 'snapback/catalogEntry': entry },
    }));
    return {
      tools: [...control, ...appData],
      _meta: {
        'snapback/appDataCatalog': this.catalog,
        'snapback/catalogDiagnostics': this.catalogDiagnostics,
      },
    };
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
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'snapback-control', version: packageVersion() },
          instructions: 'Control-plane tools project LLP 0024 host operations; '
            + 'snapback_fn_* tools are the generated app-data catalog. Every result '
            + 'is the shared hostOpsResult envelope; ok:false envelopes are '
            + 'app-level failures, not tool errors.',
        });
      case 'ping':
        return success({});
      case 'tools/list':
        return success(this.listTools());
      case 'tools/call': {
        try {
          const result = await this.callTool(request.params?.name, request.params?.arguments ?? {});
          if (result === null) return failure(-32602, `Unknown tool: ${request.params?.name}`);
          return success(result);
        } catch (error) {
          // Transport-level failure: no envelope could be produced.
          const detail = error?.diagnostic
            ?? diagnostic(error?.code ?? 'SNAPBACK_MCP_TOOL_FAILED', error?.message ?? String(error));
          return success({
            content: [{ type: 'text', text: JSON.stringify({ diagnostics: [detail] }) }],
            structuredContent: { diagnostics: [detail] },
            isError: true,
          });
        }
      }
      default:
        return failure(-32601, 'Method not found');
    }
  }

  async close() {
    // Never leave a managed child orphaned behind a disconnected MCP client.
    if (this.managed && this.child && this.child.exitCode === null && existsSync(this.readyFile)) {
      try {
        await this.stopEnvelope(requestId());
      } catch {
        this.child.kill('SIGTERM');
      }
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
