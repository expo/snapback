import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSnapbackAppClient } from '@expo/snapback-client';
import { mintDeclaredDevCapability } from '@expo/snapback-client/internal/declared-dev-mint';
import { IDBFactory } from 'fake-indexeddb';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const cli = join(packageRoot, 'cli.mjs');
const codegenCli = join(packageRoot, '..', 'snapback-codegen', 'index.mjs');
const defineUrl = pathToFileURL(join(packageRoot, '..', 'snapback-codegen', 'define.mjs')).href;
const campfireRoot = join(packageRoot, '..', '..', 'demos', 'campfire', 'snapback');
const root = mkdtempSync(join(tmpdir(), 'snapback-cli-generate-check-'));
const migrationCode = 'SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING';

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function digest(directory) {
  const hash = createHash('sha256');
  const visit = (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path, relative);
      else hash.update(relative).update(readFileSync(path));
    }
  };
  visit(directory);
  return hash.digest('hex');
}

function generatedBindingSource(backendRoot) {
  const alias = readFileSync(join(backendRoot, 'generated', 'app.binding.mjs'), 'utf8');
  const relative = alias.match(/from "(\.\/app\.binding\.[a-f0-9]{64}\.mjs)"/u)?.[1];
  assert(relative, 'generated binding alias did not name a content-addressed module');
  return readFileSync(join(backendRoot, 'generated', relative.slice(2)), 'utf8');
}

test('packaged generate mints development binding and the release CLI emits the sentinel', async () => {
  const appRoot = mkdtempSync(join(tmpdir(), 'snapback-cli-declared-dev-mode-'));
  const backendRoot = join(appRoot, 'snapback');
  const clientPackage = join(packageRoot, '..', 'snapback-client');
  try {
    mkdirSync(backendRoot, { recursive: true });
    mkdirSync(join(appRoot, 'node_modules', '@expo'), { recursive: true });
    symlinkSync(clientPackage, join(appRoot, 'node_modules', '@expo', 'snapback-client'), 'dir');
    writeFileSync(join(backendRoot, 'schema.mjs'), `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: { password: { kind: 'password', identifier: 'email', provider: 'builtIn', recovery: 'recoveryCodes' } },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: { enabled: true, requiredWhen: 'no-independent-recovery', rotateAfterUse: true, plaintextCustody: 'one-time-response' },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
}, { auth: { mode: 'sessions' }, authProgram });
`);
    writeFileSync(join(backendRoot, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: {}, auth: 'public' });
`);

    const development = spawnSync(
      process.execPath,
      [cli, 'generate', backendRoot, '--json'],
      { cwd: appRoot, encoding: 'utf8' },
    );
    assert.equal(development.status, 0, development.stderr || development.stdout);
    assert.match(
      generatedBindingSource(backendRoot),
      /@expo\/snapback-client\/internal\/declared-dev-mint[\s\S]*unsafeInstallDeclaredDevCapabilityForGeneratedCode/u,
    );
    const developmentModule = await import(`${pathToFileURL(join(backendRoot, 'generated', 'app.mjs')).href}?mode=development`);
    assert.equal(developmentModule.declaredDev?.format, 'snapback.declared-dev-capability.v1');
    assert.equal(developmentModule.app.declaredDev, developmentModule.declaredDev);
    const handBuiltApp = Object.freeze({
      ...developmentModule.app,
      declaredDev: mintDeclaredDevCapability(developmentModule.declaredDev.deploymentIdentity),
    });
    await assert.rejects(
      createSnapbackAppClient({
        app: handBuiltApp,
        url: 'http://localhost:5173',
        platform: { kind: 'memory' },
        rqsStore: null,
      }),
      (error) => error?.code === 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED'
        && /exact generated app object/u.test(error?.message ?? ''),
    );

    const release = spawnSync(
      process.execPath,
      [codegenCli, backendRoot, '--app-binding-mode', 'release', '--json'],
      { cwd: appRoot, encoding: 'utf8' },
    );
    assert.equal(release.status, 0, release.stderr || release.stdout);
    const releaseSource = generatedBindingSource(backendRoot);
    assert.match(releaseSource, /export const declaredDev = null/u);
    assert.doesNotMatch(releaseSource, /declared-dev-mint|unsafeInstallDeclaredDevCapabilityForGeneratedCode/u);
    const releaseModule = await import(`${pathToFileURL(join(backendRoot, 'generated', 'app.mjs')).href}?mode=release`);
    assert.equal(releaseModule.declaredDev, null);
    assert.equal(releaseModule.app.declaredDev, null);

    const artifacts = JSON.parse(readFileSync(join(backendRoot, 'generated', 'artifacts.json'), 'utf8'));
    const releaseBinding = Object.freeze({
      format: 'snapback.app-binding.v1',
      source: 'release',
      descriptorIdentity: releaseModule.app.identity.descriptor,
      target: Object.freeze({
        app: releaseModule.app.identity.app,
        schema: releaseModule.app.identity.schema,
        functions: releaseModule.app.identity.functions,
        origin: 'https://release-generated.example',
        routing: 'https',
      }),
      capabilities: Object.freeze({ offered: Object.freeze([
        ...releaseModule.app.capabilities.required,
        'auth.passwords',
      ]) }),
      provenance: Object.freeze({
        environment: 'production',
        releaseChannel: 'stable',
        buildReceipt: 'generated-release-test',
      }),
      integrity: Object.freeze({ channel: 'embedded-at-build' }),
    });
    const nativeFetch = globalThis.fetch;
    const diagnostics = [];
    const requests = [];
    process.env.VITE_SNAPBACK_URL = 'http://localhost:5173';
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      assert.equal(url.origin, releaseBinding.target.origin);
      assert.equal(url.pathname, '/auth/session');
      return new Response(JSON.stringify({
        protocolVersion: 1,
        serverStartupNonce: 'release-generated-test',
        authorizationStreamIncarnation: '018f0d90-8c21-7a22-8c33-445566778899',
        transitionGeneration: 0,
        activeMode: 'sessions',
        desiredMode: 'sessions',
        modeState: 'settled',
        appDataAvailability: 'available',
        quarantineCode: null,
        clientProtocols: { authClient: 1, authInvalidation: 1, authorityDescriptor: 1, authorizedLease: null },
        availability: {
          onlineRequestResponse: { available: true, reason: null },
          authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
          retainedReads: { available: false, minimumAuthInvalidationProtocol: 1, minimumAuthorizedLeaseProtocol: 1, reason: 'fixture' },
          queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
        },
        provider: { key: 'local-password', available: true },
        transports: ['bearer'],
        authority: { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
        authorityDescriptor: { descriptorVersion: 1, authorityInstanceId: '018f0d90-8c21-7a22-8c33-445566778899', sessionGeneration: 0 },
        deploymentIdentity: {
          schemaVersion: artifacts.schemaVersion,
          authMode: 'sessions',
          appId: artifacts.appId,
          schemaHash: artifacts.schemaHash,
          bundleHash: artifacts.bundleHash,
          inputsHash: artifacts.inputsHash,
        },
        authorizedLease: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const appClient = await createSnapbackAppClient({
        app: releaseModule.app,
        binding: releaseBinding,
        url: process.env.VITE_SNAPBACK_URL,
        platform: {
          kind: 'browser',
          indexedDB: new IDBFactory(),
          cryptoObject: globalThis.crypto,
          databaseName: `snapback-release-generated-${process.pid}`,
        },
        rqsStore: null,
        onDiagnostic: (event) => diagnostics.push(event),
      });
      assert.equal(appClient.bootstrapState().status, 'ready');
      await appClient.dispose();
    } finally {
      globalThis.fetch = nativeFetch;
      delete process.env.VITE_SNAPBACK_URL;
    }
    assert.deepEqual(requests, ['/auth/session']);
    assert(diagnostics.some((event) => (
      event.event === 'snapback.declared-dev-url-ignored'
      && !Object.hasOwn(event, 'code')
    )));
  } finally {
    rmSync(appRoot, { recursive: true, force: true });
  }
});

test('packaged generate --check runs the full preflight without replacing artifacts', () => {
  try {
    writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
    writeFileSync(join(root, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: {} });
`);
    const generated = spawnSync(process.execPath, [cli, 'generate', root, '--json'], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const before = digest(join(root, 'generated'));
    const envelopeBefore = digest(join(root, '.snapback', 'generations'));
    const checked = spawnSync(process.execPath, [cli, 'generate', root, '--check', '--json'], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.check, true);
    assert.equal(result.checked, true);
    assert.equal(result.emitted, false);
    assert.equal(digest(join(root, 'generated')), before);
    assert.equal(
      digest(join(root, '.snapback', 'generations')),
      envelopeBefore,
      '--check changed immutable generation envelopes or latest-emitted metadata',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packaged generate --check preserves the same-file helper-cycle refusal', () => {
  const refusalRoot = mkdtempSync(join(tmpdir(), 'snapback-cli-generate-check-refusal-'));
  try {
    writeFileSync(join(refusalRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
    writeFileSync(join(refusalRoot, 'functions.mjs'), `
import { defineJsQuery } from '${defineUrl}';
function ping() { return pong(); }
function pong() { return ping(); }
export const listTodos = defineJsQuery({
  args: {}, reads: ['todos'], handler: async () => ping(),
});
`);
    const checked = spawnSync(
      process.execPath,
      [cli, 'generate', refusalRoot, '--check', '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.ok, false);
    assert(result.diagnostics.some(
      ({ code }) => code === 'SNAPBACK_INLINE_HELPER_CYCLE',
    ));
    assert.equal(existsSync(join(refusalRoot, 'generated')), false);
    assert.equal(existsSync(join(refusalRoot, '.snapback', 'generations')), false);
  } finally {
    rmSync(refusalRoot, { recursive: true, force: true });
  }
});

test('human generate CLIs group migration advisories while JSON retains each finding', () => {
  const codegenHuman = spawnSync(
    process.execPath,
    [codegenCli, campfireRoot, '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(codegenHuman.status, 0, codegenHuman.stderr || codegenHuman.stdout);
  assert.equal(occurrences(codegenHuman.stderr, migrationCode), 0);
  assert.equal(
    occurrences(codegenHuman.stdout, 'migration declare-explicit-write-authority:'),
    1,
  );

  const codegenJson = spawnSync(
    process.execPath,
    [codegenCli, campfireRoot, '--check', '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(codegenJson.status, codegenHuman.status, codegenJson.stderr || codegenJson.stdout);
  assert.equal(occurrences(codegenJson.stderr, migrationCode), 0);
  const result = JSON.parse(codegenJson.stdout);
  assert.equal(result.diagnostics.filter(({ code }) => code === migrationCode).length, 3);
  assert.equal(result.summary.migrationAdvisories.length, 1);
  assert.equal(
    result.authorizationReview.writePolicyChecks.filter(
      ({ genericWriteDisposition }) => genericWriteDisposition === 'migration-pending',
    ).length,
    3,
  );

  const snapbackHuman = spawnSync(
    process.execPath,
    [cli, 'generate', campfireRoot, '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(snapbackHuman.status, codegenHuman.status, snapbackHuman.stderr || snapbackHuman.stdout);
  assert.equal(occurrences(snapbackHuman.stderr, migrationCode), 0);
  assert.equal(
    occurrences(snapbackHuman.stdout, 'migration declare-explicit-write-authority:'),
    1,
  );
});
