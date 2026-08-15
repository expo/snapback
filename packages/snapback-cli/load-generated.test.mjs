import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { __test, loadGenerated } from './index.mjs';

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeLegacyGeneratedGraph = (backendRoot, artifacts) => {
  const generated = join(backendRoot, 'generated');
  mkdirSync(generated, { recursive: true });
  for (const [name, value] of Object.entries(artifacts)) {
    writeJson(join(generated, name), value);
  }
  writeJson(join(generated, 'artifacts.json'), {
    artifactKind: 'artifactIndex',
    artifacts: Object.keys(artifacts).sort(),
  });
};

const writeReady = (path, serverUrl) => {
  mkdirSync(dirname(path), { recursive: true });
  writeJson(path, {
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    ready: true,
    pid: process.pid,
    serverUrl,
    database: { path: null },
  });
};

const makeRecordingRuntime = (root, { loadStdout = null } = {}) => {
  const log = join(root, 'native.log');
  const binary = join(root, 'snapback-recording-runtime');
  const stdoutPath = join(root, 'native.stdout');
  if (loadStdout !== null) writeFileSync(stdoutPath, loadStdout);
  writeFileSync(binary, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = "load" ] && [ -f '${stdoutPath}' ]; then
  /bin/cat '${stdoutPath}'
fi
`);
  chmodSync(binary, 0o755);
  return { binary, log };
};

const hostOpsResult = (operation, ok = true) => ({
  schemaVersion: 'snapback.v0',
  resultKind: 'hostOpsResult',
  operation,
  ok,
});

const jsonResponse = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
const jsonErrorResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const root = mkdtempSync(join(tmpdir(), 'snapback-cli-load-generated-'));
const originalFetch = globalThis.fetch;
try {
  {
    const deployment = {
      schemaVersion: 'snapback.v0',
      authMode: 'dev',
      appId: 'activation-summary',
      schemaHash: 'sha256:schema',
      bundleHash: 'sha256:functions',
      inputsHash: 'sha256:inputs',
    };
    const generated = {
      deployment,
      functionAppId: deployment.appId,
      functionSchemaVersion: deployment.schemaVersion,
      functionInputsHash: deployment.inputsHash,
      targetProfile: null,
    };
    const extras = {
      routes: {
        sent: true,
        outcome: 'provisioned',
        routeManifestHash: 'sha256:routes',
      },
      apiEnvelope: {
        sent: true,
        provisioned: true,
        membersDigest: 'sha256:members',
      },
      seed: {
        operation: 'ensure',
        seedVersion: 'seed-v1',
        seedDigest: 'sha256:seed',
      },
    };
    const devTarget = __test.expectedActivationTargetFromActivation({
      mode: 'dev',
      branch: 'dev-push',
      generated,
      ...extras,
    }, 'local-dev-sqlite-ibex');
    assert.deepEqual(devTarget.declaredObligations.map(({ kind }) => kind), [
      'schema', 'functions', 'seed',
    ]);

    const ensureTarget = __test.expectedActivationTargetFromActivation({
      mode: 'dev',
      branch: 'ensure-app',
      generated,
      ...extras,
    }, 'local-dev-sqlite-ibex');
    assert.deepEqual(ensureTarget.declaredObligations.map(({ kind }) => kind), [
      'schema', 'functions', 'routes', 'seed',
    ]);
  }

  {
    const projectRoot = join(root, 'retired-generated-directory');
    const backendRoot = join(projectRoot, 'snapback');
    mkdirSync(join(backendRoot, '_generated'), { recursive: true });
    await assert.rejects(
      loadGenerated(
        join(projectRoot, 'unused-runtime'),
        projectRoot,
        backendRoot,
        join(projectRoot, '.snapback', 'dev.ready.json'),
        null,
      ),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY');
        assert.equal(error.diagnostic.details.path, join(backendRoot, '_generated'));
        assert.equal(error.diagnostic.details.canonicalPath, join(backendRoot, 'generated'));
        assert.equal(error.diagnostic.details.reason, 'one-generated-directory-no-watcher-aliases');
        return true;
      },
    );
  }

  {
    const projectRoot = join(root, 'dev-routes');
    const backendRoot = join(projectRoot, 'snapback');
    const readyFile = join(projectRoot, '.snapback', 'dev.ready.json');
    const routes = {
      formatVersion: 1,
      app: 'cli-dev-routes',
      routes: [],
    };
    writeLegacyGeneratedGraph(backendRoot, {
      'schema.manifest.json': {
        artifactKind: 'schemaManifest',
        appId: 'cli-dev-routes',
        auth: { mode: 'dev' },
      },
      'functions.manifest.json': {
        artifactKind: 'functionManifest',
        appId: 'cli-dev-routes',
      },
      'routes.manifest.json': routes,
      'api-envelope.members.json': {
        operations: {},
        declarations: { appBindings: '' },
        memberDigests: {},
      },
    });
    writeReady(readyFile, 'http://snapback-dev-routes.test');
    const runtime = makeRecordingRuntime(projectRoot, {
      loadStdout: [
        hostOpsResult('schema.load'),
        hostOpsResult('functions.load'),
      ].map((document) => JSON.stringify(document, null, 2)).join('\n'),
    });
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return jsonResponse({
        schema: 'skipped-absent',
        functions: 'skipped-absent',
        seed: 'skipped-absent',
        routes: 'provisioned',
        profile: 'dev',
      });
    };

    const activation = await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      'dev-admin-token',
    );

    const nativeLog = readFileSync(runtime.log, 'utf8');
    assert.match(nativeLog, /^load /u);
    assert.doesNotMatch(nativeLog, /dev-admin-token/u, 'admin token must not travel on native argv');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://snapback-dev-routes.test/app/ensure');
    assert.deepEqual(JSON.parse(requests[0].init.body), { routes });
    assert.equal(activation.mode, 'dev');
    assert.equal(activation.branch, 'dev-push');
    assert.equal(activation.routes.sent, true);
    assert.equal(activation.apiEnvelope, null);
    assert.equal(activation.seed, null);
    assert.equal(
      new Headers(requests[0].init.headers).get('x-snapback-admin-token'),
      null,
      'legacy dev route ensure remains the established Public provisioning carrier',
    );
  }

  {
    const projectRoot = join(root, 'malformed-native-load-output');
    const backendRoot = join(projectRoot, 'snapback');
    writeLegacyGeneratedGraph(backendRoot, {
      'schema.manifest.json': {
        artifactKind: 'schemaManifest',
        appId: 'malformed-native-load-output',
        auth: { mode: 'dev' },
      },
      'functions.manifest.json': {
        artifactKind: 'functionManifest',
        appId: 'malformed-native-load-output',
      },
    });
    const runtime = makeRecordingRuntime(projectRoot, {
      loadStdout: `${JSON.stringify(hostOpsResult('schema.load'))}\nnot-json\n`,
    });

    await assert.rejects(
      loadGenerated(
        runtime.binary,
        projectRoot,
        backendRoot,
        join(projectRoot, '.snapback', 'dev.ready.json'),
        'dev-admin-token',
      ),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_DEV_SERVER_LOAD_FAILED');
        assert.equal(error.message, 'schema/function load failed');
        assert.match(error.diagnostic.details.framingError, /non-JSON content/u);
        return true;
      },
    );
  }

  {
    const projectRoot = join(root, 'failed-native-load-envelope');
    const backendRoot = join(projectRoot, 'snapback');
    writeLegacyGeneratedGraph(backendRoot, {
      'schema.manifest.json': {
        artifactKind: 'schemaManifest',
        appId: 'failed-native-load-envelope',
        auth: { mode: 'dev' },
      },
      'functions.manifest.json': {
        artifactKind: 'functionManifest',
        appId: 'failed-native-load-envelope',
      },
    });
    const runtime = makeRecordingRuntime(projectRoot, {
      loadStdout: [
        hostOpsResult('schema.load'),
        hostOpsResult('functions.load', false),
      ].map((document) => JSON.stringify(document)).join('\n'),
    });

    await assert.rejects(
      loadGenerated(
        runtime.binary,
        projectRoot,
        backendRoot,
        join(projectRoot, '.snapback', 'dev.ready.json'),
        'dev-admin-token',
      ),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_DEV_SERVER_LOAD_FAILED');
        assert.equal(error.message, 'schema/function load failed');
        assert.equal(error.diagnostic.details.failedOperation, 'functions.load');
        assert.equal(error.diagnostic.details.failedEnvelope.ok, false);
        return true;
      },
    );
  }

  {
    const projectRoot = join(root, 'sessions-seed');
    const backendRoot = join(projectRoot, 'snapback');
    const readyFile = join(projectRoot, '.snapback', 'dev.ready.json');
    const appId = 'cli-sessions-seed';
    const incarnation = '018f0d90-7b11-7a22-8c33-445566778899';
    const artifact = {
      formatVersion: 'snapback.seed.v1',
      appId,
      seedVersion: '2026-07-28.1',
      seedDigest: `sha256:${'a'.repeat(64)}`,
      tables: {},
    };
    const apiEnvelopeMembers = {
      operations: {},
      declarations: { appBindings: '' },
      memberDigests: {},
    };
    writeLegacyGeneratedGraph(backendRoot, {
      'schema.manifest.json': {
        artifactKind: 'schemaManifest',
        schemaVersion: 'snapback.v1',
        appId,
        auth: { mode: 'sessions' },
      },
      'functions.manifest.json': {
        artifactKind: 'functionManifest',
        schemaVersion: 'snapback.v1',
        appId,
      },
      'capability.manifest.json': {
        supportedCapabilities: [
          'versioned_seed_install_v1',
          'versioned_seed_reset_v1',
        ],
      },
      'seed.artifact.json': artifact,
      'api-envelope.members.json': apiEnvelopeMembers,
    });
    writeReady(readyFile, 'http://snapback-sessions-seed.test');
    const runtime = makeRecordingRuntime(projectRoot);
    const requests = [];
    const handshake = {
      protocolVersion: 1,
      serverStartupNonce: 'startup-cli-sessions-seed',
      authorizationStreamIncarnation: incarnation,
      transitionGeneration: 1,
      activeMode: 'sessions',
      desiredMode: 'sessions',
      modeState: 'settled',
      appDataAvailability: 'available',
      quarantineCode: null,
      clientProtocols: {
        authClient: 1,
        authInvalidation: null,
        authorityDescriptor: 1,
        authorizedLease: null,
      },
      availability: {
        onlineRequestResponse: { available: true, reason: null },
        authScopedLive: {
          available: false,
          minimumAuthInvalidationProtocol: 1,
          reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
        },
        retainedReads: {
          available: false,
          minimumAuthInvalidationProtocol: 1,
          minimumAuthorizedLeaseProtocol: 1,
          reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
        },
        queuedReplay: {
          available: true,
          minimumAuthorityDescriptorProtocol: 1,
          reason: null,
        },
      },
      provider: { key: 'email-code', available: true },
      transports: ['bearer'],
      authority: {
        kind: 'anonymous',
        userId: null,
        sessionId: null,
        isAuthenticated: false,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: incarnation,
        sessionGeneration: 0,
      },
      deploymentIdentity: {
        schemaVersion: 'snapback.v1',
        authMode: 'sessions',
        appId,
        schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
        bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
        inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
      },
      authorizedLease: null,
    };
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      requests.push({ path, init });
      if (path === '/auth/session') return jsonResponse(handshake);
      if (path === '/app/ensure') {
        return jsonResponse({
          schema: 'matched',
          functions: 'matched',
          seed: 'skipped-absent',
          routes: 'skipped-absent',
          profile: 'dev',
          apiEnvelope: 'composed',
        });
      }
      if (path === '/inspect') {
        return jsonResponse({
          capabilityManifest: {
            supportedCapabilities: [
              'versioned_seed_install_v1',
              'versioned_seed_reset_v1',
            ],
          },
        });
      }
      if (path === '/_snapback/api/app/seed/preview-v1') {
        return jsonResponse({
          requested: { dataVersionStream: incarnation },
        });
      }
      if (
        path === '/_snapback/api/app/seed/ensure-v1'
        || path === '/_snapback/api/app/seed/reset-install-v1'
      ) {
        return jsonResponse({ outcome: 'installed' });
      }
      throw new Error(`unexpected managed seed request: ${path}`);
    };

    const ensured = await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      'sessions-admin-token',
      { skipSchemaFunctions: true },
    );
    const resetInstalled = await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      'sessions-admin-token',
      { seed: true, skipSchemaFunctions: true },
    );

    assert.equal(ensured.mode, 'sessions');
    assert.equal(ensured.branch, 'ensure-app');
    assert.equal(ensured.apiEnvelope.sent, true);
    assert.equal(ensured.apiEnvelope.provisioned, true);
    assert.equal(typeof ensured.apiEnvelope.membersDigest, 'string');
    assert.deepEqual(ensured.seed, {
      operation: 'ensure',
      seedVersion: artifact.seedVersion,
      seedDigest: artifact.seedDigest,
    });
    assert.deepEqual(resetInstalled.seed, {
      operation: 'reset-install',
      seedVersion: artifact.seedVersion,
      seedDigest: artifact.seedDigest,
    });

    const handshakes = requests.filter(({ path }) => path === '/auth/session');
    assert.equal(handshakes.length, 2, 'each managed load establishes fresh in-memory custody');
    for (const { init } of handshakes) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-snapback-auth-client-protocol'), '1');
      assert.equal(headers.get('authorization'), null);
    }
    const provisions = requests.filter(({ path }) => path === '/app/ensure');
    assert.equal(provisions.length, 2, 'sessions reloads use the complete provision carrier');
    for (const { init } of provisions) {
      const body = JSON.parse(init.body);
      assert.equal(body.intent, 'provision');
      assert.equal(body.requestedMode, 'sessions');
      assert.equal(body.schema.appId, appId);
      assert.equal(body.functions.appId, appId);
      assert.deepEqual(body.apiEnvelope, apiEnvelopeMembers);
      assert.equal(
        new Headers(init.headers).get('x-snapback-admin-token'),
        'sessions-admin-token',
      );
    }
    assert.equal(
      existsSync(runtime.log),
      false,
      'sessions updates never use the dev-only raw schema/functions load verbs',
    );
    const ensureBody = JSON.parse(
      requests.find(({ path }) => path === '/_snapback/api/app/seed/ensure-v1').init.body,
    );
    assert.equal(ensureBody.requestedMode, 'sessions');
    const previewBody = JSON.parse(
      requests.find(({ path }) => path === '/_snapback/api/app/seed/preview-v1').init.body,
    );
    assert.equal(previewBody.requestedMode, 'sessions');
    const resetRequest = requests.find(
      ({ path }) => path === '/_snapback/api/app/seed/reset-install-v1',
    );
    const resetBody = JSON.parse(resetRequest.init.body);
    assert.equal(resetBody.requestedMode, 'sessions');
    assert.deepEqual(resetBody.expectedDataVersionStream, {
      state: 'present',
      value: incarnation,
    });
    assert.equal(
      new Headers(resetRequest.init.headers).get('x-snapback-admin-token'),
      'sessions-admin-token',
    );
    assert.equal(
      requests.some(({ path }) => path === '/_snapback/api/app/reset'),
      false,
      'versioned sessions provisioning never falls back to legacy reset',
    );
  }

  {
    const projectRoot = join(root, 'runtime-artifact-mismatch');
    const backendRoot = join(projectRoot, 'snapback');
    const readyFile = join(projectRoot, '.snapback', 'dev.ready.json');
    writeLegacyGeneratedGraph(backendRoot, {
      'schema.manifest.json': {
        artifactKind: 'schemaManifest',
        appId: 'runtime-artifact-mismatch',
        auth: { mode: 'dev' },
      },
      'functions.manifest.json': {
        artifactKind: 'functionManifest',
        appId: 'runtime-artifact-mismatch',
      },
      'routes.manifest.json': {
        formatVersion: 1,
        app: 'runtime-artifact-mismatch',
        routes: [{
          pattern: '/',
          queries: [],
          registerGroupEligible: true,
        }],
      },
    });
    writeReady(readyFile, 'http://snapback-runtime-mismatch.test');
    const runtime = makeRecordingRuntime(projectRoot, {
      loadStdout: [
        hostOpsResult('schema.load'),
        hostOpsResult('functions.load'),
      ].map((document) => JSON.stringify(document)).join('\n'),
    });
    globalThis.fetch = async () => jsonErrorResponse(422, {
      ok: false,
      diagnostic: {
        code: 'SNAPBACK_REQUEST_JSON_INVALID',
        severity: 'error',
        subsystem: 'server',
        message: 'request body was not valid JSON for this operation',
        details: {
          error: 'unknown field `registerGroupEligible`, expected `pattern` or `queries`',
        },
      },
    });

    await assert.rejects(
      loadGenerated(
        runtime.binary,
        projectRoot,
        backendRoot,
        readyFile,
        'dev-admin-token',
        {
          runtime: {
            source: '@expo/snapback-runtime-darwin-arm64',
          },
          runtimeIdentity: {
            stamp: {
              gitCommit: 'old-runtime-commit',
              gitDirty: false,
              crateVersion: '0.1.0',
              buildProfile: 'release',
            },
          },
        },
      ),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH');
        assert.equal(error.diagnostic.code, error.code);
        assert.equal(error.diagnostic.details.selectedBinary, runtime.binary);
        assert.equal(
          error.diagnostic.details.selectedRuntimeSource,
          '@expo/snapback-runtime-darwin-arm64',
        );
        assert.equal(
          error.diagnostic.details.selectedRuntimeStamp.gitCommit,
          'old-runtime-commit',
        );
        assert.match(
          error.diagnostic.details.decoderEvidence,
          /registerGroupEligible/u,
        );
        assert.match(
          error.diagnostic.details.recovery.contributorRebuild,
          /bootstrap-ibex-runtime/u,
        );
        assert.match(
          error.diagnostic.details.recovery.compatibleOverride,
          /SNAPBACK_RUNTIME_BINARY/u,
        );
        assert.match(
          error.diagnostic.details.recovery.safety,
          /do not delete generated fields/u,
        );
        return true;
      },
    );
  }

  console.log('load-generated.test.mjs: dev load framing, routes, sessions provisioning, and runtime/artifact mismatch diagnostics passed');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
