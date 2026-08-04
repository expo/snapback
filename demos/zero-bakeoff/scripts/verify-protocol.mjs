import {readdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const protocol = JSON.parse(await readFile(join(root, 'protocol/program.v1.json'), 'utf8'));
const acceptanceDir = join(root, 'protocol/acceptance');
const providerInventory = JSON.parse(await readFile(join(root, 'protocol/provider-inventory.v1.json'), 'utf8'));
const files = (await readdir(acceptanceDir)).filter((name) => name.endsWith('.v1.json')).sort();
const environmentV1 = JSON.parse(await readFile(join(root, 'protocol/environment.v1.json'), 'utf8'));
const environmentV2 = JSON.parse(await readFile(join(root, 'protocol/environment.v2.json'), 'utf8'));
const latencyKanbanV2 = JSON.parse(await readFile(join(acceptanceDir, 'latency-kanban.v2.json'), 'utf8'));

const fail = (message) => {
  process.stderr.write(`ZERO_BAKEOFF_PROTOCOL_INVALID: ${message}\n`);
  process.exitCode = 1;
};

if (protocol.schemaVersion !== 'snapback.zero-bakeoff.program.v1') {
  fail('wrong program schemaVersion');
}
if (protocol.applications.length !== 6) fail('exactly six applications are required');
if (files.length !== protocol.applications.length) fail('one acceptance manifest per application is required');
if (protocol.rules.sharedBackendAbstraction !== false) fail('provider-native implementation rule is required');
if (protocol.rules.zeroAndReplicacheScoresSeparate !== true) fail('Zero and Replicache must stay separate');
if (providerInventory.providers.zero.version !== protocol.providers.zero.version) {
  fail('Zero version differs between program and provider inventory');
}
if (providerInventory.providers.replicache.version !== protocol.providers.replicache.version) {
  fail('Replicache version differs between program and provider inventory');
}

const seen = new Set();
for (const file of files) {
  const manifest = JSON.parse(await readFile(join(acceptanceDir, file), 'utf8'));
  if (manifest.schemaVersion !== 'snapback.zero-bakeoff.acceptance.v1') fail(`${file}: wrong schemaVersion`);
  if (!Number.isInteger(manifest.expectedChecks) || manifest.expectedChecks <= 0) fail(`${file}: invalid expectedChecks`);
  if (manifest.checks.length !== manifest.expectedChecks) fail(`${file}: expectedChecks mismatch`);
  for (const id of manifest.checks) {
    if (seen.has(id)) fail(`duplicate check id ${id}`);
    seen.add(id);
  }
}

// @ref LLP 0167#observation-semantics--what-a-delay-means — the v2 extension
// must bind its shared built profile, bounded axes, and honest per-arm
// placement while the frozen v1/offlineStretch corpus remains byte-stable.
if (environmentV1.networkProfiles?.offlineStretch?.durationMs !== 900000) {
  fail('environment.v1 must retain the offlineStretch scenario declaration');
}
if (environmentV2.schemaVersion !== 'snapback.zero-bakeoff.environment.v2') {
  fail('environment.v2: wrong schemaVersion');
}
if (latencyKanbanV2.schemaVersion !== 'snapback.zero-bakeoff.acceptance.v2') {
  fail('latency-kanban.v2.json: wrong schemaVersion');
}
const citation = latencyKanbanV2.networkCondition;
if (citation?.environmentSchemaVersion !== environmentV2.schemaVersion) {
  fail('latency-kanban.v2.json: environment schema citation mismatch');
}
const profile = environmentV2.networkProfiles?.[citation?.profile];
if (!profile || profile.name !== citation.profile) {
  fail('latency-kanban.v2.json: named profile is absent from environment.v2');
}
const profileFields = ['mutationAckDelayMs', 'liveDeltaDelayMs', 'queryResponseDelayMs', 'jitterMs'];
if (!profileFields.every((field) => Number.isInteger(profile[field]) && profile[field] >= 0)) {
  fail('environment.v2: profile fields must use the LLP 0167 non-negative integer shape');
}
if (JSON.stringify(citation.latencyWindows) !== JSON.stringify(environmentV2.latencyWindows?.[citation.profile])) {
  fail('latency-kanban.v2.json: latency-window citation mismatch');
}
if (JSON.stringify(citation.injectionPoints) !== JSON.stringify(environmentV2.armInjectionPoints)) {
  fail('latency-kanban.v2.json: injection-point citation mismatch');
}
if (citation.latencyWindows?.actorAck?.floorMs !== profile.mutationAckDelayMs
  || citation.latencyWindows?.observerDelta?.floorMs !== profile.liveDeltaDelayMs) {
  fail('latency-kanban.v2.json: axis floors must match the selected profile');
}
if (environmentV2.armInjectionPoints?.zero !== 'pre-commit'
  || environmentV2.armInjectionPoints?.snapback !== 'post-commit') {
  fail('environment.v2: arm injection points do not match the declared implementations');
}

if (!process.exitCode) {
  process.stdout.write(JSON.stringify({
    ok: true,
    applications: protocol.applications.length,
    acceptanceManifests: files.length,
    versionedExtensions: { environment: 'v2', latencyKanban: 'v2' },
    checks: seen.size,
    providers: Object.keys(protocol.providers)
  }) + '\n');
}
