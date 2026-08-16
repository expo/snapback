import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AgentAuthorityFence } from '@expo/snapback-client';
import { SnapbackAppDataClient } from '@expo/snapback-client/app-data';
import { resolveGeneratedArtifact } from '@expo/snapback-codegen/review-surface';
import { validateFunctionArgs } from './arguments.mjs';
import {
  mintAgentToken as mintInvocationAgentToken,
  pairAgentGrant,
  releaseAgentToken,
} from './auth.mjs';

// @ref LLP 0062#1-engine-plus-data-never-program-source--served-or-generated —
// local phase 1 discovers the app surface from inert generated JSON and never
// imports generated api.mjs or handler source.

const FUNCTION_KINDS = new Map([
  ['Query', 'query'],
  ['LiveQuery', 'liveQuery'],
  ['Mutation', 'mutation'],
  ['Action', 'action'],
]);
const FUNCTION_REFERENCE_KINDS = Object.freeze(Object.fromEntries(
  [...FUNCTION_KINDS].map(([referenceKind, clientKind]) => [clientKind, referenceKind]),
));

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

const optionalJsonFile = async (path, code) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
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
  const [index, manifest, schemaManifest, capabilityManifest, envelopeMembers, apiDeclarations] = await Promise.all([
    jsonFile(resolve(root, 'artifacts.json'), 'SNAPBACK_APP_CLI_ARTIFACT_INDEX_INVALID'),
    jsonFile(resolveGeneratedArtifact(root, 'functions.manifest.json'), 'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID'),
    optionalJsonFile(
      resolveGeneratedArtifact(root, 'schema.manifest.json'),
      'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID',
    ),
    optionalJsonFile(
      resolveGeneratedArtifact(root, 'capability.manifest.json'),
      'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID',
    ),
    optionalJsonFile(
      resolveGeneratedArtifact(root, 'api-envelope.members.json'),
      'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID',
    ),
    readFile(resolveGeneratedArtifact(root, 'api.d.ts'), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }),
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
  const functions = await Promise.all(manifest.functions.map(async (fn) => {
    const kind = FUNCTION_KINDS.get(fn?.kind);
    if (!kind || typeof fn?.name !== 'string' || typeof fn?.id !== 'string') {
      throw diagnosticError(
        'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID',
        'function manifest contains an unsupported function entry',
        { function: fn?.name ?? null, kind: fn?.kind ?? null },
      );
    }
    const argsSchemaPath = resolveGeneratedArtifact(root, `operations/${fn.name}.args.schema.json`);
    const argsSchema = await jsonFile(
      argsSchemaPath,
      'SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID',
    );
    return Object.freeze({
      id: fn.id,
      name: fn.name,
      kind,
      authRequirement: fn.authRequirement ?? 'optional-user',
      argsSchema,
      argsContract: fn.argsContract ?? null,
      resultContract: fn.resultContract ?? null,
      readSetSummary: fn.readSetSummary ?? null,
      writeSetSummary: fn.writeSetSummary ?? null,
      requiredCapabilities: Object.freeze([...(fn.requiredCapabilities ?? [])].sort()),
    });
  }));
  // @ref LLP 0062#1-engine-plus-data-never-program-source--served-or-generated —
  // call-time generation binding: when the artifact index carries the complete
  // generated artifact identity, every call this engine makes asserts it, so a
  // deploy between discovery and dispatch refuses server-side instead of
  // executing against a surface the arguments were not validated for. An index
  // predating the identity fields keeps the server's legacy unchecked path.
  const GENERATION_KEYS = ['schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash'];
  const generation = GENERATION_KEYS.every(
    (key) => typeof index[key] === 'string' && index[key].length > 0,
  )
    ? Object.freeze(Object.fromEntries(GENERATION_KEYS.map((key) => [key, index[key]])))
    : null;
  return Object.freeze({
    root,
    appId: index.appId,
    bundleHash: manifest.bundleHash ?? index.bundleHash ?? null,
    generation,
    schemaManifest,
    capabilityManifest,
    appBindings: envelopeMembers?.declarations?.appBindings ?? null,
    apiDeclarations,
    functions: Object.freeze(functions),
  });
}

export const pairAgent = (baseUrl, {
  credential,
  pairingRequestId,
  pairingCode,
  requestedScopes,
}) => pairAgentGrant(baseUrl, {
  credential,
  pairingRequestId,
  pairingCode,
  requestedScopes,
});

export const mintAgentToken = (baseUrl, {
  credential,
  pairingRequestId,
  ttlMs = undefined,
}) => mintInvocationAgentToken(baseUrl, {
  credential,
  pairingRequestId,
  ...(ttlMs === undefined ? {} : { ttlMs }),
});

const releasePackagedAgentToken = releaseAgentToken;

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

// The client's call families accept either a bare name (the server's legacy
// unchecked path) or a selector carrying the generated artifact identity; the
// engine always sends the identity when the loaded index provides one.
const functionSelector = (artifacts, fn) => (artifacts.generation === null
  ? fn.name
  : Object.freeze({
      artifactKind: 'functionReference',
      name: fn.name,
      kind: FUNCTION_REFERENCE_KINDS[fn.kind],
      expectedGeneration: artifacts.generation,
      ...(fn.argsContract == null ? {} : { argsContract: fn.argsContract }),
      argumentSchema: fn.argsSchema,
    }));

// An offline served surface exists for `--help`/`introspect`/`types` only
// (LLP 0062 §5): cached identity may describe a deployment that has since
// rotated, so it never shapes a live call.
const refuseOfflineSurface = (artifacts) => {
  if (artifacts.offline === true) {
    throw diagnosticError(
      'SNAPBACK_APP_CLI_OFFLINE_CACHED_SURFACE',
      'the cached served surface answers introspection only; reconnect to call functions',
    );
  }
};

export async function invokeAppFunction(client, artifacts, name, args = {}) {
  refuseOfflineSurface(artifacts);
  const fn = lookupFunction(artifacts, name);
  validateFunctionArgs(fn, args);
  if (fn.kind === 'liveQuery') {
    throw diagnosticError('SNAPBACK_APP_CLI_CALL_REQUIRES_ORDINARY_FUNCTION', `'${name}' is live; use subscribe`);
  }
  return client[fn.kind === 'mutation' ? 'mutate' : fn.kind](functionSelector(artifacts, fn), { args });
}

export async function subscribeAppFunction(client, artifacts, name, {
  args = {},
  connectionId = 'snapback-app-cli',
} = {}) {
  refuseOfflineSurface(artifacts);
  const fn = lookupFunction(artifacts, name);
  validateFunctionArgs(fn, args);
  if (fn.kind !== 'liveQuery') {
    throw diagnosticError('SNAPBACK_APP_CLI_SUBSCRIBE_REQUIRES_LIVE_QUERY', `'${name}' is not a live query`);
  }
  return client.subscribeLive(functionSelector(artifacts, fn), { args, connectionId });
}

export function startAppFunctionLive(client, artifacts, name, {
  args = {},
  connectionId = 'snapback-app-cli',
  ...options
} = {}) {
  refuseOfflineSurface(artifacts);
  const fn = lookupFunction(artifacts, name);
  validateFunctionArgs(fn, args);
  if (fn.kind !== 'liveQuery') {
    throw diagnosticError('SNAPBACK_APP_CLI_SUBSCRIBE_REQUIRES_LIVE_QUERY', `'${name}' is not a live query`);
  }
  if (typeof client.startLiveQuery !== 'function') {
    throw diagnosticError('SNAPBACK_APP_CLI_VERSION_MISMATCH', 'the installed app-data client lacks managed live-query support');
  }
  return client.startLiveQuery(functionSelector(artifacts, fn), {
    ...options,
    args,
    connectionId,
  });
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
  // @ref LLP 0062#position-among-existing-surfaces — the engine constructs
  // the app-data-only façade, not the full client: no admin methods and no
  // ambient SNAPBACK_ADMIN_TOKEN pickup, by construction.
  const client = new SnapbackAppDataClient(baseUrl, {
    agentAuthority: authority,
    authInvalidationProtocol: 1,
  });
  try {
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
  } finally {
    await releasePackagedAgentToken(baseUrl, token.token).catch(async () => {
      await releasePackagedAgentToken(baseUrl, token.token).catch(() => {});
    });
  }
}

// Served-envelope ingestion (LLP 0062 §5; ticket 0062-02 step 4): discovery,
// content-addressed fetch, client-side verification, and the bounded cache.
export {
  discoverServedApp,
  fetchServedEnvelope,
  loadServedApp,
  verifyEnvelopeBytes,
  // The `app-cli.target` eligibility descriptor (LLP 0062 §4): read
  // credential-free from discovery, before any principal is selected.
  PRINCIPAL_CLASSES,
  targetDescriptor,
  targetAdmitsPrincipal,
  refuseUnadmittedPrincipal,
  readCachedEnvelope,
  storeCachedEnvelope,
  defaultCacheDir,
  envelopeDigest,
  memberDigest,
  jcsCanonical,
} from './envelope.mjs';

export {
  AGENT_DIGEST_CURSOR_PREFIX,
  AGENT_DIGEST_FORMAT_VERSION,
  DEFAULT_DIGEST_BUDGET_BYTES,
  DEFAULT_DIGEST_BUDGET_ITEMS,
  buildAgentDigest,
  canonicalJson as canonicalDigestJson,
  parseDigestCursor,
} from './digest.mjs';

// The shared result core and frozen exit taxonomy (LLP 0024 amendment;
// LLP 0062 §2). Projections consume these and never re-derive semantics.
export {
  EXIT,
  RESULT_CORE_ARTIFACT_KIND,
  RESULT_CORE_FORMAT_VERSION,
  CALL_RESULT_ARTIFACT_KIND,
  CALL_RESULT_FORMAT_VERSION,
  buildResultCore,
  classifyDiagnosticExit,
  diagnosticRecord,
  resultExitCode,
  wrapCallResult,
} from './result-core.mjs';

export {
  PRINCIPAL,
  SESSION_BEARER_ENV,
  AGENT_PROFILE_ENV,
  AGENT_PROFILE_FORMAT_VERSION,
  DEFAULT_AGENT_TOKEN_TTL_MS,
  DEFAULT_AGENT_ADMISSION_WAIT_MS,
  assertSupportedHost,
  normalizeTargetOrigin,
  isLiteralLoopbackOrigin,
  readAgentProfile,
  readPrivateSecretFile,
  readCredentialReference,
  selectPrincipal,
  assertPrincipalAdmitted,
  preflightFunctionPrincipal,
  mintAgentToken as mintInvocationAgentToken,
  releaseAgentToken,
  pairAgentGrant,
  defaultAuthorityRoot,
  acquireAgentAdmission,
  principalClient,
  writeAgentProfile,
  onboardAgentProfile,
} from './auth.mjs';

export {
  CODE_MODE_PROTOCOL_VERSION,
  CODE_MODE_TRANSFORM,
  CODE_MODE_DEFAULTS,
  CODE_MODE_MAXIMA,
  CODE_MODE_HAZARDOUS_ALIASES_V1,
  codeModeBindings,
  assertStrictCodeModeValue,
  runCodeMode,
  renderCodeModeTypes,
} from './code-mode.mjs';

export { validateFunctionArgs } from './arguments.mjs';
