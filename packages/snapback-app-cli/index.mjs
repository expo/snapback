import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AgentAuthorityFence, SnapbackClient } from '@snapback/client';
import { resolveGeneratedArtifact } from '@snapback/codegen/review-surface';

// @ref LLP 0062#1-engine-plus-data-never-program-source--served-or-generated —
// local phase 1 discovers the app surface from inert generated JSON and never
// imports generated api.mjs or handler source.

const FUNCTION_KINDS = new Map([
  ['Query', 'query'],
  ['LiveQuery', 'liveQuery'],
  ['Mutation', 'mutation'],
  ['Action', 'action'],
]);

const diagnosticError = (code, message, details = undefined) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, ...(details === undefined ? {} : { details }) };
  return error;
};

const jsonFile = async (path, code) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError(code, `could not read ${path}`, { path });
    error.cause = cause;
    throw error;
  }
};

export async function loadAppArtifacts(directory) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw diagnosticError('SNAPBACK_APP_CLI_ARTIFACTS_REQUIRED', '--artifacts must name a generated artifact directory');
  }
  const root = resolve(directory);
  const [index, manifest] = await Promise.all([
    jsonFile(resolve(root, 'artifacts.json'), 'SNAPBACK_APP_CLI_ARTIFACT_INDEX_INVALID'),
    jsonFile(resolveGeneratedArtifact(root, 'functions.manifest.json'), 'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID'),
  ]);
  if (
    index?.artifactKind !== 'artifactIndex'
    || manifest?.artifactKind !== 'functionManifest'
    || typeof index.appId !== 'string'
    || index.appId !== manifest.appId
    || !Array.isArray(manifest.functions)
  ) {
    throw diagnosticError(
      'SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH',
      'artifact index and function manifest do not describe the same app',
      { indexAppId: index?.appId ?? null, manifestAppId: manifest?.appId ?? null },
    );
  }
  const functions = manifest.functions.map((fn) => {
    const kind = FUNCTION_KINDS.get(fn?.kind);
    if (!kind || typeof fn?.name !== 'string' || typeof fn?.id !== 'string') {
      throw diagnosticError(
        'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID',
        'function manifest contains an unsupported function entry',
        { function: fn?.name ?? null, kind: fn?.kind ?? null },
      );
    }
    return Object.freeze({
      id: fn.id,
      name: fn.name,
      kind,
      authRequirement: fn.authRequirement ?? null,
      argsSchema: `operations/${fn.name}.args.schema.json`,
    });
  });
  return Object.freeze({
    root,
    appId: index.appId,
    bundleHash: manifest.bundleHash ?? index.bundleHash ?? null,
    functions: Object.freeze(functions),
  });
}

const requestJson = async (baseUrl, path, body) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const diagnostic = payload?.diagnostic ?? {
      code: 'SNAPBACK_APP_CLI_HTTP_FAILED',
      message: `request failed with HTTP ${response.status}`,
    };
    const error = diagnosticError(diagnostic.code, diagnostic.message, diagnostic.details);
    error.status = response.status;
    throw error;
  }
  return payload;
};

export const pairAgent = (baseUrl, {
  credential,
  pairingRequestId,
  pairingCode,
  requestedScopes,
}) => requestJson(baseUrl, '/auth/agents/pair', {
  credential,
  pairingRequestId,
  pairingCode,
  requestedScopes,
});

export const mintAgentToken = (baseUrl, {
  credential,
  pairingRequestId,
  ttlMs = undefined,
}) => requestJson(baseUrl, '/auth/agents/token', {
  credential,
  pairingRequestId,
  ...(ttlMs === undefined ? {} : { ttlMs }),
});

const lookupFunction = (artifacts, name) => {
  const fn = artifacts.functions.find((entry) => entry.name === name);
  if (!fn) {
    throw diagnosticError('SNAPBACK_APP_CLI_FUNCTION_UNKNOWN', `function '${name}' is not in the artifact manifest`, {
      function: name,
      available: artifacts.functions.map((entry) => entry.name),
    });
  }
  return fn;
};

export async function invokeAppFunction(client, artifacts, name, args = {}) {
  const fn = lookupFunction(artifacts, name);
  if (fn.kind === 'liveQuery') {
    throw diagnosticError('SNAPBACK_APP_CLI_CALL_REQUIRES_ORDINARY_FUNCTION', `'${name}' is live; use subscribe`);
  }
  return client[fn.kind === 'mutation' ? 'mutate' : fn.kind](name, { args });
}

export async function subscribeAppFunction(client, artifacts, name, {
  args = {},
  connectionId = 'snapback-app-cli',
} = {}) {
  const fn = lookupFunction(artifacts, name);
  if (fn.kind !== 'liveQuery') {
    throw diagnosticError('SNAPBACK_APP_CLI_SUBSCRIBE_REQUIRES_LIVE_QUERY', `'${name}' is not a live query`);
  }
  return client.subscribeLive(name, { args, connectionId });
}

// Acceptance seam for the packaged outcome: discovery -> pairing -> scoped
// token -> mutation -> subscription -> verification. The token is deliberately
// process-local and never returned. Durable daemon custody remains the separate
// AgentAuthorityFence profile documented by the guide.
export async function runPackagedAgentJourney({
  baseUrl,
  artifactsDirectory,
  credential,
  pairingRequestId,
  pairingCode,
  requestedScopes,
  actorUserId,
  mutation,
  liveQuery,
  verifyQuery,
}) {
  const artifacts = await loadAppArtifacts(artifactsDirectory);
  const pairing = await pairAgent(baseUrl, {
    credential,
    pairingRequestId,
    pairingCode,
    requestedScopes,
  });
  const token = await mintAgentToken(baseUrl, { credential, pairingRequestId });
  const authority = new AgentAuthorityFence({
    actorUserId,
    credentialId: token.credentialId,
    credentialGeneration: token.credentialGeneration,
    grantId: token.grantId,
    tokenId: token.tokenId,
    bearerToken: token.token,
  });
  const client = new SnapbackClient(baseUrl, {
    agentAuthority: authority,
    authInvalidationProtocol: 1,
  });
  const mutated = await invokeAppFunction(client, artifacts, mutation.name, mutation.args);
  const subscribed = await subscribeAppFunction(client, artifacts, liveQuery.name, { args: liveQuery.args });
  const verified = await invokeAppFunction(client, artifacts, verifyQuery.name, verifyQuery.args);
  return Object.freeze({
    appId: artifacts.appId,
    discoveredFunctions: artifacts.functions.length,
    pairingRequestId: pairing.pairingRequestId ?? pairing.id ?? pairingRequestId,
    grantId: token.grantId,
    scopes: token.scopes,
    mutated,
    subscribed,
    verified,
  });
}
