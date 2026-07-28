import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { compileResultContractValidator } from '@snapback/contract/result-contract-validator';

// @ref LLP 0102#prepared-binding-and-provider-ownership — asynchronous
// deployment admission is completed before a synchronous React provider may
// be constructed.

const PREPARED_REACT_BINDING = Symbol('snapback.prepared-react-binding.v1');
const PREPARED_REACT_QUERY_GROUP = Symbol('snapback.prepared-react-query-group.v1');
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

async function sha256Text(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8.encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function resultContractHash(value) {
  const canonicalJson = (input) => JSON.stringify(input, (_key, child) => (
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
      : child
  ));
  const bytes = utf8.encode(
    `snapback:function-result:v1\n${canonicalJson(value)}`,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
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
    schema: input?.artifactKind === 'functionManifest'
      ? null
      : input?.schema ?? null,
    capabilityManifest: input?.artifactKind === 'functionManifest'
      ? null
      : input?.capabilityManifest ?? null,
    routes: input?.artifactKind === 'functionManifest'
      ? null
      : input?.routes ?? null,
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

function queryGroupEntryName(functionName, occurrences) {
  const count = (occurrences.get(functionName) ?? 0) + 1;
  occurrences.set(functionName, count);
  return count === 1 ? functionName : `${functionName}${count}`;
}

function routeParams(route) {
  if (route === '/') return [];
  return route.slice(1).split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

function materializeGroupArgs(mapping, params) {
  const output = {};
  for (const [name, value] of Object.entries(mapping ?? {})) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value).length === 1
      && typeof value.$param === 'string'
    ) {
      output[name] = params[value.$param];
    } else {
      output[name] = structuredClone(value);
    }
  }
  return deepFreeze(output);
}

function groupEntryKey(functionName, args) {
  return `${functionName}\u0000${canonicalizeClientValueV1(args)}`;
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
  const resultContractsById = new Map();
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
    const descriptor = deepFreeze(
      structuredClone(definition.resultContract ?? { kind: 'unknown' }),
    );
    let validator;
    try {
      validator = compileResultContractValidator(descriptor);
    } catch (error) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
        `generated result contract for ${reference.name} is not admissible`,
        { functionId: reference.id, cause: error?.code ?? String(error) },
      );
    }
    if (
      canonicalizeClientValueV1(actual.resultContract ?? { kind: 'unknown' })
        !== canonicalizeClientValueV1(descriptor)
      || await resultContractHash(descriptor) !== reference.resultContractHash
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
        `generated result contract for ${reference.name} does not match its deployment and hash`,
        { functionId: reference.id },
      );
    }
    resultContractsById.set(reference.id, Object.freeze({
      hash: reference.resultContractHash,
      descriptor,
      validator,
    }));
  }
  const ephemeralReferences = Object.create(null);
  const ephemeralDefinitionsById = new Map();
  if (generated.schema !== null) {
    if (
      generated.schema?.artifactKind !== 'schemaManifest'
      || generated.schema.appId !== generated.functions.appId
      || generated.schema.schemaHash !== inspection.schema?.schemaHash
      || !Array.isArray(generated.schema.ephemeralCollections)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
        'generated schema manifest does not match the connected deployment',
        {
          expectedSchemaHash: generated.schema?.schemaHash ?? null,
          actualSchemaHash: inspection.schema?.schemaHash ?? null,
        },
      );
    }
    const deployedCollections = new Map(
      (inspection.schema?.ephemeralCollections ?? []).map((definition) => [
        definition.name,
        definition,
      ]),
    );
    for (const definition of generated.schema.ephemeralCollections) {
      const deployedDefinition = deployedCollections.get(definition.name);
      if (
        !deployedDefinition
        || canonicalizeClientValueV1(deployedDefinition)
          !== canonicalizeClientValueV1(definition)
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_BINDING_MISMATCH',
          `generated ephemeral collection ${definition.name} does not match the connected deployment`,
          { collection: definition.name },
        );
      }
      const reference = Object.freeze({
        artifactKind: 'ephemeralCollectionReference',
        schemaVersion: generated.schema.schemaVersion,
        appId: generated.schema.appId,
        id: `${generated.schema.appId}:ephemeral:${definition.name}`,
        name: definition.name,
        keyMode: definition.keyMode,
        scopeFields: Object.freeze([...definition.scopeFields]),
        routingFields: Object.freeze([...definition.routingFields]),
        defaultTtlMs: definition.defaultTtlMs,
        maxTtlMs: definition.maxTtlMs,
        maxValueBytes: definition.maxValueBytes,
        publishRate: Object.freeze({
          sustainedHz: definition.sustainedHz,
          burst: definition.burst,
        }),
        deliveryMode: 'latest',
      });
      let scopeValidator;
      let valueValidator;
      try {
        scopeValidator = compileResultContractValidator({
          kind: 'value',
          value: definition.scopeContract,
        });
        valueValidator = compileResultContractValidator({
          kind: 'value',
          value: definition.valueContract,
        });
      } catch (error) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          `generated ephemeral collection ${definition.name} has an invalid scope or value contract`,
          { collection: definition.name, cause: error?.code ?? String(error) },
        );
      }
      ephemeralReferences[definition.name] = reference;
      ephemeralDefinitionsById.set(reference.id, Object.freeze({
        reference,
        definition: deepFreeze(structuredClone(definition)),
        staticPolicyDigest: await sha256Canonical(definition),
        scopeValidator,
        valueValidator,
      }));
    }
  }
  const queryGroups = Object.create(null);
  const queryGroupsById = new Map();
  if (generated.routes !== null) {
    if (
      generated.routes?.formatVersion !== 1
      || generated.routes.app !== generated.functions.appId
      || !Array.isArray(generated.routes.routes)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        'generated routes manifest does not match the prepared app',
      );
    }
    for (const routeEntry of generated.routes.routes) {
      if (
        typeof routeEntry?.route !== 'string'
        || !Array.isArray(routeEntry.queries)
        || routeEntry.queries.length < 1
        || routeEntry.queries.length > 32
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          'generated routes manifest contains an invalid query group',
          { route: routeEntry?.route ?? null },
        );
      }
      const occurrences = new Map();
      const queries = [];
      for (const query of routeEntry.queries) {
        const reference = references[query?.function];
        if (!reference || !['Query', 'LiveQuery'].includes(reference.kind)) {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'generated query group names an unknown or non-query function',
            { route: routeEntry.route, function: query?.function ?? null },
          );
        }
        queries.push(Object.freeze({
          name: queryGroupEntryName(reference.name, occurrences),
          ref: reference,
          args: deepFreeze(structuredClone(query.args ?? {})),
        }));
      }
      const definition = {
        route: routeEntry.route,
        queries: routeEntry.queries,
        ...(routeEntry.persist === false ? { persist: false } : {}),
      };
      const reference = Object.freeze({
        artifactKind: 'queryGroupReference',
        formatVersion: 1,
        schemaVersion: generated.functions.schemaVersion,
        appId: generated.functions.appId,
        id: `${generated.functions.appId}:query-group:${routeEntry.route}`,
        route: routeEntry.route,
        definitionHash: await sha256Text(
          `snapback:query-group-reference:v1\n${canonicalizeClientValueV1(definition)}`,
        ),
        queries: Object.freeze(queries),
        ...(routeEntry.persist === false ? { persist: false } : {}),
      });
      queryGroups[routeEntry.route] = reference;
      queryGroupsById.set(reference.id, reference);
    }
  }
  Object.freeze(references);
  Object.freeze(ephemeralReferences);
  Object.freeze(queryGroups);
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
    ephemeral: ephemeralReferences,
    groups: queryGroups,
    prepareQueryGroup(reference, params, groupOptions) {
      return prepareReactQueryGroupForBinding(binding, reference, params, groupOptions);
    },
  };
  Object.defineProperties(binding, {
    [PREPARED_REACT_BINDING]: { value: true },
    client: { value: client },
    referencesById: { value: referencesById },
    resultContractsById: { value: resultContractsById },
    ephemeralDefinitionsById: { value: ephemeralDefinitionsById },
    queryGroupsById: { value: queryGroupsById },
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

export function admittedReactQueryGroup(binding, reference) {
  const prepared = assertPreparedReactBinding(binding);
  const expected = prepared.queryGroupsById.get(reference?.id);
  if (
    !reference
    || reference.artifactKind !== 'queryGroupReference'
    || !expected
    || canonicalizeClientValueV1(expected) !== canonicalizeClientValueV1(reference)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REFERENCE_INVALID',
      'React query-group preparation requires a complete generated group reference',
      { groupId: reference?.id ?? null },
    );
  }
  return expected;
}

export function isPreparedReactQueryGroup(value) {
  return value?.[PREPARED_REACT_QUERY_GROUP] === true;
}

// @ref LLP 0090#d12-snapshot-bundle-fetch — register mode creates every
// closed child subscription at the same commit cut; React adopts those exact
// registrations rather than racing a manual prime against later live work.
// @ref LLP 0102#bundle-primed-generated-query-groups — bundle acquisition is
// pre-mount and group-scoped; hooks never arm registrations in an effect.
export async function prepareReactQueryGroupForBinding(
  binding,
  reference,
  params = {},
  { fallbackToLive = false, userId } = {},
) {
  const prepared = assertPreparedReactBinding(binding);
  const admitted = admittedReactQueryGroup(prepared, reference);
  const nonLive = admitted.queries.find((query) => query.ref.kind !== 'LiveQuery');
  if (nonLive) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REFERENCE_INVALID',
      'React query groups contain live-query references only',
      { groupId: admitted.id, functionId: nonLive.ref.id, kind: nonLive.ref.kind },
    );
  }
  canonicalizeClientValueV1(params);
  const expectedParams = routeParams(admitted.route).sort();
  const actualParams = Object.keys(params).sort();
  if (
    expectedParams.length !== actualParams.length
    || expectedParams.some((name, index) => name !== actualParams[index])
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_PARAMS_INVALID',
      'query-group params must exactly cover the generated route parameters',
      { expected: expectedParams, actual: actualParams },
    );
  }
  const entries = admitted.queries.map((query) => Object.freeze({
    name: query.name,
    ref: query.ref,
    args: materializeGroupArgs(query.args, params),
    registeredSubscription: null,
  }));
  const makePrepared = ({ source, boot = null, connectionId = null, resolvedEntries = entries }) => {
    const result = {
      artifactKind: 'preparedReactQueryGroup',
      source,
      reference: admitted,
      params: deepFreeze(structuredClone(params)),
      connectionId,
      boot,
      entries: Object.freeze(resolvedEntries),
    };
    Object.defineProperty(result, PREPARED_REACT_QUERY_GROUP, { value: true });
    return Object.freeze(result);
  };
  let bundle;
  try {
    bundle = await prepared.client.fetchBundle({
      route: admitted.route,
      params,
      mode: 'register',
      ...(userId === undefined ? {} : { userId }),
    });
  } catch (error) {
    const code = error?.diagnostic?.code ?? error?.code ?? '';
    if (fallbackToLive && String(code).startsWith('SNAPBACK_BUNDLE_')) {
      return makePrepared({ source: 'live-fallback' });
    }
    throw error;
  }
  if (
    !Number.isSafeInteger(bundle?.commitVersion)
    || bundle.commitVersion < 0
    || typeof bundle.generation !== 'string'
    || bundle.generation.length === 0
    || typeof bundle.versionStream !== 'string'
    || bundle.versionStream.length === 0
    || typeof bundle.connection?.connectionId !== 'string'
    || bundle.connection.connectionId.length === 0
    || !Array.isArray(bundle.entries)
    || bundle.entries.length !== entries.length
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
      'register-mode query-group bundle is incomplete',
      { groupId: admitted.id },
    );
  }
  const received = new Map();
  for (const entry of bundle.entries) {
    const key = groupEntryKey(entry?.function, entry?.args ?? {});
    if (received.has(key)) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
        'register-mode query-group bundle repeats a child',
        { groupId: admitted.id, function: entry?.function ?? null },
      );
    }
    received.set(key, entry);
  }
  const resolvedEntries = entries.map((entry) => {
    const response = received.get(groupEntryKey(entry.ref.name, entry.args));
    if (
      !response
      || typeof response.subscriptionId !== 'string'
      || response.subscriptionId.length === 0
      || !Array.isArray(response.rows)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
        'register-mode query-group bundle does not exactly match its generated children',
        { groupId: admitted.id, function: entry.ref.name },
      );
    }
    return Object.freeze({
      ...entry,
      registeredSubscription: Object.freeze({
        subscriptionId: response.subscriptionId,
        rows: deepFreeze(structuredClone(response.rows)),
        version: bundle.commitVersion,
        resume: response.resume && typeof response.resume.token === 'string'
          ? deepFreeze(structuredClone(response.resume))
          : null,
      }),
    });
  });
  if (received.size !== resolvedEntries.length) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
      'register-mode query-group bundle contains an unexpected child',
      { groupId: admitted.id },
    );
  }
  return makePrepared({
    source: 'registered-bundle',
    connectionId: bundle.connection.connectionId,
    boot: Object.freeze({
      source: 'registered-bundle',
      commitVersion: bundle.commitVersion,
      generation: bundle.generation,
      versionStream: bundle.versionStream,
    }),
    resolvedEntries,
  });
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

export function preparedReactResultContract(binding, reference) {
  const admitted = admittedReactReference(binding, reference, reference?.kind);
  return assertPreparedReactBinding(binding).resultContractsById.get(admitted.id) ?? null;
}

export function admittedReactEphemeralDefinition(binding, reference) {
  const prepared = assertPreparedReactBinding(binding);
  const expected = prepared.ephemeralDefinitionsById.get(reference?.id);
  if (
    !reference
    || reference.artifactKind !== 'ephemeralCollectionReference'
    || !expected
    || canonicalizeClientValueV1(expected.reference)
      !== canonicalizeClientValueV1(reference)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      'React presence requires a complete generated ephemeral collection reference admitted by this binding',
      { collectionId: reference?.id ?? null },
    );
  }
  if (expected.reference.keyMode !== 'Connection') {
    throw diagnosticError(
      'SNAPBACK_REACT_PRESENCE_KEY_MODE_UNSUPPORTED',
      'React presence v1 supports connection-owned ephemeral collections only',
      { collectionId: expected.reference.id, keyMode: expected.reference.keyMode },
    );
  }
  return expected;
}
