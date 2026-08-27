// Acceptance for the LLP 0042 control-plane MCP server (LLP 0079 SC-1b):
// drive the full loop — start → load schema/functions → run function → read
// diagnostics → stop — through newline-delimited JSON-RPC alone, against a
// real native server on an ephemeral port with a temp database + ready file.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateApp,
  managedAdminToken,
  readReadyDescriptor,
  scaffoldApp,
} from './index.mjs';
import {
  McpControlServer,
  buildAppDataCatalog,
  functionToolName,
  requireMatchingControlCatalogIdentity,
} from './mcp-control.mjs';
import { decodeRemediationSet } from '../snapback-client/remediation.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(resolve(packageDir, '..', '..'), 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run \`cargo build --bin snapback\` or set SNAPBACK_RUNTIME_BINARY`,
);

// Catalog derivation units that need no server.
{
  const taken = new Set(['snapback_fn_demo_createtodo']);
  const { toolName, collided } = functionToolName('demo:createTodo', taken);
  assert.equal(collided, true);
  assert.match(toolName, /^snapback_fn_demo_createtodo_[0-9a-f]{8}$/);
  const missing = buildAppDataCatalog(join(tmpdir(), 'snapback-mcp-no-such-backend'));
  assert.equal(missing.catalog, null);
  assert.equal(missing.diagnostics[0].code, 'SNAPBACK_MCP_CATALOG_ARTIFACTS_MISSING');

  assert.throws(
    () => requireMatchingControlCatalogIdentity(
      { catalogDigest: `sha256:${'a'.repeat(64)}` },
      { catalogDigest: `sha256:${'b'.repeat(64)}` },
    ),
    (error) => error.code === 'SNAPBACK_MCP_CONTROL_CATALOG_IDENTITY_MISMATCH',
  );

  const missingNative = new McpControlServer({
    backendDirectory: join(tmpdir(), 'snapback-mcp-no-native-backend'),
    projectRoot: tmpdir(),
    runtimeBinary: join(tmpdir(), 'snapback-native-does-not-exist'),
  });
  const unavailable = await missingNative.handleRequest({
    jsonrpc: '2.0', id: 1, method: 'resources/list', params: {},
  });
  assert.deepEqual(unavailable.result.resources, []);
  assert.ok(unavailable.result._meta['snapback/resourceDiagnostics'].length > 0);
  assert.equal(
    unavailable.result._meta['snapback/resourceDiagnostics'][0].code,
    'SNAPBACK_MCP_NATIVE_DOCUMENTATION_UNAVAILABLE',
  );
  assert.match(
    unavailable.result._meta['snapback/resourceDiagnostics'][0].message,
    /no compatible co-installed native Snapback binary/,
  );

  let catalogDigest = `sha256:${'a'.repeat(64)}`;
  let nativeGuideSpawns = 0;
  const memoizedNative = new McpControlServer({
    backendDirectory: join(tmpdir(), 'snapback-mcp-memoized-backend'),
    projectRoot: tmpdir(),
    runtimeBinary,
    spawnSync: () => {
      nativeGuideSpawns += 1;
      return {
        status: 0,
        signal: null,
        stdout: `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { resources: [] } })}\n`,
        stderr: '',
      };
    },
  });
  memoizedNative.nativeControlCatalog = () => ({ value: { catalogDigest } });
  for (const tool of memoizedNative.listTools().tools) {
    assert.doesNotThrow(
      () => memoizedNative.validateToolArguments(memoizedNative.toolDefinition(tool.name), {}),
      `${tool.name} declared an inputSchema that cannot be compiled`,
    );
  }
  assert.deepEqual(memoizedNative.nativeGuideRequest('resources/list'), { resources: [] });
  assert.deepEqual(memoizedNative.nativeGuideRequest('resources/list'), { resources: [] });
  assert.equal(nativeGuideSpawns, 1, 'same-digest Guide request must reuse the process-lifetime memo');
  catalogDigest = `sha256:${'b'.repeat(64)}`;
  assert.deepEqual(memoizedNative.nativeGuideRequest('resources/list'), { resources: [] });
  assert.equal(nativeGuideSpawns, 2, 'a different catalog digest must not reuse cached Guide bytes');
}

class McpClient {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = '';
    child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        const settle = this.pending.get(message.id);
        if (settle) {
          this.pending.delete(message.id);
          settle(message);
        }
      }
    });
  }

  request(method, params = {}, timeoutMs = 60_000) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReply(new Error(`no MCP response to ${method} within ${timeoutMs}ms; stderr: ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolveReply(message);
      });
    });
  }

  async call(name, args = {}) {
    const reply = await this.request('tools/call', { name, arguments: args });
    assert.equal(reply.error, undefined, `${name}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  }
}

async function managedTimeoutReceipt(toolName) {
  const timeoutRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-mcp-timeout-')));
  const readyFile = join(timeoutRoot, 'managed.ready.json');
  const database = join(timeoutRoot, 'managed.sqlite3');
  const serverUrl = 'http://127.0.0.1:9';
  const target = {
    appId: 'managed-timeout',
    appRoot: '/managed-timeout-app-root',
    targetProfile: 'local-dev-sqlite-ibex',
    serverUrl,
    pid: 98_765,
    verifiedBy: 'caller-authored-extra',
  };
  const descriptor = {
    pid: 98_765,
    serverUrl,
    startupNonce: 'managed-timeout-nonce',
    target,
  };
  const child = new EventEmitter();
  child.pid = descriptor.pid;
  child.exitCode = null;
  child.signalCode = null;
  writeFileSync(readyFile, '{}\n', { mode: 0o600 });
  const server = new McpControlServer({
    backendDirectory: join(timeoutRoot, 'snapback'),
    projectRoot: timeoutRoot,
    readyFile,
    database,
    runtimeBinary,
    lifecycleStopTimeoutMs: 175,
  });
  server.child = child;
  server.managed = true;
  server.currentDescriptor = () => descriptor;
  server.requireAdminCredentialForLifecycle = async () => ({});
  server.postHostOp = async (body) => ({
    schemaVersion: 'snapback.v0',
    resultKind: 'hostOpsResult',
    requestId: body.requestId,
    operation: 'host.stop',
    ok: true,
    target: {
      appId: target.appId,
      appRoot: target.appRoot,
      targetProfile: target.targetProfile,
      serverUrl: target.serverUrl,
    },
    authority: {
      mode: 'devAdminBypass',
      actorPrincipal: null,
      effectivePrincipal: null,
      localDevOnly: true,
      adminBypass: true,
      scope: null,
      reason: 'host-ops process lifecycle gate',
    },
    data: {
      shutdownRequested: true,
      shutdownMode: 'serverSelfStop',
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('expected closed health endpoint'); };
  try {
    return await server.callTool(toolName, {});
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(timeoutRoot, { recursive: true, force: true });
  }
}

{
  const timedOutStop = await managedTimeoutReceipt('snapback_stop');
  assert.equal(timedOutStop.structuredContent.operation, 'host.stop');
  assert.equal(timedOutStop.structuredContent.ok, false);
  assert.equal(timedOutStop.structuredContent.authority, null);
  assert.equal(
    timedOutStop.structuredContent.diagnostics[0].code,
    'SNAPBACK_HOST_STOP_TIMEOUT',
  );
  assert.deepEqual(timedOutStop.structuredContent.target, {
    appId: 'managed-timeout',
    appRoot: '/managed-timeout-app-root',
    targetProfile: 'local-dev-sqlite-ibex',
    serverUrl: 'http://127.0.0.1:9',
  });

  const timedOutRestart = await managedTimeoutReceipt('snapback_restart');
  assert.equal(timedOutRestart.structuredContent.operation, 'host.restart');
  assert.equal(timedOutRestart.structuredContent.ok, false);
  assert.equal(timedOutRestart.structuredContent.authority, null);
  assert.equal(
    timedOutRestart.structuredContent.diagnostics[0].code,
    'SNAPBACK_HOST_RESTART_STOP_TIMEOUT',
  );
}

// realpath: the server canonicalizes the database path in the descriptor, so
// a symlinked macOS tmpdir would otherwise trip target validation.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-mcp-control-')));
let mcp = null;
try {
  const project = join(root, 'mcp-app');
  assert.equal(scaffoldApp(project).ok, true);
  const generated = await generateApp(join(project, 'snapback'));
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const readyFile = join(root, 'state', 'mcp.ready.json');
  const database = join(root, 'state', 'mcp.sqlite3');
  mcp = spawn(process.execPath, [
    join(packageDir, 'cli.mjs'),
    'mcp-control', 'snapback',
    '--ready-file', readyFile,
    '--db', database,
  ], {
    cwd: project,
    env: {
      ...process.env,
      SNAPBACK_RUNTIME_BINARY: runtimeBinary,
      SNAPBACK_DEV_ADMISSION_POSTURE: 'hostile-ambient-value',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new McpClient(mcp);

  const initialized = await client.request('initialize', {});
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.equal(initialized.result.serverInfo.name, 'snapback-control');
  assert.deepEqual(initialized.result.capabilities.resources, { subscribe: false, listChanged: false });

  const resourceList = await client.request('resources/list');
  assert.deepEqual(resourceList.result._meta['snapback/resourceDiagnostics'], []);
  const resourceUris = resourceList.result.resources.map((resource) => resource.uri);
  assert.ok(resourceUris.includes('snapback-controls://catalog'));
  assert.ok(resourceUris.includes('snapback-controls://operation/debug.networkProfileSet'));
  assert.ok(resourceUris.includes('snapback-guide://manifest'));
  assert.equal(
    resourceList.result.resources.find(
      (resource) => resource.uri === 'snapback-controls://catalog',
    ).annotations.readOnlyHint,
    true,
  );

  const templates = await client.request('resources/templates/list');
  assert.ok(
    templates.result.resourceTemplates.some(
      (template) => template.uriTemplate === 'snapback-controls://operation/{operation}',
    ),
  );
  assert.equal(
    templates.result.resourceTemplates.find(
      (template) => template.uriTemplate === 'snapback-controls://operation/{operation}',
    ).annotations.readOnlyHint,
    true,
  );

  const catalogResource = await client.request('resources/read', {
    uri: 'snapback-controls://catalog',
  });
  const buildControlCatalog = JSON.parse(catalogResource.result.contents[0].text);
  assert.equal(buildControlCatalog.schemaVersion, 'snapback.control-catalog.v1');
  assert.match(buildControlCatalog.catalogDigest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(buildControlCatalog.entries.length >= 100);

  const describedControl = await client.request('resources/read', {
    uri: 'snapback-controls://operation/debug.networkProfileSet',
  });
  const describedControlRow = JSON.parse(describedControl.result.contents[0].text);
  assert.equal(describedControlRow.catalogDigest, buildControlCatalog.catalogDigest);
  assert.equal(describedControlRow.entry.operation, 'debug.networkProfileSet');

  const guideManifestResource = await client.request('resources/read', {
    uri: 'snapback-guide://manifest',
  });
  const guideManifest = JSON.parse(guideManifestResource.result.contents[0].text);
  assert.match(guideManifest.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(typeof guideManifest.buildIdentity.commit, 'string');

  const guideSearch = await client.call('snapback_guide_search', {
    query: 'SnapbackClient.query',
  });
  assert.equal(guideSearch.structuredContent.operation, 'guide.search');
  assert.equal(guideSearch.structuredContent.ok, true, JSON.stringify(guideSearch));
  assert.equal(guideSearch.structuredContent.data.guideSearch.schemaVersion, 'snapback.guide-search.v1');
  assert.equal(guideSearch.structuredContent.data.guideSearch.mode, 'exact-symbol');
  assert.equal(guideSearch.structuredContent.data.guideSearch.result.match, 'member');
  const guideSectionSearch = await client.call('snapback_guide_search', {
    query: 'network condition profiles',
  });
  assert.equal(guideSectionSearch.structuredContent.ok, true, JSON.stringify(guideSectionSearch));
  assert.equal(guideSectionSearch.structuredContent.data.guideSearch.mode, 'section-search');
  assert.equal(guideSectionSearch.structuredContent.data.guideSearch.result.matched, true);
  assert.ok(guideSectionSearch.structuredContent.data.guideSearch.matches.length > 0);

  const listed = await client.request('tools/list');
  const tools = listed.result.tools;
  const names = tools.map((tool) => tool.name);
  for (const pinned of [
    'snapback_start', 'snapback_stop', 'snapback_restart', 'snapback_inspect',
    'snapback_reset', 'snapback_load_schema', 'snapback_load_functions',
    'snapback_run_function', 'snapback_remediation_apply', 'snapback_acceptance_run',
    'snapback_network_profile_get', 'snapback_network_profile_set',
    'snapback_telemetry_stats', 'snapback_telemetry_events', 'snapback_telemetry_export',
    'snapback_errors_issues', 'snapback_errors_issue', 'snapback_errors_transition',
    // LLP 0184 Phase 2 P1 read/diagnose projections.
    'snapback_data_scan', 'snapback_config_status', 'snapback_config_plan',
    'snapback_config_verify', 'snapback_cron_list', 'snapback_jobs_list', 'snapback_jobs_show',
    'snapback_asset_list', 'snapback_asset_inspect', 'snapback_asset_retry',
    // LLP 0184 §P2's controlled-mutation and asset-family direct tools.
    'snapback_config_unset', 'snapback_cron_tick', 'snapback_cron_run',
    'snapback_ephemeral_cleanup', 'snapback_jobs_drain',
    'snapback_connection_disconnect', 'snapback_ephemeral_operator_delete',
    'snapback_asset_delete', 'snapback_asset_gc_sweep', 'snapback_asset_rotate_signing_key',
    'snapback_asset_export_cut', 'snapback_asset_import_cut',
    // LLP 0184 §A's bounded direct row patch.
    'snapback_data_patch_preview', 'snapback_data_patch_apply',
  ]) {
    assert.ok(names.includes(pinned), `missing pinned control tool ${pinned}`);
  }
  assert.ok(names.includes('snapback_guide_search'), 'missing control-side Guide search tool');
  assert.ok(tools.every((tool) => tool.outputSchema?.properties?.resultKind?.const === 'hostOpsResult'));
  assert.equal(tools.find((tool) => tool.name === 'snapback_inspect').annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === 'snapback_network_profile_get').annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === 'snapback_network_profile_set').annotations.readOnlyHint, false);
  const profileSchema = tools.find((tool) => tool.name === 'snapback_network_profile_set').inputSchema
    .properties.profile;
  assert.deepEqual(profileSchema.oneOf[0].enum, ['normal', 'optimistic', 'demo-slow']);
  for (const field of ['mutationAckDelayMs', 'liveDeltaDelayMs', 'queryResponseDelayMs', 'jitterMs']) {
    assert.equal(profileSchema.oneOf[1].properties[field].maximum, 30_000);
  }
  assert.equal(tools.find((tool) => tool.name === 'snapback_reset').annotations.destructiveHint, true);
  assert.equal(
    tools.find((tool) => tool.name === 'snapback_data_patch_preview').annotations.destructiveHint,
    false,
  );
  assert.equal(
    tools.find((tool) => tool.name === 'snapback_data_patch_apply').annotations.destructiveHint,
    true,
  );
  assert.equal(
    tools.find((tool) => tool.name === 'snapback_data_patch_apply')
      .inputSchema.properties.applyToken,
    undefined,
  );
  assert.equal(tools.find((tool) => tool.name === 'snapback_ephemeral_operator_delete').annotations.destructiveHint, true);
  const assetExportCut = tools.find((tool) => tool.name === 'snapback_asset_export_cut');
  assert.equal(assetExportCut.annotations.readOnlyHint, false);
  assert.equal(assetExportCut.annotations.destructiveHint, false);

  const catalog = listed.result._meta['snapback/appDataCatalog'];
  assert.equal(catalog.catalogKind, 'appDataMcpCatalog');
  assert.equal(catalog.schemaVersion, 'snapback.v0');
  assert.match(catalog.functionManifestHash, /^sha256:[0-9a-f]{64}$/);
  const catalogTools = tools.filter((tool) => tool.name.startsWith('snapback_fn_'));
  const catalogEntries = new Map(catalog.entries.map((entry) => [entry.toolName, entry]));
  const queryTool = catalogTools.find((tool) => catalogEntries.get(tool.name).kind === 'query');
  const mutationTool = catalogTools.find((tool) => catalogEntries.get(tool.name).kind === 'mutation');
  assert.ok(queryTool, 'catalog must expose at least one query tool');
  assert.ok(mutationTool, 'catalog must expose at least one mutation tool');
  assert.equal(queryTool.annotations.readOnlyHint, true);
  // Input schemas derive from the generated args validators, not guesses.
  assert.deepEqual(mutationTool.inputSchema.required, ['args']);
  assert.deepEqual(mutationTool.inputSchema.properties.args.required, ['title']);
  assert.equal(mutationTool.inputSchema.properties.args.properties.title.type, 'string');
  const mutationEntry = catalogEntries.get(mutationTool.name);
  assert.deepEqual(mutationTool._meta, {
    functionId: mutationEntry.functionId,
    capabilityGaps: mutationEntry.capabilityGaps,
    syncabilityClass: mutationEntry.syncabilityClass,
  });
  assert.equal(mutationEntry.outputSchema.properties.resultKind.const, 'hostOpsResult');
  assert.equal(mutationEntry.authorityRequired.explicitTuple, true);
  assert.equal(mutationEntry.dryRunSupported, false);
  assert.match(mutationEntry.functionId, /:createTodo$/);

  for (const [tool, missing] of [
    ['snapback_cron_run', 'name'],
    ['snapback_connection_disconnect', 'connectionId'],
  ]) {
    const invalid = await client.call(tool, {});
    assert.equal(invalid.structuredContent.resultKind, 'hostOpsResult');
    assert.equal(invalid.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_ARGUMENT_INVALID');
    assert.ok(invalid.structuredContent.next[0].required.includes(missing));
  }
  const invalidCronPath = await client.call('snapback_cron_run', { name: 'nightly/run' });
  assert.equal(invalidCronPath.isError, true);
  assert.equal(invalidCronPath.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_ARGUMENT_INVALID');

  const started = await client.call('snapback_start');
  assert.notEqual(started.isError, true, JSON.stringify(started));
  assert.equal(started.structuredContent.operation, 'host.start');
  assert.equal(started.structuredContent.ok, true, JSON.stringify(started.structuredContent));
  assert.equal(started.structuredContent.data.managed, true);
  assert.ok(Number.isInteger(started.structuredContent.data.pid));
  assert.ok(existsSync(readyFile));

  const restarted = await client.call('snapback_restart');
  assert.equal(restarted.structuredContent.operation, 'host.restart');
  assert.equal(restarted.structuredContent.ok, true, JSON.stringify(restarted.structuredContent));
  assert.equal(restarted.structuredContent.authority, null);
  assert.deepEqual(restarted.structuredContent.data.previous, {
    credentialedHostOpResultAccepted: true,
    configuredUrlStoppedAnswering: true,
    processIdentityVerified: true,
  });
  assert.equal(restarted.structuredContent.data.current.managed, true);
  assert.ok(Number.isInteger(restarted.structuredContent.data.current.pid));

  const instanceResource = await client.request('resources/read', {
    uri: 'snapback-controls://instance',
  });
  assert.equal(instanceResource.error, undefined, JSON.stringify(instanceResource.error));
  const instanceCatalog = JSON.parse(instanceResource.result.contents[0].text);
  assert.equal(instanceCatalog.schemaVersion, 'snapback.control-catalog-instance.v1');
  assert.equal(instanceCatalog.catalogDigest, buildControlCatalog.catalogDigest);
  assert.equal(instanceCatalog.startupNonce, readReadyDescriptor(readyFile).startupNonce);

  for (const [tool, operation] of [
    ['snapback_load_schema', 'schema.load'],
    ['snapback_load_functions', 'functions.load'],
  ]) {
    const loaded = await client.call(tool);
    assert.notEqual(loaded.isError, true, JSON.stringify(loaded));
    assert.equal(loaded.structuredContent.operation, operation);
    assert.equal(loaded.structuredContent.ok, true, JSON.stringify(loaded.structuredContent));
  }

  const telemetryStats = await client.call('snapback_telemetry_stats', { kind: 'http_request' });
  assert.equal(telemetryStats.structuredContent.operation, 'telemetry.stats');
  assert.equal(telemetryStats.structuredContent.ok, true, JSON.stringify(telemetryStats.structuredContent));
  assert.equal(telemetryStats.structuredContent.data.schemaVersion, 'snapback.telemetry.stats.v1');
  assert.ok(Array.isArray(telemetryStats.structuredContent.data.coverage.partitions));

  const telemetryEvents = await client.call('snapback_telemetry_events', {
    kind: 'http_request', limit: 5,
  });
  assert.equal(
    telemetryEvents.structuredContent.operation,
    'telemetry.events',
    JSON.stringify(telemetryEvents.structuredContent),
  );
  assert.equal(telemetryEvents.structuredContent.ok, true, JSON.stringify(telemetryEvents.structuredContent));
  assert.equal(telemetryEvents.structuredContent.authority.mode, 'adminSecretRead');
  assert.equal(telemetryEvents.structuredContent.authority.scope, 'telemetry.events');
  assert.ok(telemetryEvents.structuredContent.data.events.length > 0);
  assert.ok(telemetryEvents.structuredContent.data.events.length <= 5);

  const telemetryExport = await client.call('snapback_telemetry_export', {
    kind: 'http_request', maxRows: 1, maxBytes: 32 * 1024,
  });
  assert.equal(telemetryExport.structuredContent.operation, 'telemetry.export');
  assert.notEqual(telemetryExport.isError, true, JSON.stringify(telemetryExport));
  // This real-process acceptance intentionally exercises ordinary `snapback
  // start`, whose compatibility seam has no authoritative TargetDescriptor.
  // @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
  //   the MCP wrapper must not invent an environment identity; the bound
  //   finite-page success path lives in native host-op acceptance + fixtures.
  assert.equal(telemetryExport.structuredContent.ok, false);
  assert.equal(telemetryExport.structuredContent.authority.scope, 'telemetry.export');
  assert.equal(
    telemetryExport.structuredContent.diagnostics[0].code,
    'SNAPBACK_TELEMETRY_IDENTITY_UNBOUND',
  );

  const errorIssues = await client.call('snapback_errors_issues', { limit: 5 });
  assert.equal(errorIssues.structuredContent.operation, 'errors.issues');
  assert.equal(errorIssues.structuredContent.ok, true, JSON.stringify(errorIssues.structuredContent));
  assert.equal(errorIssues.structuredContent.data.schemaVersion, 'snapback.errors.issues.v1');
  assert.ok(Array.isArray(errorIssues.structuredContent.data.issues));
  assert.equal(errorIssues.structuredContent.authority.mode, 'devAdminBypass');
  assert.equal(
    errorIssues.structuredContent.authority.reason,
    'host-ops structural error metadata read gate',
  );

  // Drive the agent CLI itself against the same real server. The resolve
  // command reaches the deploy-hook bulk route and fails only because this
  // fresh process has no activation with the deliberately unknown name.
  const cliAdminToken = managedAdminToken(
    JSON.parse(readFileSync(readyFile, 'utf8')),
    database,
  );
  assert.ok(cliAdminToken);
  const cliEnv = { ...process.env, SNAPBACK_ADMIN_TOKEN: cliAdminToken };
  const cliIssues = spawnSync(runtimeBinary, [
    'errors', 'issues', '--ready-file', readyFile, '--limit', '5',
  ], { cwd: project, encoding: 'utf8', env: cliEnv });
  assert.equal(cliIssues.status, 0, cliIssues.stderr);
  assert.equal(JSON.parse(cliIssues.stdout).schemaVersion, 'snapback.errors.issues.v1');
  const cliResolve = spawnSync(runtimeBinary, [
    'errors', 'resolve', '--ready-file', readyFile,
    '--open-before', 'release-not-activated',
  ], { cwd: project, encoding: 'utf8', env: cliEnv });
  assert.notEqual(cliResolve.status, 0, cliResolve.stdout);
  assert.match(cliResolve.stderr, /SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED/);

  const missingErrorIssue = await client.call('snapback_errors_issue', {
    issue: 'iss_00000000000000000000000000',
  });
  assert.equal(missingErrorIssue.structuredContent.operation, 'errors.issue');
  assert.equal(missingErrorIssue.structuredContent.ok, false);
  assert.equal(missingErrorIssue.structuredContent.authority.mode, 'adminSecretRead');
  assert.equal(missingErrorIssue.structuredContent.authority.scope, 'errors.issue');
  assert.equal(
    missingErrorIssue.structuredContent.diagnostics[0].code,
    'SNAPBACK_ERROR_ISSUE_NOT_FOUND',
  );

  const missingTransition = await client.call('snapback_errors_transition', {
    issue: 'iss_00000000000000000000000000', to: 'resolved', expectSeq: 0,
  });
  assert.equal(missingTransition.structuredContent.operation, 'errors.transition');
  assert.equal(missingTransition.structuredContent.ok, true, JSON.stringify(missingTransition.structuredContent));
  assert.equal(missingTransition.structuredContent.authority.mode, 'devAdminBypass');
  assert.equal(
    missingTransition.structuredContent.authority.reason,
    'host-ops error transition admin-write gate',
  );
  assert.equal(missingTransition.structuredContent.data.rows[0].outcome, 'missing');

  // Mutation without an authority tuple: structured refusal with a
  // machine-readable next hint — and a successful tool result, not an error.
  const unauthorized = await client.call(mutationTool.name, { args: { title: 'nope' } });
  assert.notEqual(unauthorized.isError, true);
  assert.equal(unauthorized.structuredContent.ok, false);
  assert.equal(unauthorized.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_AUTHORITY_REQUIRED');
  assert.equal(unauthorized.structuredContent.next[0].kind, 'retryWithAuthority');

  const reasonless = await client.call(mutationTool.name, {
    args: { title: 'nope' },
    authority: { mode: 'devAdminBypass' },
  });
  assert.equal(reasonless.structuredContent.ok, false);
  assert.equal(reasonless.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_AUTHORITY_REASON_REQUIRED');
  assert.equal(reasonless.structuredContent.next[0].kind, 'retryWithAuthority');

  const committed = await client.call(mutationTool.name, {
    args: { title: 'from mcp' },
    authority: { mode: 'devUser', userId: 'u_mcp' },
  });
  assert.notEqual(committed.isError, true, JSON.stringify(committed));
  assert.equal(committed.structuredContent.operation, 'function.run');
  assert.equal(committed.structuredContent.ok, true, JSON.stringify(committed.structuredContent));
  assert.ok(committed.structuredContent.data.mutationCommit);

  const queried = await client.call(queryTool.name, {
    args: {},
    authority: { mode: 'devUser', userId: 'u_mcp' },
  });
  assert.equal(queried.structuredContent.ok, true, JSON.stringify(queried.structuredContent));
  const rows = queried.structuredContent.data.functionResult.rows;
  assert.equal(rows.length, 1, JSON.stringify(queried.structuredContent.data));
  assert.equal(rows[0].title, 'from mcp');

  const patchAuthority = {
    mode: 'devUser',
    actorPrincipal: null,
    effectivePrincipal: { userId: 'u_mcp', roles: [] },
    localDevOnly: true,
    adminBypass: false,
    scope: null,
    reason: null,
  };
  const patchInput = {
    table: 'todos',
    rowId: rows[0]._id,
    expectedVersion: rows[0]._version,
    patch: { title: 'patched through mcp' },
    authority: patchAuthority,
    reason: 'MCP control acceptance patch',
  };
  const patchPreview = await client.call('snapback_data_patch_preview', patchInput);
  assert.equal(patchPreview.structuredContent.ok, true, JSON.stringify(patchPreview.structuredContent));
  assert.match(patchPreview.structuredContent.data.applyTokenId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(patchPreview.structuredContent.data.applyToken, undefined);
  assert.doesNotMatch(patchPreview.content[0].text, /sbpat_/);

  // A non-authorizing id cannot switch the authority/patch binding. The MCP
  // wrapper keeps the matching capability available for the exact apply.
  const patchMismatch = await client.call('snapback_data_patch_apply', {
    ...patchInput,
    patch: { title: 'tampered through mcp' },
    applyTokenId: patchPreview.structuredContent.data.applyTokenId,
  });
  assert.equal(patchMismatch.structuredContent.ok, false);
  assert.equal(
    patchMismatch.structuredContent.diagnostics[0].code,
    'SNAPBACK_MCP_DATA_PATCH_TOKEN_UNAVAILABLE',
  );

  const patchApplied = await client.call('snapback_data_patch_apply', {
    ...patchInput,
    applyTokenId: patchPreview.structuredContent.data.applyTokenId,
  });
  assert.equal(patchApplied.structuredContent.ok, true, JSON.stringify(patchApplied.structuredContent));
  assert.equal(patchApplied.structuredContent.data.receiptKind, 'dataPatchReceipt.v1');
  assert.equal(patchApplied.structuredContent.data.authority.mode, 'devUser');
  assert.equal(patchApplied.structuredContent.data.reason, patchInput.reason);
  assert.equal(patchApplied.structuredContent.data.applyToken, undefined);
  assert.doesNotMatch(patchApplied.content[0].text, /sbpat_/);

  const patchReused = await client.call('snapback_data_patch_apply', {
    ...patchInput,
    applyTokenId: patchPreview.structuredContent.data.applyTokenId,
  });
  assert.equal(patchReused.structuredContent.ok, false);
  assert.equal(
    patchReused.structuredContent.diagnostics[0].code,
    'SNAPBACK_MCP_DATA_PATCH_TOKEN_UNAVAILABLE',
  );

  // LLP 0184 Phase 2 P1: exercise every read/diagnose projection against the
  // same live server. Unknown config/job/asset identities intentionally drive
  // the ordinary typed refusal path; the list/scan calls drive success.
  const dataScan = await client.call('snapback_data_scan', {
    table: 'todos', limit: 10, offset: 0,
  });
  assert.equal(dataScan.structuredContent.operation, 'data.scan');
  assert.equal(dataScan.structuredContent.ok, true, JSON.stringify(dataScan.structuredContent));
  assert.ok(Array.isArray(dataScan.structuredContent.data.rows));
  assert.equal(dataScan.structuredContent.data.rows.length, 1);

  for (const table of ['../telemetry/export', 'todos?limit=500', 'todos#fragment']) {
    const refused = await client.call('snapback_data_scan', { table });
    assert.equal(refused.isError, true);
    assert.equal(refused.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_ARGUMENT_INVALID');
  }

  const configStatus = await client.call('snapback_config_status');
  assert.equal(configStatus.structuredContent.operation, 'config.status');
  assert.equal(configStatus.structuredContent.ok, true, JSON.stringify(configStatus.structuredContent));
  assert.ok(Array.isArray(configStatus.structuredContent.data.entries));

  const configPlan = await client.call('snapback_config_plan');
  assert.equal(configPlan.structuredContent.operation, 'config.plan');
  assert.equal(configPlan.structuredContent.ok, true, JSON.stringify(configPlan.structuredContent));

  const configVerify = await client.call('snapback_config_verify', { entry: 'no.such.entry' });
  assert.equal(configVerify.structuredContent.operation, 'config.verify');
  assert.equal(configVerify.structuredContent.ok, false, JSON.stringify(configVerify.structuredContent));

  const cronList = await client.call('snapback_cron_list');
  assert.equal(cronList.structuredContent.operation, 'cron.list');
  assert.equal(cronList.structuredContent.ok, true, JSON.stringify(cronList.structuredContent));
  assert.equal(cronList.structuredContent.data.cron.artifactKind, 'snapback.cron-list/v1');
  assert.ok(Array.isArray(cronList.structuredContent.data.cron.jobs));

  const jobsList = await client.call('snapback_jobs_list');
  assert.equal(jobsList.structuredContent.operation, 'jobs.list');
  assert.equal(jobsList.structuredContent.ok, true, JSON.stringify(jobsList.structuredContent));

  const jobsShow = await client.call('snapback_jobs_show', { id: 'job_does_not_exist' });
  assert.equal(jobsShow.structuredContent.operation, 'jobs.show');
  assert.equal(jobsShow.structuredContent.ok, false, JSON.stringify(jobsShow.structuredContent));

  const jobsTraversal = await client.call('snapback_jobs_show', { id: '../data/users?limit=500' });
  assert.equal(jobsTraversal.isError, true);
  assert.equal(jobsTraversal.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_ARGUMENT_INVALID');

  const assetList = await client.call('snapback_asset_list');
  assert.equal(assetList.structuredContent.operation, 'asset.list');
  assert.equal(assetList.structuredContent.ok, true, JSON.stringify(assetList.structuredContent));

  const assetInspect = await client.call('snapback_asset_inspect', { assetId: 'asset_does_not_exist' });
  assert.equal(assetInspect.structuredContent.operation, 'asset.inspect');
  assert.equal(assetInspect.structuredContent.ok, false, JSON.stringify(assetInspect.structuredContent));

  const assetRetry = await client.call('snapback_asset_retry', { assetId: 'asset_does_not_exist' });
  assert.equal(assetRetry.structuredContent.operation, 'asset.retry');
  assert.equal(assetRetry.structuredContent.ok, false, JSON.stringify(assetRetry.structuredContent));

  // Read diagnostics through MCP: the SC-1a recent-invocations ring reflects
  // the loads and runs since the restart; MCP-local authority refusals never
  // reached the server and are absent.
  const inspected = await client.call('snapback_inspect');
  assert.equal(inspected.structuredContent.operation, 'app.inspect');
  assert.equal(inspected.structuredContent.ok, true);
  const recent = inspected.structuredContent.data.recentInvocations;
  assert.deepEqual(
    recent.map((entry) => entry.operation),
    ['function.run', 'function.run', 'functions.load', 'schema.load'],
  );
  assert.ok(recent.every((entry) => entry.outcome === 'ok'));
  assert.equal(recent[1].functionId, mutationEntry.functionId);
  for (const entry of recent) {
    assert.match(entry.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(typeof entry.durationMs, 'number');
    assert.ok(Array.isArray(entry.diagnostics));
  }

  // LLP 0146 D7 option B: MCP preserves the unchanged host-op Diagnostic,
  // including the ruled nested carrier, without adding an MCP-only wrapper.
  let unknownFunction;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    unknownFunction = await client.call('snapback_run_function', {
      function: 'listTods',
      args: {},
    });
  }
  assert.equal(unknownFunction.structuredContent.ok, false);
  assert.equal(
    unknownFunction.structuredContent.diagnostics[0].code,
    'SNAPBACK_HOST_OP_FUNCTION_UNKNOWN',
  );
  const unknownFunctionDetails = unknownFunction.structuredContent.diagnostics[0].details;
  assert.equal(unknownFunctionDetails.candidateFunctions[0].name, 'listTodos');
  assert.equal(unknownFunctionDetails.candidateFunctions[0].kind, 'LiveQuery');
  assert.equal(typeof unknownFunctionDetails.artifactHash, 'string');
  const remediation = decodeRemediationSet(unknownFunctionDetails);
  assert.equal(remediation.artifactHash, unknownFunctionDetails.artifactHash);
  assert.equal(remediation.items[0].action.replacement, 'listTodos');
  assert.equal(
    remediation.items[0].precondition.artifactHash,
    unknownFunctionDetails.artifactHash,
  );
  const appliedRemediation = await client.call('snapback_remediation_apply', {
    schemaVersion: 'snapback.remediation-apply.v1',
    artifactHash: remediation.artifactHash,
    item: remediation.items[0],
  });
  assert.equal(appliedRemediation.structuredContent.ok, true, JSON.stringify(appliedRemediation));
  assert.deepEqual(
    appliedRemediation.structuredContent.data.replacement,
    { target: 'function', value: 'listTodos' },
  );
  const staleArtifactHash = `sha256:${'a'.repeat(16)}`;
  const staleItem = structuredClone(remediation.items[0]);
  staleItem.precondition.artifactHash = staleArtifactHash;
  const staleRemediation = await client.call('snapback_remediation_apply', {
    schemaVersion: 'snapback.remediation-apply.v1',
    artifactHash: staleArtifactHash,
    item: staleItem,
  });
  assert.equal(staleRemediation.structuredContent.ok, false);
  assert.equal(
    staleRemediation.structuredContent.diagnostics[0].code,
    'SNAPBACK_REMEDIATION_ARTIFACT_STALE',
  );
  assert.ok(unknownFunctionDetails.localMissSummary.sameMissCount >= 3);
  assert.equal(unknownFunctionDetails.localMissSummary.capacity, 128);
  assert.doesNotMatch(JSON.stringify(unknownFunction.structuredContent), /listTods/);

  const unknownArgumentField = await client.call(mutationTool.name, {
    args: { titel: 'not disclosed' },
    authority: { mode: 'devUser', userId: 'u_mcp' },
  });
  assert.equal(unknownArgumentField.structuredContent.ok, false);
  assert.equal(
    unknownArgumentField.structuredContent.diagnostics[0].code,
    'SNAPBACK_MCP_ARGUMENT_INVALID',
  );
  const unknownArgumentDetails = unknownArgumentField.structuredContent.diagnostics[0].details;
  assert.ok(unknownArgumentDetails.errors.some((error) => error.keyword === 'required'));
  assert.ok(unknownArgumentDetails.errors.some((error) => error.keyword === 'additionalProperties'));
  assert.doesNotMatch(JSON.stringify(unknownArgumentField.structuredContent), /titel/);

  const wrongArgumentShape = await client.call(mutationTool.name, {
    args: { title: 42 },
    authority: { mode: 'devUser', userId: 'u_mcp' },
  });
  assert.equal(wrongArgumentShape.structuredContent.ok, false);
  assert.equal(
    wrongArgumentShape.structuredContent.diagnostics[0].code,
    'SNAPBACK_MCP_ARGUMENT_INVALID',
  );
  const wrongArgumentDetails = wrongArgumentShape.structuredContent.diagnostics[0].details;
  assert.ok(wrongArgumentDetails.errors.some(
    (error) => error.instancePath === '/args/title' && error.keyword === 'type',
  ));

  // Reset is destructive: refused without an explicit tuple, and the served
  // envelope records the authority when it runs.
  const resetUnauthorized = await client.call('snapback_reset', {});
  assert.equal(resetUnauthorized.structuredContent.ok, false);
  assert.equal(resetUnauthorized.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_ARGUMENT_INVALID');
  const reset = await client.call('snapback_reset', {
    authority: { mode: 'devAdminBypass', reason: 'acceptance cleanup' },
  });
  assert.equal(reset.structuredContent.operation, 'app.reset');
  assert.equal(reset.structuredContent.ok, true, JSON.stringify(reset.structuredContent));
  assert.equal(reset.structuredContent.authority.mode, 'devAdminBypass');

  const acceptance = await client.call('snapback_acceptance_run');
  assert.notEqual(acceptance.isError, true);
  assert.equal(acceptance.structuredContent.resultKind, 'hostOpsResult');
  assert.equal(acceptance.structuredContent.operation, 'acceptance.run');
  assert.equal(acceptance.structuredContent.ok, false);
  assert.equal(acceptance.structuredContent.diagnostics[0].code, 'SNAPBACK_HOST_OP_UNIMPLEMENTED');
  assert.equal(acceptance.structuredContent.diagnostics[0].details.operation, 'acceptance.run');
  // The envelope is proxied from the running server, not fabricated by the
  // MCP process: the server stamps its own URL into the target block.
  assert.equal(
    acceptance.structuredContent.target.serverUrl,
    restarted.structuredContent.data.current.serverUrl,
  );
  assert.equal(acceptance.structuredContent.authority.mode, 'none');

  const initialProfile = await client.call('snapback_network_profile_get');
  assert.equal(initialProfile.structuredContent.operation, 'debug.networkProfileGet');
  assert.equal(initialProfile.structuredContent.ok, true, JSON.stringify(initialProfile.structuredContent));
  assert.equal(initialProfile.structuredContent.data.profile.name, 'normal');

  const setProfile = await client.call('snapback_network_profile_set', {
    operatorPrincipal: 'operator:mcp-acceptance',
    profile: {
      name: 'mcp-zero-delay',
      mutationAckDelayMs: 0,
      liveDeltaDelayMs: 0,
      queryResponseDelayMs: 0,
      jitterMs: 0,
    },
  });
  assert.equal(setProfile.structuredContent.resultKind, 'hostOpsResult');
  assert.equal(setProfile.structuredContent.operation, 'debug.networkProfileSet');
  assert.equal(setProfile.structuredContent.ok, true, JSON.stringify(setProfile.structuredContent));
  assert.equal(setProfile.structuredContent.data.profile.name, 'mcp-zero-delay');
  assert.equal(setProfile.structuredContent.data.provenance.source, 'mcp');
  assert.equal(setProfile.structuredContent.data.provenance.principal, 'operator:mcp-acceptance');

  const restoredProfile = await client.call('snapback_network_profile_set', { profile: 'normal' });
  assert.equal(restoredProfile.structuredContent.ok, true, JSON.stringify(restoredProfile.structuredContent));
  assert.equal(restoredProfile.structuredContent.data.profile.name, 'normal');

  // LLP 0184 §P2's controlled mutations: config.unset, cron.tick/runOne,
  // jobs.drain, and connection.disconnect all sit outside the host-ops
  // multiplexer, so this proves postAdminRoute's own envelope wrapping
  // against the real routes, not just the host-ops-proxied tools above.
  const unsetMissingEntry = await client.call('snapback_config_unset', { entry: 'no.such.entry' });
  assert.equal(unsetMissingEntry.structuredContent.operation, 'config.unset');
  // config.unset is defined over any entry identifier, present or absent
  // (LLP 0036's own semantics); a fresh app has no configured entries, so
  // this call still reaches the route and confirms the wrapper's success
  // path rather than only its failure path.
  assert.notEqual(unsetMissingEntry.isError, true, JSON.stringify(unsetMissingEntry));
  assert.equal(unsetMissingEntry.structuredContent.data.entry, 'no.such.entry');

  const cronTick = await client.call('snapback_cron_tick');
  assert.equal(cronTick.structuredContent.operation, 'cron.tick');
  assert.notEqual(cronTick.isError, true, JSON.stringify(cronTick));
  assert.ok(Array.isArray(cronTick.structuredContent.data.runs), JSON.stringify(cronTick.structuredContent));

  const cronRunUnknown = await client.call('snapback_cron_run', { name: 'no-such-cron-job' });
  assert.equal(cronRunUnknown.structuredContent.operation, 'cron.runOne');
  assert.equal(cronRunUnknown.structuredContent.ok, false, JSON.stringify(cronRunUnknown.structuredContent));

  const cleanupPreview = await client.call('snapback_ephemeral_cleanup', {
    olderThanMs: 0,
    dryRun: true,
    maxEntries: 10,
  });
  assert.equal(cleanupPreview.structuredContent.operation, 'ephemeral.cleanup');
  assert.equal(cleanupPreview.structuredContent.ok, true, JSON.stringify(cleanupPreview.structuredContent));
  assert.equal(cleanupPreview.structuredContent.data.artifactKind, 'snapback.ephemeral-cleanup-receipt/v1');
  assert.equal(cleanupPreview.structuredContent.data.dryRun, true);
  assert.equal(cleanupPreview.structuredContent.data.counts.deleted, 0);

  const cleanupApply = await client.call('snapback_ephemeral_cleanup', {
    olderThanMs: 0,
    dryRun: false,
    maxEntries: 10,
  });
  assert.equal(cleanupApply.structuredContent.operation, 'ephemeral.cleanup');
  assert.equal(cleanupApply.structuredContent.ok, true, JSON.stringify(cleanupApply.structuredContent));
  assert.equal(cleanupApply.structuredContent.data.dryRun, false);

  const jobsDrain = await client.call('snapback_jobs_drain', { nowMs: Date.now(), maxWaves: 1 });
  assert.equal(jobsDrain.structuredContent.operation, 'jobs.drain');
  assert.notEqual(jobsDrain.isError, true, JSON.stringify(jobsDrain));
  assert.equal(jobsDrain.structuredContent.data.artifactKind, 'snapback.jobs-drain/v0');

  // connection.disconnect is a debug perturbation, never application
  // disconnect authority: an unknown connection id still reaches the route
  // (proving the wrapper's envelope shape) and the receipt records the
  // client-supplied reason regardless of the server's own outcome.
  const disconnectUnknown = await client.call('snapback_connection_disconnect', {
    connectionId: 'conn_does_not_exist',
    reason: 'acceptance: unknown-connection probe',
  });
  assert.equal(disconnectUnknown.structuredContent.operation, 'connection.disconnect');
  assert.notEqual(disconnectUnknown.isError, true, JSON.stringify(disconnectUnknown));
  assert.equal(disconnectUnknown.structuredContent.ok, true, JSON.stringify(disconnectUnknown.structuredContent));
  assert.equal(disconnectUnknown.structuredContent.data.reason, 'acceptance: unknown-connection probe');

  // The fresh MCP process threads its readiness descriptor's startup nonce
  // into the direct route. An unknown collection must therefore reach the
  // store's distinct error instead of failing at the process fence.
  const operatorDeleteUnknown = await client.call('snapback_ephemeral_operator_delete', {
    collection: 'noSuchCollection',
    scope: { boardId: 'board-1' },
    entryKey: 'owner',
    expectedScopeEpoch: 1,
    expectedEntryGeneration: 1,
    reason: 'acceptance: projection and nonce probe',
  });
  assert.equal(operatorDeleteUnknown.structuredContent.operation, 'ephemeral.operatorDelete');
  assert.equal(operatorDeleteUnknown.structuredContent.ok, false, JSON.stringify(operatorDeleteUnknown.structuredContent));
  assert.equal(
    operatorDeleteUnknown.structuredContent.diagnostics[0].code,
    'SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION',
  );

  // Asset family: gcSweep (deterministic under an injected clock) and
  // rotateSigningKey are both safe, idempotent-enough to run in this
  // acceptance pass; export/delete against a real asset are covered by the
  // existing CLI asset acceptance and are not duplicated here.
  const gcSweep = await client.call('snapback_asset_gc_sweep', { nowMs: Date.now() });
  assert.equal(gcSweep.structuredContent.operation, 'asset.gcSweep');
  assert.notEqual(gcSweep.isError, true, JSON.stringify(gcSweep));
  assert.equal(gcSweep.structuredContent.ok, true, JSON.stringify(gcSweep.structuredContent));

  const rotateKey = await client.call('snapback_asset_rotate_signing_key');
  assert.equal(rotateKey.structuredContent.operation, 'asset.rotateSigningKey');
  assert.notEqual(rotateKey.isError, true, JSON.stringify(rotateKey));
  assert.equal(rotateKey.structuredContent.ok, true, JSON.stringify(rotateKey.structuredContent));

  // LLP 0184 §Design/2: `snapback_stop` (and, by composition, the mutating
  // half of `snapback_restart`) must refuse without the same admin
  // credential the host-ops HTTP surface requires — proven negatively here,
  // not just positively by every prior successful stop/restart call above.
  // Break the admin-token carrier the same way managedAdminToken's own
  // validation would reject it (missing file), stop must refuse, and the
  // server must still be running afterward — proving the refusal happened
  // before any process signal, not after a stop that then failed to report.
  const adminTokenPath = `${database}.admin-token`;
  const adminTokenBackupPath = `${adminTokenPath}.bak`;
  assert.ok(existsSync(adminTokenPath), 'expected an auto-minted admin-token carrier for the loopback dev server');
  const { renameSync } = await import('node:fs');
  renameSync(adminTokenPath, adminTokenBackupPath);
  try {
    const stopWithoutCredential = await client.call('snapback_stop');
    assert.equal(stopWithoutCredential.structuredContent.operation, 'host.stop');
    assert.equal(stopWithoutCredential.structuredContent.ok, false, JSON.stringify(stopWithoutCredential.structuredContent));
    assert.match(
      stopWithoutCredential.structuredContent.diagnostics[0].code,
      /SNAPBACK_(MCP_ADMIN_CREDENTIAL_REQUIRED|DEV_ADMIN_TOKEN_FILE_INVALID)/,
    );
    assert.ok(existsSync(readyFile), 'stop must not have signaled the server without the admin credential');
  } finally {
    renameSync(adminTokenBackupPath, adminTokenPath);
  }

  const forgedDescriptor = readReadyDescriptor(readyFile);
  forgedDescriptor.target.pid = forgedDescriptor.pid;
  forgedDescriptor.target.verifiedBy = 'caller-authored-extra';
  writeFileSync(readyFile, `${JSON.stringify(forgedDescriptor)}\n`, { mode: 0o600 });
  const stopped = await client.call('snapback_stop');
  assert.equal(stopped.structuredContent.operation, 'host.stop');
  assert.equal(stopped.structuredContent.ok, true, JSON.stringify(stopped.structuredContent));
  assert.equal(stopped.structuredContent.authority, null);
  assert.deepEqual(stopped.structuredContent.target, {
    appId: forgedDescriptor.target.appId,
    appRoot: forgedDescriptor.target.appRoot,
    targetProfile: forgedDescriptor.target.targetProfile,
    serverUrl: forgedDescriptor.target.serverUrl,
  });
  assert.deepEqual(stopped.structuredContent.data, {
    credentialedHostOpResultAccepted: true,
    configuredUrlStoppedAnswering: true,
    processIdentityVerified: true,
  });
  assert.equal(existsSync(readyFile), false);

  const unknown = await client.request('tools/call', { name: 'no_such_tool', arguments: {} });
  assert.equal(unknown.error.code, -32602);

  mcp.stdin.end();
  await new Promise((resolveExit) => mcp.once('exit', resolveExit));
  mcp = null;
  console.log('mcp-control.test.mjs: full MCP loop (start, restart, load, run, diagnostics, stop), catalog, and authority gates pass');
} finally {
  if (mcp && mcp.exitCode === null) mcp.kill('SIGKILL');
  // Never leave a native server holding the temp database (the stale-server
  // trap): stop it via the nonce-verified native path if it survived.
  const readyFile = join(root, 'state', 'mcp.ready.json');
  if (existsSync(readyFile)) {
    const { native } = await import('./index.mjs');
    const descriptor = readReadyDescriptor(readyFile);
    const adminToken = managedAdminToken(descriptor, join(root, 'state', 'mcp.sqlite3'));
    native(runtimeBinary, ['stop', '--ready-file', readyFile], {
      env: adminToken
        ? { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken }
        : process.env,
    });
  }
  rmSync(root, { recursive: true, force: true });
}
