// Semantic application-generation identity and immutable envelope custody.
//
// This module is intentionally independent from the legacy inputsHash /
// schemaHash / bundleHash machinery. Rollout 1 dual-emits these identities;
// no existing request, activation, or staleness consumer reads them yet.

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseJavaScript } from 'acorn';
import ts from 'typescript';

export const APPLICATION_GENERATION_SCHEMA_VERSION = 'snapback.application-generation.v1';
export const GENERATION_INTEGRITY_SCHEMA_VERSION = 'snapback.application-generation-integrity.v1';
export const LATEST_EMITTED_SCHEMA_VERSION = 'snapback.latest-emitted-generation.v1';
export const SEMANTIC_IDENTITY_SCHEMA_VERSION = 'snapback.semantic-identity.v1';
export const NORMALIZED_DEFINITION_SCHEMA_VERSION = 'snapback.normalized-application-definition.v1';
export const EXPLICIT_AUTHORING_PROFILE = 'snapback-explicit-v1';
export const FAMILIAR_AUTHORING_PROFILE = 'snapback-familiar-ts-v1';

export const GENERATION_HASH_DOMAINS = Object.freeze({
  semanticId: 'snapback:application-generation:semantic:v1',
  executableId: 'snapback:application-generation:executable:v1',
  evidenceId: 'snapback:application-generation:evidence:v1',
  bundleId: 'snapback:application-generation:bundle:v1',
  generationId: 'snapback:application-generation:root:v1',
  normalizedContractId: 'snapback:normalized-application-definition:contract:v1',
  normalizedSchemaId: 'snapback:normalized-application-definition:schema:v1',
});

export const GENERATION_ENVELOPE_CUSTODY = Object.freeze({
  class: 'gitignored-cache',
  authority: '@expo/snapback-codegen',
  regeneration: 'content-addressed-reemit',
  rationale: 'The envelope is an immutable local build cache over generated members; reviewed source and committed artifact projections remain the reproducible authorities.',
});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const OMIT_AST_KEYS = new Set(['start', 'end', 'loc', 'range', 'raw']);

export function canonicalGenerationJson(value, indent = 0) {
  const normalize = (entry) => {
    if (typeof entry === 'bigint') return { $bigint: entry.toString() };
    if (entry instanceof RegExp) return { $regexp: { source: entry.source, flags: entry.flags } };
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      const output = Object.create(null);
      for (const key of Object.keys(entry).sort(compareCodeUnits)) output[key] = normalize(entry[key]);
      return output;
    }
    if (entry === undefined) throw generationError('CODEGEN_WRITE_FAILED', 'identity inputs cannot contain undefined values');
    if (typeof entry === 'number' && !Number.isFinite(entry)) {
      throw generationError('CODEGEN_WRITE_FAILED', 'identity inputs cannot contain non-finite numbers');
    }
    return entry;
  };
  return JSON.stringify(normalize(value), null, indent);
}

export function generationDomainHash(domain, value) {
  if (typeof domain !== 'string' || domain.length === 0) {
    throw generationError('CODEGEN_WRITE_FAILED', 'identity domain must be a non-empty string');
  }
  return `sha256:${createHash('sha256')
    .update(`${domain}\n`, 'utf8')
    .update(canonicalGenerationJson(value), 'utf8')
    .digest('hex')}`;
}

export function canonicalExecutableSource(source) {
  if (typeof source !== 'string') {
    throw generationError('CODEGEN_WRITE_FAILED', 'runtime source must be a string');
  }
  let tree;
  try {
    tree = parseCanonicalExecutableSource(source);
  } catch (cause) {
    throw generationError(
      'CODEGEN_WRITE_FAILED',
      `runtime source could not be canonicalized: ${cause.message}`,
      {},
      cause,
    );
  }
  const stripEvidence = (entry) => {
    if (typeof entry === 'bigint') return { $bigint: entry.toString() };
    if (entry instanceof RegExp) return { $regexp: { source: entry.source, flags: entry.flags } };
    if (Array.isArray(entry)) return entry.map(stripEvidence);
    if (entry && typeof entry === 'object') {
      const output = Object.create(null);
      for (const key of Object.keys(entry).sort(compareCodeUnits)) {
        if (OMIT_AST_KEYS.has(key)) continue;
        output[key] = stripEvidence(entry[key]);
      }
      return output;
    }
    return entry;
  };
  return canonicalGenerationJson(stripEvidence(tree));
}

function parseCanonicalExecutableSource(source) {
  const parseOptions = {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowAwaitOutsideFunction: true,
  };
  try {
    return parseJavaScript(source, parseOptions);
  } catch (javaScriptCause) {
    // @ref LLP 0241#d1-split-identity-by-what-changed — TypeScript types stay
    // in source evidence while the type-erased executable AST owns behavior.
    // TypeScript handler files are an admitted IbexModule source form. Erase
    // their non-executable syntax with the same pinned compiler family used by
    // authoring admission, then canonicalize the resulting JavaScript AST.
    // Diagnostics remain fatal: this fallback broadens syntax coverage without
    // turning an unparseable runtime body into an identity-free success.
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        removeComments: true,
        newLine: ts.NewLineKind.LineFeed,
      },
      fileName: 'runtime.ts',
      reportDiagnostics: true,
    });
    const diagnostic = (transpiled.diagnostics ?? []).find(
      ({ category }) => category === ts.DiagnosticCategory.Error,
    );
    if (diagnostic) {
      const location = Number.isInteger(diagnostic.start)
        ? ts.getLineAndCharacterOfPosition(
            ts.createSourceFile(
              'runtime.ts',
              source,
              ts.ScriptTarget.Latest,
              false,
              ts.ScriptKind.TS,
            ),
            diagnostic.start,
          )
        : null;
      const where = location ? ` (${location.line + 1}:${location.character + 1})` : '';
      throw new SyntaxError(
        `${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}${where}`,
        { cause: javaScriptCause },
      );
    }
    try {
      return parseJavaScript(transpiled.outputText, parseOptions);
    } catch (transpiledCause) {
      throw new SyntaxError(
        `TypeScript emitted invalid JavaScript: ${transpiledCause.message}`,
        { cause: transpiledCause },
      );
    }
  }
}

export function canonicalHandlerGraphRecord(record) {
  const nodes = [...(record?.nodes ?? [])]
    .map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      name: node.name,
      normalizedTarget: node.normalizedTarget,
      moduleFormat: node.moduleFormat,
      canonicalExecutableAstDigest: node.canonicalExecutableAstDigest,
    }))
    .sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId));
  const edges = [...(record?.edges ?? [])]
    .map((edge) => ({
      importerNodeId: edge.importerNodeId,
      targetNodeId: edge.targetNodeId,
      normalizedTarget: edge.normalizedTarget,
      resolution: edge.resolution,
    }))
    .sort((left, right) => (
      compareCodeUnits(left.importerNodeId, right.importerNodeId)
      || compareCodeUnits(left.targetNodeId, right.targetNodeId)
      || compareCodeUnits(left.normalizedTarget, right.normalizedTarget)
    ));
  return {
    schemaVersion: record?.schemaVersion,
    extractorVersion: record?.extractorVersion,
    admissionVersion: record?.admissionVersion,
    moduleFormat: record?.moduleFormat,
    root: {
      nodeId: record?.root?.nodeId,
      name: record?.root?.name,
      normalizedTarget: record?.root?.normalizedTarget,
    },
    nodes,
    edges,
    graphTopologyDigest: record?.graphTopologyDigest,
  };
}

function executableOperation(operation) {
  const runtime = operation?.runtime ?? {};
  return {
    operationId: operation?.id,
    operation: operation?.name,
    operationKind: operation?.kind,
    handlerForm: operation?.handlerForm,
    entrypoint: operation?.bundleEntrypoint,
    runtime: runtime.IbexModule
      ? {
          kind: 'IbexModule',
          export: runtime.IbexModule.export,
          canonicalRuntimeAst: canonicalExecutableSource(runtime.IbexModule.source ?? ''),
        }
      : { kind: 'HostPlan', plan: runtime.HostPlan ?? null },
  };
}

function semanticOperation(operation) {
  return {
    operationId: operation?.id,
    operation: operation?.name,
    operationKind: operation?.kind,
    args: operation?.argsContract ?? null,
    result: operation?.resultContract ?? null,
    authority: {
      authRequirement: operation?.authRequirement ?? null,
      authorizationDependence: operation?.authorizationDependence ?? [],
      authorityIndependent: operation?.authorityIndependent === true,
      authorityCreating: operation?.authorityCreating === true,
      fieldBoundary: operation?.fieldBoundary ?? null,
    },
    reads: operation?.readSetSummary ?? null,
    writes: operation?.writeSetSummary ?? null,
    effects: operation?.effectCeiling ?? null,
    capabilities: [...(operation?.requiredCapabilities ?? [])].sort(compareCodeUnits),
    apiExposure: operation?.apiExposure ?? null,
    refusals: [...(operation?.refusals ?? [])].sort(compareCodeUnits),
    trackedRefusals: [...(operation?.trackedRefusals ?? [])].sort(compareCodeUnits),
    syncabilityClass: operation?.syncabilityClass ?? null,
    retention: {
      retainable: operation?.retainable === true,
      retentionClass: operation?.retentionClass ?? null,
    },
    behavior: executableOperation(operation),
  };
}

function canonicalClone(value) {
  return JSON.parse(canonicalGenerationJson(value));
}

function sortedCanonicalValues(values) {
  return [...(values ?? [])]
    .map(canonicalClone)
    .sort((left, right) => compareCodeUnits(
      canonicalGenerationJson(left),
      canonicalGenerationJson(right),
    ));
}

function normalizedApplicationSchema(schemaManifest) {
  return canonicalClone({
    version: schemaManifest?.schemaVersion ?? null,
    auth: schemaManifest?.auth ?? null,
    authProgram: schemaManifest?.authProgram ?? null,
    api: schemaManifest?.api ?? null,
    assets: schemaManifest?.assets ?? null,
    pushSeam: schemaManifest?.pushSeam ?? null,
    strictDeclarations: schemaManifest?.strictDeclarations === true,
    requiredCapabilities: [...(schemaManifest?.requiredCapabilities ?? [])]
      .sort(compareCodeUnits),
    ephemeralCollections: schemaManifest?.ephemeralCollections ?? [],
    // Index declarations remain inside their canonical table records. This is
    // deliberately the same schema block shape semanticInput already uses.
    tables: schemaManifest?.tables ?? [],
    portabilityFlags: schemaManifest?.portabilityFlags ?? [],
  });
}

function normalizedRoutes(routesManifest) {
  if (routesManifest == null) return null;
  const { app: _app, appId: _appId, ...routes } = routesManifest;
  return canonicalClone(routes);
}

function normalizedAuthorityProfile(schemaManifest, functionManifest) {
  const topLevel = schemaManifest?.authorityProfile ?? functionManifest?.authorityProfile;
  if (topLevel !== undefined) return canonicalClone(topLevel);
  const profiles = (schemaManifest?.tables ?? [])
    .filter((table) => table.authorityProfile !== undefined)
    .map((table) => ({ table: table.name, profile: table.authorityProfile }))
    .sort((left, right) => compareCodeUnits(left.table, right.table));
  return profiles.length === 0 ? null : canonicalClone(profiles);
}

const NORMALIZED_ASSET_INTENT_FIELD_DECISIONS = Object.freeze({
  id: 'exclude:appId',
  name: 'include:name',
  exportedName: 'exclude:graphRecords',
  argsContractHash: 'include:args',
  implementationHash: 'exclude:behavior',
  intentPolicyHash: 'include:policy',
  authRequirement: 'include:authority',
  accept: 'include:policy',
  delivery: 'include:policy',
  access: 'include:policy',
  grants: 'include:policy',
  image: 'include:policy',
  video: 'include:policy',
  on: 'include:policy',
  declaredReads: 'include:reads',
  runtime: 'exclude:behavior',
  handlerForm: 'exclude:behavior',
  sourceSpan: 'exclude:graphRecords',
});

function normalizedAssetUploadIntents(functionManifest) {
  return [...(functionManifest?.assetUploadIntents ?? [])]
    .map((intent) => {
      const unknown = Object.keys(intent)
        .filter((field) => NORMALIZED_ASSET_INTENT_FIELD_DECISIONS[field] === undefined)
        .sort(compareCodeUnits);
      if (unknown.length > 0) {
        throw generationError(
          'CODEGEN_WRITE_FAILED',
          `NormalizedApplicationDefinitionV1 has no include/exclude decision for asset upload intent field(s): ${unknown.join(', ')}`,
        );
      }
      return canonicalClone({
        name: intent.name,
        argsContractHash: intent.argsContractHash,
        intentPolicyHash: intent.intentPolicyHash,
        authRequirement: intent.authRequirement,
        accept: intent.accept,
        delivery: intent.delivery,
        access: intent.access,
        grants: intent.grants === true,
        image: intent.image ?? null,
        video: intent.video ?? null,
        callbacks: intent.on ?? null,
        reads: [...(intent.declaredReads ?? [])].sort(compareCodeUnits),
      });
    })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
}

const NORMALIZED_OPERATION_KINDS = new Set([
  'Query', 'LiveQuery', 'Mutation', 'Action',
]);

// This is deliberately a mapping over the actual decorated-function record,
// rather than a second list of fields that merely happens to resemble it.
// Adding a decorated field without assigning it to the normalized witness or
// one of the four public exclusions makes generation fail closed.
//
// @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1 —
// normalized equivalence is complete by construction; implementation/source
// custody is excluded only through the named public exclusion classes.
const NORMALIZED_DECORATED_OPERATION_FIELD_DECISIONS = Object.freeze({
  id: 'exclude:appId',
  name: 'include:operationName',
  exportedName: 'include:operationName',
  kind: 'include:operationKind',
  stream: 'include:stream',
  sourceSpan: 'exclude:graphRecords',
  handlerForm: 'exclude:behavior',
  implementationHash: 'exclude:behavior',
  argsContractHash: 'include:args',
  argsContract: 'include:args',
  boundedSkew: 'include:boundedSkew',
  sequences: 'include:sequences',
  resultContract: 'include:result',
  resultContractHash: 'include:result',
  requiredCapabilities: 'include:capabilities',
  authRequirement: 'include:authority',
  apiExposure: 'include:apiExposure',
  authorityIndependent: 'include:authority',
  publicInline: 'include:apiExposure',
  authorityCreating: 'include:authority',
  retainable: 'include:retention',
  retentionClass: 'include:retention',
  refusals: 'include:refusals',
  trackedRefusals: 'include:trackedRefusals',
  authorizationDependence: 'include:authority',
  authorityProfileDependence: 'include:authority',
  fieldBoundary: 'include:authority',
  syncabilityClass: 'include:syncabilityClass',
  readSetSummary: 'include:reads',
  writeSetSummary: 'include:writes',
  effectCeiling: 'include:effects',
  standardPattern: 'include:standardPattern',
  bundleEntrypoint: 'exclude:behavior',
  uses: 'include:secrets',
  // The current `runtime` member is the executable HostPlan/IbexModule
  // carrier. HostPlan is projected as `plan`; IbexModule is behavior. The
  // separately authored LLP 0249 runtime-profile fact is not implemented by
  // the canonical constructor yet, so normalized `runtime` is null today.
  runtime: 'include:plan+exclude:behavior',
});

function assertNormalizedOperationCoverage(operation) {
  const unknown = Object.keys(operation ?? {})
    .filter((field) => NORMALIZED_DECORATED_OPERATION_FIELD_DECISIONS[field] === undefined)
    .sort(compareCodeUnits);
  if (unknown.length > 0) {
    throw generationError(
      'CODEGEN_WRITE_FAILED',
      `NormalizedApplicationDefinitionV1 has no include/exclude decision for decorated operation field(s): ${unknown.join(', ')}`,
    );
  }
}

function normalizedOperation(operation) {
  assertNormalizedOperationCoverage(operation);
  if (!NORMALIZED_OPERATION_KINDS.has(operation?.kind)) {
    throw generationError(
      'CODEGEN_WRITE_FAILED',
      `NormalizedApplicationDefinitionV1 operation kind must be Query, LiveQuery, Mutation, or Action; received ${String(operation?.kind)}`,
    );
  }
  return canonicalClone({
    operationName: operation?.name,
    operationKind: operation?.kind,
    args: operation?.argsContract ?? null,
    result: operation?.resultContract ?? null,
    authority: {
      authRequirement: operation?.authRequirement ?? null,
      authorizationDependence: operation?.authorizationDependence ?? [],
      authorityIndependent: operation?.authorityIndependent === true,
      authorityCreating: operation?.authorityCreating === true,
      fieldBoundary: operation?.fieldBoundary ?? null,
      authorityProfileDependence: canonicalClone(
        operation?.authorityProfileDependence ?? [],
      ),
    },
    reads: operation?.readSetSummary ?? null,
    writes: operation?.writeSetSummary ?? null,
    effects: operation?.effectCeiling ?? null,
    capabilities: [...(operation?.requiredCapabilities ?? [])].sort(compareCodeUnits),
    apiExposure: operation?.apiExposure === undefined && operation?.publicInline !== true
      ? null
      : {
          ...(operation?.apiExposure ?? {}),
          ...(operation?.publicInline === true ? { publicInline: true } : {}),
        },
    refusals: canonicalClone(operation?.refusals ?? []),
    trackedRefusals: canonicalClone(operation?.trackedRefusals ?? []),
    syncabilityClass: operation?.syncabilityClass ?? null,
    retention: {
      retainable: operation?.retainable === true,
      retentionClass: operation?.retentionClass ?? null,
    },
    secrets: sortedCanonicalValues(operation?.uses),
    stream: operation?.stream === true,
    sequences: canonicalClone(operation?.sequences ?? []),
    boundedSkew: operation?.boundedSkew ?? null,
    standardPattern: operation?.standardPattern ?? null,
    runtime: null,
    plan: operation?.runtime?.HostPlan ?? null,
  });
}

// @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1 —
// the cross-profile witness is built independently from semanticInput. Its
// closed contract projection omits app address, profile, handler behavior,
// and source-graph custody while retaining plans, secrets, and derived reach.
export function buildNormalizedApplicationDefinitionV1({
  schemaManifest,
  functionManifest,
  routesManifest,
}) {
  const operations = [...(functionManifest?.functions ?? [])]
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  const schema = normalizedApplicationSchema(schemaManifest);
  const definition = canonicalClone({
    application: {
      schema,
      authorityProfile: normalizedAuthorityProfile(schemaManifest, functionManifest),
      assetUploadIntents: normalizedAssetUploadIntents(functionManifest),
      routes: normalizedRoutes(routesManifest),
      memberships: (schemaManifest?.tables ?? [])
        .filter((table) => table.membership !== undefined)
        .map((table) => ({ table: table.name, membership: table.membership })),
      migrations: schemaManifest?.migrations ?? null,
      retention: {
        schema: schemaManifest?.retention ?? null,
        operations: operations.map((operation) => ({
          operationName: operation.name,
          retainable: operation.retainable === true,
          retentionClass: operation.retentionClass ?? null,
        })),
      },
    },
    operations: operations.map(normalizedOperation),
  });
  return {
    schemaVersion: NORMALIZED_DEFINITION_SCHEMA_VERSION,
    excludedFields: ['behavior', 'graphRecords', 'authoringProfile', 'appId'],
    normalizedContractId: generationDomainHash(
      GENERATION_HASH_DOMAINS.normalizedContractId,
      definition,
    ),
    normalizedSchemaId: generationDomainHash(
      GENERATION_HASH_DOMAINS.normalizedSchemaId,
      schema,
    ),
    definition,
  };
}

function semanticAssetIntent(intent) {
  return {
    id: intent.id,
    name: intent.name,
    argsContractHash: intent.argsContractHash,
    authRequirement: intent.authRequirement,
    accept: intent.accept,
    delivery: intent.delivery,
    access: intent.access,
    grants: intent.grants === true,
    image: intent.image ?? null,
    video: intent.video ?? null,
    callbacks: intent.on ?? null,
    reads: [...(intent.declaredReads ?? [])].sort(compareCodeUnits),
    executable: intent.runtime?.IbexModule
      ? {
          kind: 'IbexModule',
          export: intent.runtime.IbexModule.export,
          canonicalRuntimeAst: canonicalExecutableSource(intent.runtime.IbexModule.source ?? ''),
        }
      : null,
  };
}

export function buildSemanticGenerationInputs({
  artifactVersion,
  authMode,
  appId,
  appIdentity,
  dataIdentity,
  targetProfile,
  schemaManifest,
  functionManifest,
  handlerRuntimeProfile,
  capabilityManifest,
  routesManifest,
  authoredSourceItems,
  sourceSpans,
  schemaFieldSpans,
  generationLog,
  authoringProfile = EXPLICIT_AUTHORING_PROFILE,
  applicationAuthBootstrap,
}) {
  const graphRecords = [...(handlerRuntimeProfile?.moduleGraph?.records ?? [])]
    .map(canonicalHandlerGraphRecord)
    .sort((left, right) => compareCodeUnits(left.root.name, right.root.name));
  const operations = [...(functionManifest?.functions ?? [])]
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const assetIntents = [...(functionManifest?.assetUploadIntents ?? [])]
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const targetIdentity = {
    profile: targetProfile,
    capabilityManifest: generationDomainHash(
      'snapback:application-generation:target-capability:v1',
      capabilityManifest,
    ),
  };
  const semanticInput = {
    schemaVersion: SEMANTIC_IDENTITY_SCHEMA_VERSION,
    appId,
    targetProfile,
    // @ref LLP 0253#s12-identity-no-fleet-wide-rotation — omission is the
    // explicit-v1 spelling in semantic identity. Only a non-default source
    // profile adds bytes to the preimage.
    ...(authoringProfile === EXPLICIT_AUTHORING_PROFILE ? {} : { authoringProfile }),
    // @ref LLP 0258#d1-generate-one-non-secret-bootstrap-policy — the
    // generated bootstrap policy is an explicit LLP 0241 semantic input.
    ...(applicationAuthBootstrap === undefined ? {} : { applicationAuthBootstrap }),
    schema: {
      version: schemaManifest?.schemaVersion,
      auth: schemaManifest?.auth ?? null,
      authProgram: schemaManifest?.authProgram ?? null,
      api: schemaManifest?.api ?? null,
      assets: schemaManifest?.assets ?? null,
      pushSeam: schemaManifest?.pushSeam ?? null,
      strictDeclarations: schemaManifest?.strictDeclarations === true,
      requiredCapabilities: [...(schemaManifest?.requiredCapabilities ?? [])].sort(compareCodeUnits),
      ephemeralCollections: schemaManifest?.ephemeralCollections ?? [],
      tables: schemaManifest?.tables ?? [],
      portabilityFlags: schemaManifest?.portabilityFlags ?? [],
    },
    operations: operations.map(semanticOperation),
    graphRecords,
    authorityProfile: schemaManifest?.authorityProfile
      ?? functionManifest?.authorityProfile
      ?? null,
    routes: routesManifest ?? null,
    assets: assetIntents.map(semanticAssetIntent),
    memberships: (schemaManifest?.tables ?? [])
      .filter((table) => table.membership !== undefined)
      .map((table) => ({ table: table.name, membership: table.membership })),
    migrations: schemaManifest?.migrations ?? null,
    retention: {
      schema: schemaManifest?.retention ?? null,
      operations: operations.map((operation) => ({
        operationId: operation.id,
        retainable: operation.retainable === true,
        retentionClass: operation.retentionClass ?? null,
      })),
    },
  };
  const executableInput = {
    schemaVersion: SEMANTIC_IDENTITY_SCHEMA_VERSION,
    targetProfile,
    toolchain: {
      codegen: SEMANTIC_IDENTITY_SCHEMA_VERSION,
      artifactVersion,
      authMode,
      handlerProfileVersion: handlerRuntimeProfile?.profileVersion ?? null,
      handlerAdmissionVersion: handlerRuntimeProfile?.admissionVersion ?? null,
      graphRecordVersion: handlerRuntimeProfile?.moduleGraph?.graphRecordSchema?.schemaVersion ?? null,
      graphExtractorVersion: handlerRuntimeProfile?.moduleGraph?.graphRecordSchema?.extractorVersion ?? null,
      runtimeProfile: capabilityManifest?.targetProfileId ?? targetProfile,
    },
    graphRecords,
    operations: operations.map(executableOperation),
    assetIntents: assetIntents.map((intent) => ({
      id: intent.id,
      executable: semanticAssetIntent(intent).executable,
    })),
  };
  const evidenceInput = {
    schemaVersion: SEMANTIC_IDENTITY_SCHEMA_VERSION,
    authoredSourceItems,
    sourceSpans,
    schemaFieldSpans,
    handlerGraphRecords: handlerRuntimeProfile?.moduleGraph?.records ?? [],
    guideLinks: [...(handlerRuntimeProfile?.diagnostics ?? [])]
      .map(({ code, guideAnchor }) => ({ code, guideAnchor }))
      .sort((left, right) => compareCodeUnits(left.code, right.code)),
    generationLog,
  };
  return {
    appIdentity: { appId, metadata: appIdentity ?? null },
    dataIdentity,
    targetIdentity,
    semanticInput,
    executableInputsByTarget: { [targetProfile]: executableInput },
    evidenceInput,
  };
}

export function computeGenerationContentIdentities({
  semanticInput,
  executableInputsByTarget,
  evidenceInput,
}) {
  const executableIdsByTarget = Object.fromEntries(
    Object.entries(executableInputsByTarget)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([target, input]) => [
        target,
        generationDomainHash(GENERATION_HASH_DOMAINS.executableId, { target, input }),
      ]),
  );
  return {
    semanticId: generationDomainHash(GENERATION_HASH_DOMAINS.semanticId, semanticInput),
    executableIdsByTarget,
    evidenceId: generationDomainHash(GENERATION_HASH_DOMAINS.evidenceId, evidenceInput),
  };
}

export function computeBundleId(bundleInput) {
  return generationDomainHash(GENERATION_HASH_DOMAINS.bundleId, bundleInput);
}

export function computeGenerationId({
  semanticId,
  executableIdsByTarget,
  evidenceId,
  bundleId,
  appIdentity,
  dataIdentity,
  targetIdentity,
}) {
  return generationDomainHash(GENERATION_HASH_DOMAINS.generationId, {
    schemaVersion: APPLICATION_GENERATION_SCHEMA_VERSION,
    semanticId,
    executableIdsByTarget,
    evidenceId,
    bundleId,
    appIdentity,
    dataIdentity,
    targetIdentity,
  });
}

export function completeGenerationIdentities({
  contentIdentities,
  bundleId,
  appIdentity,
  dataIdentity,
  targetIdentity,
}) {
  const generationId = computeGenerationId({
    ...contentIdentities,
    bundleId,
    appIdentity,
    dataIdentity,
    targetIdentity,
  });
  const target = targetIdentity.profile;
  const executableId = contentIdentities.executableIdsByTarget[target];
  if (!SHA256.test(executableId ?? '')) {
    throw generationError('CODEGEN_WRITE_FAILED', `current target ${target} has no executable identity`);
  }
  return {
    schemaVersion: SEMANTIC_IDENTITY_SCHEMA_VERSION,
    semanticId: contentIdentities.semanticId,
    executableId,
    executableIdsByTarget: contentIdentities.executableIdsByTarget,
    evidenceId: contentIdentities.evidenceId,
    ...(contentIdentities.normalizedContractId === undefined
      ? {}
      : { normalizedContractId: contentIdentities.normalizedContractId }),
    ...(contentIdentities.normalizedSchemaId === undefined
      ? {}
      : { normalizedSchemaId: contentIdentities.normalizedSchemaId }),
    bundleId,
    generationId,
  };
}

export function generationHashingRules() {
  return {
    domains: GENERATION_HASH_DOMAINS,
    canonicalization: 'recursive-code-unit-key-sort/canonical-json/utf8/v1',
    semanticInput: 'logical schema, operation contracts and canonical behavior, normalized graph topology, authority/reads/writes/effects/capabilities, routes, asset/membership/retention/migration policy, and target profile',
    executableInput: 'target-keyed canonical runtime AST/plan bytes plus graph topology and toolchain/admission/runtime profile versions',
    evidenceInput: 'normalized source labels with original bytes, source spans/maps when present, comments/docs/JSDoc/@ref/guide links, raw graph evidence, and generation log facts',
    bundleInput: 'all generated leaf member hashes plus address-neutral artifacts.json and generation.json projections',
    generationInput: 'semanticId, target-keyed executable-id set, evidenceId, bundleId, app/data/target identity, and generation schema version',
    excludedRootAddressFields: [
      'artifacts.json.identities.bundleId',
      'artifacts.json.identities.generationId',
      'generation.json.identities.bundleId',
      'generation.json.identities.generationId',
      'integrity.json.generationId',
    ],
    excludedNonContentMetadata: [
      'generation.json.predecessorGenerationId',
      '.snapback/generations/latest-emitted.json',
    ],
  };
}

export function generationAddressNeutralProjection({
  appIdentity,
  dataIdentity,
  targetIdentity,
  members,
  identities,
}) {
  return {
    schemaVersion: APPLICATION_GENERATION_SCHEMA_VERSION,
    artifactKind: 'applicationGeneration',
    custody: GENERATION_ENVELOPE_CUSTODY,
    appIdentity,
    dataIdentity,
    targetIdentity,
    identities: addressNeutralIdentities(identities),
    members,
    hashing: generationHashingRules(),
  };
}

export function generationEnvelopeRoot(backendRoot) {
  const canonical = resolve(backendRoot);
  const projectRoot = basename(canonical) === 'snapback' ? dirname(canonical) : canonical;
  return join(projectRoot, '.snapback', 'generations');
}

export function publishGenerationEnvelope({
  backendRoot,
  identities,
  appIdentity,
  dataIdentity,
  targetIdentity,
  members,
  testHooks = undefined,
}) {
  validateIdentities(identities);
  const root = generationEnvelopeRoot(backendRoot);
  const envelopeRoot = safeGenerationPath(root, identities.generationId);
  mkdirSync(root, { recursive: true });
  const predecessorGenerationId = discoverPredecessor(root, identities.generationId);
  const generation = {
    ...generationAddressNeutralProjection({ appIdentity, dataIdentity, targetIdentity, members, identities }),
    identities,
    predecessorGenerationId,
  };
  const generationBytes = Buffer.from(`${canonicalGenerationJson(generation, 2)}\n`, 'utf8');
  const integrity = {
    schemaVersion: GENERATION_INTEGRITY_SCHEMA_VERSION,
    artifactKind: 'applicationGenerationIntegrity',
    generationId: identities.generationId,
    generation: {
      path: 'generation.json',
      sha256: byteHash(generationBytes),
      bytes: generationBytes.byteLength,
    },
    members,
  };
  const integrityBytes = Buffer.from(`${canonicalGenerationJson(integrity, 2)}\n`, 'utf8');
  const temporaryRoot = join(root, `.tmp-${process.pid}-${Date.now()}-${identities.generationId.slice(-12)}`);
  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(temporaryRoot);
  try {
    writeFileSync(join(temporaryRoot, 'generation.json'), generationBytes, { flag: 'wx' });
    writeFileSync(join(temporaryRoot, 'integrity.json'), integrityBytes, { flag: 'wx' });
    verifyEnvelopeDirectory(temporaryRoot, identities.generationId, generationBytes, integrityBytes);
    testHooks?.beforeRename?.({ temporaryRoot, envelopeRoot, generation });
    if (existsSync(envelopeRoot)) {
      verifyEnvelopeDirectory(envelopeRoot, identities.generationId, generationBytes, integrityBytes);
      rmSync(temporaryRoot, { recursive: true, force: true });
    } else {
      renameSync(temporaryRoot, envelopeRoot);
    }
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    envelopeRoot,
    generation,
    integrity,
  };
}

export function recordLatestEmittedGeneration({ root, generation }) {
  const path = join(root, 'latest-emitted.json');
  const temporaryPath = join(root, `.latest-emitted.tmp-${process.pid}-${Date.now()}`);
  const record = {
    schemaVersion: LATEST_EMITTED_SCHEMA_VERSION,
    authority: 'non-authoritative-build-metadata',
    generationId: generation.identities.generationId,
  };
  writeFileSync(temporaryPath, `${canonicalGenerationJson(record, 2)}\n`, { flag: 'wx' });
  try {
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return { path, record };
}

function discoverPredecessor(root, candidateGenerationId) {
  const candidateRoot = safeGenerationPath(root, candidateGenerationId);
  if (existsSync(candidateRoot)) {
    try {
      const existing = JSON.parse(readFileSync(join(candidateRoot, 'generation.json'), 'utf8'));
      return existing.predecessorGenerationId ?? null;
    } catch (cause) {
      throw generationError('CODEGEN_WRITE_FAILED', `existing generation envelope is invalid: ${cause.message}`, {
        envelopeRoot: candidateRoot,
      }, cause);
    }
  }
  const latestPath = join(root, 'latest-emitted.json');
  if (!existsSync(latestPath)) return null;
  let latest;
  try {
    latest = JSON.parse(readFileSync(latestPath, 'utf8'));
  } catch (cause) {
    throw generationError(
      'CODEGEN_WRITE_FAILED',
      `latest-emitted build metadata is invalid: ${cause.message}`,
      { path: latestPath },
      cause,
    );
  }
  if (
    latest?.schemaVersion !== LATEST_EMITTED_SCHEMA_VERSION
    || latest?.authority !== 'non-authoritative-build-metadata'
    || !SHA256.test(latest?.generationId ?? '')
  ) {
    throw generationError('CODEGEN_WRITE_FAILED', 'latest-emitted build metadata has an invalid shape', { path: latestPath });
  }
  const priorRoot = safeGenerationPath(root, latest.generationId);
  if (!existsSync(priorRoot)) {
    throw generationError('CODEGEN_WRITE_FAILED', 'latest-emitted build metadata names a missing envelope', {
      path: latestPath,
      generationId: latest.generationId,
    });
  }
  return latest.generationId;
}

function verifyEnvelopeDirectory(root, generationId, expectedGenerationBytes, expectedIntegrityBytes) {
  const entries = ['generation.json', 'integrity.json'];
  const actualEntries = readdirSync(root).sort(compareCodeUnits);
  if (
    actualEntries.length !== entries.length
    || actualEntries.some((entry, index) => entry !== entries[index])
  ) {
    throw generationError('CODEGEN_WRITE_FAILED', `generation ${generationId} has an invalid closed inventory`, {
      envelopeRoot: root,
      expected: entries,
      actual: actualEntries,
    });
  }
  for (const name of entries) {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw generationError('CODEGEN_WRITE_FAILED', `${path} is not a regular nonsymlink file`, { path });
    }
  }
  const observedGeneration = readFileSync(join(root, 'generation.json'));
  const observedIntegrity = readFileSync(join(root, 'integrity.json'));
  if (!observedGeneration.equals(expectedGenerationBytes) || !observedIntegrity.equals(expectedIntegrityBytes)) {
    throw generationError('CODEGEN_WRITE_FAILED', `immutable generation ${generationId} already exists with different bytes`, {
      envelopeRoot: root,
      generationId,
    });
  }
  const integrity = JSON.parse(observedIntegrity.toString('utf8'));
  if (
    integrity.generationId !== generationId
    || integrity.generation?.sha256 !== byteHash(observedGeneration)
    || integrity.generation?.bytes !== observedGeneration.byteLength
  ) {
    throw generationError('CODEGEN_WRITE_FAILED', `generation ${generationId} failed its integrity record`, {
      envelopeRoot: root,
      generationId,
    });
  }
}

function safeGenerationPath(root, generationId) {
  if (!SHA256.test(generationId ?? '')) {
    throw generationError('CODEGEN_WRITE_FAILED', 'generationId must be a full sha256 identity', { generationId });
  }
  const target = resolve(root, encodeURIComponent(generationId));
  const local = relative(root, target);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw generationError('CODEGEN_WRITE_FAILED', 'generationId resolves outside the generation root', { generationId });
  }
  return target;
}

function validateIdentities(identities) {
  for (const key of ['semanticId', 'executableId', 'evidenceId', 'bundleId', 'generationId']) {
    if (!SHA256.test(identities?.[key] ?? '')) {
      throw generationError('CODEGEN_WRITE_FAILED', `${key} must be a full sha256 identity`, { key, value: identities?.[key] });
    }
  }
  for (const [target, executableId] of Object.entries(identities?.executableIdsByTarget ?? {})) {
    if (target.length === 0 || !SHA256.test(executableId)) {
      throw generationError('CODEGEN_WRITE_FAILED', 'target-keyed executable identities are invalid', { target, executableId });
    }
  }
  for (const key of ['normalizedContractId', 'normalizedSchemaId']) {
    if (identities?.[key] !== undefined && !SHA256.test(identities[key])) {
      throw generationError('CODEGEN_WRITE_FAILED', `${key} must be a full sha256 identity`, { key, value: identities[key] });
    }
  }
}

function addressNeutralIdentities(identities) {
  return {
    schemaVersion: identities?.schemaVersion,
    semanticId: identities?.semanticId,
    executableId: identities?.executableId,
    executableIdsByTarget: identities?.executableIdsByTarget,
    evidenceId: identities?.evidenceId,
    ...(identities?.normalizedContractId === undefined
      ? {}
      : { normalizedContractId: identities.normalizedContractId }),
    ...(identities?.normalizedSchemaId === undefined
      ? {}
      : { normalizedSchemaId: identities.normalizedSchemaId }),
  };
}

function byteHash(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function generationError(code, message, details = {}, cause = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  if (cause) error.cause = cause;
  return error;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
