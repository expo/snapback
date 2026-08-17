import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { compileResultContractValidator } from '@expo/snapback-contract/result-contract-validator';
import { queryArtifactHash, sha256 as sha256PureJs } from './rqs.mjs';

// Failure-only and development-only React binding admission. Keeping the
// complete HMR re-admission path behind a literal dynamic import prevents its
// result-contract compiler and RQS hashing machinery from riding every
// production React entry closure.
// @ref LLP 0114#mounted-provider-hmr-generation-handoff-dated-amendment-2026-08-05

const utf8 = new TextEncoder();

function diagnosticError(code, message, details = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = diagnostic;
  return error;
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle?.digest
    ? new Uint8Array(await subtle.digest('SHA-256', bytes))
    : sha256PureJs(bytes);
  return `sha256:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function resultContractHash(value) {
  const canonicalJson = (input) => JSON.stringify(input, (_key, child) => (
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
      : child
  ));
  return sha256Hex(utf8.encode(
    `snapback:function-result:v1\n${canonicalJson(value)}`,
  ));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function publicReference(
  definition,
  fallbackAppId,
  fallbackSchemaVersion,
  expectedGeneration,
) {
  const reference = {
    artifactKind: 'functionReference',
    schemaVersion: definition?.schemaVersion ?? fallbackSchemaVersion,
    appId: definition?.appId ?? fallbackAppId,
    id: definition?.id,
    name: definition?.name ?? definition?.exportedName,
    kind: definition?.kind,
    implementationHash: definition?.implementationHash,
    argsContractHash: definition?.argsContractHash,
    argsContract: definition?.argsContract === undefined
      ? undefined
      : deepFreeze(structuredClone(definition.argsContract)),
    argumentSchema: definition?.argumentSchema === undefined
      ? undefined
      : deepFreeze(structuredClone(definition.argumentSchema)),
    resultContractHash: definition?.resultContractHash,
    ...(definition?.authoredSourceHash === undefined ? {} : {
      authoredSourceHash: definition.authoredSourceHash,
    }),
    expectedGeneration,
  };
  for (const field of [
    'artifactKind',
    'schemaVersion',
    'appId',
    'id',
    'name',
    'kind',
    'implementationHash',
    'argsContractHash',
    'resultContractHash',
  ]) {
    if (typeof reference[field] !== 'string' || reference[field].length === 0) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `generated function ${reference.name ?? '<unknown>'} is missing ${field}`,
        { field, function: reference.name ?? null },
      );
    }
  }
  return Object.freeze(reference);
}

function exactDeploymentFunction(definition) {
  return [
    definition.id,
    definition.kind,
    definition.implementationHash,
    definition.argsContractHash,
    definition.resultContractHash,
  ].join('\u0000');
}

async function rebuiltGenerationAdmission(
  binding,
  deployed,
  targetGeneration,
  referenceSchemaVersion,
) {
  if (!Array.isArray(deployed.functions)) {
    throw diagnosticError(
      'SNAPBACK_REACT_MANIFEST_INVALID',
      'deployed function manifest is incomplete',
    );
  }
  const references = Object.create(null);
  const referencesById = new Map();
  const resultContractsById = new Map();
  const queryArtifactsById = new Map();
  const authorityIndependentById = new Map();
  for (const definition of deployed.functions) {
    const reference = publicReference(
      definition,
      binding.appId,
      referenceSchemaVersion ?? deployed.schemaVersion,
      targetGeneration,
    );
    if (reference.appId !== binding.appId) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `deployed function ${reference.name} names a foreign app`,
        { functionId: reference.id },
      );
    }
    if (Object.prototype.hasOwnProperty.call(references, reference.name)) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `deployed manifest repeats function name ${reference.name}`,
      );
    }
    const descriptor = deepFreeze(
      structuredClone(definition.resultContract ?? { kind: 'unknown' }),
    );
    const validator = compileResultContractValidator(descriptor);
    if (await resultContractHash(descriptor) !== reference.resultContractHash) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `deployed result contract for ${reference.name} does not match its hash`,
        { functionId: reference.id },
      );
    }
    references[reference.name] = reference;
    referencesById.set(reference.id, reference);
    queryArtifactsById.set(reference.id, queryArtifactHash(definition));
    authorityIndependentById.set(
      reference.id,
      definition.rqsEligible === true || definition.authorityIndependent === true,
    );
    resultContractsById.set(reference.id, Object.freeze({
      hash: reference.resultContractHash,
      descriptor,
      validator,
    }));
  }
  Object.freeze(references);
  return {
    references,
    referencesById,
    resultContractsById,
    queryArtifactsById,
    authorityIndependentById,
  };
}

async function attemptGenerationRebind({
  binding,
  inspection,
  target,
  referenceSchemaVersion,
  publishOverlay,
}) {
  const deployed = inspection?.functions;
  if (!deployed || typeof deployed !== 'object') {
    return { ok: false, terminal: false, reason: 'deployment-not-current' };
  }
  if (deployed.appId !== binding.appId) {
    return { ok: false, terminal: true, reason: 'deployed-app-mismatch' };
  }
  const identity = {
    schemaHash: inspection.schema?.schemaHash ?? null,
    bundleHash: deployed.bundleHash,
    inputsHash: deployed.inputsHash ?? null,
  };
  if (
    identity.bundleHash !== target.bundleHash
    || identity.schemaHash !== target.schemaHash
    || identity.inputsHash !== target.inputsHash
  ) {
    return { ok: false, terminal: false, reason: 'deployment-not-current' };
  }
  if (
    binding.routesManifest !== null
    && inspection.routeManifestHash !== binding.routeManifestHash
  ) {
    return { ok: false, terminal: true, reason: 'route-manifest-changed' };
  }
  try {
    const deployedCollections = Array.isArray(inspection.schema?.ephemeralCollections)
      ? inspection.schema.ephemeralCollections
      : [];
    const currentDefinitions = [...binding.ephemeralDefinitionsById.values()];
    if (currentDefinitions.length > 0 || deployedCollections.length > 0) {
      const byName = new Map(
        deployedCollections.map((definition) => [definition?.name, definition]),
      );
      const unchanged = currentDefinitions.length === byName.size
        && currentDefinitions.every(({ definition }) => {
          const next = byName.get(definition.name);
          return next !== undefined
            && canonicalizeClientValueV1(next) === canonicalizeClientValueV1(definition);
        });
      if (!unchanged) {
        return { ok: false, terminal: true, reason: 'ephemeral-collections-changed' };
      }
    }
  } catch {
    return { ok: false, terminal: true, reason: 'ephemeral-collections-changed' };
  }
  let admission;
  try {
    admission = await rebuiltGenerationAdmission(
      binding,
      deployed,
      target,
      referenceSchemaVersion,
    );
  } catch (error) {
    return {
      ok: false,
      terminal: true,
      reason: 'deployed-manifest-invalid',
      cause: error?.code ?? String(error),
    };
  }
  for (const group of binding.queryGroupsById.values()) {
    for (const child of group.queries) {
      const next = admission.referencesById.get(child.ref.id);
      if (!next || exactDeploymentFunction(next) !== exactDeploymentFunction(child.ref)) {
        return {
          ok: false,
          terminal: true,
          reason: 'query-group-child-changed',
          groupId: group.id,
        };
      }
    }
  }
  const overlay = Object.freeze({
    deploymentIdentity: Object.freeze({
      ...binding.deploymentIdentity,
      schemaHash: identity.schemaHash,
      bundleHash: identity.bundleHash,
      inputsHash: identity.inputsHash,
    }),
    ...admission,
  });
  publishOverlay(overlay);
  return { ok: true, terminal: false, generation: overlay.deploymentIdentity };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runPreparedReactBindingGenerationHandoff({
  binding,
  target,
  budget,
  referenceSchemaVersion,
  publishOverlay,
}) {
  const deadline = Date.now() + budget.timeoutMs;
  let lastOutcome = { ok: false, reason: 'deployment-not-current' };
  for (;;) {
    let inspection = null;
    try {
      inspection = await binding.client.inspect();
    } catch {
      // Unreachable/mid-restart local backend: keep waiting inside the budget.
    }
    if (inspection !== null && inspection !== undefined) {
      let outcome;
      try {
        outcome = await attemptGenerationRebind({
          binding,
          inspection,
          target,
          referenceSchemaVersion,
          publishOverlay,
        });
      } catch (error) {
        outcome = {
          ok: false,
          terminal: true,
          reason: 'deployed-manifest-invalid',
          cause: error?.code ?? String(error),
        };
      }
      if (outcome.ok || outcome.terminal) {
        const { terminal: _terminal, ...settled } = outcome;
        return settled;
      }
      lastOutcome = { ok: false, reason: outcome.reason };
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return lastOutcome;
    await sleep(Math.min(budget.pollIntervalMs, Math.max(0, remainingMs)));
  }
}
