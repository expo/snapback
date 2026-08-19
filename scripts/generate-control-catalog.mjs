#!/usr/bin/env node
// LLP 0184 Phase 1: the ControlCatalogV1 compiler. Joins the LLP 0031/0024
// registry export (packages/snapback-cli/control-plane-registry.json,
// itself verified against live Rust by crates/snapback/tests/control_catalog_registry_export.rs),
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
// @ref LLP 0184#3a-the-hosted-cloudflare-leg--a-fifth-domain-not-an-omission — the fifth domain leg.

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { remediationControlCatalogProjection } from '../packages/snapback-client/remediation.mjs';

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
const gatewaySource = readFileSync(join(ROOT, 'cloudflare/src/gateway.js'), 'utf8');

// The package wrapper has its own declarative command owner. Read only the
// data-only top-level registry block so catalog generation does not import the
// package runtime (which would load codegen/client dependencies and turn this
// cheap compiler into an execution path).
//
// @ref LLP 0184#3-completeness-and-parity-rules — rule 3 covers the packaged
//   CLI as well as the native clap tree; every packaged root verb needs a
//   catalog declaration or an explicit authored deferral.
function packagedCliCommandNames() {
  const source = readFileSync(join(ROOT, 'packages/snapback-cli/index.mjs'), 'utf8');
  const blockStart = source.indexOf('export const PACKAGED_CLI_COMMANDS');
  const blockEnd = source.indexOf(']);', blockStart);
  if (blockStart === -1 || blockEnd === -1) {
    fail('packages/snapback-cli/index.mjs PACKAGED_CLI_COMMANDS registry could not be located');
  }
  const names = [...source.slice(blockStart, blockEnd).matchAll(/name: '([a-z][a-z0-9-]*)'/g)]
    .map((match) => match[1]);
  if (names.length === 0 || new Set(names).size !== names.length) {
    fail('packages/snapback-cli/index.mjs PACKAGED_CLI_COMMANDS registry is empty or duplicated');
  }
  return names;
}

const packagedCliCommands = packagedCliCommandNames();

// mcp-control.mjs exports CONTROL_TOOLS directly (LLP 0042's control-plane
// tool declarations). Importing the real module — rather than parsing its
// source text — is the exact "derived ownership, not a second registry"
// posture §Design/2 requires: this is the actual tool list the server
// serves, not a transcription of it. Module-level code in mcp-control.mjs
// has no side effects (spawning only happens inside McpControlServer
// methods, never at import time), so a plain dynamic import is safe here.
const {
  CONTROL_TOOLS: controlTools,
  CONTROL_RESOURCES: controlResources,
} = await import(
  join(ROOT, 'packages/snapback-cli/mcp-control.mjs')
);
if (!Array.isArray(controlTools) || controlTools.length === 0) {
  fail('mcp-control.mjs CONTROL_TOOLS imported empty/non-array; extraction is broken');
}
const controlToolsByOperation = new Map(controlTools.map((tool) => [tool.operation, tool]));
if (!Array.isArray(controlResources) || controlResources.length === 0) {
  fail('mcp-control.mjs CONTROL_RESOURCES imported empty/non-array; extraction is broken');
}
const controlResourcesByOperation = new Map(
  controlResources.map((resource) => [resource.operation, resource]),
);

// A small hand-authored CLI-command projection lookup for host-op identities
// with a direct CLI command today. This is NOT a second authority: every
// command name here is checkable against packages/snapback-cli or crates/snapback/src/cli.rs
// and is intentionally narrow (only what Phase 1 backfills — see
// control-catalog/operability-overrides.json's coverage note). An operation
// with a real CLI command but no entry here is under-projected in this
// compiler's output, not mis-projected — that gap is called out in the
// Phase 1 completion report, not silently hidden.
const CLI_PROJECTIONS = {
  'host.start': 'snapback start',
  'host.stop': 'snapback stop',
  'host.restart': 'snapback restart --ready-file <path>',
  'host.wait': 'snapback wait --ready-file <path> --level <host|application>',
  'app.inspect': 'snapback inspect',
  'app.reset': 'snapback reset',
  'schema.load': 'snapback load --schema <path>',
  'functions.load': 'snapback load --functions <path>',
  'function.run': 'snapback run',
  'remediation.apply': 'snapback remediation apply --input <file|->',
  'auth.mintSession': 'snapback session mint --email <address>',
  'debug.networkProfileGet': 'snapback network-profile get',
  'debug.networkProfileSet': 'snapback network-profile set',
  'debug.live.forceResync': 'snapback debug force-resync',
  'telemetry.stats': 'snapback telemetry stats',
  'telemetry.events': 'snapback telemetry events',
  'telemetry.export': 'snapback telemetry export',
  'errors.issues': 'snapback errors issues',
  'errors.issue': 'snapback errors issue',
  'errors.transition': 'snapback errors transition',
  'data.patch.preview': 'snapback data patch --preview --input <file|->',
  'data.patch.apply': 'snapback data patch --apply --input <file|->',
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
  // LLP 0184 Phase 2 P1: read and diagnose.
  'data.scan': 'snapback data scan <table>',
  'config.status': 'snapback config status',
  'config.plan': 'snapback config plan',
  'config.set': 'snapback config set --entry <name> (--value-stdin|--value-fd N)',
  'config.verify': 'snapback config verify <entry>',
  'cron.list': 'snapback cron list',
  'jobs.list': 'snapback jobs list',
  'jobs.show': 'snapback jobs show <id>',
  // LLP 0184 §P2 landed CLI verbs, each paired with a mcp-control.mjs
  // CONTROL_TOOLS entry landed in the same change.
  'config.unset': 'snapback config unset',
  'cron.tick': 'snapback cron tick',
  'cron.runOne': 'snapback cron run',
  'ephemeral.cleanup': 'snapback ephemeral cleanup',
  'jobs.drain': 'snapback jobs drain',
  'connection.disconnect': 'snapback connections disconnect',
  'control.catalog.read': 'snapback controls list',
  'control.catalog.describe': 'snapback controls describe <operation>',
  'ephemeral.operatorDelete': 'snapback ephemeral operator-delete',
};

const GUIDE_ANCHORS = {
  'remediation.apply': 'operating/diagnostics.md#apply-a-remediation-safely',
  'host.restart': 'operating/host-ops.md#restart-with-one-credential-bound-receipt',
  'debug.networkProfileGet': 'operating/network-profiles.md#read-the-active-profile',
  'debug.networkProfileSet': 'operating/network-profiles.md#set-a-profile',
  'debug.live.forceResync': 'operating/host-ops.md#served-request-operations',
  'secretRead.mint': 'operating/host-ops.md#mint-a-scoped-secret-read-lease',
  'app.inspect': 'operating/host-ops.md',
  'telemetry.stats': 'operating/host-ops.md',
  'telemetry.events': 'operating/host-ops.md',
  'telemetry.export': 'operating/host-ops.md',
  'errors.issues': 'operating/host-ops.md',
  'errors.issue': 'operating/host-ops.md',
  'errors.transition': 'operating/host-ops.md',
  'data.scan': 'operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1',
  'jobs.list': 'operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1',
  'jobs.show': 'operating/host-ops.md#direct-climcp-projections-beyond-host-ops-llp-0184-phase-2-p1',
  'config.status': 'operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify',
  'config.plan': 'operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify',
  'config.set': 'operating/secrets-and-config.md#set-an-agent-held-value-without-exposing-it',
  'config.verify': 'operating/secrets-and-config.md#cli-and-mcp-projections-for-statusplanverify',
  'cron.list': 'backend/cron.md#inspect-declared-jobs-and-runtime-posture',
  'ephemeral.cleanup': 'realtime/ephemeral-state.md#clean-up-expired-entries-operationally',
  'control.catalog.read': 'operating/agent-controls.md#search-the-build-catalog',
  'control.catalog.describe': 'operating/agent-controls.md#describe-one-operation',
  'control.catalog.instance.read': 'operating/agent-controls.md#build-versus-instance-identity',
  'data.patch.preview': 'operating/data-patch.md#preview',
  'data.patch.apply': 'operating/data-patch.md#apply',
  'ephemeral.operatorDelete': 'realtime/ephemeral-state.md#delete-one-entry-as-an-operator',
};

// --- Build domain fact index -------------------------------------------

const operationsByName = new Map(registryExport.operations.map((op) => [op.operation, op]));
const hostOpsIdentities = new Set([
  ...registryExport.hostOpsIdentities.served,
  ...registryExport.hostOpsIdentities.cliOnly,
  ...registryExport.hostOpsIdentities.pinnedUnbuilt,
]);

const overrides = overridesManifest.overrides ?? {};
const discoveryOverrides = overridesManifest.discovery ?? {};
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
  if (override.title) entry.title = override.title;
  if (override.operability) entry.operability = override.operability;
  if (override.mediatedHandoff) entry.mediatedHandoff = override.mediatedHandoff;
  if (override.intents) entry.intents = override.intents;
  if (override.availability) entry.availability = override.availability;
  if (override.surfaceAccessOverride) entry.surfaceAccess = override.surfaceAccessOverride;
  if (override.mcpDeferralReason) entry.mcpDeferralReason = override.mcpDeferralReason;
  if (override.cliDeferralReason) entry.cliDeferralReason = override.cliDeferralReason;
  if (override.composedFrom) entry.composedFrom = override.composedFrom;
  if (override.authorities) entry.authorities = override.authorities;
  if (override.sources) entry.sources = override.sources;
  if (override.guide) entry.guide = override.guide;
  if (override.inputSchema) entry.inputSchema = override.inputSchema;
  if (override.outputSchema) entry.outputSchema = override.outputSchema;
  if (override.unavailableReason) entry.unavailableReason = override.unavailableReason;
  if (override.internalReason) entry.internalReason = override.internalReason;
  // @ref LLP 0184#b-forced-live-resync--add-now — availability.targets
  //   carries a target refusal (e.g. "derived-hosted excluded until LLP
  //   0158 grants recognition for this purpose"); it is a distinct fact
  //   from operability and must be authorable per row, not hardcoded to
  //   the host-ops-family default of every local/derived-hosted target.
  if (override.availabilityTargets) entry.availability.targets = override.availabilityTargets;
  if (override.adminClient) entry.projections.adminClient = override.adminClient;
  if (override.console) entry.projections.console = override.console;
  if (override.projectionCredentials) {
    entry.policy.projectionCredentials = override.projectionCredentials;
  }
  if (override.behavior) {
    entry.behavior = { ...entry.behavior, ...override.behavior };
  }
  return entry;
}

function applyAuthoredOverrides(entry) {
  applyOverride(entry, discoveryOverrides[entry.operation]);
  applyOverride(entry, overrides[entry.operation]);
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
  const hostOpsDisposition = isUnbuilt
    ? 'pinnedUnbuilt'
    : isCliOnlyPinned
      ? 'cliOnly'
      : 'served';
  const registeredOperations = registryExport.operations
    .filter((operation) =>
      operation.operation === `host_ops.${name}`
        || operation.operation.startsWith(`host_ops.${name}.`))
    .map((operation) => operation.operation);

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
    hostOpsDisposition,
    registeredOperations,
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
    sources: ['crates/snapback-engine/src/host_ops.rs', 'packages/snapback-cli/mcp-control.mjs'],
  };
  if (surfaceAccess === 'cliOnly') entry.mcpDeferralReason = 'Not yet classified.';
  if (surfaceAccess === 'mcpOnly') entry.cliDeferralReason = 'Not yet classified.';

  applyAuthoredOverrides(entry);
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
    sources: ['crates/snapback-server/src/server.rs operation_registry()'],
  };
  applyAuthoredOverrides(entry);
  if (entry.surfaceAccess === 'cliOnly' && !entry.mcpDeferralReason) entry.mcpDeferralReason = 'Not yet classified.';
  if (entry.surfaceAccess === 'mcpOnly' && !entry.cliDeferralReason) entry.cliDeferralReason = 'Not yet classified.';
  if (entry.operability !== 'unavailable') delete entry.unavailableReason;
  entries.push(entry);
}

// --- Compile CLI-only-declared family --------------------------------------

for (const item of cliOnlyManifest.entries) {
  const packagedCommand = item.packagedCommand ?? null;
  const cli = packagedCommand ? `snapback ${packagedCommand}` : item.cli;
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
    projections: { cli, mcp: null, hostOps: null, http: null, adminClient: null, console: null },
    guide: item.guide,
    authorities: ['llp/0184-agent-accessible-control-plane'],
    sources: item.sources,
  };
  if (item.unavailableReason) entry.unavailableReason = item.unavailableReason;
  if (packagedCommand) entry.sources = Array.from(new Set([
    ...entry.sources,
    `packages/snapback-cli/index.mjs PACKAGED_CLI_COMMANDS.${packagedCommand}`,
  ]));
  applyAuthoredOverrides(entry);
  entries.push(entry);
}

const packagedDeferrals = new Map(
  (cliOnlyManifest.packagedCommandDeferrals ?? []).map((item) => [item.name, item.reason]),
);
const packagedRows = new Map(
  cliOnlyManifest.entries
    .filter((item) => item.packagedCommand)
    .map((item) => [item.packagedCommand, item.operation]),
);
for (const name of packagedCliCommands) {
  if (!packagedRows.has(name) && !packagedDeferrals.has(name)) {
    completenessErrors.push(
      `packaged CLI command 'snapback ${name}' has no cli-only-operations.json row or declared deferral (rule 3).`,
    );
  }
}
for (const [name, operation] of packagedRows) {
  if (!packagedCliCommands.includes(name)) {
    completenessErrors.push(
      `${operation}: packagedCommand '${name}' is not present in PACKAGED_CLI_COMMANDS (rule 3).`,
    );
  }
}
for (const [name, reason] of packagedDeferrals) {
  if (!packagedCliCommands.includes(name)) {
    completenessErrors.push(`packaged CLI deferral '${name}' names no PACKAGED_CLI_COMMANDS verb.`);
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    completenessErrors.push(`packaged CLI deferral '${name}' requires a non-empty reason.`);
  }
}

// --- Compile the dev-mailbox pin (from live registry export) ---------------

const mailboxRoute = registryExport.routes.find(
  (route) => route.path === '/_snapback/api/auth/mailbox' && route.method === 'GET',
);
if (mailboxRoute) {
  const entry = {
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
    sources: ['crates/snapback-server/src/server.rs route_registry()'],
    pinned: true,
    pinReason:
      "responseSensitivity CredentialSecret: usage-evidence promotion to native/cliOnly/mcpOnly is refused outright regardless of call volume (§Product contract's promotion-refusal rule). This row stays apiOnly until an authored override passes the same secret-carrier review config.set requires.",
  };
  applyAuthoredOverrides(entry);
  entries.push(entry);
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
  'GET /_snapback/api/control-catalog': 'control.catalog.read',
  'GET /_snapback/api/control-catalog/instance': 'control.catalog.instance.read',
  'GET /_snapback/api/control-catalog/operations/{operation}': 'control.catalog.describe',
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
  'GET /_snapback/api/cron': 'cron.list',
  'POST /_snapback/api/cron/{name}/run': 'cron.runOne',
  'POST /_snapback/api/jobs/drain': 'jobs.drain',
  'GET /_snapback/api/jobs': 'jobs.list',
  'GET /_snapback/api/jobs/{id}': 'jobs.show',
  'POST /_snapback/api/ephemeral/cleanup': 'ephemeral.cleanup',
  'POST /_snapback/api/ephemeral/operator/delete': 'ephemeral.operatorDelete',
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
  'GET /_snapback/api/cron': 'cron.list',
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
  // @ref LLP 0184#p1-read-and-diagnose — data.scan/config.*/jobs.* land
  // direct control-MCP tools in this phase; without this lookup the generic
  // SystemApi loop (unlike the host-ops loop above) never noticed a tool
  // existed and left surfaceAccess/projections.mcp permanently stale at
  // cliOnly/null.
  const tool = controlToolsByOperation.get(operationName);
  const resource = controlResourcesByOperation.get(operationName);
  const mcpProjection = tool?.name ?? resource?.uri ?? resource?.uriTemplate ?? null;
  let surfaceAccess;
  if (mcpProjection && cli) surfaceAccess = 'native';
  else if (mcpProjection && !cli) surfaceAccess = 'mcpOnly';
  else if (!mcpProjection && cli) surfaceAccess = 'cliOnly';
  else surfaceAccess = 'apiOnly';
  const entry = {
    operation: operationName,
    title: tool?.title ?? resource?.title ?? operationName,
    intents: [],
    status: 'shipped',
    domain: 'systemApi',
    surfaceAccess,
    operability: 'unavailable',
    unavailableReason: DEFAULT_UNCLASSIFIED_REASON,
    availability: { targets: ['local', 'derived-hosted'] },
    policy: {
      authority: route.invocationAuthority === 'Operator' ? 'operator' : route.invocationAuthority,
      routePolicy: route.pathPolicy,
      effect: route.effectPolicy,
      responseSensitivity: route.responseSensitivity,
    },
    // @ref LLP 0184#3-completeness-and-parity-rules — rule 8 (destructive
    // rows require approvalPosture) only has teeth if `destructive` is ever
    // true here. A tool's own annotations are the authored, checked-in fact
    // when one exists; the method-based guess is the apiOnly-only fallback.
    behavior: {
      readOnly: tool ? (tool.annotations?.readOnlyHint ?? false) : route.method === 'GET',
      destructive: tool ? (tool.annotations?.destructiveHint ?? false) : false,
      approvalPosture: tool?.annotations?.destructiveHint ? 'confirmFirst' : null,
      idempotent: tool ? (tool.annotations?.idempotentHint ?? false) : route.method === 'GET',
      openWorld: tool?.annotations?.openWorldHint ?? false,
      persistsAcrossRestart: route.method !== 'GET',
    },
    projections: {
      cli,
      mcp: mcpProjection,
      hostOps: null,
      http: `${route.method} ${route.path}`,
      adminClient: null,
      console: null,
    },
    guide: GUIDE_ANCHORS[operationName] ?? null,
    authorities: ['llp/0031-server-route-taxonomy'],
    sources: ['crates/snapback-server/src/server.rs route_registry()'],
  };
  if (entry.surfaceAccess === 'cliOnly') entry.mcpDeferralReason = 'Not yet classified.';
  if (entry.surfaceAccess === 'mcpOnly') entry.cliDeferralReason = 'Not yet classified.';
  applyAuthoredOverrides(entry);
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

// --- Rule 6: mediated rows publish a resumable, negative-leak handoff -------

for (const entry of entries) {
  if (entry.operability !== 'mediated') continue;
  const handoff = entry.mediatedHandoff;
  const required = ['plan', 'initiate', 'status', 'resume', 'protectedArtifact', 'negativeLeakTests'];
  const missing = required.filter((field) => {
    if (!handoff || !(field in handoff)) return true;
    return field === 'negativeLeakTests'
      ? !Array.isArray(handoff[field]) || handoff[field].length === 0
      : typeof handoff[field] !== 'string' || handoff[field].trim() === '';
  });
  if (missing.length > 0) {
    completenessErrors.push(
      `${entry.operation}: operability mediated requires plan/initiate/status/resume, ` +
        `protectedArtifact, and negativeLeakTests; missing ${missing.join(', ')} (rule 6).`,
    );
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
for (const resource of controlResources) {
  const known = entries.some((entry) => entry.operation === resource.operation);
  if (!known) {
    completenessErrors.push(
      `MCP resource ${resource.uri ?? resource.uriTemplate} declares operation ` +
        `'${resource.operation}' with no matching catalog row.`,
    );
  }
}

// --- Rule 11: hosted-adapter manifest vs audited fixture -------------------

function checkHostedAdapter() {
  checkGatewaySourceParity();
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
    applyAuthoredOverrides(entry);
    entries.push(entry);
  }
}

function quotedStrings(source) {
  return Array.from(source.matchAll(/(['"])(\/[^'"\\]*)\1/g), (match) => match[2]);
}

function arrayConstant(name, { set = false } = {}) {
  const wrapperStart = set ? String.raw`new\s+Set\s*\(\s*\[` : String.raw`\[`;
  const wrapperEnd = set ? String.raw`\]\s*\)` : String.raw`\]`;
  const pattern = new RegExp(
    String.raw`const\s+${name}\s*=\s*${wrapperStart}([\s\S]*?)${wrapperEnd}\s*;`,
  );
  const match = gatewaySource.match(pattern);
  if (!match) {
    completenessErrors.push(`gateway.js ${name} declaration could not be parsed by the parity gate.`);
    return [];
  }
  return quotedStrings(match[1]);
}

function regexConstant(name) {
  const match = gatewaySource.match(new RegExp(String.raw`const\s+${name}\s*=\s*(\/[^\n]+\/[a-z]*)\s*;`));
  if (!match) {
    completenessErrors.push(`gateway.js ${name} declaration could not be parsed by the parity gate.`);
    return null;
  }
  return match[1];
}

function exactPathLiterals() {
  return Array.from(
    gatewaySource.matchAll(/\bpath\s*===\s*(['"])(\/[^'"]*)\1/g),
    (match) => match[2],
  ).sort();
}

function sameStringList(label, actual, expected) {
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...new Set(expected ?? [])].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    completenessErrors.push(
      `gateway.js ${label} literals are unlisted or stale in gateway-paths.inventory.json: ` +
        `source=${JSON.stringify(actualSorted)} fixture=${JSON.stringify(expectedSorted)}.`,
    );
  }
}

// Bounded source extraction is deliberate: these four declarations and exact
// `path ===` comparisons are the gateway's audited registration vocabulary.
// An unparsable rewrite fails closed and requires the fixture/gate to evolve
// in the same change; this is not a claim to parse arbitrary JavaScript.
// @ref LLP 0184#3a-the-hosted-cloudflare-leg--a-fifth-domain-not-an-omission
function checkGatewaySourceParity() {
  const forwarded = arrayConstant('FORWARDED_JSON_PATHS', { set: true });
  const appPrefixes = arrayConstant('APP_DATA_PREFIXES');
  const kitRoute = regexConstant('KIT_ROUTE');
  const kitStreamRoute = regexConstant('KIT_STREAM_ROUTE');
  const literals = gatewayInventory.sourceLiterals ?? {};
  sameStringList('FORWARDED_JSON_PATHS', forwarded, literals.FORWARDED_JSON_PATHS);
  sameStringList('APP_DATA_PREFIXES', appPrefixes, literals.APP_DATA_PREFIXES);
  sameStringList('exact path', exactPathLiterals(), literals.exactPaths);
  if (kitRoute !== literals.KIT_ROUTE) {
    completenessErrors.push(
      `gateway.js KIT_ROUTE literal is unlisted or stale in gateway-paths.inventory.json: source=${kitRoute} fixture=${literals.KIT_ROUTE}.`,
    );
  }
  if (kitStreamRoute !== literals.KIT_STREAM_ROUTE) {
    completenessErrors.push(
      `gateway.js KIT_STREAM_ROUTE literal is unlisted or stale in gateway-paths.inventory.json: source=${kitStreamRoute} fixture=${literals.KIT_STREAM_ROUTE}.`,
    );
  }
  const appData = gatewayInventory.appDataPlane ?? {};
  sameStringList(
    'app-data exact-path inventory',
    forwarded.filter((path) => !path.startsWith('/_snapback/')),
    appData.forwardedExactPaths,
  );
  sameStringList(
    'app-data SPA-fallback prefix inventory',
    appPrefixes,
    appData.unsupportedSpaFallbackPrefixes,
  );
  if (appData.kitRoute !== kitRoute || appData.kitStreamRoute !== kitStreamRoute) {
    completenessErrors.push(
      'gateway-paths.inventory.json appDataPlane regex literals do not match parsed KIT_ROUTE/KIT_STREAM_ROUTE.',
    );
  }
}
checkHostedAdapter();

// --- Rule 4: task-language discovery metadata and real Guide anchors -------

function githubHeadingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function guideAnchorExists(anchor) {
  if (typeof anchor !== 'string' || anchor.trim() === '') return false;
  const [relativePath, fragment] = anchor.split('#', 2);
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('..')) return false;
  const path = join(ROOT, 'guide', relativePath);
  if (!existsSync(path)) return false;
  if (!fragment) return true;
  const headings = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => githubHeadingSlug(line.replace(/^#{1,6}\s+/, '')));
  return headings.includes(fragment);
}

for (const entry of entries) {
  if (entry.title === entry.operation) {
    completenessErrors.push(`${entry.operation}: title must differ from operation (rule 4).`);
  }
  if (!Array.isArray(entry.intents) || entry.intents.length === 0 ||
      entry.intents.some((intent) => typeof intent !== 'string' || intent.trim() === '')) {
    completenessErrors.push(`${entry.operation}: non-empty authored intents are required (rule 4).`);
  }
  if (['native', 'cliOnly', 'mcpOnly', 'apiOnly'].includes(entry.surfaceAccess)) {
    if (!guideAnchorExists(entry.guide)) {
      completenessErrors.push(
        `${entry.operation}: ${entry.surfaceAccess} requires a Guide path/anchor that exists under guide/ (rule 4).`,
      );
    }
  }
  if (entry.surfaceAccess === 'apiOnly') {
    const hasRecipeAnchor = typeof entry.guide === 'string' && entry.guide.includes('#');
    const hasCliDeferral = typeof entry.cliDeferralReason === 'string' &&
      entry.cliDeferralReason.trim() !== '';
    if (!hasRecipeAnchor && !hasCliDeferral) {
      completenessErrors.push(
        `${entry.operation}: apiOnly requires an authored Guide recipe anchor or cliDeferralReason (rule 5).`,
      );
    }
  }
}

// --- Assemble and validate --------------------------------------------------

// @ref LLP 0184#product-contract-what-agent-accessible-means — the previously reserved field now points
// to the shared decoder and nested carrier identity. It deliberately does not
// duplicate the global remediation-kind enum or map kinds by refusal code.
for (const entry of entries) {
  entry.remediation = remediationControlCatalogProjection;
}

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

const outPath = join(ROOT, 'control-catalog/generated/control-catalog.v1.json');
let buildIdentity = { sourceCommit, dirty };
let generatedAtCommit = sourceCommit;
if (CHECK_ONLY && existsSync(outPath)) {
  // A checked-in generated artifact necessarily changes the commit that
  // contains it. Preserve and validate its generation snapshot while
  // recomputing the semantic catalog below; requiring the snapshot to equal
  // the current HEAD would make every clean committed checkout stale.
  const existing = readJson(outPath);
  buildIdentity = existing.buildIdentity;
  generatedAtCommit = existing.generatedAtCommit;
}

const catalog = {
  schemaVersion: 'snapback.control-catalog.v1',
  catalogDigest,
  buildIdentity,
  generatedAtCommit,
  entries: normalized,
};

// --- Generated Guide projections (rule 9) ---------------------------------

const GUIDE_BLOCKS = {
  hostOpsServed: {
    path: 'guide/operating/host-ops.md',
    name: 'HOST OPS SERVED',
  },
  hostOpsRegistered: {
    path: 'guide/operating/host-ops.md',
    name: 'HOST OPS REGISTERED',
  },
  catalogInventory: {
    path: 'guide/operating/agent-controls.md',
    name: 'CONTROL CATALOG INVENTORY',
  },
};

function markdownCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderedGuideBlocks() {
  const hostOps = catalog.entries.filter((entry) => entry.domain === 'hostOps');
  const served = hostOps.filter((entry) => entry.hostOpsDisposition === 'served');
  const registered = hostOps.flatMap((entry) => entry.registeredOperations ?? []);
  if (served.length === 0 || registered.length === 0) {
    completenessErrors.push(
      'generated Guide host-op projection is vacuous; hostOpsDisposition/registeredOperations facts are missing',
    );
  }
  const servedBody = [
    `The endpoint serves **${served.length} request spellings**. This count and table are generated from the build catalog's LLP 0024 allowlist projection:`,
    '',
    '| Request operation | Purpose |',
    '| --- | --- |',
    ...served.map((entry) =>
      `| \`${markdownCell(entry.operation)}\` | ${markdownCell(entry.title)} |`),
  ].join('\n');

  const registeredBody = [
    `The request spellings above expand into **${registered.length} registered operation identities**. This inventory is generated from each catalog row's LLP 0031 registry projection:`,
    '',
    ...registered.map((operation, index) => `${index + 1}. \`${operation}\``),
  ].join('\n');

  const countBy = (field) => {
    const counts = new Map();
    for (const entry of catalog.entries) {
      counts.set(entry[field], (counts.get(entry[field]) ?? 0) + 1);
    }
    return [...counts].sort(([left], [right]) => left.localeCompare(right));
  };
  const surfaceCounts = countBy('surfaceAccess');
  const operabilityCounts = countBy('operability');
  const inventoryBody = [
    `The embedded build catalog contains **${catalog.entries.length} operations** at digest \`${catalog.catalogDigest}\`. The counts and inventory below are generated; do not edit them by hand.`,
    '',
    '| Axis | Value | Count |',
    '| --- | --- | ---: |',
    ...surfaceCounts.map(([value, count]) => `| surfaceAccess | \`${value}\` | ${count} |`),
    ...operabilityCounts.map(([value, count]) => `| operability | \`${value}\` | ${count} |`),
    '',
    '| Operation | Surface | Operability | Status | CLI | MCP | Guide |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...catalog.entries.map((entry) =>
      `| \`${markdownCell(entry.operation)}\` | \`${entry.surfaceAccess}\` | \`${entry.operability}\` | \`${entry.status}\` | ${markdownCell(entry.projections?.cli)} | ${markdownCell(entry.projections?.mcp)} | ${markdownCell(entry.guide)} |`),
  ].join('\n');

  return new Map([
    [GUIDE_BLOCKS.hostOpsServed, servedBody],
    [GUIDE_BLOCKS.hostOpsRegistered, registeredBody],
    [GUIDE_BLOCKS.catalogInventory, inventoryBody],
  ]);
}

function projectGuideBlocks() {
  for (const [block, body] of renderedGuideBlocks()) {
    const path = join(ROOT, block.path);
    if (!existsSync(path)) {
      completenessErrors.push(`${block.path}: missing generated Guide projection target (rule 9)`);
      continue;
    }
    const begin = `<!-- BEGIN GENERATED CONTROL CATALOG: ${block.name} -->`;
    const end = `<!-- END GENERATED CONTROL CATALOG: ${block.name} -->`;
    const text = readFileSync(path, 'utf8');
    const beginAt = text.indexOf(begin);
    const endAt = text.indexOf(end);
    if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
      completenessErrors.push(`${block.path}: missing ${block.name} generated block markers (rule 9)`);
      continue;
    }
    const replacement = `${begin}\n${body}\n${end}`;
    const projected = `${text.slice(0, beginAt)}${replacement}${text.slice(endAt + end.length)}`;
    if (CHECK_ONLY) {
      if (projected !== text) {
        completenessErrors.push(
          `${block.path}: generated ${block.name} table/count is stale; run node scripts/generate-control-catalog.mjs (rule 9)`,
        );
      }
    } else if (projected !== text) {
      writeFileSync(path, projected);
    }
  }
}

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

// Only project checked documentation after every semantic and schema gate
// has accepted the catalog. A failed generation must not partially rewrite
// Guide claims from an invalid artifact.
projectGuideBlocks();
if (completenessErrors.length > 0) {
  console.error(`[control-catalog] ${completenessErrors.length} completeness error(s):`);
  fail(completenessErrors);
}

const outText = `${JSON.stringify(catalog, null, 2)}\n`;

if (CHECK_ONLY) {
  const existingText = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  let existing = null;
  try {
    existing = existingText === null ? null : JSON.parse(existingText);
  } catch (error) {
    fail(`control-catalog/generated/control-catalog.v1.json is not valid JSON: ${error.message}`);
  }
  if (existing !== null && !validateCatalog(existing)) {
    fail([
      `committed catalog failed schemas/control-catalog.v1.schema.json validation:`,
      ajv.errorsText(validateCatalog.errors, { separator: '\n  ' }),
    ]);
  }

  // @ref LLP 0184#1-controlcatalogv1 — the checked-in catalog is generated
  // in a carrier commit, so its generation provenance necessarily names the
  // source commit before that carrier. Freshness is the exact semantic join;
  // requiring provenance to equal the carrier HEAD creates an impossible
  // self-invalidating artifact.
  const semanticProjection = ({
    buildIdentity: _buildIdentity,
    generatedAtCommit: _generatedAtCommit,
    ...value
  }) => value;
  const expectedSemantic = JSON.stringify(semanticProjection(catalog));
  const existingSemantic =
    existing === null ? null : JSON.stringify(semanticProjection(existing));
  if (existingSemantic !== expectedSemantic) {
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
