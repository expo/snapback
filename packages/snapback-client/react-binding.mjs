import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';

// @ref LLP 0102#prepared-binding-and-provider-ownership — asynchronous
// deployment admission is completed before a synchronous React provider may
// be constructed.

const PREPARED_REACT_BINDING = Symbol('snapback.prepared-react-binding.v1');
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

async function sha256Canonical(value) {
  const bytes = utf8.encode(canonicalizeClientValueV1(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function publicReference(definition, fallbackAppId, fallbackSchemaVersion) {
  const reference = {
    artifactKind: 'functionReference',
    schemaVersion: definition?.schemaVersion ?? fallbackSchemaVersion,
    appId: definition?.appId ?? fallbackAppId,
    id: definition?.id,
    name: definition?.name ?? definition?.exportedName,
    kind: definition?.kind,
    implementationHash: definition?.implementationHash,
    argsContractHash: definition?.argsContractHash,
    resultContractHash: definition?.resultContractHash,
  };
  for (const field of Object.keys(reference)) {
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

function normalizedManifest(input) {
  const functions = input?.artifactKind === 'functionManifest'
    ? input
    : input?.functions;
  if (
    !functions
    || functions.artifactKind !== 'functionManifest'
    || typeof functions.appId !== 'string'
    || typeof functions.bundleHash !== 'string'
    || !Array.isArray(functions.functions)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_MANIFEST_INVALID',
      'prepareReactBinding requires a complete generated function manifest',
    );
  }
  return Object.freeze({
    functions,
    capabilityManifest: input?.artifactKind === 'functionManifest'
      ? null
      : input?.capabilityManifest ?? null,
  });
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

export async function prepareReactBindingForClient(client, options = {}) {
  if (!client || typeof client.inspect !== 'function' || typeof client.liveQuery !== 'function') {
    throw new TypeError('prepareReactBinding requires a SnapbackClient');
  }
  const generated = normalizedManifest(options.generatedManifest);
  const [inspection, session] = await Promise.all([
    client.inspect(),
    typeof client.authSession === 'function'
      ? client.authSession()
      : Promise.resolve(null),
  ]);
  const deployed = inspection?.functions;
  if (
    deployed?.appId !== generated.functions.appId
    || deployed?.bundleHash !== generated.functions.bundleHash
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_BINDING_MISMATCH',
      'generated manifest does not match the connected deployment',
      {
        expectedAppId: generated.functions.appId,
        actualAppId: deployed?.appId ?? null,
        expectedBundleHash: generated.functions.bundleHash,
        actualBundleHash: deployed?.bundleHash ?? null,
      },
    );
  }
  const deployedFunctions = new Map(
    (deployed.functions ?? []).map((definition) => [definition.id, definition]),
  );
  const references = Object.create(null);
  const referencesById = new Map();
  for (const definition of generated.functions.functions) {
    const reference = publicReference(
      definition,
      generated.functions.appId,
      generated.functions.schemaVersion,
    );
    const actual = deployedFunctions.get(reference.id);
    if (!actual || exactDeploymentFunction(actual) !== exactDeploymentFunction(reference)) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
        `generated reference ${reference.name} does not match the connected deployment`,
        { functionId: reference.id },
      );
    }
    if (Object.prototype.hasOwnProperty.call(references, reference.name)) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `generated manifest repeats function name ${reference.name}`,
      );
    }
    references[reference.name] = reference;
    referencesById.set(reference.id, reference);
  }
  Object.freeze(references);
  const functionCatalogDigest = await sha256Canonical(Object.values(references));
  const capabilityDigest = await sha256Canonical(inspection.capabilityManifest);
  if (generated.capabilityManifest) {
    const declaredProfile = generated.capabilityManifest.targetProfileId;
    if (declaredProfile && declaredProfile !== inspection.targetProfileId) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
        'generated capability profile does not match the connected deployment',
        { expectedProfile: declaredProfile, actualProfile: inspection.targetProfileId ?? null },
      );
    }
  }
  const deploymentIdentity = Object.freeze({
    targetProfileId: inspection.targetProfileId,
    target: inspection.target,
    schemaHash: inspection.schema?.schemaHash ?? null,
    bundleHash: deployed.bundleHash,
    inputsHash: deployed.inputsHash ?? null,
  });
  const binding = {
    appId: generated.functions.appId,
    profile: inspection.targetProfileId,
    deploymentIdentity,
    authMode: session?.activeMode ?? null,
    functionCatalogDigest,
    capabilityDigest,
    references,
  };
  Object.defineProperties(binding, {
    [PREPARED_REACT_BINDING]: { value: true },
    client: { value: client },
    referencesById: { value: referencesById },
  });
  return Object.freeze(binding);
}

export function assertPreparedReactBinding(binding) {
  if (binding?.[PREPARED_REACT_BINDING] === true) return binding;
  throw diagnosticError(
    'SNAPBACK_REACT_BINDING_REQUIRED',
    'SnapbackProvider requires the result of client.prepareReactBinding()',
  );
}

export function preparedReactBindingClient(binding) {
  return assertPreparedReactBinding(binding).client;
}

export function admittedReactReference(binding, reference, expectedKind) {
  const prepared = assertPreparedReactBinding(binding);
  if (!reference || typeof reference !== 'object') {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      'React hooks require a generated function reference',
    );
  }
  const admitted = prepared.referencesById.get(reference.id);
  const complete = admitted && exactDeploymentFunction(admitted) === exactDeploymentFunction(reference);
  if (!complete || admitted.appId !== prepared.appId) {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      'generated function reference was not admitted by this prepared binding',
      { functionId: reference.id ?? null },
    );
  }
  const expected = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
  if (!expected.includes(admitted.kind)) {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      `expected ${expected.join('/')} reference, received ${admitted.kind}`,
      { functionId: admitted.id, kind: admitted.kind },
    );
  }
  return admitted;
}
