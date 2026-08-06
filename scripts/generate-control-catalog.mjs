#!/usr/bin/env node
// LLP 0184 Phase 1: the ControlCatalogV1 compiler. Joins the LLP 0031/0024
// registry export (packages/snapback-cli/control-plane-registry.json,
// itself verified against live Rust by tests/control_catalog_registry_export.rs),
// the control-MCP tool declarations (packages/snapback-cli/mcp-control.mjs's
// CONTROL_TOOLS), the CLI-only-declared family manifest
// (control-catalog/cli-only-operations.json), the hand-authored
// operability backfill (control-catalog/operability-overrides.json), and the
// hosted-adapter manifest (cloudflare/hosted-adapter-manifest.json, checked
// against the Phase 0 audited fixture cloudflare/gateway-paths.inventory.json)
// into one checked ControlCatalogV1 artifact
// (control-catalog/generated/control-catalog.v1.json).
//
// This compiler never invents a fact an owning registry/manifest did not
// declare, and never resolves a conflicting fact toward the more permissive
// value (LLP 0184 §Design/2). `operability` in particular is NEVER derived
// automatically — every in-domain operation not present in
// operability-overrides.json's `overrides` map defaults to `unavailable`
// with a generic "not yet classified" reason, so an un-triaged row can never
// silently read as agent-invokable.
//
// @ref LLP 0184#3-completeness-and-parity-rules — rules 1-10 enforced below;
//   rule 11 (hosted-adapter manifest vs audited fixture) in checkHostedAdapter().
// @ref LLP 0184#3a-the-hosted-cloudflare-leg — the fifth domain leg.

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  for (const message of list) {
    console.error(`[control-catalog] ERROR: ${message}`);
  }
  process.exit(1);
}

// --- Load inputs -----------------------------------------------------------

const registryExportPath = join(ROOT, 'packages/snapback-cli/control-plane-registry.json');
if (!existsSync(registryExportPath)) {
  fail(
    `${registryExportPath} is missing. Generate it with:\n` +
      '  SNAPBACK_WRITE_CONTROL_CATALOG_EXPORT=1 DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" ' +
      'cargo test --test control_catalog_registry_export',
  );
}
const registryExport = readJson(registryExportPath);

const cliOnlyManifest = readJson(join(ROOT, 'control-catalog/cli-only-operations.json'));
const overridesManifest = readJson(join(ROOT, 'control-catalog/operability-overrides.json'));
const hostedManifest = readJson(join(ROOT, 'cloudflare/hosted-adapter-manifest.json'));
const gatewayInventory = readJson(join(ROOT, 'cloudflare/gateway-paths.inventory.json'));

// mcp-control.mjs exports CONTROL_TOOLS directly (LLP 0042's control-plane
// tool declarations). Importing the real module — rather than parsing its
// source text — is the exact "derived ownership, not a second registry"
// posture §Design/2 requires: this is the actual tool list the server
// serves, not a transcription of it. Module-level code in mcp-control.mjs
// has no side effects (spawning only happens inside McpControlServer
// methods, never at import time), so a plain dynamic import is safe here.
const { CONTROL_TOOLS: controlTools } = await import(
  join(ROOT, 'packages/snapback-cli/mcp-control.mjs')
);
if (!Array.isArray(controlTools) || controlTools.length === 0) {
  fail('mcp-control.mjs CONTROL_TOOLS imported empty/non-array; extraction is broken');
}
const controlToolsByOperation = new Map(controlTools.map((tool) => [tool.operation, tool]));

// A small hand-authored CLI-command projection lookup for host-op identities
// with a direct CLI command today. This is NOT a second authority: every
// command name here is checkable against packages/snapback-cli or src/cli.rs
// and is intentionally narrow (only what Phase 1 backfills — see
// control-catalog/operability-overrides.json's coverage note). An operation
// with a real CLI command but no entry here is under-projected in this
// compiler's output, not mis-projected — that gap is called out in the
// Phase 1 completion report, not silently hidden.
const CLI_PROJECTIONS = {
  'host.start': 'snapback host start',
  'host.stop': 'snapback host stop',
  'app.inspect': 'snapback host inspect',
  'app.reset': 'snapback host reset',
  'schema.load': 'snapback host load --schema <path>',
  'functions.load': 'snapback host load --functions <path>',
  'function.run': 'snapback host run',
  'debug.networkProfileGet': 'snapback network-profile get',
  'debug.networkProfileSet': 'snapback network-profile set',
  'telemetry.stats': 'snapback telemetry stats',
  'telemetry.events': 'snapback telemetry events',
  'telemetry.export': 'snapback telemetry export',
  'errors.issues': 'snapback errors issues',
  'errors.issue': 'snapback errors issue',
  'errors.transition': 'snapback errors transition',
  'asset.put': 'snapback assets put',
  'asset.inspect': 'snapback assets inspect',
  'asset.list': 'snapback assets list',
  'asset.retry': 'snapback assets retry',
  'asset.gcSweep': 'snapback assets gc-sweep',
  'asset.delete': 'snapback assets delete',
  'asset.rotateSigningKey': 'snapback assets rotate-signing-key',
  'asset.exportCut': 'snapback assets export-cut',
  'asset.importCut': 'snapback assets import-cut',
  'asset.ensureSeedFixture': 'snapback assets ensure-seed-fixture',
  'admin.link.mint': 'snapback admin link',
  'admin.link.exchange': 'snapback admin link',
  'admin.link.status': 'snapback admin link --status <claim>',
  'admin.link.revoke': 'snapback admin link --revoke <claim>',
  'secretRead.mint': 'snapback secret-read-mint',
  'console.approval.request': 'snapback admin approve',
  'console.approval.poll': 'snapback admin approve',
  'console.approval.approve': 'snapback admin approve',
};

const GUIDE_ANCHORS = {
  'debug.networkProfileGet': 'operating/network-profiles.md#read-the-active-profile',
  'debug.networkProfileSet': 'operating/network-profiles.md#set-a-profile',
  'app.inspect': 'operating/host-ops.md',
  'telemetry.stats': 'operating/host-ops.md',
  'telemetry.events': 'operating/host-ops.md',
  'telemetry.export': 'operating/host-ops.md',
  'errors.issues': 'operating/host-ops.md',
  'errors.issue': 'operating/host-ops.md',
  'errors.transition': 'operating/host-ops.md',
};

// --- Build domain fact index -------------------------------------------

const operationsByName = new Map(registryExport.operations.map((op) => [op.operation, op]));
const hostOpsIdentities = new Set([
  ...registryExport.hostOpsIdentities.served,
  ...registryExport.hostOpsIdentities.cliOnly,
  ...registryExport.hostOpsIdentities.pinnedUnbuilt,
]);

const overrides = overridesManifest.overrides ?? {};
const DEFAULT_UNCLASSIFIED_REASON = {
  owner: 'llp/0184-agent-accessible-control-plane',
  ticketOrDesignPointer: null,
  note:
    'Not yet manually classified by the LLP 0184 Phase 1 backfill. Defaults to unavailable ' +
    '(never a permissive guess) until an authored operability-overrides.json entry exists.',
};

function domainForHostOp(name) {
  const registered = operationsByName.get(`host_ops.${name}`);
  return registered ? 'hostOps' : 'hostOps'; // every SERVED/CLI_ONLY/PINNED_UNBUILT identity is host-op domain regardless of registration
}

function policyFromOperation(op) {
  if (!op) {
    return {
      authority: 'operator',
      routePolicy: 'AdminWrite',
      effect: 'none',
      responseSensitivity: 'OperatorMetadata',
    };
  }
  return {
    authority: op.invocationAuthority === 'Operator' ? 'operator' : op.invocationAuthority,
    routePolicy: op.pathPolicy,
    effect: op.effectPolicy,
    responseSensitivity: op.responseSensitivity,
  };
}

function applyOverride(entry, override) {
  if (!override) return entry;
  if (override.operability) entry.operability = override.operability;
  if (override.surfaceAccessOverride) entry.surfaceAccess = override.surfaceAccessOverride;
  if (override.mcpDeferralReason) entry.mcpDeferralReason = override.mcpDeferralReason;
  if (override.cliDeferralReason) entry.cliDeferralReason = override.cliDeferralReason;
  if (override.composedFrom) entry.composedFrom = override.composedFrom;
  if (override.unavailableReason) entry.unavailableReason = override.unavailableReason;
  if (override.internalReason) entry.internalReason = override.internalReason;
  if (override.projectionCredentials) {
    entry.policy.projectionCredentials = override.projectionCredentials;
  }
  return entry;
}

// --- Compile host-ops entries -------------------------------------------

const entries = [];
const domainErrors = [];
const completenessErrors = [];

for (const name of hostOpsIdentities) {
  const registeredOp = operationsByName.get(`host_ops.${name}`);
  const tool = controlToolsByOperation.get(name);
  const cli = CLI_PROJECTIONS[name] ?? null;
  const isUnbuilt = registryExport.hostOpsIdentities.pinnedUnbuilt.includes(name);
  const isCliOnlyPinned = registryExport.hostOpsIdentities.cliOnly.includes(name);

  let surfaceAccess;
  if (tool && cli) surfaceAccess = 'native';
  else if (tool && !cli) surfaceAccess = 'mcpOnly';
  else if (!tool && cli) surfaceAccess = 'cliOnly';
  else surfaceAccess = isCliOnlyPinned ? 'cliOnly' : 'apiOnly';

  const entry = {
    operation: name,
    title: tool?.title ?? name,
    intents: [],
    status: isUnbuilt ? 'unbuilt' : 'shipped',
    domain: 'hostOps',
    surfaceAccess,
    operability: 'unavailable',
    unavailableReason: DEFAULT_UNCLASSIFIED_REASON,
    availability: { targets: ['local', 'derived-hosted'] },
    policy: policyFromOperation(registeredOp),
    behavior: {
      readOnly: tool?.annotations?.readOnlyHint ?? false,
      destructive: tool?.annotations?.destructiveHint ?? false,
      approvalPosture: tool?.annotations?.destructiveHint ? 'confirmFirst' : null,
      idempotent: tool?.annotations?.idempotentHint ?? false,
      openWorld: tool?.annotations?.openWorldHint ?? false,
      persistsAcrossRestart: false,
    },
    projections: {
      cli,
      mcp: tool?.name ?? null,
      hostOps: name,
      http: 'POST /_snapback/api/host-ops',
      adminClient: null,
      console: null,
    },
    guide: GUIDE_ANCHORS[name] ?? null,
    authorities: ['llp/0024-agent-operating-surface'],
    sources: ['src/host_ops.rs', 'packages/snapback-cli/mcp-control.mjs'],
  };
  if (surfaceAccess === 'cliOnly') entry.mcpDeferralReason = 'Not yet classified.';
  if (surfaceAccess === 'mcpOnly') entry.cliDeferralReason = 'Not yet classified.';

  applyOverride(entry, overrides[name]);
  if (entry.surfaceAccess === 'cliOnly' && !entry.mcpDeferralReason) {
    entry.mcpDeferralReason = 'Not yet classified.';
  }
  if (entry.surfaceAccess === 'mcpOnly' && !entry.cliDeferralReason) {
    entry.cliDeferralReason = 'Not yet classified.';
  }
  if (entry.operability !== 'unavailable') delete entry.unavailableReason;
  if (entry.operability === 'internal' && !entry.internalReason) {
    entry.internalReason = 'Not yet classified.';
  }
  entries.push(entry);
}

// --- Compile direct_runner.* and app.ensure.provision ---------------------

for (const [name, op] of operationsByName) {
  if (name.startsWith('host_ops.')) continue; // handled above
  const entry = {
    operation: name,
    title: name,
    intents: [],
    status: 'shipped',
    domain: name === 'app.ensure.provision' ? 'appEnsureProvisionException' : 'systemApi',
    surfaceAccess: 'apiOnly',
    operability: 'unavailable',
    unavailableReason: DEFAULT_UNCLASSIFIED_REASON,
    mcpDeferralReason: 'Not yet classified.',
    availability: { targets: ['local', 'derived-hosted'] },
    policy: policyFromOperation(op),
    behavior: {
      readOnly: op.pathPolicy === 'AdminRead',
      destructive: false,
      approvalPosture: null,
      idempotent: false,
      openWorld: false,
      persistsAcrossRestart: name !== 'direct_runner.query',
    },
    projections: {
      cli: null,
      mcp: null,
      hostOps: null,
      http: `${op.class === 'AppData' ? 'POST /app/ensure' : `OPERATION ${op.parentPath}`}`,
      adminClient: null,
      console: null,
    },
    guide: null,
    authorities: ['llp/0031-server-route-taxonomy'],
    sources: ['src/server.rs operation_registry()'],
  };
  applyOverride(entry, overrides[name]);
  if (entry.surfaceAccess === 'cliOnly' && !entry.mcpDeferralReason) entry.mcpDeferralReason = 'Not yet classified.';
  if (entry.surfaceAccess === 'mcpOnly' && !entry.cliDeferralReason) entry.cliDeferralReason = 'Not yet classified.';
  if (entry.operability !== 'unavailable') delete entry.unavailableReason;
  entries.push(entry);
}

// --- Compile CLI-only-declared family --------------------------------------

for (const item of cliOnlyManifest.entries) {
  const entry = {
    operation: item.operation,
    title: item.title,
    intents: item.intents ?? [],
    status: item.operabilityOverride === 'unavailable' ? 'unbuilt' : 'shipped',
    domain: 'cliOnlyDeclared',
    surfaceAccess: 'cliOnly',
    operability: item.operabilityOverride ?? 'direct',
    mcpDeferralReason: item.mcpDeferralReason,
    availability: { targets: ['local'] },
    policy: item.policy,
    behavior: {
      readOnly: item.behavior.readOnly,
      destructive: item.behavior.destructive,
      approvalPosture: item.behavior.approvalPosture ?? null,
      idempotent: item.behavior.idempotent ?? false,
      openWorld: item.behavior.openWorld ?? false,
      persistsAcrossRestart: item.behavior.persistsAcrossRestart ?? false,
    },
    projections: { cli: item.cli, mcp: null, hostOps: null, http: null, adminClient: null, console: null },
    guide: item.guide,
    authorities: ['llp/0184-agent-accessible-control-plane'],
    sources: item.sources,
  };
  if (item.unavailableReason) entry.unavailableReason = item.unavailableReason;
  entries.push(entry);
}

// --- Compile the dev-mailbox pin (from live registry export) ---------------

const mailboxRoute = registryExport.routes.find(
  (route) => route.path === '/_snapback/api/auth/mailbox' && route.method === 'GET',
);
if (mailboxRoute) {
  entries.push({
    operation: 'auth.mailbox.read',
    title: 'Read the dev-mailbox capture (operator only)',
    intents: [],
    status: 'shipped',
    domain: 'systemApi',
    surfaceAccess: 'apiOnly',
    operability: 'direct',
    availability: { targets: ['local', 'derived-hosted'] },
    policy: {
      authority: 'operator',
      routePolicy: mailboxRoute.pathPolicy,
      effect: 'none',
      responseSensitivity: mailboxRoute.responseSensitivity,
    },
    behavior: {
      readOnly: true,
      destructive: false,
      approvalPosture: null,
      idempotent: true,
      openWorld: false,
      persistsAcrossRestart: false,
    },
    projections: { cli: null, mcp: null, hostOps: null, http: 'GET /_snapback/api/auth/mailbox', adminClient: null, console: null },
    guide: null,
    authorities: ['llp/0031-server-route-taxonomy'],
    sources: ['src/server.rs route_registry()'],
    pinned: true,
    pinReason:
      "responseSensitivity CredentialSecret: usage-evidence promotion to native/cliOnly/mcpOnly is refused outright regardless of call volume (§Product contract's promotion-refusal rule). This row stays apiOnly until an authored override passes the same secret-carrier review config.set requires.",
  });
} else {
  domainErrors.push(
    'GET /_snapback/api/auth/mailbox not found in the live registry export; the pinned-secret ' +
      'promotion-refusal example cannot be verified against live source.',
  );
}

// --- Compile every remaining SystemApi HTTP route --------------------------
//
// Rule 1 requires a catalog row for every SystemApi route, not only the ones
// with a matching operation_registry() entry (host-ops, direct_runner,
// app.ensure.provision) or the specially-handled mailbox pin above. This
// pass covers the rest of route_registry()'s SystemApi rows — config,
// cron, jobs, table scan, ephemeral cleanup, connection disconnect, console
// credential/claim/reachability/approval, admin-secret-read mint, health,
// inspect, receipts, client-mutation purge, push maintenance.
//
// ROUTE_OPERATION_NAMES gives the RFC-significant routes their canonical
// LLP 0036/0184-vocabulary operation id (config.status, admin.link.*, etc.);
// any route not listed derives a stable id mechanically from its path so no
// SystemApi route can silently fall outside the domain.
const ROUTE_OPERATION_NAMES = {
  'GET /_snapback/api/config/status': 'config.status',
  'GET /_snapback/api/config/plan': 'config.plan',
  'POST /_snapback/api/config/set': 'config.set',
  'POST /_snapback/api/config/unset': 'config.unset',
  'POST /_snapback/api/config/verify': 'config.verify',
  'POST /_snapback/api/console/claim': 'admin.link.mint',
  'POST /_snapback/api/console/claim/exchange': 'admin.link.exchange',
  'POST /_snapback/api/console/claim/status': 'admin.link.status',
  'POST /_snapback/api/console/claim/revoke': 'admin.link.revoke',
  'POST /_snapback/api/cron/tick': 'cron.tick',
  'POST /_snapback/api/cron/{name}/run': 'cron.runOne',
  'POST /_snapback/api/jobs/drain': 'jobs.drain',
  'GET /_snapback/api/jobs': 'jobs.list',
  'GET /_snapback/api/jobs/{id}': 'jobs.show',
  'POST /_snapback/api/ephemeral/cleanup': 'ephemeral.cleanup',
  'POST /_snapback/api/connections/{connection_id}/disconnect': 'connection.disconnect',
  'GET /_snapback/api/data/{table}': 'data.scan',
  'POST /_snapback/api/admin-secret-read/mint': 'secretRead.mint',
};

function deriveOperationName(method, path) {
  if (ROUTE_OPERATION_NAMES[`${method} ${path}`]) return ROUTE_OPERATION_NAMES[`${method} ${path}`];
  const segments = path
    .replace(/^\/_snapback\/api\//, '')
    .split('/')
    .filter((segment) => segment && !segment.startsWith('{'));
  return segments.join('.');
}

// Route paths already fully represented by a host-ops or operation-registry
// row above; the generic pass below must not mint a second row spelling the
// same operation a different way (this was found live during Phase 1
// authoring: functions.run vs function.run, app.seed.clear-v1 vs
// app.seed.clear.v1, and debug/network-profile's GET+PUT both collapsing to
// one derived name that already has host_ops.debug.networkProfileGet/Set
// rows). Each left-hand path is redundant with the right-hand existing
// operation, not a distinct fact.
const ROUTE_ALREADY_COVERED_BY = {
  'POST /_snapback/api/functions/{name}/run': 'function.run',
  'POST /_snapback/api/app/seed/ensure-v1': 'app.seed.ensure.v1',
  'POST /_snapback/api/app/seed/preview-v1': 'app.seed.preview.v1',
  'POST /_snapback/api/app/seed/reset-install-v1': 'app.seed.reset-install.v1',
  'POST /_snapback/api/app/seed/clear-v1': 'app.seed.clear.v1',
  'POST /_snapback/api/app/reset': 'app.reset',
  'POST /_snapback/api/schema/load': 'schema.load',
  'POST /_snapback/api/functions/load': 'functions.load',
  'GET /_snapback/api/telemetry/stats': 'telemetry.stats',
  'GET /_snapback/api/telemetry/events': 'telemetry.events',
  'GET /_snapback/api/telemetry/export': 'telemetry.export',
  'GET /_snapback/api/errors/issues': 'errors.issues',
  'GET /_snapback/api/errors/issue': 'errors.issue',
  'POST /_snapback/api/errors/transition': 'errors.transition',
  'GET /_snapback/api/debug/network-profile': 'debug.networkProfileGet',
  'PUT /_snapback/api/debug/network-profile': 'debug.networkProfileSet',
};

for (const route of registryExport.routes) {
  if (route.path === '/_snapback/api/auth/mailbox') continue; // already the pinned row above
  if (route.path === '/_snapback/api/host-ops') continue; // multiplexer path; individual host-ops rows cover it
  const coveredKey = `${route.method} ${route.path}`;
  if (ROUTE_ALREADY_COVERED_BY[coveredKey]) {
    const existing = entries.find((e) => e.operation === ROUTE_ALREADY_COVERED_BY[coveredKey]);
    if (existing && !existing.projections.http) existing.projections.http = coveredKey;
    continue;
  }
  const operationName = deriveOperationName(route.method, route.path);
  const cli = CLI_PROJECTIONS[operationName] ?? null;
  const entry = {
    operation: operationName,
    title: operationName,
    intents: [],
    status: 'shipped',
    domain: 'systemApi',
    surfaceAccess: cli ? 'cliOnly' : 'apiOnly',
    operability: 'unavailable',
    unavailableReason: DEFAULT_UNCLASSIFIED_REASON,
    availability: { targets: ['local', 'derived-hosted'] },
    policy: {
      authority: route.invocationAuthority === 'Operator' ? 'operator' : route.invocationAuthority,
      routePolicy: route.pathPolicy,
      effect: route.effectPolicy,
      responseSensitivity: route.responseSensitivity,
    },
    behavior: {
      readOnly: route.method === 'GET',
      destructive: false,
      approvalPosture: null,
      idempotent: route.method === 'GET',
      openWorld: false,
      persistsAcrossRestart: route.method !== 'GET',
    },
    projections: {
      cli,
      mcp: null,
      hostOps: null,
      http: `${route.method} ${route.path}`,
      adminClient: null,
      console: null,
    },
    guide: GUIDE_ANCHORS[operationName] ?? null,
    authorities: ['llp/0031-server-route-taxonomy'],
    sources: ['src/server.rs route_registry()'],
  };
  if (entry.surfaceAccess === 'cliOnly') entry.mcpDeferralReason = 'Not yet classified.';
  applyOverride(entry, overrides[operationName]);
  if (entry.surfaceAccess === 'cliOnly' && !entry.mcpDeferralReason) entry.mcpDeferralReason = 'Not yet classified.';
  if (entry.surfaceAccess === 'mcpOnly' && !entry.cliDeferralReason) entry.cliDeferralReason = 'Not yet classified.';
  if (entry.operability !== 'unavailable') delete entry.unavailableReason;
  entries.push(entry);
}

// --- Rule: no promotion of CredentialSecret/ImpersonationCapability rows ---

for (const entry of entries) {
  const sensitivity = entry.policy?.responseSensitivity;
  const effect = entry.policy?.effect;
  // The rule specifically forbids an MCP tool whose ordinary result is a
  // secret ("No secret in convenience channels" governs MCP parameters/
  // results; §Product contract's own text: "must not be able to mint a
  // *typed* MCP tool whose ordinary result is a secret"). A CLI-only
  // projection that prints a value to a human operator's own terminal
  // (config.set's stdin/fd carrier; admin.link's claim URL) is the RFC's
  // accepted v1 carrier, not the channel this rule polices.
  if (
    (sensitivity === 'CredentialSecret' || effect === 'ImpersonationCapability') &&
    ['native', 'mcpOnly'].includes(entry.surfaceAccess) &&
    !entry.pinned
  ) {
    completenessErrors.push(
      `${entry.operation}: CredentialSecret/ImpersonationCapability row promoted to ` +
        `${entry.surfaceAccess} (grants an MCP tool) without an authored pin — refused by the promotion-refusal rule.`,
    );
  }
}

// --- Rule 8: destructive rows require approvalPosture ----------------------

for (const entry of entries) {
  if (entry.behavior.destructive && !entry.behavior.approvalPosture) {
    completenessErrors.push(`${entry.operation}: destructive:true requires a non-null approvalPosture (rule 8).`);
  }
}

// --- Rule 7: internal/unavailable require reasons --------------------------

for (const entry of entries) {
  if (entry.operability === 'internal' && !entry.internalReason) {
    completenessErrors.push(`${entry.operation}: operability internal requires internalReason (rule 7).`);
  }
  if (entry.operability === 'unavailable' && !entry.unavailableReason) {
    completenessErrors.push(`${entry.operation}: operability unavailable requires unavailableReason (rule 7).`);
  }
}

// --- Rule 5: cliOnly/mcpOnly deferral reasons -------------------------------

for (const entry of entries) {
  if (entry.surfaceAccess === 'cliOnly' && !entry.mcpDeferralReason) {
    completenessErrors.push(`${entry.operation}: surfaceAccess cliOnly requires mcpDeferralReason (rule 5).`);
  }
  if (entry.surfaceAccess === 'mcpOnly' && !entry.cliDeferralReason) {
    completenessErrors.push(`${entry.operation}: surfaceAccess mcpOnly requires cliDeferralReason (rule 5).`);
  }
}

// --- Rule 3 (partial): every CONTROL_TOOLS operation resolves to a row -----

for (const tool of controlTools) {
  const known = entries.some((entry) => entry.operation === tool.operation);
  if (!known) {
    completenessErrors.push(
      `MCP tool ${tool.name} declares operation '${tool.operation}' with no matching catalog row.`,
    );
  }
}

// --- Rule 11: hosted-adapter manifest vs audited fixture -------------------

function checkHostedAdapter() {
  const fixtureKeys = new Set(
    gatewayInventory.entries.map((e) => `${e.methods.join(',')}|${e.path}|${e.operation}`),
  );
  const manifestKeys = new Set();
  for (const item of hostedManifest.entries) {
    const key = `${item.methods.join(',')}|${item.path}|${item.operation}`;
    manifestKeys.add(key);
    // A manifest entry's (path, operation) pair must appear in the audited
    // fixture; method lists are compared loosely since the fixture sometimes
    // records the forwarding behavior in prose (e.g. "<forwarded as
    // request.method, unrestricted>") rather than an exact method list.
    const pathOperationMatch = gatewayInventory.entries.some(
      (fixtureEntry) => fixtureEntry.path === item.path && fixtureEntry.operation === item.operation,
    );
    if (!pathOperationMatch) {
      completenessErrors.push(
        `hosted-adapter-manifest.json entry (${item.methods.join(',')} ${item.path} -> ${item.operation}) ` +
          'has no matching (path, operation) case in the audited gateway-paths.inventory.json fixture (rule 11).',
      );
    }
  }
  for (const fixtureEntry of gatewayInventory.entries) {
    const covered = hostedManifest.entries.some(
      (item) => item.path === fixtureEntry.path && item.operation === fixtureEntry.operation,
    );
    if (!covered) {
      completenessErrors.push(
        `audited fixture entry (${fixtureEntry.path} -> ${fixtureEntry.operation}) has no hosted-adapter-manifest.json entry (rule 11).`,
      );
    }
  }

  // Local host-op identities the hosted manifest's operation happens to
  // name-match (e.g. debug.networkProfile.read/.write projecting the same
  // underlying capability as host_ops.debug.networkProfileGet/Set). A
  // hosted-adapter entry merges into the existing catalog row — widening
  // its availability and recording the hosted projection/credential —
  // rather than minting a second row for the same operation (§Design/1:
  // "one stable catalog entry per administrative operation").
  const HOSTED_MERGES_INTO = {
    'debug.networkProfile.read': 'debug.networkProfileGet',
    'debug.networkProfile.write': 'debug.networkProfileSet',
    'app.reset': 'app.reset',
    'config.status.read': 'config.status',
    'cron.status.read': 'cron.status',
    'cron.run.trigger': 'cron.tick',
  };

  for (const item of hostedManifest.entries) {
    const mergeTarget = HOSTED_MERGES_INTO[item.operation];
    // Two hosted-adapter manifest entries can legitimately name the same
    // operation from two paths (capability.manifest.read's /inspect and
    // /capability aliases; route.unknown.refuse's bare-root and prefix
    // catch-all) — merge the second into the first-created hostedAdapter
    // row for that operation rather than minting a duplicate.
    const existing =
      (mergeTarget && entries.find((e) => e.operation === mergeTarget)) ||
      entries.find((e) => e.domain === 'hostedAdapter' && e.operation === item.operation);
    if (existing) {
      existing.projections.hostedAdapter = item.operation;
      existing.availability.targets = Array.from(
        new Set([...existing.availability.targets, ...(item.availability?.targets ?? ['derived-hosted', 'primary-hosted'])]),
      );
      existing.policy.projectionCredentials = {
        ...(existing.policy.projectionCredentials ?? {}),
        hostedAdapter: `${item.policy.routePolicy ?? item.policy.authority} (${item.methods.join('|')} ${item.path})`,
      };
      existing.sources = Array.from(new Set([...existing.sources, ...item.sources]));
      continue;
    }
    const entry = {
      operation: item.operation,
      title: item.title,
      intents: item.intents ?? [],
      status: 'shipped',
      domain: 'hostedAdapter',
      surfaceAccess: item.surfaceAccess,
      operability: item.operability,
      availability: item.availability ?? { targets: ['derived-hosted', 'primary-hosted'] },
      policy: item.policy,
      behavior: {
        readOnly: item.behavior.readOnly,
        destructive: item.behavior.destructive,
        approvalPosture: item.behavior.approvalPosture ?? null,
        idempotent: item.behavior.idempotent ?? false,
        openWorld: item.behavior.openWorld ?? false,
        persistsAcrossRestart: item.behavior.persistsAcrossRestart ?? false,
      },
      projections: { cli: null, mcp: null, hostOps: null, http: `${item.methods.join('|')} ${item.path}`, adminClient: null, console: null, hostedAdapter: item.operation },
      guide: item.guide ?? null,
      authorities: ['llp/0184-agent-accessible-control-plane §Design/3a'],
      sources: item.sources,
    };
    if (item.internalReason) entry.internalReason = item.internalReason;
    entries.push(entry);
  }
}
checkHostedAdapter();

// --- Assemble and validate --------------------------------------------------

const normalized = entries
  .slice()
  .sort((a, b) => a.operation.localeCompare(b.operation));
const digestInput = JSON.stringify(normalized);
const catalogDigest = `sha256:${createHash('sha256').update(digestInput).digest('hex')}`;

let sourceCommit = 'unknown';
let dirty = true;
try {
  sourceCommit = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  const status = execSync('git status --porcelain', { cwd: ROOT }).toString();
  dirty = status.trim().length > 0;
} catch {
  // best-effort; not fatal for local generation
}

const catalog = {
  schemaVersion: 'snapback.control-catalog.v1',
  catalogDigest,
  buildIdentity: { sourceCommit, dirty },
  generatedAtCommit: sourceCommit,
  entries: normalized,
};

if (domainErrors.length > 0) fail(domainErrors);
if (completenessErrors.length > 0) {
  console.error(`[control-catalog] ${completenessErrors.length} completeness error(s):`);
  fail(completenessErrors);
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
const catalogSchema = readJson(join(ROOT, 'schemas/control-catalog.v1.schema.json'));
const validateCatalog = ajv.compile(catalogSchema);
if (!validateCatalog(catalog)) {
  fail([
    `catalog failed schemas/control-catalog.v1.schema.json validation:`,
    ajv.errorsText(validateCatalog.errors, { separator: '\n  ' }),
  ]);
}

const outPath = join(ROOT, 'control-catalog/generated/control-catalog.v1.json');
const outText = `${JSON.stringify(catalog, null, 2)}\n`;

if (CHECK_ONLY) {
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  if (existing !== outText) {
    fail(
      `control-catalog/generated/control-catalog.v1.json is stale. Regenerate with ` +
        '`node scripts/generate-control-catalog.mjs` and commit the result.',
    );
  }
  console.log(`[control-catalog] OK — ${normalized.length} entries, digest ${catalogDigest}`);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, outText);
  console.log(`[control-catalog] wrote ${normalized.length} entries to ${outPath}`);
  console.log(`[control-catalog] catalogDigest: ${catalogDigest}`);
}
