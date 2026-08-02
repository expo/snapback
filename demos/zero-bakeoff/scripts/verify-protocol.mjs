import {readdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const protocol = JSON.parse(await readFile(join(root, 'protocol/program.v1.json'), 'utf8'));
const acceptanceDir = join(root, 'protocol/acceptance');
const providerInventory = JSON.parse(await readFile(join(root, 'protocol/provider-inventory.v1.json'), 'utf8'));
const files = (await readdir(acceptanceDir)).filter((name) => name.endsWith('.v1.json')).sort();

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

if (!process.exitCode) {
  process.stdout.write(JSON.stringify({
    ok: true,
    applications: protocol.applications.length,
    acceptanceManifests: files.length,
    checks: seen.size,
    providers: Object.keys(protocol.providers)
  }) + '\n');
}
