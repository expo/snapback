// Error-path attribution parity across the three finite lanes — raw HTTP,
// the lifted client core, and this CLI's artifact-driven invocation — for
// every principal class (LLP 0062 result-contract parity; LLP 0055 §Audit).
// The CLI never reshapes the client's surfaced error, so the block a CLI
// caller sees must be byte-identical to the served bytes; classes without a
// resolved service principal must surface no member at all on every lane.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AgentAuthorityFence,
  SnapbackClient,
  deriveServiceAuthorityInstanceId,
} from '@expo/snapback-client';
import { invokeAppFunction, loadAppArtifacts } from './index.mjs';

const ACTOR_ID = '018f0d90-7b31-7a22-8c33-445566778899';
const EFFECTIVE_ID = '018f0d90-7b30-7a22-8c33-445566778899';
const GRANT_ID = '018f0d90-7b32-7a22-8c33-445566778899';
const CREDENTIAL_ID = '018f0d90-7b33-7a22-8c33-445566778899';
const AGENT_BEARER = 'sbagt_cli_attribution_token';
const SESSION_BEARER = 'sbs_cli_attribution_session';
const ATTRIBUTION = {
  actorUserId: ACTOR_ID,
  effectiveUserId: EFFECTIVE_ID,
  grantId: GRANT_ID,
  dryRun: false,
};

const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'cli-attribution',
  authorizationStreamIncarnation: '018f0d90-7b34-7a22-8c33-445566778899',
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
    queuedReplay: {
      available: false,
      minimumAuthorityDescriptorProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: { kind: 'servicePrincipal', userId: EFFECTIVE_ID, sessionId: null, isAuthenticated: true },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: deriveServiceAuthorityInstanceId({
      actorUserId: ACTOR_ID,
      credentialId: CREDENTIAL_ID,
      credentialGeneration: 1,
      grantId: GRANT_ID,
    }),
    sessionGeneration: 0,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: 'attribution-parity',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
};

const served = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const isAgent = request.headers.authorization === `Bearer ${AGENT_BEARER}`;
  const answer = (status, value) => {
    const body = JSON.stringify(value);
    served.push({ path: request.url, status, body });
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(body);
  };
  if (request.url === '/auth/session') {
    if (isAgent) return answer(200, handshake);
    return answer(200, {
      ...handshake,
      authority: {
        kind: 'humanSession',
        userId: EFFECTIVE_ID,
        sessionId: '018f0d90-7b37-7a22-8c33-445566778899',
        isAuthenticated: true,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: '018f0d90-7b35-7a22-8c33-445566778899',
        sessionGeneration: 1,
      },
    });
  }
  if (request.url === '/query/denied') {
    return answer(403, {
      diagnostic: {
        code: 'SNAPBACK_AUTH_GRANT_SCOPE_DENIED',
        severity: 'error',
        subsystem: 'auth',
        message: 'scope denied',
        details: {},
      },
      ...(isAgent ? { attribution: ATTRIBUTION } : {}),
    });
  }
  return answer(404, {
    diagnostic: {
      code: 'SNAPBACK_ROUTE_UNKNOWN',
      severity: 'error',
      subsystem: 'server',
      message: request.url,
      details: {},
    },
  });
});

const directory = await mkdtemp(join(tmpdir(), 'snapback-app-cli-attribution-'));
try {
  await writeFile(join(directory, 'artifacts.json'), JSON.stringify({
    artifactKind: 'artifactIndex',
    appId: 'attribution-parity',
    bundleHash: 'sha256:test',
  }));
  await writeFile(join(directory, 'functions.manifest.json'), JSON.stringify({
    artifactKind: 'functionManifest',
    appId: 'attribution-parity',
    bundleHash: 'sha256:test',
    functions: [{ id: 'attribution-parity:denied', name: 'denied', kind: 'Query' }],
  }));
  await mkdir(join(directory, 'operations'));
  await writeFile(join(directory, 'operations', 'denied.args.schema.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const artifacts = await loadAppArtifacts(directory);

  const caught = async (work) => {
    try {
      await work();
    } catch (error) {
      return error;
    }
    return assert.fail('expected the invocation to reject');
  };
  const lastServedBody = () => JSON.parse(
    [...served].reverse().find((entry) => entry.path === '/query/denied').body,
  );

  const agentClient = () => new SnapbackClient(baseUrl, {
    agentAuthority: new AgentAuthorityFence({
      actorUserId: ACTOR_ID,
      credentialId: CREDENTIAL_ID,
      credentialGeneration: 1,
      grantId: GRANT_ID,
      tokenId: '018f0d90-7b36-7a22-8c33-445566778899',
      bearerToken: AGENT_BEARER,
    }),
    authInvalidationProtocol: 1,
  });
  // The stage-(a) CLI selects principals at client construction; dev
  // assertion is a per-call client option the CLI does not (yet) project,
  // so its CLI lane is the anonymous client — the class still gets full
  // HTTP-vs-client parity here and in the client package's own matrix.
  const classes = [
    ['anonymous', () => new SnapbackClient(baseUrl), {}],
    ['devAsserted', () => new SnapbackClient(baseUrl), { userId: 'dev-user' }],
    [
      'sessionBearer',
      () => new SnapbackClient(baseUrl, {
        bearerToken: SESSION_BEARER,
        authClientProtocol: 1,
        authInvalidationProtocol: 1,
      }),
      {},
    ],
    ['servicePrincipal', agentClient, {}],
  ];
  for (const [label, makeClient, options] of classes) {
    const client = makeClient();
    const clientError = await caught(() => client.query('denied', { args: {}, ...options }));
    const clientRaw = lastServedBody();
    const cliError = await caught(() => invokeAppFunction(client, artifacts, 'denied', {}));
    const cliRaw = lastServedBody();
    if (label === 'servicePrincipal') {
      assert.equal(
        JSON.stringify(clientError.attribution),
        JSON.stringify(clientRaw.attribution),
        `${label}: client lane`,
      );
      assert.equal(
        JSON.stringify(cliError.attribution),
        JSON.stringify(cliRaw.attribution),
        `${label}: CLI lane`,
      );
      assert.equal(JSON.stringify(clientRaw.attribution), JSON.stringify(ATTRIBUTION));
    } else {
      assert.equal('attribution' in clientRaw, false, `${label}: HTTP carries no block`);
      assert.equal('attribution' in clientError, false, `${label}: client must not synthesize`);
      assert.equal('attribution' in cliError, false, `${label}: CLI must not synthesize`);
    }
    assert.equal(clientError.diagnostic.code, clientRaw.diagnostic.code, `${label}: diagnostic parity`);
    assert.equal(cliError.diagnostic.code, cliRaw.diagnostic.code, `${label}: CLI diagnostic parity`);
  }

  console.log('attribution.test.mjs: HTTP/client/CLI error-path attribution parity per principal class passes');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
