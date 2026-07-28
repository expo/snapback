import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadGenerated } from './index.mjs';

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

const makeRecordingRuntime = (root) => {
  const log = join(root, 'native.log');
  const binary = join(root, 'snapback-recording-runtime');
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`);
  chmodSync(binary, 0o755);
  return { binary, log };
};

const jsonResponse = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const root = mkdtempSync(join(tmpdir(), 'snapback-cli-load-generated-'));
const originalFetch = globalThis.fetch;
try {
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
    });
    writeReady(readyFile, 'http://snapback-dev-routes.test');
    const runtime = makeRecordingRuntime(projectRoot);
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

    await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      'dev-admin-token',
    );

    assert.match(readFileSync(runtime.log, 'utf8'), /^load /u);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://snapback-dev-routes.test/app/ensure');
    assert.deepEqual(JSON.parse(requests[0].init.body), { routes });
    assert.equal(
      new Headers(requests[0].init.headers).get('x-snapback-admin-token'),
      null,
      'legacy dev route ensure remains the established Public provisioning carrier',
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

    await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      'sessions-admin-token',
      { skipSchemaFunctions: true },
    );
    await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      'sessions-admin-token',
      { seed: true, skipSchemaFunctions: true },
    );

    const handshakes = requests.filter(({ path }) => path === '/auth/session');
    assert.equal(handshakes.length, 2, 'each managed load establishes fresh in-memory custody');
    for (const { init } of handshakes) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-snapback-auth-client-protocol'), '1');
      assert.equal(headers.get('authorization'), null);
    }
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

  console.log('load-generated.test.mjs: routes and sessions seed custody passed');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
