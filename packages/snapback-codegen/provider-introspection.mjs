// Provider-native declaration and Snapback -> Contract projection boundary.
//
// This artifact is consumed by client/tooling generators; the Snapback server
// never parses it. Its package-local schema therefore has an explicit JS
// authority instead of entering the Rust-owned shared-artifact schema set.
//
// @ref LLP 0037#revisit-triggers — client-only artifacts need an explicitly
//   chosen authority rather than being defaulted into the Rust schema set.
// @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop
//   — providers expose neutral introspection; ContractDataManifest is a
//   generated consumer projection, and liveness mismatches fail before runtime.

export const PROVIDER_INTROSPECTION_SCHEMA_VERSION = 'provider-introspection.v1';
export const PROVIDER_ADAPTER_HANDSHAKE_VERSION = 'provider-adapter-handshake.v1';
export const PROVIDER_BINDING_METADATA_SCHEMA_VERSION = 'provider-binding-metadata.v1';
export const CONTRACT_DATA_MANIFEST_VERSION = 2;
const VECTOR_COMPONENT_ABS_MAX = 2 ** 100;

function hasExactVectorComponentBounds(descriptor) {
  return descriptor?.shape === 'primitive'
    && descriptor.name === 'number'
    && descriptor.minimum === -VECTOR_COMPONENT_ABS_MAX
    && descriptor.maximum === VECTOR_COMPONENT_ABS_MAX;
}

const QUERY_KEYS = new Set([
  'name', 'args', 'argOrder', 'reads', 'result', 'serverRunnable',
  'localRunnable', 'retainable', 'subscription', 'mode', 'livePush',
  'initialSnapshot', 'defaultLive', 'ephemeral', 'transport',
  'pollCadenceMs', 'argsHash', 'resultHash', 'resultContract',
  'implementationHash',
]);
const EPHEMERAL_QUERY_KEYS = new Set([
  ...QUERY_KEYS, 'maxDeltaRateHz', 'coalesce', 'keyMode', 'scopeFields',
  'defaultTtlMs', 'maxTtlMs', 'withdrawalVisibilityDeadlineMs',
]);
const MUTATION_KEYS = new Set([
  'name', 'args', 'argOrder', 'writes', 'invalidates', 'optimistic',
  'atomicOptimisticWithholding',
  'plan', 'serverRunnable', 'argsHash', 'resultHash', 'resultContract',
  'implementationHash',
]);
const ACTION_KEYS = new Set([
  'name', 'args', 'argOrder', 'writes', 'serverRunnable', 'argsHash',
  'resultHash', 'resultContract', 'implementationHash',
]);
const EPHEMERAL_SECTION_KEYS = new Set([
  'name', 'ephemeral', 'keyMode', 'scopeFields', 'routingFields',
  'defaultTtlMs', 'maxTtlMs', 'withdrawalVisibilityDeadlineMs', 'deliveryMode', 'maxDeltaRateHz',
  'coalesce', 'publishBudget',
]);
const PUBLISH_BUDGET_KEYS = new Set([
  'sustainedHz', 'burst', 'maxValueBytes',
]);

/**
 * Deterministically derives the neutral declaration from Snapback's native
 * codegen facts. The returned object has recursively sorted object keys and
 * operation arrays sorted by name, so JSON.stringify is byte-stable.
 */
export function createSnapbackProviderIntrospection({
  artifactVersion,
  inputsHash,
  schemaHash,
  bundleHash,
  authoredSourceHash,
  capabilities,
  receipts,
  queries,
  mutations,
  actions = {},
  ephemeral,
}) {
  const queryOperations = [];
  const ephemeralOperations = [];

  for (const [name, binding] of sortedEntries(queries)) {
    if (binding?.ephemeral === true) {
      ephemeralOperations.push(ephemeralOperation(name, binding, ephemeral?.[name]));
    } else {
      queryOperations.push(queryOperation(name, binding));
    }
  }

  const mutationOperations = sortedEntries(mutations).map(([name, binding]) => (
    mutationOperation(name, binding)
  ));
  const actionOperations = sortedEntries(actions).map(([name, binding]) => (
    actionOperation(name, binding)
  ));

  return canonicalize({
    artifactKind: 'providerIntrospection',
    schemaVersion: PROVIDER_INTROSPECTION_SCHEMA_VERSION,
    provider: {
      id: 'snapback',
      version: artifactVersion,
    },
    source: {
      inputsHash,
      schemaHash,
      implementationHash: bundleHash,
      authoredSourceHash,
    },
    capabilities: {
      claims: capabilities,
      receipts: {
        mutation: receipts === 'mutation' || receipts === 'mutation+subscription',
        subscription: receipts === 'mutation+subscription',
      },
    },
    operations: {
      queries: queryOperations,
      mutations: mutationOperations,
      actions: actionOperations,
      ephemeral: ephemeralOperations,
    },
  });
}

/**
 * Projects the neutral declaration onto Exact's ContractDataManifest v2.
 * Exact owns that consumer shape; this function owns only Snapback's mapping.
 */
export function projectContractDataManifest(introspection) {
  const queries = Object.create(null);
  const mutations = Object.create(null);
  const ephemeral = Object.create(null);

  for (const operation of introspection?.operations?.queries ?? []) {
    queries[operation.name] = projectQuery(operation, false);
  }
  for (const operation of introspection?.operations?.mutations ?? []) {
    mutations[operation.name] = projectMutation(operation);
  }
  for (const operation of introspection?.operations?.ephemeral ?? []) {
    queries[operation.name] = projectQuery(operation, true);
    ephemeral[operation.name] = projectEphemeralSection(operation);
  }

  return canonicalize({
    artifactKind: 'contractDataManifest',
    schemaVersion: introspection?.provider?.version,
    manifestVersion: CONTRACT_DATA_MANIFEST_VERSION,
    provider: introspection?.provider?.id,
    inputsHash: introspection?.source?.inputsHash,
    schemaHash: introspection?.source?.schemaHash,
    bundleHash: introspection?.source?.implementationHash,
    authoredSourceHash: introspection?.source?.authoredSourceHash,
    capabilities: introspection?.capabilities?.claims,
    receipts: introspection?.capabilities?.receipts?.subscription === true
      ? 'mutation+subscription'
      : (introspection?.capabilities?.receipts?.mutation === true ? 'mutation' : 'none'),
    queries,
    mutations,
    ephemeral,
  });
}

/**
 * Schema/invariant validation used by codegen before it consumes a provider
 * declaration. It intentionally validates semantic rules JSON Schema cannot:
 * sorted/unique operation identities, complete argument order, and honest
 * primary/fallback transport combinations.
 */
export function validateProviderIntrospection(introspection) {
  const problems = [];
  const add = (path, message) => problems.push(`${path}: ${message}`);

  closedObject(introspection, '$', [
    'artifactKind', 'schemaVersion', 'provider', 'source', 'capabilities',
    'operations', 'extensions',
  ], ['artifactKind', 'schemaVersion', 'provider', 'source', 'capabilities', 'operations'], add);
  if (!isObject(introspection)) return schemaDiagnostics(problems);
  if (introspection.artifactKind !== 'providerIntrospection') {
    add('$.artifactKind', 'must be "providerIntrospection"');
  }
  if (introspection.schemaVersion !== PROVIDER_INTROSPECTION_SCHEMA_VERSION) {
    add('$.schemaVersion', `must be ${JSON.stringify(PROVIDER_INTROSPECTION_SCHEMA_VERSION)}`);
  }

  closedObject(introspection.provider, '$.provider', ['id', 'version'], ['id', 'version'], add);
  nonEmptyString(introspection.provider?.id, '$.provider.id', add);
  nonEmptyString(introspection.provider?.version, '$.provider.version', add);

  closedObject(
    introspection.source,
    '$.source',
    ['inputsHash', 'schemaHash', 'implementationHash', 'authoredSourceHash'],
    ['inputsHash'],
    add,
  );
  nonEmptyString(introspection.source?.inputsHash, '$.source.inputsHash', add);
  for (const key of ['schemaHash', 'implementationHash', 'authoredSourceHash']) {
    if (introspection.source?.[key] !== undefined) {
      nonEmptyString(introspection.source[key], `$.source.${key}`, add);
    }
  }

  validateCapabilities(introspection.capabilities, add);
  closedObject(
    introspection.operations,
    '$.operations',
    ['queries', 'mutations', 'actions', 'ephemeral'],
    ['queries', 'mutations', 'ephemeral'],
    add,
  );

  const seenNames = new Map();
  for (const [kind, validator] of [
    ['queries', validateQuery],
    ['mutations', validateMutation],
    ['actions', validateAction],
    ['ephemeral', validateEphemeral],
  ]) {
    const operations = introspection.operations?.[kind];
    if (kind === 'actions' && operations === undefined) continue;
    if (!Array.isArray(operations)) {
      add(`$.operations.${kind}`, 'must be an array');
      continue;
    }
    const names = [];
    operations.forEach((operation, index) => {
      const path = `$.operations.${kind}[${index}]`;
      validator(operation, path, add);
      if (typeof operation?.name === 'string') {
        names.push(operation.name);
        const prior = seenNames.get(operation.name);
        if (prior) add(`${path}.name`, `duplicates provider binding ${JSON.stringify(operation.name)} from ${prior}`);
        else seenNames.set(operation.name, path);
      }
    });
    const sorted = [...names].sort(compareCodeUnits);
    if (names.some((name, index) => name !== sorted[index])) {
      add(`$.operations.${kind}`, 'must be sorted by name for deterministic generation');
    }
  }

  if (introspection.extensions !== undefined && !isObject(introspection.extensions)) {
    add('$.extensions', 'must be an object');
  }
  return schemaDiagnostics(problems);
}

/**
 * Emit-both guard for the migration: compare an independently assembled
 * ContractDataManifest with the neutral declaration's projection. Any dropped,
 * renamed, or silently defaulted field is reported at a deterministic JSON path.
 */
export function validateContractDataManifestProjection(introspection, actual) {
  const expected = projectContractDataManifest(introspection);
  const problems = jsonDifferences(expected, actual);
  if (problems.length === 0) return [];
  return [{
    code: 'PROVIDER_INTROSPECTION_CONTRACT_MAPPING_MISMATCH',
    severity: 'error',
    subsystem: 'contract',
    message: `provider introspection does not reproduce ContractDataManifest: ${problems[0]}`,
    problems,
  }];
}

export function serializeProviderIntrospection(introspection) {
  return `${JSON.stringify(canonicalize(introspection), null, 2)}\n`;
}

/**
 * Validate the explicit adapter/artifact compatibility tuple before an adapter
 * projects or publishes provider data. Provider versions are deliberately
 * enumerated per producer: accepting the neutral schema does not imply that a
 * consumer understands every backend's artifact version or capabilities.
 */
export function validateProviderAdapterHandshake(introspection, handshake) {
  const problems = [];
  const adapter = handshake?.adapter ?? 'unknown';
  const invalidArtifact = validateProviderIntrospection(introspection);
  for (const diagnostic of invalidArtifact) {
    for (const problem of diagnostic.problems ?? [diagnostic.message]) {
      problems.push(`artifact ${problem}`);
    }
  }

  if (!isObject(handshake)) {
    problems.push('handshake must be an object');
  } else {
    const allowed = new Set([
      'handshakeVersion', 'adapter', 'supportedIntrospectionVersions',
      'supportedProviderVersions', 'requiredCapabilities', 'expectedSource',
    ]);
    for (const key of Object.keys(handshake).sort(compareCodeUnits)) {
      if (!allowed.has(key)) problems.push(`handshake.${key} is not allowed`);
    }
    if (handshake.handshakeVersion !== PROVIDER_ADAPTER_HANDSHAKE_VERSION) {
      problems.push(`handshake.handshakeVersion must be ${JSON.stringify(PROVIDER_ADAPTER_HANDSHAKE_VERSION)}`);
    }
    if (typeof handshake.adapter !== 'string' || handshake.adapter.length === 0) {
      problems.push('handshake.adapter must be a non-empty string');
    }
    if (!stringArray(handshake.supportedIntrospectionVersions)) {
      problems.push('handshake.supportedIntrospectionVersions must be a non-empty string array');
    } else if (!handshake.supportedIntrospectionVersions.includes(introspection?.schemaVersion)) {
      problems.push(`artifact schema version ${describe(introspection?.schemaVersion)} is unsupported`);
    }
    if (!isObject(handshake.supportedProviderVersions)) {
      problems.push('handshake.supportedProviderVersions must be an object');
    } else {
      const providerId = introspection?.provider?.id;
      const supported = handshake.supportedProviderVersions[providerId];
      if (!stringArray(supported)) {
        problems.push(`provider ${describe(providerId)} has no explicit supported version set`);
      } else if (!supported.includes(introspection?.provider?.version)) {
        problems.push(
          `provider ${describe(providerId)} version ${describe(introspection?.provider?.version)} is unsupported`,
        );
      }
    }
    if (handshake.requiredCapabilities !== undefined) {
      if (!stringArray(handshake.requiredCapabilities, { allowEmpty: true })) {
        problems.push('handshake.requiredCapabilities must be a string array');
      } else {
        for (const capability of handshake.requiredCapabilities) {
          if (introspection?.capabilities?.claims?.[capability] !== true) {
            problems.push(`required capability ${JSON.stringify(capability)} is not true`);
          }
        }
      }
    }
    if (handshake.expectedSource !== undefined) {
      if (!isObject(handshake.expectedSource)) {
        problems.push('handshake.expectedSource must be an object');
      } else {
        const allowedSource = new Set(['inputsHash', 'schemaHash', 'implementationHash']);
        for (const key of Object.keys(handshake.expectedSource).sort(compareCodeUnits)) {
          if (!allowedSource.has(key)) {
            problems.push(`handshake.expectedSource.${key} is not allowed`);
          } else if (handshake.expectedSource[key] !== introspection?.source?.[key]) {
            problems.push(
              `source ${key} expected ${describe(handshake.expectedSource[key])}, received ${describe(introspection?.source?.[key])}`,
            );
          }
        }
      }
    }
  }

  if (problems.length === 0) return [];
  return [{
    code: 'PROVIDER_INTROSPECTION_HANDSHAKE_INCOMPATIBLE',
    severity: 'error',
    subsystem: 'contract',
    message: `provider introspection is incompatible with adapter ${JSON.stringify(adapter)}: ${problems[0]}`,
    details: {
      adapter,
      handshakeVersion: handshake?.handshakeVersion ?? null,
      artifactSchemaVersion: introspection?.schemaVersion ?? null,
      provider: introspection?.provider ?? null,
    },
    problems,
  }];
}

export function assertProviderAdapterHandshake(introspection, handshake) {
  const [diagnostic] = validateProviderAdapterHandshake(introspection, handshake);
  if (!diagnostic) return introspection;
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  throw error;
}

/**
 * Close the generated type loop over the provider declaration. Explicit
 * `unknown` shapes remain consumable but carry a stable degraded diagnostic;
 * any shape outside the v1 vocabulary fails and produces no metadata.
 */
export function createProviderBindingMetadata(introspection) {
  const diagnostics = [
    ...validateProviderResultShapeVocabulary(introspection),
    ...validateProviderIntrospection(introspection),
    ...validateProviderBindingTypeNames(introspection),
  ];
  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return { ok: false, diagnostics, metadata: null };
  }

  const bindings = { queries: [], mutations: [], actions: [], ephemeral: [] };
  const renderType = (descriptor, path) => renderDataType(descriptor, path, diagnostics);
  for (const kind of ['queries', 'ephemeral']) {
    for (const operation of introspection.operations[kind]) {
      const args = renderArgumentsType(operation.arguments, `${kind}.${operation.name}.arguments`, diagnostics);
      const result = renderResultType(operation.result, `${kind}.${operation.name}.result`, diagnostics);
      bindings[kind].push(canonicalize({
        name: operation.name,
        argumentsType: args,
        resultType: result,
        delivery: operation.delivery,
        dependencies: operation.dependencies,
      }));
    }
  }
  for (const operation of introspection.operations.mutations) {
    bindings.mutations.push(canonicalize({
      name: operation.name,
      argumentsType: renderArgumentsType(
        operation.arguments,
        `mutations.${operation.name}.arguments`,
        diagnostics,
      ),
      effects: operation.effects,
      optimistic: operation.optimistic,
      resultType: resultTypeFromContract(operation.contract?.result),
    }));
  }
  for (const operation of introspection.operations.actions ?? []) {
    bindings.actions.push(canonicalize({
      name: operation.name,
      argumentsType: renderArgumentsType(
        operation.arguments,
        `actions.${operation.name}.arguments`,
        diagnostics,
      ),
      resultType: resultTypeFromContract(operation.contract?.result),
      effects: operation.effects,
    }));
  }

  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return { ok: false, diagnostics, metadata: null };
  }
  return {
    ok: true,
    diagnostics,
    metadata: canonicalize({
      artifactKind: 'providerBindingMetadata',
      schemaVersion: PROVIDER_BINDING_METADATA_SCHEMA_VERSION,
      provider: introspection.provider,
      source: {
        introspectionSchemaVersion: introspection.schemaVersion,
        inputsHash: introspection.source.inputsHash,
      },
      bindings,
    }),
  };

  function renderResultType(result, path, output) {
    if (result?.kind === 'list') {
      const row = renderType(result.row, `${path}.row`);
      return result.minItems === 1 && result.maxItems === 1
        ? `readonly [${row}]`
        : `ReadonlyArray<${row}>`;
    }
    if (result?.kind === 'single') {
      const value = renderType(result.value, `${path}.value`);
      return result.nullable === true ? `${value} | null` : value;
    }
    if (result?.kind === 'scalar') return renderType(result.value, `${path}.value`);
    output.push(unmappedShapeDiagnostic(path, result?.kind, 'result kind'));
    return 'never';
  }
}

/**
 * Generated TypeScript aliases share one namespace across every operation
 * kind. Provider operation names remain wire identities, so two distinct wire
 * names that normalize to the same alias must be refused rather than silently
 * emitting duplicate declarations.
 */
export function validateProviderBindingTypeNames(introspection) {
  const seen = new Map();
  const problems = [];
  for (const kind of ['queries', 'mutations', 'actions', 'ephemeral']) {
    for (const [index, operation] of (introspection?.operations?.[kind] ?? []).entries()) {
      if (typeof operation?.name !== 'string') continue;
      const alias = pascalIdentifier(operation.name);
      const path = `$.operations.${kind}[${index}].name`;
      const prior = seen.get(alias);
      if (prior) {
        problems.push(
          `${path}: generated alias ${JSON.stringify(alias)} for ${JSON.stringify(operation.name)} collides with ${JSON.stringify(prior.name)} from ${prior.path}`,
        );
      } else {
        seen.set(alias, { name: operation.name, path });
      }
    }
  }
  if (problems.length === 0) return [];
  return [{
    code: 'PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION',
    severity: 'error',
    subsystem: 'contract',
    message: `provider operation names collide after TypeScript alias normalization: ${problems[0]}`,
    problems,
  }];
}

export function validateProviderResultShapeVocabulary(introspection) {
  const problems = [];
  for (const kind of ['queries', 'ephemeral']) {
    for (const [index, operation] of (introspection?.operations?.[kind] ?? []).entries()) {
      inspectResult(operation?.result, `$.operations.${kind}[${index}].result`);
    }
  }
  if (problems.length === 0) return [];
  return [{
    code: 'PROVIDER_INTROSPECTION_RESULT_SHAPE_UNMAPPED',
    severity: 'error',
    subsystem: 'contract',
    message: `provider result shape has no v1 mapping: ${problems[0]}`,
    problems,
  }];

  function inspectResult(result, path) {
    if (result?.kind === 'list') inspectType(result.row, `${path}.row`);
    else if (result?.kind === 'single' || result?.kind === 'scalar') {
      inspectType(result.value, `${path}.value`);
    } else {
      problems.push(`${path}.kind: unmapped ${describe(result?.kind)}`);
    }
  }

  function inspectType(descriptor, path) {
    if (descriptor?.shape === 'unknown') return;
    if (descriptor?.shape === 'primitive') {
      if (!['string', 'number', 'boolean', 'unknown'].includes(descriptor.name)) {
        problems.push(`${path}.name: unmapped ${describe(descriptor.name)}`);
      }
      if (
        (descriptor.minimum !== undefined || descriptor.maximum !== undefined)
        && !hasExactVectorComponentBounds(descriptor)
      ) {
        problems.push(`${path}: numeric bounds must equal the closed vector component domain`);
      }
      return;
    }
    if (descriptor?.shape === 'object' && isObject(descriptor.fields)) {
      for (const [name, field] of Object.entries(descriptor.fields)) {
        inspectType(field, `${path}.fields.${name}`);
      }
      return;
    }
    if (descriptor?.shape === 'literal') {
      if (
        descriptor.value !== null
        && !['string', 'number', 'boolean'].includes(typeof descriptor.value)
      ) {
        problems.push(`${path}.value: unmapped ${describe(descriptor.value)}`);
      }
      return;
    }
    if (descriptor?.shape === 'array') {
      if (descriptor.minItems !== undefined || descriptor.maxItems !== undefined) {
        const min = descriptor.minItems ?? 0;
        const max = descriptor.maxItems;
        if (!Number.isSafeInteger(min) || min < 0
          || !Number.isSafeInteger(max) || max < min || max > 4_096
          || (max > 1_024 && !(
            min === max
            && hasExactVectorComponentBounds(descriptor.items)
          ))) {
          problems.push(`${path}: invalid bounded array descriptor`);
        }
      }
      inspectType(descriptor.items, `${path}.items`);
      return;
    }
    if (
      descriptor?.shape === 'union'
      && Array.isArray(descriptor.variants)
      && descriptor.variants.length >= 2
      && descriptor.variants.length <= 8
    ) {
      descriptor.variants.forEach((variant, index) => (
        inspectType(variant, `${path}.variants[${index}]`)
      ));
      return;
    }
    // @ref LLP 0131#the-search-fixture-cv-5 — a platform schema reference
    // carries its expansion embedded by value; the expansion is an ordinary
    // descriptor and is inspected as one.
    if (descriptor?.shape === 'platformSchemaRef') {
      if (descriptor.authority !== 'platform') {
        problems.push(`${path}.authority: unmapped ${describe(descriptor.authority)}`);
      }
      inspectType(descriptor.expansion, `${path}.expansion`);
      return;
    }
    problems.push(`${path}.shape: unmapped ${describe(descriptor?.shape)}`);
  }
}

export function serializeProviderBindingMetadata(metadata) {
  return `${JSON.stringify(canonicalize(metadata), null, 2)}\n`;
}

export function renderProviderBindingTypes(metadata) {
  assertDistinctRenderedBindingTypeNames(metadata);
  const lines = [
    '// Generated by @expo/snapback-codegen. Do not edit by hand.',
    `export type ProviderBindingMetadataVersion = '${PROVIDER_BINDING_METADATA_SCHEMA_VERSION}';`,
    '',
  ];
  const queryMembers = [];
  const mutationMembers = [];
  const actionMembers = [];
  for (const binding of [
    ...(metadata?.bindings?.queries ?? []),
    ...(metadata?.bindings?.ephemeral ?? []),
  ]) {
    const name = pascalIdentifier(binding.name);
    lines.push(`export type ${name}Args = ${binding.argumentsType};`);
    lines.push(`export type ${name}Result = ${binding.resultType};`);
    queryMembers.push(`  ${JSON.stringify(binding.name)}: { args: ${name}Args; result: ${name}Result };`);
  }
  for (const binding of metadata?.bindings?.mutations ?? []) {
    const name = pascalIdentifier(binding.name);
    lines.push(`export type ${name}Args = ${binding.argumentsType};`);
    lines.push(`export type ${name}Result = ${binding.resultType ?? 'unknown'};`);
    mutationMembers.push(`  ${JSON.stringify(binding.name)}: { args: ${name}Args; result: ${name}Result };`);
  }
  for (const binding of metadata?.bindings?.actions ?? []) {
    const name = pascalIdentifier(binding.name);
    lines.push(`export type ${name}Args = ${binding.argumentsType};`);
    lines.push(`export type ${name}Result = ${binding.resultType ?? 'unknown'};`);
    actionMembers.push(`  ${JSON.stringify(binding.name)}: { args: ${name}Args; result: ${name}Result };`);
  }
  lines.push('', 'export interface ProviderQueryBindings {', ...queryMembers, '}');
  lines.push('export interface ProviderMutationBindings {', ...mutationMembers, '}');
  lines.push('export interface ProviderActionBindings {', ...actionMembers, '}');
  return `${lines.join('\n')}\n`;
}

function assertDistinctRenderedBindingTypeNames(metadata) {
  const seen = new Map();
  for (const kind of ['queries', 'mutations', 'actions', 'ephemeral']) {
    for (const binding of metadata?.bindings?.[kind] ?? []) {
      const alias = pascalIdentifier(binding?.name);
      const prior = seen.get(alias);
      if (prior) {
        const error = new Error(
          `PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION: generated alias ${JSON.stringify(alias)} for ${JSON.stringify(binding?.name)} collides with ${JSON.stringify(prior.name)}`,
        );
        error.code = 'PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION';
        throw error;
      }
      seen.set(alias, binding);
    }
  }
}

function renderArgumentsType(argumentsDescriptor, path, diagnostics) {
  if (!isObject(argumentsDescriptor?.fields)) {
    diagnostics.push(unmappedShapeDiagnostic(`${path}.fields`, argumentsDescriptor?.fields, 'arguments'));
    return 'never';
  }
  return renderObjectFields(argumentsDescriptor.fields, path, diagnostics);
}

function renderDataType(descriptor, path, diagnostics) {
  if (descriptor?.shape === 'unknown') {
    diagnostics.push({
      code: 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED',
      severity: 'warning',
      subsystem: 'contract',
      message: `${path} is explicitly unknown; generated consumers receive unknown`,
      path,
    });
    return 'unknown';
  }
  if (descriptor?.shape === 'primitive') {
    if (['string', 'number', 'boolean'].includes(descriptor.name)) return descriptor.name;
    if (descriptor.name === 'unknown') {
      diagnostics.push({
        code: 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED',
        severity: 'warning',
        subsystem: 'contract',
        message: `${path} is explicitly unknown; generated consumers receive unknown`,
        path,
      });
      return 'unknown';
    }
    diagnostics.push(unmappedShapeDiagnostic(path, descriptor.name, 'primitive'));
    return 'never';
  }
  if (descriptor?.shape === 'object' && isObject(descriptor.fields)) {
    return renderObjectFields(descriptor.fields, path, diagnostics);
  }
  if (descriptor?.shape === 'literal') {
    if (
      descriptor.value === null
      || ['string', 'number', 'boolean'].includes(typeof descriptor.value)
    ) return JSON.stringify(descriptor.value);
    diagnostics.push(unmappedShapeDiagnostic(path, descriptor.value, 'literal'));
    return 'never';
  }
  if (descriptor?.shape === 'array') {
    const array = `ReadonlyArray<${renderDataType(descriptor.items, `${path}.items`, diagnostics)}>`;
    return descriptor.minItems !== undefined && descriptor.minItems === descriptor.maxItems
      ? `${array} & { readonly length: ${descriptor.maxItems} }`
      : array;
  }
  if (
    descriptor?.shape === 'union'
    && Array.isArray(descriptor.variants)
    && descriptor.variants.length >= 2
  ) {
    return descriptor.variants
      .map((variant, index) => renderDataType(
        variant,
        `${path}.variants[${index}]`,
        diagnostics,
      ))
      .join(' | ');
  }
  if (descriptor?.shape === 'platformSchemaRef' && descriptor.authority === 'platform') {
    // The embedded-by-value expansion renders like any other descriptor —
    // the reference stops projecting as `unknown` (LLP 0131 CV-5).
    return renderDataType(descriptor.expansion, `${path}.expansion`, diagnostics);
  }
  diagnostics.push(unmappedShapeDiagnostic(path, descriptor?.shape, 'shape'));
  return 'never';
}

function renderObjectFields(fields, path, diagnostics) {
  const entries = Object.entries(fields).sort(([left], [right]) => compareCodeUnits(left, right));
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, descriptor]) => (
    `${JSON.stringify(name)}${descriptor?.optional === true ? '?' : ''}: ${renderDataType(descriptor, `${path}.${name}`, diagnostics)}`
  )).join('; ')} }`;
}

function unmappedShapeDiagnostic(path, received, className) {
  return {
    code: 'PROVIDER_INTROSPECTION_RESULT_SHAPE_UNMAPPED',
    severity: 'error',
    subsystem: 'contract',
    message: `${path} has unmapped ${className} ${describe(received)}`,
    path,
    received: received ?? null,
  };
}

function pascalIdentifier(value) {
  const rendered = String(value)
    .replace(/(^|[^A-Za-z0-9])([A-Za-z0-9])/g, (_match, _separator, character) => character.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
  return /^[A-Za-z]/.test(rendered) ? rendered : `Binding${rendered}`;
}

function stringArray(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    && new Set(value).size === value.length;
}

function queryOperation(name, binding) {
  return {
    name,
    arguments: argumentsDescriptor(binding),
    result: binding?.result,
    execution: {
      serverRunnable: binding?.serverRunnable === true,
      localRunnable: binding?.localRunnable === true,
    },
    dependencies: { reads: binding?.reads ?? [] },
    delivery: deliveryDescriptor(binding),
    ...(binding?.retainable === true ? { retainable: true } : {}),
    ...(binding?.implementationHash ? { contract: contractWitness(binding) } : {}),
  };
}

function mutationOperation(name, binding) {
  const hasProviderPlan = binding?.plan !== undefined;
  const optimistic = binding?.optimistic === true;
  const snapbackExtensions = {
    ...(hasProviderPlan ? { contractPlan: binding.plan } : {}),
    ...(binding?.atomicOptimisticWithholding === true
      ? { atomicOptimisticWithholding: true }
      : {}),
  };
  return {
    name,
    arguments: argumentsDescriptor(binding),
    execution: {
      serverRunnable: binding?.serverRunnable === true,
      localRunnable: false,
    },
    effects: {
      writes: binding?.writes ?? [],
      invalidates: binding?.invalidates ?? [],
    },
    optimistic: {
      supported: optimistic,
      source: optimistic ? (hasProviderPlan ? 'provider-plan' : 'consumer') : 'none',
    },
    ...(binding?.implementationHash ? { contract: contractWitness(binding) } : {}),
    ...(Object.keys(snapbackExtensions).length > 0
      ? { extensions: { snapback: snapbackExtensions } }
      : {}),
  };
}

function actionOperation(name, binding) {
  return {
    name,
    arguments: argumentsDescriptor(binding),
    execution: {
      serverRunnable: binding?.serverRunnable === true,
      localRunnable: false,
    },
    effects: { writes: binding?.writes ?? [] },
    ...(binding?.implementationHash ? { contract: contractWitness(binding) } : {}),
  };
}

function contractWitness(binding) {
  return {
    revision: 'snapback.result-contract.v1',
    implementationHash: binding?.implementationHash,
    argumentsHash: binding?.argsHash,
    resultHash: binding?.resultHash,
    result: binding?.resultContract,
  };
}

function resultTypeFromContract(contract) {
  if (!contract || contract.kind === 'unknown') return 'unknown';
  if (contract.kind === 'document') return 'Record<string, unknown>';
  if (contract.kind === 'documents' || contract.kind === 'records' || contract.kind === 'legacyQueryRowsV0') {
    return 'ReadonlyArray<Record<string, unknown>>';
  }
  if (contract.kind !== 'value') return 'unknown';
  return resultValueType(contract.value);
}

function resultValueType(value) {
  if (!value) return 'unknown';
  if (value.kind === 'null') return 'null';
  if (value.kind === 'boolean') return 'boolean';
  if (value.kind === 'string' || value.kind === 'principal' || value.kind === 'assetRef' || value.kind === 'id') return 'string';
  if (value.kind === 'mediaRef.v1') {
    return `{ readonly assetId: string; readonly kind: ${value.kinds.map(JSON.stringify).join(' | ')} }`;
  }
  if (value.kind === 'integer' || value.kind === 'finiteReal') return 'number';
  if (value.kind === 'literal') return JSON.stringify(value.value);
  if (value.kind === 'array') return `ReadonlyArray<${resultValueType(value.element)}>`;
  if (value.kind === 'union') return value.variants.map(resultValueType).join(' | ');
  if (value.kind === 'object') {
    return `{ ${value.fields.map((field) => `${JSON.stringify(field.name)}${field.required ? '' : '?'}: ${resultValueType(field.value)}`).join('; ')} }`;
  }
  return 'unknown';
}

function ephemeralOperation(name, binding, section) {
  return {
    name,
    arguments: argumentsDescriptor(binding),
    result: binding?.result,
    execution: {
      serverRunnable: binding?.serverRunnable === true,
      localRunnable: binding?.localRunnable === true,
    },
    delivery: deliveryDescriptor(binding),
    channel: {
      keyMode: section?.keyMode,
      scopeFields: section?.scopeFields,
      routingFields: section?.routingFields,
      defaultTtlMs: section?.defaultTtlMs,
      maxTtlMs: section?.maxTtlMs,
      withdrawalVisibilityDeadlineMs: section?.withdrawalVisibilityDeadlineMs,
      deliveryMode: section?.deliveryMode,
      maxDeltaRateHz: section?.maxDeltaRateHz,
      coalesce: section?.coalesce,
      publish: section?.publishBudget,
    },
  };
}

function argumentsDescriptor(binding) {
  return {
    fields: binding?.args ?? {},
    order: binding?.argOrder ?? [],
  };
}

function deliveryDescriptor(binding) {
  let primaryKind = 'request';
  if (binding?.livePush === true) primaryKind = 'push';
  else if (binding?.mode === 'poll') primaryKind = 'poll';
  else if (binding?.mode === 'reconcile-on-mutate') primaryKind = 'reconcile-on-mutate';

  const primary = { kind: primaryKind, role: 'primary' };
  const transports = [primary];
  if (binding?.pollCadenceMs !== undefined) {
    if (primaryKind === 'poll') primary.cadenceMs = binding.pollCadenceMs;
    else transports.push({ kind: 'poll', role: 'fallback', cadenceMs: binding.pollCadenceMs });
  }
  return {
    mode: binding?.mode,
    initialSnapshot: binding?.initialSnapshot === true,
    defaultLive: binding?.defaultLive === true,
    transports,
  };
}

function projectQuery(operation, isEphemeral) {
  const primary = operation.delivery.transports.find((transport) => transport.role === 'primary');
  const poll = operation.delivery.transports.find((transport) => transport.kind === 'poll');
  const subscription = operation.delivery.mode === 'snapshot'
    ? 'none'
    : (operation.delivery.initialSnapshot ? 'initial-snapshot' : 'change-only');
  const base = {
    name: operation.name,
    args: operation.arguments.fields,
    argOrder: operation.arguments.order,
    result: operation.result,
    serverRunnable: operation.execution.serverRunnable,
    localRunnable: operation.execution.localRunnable,
    subscription,
    mode: operation.delivery.mode,
    livePush: primary?.kind === 'push',
    initialSnapshot: operation.delivery.initialSnapshot,
    defaultLive: operation.delivery.defaultLive,
    ephemeral: isEphemeral,
    ...(operation.contract
      ? {
          implementationHash: operation.contract.implementationHash,
          argsHash: operation.contract.argumentsHash,
          resultHash: operation.contract.resultHash,
          resultContract: operation.contract.result,
        }
      : {}),
  };

  if (isEphemeral) {
    return {
      ...base,
      maxDeltaRateHz: operation.channel.maxDeltaRateHz,
      coalesce: operation.channel.coalesce,
      keyMode: operation.channel.keyMode,
      scopeFields: operation.channel.scopeFields,
      defaultTtlMs: operation.channel.defaultTtlMs,
      maxTtlMs: operation.channel.maxTtlMs,
      withdrawalVisibilityDeadlineMs: operation.channel.withdrawalVisibilityDeadlineMs,
    };
  }
  return {
    ...base,
    reads: operation.dependencies.reads,
    ...(operation.retainable === true ? { retainable: true } : {}),
    ...(primary?.kind !== 'request' ? { transport: primary?.kind } : {}),
    ...(poll?.cadenceMs !== undefined ? { pollCadenceMs: poll.cadenceMs } : {}),
  };
}

function projectMutation(operation) {
  const plan = operation.extensions?.snapback?.contractPlan;
  const atomicOptimisticWithholding =
    operation.extensions?.snapback?.atomicOptimisticWithholding === true;
  return {
    name: operation.name,
    args: operation.arguments.fields,
    argOrder: operation.arguments.order,
    writes: operation.effects.writes,
    invalidates: operation.effects.invalidates,
    optimistic: operation.optimistic.supported,
    ...(atomicOptimisticWithholding ? { atomicOptimisticWithholding: true } : {}),
    ...(operation.contract
      ? {
          implementationHash: operation.contract.implementationHash,
          argsHash: operation.contract.argumentsHash,
          resultHash: operation.contract.resultHash,
          resultContract: operation.contract.result,
        }
      : {}),
    ...(plan !== undefined ? { plan } : {}),
    serverRunnable: operation.execution.serverRunnable,
  };
}

function projectEphemeralSection(operation) {
  return {
    name: operation.name,
    ephemeral: true,
    keyMode: operation.channel.keyMode,
    scopeFields: operation.channel.scopeFields,
    routingFields: operation.channel.routingFields,
    defaultTtlMs: operation.channel.defaultTtlMs,
    maxTtlMs: operation.channel.maxTtlMs,
    withdrawalVisibilityDeadlineMs: operation.channel.withdrawalVisibilityDeadlineMs,
    deliveryMode: operation.channel.deliveryMode,
    maxDeltaRateHz: operation.channel.maxDeltaRateHz,
    coalesce: operation.channel.coalesce,
    publishBudget: operation.channel.publish,
  };
}

function validateCapabilities(capabilities, add) {
  closedObject(capabilities, '$.capabilities', ['claims', 'receipts'], ['claims', 'receipts'], add);
  if (!isObject(capabilities?.claims)) add('$.capabilities.claims', 'must be an object');
  else {
    for (const [name, value] of Object.entries(capabilities.claims)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) add(`$.capabilities.claims.${name}`, 'has an invalid capability id');
      if (typeof value !== 'boolean') add(`$.capabilities.claims.${name}`, 'must be boolean');
    }
  }
  closedObject(capabilities?.receipts, '$.capabilities.receipts', ['mutation', 'subscription'], ['mutation', 'subscription'], add);
  for (const key of ['mutation', 'subscription']) {
    if (typeof capabilities?.receipts?.[key] !== 'boolean') add(`$.capabilities.receipts.${key}`, 'must be boolean');
  }
  if (capabilities?.receipts?.subscription === true && capabilities?.receipts?.mutation !== true) {
    add('$.capabilities.receipts.subscription', 'cannot be true when mutation receipts are false');
  }
}

function validateQuery(operation, path, add) {
  closedObject(operation, path, [
    'name', 'arguments', 'result', 'execution', 'dependencies', 'delivery',
    'retainable', 'extensions', 'contract',
  ], ['name', 'arguments', 'result', 'execution', 'dependencies', 'delivery'], add);
  nonEmptyString(operation?.name, `${path}.name`, add);
  validateArguments(operation?.arguments, `${path}.arguments`, add);
  validateResult(operation?.result, `${path}.result`, add);
  validateExecution(operation?.execution, `${path}.execution`, add);
  closedObject(operation?.dependencies, `${path}.dependencies`, ['reads'], ['reads'], add);
  stringSet(operation?.dependencies?.reads, `${path}.dependencies.reads`, add);
  validateDelivery(operation?.delivery, `${path}.delivery`, add);
  if (operation?.contract !== undefined) {
    validateContractWitness(operation.contract, `${path}.contract`, add);
  }
  if (operation?.retainable !== undefined && typeof operation.retainable !== 'boolean') {
    add(`${path}.retainable`, 'must be boolean');
  }
}

function validateMutation(operation, path, add) {
  closedObject(operation, path, [
    'name', 'arguments', 'execution', 'effects', 'optimistic', 'extensions',
    'contract',
  ], ['name', 'arguments', 'execution', 'effects', 'optimistic'], add);
  nonEmptyString(operation?.name, `${path}.name`, add);
  validateArguments(operation?.arguments, `${path}.arguments`, add);
  validateExecution(operation?.execution, `${path}.execution`, add);
  closedObject(operation?.effects, `${path}.effects`, ['writes', 'invalidates'], ['writes', 'invalidates'], add);
  stringSet(operation?.effects?.writes, `${path}.effects.writes`, add);
  stringSet(operation?.effects?.invalidates, `${path}.effects.invalidates`, add);
  closedObject(operation?.optimistic, `${path}.optimistic`, ['supported', 'source'], ['supported', 'source'], add);
  if (typeof operation?.optimistic?.supported !== 'boolean') add(`${path}.optimistic.supported`, 'must be boolean');
  if (!['none', 'provider-plan', 'consumer'].includes(operation?.optimistic?.source)) {
    add(`${path}.optimistic.source`, 'must be none, provider-plan, or consumer');
  }
  if (operation?.optimistic?.supported === false && operation?.optimistic?.source !== 'none') {
    add(`${path}.optimistic`, 'unsupported optimistic execution must use source "none"');
  }
  if (operation?.optimistic?.source === 'provider-plan' && operation?.extensions?.snapback?.contractPlan === undefined) {
    add(`${path}.extensions.snapback.contractPlan`, 'is required for Snapback provider-plan optimism');
  }
  const atomicOptimisticWithholding =
    operation?.extensions?.snapback?.atomicOptimisticWithholding;
  if (atomicOptimisticWithholding !== undefined && atomicOptimisticWithholding !== true) {
    add(`${path}.extensions.snapback.atomicOptimisticWithholding`, 'must be true when present');
  }
  if (atomicOptimisticWithholding === true && operation?.optimistic?.supported === true) {
    add(`${path}.optimistic.supported`, 'must be false when atomic optimistic withholding is present');
  }
  if (operation?.contract !== undefined) {
    validateContractWitness(operation.contract, `${path}.contract`, add);
  }
}

function validateAction(operation, path, add) {
  closedObject(operation, path, [
    'name', 'arguments', 'execution', 'effects', 'contract', 'extensions',
  ], ['name', 'arguments', 'execution', 'effects'], add);
  nonEmptyString(operation?.name, `${path}.name`, add);
  validateArguments(operation?.arguments, `${path}.arguments`, add);
  validateExecution(operation?.execution, `${path}.execution`, add);
  closedObject(operation?.effects, `${path}.effects`, ['writes'], ['writes'], add);
  stringSet(operation?.effects?.writes, `${path}.effects.writes`, add);
  if (operation?.contract !== undefined) {
    validateContractWitness(operation.contract, `${path}.contract`, add);
  }
}

function validateContractWitness(contract, path, add) {
  closedObject(contract, path, [
    'revision', 'implementationHash', 'argumentsHash', 'resultHash', 'result',
  ], [
    'revision', 'implementationHash', 'argumentsHash', 'resultHash', 'result',
  ], add);
  if (contract?.revision !== 'snapback.result-contract.v1') {
    add(`${path}.revision`, 'must be "snapback.result-contract.v1"');
  }
  for (const key of ['implementationHash', 'argumentsHash', 'resultHash']) {
    if (typeof contract?.[key] !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(contract[key])) {
      add(`${path}.${key}`, 'must be a sha256 digest');
    }
  }
  if (!isObject(contract?.result) || typeof contract.result.kind !== 'string') {
    add(`${path}.result`, 'must be a result contract object');
  }
}

function validateEphemeral(operation, path, add) {
  closedObject(operation, path, [
    'name', 'arguments', 'result', 'execution', 'delivery', 'channel',
    'extensions',
  ], ['name', 'arguments', 'result', 'execution', 'delivery', 'channel'], add);
  nonEmptyString(operation?.name, `${path}.name`, add);
  validateArguments(operation?.arguments, `${path}.arguments`, add);
  validateResult(operation?.result, `${path}.result`, add);
  validateExecution(operation?.execution, `${path}.execution`, add);
  validateDelivery(operation?.delivery, `${path}.delivery`, add);
  closedObject(operation?.channel, `${path}.channel`, [
    'keyMode', 'scopeFields', 'routingFields', 'defaultTtlMs', 'maxTtlMs',
    'withdrawalVisibilityDeadlineMs',
    'deliveryMode', 'maxDeltaRateHz', 'coalesce', 'publish',
  ], [
    'keyMode', 'scopeFields', 'routingFields', 'defaultTtlMs', 'maxTtlMs',
    'withdrawalVisibilityDeadlineMs',
    'deliveryMode', 'maxDeltaRateHz', 'coalesce', 'publish',
  ], add);
  nonEmptyString(operation?.channel?.keyMode, `${path}.channel.keyMode`, add);
  stringSet(operation?.channel?.scopeFields, `${path}.channel.scopeFields`, add);
  stringSet(operation?.channel?.routingFields, `${path}.channel.routingFields`, add);
  positiveInteger(operation?.channel?.defaultTtlMs, `${path}.channel.defaultTtlMs`, add);
  positiveInteger(operation?.channel?.maxTtlMs, `${path}.channel.maxTtlMs`, add);
  positiveInteger(
    operation?.channel?.withdrawalVisibilityDeadlineMs,
    `${path}.channel.withdrawalVisibilityDeadlineMs`,
    add,
  );
  if (operation?.channel?.defaultTtlMs > operation?.channel?.maxTtlMs) {
    add(`${path}.channel.defaultTtlMs`, 'must not exceed maxTtlMs');
  }
  if (
    operation?.channel?.withdrawalVisibilityDeadlineMs
      > Math.floor(operation?.channel?.defaultTtlMs / 2)
  ) {
    add(
      `${path}.channel.withdrawalVisibilityDeadlineMs`,
      'must not exceed defaultTtlMs/2',
    );
  }
  if (operation?.channel?.deliveryMode !== 'latest') add(`${path}.channel.deliveryMode`, 'must be "latest"');
  positiveInteger(operation?.channel?.maxDeltaRateHz, `${path}.channel.maxDeltaRateHz`, add);
  if (typeof operation?.channel?.coalesce !== 'boolean') add(`${path}.channel.coalesce`, 'must be boolean');
  closedObject(operation?.channel?.publish, `${path}.channel.publish`, [
    'sustainedHz', 'burst', 'maxValueBytes',
  ], ['sustainedHz', 'burst', 'maxValueBytes'], add);
  for (const key of ['sustainedHz', 'burst', 'maxValueBytes']) {
    positiveInteger(operation?.channel?.publish?.[key], `${path}.channel.publish.${key}`, add);
  }
}

function validateArguments(args, path, add) {
  closedObject(args, path, ['fields', 'order'], ['fields', 'order'], add);
  if (!isObject(args?.fields)) add(`${path}.fields`, 'must be an object');
  else {
    for (const [name, descriptor] of Object.entries(args.fields)) {
      validateDataType(descriptor, `${path}.fields.${name}`, add);
    }
  }
  stringSet(args?.order, `${path}.order`, add);
  if (isObject(args?.fields) && Array.isArray(args?.order)) {
    const fields = Object.keys(args.fields).sort(compareCodeUnits);
    const order = [...args.order].sort(compareCodeUnits);
    if (fields.length !== order.length || fields.some((name, index) => name !== order[index])) {
      add(`${path}.order`, 'must contain every argument field exactly once');
    }
  }
}

function validateResult(result, path, add) {
  if (!isObject(result)) {
    add(path, 'must be an object');
    return;
  }
  if (result.kind === 'list') {
    closedObject(
      result,
      path,
      ['kind', 'row', 'minItems', 'maxItems'],
      ['kind', 'row'],
      add,
    );
    validateDataType(result.row, `${path}.row`, add);
    if ((result.minItems === undefined) !== (result.maxItems === undefined)) {
      add(path, 'list bounds must provide both minItems and maxItems');
    } else if (result.minItems !== undefined) {
      if (!Number.isSafeInteger(result.minItems) || result.minItems < 0) {
        add(`${path}.minItems`, 'must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(result.maxItems) || result.maxItems > 1_024) {
        add(`${path}.maxItems`, 'must be a safe integer no greater than 1,024');
      }
      if (result.minItems > result.maxItems) {
        add(path, 'list bounds require minItems <= maxItems');
      }
    }
  } else if (result.kind === 'single') {
    closedObject(result, path, ['kind', 'value', 'nullable'], ['kind', 'value', 'nullable'], add);
    validateDataType(result.value, `${path}.value`, add);
    if (typeof result.nullable !== 'boolean') add(`${path}.nullable`, 'must be boolean');
  } else if (result.kind === 'scalar') {
    closedObject(result, path, ['kind', 'value'], ['kind', 'value'], add);
    validateDataType(result.value, `${path}.value`, add);
  } else {
    add(`${path}.kind`, 'must be list, single, or scalar');
  }
}

function validateDataType(descriptor, path, add) {
  if (!isObject(descriptor)) {
    add(path, 'must be a data type descriptor');
    return;
  }
  if (descriptor.shape === 'unknown') {
    closedObject(descriptor, path, ['shape', 'optional'], ['shape'], add);
  } else if (descriptor.shape === 'primitive') {
    closedObject(
      descriptor,
      path,
      ['shape', 'name', 'minimum', 'maximum', 'optional'],
      ['shape', 'name'],
      add,
    );
    if (!['string', 'number', 'boolean', 'unknown'].includes(descriptor.name)) {
      add(`${path}.name`, 'must be string, number, boolean, or unknown');
    }
    if (
      (descriptor.minimum !== undefined || descriptor.maximum !== undefined)
      && !hasExactVectorComponentBounds(descriptor)
    ) {
      add(path, 'numeric bounds must equal the closed vector component domain');
    }
  } else if (descriptor.shape === 'object') {
    closedObject(descriptor, path, ['shape', 'fields', 'optional'], ['shape', 'fields'], add);
    if (!isObject(descriptor.fields)) add(`${path}.fields`, 'must be an object');
    else {
      for (const [name, field] of Object.entries(descriptor.fields)) {
        validateDataType(field, `${path}.fields.${name}`, add);
      }
    }
  } else if (descriptor.shape === 'literal') {
    closedObject(descriptor, path, ['shape', 'value', 'optional'], ['shape', 'value'], add);
    if (
      descriptor.value !== null
      && !['string', 'number', 'boolean'].includes(typeof descriptor.value)
    ) {
      add(`${path}.value`, 'must be a finite scalar or null');
    } else if (typeof descriptor.value === 'number' && !Number.isFinite(descriptor.value)) {
      add(`${path}.value`, 'must be finite');
    }
  } else if (descriptor.shape === 'array') {
    closedObject(
      descriptor,
      path,
      ['shape', 'items', 'minItems', 'maxItems', 'optional'],
      ['shape', 'items'],
      add,
    );
    if (descriptor.minItems !== undefined || descriptor.maxItems !== undefined) {
      const min = descriptor.minItems ?? 0;
      const max = descriptor.maxItems;
      if (!Number.isSafeInteger(min) || min < 0
        || !Number.isSafeInteger(max) || max < min || max > 4_096
        || (max > 1_024 && !(
          min === max
          && hasExactVectorComponentBounds(descriptor.items)
        ))) {
        add(path, 'has invalid array bounds');
      }
    }
    validateDataType(descriptor.items, `${path}.items`, add);
  } else if (descriptor.shape === 'union') {
    closedObject(
      descriptor,
      path,
      ['shape', 'variants', 'optional'],
      ['shape', 'variants'],
      add,
    );
    if (
      !Array.isArray(descriptor.variants)
      || descriptor.variants.length < 2
      || descriptor.variants.length > 8
    ) {
      add(`${path}.variants`, 'must contain 2–8 data type descriptors');
    } else {
      descriptor.variants.forEach((variant, index) => (
        validateDataType(variant, `${path}.variants[${index}]`, add)
      ));
    }
  } else if (descriptor.shape === 'platformSchemaRef') {
    // @ref LLP 0131#the-argument-contract-descriptor — closed authority
    // enum (exactly `platform` in v1), closed registry id, and the
    // expansion embedded by value as an ordinary descriptor.
    closedObject(
      descriptor,
      path,
      ['shape', 'authority', 'schema', 'expansion', 'optional'],
      ['shape', 'authority', 'schema', 'expansion'],
      add,
    );
    if (descriptor.authority !== 'platform') {
      add(`${path}.authority`, 'must be platform');
    }
    if (descriptor.schema !== 'snapback:search-query-ast:v1') {
      add(`${path}.schema`, 'must name a registered platform schema');
    }
    validateDataType(descriptor.expansion, `${path}.expansion`, add);
  } else {
    add(`${path}.shape`, 'must be unknown, primitive, object, literal, array, union, or platformSchemaRef');
  }
  if (descriptor.optional !== undefined && typeof descriptor.optional !== 'boolean') {
    add(`${path}.optional`, 'must be boolean');
  }
}

function validateExecution(execution, path, add) {
  closedObject(execution, path, ['serverRunnable', 'localRunnable'], ['serverRunnable', 'localRunnable'], add);
  for (const key of ['serverRunnable', 'localRunnable']) {
    if (typeof execution?.[key] !== 'boolean') add(`${path}.${key}`, 'must be boolean');
  }
}

function validateDelivery(delivery, path, add) {
  closedObject(delivery, path, [
    'mode', 'initialSnapshot', 'defaultLive', 'transports',
  ], ['mode', 'initialSnapshot', 'defaultLive', 'transports'], add);
  if (!['snapshot', 'live', 'poll', 'reconcile-on-mutate'].includes(delivery?.mode)) {
    add(`${path}.mode`, 'must be snapshot, live, poll, or reconcile-on-mutate');
  }
  for (const key of ['initialSnapshot', 'defaultLive']) {
    if (typeof delivery?.[key] !== 'boolean') add(`${path}.${key}`, 'must be boolean');
  }
  if (!Array.isArray(delivery?.transports) || delivery.transports.length === 0) {
    add(`${path}.transports`, 'must be a non-empty array');
    return;
  }
  let primaryCount = 0;
  const pairs = new Set();
  for (const [index, transport] of delivery.transports.entries()) {
    const transportPath = `${path}.transports[${index}]`;
    closedObject(transport, transportPath, ['kind', 'role', 'cadenceMs'], ['kind', 'role'], add);
    if (!['request', 'push', 'poll', 'reconcile-on-mutate'].includes(transport?.kind)) {
      add(`${transportPath}.kind`, 'has an unsupported transport kind');
    }
    if (!['primary', 'fallback'].includes(transport?.role)) add(`${transportPath}.role`, 'must be primary or fallback');
    if (transport?.role === 'primary') primaryCount += 1;
    const pair = `${transport?.kind}:${transport?.role}`;
    if (pairs.has(pair)) add(transportPath, `duplicates transport ${pair}`);
    pairs.add(pair);
    if (transport?.kind === 'poll') positiveInteger(transport.cadenceMs, `${transportPath}.cadenceMs`, add);
    else if (transport?.cadenceMs !== undefined) add(`${transportPath}.cadenceMs`, 'is only valid for poll');
  }
  if (primaryCount !== 1) add(`${path}.transports`, 'must contain exactly one primary transport');
  const primary = delivery.transports.find((transport) => transport?.role === 'primary');
  if (delivery.mode === 'snapshot') {
    if (primary?.kind !== 'request') add(`${path}.transports`, 'snapshot delivery must use request as its primary transport');
    if (delivery.initialSnapshot !== false) add(`${path}.initialSnapshot`, 'must be false for snapshot delivery');
    if (delivery.defaultLive !== false) add(`${path}.defaultLive`, 'must be false for snapshot delivery');
  } else if (delivery.mode === 'live' && primary?.kind !== 'push') {
    add(`${path}.transports`, 'live delivery must use push as its primary transport');
  } else if (delivery.mode === 'poll' && primary?.kind !== 'poll') {
    add(`${path}.transports`, 'poll delivery must use poll as its primary transport');
  } else if (delivery.mode === 'reconcile-on-mutate' && primary?.kind !== 'reconcile-on-mutate') {
    add(`${path}.transports`, 'reconcile-on-mutate delivery must use the matching primary transport');
  }
  if (primary?.kind === 'poll' && delivery.transports.some((transport) => transport?.kind === 'push')) {
    add(`${path}.transports`, 'a polling provider cannot also claim push for the same operation');
  }
}

function closedObject(value, path, allowed, required, add) {
  if (!isObject(value)) {
    add(path, 'must be an object');
    return;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    if (!allowedSet.has(key)) add(`${path}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) add(`${path}.${key}`, 'is required');
  }
}

function nonEmptyString(value, path, add) {
  if (typeof value !== 'string' || value.length === 0) add(path, 'must be a non-empty string');
}

function positiveInteger(value, path, add) {
  if (!Number.isSafeInteger(value) || value <= 0) add(path, 'must be a positive integer');
}

function stringSet(value, path, add) {
  if (!Array.isArray(value)) {
    add(path, 'must be an array');
    return;
  }
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    nonEmptyString(entry, `${path}[${index}]`, add);
    if (seen.has(entry)) add(`${path}[${index}]`, `duplicates ${JSON.stringify(entry)}`);
    seen.add(entry);
  }
}

function schemaDiagnostics(problems) {
  if (problems.length === 0) return [];
  return [{
    code: 'PROVIDER_INTROSPECTION_SCHEMA_INVALID',
    severity: 'error',
    subsystem: 'contract',
    message: `provider introspection is invalid: ${problems[0]}`,
    schema: 'packages/snapback-codegen/provider-introspection.schema.json',
    problems,
  }];
}

function jsonDifferences(expected, actual, path = '$', output = []) {
  if (Object.is(expected, actual)) return output;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      output.push(`${path}: expected ${describe(expected)}, received ${describe(actual)}`);
      return output;
    }
    if (expected.length !== actual.length) {
      output.push(`${path}.length: expected ${expected.length}, received ${actual.length}`);
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= expected.length) output.push(`${path}[${index}]: unexpected ${describe(actual[index])}`);
      else if (index >= actual.length) output.push(`${path}[${index}]: missing ${describe(expected[index])}`);
      else jsonDifferences(expected[index], actual[index], `${path}[${index}]`, output);
    }
    return output;
  }
  if (isObject(expected) || isObject(actual)) {
    if (!isObject(expected) || !isObject(actual)) {
      output.push(`${path}: expected ${describe(expected)}, received ${describe(actual)}`);
      return output;
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort(compareCodeUnits)) {
      if (!Object.hasOwn(expected, key)) output.push(`${path}.${key}: unexpected ${describe(actual[key])}`);
      else if (!Object.hasOwn(actual, key)) output.push(`${path}.${key}: missing ${describe(expected[key])}`);
      else jsonDifferences(expected[key], actual[key], `${path}.${key}`, output);
    }
    return output;
  }
  output.push(`${path}: expected ${describe(expected)}, received ${describe(actual)}`);
  return output;
}

function describe(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  const output = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    if (value[key] !== undefined) output[key] = canonicalize(value[key]);
  }
  return output;
}

function sortedEntries(value) {
  return Object.entries(value ?? {}).sort(([left], [right]) => compareCodeUnits(left, right));
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Detect Snapback fields the v1 producer does not yet map. These are reported
 * separately from semantic schema problems so a new backend shape can never
 * disappear silently during projection.
 */
export function validateSnapbackIntrospectionSource({ queries, mutations, actions = {}, ephemeral }) {
  const problems = [];
  for (const [name, binding] of sortedEntries(queries)) {
    const allowed = binding?.ephemeral === true ? EPHEMERAL_QUERY_KEYS : QUERY_KEYS;
    unexpectedKeys(binding, allowed, `queries.${name}`, problems);
  }
  for (const [name, binding] of sortedEntries(mutations)) {
    unexpectedKeys(binding, MUTATION_KEYS, `mutations.${name}`, problems);
  }
  for (const [name, binding] of sortedEntries(actions)) {
    unexpectedKeys(binding, ACTION_KEYS, `actions.${name}`, problems);
  }
  for (const [name, section] of sortedEntries(ephemeral)) {
    unexpectedKeys(section, EPHEMERAL_SECTION_KEYS, `ephemeral.${name}`, problems);
    unexpectedKeys(section?.publishBudget, PUBLISH_BUDGET_KEYS, `ephemeral.${name}.publishBudget`, problems);
  }
  if (problems.length === 0) return [];
  return [{
    code: 'PROVIDER_INTROSPECTION_SNAPBACK_SOURCE_UNMAPPED',
    severity: 'error',
    subsystem: 'contract',
    message: `Snapback provider facts are not mapped into introspection: ${problems[0]}`,
    problems,
  }];
}

function unexpectedKeys(value, allowed, path, output) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    if (!allowed.has(key)) output.push(`${path}.${key}`);
  }
}
