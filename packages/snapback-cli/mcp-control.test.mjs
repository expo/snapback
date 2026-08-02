// Acceptance for the LLP 0042 control-plane MCP server (LLP 0079 SC-1b):
// drive the full loop — start → load schema/functions → run function → read
// diagnostics → stop — through newline-delimited JSON-RPC alone, against a
// real native server on an ephemeral port with a temp database + ready file.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateApp, scaffoldApp } from './index.mjs';
import { buildAppDataCatalog, functionToolName } from './mcp-control.mjs';

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
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new McpClient(mcp);

  const initialized = await client.request('initialize', {});
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.equal(initialized.result.serverInfo.name, 'snapback-control');

  const listed = await client.request('tools/list');
  const tools = listed.result.tools;
  const names = tools.map((tool) => tool.name);
  for (const pinned of [
    'snapback_start', 'snapback_stop', 'snapback_restart', 'snapback_inspect',
    'snapback_reset', 'snapback_load_schema', 'snapback_load_functions',
    'snapback_run_function', 'snapback_acceptance_run',
    'snapback_telemetry_stats', 'snapback_telemetry_events', 'snapback_telemetry_export',
  ]) {
    assert.ok(names.includes(pinned), `missing pinned control tool ${pinned}`);
  }
  assert.equal(tools.find((tool) => tool.name === 'snapback_inspect').annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === 'snapback_reset').annotations.destructiveHint, true);

  const catalog = listed.result._meta['snapback/appDataCatalog'];
  assert.equal(catalog.catalogKind, 'appDataMcpCatalog');
  assert.equal(catalog.schemaVersion, 'snapback.v0');
  assert.match(catalog.functionManifestHash, /^sha256:[0-9a-f]{64}$/);
  const catalogTools = tools.filter((tool) => tool.name.startsWith('snapback_fn_'));
  const queryTool = catalogTools.find((tool) => tool._meta['snapback/catalogEntry'].kind === 'query');
  const mutationTool = catalogTools.find((tool) => tool._meta['snapback/catalogEntry'].kind === 'mutation');
  assert.ok(queryTool, 'catalog must expose at least one query tool');
  assert.ok(mutationTool, 'catalog must expose at least one mutation tool');
  assert.equal(queryTool.annotations.readOnlyHint, true);
  // Input schemas derive from the generated args validators, not guesses.
  assert.deepEqual(mutationTool.inputSchema.required, ['title']);
  assert.equal(mutationTool.inputSchema.properties.title.type, 'string');
  const mutationEntry = mutationTool._meta['snapback/catalogEntry'];
  assert.equal(mutationEntry.authorityRequired.explicitTuple, true);
  assert.equal(mutationEntry.dryRunSupported, false);
  assert.match(mutationEntry.functionId, /:createTodo$/);

  const started = await client.call('snapback_start');
  assert.notEqual(started.isError, true, JSON.stringify(started));
  assert.equal(started.structuredContent.operation, 'host.start');
  assert.equal(started.structuredContent.ok, true, JSON.stringify(started.structuredContent));
  assert.ok(Number.isInteger(started.structuredContent.data.pid));
  assert.ok(existsSync(readyFile));

  const restarted = await client.call('snapback_restart');
  assert.equal(restarted.structuredContent.operation, 'host.restart');
  assert.equal(restarted.structuredContent.ok, true, JSON.stringify(restarted.structuredContent));
  assert.ok(Number.isInteger(restarted.structuredContent.data.current.pid));

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
  assert.equal(telemetryEvents.structuredContent.operation, 'telemetry.events');
  assert.equal(telemetryEvents.structuredContent.ok, true, JSON.stringify(telemetryEvents.structuredContent));
  assert.equal(telemetryEvents.structuredContent.authority.mode, 'adminSecretRead');
  assert.equal(telemetryEvents.structuredContent.authority.scope, 'telemetry.events');
  assert.ok(telemetryEvents.structuredContent.data.events.length > 0);
  assert.ok(telemetryEvents.structuredContent.data.events.length <= 5);

  const telemetryExport = await client.call('snapback_telemetry_export', {
    kind: 'http_request', maxRows: 1, maxBytes: 32 * 1024,
  });
  assert.equal(telemetryExport.structuredContent.operation, 'telemetry.export');
  assert.equal(telemetryExport.structuredContent.ok, true, JSON.stringify(telemetryExport.structuredContent));
  assert.equal(telemetryExport.structuredContent.authority.scope, 'telemetry.export');
  assert.equal(telemetryExport.structuredContent.data.pageRows, 1);
  assert.equal(telemetryExport.structuredContent.data.truncated, true);
  assert.equal(
    Buffer.byteLength(JSON.stringify(telemetryExport.structuredContent.data)),
    telemetryExport.structuredContent.data.pageBytes,
  );
  assert.equal(typeof telemetryExport.structuredContent.data.continuationToken, 'string');
  const exportSnapshot = telemetryExport.structuredContent.data.header.snapshot;
  const continuedExport = await client.call('snapback_telemetry_export', {
    continuationToken: telemetryExport.structuredContent.data.continuationToken,
    maxRows: 1,
    maxBytes: 32 * 1024,
  });
  assert.equal(continuedExport.structuredContent.ok, true, JSON.stringify(continuedExport.structuredContent));
  assert.deepEqual(continuedExport.structuredContent.data.header.snapshot, exportSnapshot);
  assert.equal(continuedExport.structuredContent.data.pageRows, 1);

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

  // Reset is destructive: refused without an explicit tuple, and the served
  // envelope records the authority when it runs.
  const resetUnauthorized = await client.call('snapback_reset', {});
  assert.equal(resetUnauthorized.structuredContent.ok, false);
  assert.equal(resetUnauthorized.structuredContent.diagnostics[0].code, 'SNAPBACK_MCP_AUTHORITY_REQUIRED');
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

  const stopped = await client.call('snapback_stop');
  assert.equal(stopped.structuredContent.operation, 'host.stop');
  assert.equal(stopped.structuredContent.ok, true, JSON.stringify(stopped.structuredContent));
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
    native(runtimeBinary, ['stop', '--ready-file', readyFile], { env: process.env });
  }
  rmSync(root, { recursive: true, force: true });
}
