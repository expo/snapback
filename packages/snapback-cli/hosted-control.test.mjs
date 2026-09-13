// The hosted surface must survive npm packaging without reaching back into a
// Snapback checkout. This test imports and executes the extracted tarball
// directly; repository paths are used only before packing to prove that the
// package-owned generated schema mirrors have not drifted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  X509Certificate,
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  HOSTED_ASSETS,
  HOSTED_COMMAND_REGISTRY,
  HOSTED_LIFECYCLE_VERBS,
  __hostedControlTest,
} from './hosted-control.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'snapback-hosted-package-'));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

try {
  assert.deepEqual(Object.keys(HOSTED_COMMAND_REGISTRY), [
    'plan',
    'inspect',
    'logs',
    ...Object.keys(HOSTED_LIFECYCLE_VERBS).map((verb) => `lifecycle ${verb}`),
  ]);
  assert.equal(new Set(Object.values(HOSTED_LIFECYCLE_VERBS)).size, 17);
  assert(Object.values(HOSTED_COMMAND_REGISTRY)
    .filter(({ kind }) => kind === 'lifecycle')
    .every(({ availability, blockerCode }) => (
      availability === 'disabled'
      && blockerCode === 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE'
    )));

  for (const packageRelative of Object.values(HOSTED_ASSETS.schemas)) {
    const name = packageRelative.split('/').at(-1);
    assert.equal(
      sha256(readFileSync(join(here, packageRelative))),
      sha256(readFileSync(join(here, '..', '..', 'schemas', name))),
      `${name} package mirror drifted from the generated canonical schema`,
    );
  }

  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
    { cwd: here, encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  const packagedPaths = new Set(files.map(({ path }) => path));
  assert(packagedPaths.has('hosted-control.mjs'));
  assert(packagedPaths.has('adapters/fly-machines-vm-driver.mjs'));
  for (const path of Object.values(HOSTED_ASSETS.schemas)) assert(packagedPaths.has(path));

  const archive = join(root, filename);
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', root], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  const isolatedPackage = join(root, 'package');
  const isolated = await import(pathToFileURL(join(isolatedPackage, 'hosted-control.mjs')));

  const plan = isolated.createHostedPlan();
  assert.equal(plan.ok, true);
  assert.equal(plan.targetId, null);
  assert.equal(plan.commands.length, Object.keys(HOSTED_COMMAND_REGISTRY).length);
  assert.match(plan.driver.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(plan.driver.lifecycleAvailability, 'disabled');
  assert.equal(plan.driver.requiredEvidence.length, 4);
  assert.equal(Object.keys(plan.schemas).length, 4);
  assert(!JSON.stringify(plan).includes(here));

  const requestPath = join(root, 'request.json');
  const request = {
    schemaVersion: 'snapback.vm-adapter-lifecycle-request.v2',
    operation: 'provisionInactive',
    operationId: 'package-proof-operation',
    attempt: 0,
    targetBinding: {},
    planSha256: `sha256:${'1'.repeat(64)}`,
    requestSha256: `sha256:${'2'.repeat(64)}`,
    predecessorHead: {
      schemaVersion: 'snapback.hosted-control-head.v2',
      targetId: 'target-proof',
      generation: 0,
      bindingSha256: `sha256:${'3'.repeat(64)}`,
      activationGeneration: 0,
      activeReleaseId: null,
      journalRootSha256: `sha256:${'4'.repeat(64)}`,
      admissionGeneration: 0,
      spendFloor: 0,
      cleanupFloor: 0,
      replayFloor: 0,
      supervisorIncarnation: 'supervisor-proof',
      predecessorSha256: null,
      committedAtMs: 1,
    },
    effectIntent: {
      semanticEffectId: 'semantic-effect-proof',
    },
    lease: null,
    confirmationSha256: null,
  };
  assert.deepEqual(
    Object.keys(request).sort(),
    [...__hostedControlTest.LIFECYCLE_REQUEST_KEYS].sort(),
  );
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  const refusal = await isolated.invokeHostedLifecycle('provision-inactive', {
    requestPath,
  });
  assert.equal(refusal.schemaVersion, 'snapback.hosted-lifecycle-refusal.v1');
  assert.equal(refusal.ok, false);
  assert.equal(refusal.operation, 'provisionInactive');
  assert.equal(refusal.code, 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE');
  assert.deepEqual(refusal.recommendedNext, {
    owner: 'Snapback hosted control plane',
    ticketOrDesignPointer: 'issues/shelved/20260728-hosted-lifecycle-carrier-and-custody-gap.md',
    note: 'Complete the reviewed per-operation carrier, supervisor-only lease custody, bootstrap/listener proof, and live Fly/Tigris journey before enabling lifecycle effects.',
  });
  assert(refusal.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
  ));

  const operatorRequestPath = join(root, 'operator-request.json');
  writeFileSync(operatorRequestPath, `${JSON.stringify({
    schemaVersion: 'snapback.supervisor-request.v1',
    requestId: 'operator-request-proof',
    body: {
      schemaVersion: 'snapback.supervisor-lifecycle-execution.v1',
      journeyId: 'journey-proof',
      grantId: 'grant-proof',
      lifecycleRequest: request,
    },
  })}\n`, { mode: 0o600 });
  let submitted = false;
  const response = await isolated.invokeHostedLifecycle('provision-inactive', {
    requestPath,
    operatorRequestPath,
    endpoint: 'https://supervisor.example.test',
    clientKeyPath: '/not-read-by-injected-submit',
    clientCertificatePath: '/not-read-by-injected-submit',
    serverCaPath: '/not-read-by-injected-submit',
    rootPublicKeyPath: '/not-read-by-injected-submit',
    serverCertificateSha256: `sha256:${'9'.repeat(64)}`,
    submitOperatorRequest: async () => {
      submitted = true;
      return {
      body: {
        result: {
          schemaVersion: 'snapback.vm-adapter-lifecycle-response.v2',
          operation: request.operation,
          operationId: request.operationId,
          ok: false,
          terminal: {
            outcome: 'notApplied',
          },
        },
      },
    };
    },
  });
  assert.equal(response.schemaVersion, 'snapback.hosted-lifecycle-refusal.v1');
  assert.equal(response.code, 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE');
  assert.equal(submitted, false);

  // The extracted package performs certificate-digest binding and verifies
  // both purpose-intermediate and response signatures without exposing key
  // bytes or reaching back into the repository.
  const clientKeyPath = join(root, 'client-key.pem');
  const clientCertificatePath = join(root, 'client-cert.pem');
  const openssl = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-subj', '/CN=fixture-operator',
    '-keyout', clientKeyPath,
    '-out', clientCertificatePath,
    '-days', '1',
  ], { encoding: 'utf8' });
  assert.equal(openssl.status, 0, openssl.stderr);
  chmodSync(clientKeyPath, 0o600);
  const clientCertificateSha256 = sha256(
    new X509Certificate(readFileSync(clientCertificatePath)).raw,
  );
  const { privateKey: rootPrivate, publicKey: rootPublic } =
    generateKeyPairSync('ed25519');
  const { privateKey: responsePrivate, publicKey: responsePublic } =
    generateKeyPairSync('ed25519');
  const rootPublicKeyPath = join(root, 'root-public.pem');
  const caPath = join(root, 'server-ca.pem');
  writeFileSync(
    rootPublicKeyPath,
    rootPublic.export({ format: 'pem', type: 'spki' }),
    { mode: 0o600 },
  );
  writeFileSync(caPath, readFileSync(clientCertificatePath), { mode: 0o600 });
  const issuedAt = new Date(1_800_000_000_000).toISOString();
  const intermediateContent = {
    schemaVersion: 'snapback.supervisor-service-intermediate.v1',
    installationId: 'installation-proof',
    intermediateKeyId: 'response-key-proof',
    publicKeyEd25519: responsePublic.export({ format: 'der', type: 'spki' })
      .subarray(-32).toString('base64url'),
    purpose: 'supervisor-response',
    serial: 1,
    revocationGeneration: 1,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: new Date(1_800_000_060_000).toISOString(),
    rootKeyId: 'root-proof',
  };
  const intermediate = {
    ...intermediateContent,
    signature: sign(
      null,
      Buffer.concat([
        Buffer.from('snapback-supervisor-service-intermediate-v1\0'),
        Buffer.from(canonicalJson(intermediateContent)),
      ]),
      rootPrivate,
    ).toString('base64url'),
  };
  const transportRequest = {
    schemaVersion: 'snapback.supervisor-request.v1',
    installationId: 'installation-proof',
    rootKeyId: 'root-proof',
    requestId: 'transport-request-proof',
    operatorCertificateSha256: clientCertificateSha256,
    targetHeadSha256: `sha256:${'8'.repeat(64)}`,
  };
  const transportRequestPath = join(root, 'transport-request.json');
  writeFileSync(
    transportRequestPath,
    `${JSON.stringify(transportRequest)}\n`,
    { mode: 0o600 },
  );
  const responseBody = {
    schemaVersion: 'snapback.supervisor-response-body.v1',
    ok: true,
    result: { terminal: 'notApplied' },
    diagnostic: null,
  };
  const responseContent = {
    schemaVersion: 'snapback.supervisor-response.v1',
    audience: 'snapback-operator',
    installationId: transportRequest.installationId,
    supervisorIncarnation: 'incarnation-proof',
    supervisorGeneration: 2,
    supervisorHeadSha256: `sha256:${'7'.repeat(64)}`,
    requestId: transportRequest.requestId,
    requestSha256: sha256(Buffer.concat([
      Buffer.from('snapback-supervisor-retained-request-v1\0'),
      Buffer.from(canonicalJson(transportRequest)),
    ])),
    operatorCertificateSha256: clientCertificateSha256,
    targetHeadSha256: transportRequest.targetHeadSha256,
    bodySha256: sha256(Buffer.from(canonicalJson(responseBody))),
    body: responseBody,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: new Date(1_800_000_060_000).toISOString(),
    keyId: intermediate.intermediateKeyId,
    serviceIntermediate: intermediate,
  };
  const transportResponse = {
    ...responseContent,
    signature: sign(
      null,
      Buffer.concat([
        Buffer.from('snapback-supervisor-response-v1\0'),
        Buffer.from(canonicalJson(responseContent)),
      ]),
      responsePrivate,
    ).toString('base64url'),
  };
  const verifiedTransport = await isolated.submitHostedOperatorRequest({
    requestPath: transportRequestPath,
    endpoint: 'https://supervisor.example.test',
    clientKeyPath,
    clientCertificatePath,
    serverCaPath: caPath,
    rootPublicKeyPath,
    serverCertificateSha256: `sha256:${'6'.repeat(64)}`,
    now: () => 1_800_000_000_000,
    transport: async (_endpoint, options) => {
      assert(options.key.includes('PRIVATE KEY'));
      assert(options.cert.includes('CERTIFICATE'));
      assert(!JSON.stringify(options).includes('secret-token'));
      return transportResponse;
    },
  });
  assert.equal(verifiedTransport.requestId, transportRequest.requestId);
  await assert.rejects(
    isolated.submitHostedOperatorRequest({
      requestPath: transportRequestPath,
      endpoint: 'https://supervisor.example.test',
      clientKeyPath,
      clientCertificatePath,
      serverCaPath: caPath,
      rootPublicKeyPath,
      serverCertificateSha256: `sha256:${'6'.repeat(64)}`,
      minimumRevocationGeneration: 2,
      now: () => 1_800_000_000_000,
      transport: async () => transportResponse,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
  );
  await assert.rejects(
    isolated.submitHostedOperatorRequest({
      requestPath: transportRequestPath,
      endpoint: 'https://supervisor.example.test',
      clientKeyPath,
      clientCertificatePath,
      serverCaPath: caPath,
      rootPublicKeyPath,
      serverCertificateSha256: `sha256:${'6'.repeat(64)}`,
      clockSkewMs: 0,
      now: () => 1_800_000_060_001,
      transport: async () => transportResponse,
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
  );
  await assert.rejects(
    isolated.submitHostedOperatorRequest({
      requestPath: transportRequestPath,
      endpoint: 'https://supervisor.example.test',
      clientKeyPath,
      clientCertificatePath,
      serverCaPath: caPath,
      rootPublicKeyPath,
      serverCertificateSha256: `sha256:${'6'.repeat(64)}`,
      now: () => 1_800_000_000_000,
      transport: async () => ({
        ...transportResponse,
        body: { ...transportResponse.body, result: { terminal: 'applied' } },
      }),
    }),
    (error) => error.code === 'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
  );

  await assert.rejects(
    isolated.invokeHostedLifecycle('not-a-verb', { requestPath }),
    (error) => error.code === 'SNAPBACK_HOSTED_LIFECYCLE_VERB_UNKNOWN',
  );
  request.operation = 'releaseLease';
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  await assert.rejects(
    isolated.invokeHostedLifecycle('provision-inactive', { requestPath }),
    (error) => error.code === 'SNAPBACK_HOSTED_REQUEST_INVALID',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('hosted control package tests passed');
