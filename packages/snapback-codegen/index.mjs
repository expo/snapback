// Snapback codegen: one source of truth -> generated manifests.
//
// @ref LLP 0012#versioning — a single source-of-truth definition feeds both the
//   Snapback server manifests and the Contract data manifest, instead of two
//   hand-synced files that drift (Valet's protocol.ts/protocol.rs trap).
// @ref LLP 0010#generated-artifacts — no silent drops: anything that cannot be
//   resolved emits a structured diagnostic with a stable code; generated output is
//   deterministic and carries an inputsHash staleness marker.
//
// This is product code (LLP 0032 P1): it lives in packages/snapback-codegen and
// the demo kit re-exports it for compatibility (demos/_kit/codegen.mjs).
//
// Usage: node packages/snapback-codegen/index.mjs [backendDir]   (default: demos/todo/snapback)
// Emits <backendDir>/generated/{schema,functions,contract-data}.manifest.json + artifacts.json.
// Exits non-zero (writing nothing) if any error diagnostic is produced.

import { createHash } from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseJavaScript } from 'acorn';
import { computeEffectCeiling } from './effect-ceiling.mjs';
import {
  API_ENVELOPE_MEMBERS_FILE,
  buildApiEnvelopeMembers,
} from './api-envelope-members.mjs';
import { build as esbuild } from 'esbuild';
import ts from 'typescript';
import {
  HANDLER_TYPESCRIPT_PROFILE,
  HANDLER_TYPESCRIPT_PROFILE_ARTIFACT_FILE,
  handlerTypeScriptCompilerOptions,
  handlerTypeScriptIdentity,
} from './typescript-profile.mjs';
import { nPlusOneBatchReadAdvisories } from './n-plus-one-advisory.mjs';
import {
  mapGeneratedTypeScriptPosition,
  transformTypeScriptHandler,
  typecheckTypeScriptHandler,
} from './typescript-transform.mjs';
import {
  AUTH_PROGRAM_FIELDS,
  AUTH_PROGRAM_MECHANISM_KINDS,
  OUTGREW_IR_CLASSES,
  PINNED_FUNCTIONS,
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from './define.mjs';
import {
  decodeUtf8Source,
  resolveFileReadCapability,
  resolveHandlerSourceCapability,
} from './file-read-capability.mjs';
import { SNAPBACK_CONTRACT_RECEIPT_CAPABILITY } from '@expo/snapback-contract/capabilities';
import {
  OPERATION_NAME_PATTERN,
  isOperationName,
} from '@expo/snapback-contract/operation-name';
import {
  generatedByHeader,
  importsExactPackage,
  jsonLiteral,
  pascal,
  renderBindingModule,
  renderMutationMetaModule,
  renderQueryMetaModule,
  renderRuntimeLinksModule,
} from './contract-emitter.mjs';
import {
  CONTRACT_DATA_MANIFEST_VERSION,
  createProviderBindingMetadata,
  createSnapbackProviderIntrospection,
  projectContractDataManifest,
  renderProviderBindingTypes,
  serializeProviderBindingMetadata,
  serializeProviderIntrospection,
  validateContractDataManifestProjection,
  validateProviderIntrospection,
  validateSnapbackIntrospectionSource,
} from './provider-introspection.mjs';
import {
  artifactSha256,
  codegenCacheGraphRoot,
  codegenProjectRoot,
  createArtifactFileRecords,
  createReviewManifest,
  publishGeneratedGraph,
  stableArtifactJson,
} from './review-surface.mjs';
import {
  AUTHORIZATION_REVIEW_FILE,
  createAuthorizationReview,
  serializeAuthorizationReview,
  validateAuthorizationReview,
} from './authorization-review.mjs';
import {
  GOVERNANCE_FILES,
  VisibilityGovernanceError,
  validateVisibilityGovernance,
} from './visibility-governance.mjs';
import {
  WRITE_POLICY_SEMANTIC_VERSION,
  buildWritePolicyChecks,
} from './write-policy.mjs';
import {
  buildSeedAssetFixturesV1,
  canonicalSeedAssetFixturesJson,
  canonicalSeedArtifactJson,
  parseSeedSourceV1,
} from './seed-artifact.mjs';
import { withCodegenGenerationLock } from './generation-lock.mjs';
import {
  captureElevatedDbUseSites,
  extractInlineHandlers,
  renameExtractedInlineHandler,
  renderInlineCustomAuthorizationModule,
  renderInlineHandlerModule,
  renderInlineOperationGraphModule,
  renderInlineOperationModule,
} from './inline-handlers.mjs';
import {
  buildHandlerRuntimeProfile,
  CLOSED_SCRIPT_HANDLER_RULES,
  handlerDiagnosticDetails,
} from './handler-runtime-profile.mjs';
import {
  APPLICATION_AUTH_PLATFORM_KINDS,
  buildClientLifecycleManifest,
  CLIENT_LIFECYCLE_MANIFEST_FILE,
  renderReferenceJSDoc,
} from './client-lifecycle.mjs';
import { FAMILIAR_DISPOSITIONS } from './familiar-dispositions.mjs';
import {
  APPLICATION_GENERATION_SCHEMA_VERSION,
  EXPLICIT_AUTHORING_PROFILE,
  FAMILIAR_AUTHORING_PROFILE,
  NORMALIZED_DEFINITION_SCHEMA_VERSION,
  SEMANTIC_IDENTITY_SCHEMA_VERSION,
  buildNormalizedApplicationDefinitionV1,
  buildSemanticGenerationInputs,
  completeGenerationIdentities,
  computeBundleId,
  computeGenerationContentIdentities,
  generationAddressNeutralProjection,
  generationDomainHash,
  publishGenerationEnvelope,
  recordLatestEmittedGeneration,
} from './semantic-generation.mjs';

const AUTH_ASSURANCE_KINDS = new Set([
  'authenticated', 'email_verified', 'phone_verified', 'recent_auth',
  'phishing_resistant',
]);
const ARGUMENT_NORMALIZATION_VERSION = 'snapback.argument-normalization.v1';
// Module-private capability: only this generator can stamp a function as one
// of the authority operations it synthesized. Authored definitions may copy
// names and public object fields, but cannot forge this Symbol identity.
// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — generated
// identity, not name matching, admits private authority-operation marshalling.
const GENERATED_AUTHORITY_OPERATION = Symbol('snapback.generatedAuthorityOperation.v1');
import {
  argsContractHash,
  canonicalJson as canonicalResultJson,
  effectiveArgsContract,
  effectiveResultContract,
  effectiveResultContractFacts,
  resultContractHash,
  resultContractType,
  searchPageResultType,
  storedStructuredContractDescriptor,
  VECTOR_COMPONENT_ABS_MAX,
  vectorPageResultType,
  validatorResultValue,
} from './result-contracts.mjs';
import { compileGraphQueryV1 } from './graph-query.mjs';
import {
  SEARCH_QUERY_AST_SCHEMA_REF,
  searchArgsSchemaProblems,
  searchAstEmission,
} from './search-request-schema.mjs';
import {
  createCodegenSummary,
  formatCodegenSummary,
  groupedCodegenSummaryDiagnosticCodes,
} from './codegen-summary.mjs';
import {
  APPLICATION_AUTH_BOOTSTRAP_ENTRY_MECHANISMS,
  APPLICATION_AUTH_BOOTSTRAP_FORMAT,
  createAppDescriptorV1,
  serializeAppDescriptorV1,
  SURFACE_MAX_MEMBER_BINDINGS,
  SURFACE_MAX_MEMBERS,
  SURFACE_MAX_PARAMS,
  SURFACE_MAX_PER_APP,
  SURFACE_MAX_SCOPE_RECORD_FIELDS,
  validateAppDescriptorV1,
} from './app-descriptor.mjs';
export {
  formatCodegenSummary,
  groupedCodegenSummaryDiagnosticCodes,
  SURFACE_MAX_MEMBER_BINDINGS,
  SURFACE_MAX_MEMBERS,
  SURFACE_MAX_PARAMS,
  SURFACE_MAX_PER_APP,
  SURFACE_MAX_SCOPE_RECORD_FIELDS,
};
export {
  DECLARATION_SUGGESTION_REASON_CODES,
  applyDeclarationSuggestion,
  formatDeclarationSuggestionPatch,
  readDeclarationSuggestionFile,
  resolveDeclarationSuggestionTarget,
  suggestDeclarations,
} from './declaration-suggestion.mjs';

const CAPABILITY_UNSUPPORTED_GUIDE_URL = 'https://github.com/expo/snapback/blob/main/guide/operating/diagnostics.md#diagnose-snapbackcapabilityunsupported';

function capabilityUnsupportedMessage(message) {
  return message.includes(CAPABILITY_UNSUPPORTED_GUIDE_URL)
    ? message
    : `${message}; see ${CAPABILITY_UNSUPPORTED_GUIDE_URL}`;
}

const SEARCH_FIELD_CLASSIFICATIONS = new Set([
  'public',
  'private',
  'sensitive',
  'forbidden',
]);

const HEADER = generatedByHeader();

// @ref LLP 0194#acceptance — generated app declarations instantiate and
// re-export this owner; they never define the generic ctx identities again.
const CTX_DECLARATION_MODULE = '@expo/snapback-codegen/ctx';

const SYSTEM_FIELDS = ['_id', '_version', '_createdAt', '_updatedAt'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const compositionDomainHash = (domain, value) => `sha256:${createHash('sha256')
  .update(domain)
  .update(canonicalResultJson(value))
  .digest('hex')}`;

export const STORED_STRUCTURED_ENCODING_V1 = 'canonical-json-text.v1';

// @ref LLP 0211#representation-and-write-path — exact domain-string,
// newline separator, three-member record, JCS bytes, and lowercase hex.
export function storedStructuredContractHash(contract) {
  return `sha256:${createHash('sha256')
    .update('snapback:stored-structured-contract:v1\n')
    .update(canonicalResultJson(contract))
    .digest('hex')}`;
}

const TRUSTED_COMPOSITION_ACTIVATION_FILE = 'trusted-composition-activation.json';

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && canonicalResultJson(Object.keys(value).sort()) === canonicalResultJson([...expected].sort());
}

// @ref LLP 0178#2-diagnostic-shape — internal generation failures remain
// thrown errors, but carry the same stable structured diagnostic returned by
// the worker and include authored file/span evidence whenever it is known.
function codegenError(code, message, {
  cause = undefined,
  path = undefined,
  line = undefined,
  column = undefined,
  details = {},
} = {}) {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = Object.freeze({
    code,
    severity: 'error',
    subsystem: 'codegen',
    message,
    ...(path === undefined ? {} : { path }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    details: Object.freeze(details),
  });
  return error;
}

// Activation preparation is two-phase by construction: the server-owned
// keyring mints/selects the public manifest and prepares this source artifact;
// codegen then validates it against the generation it just derived and emits
// the byte-stable trust root through the ordinary transactional artifact graph.
// The source is deliberately outside `inputsHash`: including the activation,
// which embeds its minted generation, would make that identity recursive.
// @ref LLP 0157#d3--the-completeness-witness — trusted activation and proof-key manifest are generated/deployment output, never mutable client-store state.
export function validateTrustedCompositionActivationV1(candidate, {
  expectedGeneration,
  authoredSourceHash,
  targetProfileId,
  authMode,
}) {
  if (!exactKeys(candidate, ['format', 'activation', 'activationHash', 'proofKeys'])
    || candidate.format !== 'snapback.trusted-composition-activation.v1') {
    throw new TypeError('trusted composition activation has an invalid closed root record');
  }
  const activation = candidate.activation;
  if (typeof activation?.databaseId !== 'string'
    || activation.databaseId === ''
    || typeof activation.deploymentId !== 'string'
    || activation.deploymentId === ''
    || activation.targetProfileId !== targetProfileId
    || activation.authMode !== authMode) {
    throw new TypeError('trusted composition activation does not bind this generated deployment');
  }
  // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
  // — v1 retains exact-generation admission; v2 instead admits only the exact
  // authored bytes and keeps its minted generation as provenance.
  let activationDomain;
  if (activation.format === 'snapback.composition-activation.v1') {
    if (!exactKeys(activation, [
      'format',
      'databaseId',
      'deploymentId',
      'targetProfileId',
      'authMode',
      'expectedGeneration',
      'proofKeyManifestDigest',
    ])
      || canonicalResultJson(activation.expectedGeneration) !== canonicalResultJson(expectedGeneration)) {
      throw new TypeError('trusted composition activation does not bind this generated deployment');
    }
    activationDomain = 'snapback:composition-activation:v1:';
  } else if (activation.format === 'snapback.composition-activation.v2') {
    if (!exactKeys(activation, [
      'format',
      'databaseId',
      'deploymentId',
      'targetProfileId',
      'authMode',
      'authoredSourceHash',
      'mintedGeneration',
      'proofKeyManifestDigest',
    ])
      || !exactKeys(activation.mintedGeneration, [
        'schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash',
      ])
      || Object.values(activation.mintedGeneration).some((value) => (
        typeof value !== 'string' || value === ''
      ))
      || !/^sha256:[0-9a-f]{64}$/u.test(activation.authoredSourceHash)
      || activation.authoredSourceHash !== authoredSourceHash) {
      throw new TypeError('trusted composition activation does not bind this generated deployment');
    }
    activationDomain = 'snapback:composition-activation:v2:';
  } else {
    throw new TypeError('trusted composition activation does not bind this generated deployment');
  }
  const manifest = candidate.proofKeys;
  if (!exactKeys(manifest, ['format', 'keys'])
    || manifest.format !== 'snapback.completeness-proof-keys.v1'
    || !Array.isArray(manifest.keys)
    || manifest.keys.length === 0) {
    throw new TypeError('trusted composition activation has an invalid proof-key manifest');
  }
  let previous = null;
  for (const key of manifest.keys) {
    if (!exactKeys(key, ['proofKeyId', 'algorithm', 'publicKeyBase64url'])
      || typeof key.proofKeyId !== 'string'
      || key.proofKeyId === ''
      || key.algorithm !== 'Ed25519'
      || typeof key.publicKeyBase64url !== 'string'
      || (previous !== null && previous >= key.proofKeyId)) {
      throw new TypeError('trusted composition activation proof keys are not closed, unique, and ascending');
    }
    const publicKey = Buffer.from(key.publicKeyBase64url, 'base64url');
    if (publicKey.length !== 32 || publicKey.toString('base64url') !== key.publicKeyBase64url) {
      throw new TypeError('trusted composition activation public key is not canonical 32-byte base64url');
    }
    previous = key.proofKeyId;
  }
  const manifestDigest = compositionDomainHash(
    'snapback:completeness-proof-keys:v1:',
    manifest,
  );
  if (activation.proofKeyManifestDigest !== manifestDigest) {
    throw new TypeError('trusted composition activation proof-key manifest digest does not reproduce');
  }
  const activationHash = compositionDomainHash(
    activationDomain,
    activation,
  );
  if (candidate.activationHash !== activationHash) {
    throw new TypeError('trusted composition activation hash does not reproduce');
  }
  return candidate;
}

// Rebuild the complete LLP 0157 identity stack from the schema-expanded
// argument contract. The emitted record is evidence for the host to compare,
// never author-controlled authority.
// @ref LLP 0157#d2--plan-identity
function snapshotBatchIdentityV1(plan, argsContract) {
  const nodes = [];
  const merged = [];
  const mergedByName = new Map();
  for (const [position, node] of plan.nodes.entries()) {
    const field = argsContract.fields.find((candidate) => candidate.name === node.parentIdArg);
    if (!field) throw new TypeError(`snapshot batch node ${position} has no merged parent binding`);
    const contract = {
      format: 'snapback.argument-binding-contract.v1',
      required: field.required,
      value: field.value,
    };
    const contractHash = compositionDomainHash(
      'snapback:argument-binding-contract:v1:',
      contract,
    );
    const binding = { name: field.name, contract, contractHash };
    const prior = mergedByName.get(field.name);
    if (prior) {
      if (canonicalResultJson(prior.contract) !== canonicalResultJson(contract)
        || prior.contractHash !== contractHash) {
        throw new TypeError(`snapshot batch argument ${field.name} has incompatible node contracts`);
      }
      prior.sourcePositions.push(position);
    } else {
      const entry = { name: field.name, contract, contractHash, sourcePositions: [position] };
      mergedByName.set(field.name, entry);
      merged.push(entry);
    }
    const nodePlan = {
      format: 'snapback.node-plan.v1',
      classId: 'bounded_children_v1',
      classVersion: 1,
      normalizedPlan: node,
      argumentBindings: [binding],
      capability: {
        exportKind: 'internal',
        live: { kind: 'none' },
        retention: 'none',
        requiredCapabilityIds: ['bounded_children_v1'],
      },
    };
    nodes.push({
      position,
      nodePlan,
      nodePlanHash: compositionDomainHash('snapback:node-plan:v1:', nodePlan),
    });
  }
  const mergedArgs = {
    format: 'snapback.merged-args-contract.v1',
    bindings: merged,
  };
  const groups = [];
  const groupsByKey = new Map();
  for (const [position, node] of plan.nodes.entries()) {
    const key = {
      format: 'snapback.parent-authorization-key.v1',
      parentTable: node.parentTable,
      parentIdArgument: node.parentIdArg,
      parentIdType: { kind: 'id', table: node.parentTable },
      visibility: node.parentVisibility === 'publicRead'
        ? { kind: 'public-read' }
        : { kind: 'owner.v1', field: node.parentVisibility.owner.field },
    };
    const keyJcs = canonicalResultJson(key);
    let group = groupsByKey.get(keyJcs);
    if (!group) {
      group = {
        members: [],
        keyJcsBase64url: Buffer.from(keyJcs, 'utf8').toString('base64url'),
      };
      groupsByKey.set(keyJcs, group);
      groups.push(group);
    }
    group.members.push(position);
  }
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'snapshot-batch.v1',
    nodes,
    mergedArgsContractHash: compositionDomainHash(
      'snapback:merged-args-contract:v1:',
      mergedArgs,
    ),
    classification: {
      callable: true,
      live: {
        kind: 'admitted',
        delivery: 'live_replace',
        pageDomain: 'cursor-free-first-page',
      },
      invalidation: 'table-granular-resnapshot',
      retention: 'none',
    },
    parentAuthorizationGroups: groups,
  };
  return {
    normalizedCompositePlan,
    planHash: compositionDomainHash('snapback:plan-hash:v1:', normalizedCompositePlan),
  };
}

function collectSnapshotBatchV2ArgumentUses(value, names, state) {
  if (value === 'Args') {
    state.usesAll = true;
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  if (typeof value.Arg === 'string') {
    const [name] = value.Arg.split('.');
    if (!name) throw new TypeError('snapshot batch v2 relational argument path is empty');
    names.add(name);
    return;
  }
  if (value.Field) collectSnapshotBatchV2ArgumentUses(value.Field.base, names, state);
  if (value.Binary) {
    collectSnapshotBatchV2ArgumentUses(value.Binary.left, names, state);
    collectSnapshotBatchV2ArgumentUses(value.Binary.right, names, state);
  }
  if (value.Unary) collectSnapshotBatchV2ArgumentUses(value.Unary.expr, names, state);
  if (value.If) {
    collectSnapshotBatchV2ArgumentUses(value.If.cond, names, state);
    collectSnapshotBatchV2ArgumentUses(value.If.then, names, state);
    collectSnapshotBatchV2ArgumentUses(value.If.else, names, state);
  }
  if (value.Concat) {
    for (const item of value.Concat) collectSnapshotBatchV2ArgumentUses(item, names, state);
  }
  if (value.Call) {
    for (const item of value.Call.args ?? []) {
      collectSnapshotBatchV2ArgumentUses(item, names, state);
    }
  }
  if (value.Record) {
    for (const item of Object.values(value.Record.fields ?? {})) {
      collectSnapshotBatchV2ArgumentUses(item, names, state);
    }
  }
}

// @ref LLP 0157#d2--plan-identity — v2 reuses the one identity stack while
// preserving each owner's normalized plan, class-selected argument closure,
// and bounded-child-only parent groups byte-for-byte with the Rust host.
function snapshotBatchIdentityV2(plan, argsContract) {
  const nodes = [];
  const merged = [];
  const mergedByName = new Map();
  const contractByName = new Map(argsContract.fields.map((field) => [field.name, field]));
  for (const [position, node] of plan.nodes.entries()) {
    const names = new Set();
    if (node.classId === 'bounded_children_v1') {
      names.add(node.plan.parentIdArg);
    } else if (node.classId === 'relational_query_v1') {
      const state = { usesAll: false };
      for (const filter of [
        ...(node.plan.rootFilters ?? []),
        ...(node.plan.rootVisibility ?? []),
        ...(node.plan.joinedVisibility ?? []),
      ]) collectSnapshotBatchV2ArgumentUses(filter.value, names, state);
      if (state.usesAll) {
        for (const field of argsContract.fields) if (field.name !== 'cursor') names.add(field.name);
      }
    } else {
      throw new TypeError(`snapshot batch v2 node ${position} has unknown class ${String(node.classId)}`);
    }
    const bindings = [];
    for (const field of argsContract.fields) {
      if (!names.has(field.name)) continue;
      if (field.name === 'cursor') {
        throw new TypeError(`snapshot batch v2 node ${position} cannot bind the composite cursor`);
      }
      const contract = {
        format: 'snapback.argument-binding-contract.v1',
        required: field.required,
        value: field.value,
      };
      const contractHash = compositionDomainHash(
        'snapback:argument-binding-contract:v1:',
        contract,
      );
      const binding = { name: field.name, contract, contractHash };
      bindings.push(binding);
      const prior = mergedByName.get(field.name);
      if (prior) {
        if (canonicalResultJson(prior.contract) !== canonicalResultJson(contract)
          || prior.contractHash !== contractHash) {
          throw new TypeError(`snapshot batch argument ${field.name} has incompatible node contracts`);
        }
        prior.sourcePositions.push(position);
      } else {
        const entry = { name: field.name, contract, contractHash, sourcePositions: [position] };
        mergedByName.set(field.name, entry);
        merged.push(entry);
      }
    }
    for (const name of names) {
      if (!contractByName.has(name)) {
        throw new TypeError(`snapshot batch v2 node ${position} references undeclared argument ${name}`);
      }
    }
    const nodePlan = {
      format: 'snapback.node-plan.v1',
      classId: node.classId,
      classVersion: 1,
      normalizedPlan: node.plan,
      argumentBindings: bindings,
      capability: {
        exportKind: 'internal',
        live: { kind: 'none' },
        retention: 'none',
        requiredCapabilityIds: [node.classId],
      },
    };
    nodes.push({
      position,
      nodePlan,
      nodePlanHash: compositionDomainHash('snapback:node-plan:v1:', nodePlan),
    });
  }
  const mergedArgs = { format: 'snapback.merged-args-contract.v1', bindings: merged };
  const groups = [];
  const groupsByKey = new Map();
  for (const [position, node] of plan.nodes.entries()) {
    if (node.classId !== 'bounded_children_v1') continue;
    const key = {
      format: 'snapback.parent-authorization-key.v1',
      parentTable: node.plan.parentTable,
      parentIdArgument: node.plan.parentIdArg,
      parentIdType: { kind: 'id', table: node.plan.parentTable },
      visibility: node.plan.parentVisibility === 'publicRead'
        ? { kind: 'public-read' }
        : { kind: 'owner.v1', field: node.plan.parentVisibility.owner.field },
    };
    const keyJcs = canonicalResultJson(key);
    let group = groupsByKey.get(keyJcs);
    if (!group) {
      group = {
        members: [],
        keyJcsBase64url: Buffer.from(keyJcs, 'utf8').toString('base64url'),
      };
      groupsByKey.set(keyJcs, group);
      groups.push(group);
    }
    group.members.push(position);
  }
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'snapshot-batch.v2',
    nodes,
    mergedArgsContractHash: compositionDomainHash(
      'snapback:merged-args-contract:v1:',
      mergedArgs,
    ),
    classification: {
      callable: true,
      live: {
        kind: 'admitted',
        delivery: 'live_replace',
        pageDomain: 'cursor-free-first-page',
      },
      invalidation: 'table-granular-resnapshot',
      retention: 'none',
    },
    parentAuthorizationGroups: groups,
  };
  return {
    normalizedCompositePlan,
    planHash: compositionDomainHash('snapback:plan-hash:v1:', normalizedCompositePlan),
  };
}

function serializedValueUsesAuthorityOrAmbientInput(value) {
  if (typeof value === 'string') {
    return value === 'AuthUserId'
      || value === 'AuthKind'
      || value === 'AuthActorKind'
      || value === 'AuthActivityActorKind'
      || value === 'AuthActorUserId'
      || value === 'AuthGrantId'
      || value === 'ClientMutationDigest'
      || value === 'AuthIsDelegated'
      || value === 'RuntimeId'
      || value === 'RuntimeNow';
  }
  if (value === null || typeof value !== 'object') return false;
  if ('MembershipExists' in value) return true;
  if ('Field' in value) return serializedValueUsesAuthorityOrAmbientInput(value.Field.base);
  if ('Binary' in value) {
    return serializedValueUsesAuthorityOrAmbientInput(value.Binary.left)
      || serializedValueUsesAuthorityOrAmbientInput(value.Binary.right);
  }
  if ('Unary' in value) return serializedValueUsesAuthorityOrAmbientInput(value.Unary.expr);
  if ('If' in value) {
    return serializedValueUsesAuthorityOrAmbientInput(value.If.cond)
      || serializedValueUsesAuthorityOrAmbientInput(value.If.then)
      || serializedValueUsesAuthorityOrAmbientInput(value.If.else);
  }
  if ('Concat' in value) return value.Concat.some(serializedValueUsesAuthorityOrAmbientInput);
  if ('Call' in value) return value.Call.args.some(serializedValueUsesAuthorityOrAmbientInput);
  if ('Record' in value) {
    return Object.values(value.Record.fields).some(serializedValueUsesAuthorityOrAmbientInput);
  }
  return false;
}

// @ref LLP 0270#d1-default-is-automatic-request-plus-owner-admission — class
// selection is a projection of the closed owner/codegen proof, never an
// authored class marker or an app-authored authority claim.
// @ref LLP 0270#d2-persist-owner-admitted-query-facts-by-default — public,
// ambient-free exact single-table LiveQueries enter the first default-retained
// risk class without requiring authorityIndependent as a retention switch.
function singleTableRqsDigestKind(fn) {
  const plan = fn.runtime?.HostPlan?.Query;
  // Generation derives the served read summary in the same pass that emits
  // requiredCapabilities, while later identity reconstruction receives the
  // already-emitted summary. Consume the same host-owned derivation in both
  // positions; an author-supplied class marker is never consulted.
  const summary = fn.readSetSummary ?? readSummary(fn);
  if (resultContractContainsMedia(fn.resultContract)
    || fn.kind !== 'LiveQuery'
    || fn.authRequirement !== 'public'
    || (fn.uses?.length ?? 0) !== 0
    || (fn.authorizationDependence?.length ?? 0) !== 0
    || !plan
    || plan.tableVisibility !== undefined
    || (plan.membershipFilters?.length ?? 0) !== 0
    || (plan.filters ?? []).some((filter) => serializedValueUsesAuthorityOrAmbientInput(filter.value))
    || summary?.mode !== 'singleTable'
    || summary?.primaryTable !== plan.table
    || summary?.tables?.length !== 1
    || summary.tables[0] !== plan.table
    || summary.authScopeField != null) {
    return null;
  }
  return (plan.order?.length ?? 0) === 0 && plan.limit == null ? 'mset1' : 'seq1';
}

// @ref LLP 0007#dated-owner-amendment-singletableplanv1-portability-2026-08-03 — the
// generated identity uses the closed typed normalization, including explicit
// nulls and the snake_case-to-camelCase `indexedBy` translation.
function normalizeSingleTablePlanV1(plan, rqsDigestKind) {
  return {
    format: 'snapback.single-table-plan.v1',
    query: {
      table: plan.table,
      filters: (plan.filters ?? []).map((filter) => ({
        field: filter.field,
        op: filter.op,
        value: filter.value,
      })),
      membershipFilters: [],
      order: (plan.order ?? []).map((order) => ({
        field: order.field,
        direction: order.direction,
        maxEncodedBytes: order.maxEncodedBytes ?? null,
      })),
      limit: plan.limit ?? null,
      indexedBy: plan.indexed_by ?? null,
    },
    rqsDigestKind,
    examinedEntryCeiling: 1024,
  };
}

function singleNodeIdentityV1(fn) {
  const hostPlan = fn.runtime?.HostPlan;
  const relational = hostPlan?.RelationalQuery;
  const bounded = hostPlan?.BoundedChildrenQuery;
  const rqsDigestKind = singleTableRqsDigestKind(fn);
  const singleTable = rqsDigestKind ? hostPlan.Query : null;
  if (!relational && !bounded && !singleTable) return null;
  const classId = relational
    ? 'relational_query_v1'
    : bounded
      ? 'bounded_children_v1'
      : 'single_table_v1';
  const retention = singleTable
    ? 'rqs-authority-independent-snapshot-v1'
    : relational && fn.retainable === true
      ? fn.retentionClass ?? 'opaque-authorized-snapshot-v1'
      : 'none';
  const normalizedPlan = singleTable
    ? normalizeSingleTablePlanV1(singleTable, rqsDigestKind)
    : relational ?? bounded;
  const argumentBindings = (fn.argsContract?.fields ?? []).map((field) => {
    const contract = {
      format: 'snapback.argument-binding-contract.v1',
      required: field.required,
      value: field.value,
    };
    return {
      name: field.name,
      contract,
      contractHash: compositionDomainHash(
        'snapback:argument-binding-contract:v1:',
        contract,
      ),
    };
  });
  // @ref LLP 0008#decision-dk-3--delta-shape-and-read-lane-2026-07-01 — exact unordered document
  // results may use live_delta, with live_replace retained as the fallback;
  // every ordered or limited result remains replace-only.
  const delivery = singleTable
    && rqsDigestKind === 'mset1'
    && fn.resultContract?.kind === 'documents'
    && fn.resultContract.table === singleTable.table
    ? 'live_delta'
    : 'live_replace';
  const live = fn.kind === 'LiveQuery'
    ? { kind: 'admitted', delivery, pageDomain: 'cursor-free-first-page' }
    : { kind: 'none' };
  const nodePlan = {
    format: 'snapback.node-plan.v1',
    classId,
    classVersion: 1,
    normalizedPlan,
    argumentBindings,
    capability: {
      exportKind: fn.kind,
      live,
      retention,
      requiredCapabilityIds: singleTable
        ? [...new Set(fn.requiredCapabilities ?? [])].sort()
        : [classId],
    },
  };
  const nodePlanHash = compositionDomainHash('snapback:node-plan:v1:', nodePlan);
  const mergedArgs = {
    format: 'snapback.merged-args-contract.v1',
    bindings: argumentBindings.map((binding) => ({ ...binding, sourcePositions: [0] })),
  };
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'single-node.v1',
    nodes: [{ position: 0, nodePlan, nodePlanHash }],
    mergedArgsContractHash: compositionDomainHash(
      'snapback:merged-args-contract:v1:',
      mergedArgs,
    ),
    classification: {
      callable: true,
      live: fn.kind === 'LiveQuery'
        ? live
        : { kind: 'none', delivery: 'none', pageDomain: 'none' },
      invalidation: singleTable
        ? 'proved-disjoint-write-set'
        : fn.kind === 'LiveQuery' ? 'table-granular-resnapshot' : 'none',
      retention,
    },
    parentAuthorizationGroups: [],
  };
  return {
    normalizedCompositePlan,
    planHash: compositionDomainHash('snapback:plan-hash:v1:', normalizedCompositePlan),
  };
}

function functionCompositionIdentityV1(fn) {
  const single = singleNodeIdentityV1(fn);
  if (single) return single;
  const batch = fn.runtime?.HostPlan?.SnapshotBatch
    ?? fn.runtime?.HostPlan?.SnapshotBatchV2;
  if (!batch) return null;
  return {
    normalizedCompositePlan: batch.normalizedCompositePlan,
    planHash: batch.planHash,
  };
}

// LLP 0090's mixed-route successor uses the LLP 0157 identity stack without
// allowing the execution-plan shape to answer whether a child is live. The
// normalized plan deliberately excludes `kind`; the capability binding is
// the sole Query/LiveQuery discriminator. Thus two byte-identical storage
// plans can have distinct NodePlanHashV1 values for the right reason.
// @ref LLP 0157#d2--plan-identity — capability is part of NodePlanRecordV1.
function mixedRouteNodeIdentityV2(fn) {
  const argumentBindings = (fn.argsContract?.fields ?? []).map((field) => {
    const contract = {
      format: 'snapback.argument-binding-contract.v1',
      required: field.required,
      value: field.value,
    };
    return {
      name: field.name,
      contract,
      contractHash: compositionDomainHash(
        'snapback:argument-binding-contract:v1:',
        contract,
      ),
    };
  });
  const requiredCapabilityIds = [...new Set(fn.requiredCapabilities ?? [])].sort();
  const nodePlan = {
    format: 'snapback.node-plan.v1',
    classId: 'exported_query_v1',
    classVersion: 1,
    normalizedPlan: {
      format: 'snapback.exported-query-plan.v1',
      runtime: fn.runtime,
      argsContractHash: fn.argsContractHash,
      resultContractHash: fn.resultContractHash,
      authRequirement: fn.authRequirement,
      authorityIndependent: fn.authorityIndependent === true,
      authorizationDependence: fn.authorizationDependence ?? [],
      readSetSummary: fn.readSetSummary,
      effectCeiling: fn.effectCeiling ?? null,
    },
    argumentBindings,
    capability: {
      exportKind: fn.kind,
      live: fn.kind === 'LiveQuery'
        ? {
            kind: 'admitted',
            delivery: 'live_replace',
            pageDomain: 'whole-result',
          }
        : { kind: 'none' },
      retention: fn.retainable === true
        ? fn.retentionClass ?? 'opaque-authorized-snapshot-v1'
        : 'none',
      requiredCapabilityIds,
    },
  };
  return {
    nodePlan,
    nodePlanHash: compositionDomainHash('snapback:node-plan:v1:', nodePlan),
  };
}

function mixedRouteIdentityV2(routeEntry, functions) {
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const nodes = routeEntry.queries.map((query, position) => {
    const fn = byName.get(query.function);
    if (!fn) throw new TypeError(`mixed route names unknown function ${query.function}`);
    return { position, ...mixedRouteNodeIdentityV2(fn) };
  });
  const mergedArgs = {
    format: 'snapback.mixed-route-args.v2',
    route: routeEntry.route,
    queries: routeEntry.queries,
  };
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'mixed-route.v2',
    nodes,
    mergedArgsContractHash: compositionDomainHash(
      'snapback:mixed-route-args:v2:',
      mergedArgs,
    ),
    classification: {
      callable: true,
      // The group's weakest aggregate is honestly non-live. Individual live
      // children remain explicit in their capability bindings.
      live: { kind: 'none' },
      invalidation: 'none',
      retention: 'none',
    },
    parentAuthorizationGroups: [],
  };
  return {
    formatVersion: 2,
    profile: 'mixed-route.v2',
    normalizedCompositePlan,
    planHash: compositionDomainHash(
      'snapback:plan-hash:v1:',
      normalizedCompositePlan,
    ),
  };
}
// @ref LLP 0057#reservation — SQLite folds ASCII identifier case, so every
// spelling of the protected auth namespace is rejected at authoring time.
const isAuthReservedIdentifier = (name) => {
  const folded = name.toLowerCase();
  return folded === '_auth' || folded.startsWith('_auth_');
};

// @ref LLP 0148#d6-app-document-ids-take-a-per-table-prefix — an app table
// whose derived prefix would shadow a registered system prefix is refused.
// A table named `usr` would mint `usr_…` documents, which makes the
// human-recognition property actively misleading rather than merely imprecise.
// The registry is generated from the Rust `ids::ALL`, so this list cannot
// drift from what the runtime actually mints.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// A source checkout reads the Rust-derived public artifacts in place so tests
// always see the newest committed bytes. Published packages carry the same
// tree under runtime-artifacts/; in an install, REPO_ROOT is node_modules and
// has no repository-level schemas directory.
const TOOLCHAIN_ARTIFACT_ROOT = existsSync(join(REPO_ROOT, 'schemas'))
  ? REPO_ROOT
  : join(dirname(fileURLToPath(import.meta.url)), 'runtime-artifacts');
const ID_REGISTRY = JSON.parse(
  readFileSync(join(TOOLCHAIN_ARTIFACT_ROOT, 'schemas', 'id-registry.v1.json'), 'utf8'),
);
const SYSTEM_ID_PREFIXES = new Set(ID_REGISTRY.kinds.map((entry) => entry.prefix));
const deriveTablePrefix = (name) =>
  [...name]
    .filter((c) => /[A-Za-z0-9]/.test(c))
    .join('')
    .toLowerCase()
    .slice(0, ID_REGISTRY.maxPrefixLength);
const shadowsSystemIdPrefix = (name) => SYSTEM_ID_PREFIXES.has(deriveTablePrefix(name));
const MAX_EPHEMERAL_COLLECTION_NAME_BYTES = 64;
const MAX_EPHEMERAL_SCOPE_FIELDS = 16;
const MAX_EPHEMERAL_SCOPE_KEY_BYTES = 64;
// ECMAScript reserved words (generated modules are always strict-mode code, so
// the strict-only set applies too). Function export names are interpolated
// into emitted declarations (`export function ${name}(`), where a reserved
// word — reachable via `export { f as delete }` — is a syntax error even
// though it passes IDENT. `eval` and `arguments` are not reserved words but
// are equally invalid strict-mode binding names.
const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'eval', 'arguments', '__proto__', 'constructor', 'prototype',
]);
// @ref LLP 0179#existing-exports — standalone query/mutation exports are
// aliases of app.api nodes, so authored names cannot collide with either the
// legacy api module namespaces or the new descriptor binding itself.
const GENERATED_API_RESERVED_EXPORTS = new Set([
  'api',
  'app',
  'artifacts',
  'defaults',
  'ephemeral',
  'groups',
]);
const SCHEMA_VERSION = 'snapback.v0';
const SESSIONS_SCHEMA_VERSION = 'snapback.v1';
const AUTH_MODES = new Set(['dev', 'sessions']);
const APPLICATION_AUTH_BOOTSTRAP_CAPABILITY = 'auth.application-bootstrap.v1';
const AUTH_PASSWORD_IDENTIFIER_MODES = new Set(['username-v1', 'email-v1']);
const AGENT_REGISTRATION_MODES = new Set(['disabled', 'invited', 'open']);
const AGENT_INVITERS = new Set(['operators', 'users']);
const API_DISCLOSURES = new Set(['exposed-only', 'full']);
const API_PAGINATION_LINT_THRESHOLD = 100;
const AUTH_REQUIREMENTS = new Set(['public', 'optional-user', 'authenticated']);
const TARGET_CAPABILITY_IDS = new Set([
  'agent_safe_derived_deployment_fork_v1',
  'agent_safe_storage_v1',
  'auth.sessions.v1',
  'bounded_response_stream_v1',
  'bounded_batch_reads_v1',
  'bounded_children_v1',
  'cron',
  'cron_action_run_mutation',
  'full_text_search_v1',
  'graph_query_v1',
  'live_full_text_search_v1',
  'host_plan_runtime',
  'ibex_ctx_db_host_bridge',
  'inline_handler_v1',
  'jobs_one_off_v1',
  'live_subscriptions',
  'mutation_read_set_validation',
  'mixed_bundle_boot_v2',
  'notifications.expoPushSeam',
  'realtime.connected-client-predicate',
  'permission_epoch_resync',
  'registered_bundle_boot_v1',
  'relational_query_v1',
  'migration_keyset_scan_v1',
  'sequence_allocation_v1',
  'snapshot_batch_v1',
  'snapshot_batch_v2',
  'single_table_v1',
  'structured_stored_value_v1',
  'result_contract_v1',
  'args_contract_v1',
  'assets.media-ref-projection.v1',
  'assets.media-collection.v1',
  'assets.media-command.v1',
  'settlement.bounded_skew',
  'versioned_seed_install_v1',
  'versioned_seed_reset_v1',
  'write_activity_v1',
  'vector_search_v1',
]);
// @ref LLP 0058#capability-maturity — mirror of the Rust registry's
// non-stable maturity table (src/manifest.rs TargetCapabilityId::maturity).
// @ref LLP 0134#9-acceptance — this mirror is checked byte-for-byte against
// Rust's canonical test-mode emission; it is not a second maturity authority.
// Codegen derives requirements from the closed capability table above, so it
// also emits the matching experimental acknowledgment: the generated artifact
// knowingly binds to the not-yet-Accepted contract, and admission refuses an
// experimental requirement with no acknowledgment.
// Remove an id here in the same change that promotes it to stable in Rust
// (bounded_response_stream_v1 left this set when LLP 0076 was Accepted,
// 2026-07-25).
const EXPERIMENTAL_TARGET_CAPABILITY_IDS = new Set([
  'agent_safe_derived_deployment_fork_v1',
  'agent_safe_storage_v1',
  'args_contract_v1',
  'asset_image_finalization_v1',
  'asset_image_pipeline_v1',
  'asset_lifecycle_v1',
  'assets.media-ref-projection.v1',
  'assets.media-collection.v1',
  'assets.media-command.v1',
  'asset_reference_gc_v1',
  'asset_video_finalization_v1',
  'bounded_children_v1',
  'bounded_batch_reads_v1',
  'graph_query_v1',
  'inline_handler_v1',
  'jobs_one_off_v1',
  'live_full_text_search_v1',
  'mixed_bundle_boot_v2',
  'offline_mutation_replay',
  'realtime.connected-client-predicate',
  'sequence_allocation_v1',
  'snapshot_batch_v1',
  'snapshot_batch_v2',
  'single_table_v1',
  'structured_stored_value_v1',
  'registered_bundle_boot_v1',
  'result_contract_v1',
  'versioned_seed_install_v1',
  'versioned_seed_reset_v1',
  'write_activity_v1',
  'vector_search_v1',
]);

export function experimentalTargetCapabilityIdsCanonicalJson() {
  return JSON.stringify([...EXPERIMENTAL_TARGET_CAPABILITY_IDS].sort());
}
const LOCAL_MAX_PENDING_EPHEMERAL_KEYS = 1_024;
const TARGET_PROFILE_LOCAL = 'local-dev-sqlite-ibex';
const TARGET_PROFILE_REMOTE = 'remote-service-sqlite-ibex';
const MICRO_PROFILE_INPUT_FILE = 'micro.profile.json';
const MICRO_PROFILE_REQUIRED_MODULES = Object.freeze([
  'authority-fence',
  'core',
  'operations',
]);
const MICRO_PROFILE_NONCLAIMS = Object.freeze([
  'admin',
  'assets',
  'capability-class',
  'ephemeral-state',
  'generic-storage',
  'hosted-carrier',
  'offline-replay',
  'optimistic-settlement',
  'query-groups',
  'retained-reads',
  'rqs',
  'sessions-auth',
]);
const TARGET_PROFILES = new Map([
  [TARGET_PROFILE_LOCAL, {
    capabilityManifest: 'capability.manifest.local-dev-sqlite-ibex.json',
    outputDirectory: 'generated',
  }],
  [TARGET_PROFILE_REMOTE, {
    capabilityManifest: 'capability.manifest.remote-service-sqlite-ibex.json',
    outputDirectory: 'generated-remote-service',
  }],
]);

function resultContractContainsMedia(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'mediaRef.v1') return true;
  if (Array.isArray(value)) return value.some(resultContractContainsMedia);
  return Object.values(value).some(resultContractContainsMedia);
}
const REMOTE_SERVICE_WIRE_SCHEMAS = Object.freeze({
  queryInput: 'schemas/query.input.schema.json',
  mutationInput: 'schemas/mutation.input.schema.json',
  mutationOutput: 'schemas/mutation.output.schema.json',
  liveEnvelope: 'schemas/live.envelope.schema.json',
  liveSubscribeInput: 'schemas/live.subscribe.input.schema.json',
  liveSubscribeOutput: 'schemas/live.subscribe.output.schema.json',
  liveResumeInput: 'schemas/live.resume.input.schema.json',
  liveResumeOutput: 'schemas/live.resume.output.schema.json',
  liveUnsubscribeInput: 'schemas/live.unsubscribe.input.schema.json',
  liveUnsubscribeOutput: 'schemas/live.unsubscribe.output.schema.json',
  connectionGrant: 'schemas/connection.grant.schema.json',
  connectionOpenInput: 'schemas/connection.open.input.schema.json',
  receipt: 'schemas/receipt.schema.json',
  errorResponse: 'schemas/error.response.schema.json',
});

// Contract data manifest v2 (LLP 0034 D3; Exact LLP 0284 §2.4).
//
// manifestVersion 2 adds the per-descriptor liveness/cost facts additively:
// old consumers ignore the new fields, and the legacy `subscription` field is
// still emitted during the migration (0284 §2.4's emit-both rule). The
// provider-owned poll-fallback floor is the demos' existing 1500 ms cadence.
const PROVIDER_POLL_CADENCE_FLOOR_MS = 1_500;

/// Per-query liveness facts derived once from the definition kind, so the
/// legacy field and the v2 fields cannot silently drift apart inside one
/// binding (`crossCheckContractQueryBinding` re-verifies the emitted object).
function contractQueryLivenessFields(def) {
  const live = def.__kind === 'LiveQuery';
  return {
    // Legacy field (LLP 0263): kept during migration, emit-both.
    subscription: live ? 'initial-snapshot' : 'none',
    // v2 fields (Exact LLP 0284 §2.4).
    mode: live ? 'live' : 'snapshot',
    livePush: live, // D1 wires the live socket as the browser durable transport.
    initialSnapshot: live,
    // Liveness is descriptor policy, not a blanket default: a chatty/expensive
    // LiveQuery may opt out with `defineLiveQuery({ ..., defaultLive: false })`.
    defaultLive: live ? def.defaultLive !== false : false,
    ephemeral: false,
    ...(live
      ? {
          transport: 'push',
          pollCadenceMs: PROVIDER_POLL_CADENCE_FLOOR_MS,
        }
      : {}),
  };
}

/**
 * Migration cross-check (Exact LLP 0284 §2.4; LLP 0034 D3): the legacy
 * `subscription` field and the new liveness fields are both emitted during the
 * migration and MUST agree. Codegen fails loudly (writes nothing) if a future
 * edit changes one emission path without the other. Exported for conformance
 * tests (LLP 0034 §6 check 4).
 */
export function crossCheckContractQueryBinding(name, binding) {
  const mismatches = [];
  if (binding.ephemeral === true) {
    // Ephemeral read descriptors (ENG-22479): always-live push maps; the
    // durable transport/poll rules do not apply. Cross-check the invariant
    // facts instead.
    const expectEphemeral = (field, expected) => {
      if (binding[field] !== expected) {
        mismatches.push(`${field}=${JSON.stringify(binding[field])} must be ${JSON.stringify(expected)} on an ephemeral descriptor`);
      }
    };
    expectEphemeral('subscription', 'initial-snapshot');
    expectEphemeral('mode', 'live');
    expectEphemeral('livePush', true);
    expectEphemeral('initialSnapshot', true);
    expectEphemeral('coalesce', true);
    if (!Number.isInteger(binding.maxDeltaRateHz) || binding.maxDeltaRateHz <= 0) {
      mismatches.push(`maxDeltaRateHz=${JSON.stringify(binding.maxDeltaRateHz)} must be a positive integer`);
    }
    return mismatches.map((message) => ({
      code: 'CONTRACT_MANIFEST_MIGRATION_MISMATCH',
      severity: 'error',
      subsystem: 'contract',
      message: `${name}: ${message}`,
      query: name,
    }));
  }
  const legacyLive = binding.subscription === 'initial-snapshot';
  const expect = (field, expected) => {
    if (binding[field] !== expected) {
      mismatches.push(
        `${field}=${JSON.stringify(binding[field])} disagrees with subscription=${JSON.stringify(binding.subscription)} (expected ${JSON.stringify(expected)})`,
      );
    }
  };
  if (!['initial-snapshot', 'none'].includes(binding.subscription)) {
    mismatches.push(`subscription=${JSON.stringify(binding.subscription)} is not a legacy value this provider emits`);
  }
  expect('mode', legacyLive ? 'live' : 'snapshot');
  expect('livePush', legacyLive);
  expect('initialSnapshot', legacyLive);
  if (!legacyLive && binding.defaultLive !== false) {
    mismatches.push(`defaultLive=${JSON.stringify(binding.defaultLive)} must be false on a snapshot descriptor`);
  }
  if (legacyLive && typeof binding.defaultLive !== 'boolean') {
    mismatches.push(`defaultLive=${JSON.stringify(binding.defaultLive)} must be declared on a live descriptor`);
  }
  if (legacyLive && binding.transport !== 'push') {
    mismatches.push(`transport=${JSON.stringify(binding.transport)} disagrees with livePush=true (expected "push")`);
  }
  if (legacyLive && !(Number.isInteger(binding.pollCadenceMs) && binding.pollCadenceMs >= PROVIDER_POLL_CADENCE_FLOOR_MS)) {
    mismatches.push(`pollCadenceMs=${JSON.stringify(binding.pollCadenceMs)} must be >= the provider floor ${PROVIDER_POLL_CADENCE_FLOOR_MS}`);
  }
  return mismatches.map((message) => ({
    code: 'CONTRACT_MANIFEST_MIGRATION_MISMATCH',
    severity: 'error',
    subsystem: 'contract',
    message: `${name}: ${message}`,
    query: name,
  }));
}

// --- DK-7: validate emitted Snapback-owned artifacts against committed schemas --
//
// LLP 0037 makes the Rust serde types the single source of truth; the JSON
// Schemas under `schemas/` are generated from them and committed. Codegen
// validates each Snapback-owned artifact it emits against those schemas BEFORE
// writing, and fails closed with a structured diagnostic (never a thrown string)
// so a manifest the Rust server would reject cannot be written (the S5.D2 bug
// class). This is a dependency-free STRUCTURAL check of the highest-value
// invariants — required properties, `additionalProperties: false` where the
// schema closes the object, top-level property types, and the
// artifactKind/schemaVersion constants (which are serde defaults, not schema
// consts, so they are pinned here). It is deliberately not a full JSON Schema
// validator: the exhaustive gate is the Rust round-trip in
// `tests/artifact_schemas_v0.rs`, which deserializes every committed manifest
// through the runtime structs. The Exact-owned contract-data manifest is out of
// scope (LLP 0037 scope fence).
//
// @ref LLP 0037#decision-ratified-2026-07-02 — JS codegen validates each artifact
//   it emits against the committed schemas/ before writing; failures are structured
//   diagnostics.
// @ref LLP 0032#decision-docket — DK-7 / P3(c) emit-time validation (defense in depth).
const DEFINITION_PACKAGE_IMPORTS = new Map([
  ['@expo/snapback-codegen/define', join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')],
  ['@expo/snapback-codegen/familiar', join(dirname(fileURLToPath(import.meta.url)), 'familiar.mjs')],
  // Phase B keeps these learned umbrella spellings on the same canonical
  // definition implementation; the thin @expo/snapback package may re-export
  // them without becoming another definition owner.
  ['@expo/snapback/server', join(dirname(fileURLToPath(import.meta.url)), 'familiar.mjs')],
  ['@expo/snapback/values', join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')],
  ['@expo/snapback-codegen/standard-patterns', join(dirname(fileURLToPath(import.meta.url)), 'standard-patterns.mjs')],
]);
const CONTRACT_CAPABILITIES_PATH = fileURLToPath(import.meta.resolve('@expo/snapback-contract/capabilities'));

function loadCommittedSchema(schemaFile) {
  const path = join(TOOLCHAIN_ARTIFACT_ROOT, 'schemas', schemaFile);
  if (!existsSync(path)) {
    return { missing: `committed schema not found at ${path}` };
  }
  try {
    const bytes = resolveFileReadCapability(path, {
      allowedRoots: [TOOLCHAIN_ARTIFACT_ROOT],
      allowSymlink: false,
      codePrefix: 'CODEGEN_COMMITTED_SCHEMA',
    }).read();
    return { schema: JSON.parse(decodeUtf8Source(bytes, path, 'CODEGEN_COMMITTED_SCHEMA')) };
  } catch (cause) {
    return { missing: `committed schema ${schemaFile} is not valid JSON: ${cause.message}` };
  }
}

// schemars inlines the root type at the top level (properties/required present),
// but a $ref root is possible; follow one same-document $ref into $defs.
function schemaRootNode(schema) {
  if (schema && typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const name = schema.$ref.slice('#/$defs/'.length);
    return (schema.$defs || {})[name] || schema;
  }
  return schema;
}

function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value; // string | boolean | object
}

function typeMatches(propSchema, value) {
  // Enforce only a declared concrete top-level type; skip $ref/oneOf/anyOf/absent
  // (those are covered exhaustively by the Rust round-trip gate).
  const expected = propSchema && propSchema.type;
  const actual = jsonTypeOf(value);
  const ok = (t) => t === actual || (t === 'number' && actual === 'integer');
  if (typeof expected === 'string') return ok(expected);
  if (Array.isArray(expected)) return expected.some(ok);
  return true;
}

function validateSchemaAuthDefinition(schemaDef, err) {
  const auth = schemaDef.auth;
  if (auth === undefined) {
    validateAuthoredRequiredCapabilities(schemaDef.requiredCapabilities, err);
    return 'dev';
  }
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    err('SCHEMA_AUTH_MODE_INVALID', 'auth', 'schema auth must be an object containing mode and optional agents', {});
    return 'dev';
  }
  const keys = Object.keys(auth);
  if (!Object.hasOwn(auth, 'mode') || keys.some((key) => !['mode', 'agents', 'passwordIdentifierMode', 'passwordMinimumLength'].includes(key)) || !AUTH_MODES.has(auth.mode)) {
    err('SCHEMA_AUTH_MODE_INVALID', 'auth', 'schema auth accepts mode: dev | sessions, optional agents, and generated password policy fields', { authMode: auth.mode });
  }
  if (auth.passwordIdentifierMode !== undefined
    && (auth.mode !== 'sessions' || !AUTH_PASSWORD_IDENTIFIER_MODES.has(auth.passwordIdentifierMode))) {
    err(
      'SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_INVALID',
      'auth',
      'auth passwordIdentifierMode must be username-v1 or email-v1 in sessions mode',
      { passwordIdentifierMode: auth.passwordIdentifierMode },
    );
  }
  if (
    auth.passwordMinimumLength !== undefined
    && (
      auth.mode !== 'sessions'
      || !Number.isSafeInteger(auth.passwordMinimumLength)
      || auth.passwordMinimumLength < 8
      || auth.passwordMinimumLength > 128
    )
  ) {
    err(
      'SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID',
      'auth',
      'auth passwordMinimumLength must be a safe integer from 8 through 128 in sessions mode',
      { passwordMinimumLength: auth.passwordMinimumLength },
    );
  }
  if (auth.agents !== undefined) {
    const agents = auth.agents;
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)
      || Object.keys(agents).some((key) => !['mode', 'invitedBy'].includes(key))
      || !AGENT_REGISTRATION_MODES.has(agents.mode)
      || !AGENT_INVITERS.has(agents.invitedBy)) {
      err('SCHEMA_AUTH_AGENTS_INVALID', 'auth', 'schema auth.agents accepts mode: disabled | invited | open and invitedBy: operators | users', {});
    }
    if (auth.mode !== 'sessions') {
      err('SNAPBACK_AUTH_AGENT_POLICY_MODE_INVALID', 'auth', 'auth.agents requires auth.mode sessions', { authMode: auth.mode });
    }
  }
  validateAuthoredRequiredCapabilities(schemaDef.requiredCapabilities, err);
  return AUTH_MODES.has(auth.mode) ? auth.mode : 'dev';
}

function compileAuthProgramReadiness(schemaDef, functionsModule, err) {
  const program = schemaDef.authProgram;
  if (program === undefined) return null;
  if (schemaDef.auth?.mode !== 'sessions' || program.version !== 1) {
    err('SNAPBACK_AUTH_PROGRAM_INVALID', 'auth', 'authProgram requires sessions mode and program version 1', {});
    return null;
  }
  const aliases = new Map(Object.entries(program.assuranceRequirements ?? {}));
  const declaredEmailAdapters = [...new Set(
    Object.values(program.mechanisms ?? {})
      .filter((mechanism) => mechanism?.kind === 'email-code')
      .map((mechanism) => mechanism.delivery),
  )].sort();
  const expand = (name, trail = new Set()) => {
    if (AUTH_ASSURANCE_KINDS.has(name)) return [name];
    if (trail.has(name) || !aliases.has(name)) return null;
    const next = new Set(trail).add(name);
    const expanded = [];
    for (const child of aliases.get(name).allOf ?? []) {
      const kinds = expand(child, next);
      if (kinds === null) return null;
      expanded.push(...kinds);
    }
    return [...new Set(expanded)].sort();
  };
  const requiredByKind = new Map();
  for (const [name, definition] of Object.entries(functionsModule)) {
    if (!definition?.__kind || definition.requires === undefined) continue;
    if (definition.auth !== 'authenticated') {
      err('SNAPBACK_AUTH_ASSURANCE_REQUIRES_AUTHENTICATED', 'auth', `${name}: assurance requirements require auth: authenticated`, { function: name });
      continue;
    }
    for (const requirement of definition.requires) {
      const kinds = expand(requirement);
      if (kinds === null) {
        err('SNAPBACK_AUTH_ASSURANCE_REQUIREMENT_INVALID', 'auth', `${name}: unknown or cyclic assurance requirement ${requirement}`, { function: name, requirement });
        continue;
      }
      for (const kind of kinds) {
        if (!requiredByKind.has(kind)) requiredByKind.set(kind, []);
        requiredByKind.get(kind).push(name);
      }
    }
  }
  const requiredAssuranceProducers = {};
  for (const [kind, names] of [...requiredByKind].sort(([left], [right]) => left.localeCompare(right))) {
    requiredAssuranceProducers[kind] = {
      requiredBy: [...new Set(names)].sort(),
      declaredDeliveryAdapters: kind === 'email_verified' ? declaredEmailAdapters : [],
      importEnabled: false,
      rehearsalAvailable: true,
    };
  }
  const deliveryChannels = declaredEmailAdapters.length === 0 ? {} : {
    email: {
      declared: true,
      configured: false,
      available: false,
      assuranceClass: 'contact-ownership',
      missingSecretReferences: [],
    },
  };
  const deliveryRequired = requiredByKind.has('email_verified') || requiredByKind.has('phone_verified');
  return {
    programVersion: 1,
    catalogRequired: 3,
    declarationValid: true,
    assuranceRequirementsCompiled: true,
    verifiedProvisioningDeclared: program.verifiedProvisioning !== undefined,
    // The declaration compiles the ordinary-write seal only. The host-invoked,
    // host-injected provisioning writer in LLP 0214 §§5.3–5.5 is not wired.
    verifiedProvisioningCompiled: false,
    claimsProjectionCompiled: true,
    requiredAssuranceProducers,
    deliveryChannels,
    noDeliveryCheck: { enforced: false, satisfied: !deliveryRequired },
  };
}

function visibilityAdmitsAnonymousPublic(visibility) {
  if (visibility?.kind === 'public-read') return true;
  return visibility?.kind === 'any-of'
    && Array.isArray(visibility.arms)
    && visibility.arms.some(visibilityAdmitsAnonymousPublic);
}

// @ref LLP 0258#d1-generate-one-non-secret-bootstrap-policy — this is a
// projection of the normalized auth/schema/function program, never a second
// authored policy. Unsupported normalized facts refuse rather than narrowing.
function deriveApplicationAuthBootstrapV1({
  appId,
  authMode,
  authoringProfile,
  authProgram,
  functions,
  tables,
  err,
}) {
  if (authMode !== 'sessions') return undefined;
  let refused = false;
  const refuse = (message, details) => {
    refused = true;
    err(
      'SNAPBACK_AUTH_PROGRAM_INVALID',
      'auth',
      message,
      details,
    );
  };
  const custody = authProgram?.custody ?? 'durable-required';
  if (custody !== 'durable-required' && custody !== 'volatile-explicit') {
    refuse('normalized auth custody cannot be represented by ApplicationAuthBootstrapV1', {
      custody,
      allowed: ['durable-required', 'volatile-explicit'],
    });
  }
  if (authoringProfile === FAMILIAR_AUTHORING_PROFILE && custody !== 'durable-required') {
    refused = true;
    err(
      'SNAPBACK_AUTH_PROGRAM_INVALID',
      'auth',
      'snapback-familiar-ts-v1 fixes auth custody to durable-required; use the explicit profile for volatile-explicit',
      { custody, allowed: ['durable-required'] },
    );
  }
  if (authProgram?.externalSessionEntry !== undefined
    && authProgram.externalSessionEntry !== true) {
    refuse('normalized externalSessionEntry must be the explicit literal true', {
      externalSessionEntry: authProgram.externalSessionEntry,
    });
  }
  const admittedEntries = new Set();
  const mechanisms = authProgram?.mechanisms ?? {};
  let hasGuestMechanism = false;
  if (!mechanisms || typeof mechanisms !== 'object' || Array.isArray(mechanisms)) {
    refuse('normalized auth mechanisms must be an object map', {});
  } else {
    for (const [name, mechanism] of Object.entries(mechanisms)) {
      if (mechanism?.kind === 'password') admittedEntries.add('password-v1');
      else if (mechanism?.kind === 'email-code') admittedEntries.add('email-code-v1');
      else if (mechanism?.kind === 'guest') {
        hasGuestMechanism = true;
        if (authProgram?.guestPolicy?.enabled !== true) {
          refuse('guest mechanisms require an enabled generated guest policy', {
            mechanism: name,
          });
        }
        admittedEntries.add('guest-v1');
      } else if (mechanism?.kind === 'passkey') {
        // The passkey slot is deliberately not an application entry mechanism
        // until its end-to-end transition exists.
      } else {
        refuse('normalized auth mechanism cannot be represented by ApplicationAuthBootstrapV1', {
          mechanism: name,
          kind: mechanism?.kind ?? null,
        });
      }
    }
  }
  if (authProgram?.guestPolicy?.enabled === true && !hasGuestMechanism) {
    refuse('enabled guest policy requires a declared guest mechanism', {});
  }
  if (authProgram?.externalSessionEntry === true) {
    admittedEntries.add('external-session-explicit-v1');
  }
  if (refused) return null;
  const operationAllowsAnonymous = (functions ?? []).some((fn) => {
    const requirement = fn.authRequirement ?? 'optional-user';
    return requirement === 'public' || requirement === 'optional-user';
  });
  const tableAllowsAnonymous = Object.values(tables ?? {})
    .some((table) => visibilityAdmitsAnonymousPublic(table.visibility));
  return {
    format: APPLICATION_AUTH_BOOTSTRAP_FORMAT,
    appId,
    mode: 'sessions',
    custody,
    entryMechanisms: APPLICATION_AUTH_BOOTSTRAP_ENTRY_MECHANISMS
      .filter((entry) => admittedEntries.has(entry)),
    anonymousPublic: operationAllowsAnonymous || tableAllowsAnonymous ? 'allowed' : 'refused',
    lifecycleProtocol: 1,
  };
}

function validApiOrigin(origin) {
  if (typeof origin !== 'string' || origin.includes('*') || !/^https?:\/\/[^/?#]+$/u.test(origin)) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

function validateSchemaApiDefinition(schemaDef, authMode, err) {
  const api = schemaDef.api;
  if (api === undefined) return null;
  if (!api || typeof api !== 'object' || Array.isArray(api)) {
    err('SNAPBACK_API_MANIFEST_INVALID', 'api', 'schema api must be an object', {});
    return null;
  }
  const allowed = new Set(['enabled', 'disclosure', 'functions', 'origins', 'oauth', 'ask', 'budgets', '__agentsModeExplicit']);
  const shapeValid = !Object.keys(api).some((key) => !allowed.has(key))
    && typeof api.enabled === 'boolean'
    && API_DISCLOSURES.has(api.disclosure)
    && api.functions && typeof api.functions === 'object' && !Array.isArray(api.functions);
  if (!shapeValid) {
    err('SNAPBACK_API_MANIFEST_INVALID', 'api', 'schema api accepts enabled, disclosure, functions, origins, oauth, ask, and budgets', {});
    return null;
  }
  if (api.enabled === true && api.__agentsModeExplicit !== true) {
    err(
      'SNAPBACK_API_REGISTRATION_POSTURE_REQUIRED',
      'api',
      'api.enabled requires both auth.mode sessions and an explicit auth.agents.mode declaration',
      {},
    );
  } else if (authMode !== 'sessions') {
    err('SNAPBACK_API_AUTH_MODE_INVALID', 'api', 'the api block requires auth.mode sessions', { authMode });
  }
  for (const [name, exposure] of Object.entries(api.functions ?? {})) {
    if (!exposure || typeof exposure !== 'object' || Array.isArray(exposure)
      || Object.keys(exposure).some((key) => !['expose', 'since', 'approval'].includes(key))
      || typeof exposure.expose !== 'boolean'
      || (exposure.since !== undefined && typeof exposure.since !== 'string')
      || (exposure.approval !== undefined
        && exposure.approval !== 'required' && exposure.approval !== 'external')) {
      err('SNAPBACK_API_FUNCTION_EXPOSURE_INVALID', 'api', `api.functions.${name} must contain expose: boolean, optional since: string, and optional approval: required | external`, { function: name });
    } else if (exposure.approval !== undefined && exposure.expose !== true) {
      err('SNAPBACK_API_APPROVAL_REQUIRES_EXPOSURE', 'api', `api.functions.${name}.approval requires expose: true`, { function: name });
    }
  }
  if (api.origins !== undefined) {
    if (!Array.isArray(api.origins)) {
      err('SNAPBACK_API_ORIGIN_INVALID', 'api', 'api.origins must be an array of exact http(s) origins', {});
    } else {
      for (const origin of api.origins) {
        if (!validApiOrigin(origin)) {
          err('SNAPBACK_API_ORIGIN_INVALID', 'api', `api origin ${JSON.stringify(origin)} must be an exact http(s) scheme+host+port origin without wildcards`, { origin });
        }
      }
    }
  }
  if (api.oauth !== undefined) {
    const oauth = api.oauth;
    const oauthShapeValid = oauth && typeof oauth === 'object' && !Array.isArray(oauth)
      && !Object.keys(oauth).some((key) => !['enabled', 'bearer', 'bundles'].includes(key))
      && typeof oauth.enabled === 'boolean'
      && typeof oauth.bearer === 'boolean'
      && oauth.bundles && typeof oauth.bundles === 'object' && !Array.isArray(oauth.bundles);
    if (!oauthShapeValid) {
      err('SNAPBACK_API_OAUTH_MANIFEST_INVALID', 'api', 'api.oauth accepts enabled, bearer, and bundles', {});
    } else {
      if (oauth.enabled && !api.enabled) {
        err('SNAPBACK_API_OAUTH_REQUIRES_API', 'api', 'api.oauth.enabled requires api.enabled; enable both declarations', {});
      }
      if (oauth.enabled && !oauth.bearer) {
        err('SNAPBACK_API_OAUTH_BEARER_OPT_IN_REQUIRED', 'api', 'the OAuth facade is bearer-only in v1; set api.oauth.bearer true to acknowledge the shorter-lived bearer weakening', {});
      }
      for (const [bundleName, bundle] of Object.entries(oauth.bundles)) {
        const validName = bundleName.length > 0 && bundleName.length <= 128
          && [...bundleName].every((character) => {
            const code = character.codePointAt(0);
            return code === 0x21 || (code >= 0x23 && code <= 0x5b) || (code >= 0x5d && code <= 0x7e);
          });
        const validFunctions = bundle && typeof bundle === 'object' && !Array.isArray(bundle)
          && Object.keys(bundle).every((key) => key === 'functions')
          && Array.isArray(bundle.functions)
          && bundle.functions.length >= 1 && bundle.functions.length <= 128
          && bundle.functions.every((fn) => typeof fn === 'string')
          && new Set(bundle.functions).size === bundle.functions.length;
        if (!validName || !validFunctions) {
          err('SNAPBACK_API_OAUTH_BUNDLES_INVALID', 'api', `api.oauth bundle ${JSON.stringify(bundleName)} must use an OAuth scope-token name and contain 1..=128 unique function names`, { bundle: bundleName });
        }
      }
    }
  }
  if (api.ask !== undefined) {
    const ask = api.ask;
    const askShapeValid = ask && typeof ask === 'object' && !Array.isArray(ask)
      && !Object.keys(ask).some((key) => !['enabled', 'billing', 'model'].includes(key))
      && typeof ask.enabled === 'boolean'
      && (ask.billing === 'app' || ask.billing === 'caller-key');
    if (!askShapeValid) {
      err('SNAPBACK_API_ASK_MANIFEST_INVALID', 'api', 'api.ask requires enabled: boolean, billing: app | caller-key, and optional model', {});
    } else {
      if (ask.enabled && !api.enabled) {
        err('SNAPBACK_API_ASK_REQUIRES_API', 'api', 'api.ask.enabled requires api.enabled', {});
      }
      if (ask.model !== undefined) {
        const model = ask.model;
        if (!model || typeof model !== 'object' || Array.isArray(model)
          || Object.keys(model).some((key) => !['provider', 'model', 'secret'].includes(key))
          || typeof model.provider !== 'string' || model.provider.length === 0
          || typeof model.model !== 'string' || model.model.length === 0
          || (model.secret !== undefined && (typeof model.secret !== 'string' || model.secret.length === 0))) {
          err('SNAPBACK_API_ASK_MODEL_INVALID', 'api', 'api.ask.model requires non-empty provider/model and an optional LLP 0036 secret entry name', {});
        }
        if (ask.billing === 'caller-key' && model?.secret !== undefined) {
          err('SNAPBACK_API_ASK_MODEL_INVALID', 'api', 'caller-key ask billing must carry its provider credential on X-Snapback-Ask-Provider-Key, not name an app secret', {});
        }
      }
    }
  }
  if (api.budgets !== undefined) {
    const budgets = api.budgets;
    if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)
      || Object.keys(budgets).some((key) => key !== 'ask')) {
      err('SNAPBACK_API_BUDGETS_INVALID', 'api', 'api.budgets accepts only the optional ask budget block', {});
    } else if (budgets.ask !== undefined) {
      const ask = budgets.ask;
      const positive = (value) => Number.isSafeInteger(value) && value > 0;
      const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every((key) => keys.includes(key));
      const complete = exact(ask, ['perRequest', 'perPrincipalDay', 'perIntegrationDay', 'appMonthly', 'resultVolume'])
        && exact(ask.perRequest, ['maxTokens', 'maxSteps', 'maxWallMs'])
        && ['maxTokens', 'maxSteps', 'maxWallMs'].every((key) => positive(ask.perRequest[key]))
        && exact(ask.perPrincipalDay, ['maxTokens']) && positive(ask.perPrincipalDay.maxTokens)
        && (ask.perIntegrationDay === undefined
          || (exact(ask.perIntegrationDay, ['maxTokens']) && positive(ask.perIntegrationDay.maxTokens)))
        && exact(ask.appMonthly, ['maxTokens']) && positive(ask.appMonthly.maxTokens)
        && exact(ask.resultVolume, ['maxBytes', 'maxRows', 'perPrincipalDayBytes'])
        && ['maxBytes', 'maxRows', 'perPrincipalDayBytes'].every((key) => positive(ask.resultVolume[key]));
      if (!complete) {
        err('SNAPBACK_API_ASK_BUDGETS_INVALID', 'api', 'api.budgets.ask requires perRequest.{maxTokens,maxSteps,maxWallMs}, perPrincipalDay.maxTokens, appMonthly.maxTokens, and resultVolume.{maxBytes,maxRows,perPrincipalDayBytes}; perIntegrationDay.maxTokens is optional', {});
      }
    }
  }
  if (api.ask?.enabled === true && api.budgets?.ask === undefined) {
    err(
      'SNAPBACK_API_ASK_BUDGETS_REQUIRED',
      'api',
      'api.ask.enabled requires api.budgets.ask.perRequest, api.budgets.ask.perPrincipalDay, api.budgets.ask.appMonthly, and api.budgets.ask.resultVolume',
      {},
    );
  }
  return {
    enabled: api.enabled,
    disclosure: api.disclosure,
    functions: api.functions,
    ...(api.origins !== undefined ? { origins: [...api.origins] } : {}),
    ...(api.oauth !== undefined ? { oauth: structuredClone(api.oauth) } : {}),
    ...(api.ask !== undefined ? { ask: structuredClone(api.ask) } : {}),
    ...(api.budgets !== undefined ? { budgets: structuredClone(api.budgets) } : {}),
  };
}

function compileApiExposure(api, functions, err, diagnostics) {
  if (!api) return;
  const functionsByName = new Map(functions.map((fn) => [fn.name, fn]));
  for (const name of Object.keys(api.functions)) {
    if (!functionsByName.has(name)) {
      err('SNAPBACK_API_FUNCTION_UNKNOWN', 'api', `api.functions names unknown function ${name}`, { function: name });
    } else if (api.functions[name].approval !== undefined
      && (functionsByName.get(name).kind === 'Query' || functionsByName.get(name).kind === 'LiveQuery')) {
      err('SNAPBACK_API_APPROVAL_QUERY_INVALID', 'api', `api.functions.${name}.approval is valid only for mutations and actions`, { function: name });
    }
  }
  for (const [bundleName, bundle] of Object.entries(api.oauth?.bundles ?? {})) {
    for (const name of bundle.functions) {
      if (!functionsByName.has(name)) {
        err('SNAPBACK_API_OAUTH_FUNCTION_UNKNOWN', 'api', `api.oauth.bundles.${bundleName}.functions names unknown function ${name}`, { bundle: bundleName, function: name });
      } else if (api.functions[name]?.expose !== true) {
        err('SNAPBACK_API_OAUTH_FUNCTION_NOT_EXPOSED', 'api', `api.oauth bundle ${bundleName} names unexposed function ${name}; expose it in api.functions`, { bundle: bundleName, function: name });
      }
    }
  }
  if (!api.enabled) return;
  for (const fn of functions) {
    const exposure = api.functions[fn.name] ?? { expose: false };
    fn.apiExposure = {
      expose: exposure.expose,
      ...(exposure.since !== undefined ? { since: exposure.since } : {}),
      ...(exposure.approval !== undefined ? { approval: exposure.approval } : {}),
    };
    const rows = fn.resultContract?.kind === 'records' ? fn.resultContract.rows : null;
    const hasContinuation = (fn.argsContract?.fields ?? []).some(
      (field) => field.name === 'cursor' || field.name === 'continuation',
    );
    if (exposure.expose === true
      && (fn.kind === 'Query' || fn.kind === 'LiveQuery')
      && Number.isSafeInteger(rows?.maxItems)
      && rows.maxItems > API_PAGINATION_LINT_THRESHOLD
      && !hasContinuation) {
      diagnostics.push({
        code: 'SNAPBACK_API_PAGINATION_RECOMMENDED',
        severity: 'warning',
        subsystem: 'api',
        message: `exposed query ${fn.name} declares rows.maxItems ${rows.maxItems} (> ${API_PAGINATION_LINT_THRESHOLD}) without a cursor or continuation argument`,
        details: { function: fn.name, maxItems: rows.maxItems, threshold: API_PAGINATION_LINT_THRESHOLD },
      });
    }
  }
}

function resultContractRowHasField(contract, field) {
  const row = contract?.kind === 'documents' || contract?.kind === 'document'
    ? contract.document
    : contract?.kind === 'records'
      ? contract.record
      : contract?.kind === 'value'
        ? contract.value
      : contract?.kind === 'legacyQueryRowsV0'
        ? contract.row
        : null;
  if (row?.kind === 'object') {
    return row.fields.some((candidate) => candidate.name === field);
  }
  if (
    row?.kind === 'union'
    && row.variants.length > 0
    && row.variants.every((variant) => variant.kind === 'object')
  ) {
    return row.variants.every(
      (variant) => variant.fields.some((candidate) => candidate.name === field),
    );
  }
  return null;
}

function validateAuthoredRequiredCapabilities(required, err) {
  if (required === undefined) return;
  if (!Array.isArray(required)) {
    err('SCHEMA_REQUIRED_CAPABILITIES_INVALID', 'capability', 'schema requiredCapabilities must be an array', {});
    return;
  }
  for (const capability of required) {
    if (typeof capability !== 'string' || !TARGET_CAPABILITY_IDS.has(capability)) {
      err('SNAPBACK_CAPABILITY_UNSUPPORTED', 'capability', `unknown required target capability ${String(capability)}`, { capability });
    }
  }
}

function validateTargetArtifactAuthSupport(manifest, version, authMode, required, err) {
  for (const problem of targetArtifactAuthProblems(manifest, version, authMode, required)) {
    err(problem.code, 'capability', problem.message, problem.details);
  }
}

export function targetArtifactAuthProblems(manifest, version, authMode, required) {
  // @ref LLP 0058#the-two-admissible-tuples — dimension arrays do not grant
  // their Cartesian product; the exact pair and every positive capability do.
  const problems = [];
  const versions = Array.isArray(manifest.supportedArtifactVersions)
    ? manifest.supportedArtifactVersions
    : [];
  const modes = Array.isArray(manifest.supportedAuthModes)
    ? manifest.supportedAuthModes
    : [];
  const pairs = Array.isArray(manifest.supportedArtifactAuthPairs)
    ? manifest.supportedArtifactAuthPairs
    : [];
  const supported = new Set(Array.isArray(manifest.supportedCapabilities)
    ? manifest.supportedCapabilities
    : []);

  const pairSupported = versions.includes(version)
    && modes.includes(authMode)
    && pairs.some((pair) => pair?.schemaVersion === version && pair?.authMode === authMode);
  if (!pairSupported) {
    problems.push({
      code: 'CODEGEN_ARTIFACT_AUTH_PAIR_UNSUPPORTED',
      message: `target ${manifest.targetProfileId ?? 'unknown'} does not support ${version} + ${authMode}`,
      details: { schemaVersion: version, authMode },
    });
  }

  for (const capability of required) {
    if (!TARGET_CAPABILITY_IDS.has(capability) || !supported.has(capability)) {
      problems.push({
        code: 'SNAPBACK_CAPABILITY_UNSUPPORTED',
        message: capabilityUnsupportedMessage(
          `target ${manifest.targetProfileId ?? 'unknown'} does not support required capability ${capability}`,
        ),
        details: { capability },
      });
    }
  }
  return problems;
}

// Returns { missing?, problems: [] }. `expected` pins the artifactKind and
// schemaVersion constants the derived schema cannot express (serde defaults).
function validateArtifactAgainstSchema(schemaFile, instance, expected) {
  const loaded = loadCommittedSchema(schemaFile);
  if (loaded.missing) return { missing: loaded.missing, problems: [] };
  const root = schemaRootNode(loaded.schema) || {};
  const properties = root.properties || {};
  const problems = [];
  for (const key of Array.isArray(root.required) ? root.required : []) {
    if (!(key in instance)) problems.push(`missing required property "${key}"`);
  }
  if (root.additionalProperties === false) {
    for (const key of Object.keys(instance)) {
      if (!(key in properties)) problems.push(`unexpected property "${key}" (schema closes the object)`);
    }
  }
  for (const [key, value] of Object.entries(instance)) {
    if (properties[key] && !typeMatches(properties[key], value)) {
      problems.push(`property "${key}" is ${jsonTypeOf(value)} but the schema requires ${JSON.stringify(properties[key].type)}`);
    }
  }
  if (expected.artifactKind !== undefined && instance.artifactKind !== expected.artifactKind) {
    problems.push(`artifactKind is ${JSON.stringify(instance.artifactKind)}, expected ${JSON.stringify(expected.artifactKind)}`);
  }
  if (expected.schemaVersion !== undefined && instance.schemaVersion !== expected.schemaVersion) {
    problems.push(`schemaVersion is ${JSON.stringify(instance.schemaVersion)}, expected ${JSON.stringify(expected.schemaVersion)}`);
  }
  return { problems };
}

// Public API calls run generation in a fresh process. Native ESM caches every
// transitive module by URL; changing a helper while keeping schema.mjs itself
// unchanged otherwise reuses stale objects on the second generate() call.
export async function generate(backendDir, options = {}) {
  const workerPath = fileURLToPath(new URL('./generate-worker.mjs', import.meta.url));
  return new Promise((resolveResult) => {
    const child = fork(workerPath, [resolve(backendDir), JSON.stringify(options)], {
      // The cache-busting worker is a deterministic tool boundary. Caller
      // flags such as --eval/--input-type/--require/--inspect are not valid
      // worker arguments, and NODE_OPTIONS/preload credentials are not inputs.
      execArgv: [],
      cwd: REPO_ROOT,
      env: codegenWorkerEnvironment(),
      // No inherited stdin/stdout; stderr remains the human diagnostic lane,
      // while the single structured result travels over the dedicated IPC fd.
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let settled = false;
    child.once('message', (result) => {
      settled = true;
      resolveResult(result);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      resolveResult(codegenWorkerFailure(error));
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      resolveResult(codegenWorkerFailure(new Error(`codegen worker exited before returning a result (code ${code}, signal ${signal})`)));
    });
  });
}

function codegenWorkerEnvironment() {
  const allowed = new Set([
    // Explicit codegen inputs.
    'SNAPBACK_OUTBOUND_ACTIONS',
    'SNAPBACK_GENERATED_AT_MS',
    'SOURCE_DATE_EPOCH',
    // Minimal process-launch/temp plumbing, preserving the host's key casing.
    'PATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]);
  const environment = Object.create(null);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) environment[key] = value;
  }
  return environment;
}

export async function generateInProcess(backendDir, options = {}, testHooks = undefined) {
  const diagnostics = [];
  // Non-blocking info diagnostics carried into the generated function
  // manifest (today: the MUTATION_OUTGREW_IR tier-ladder declarations).
  const infoDiagnostics = [];
  const err = (code, subsystem, message, extra = {}) => diagnostics.push({
    code,
    severity: 'error',
    subsystem,
    message: code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
      ? capabilityUnsupportedMessage(message)
      : message,
    ...handlerDiagnosticDetails(code),
    ...extra,
  });
  const warn = (code, subsystem, message, extra = {}) => diagnostics.push({
    code,
    severity: 'warning',
    subsystem,
    message,
    ...extra,
  });

  const targetProfile = options?.targetProfile ?? TARGET_PROFILE_LOCAL;
  // @ref LLP 0237#d5-preflight-is-available-before-generation — both normal
  // generation and --check enter this one full checker; only the final
  // complete-graph publication step differs.
  const checkOnly = options?.check === true;
  const targetConfig = TARGET_PROFILES.get(targetProfile);
  if (!targetConfig
      || (options?.check !== undefined && typeof options.check !== 'boolean')
      || Object.keys(options ?? {}).some((key) => !['targetProfile', 'check'].includes(key))) {
    err('CODEGEN_TARGET_PROFILE_UNSUPPORTED', 'codegen', `unsupported target profile ${String(targetProfile)}`, {
      targetProfile,
      supported: [...TARGET_PROFILES.keys()],
    });
    return { ok: false, diagnostics };
  }

  let backendRoot;
  try {
    backendRoot = realpathSync(backendDir);
  } catch (error) {
    err('CODEGEN_BACKEND_UNREADABLE', 'codegen', `backend directory ${backendDir} could not be resolved: ${error.message}`, { path: backendDir });
    return { ok: false, diagnostics };
  }
  try {
    return await withCodegenGenerationLock(
      backendRoot,
      () => generateInProcessLocked({
        backendRoot,
        targetProfile,
        targetConfig,
        diagnostics,
        infoDiagnostics,
        err,
        warn,
        checkOnly,
        testHooks,
      }),
      testHooks?.generationLock,
    );
  } catch (error) {
    if (!error?.codegenGenerationLockFailure) throw error;
    return { ok: false, diagnostics: [error.diagnostic] };
  }
}

async function generateInProcessLocked({
  backendRoot,
  targetProfile,
  targetConfig,
  diagnostics,
  infoDiagnostics,
  err,
  warn,
  checkOnly,
  testHooks,
}) {
  // @ref LLP 0253#s11-selection — profile selection precedes source
  // discovery. Reading it after explicit entry evaluation would make the
  // familiar lane a selectable label over the wrong source graph.
  const codegenPolicy = readCodegenPolicy(backendRoot, diagnostics, err);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const authoringProfile = codegenPolicy.authoringProfile;
  const legacyGeneratedDirectory = join(backendRoot, '_generated');
  try {
    lstatSync(legacyGeneratedDirectory);
    err(
      'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY',
      'codegen',
      `${legacyGeneratedDirectory} is the retired generated-artifact spelling; remove it (including symlinks) and use ${join(backendRoot, 'generated')} only`,
      {
        path: legacyGeneratedDirectory,
        canonicalPath: join(backendRoot, 'generated'),
        reason: 'one-generated-directory-no-watcher-aliases',
      },
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      err(
        'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY_UNREADABLE',
        'codegen',
        `${legacyGeneratedDirectory} could not be checked: ${error.message}`,
        { path: legacyGeneratedDirectory },
      );
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const sourceLayout = discoverAuthoringSources(backendRoot, authoringProfile, err);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const schemaPath = sourceLayout.schemaPath;
  const functionsPath = sourceLayout.functionsPath;
  const seedPath = join(backendRoot, 'seed.json');
  const handlerSourceCache = new Map();
  const definitionSourceOverrides = new Map();
  let schemaSourceOverride = null;
  let functionsSource = sourceLayout.functionsSource ?? null;
  let familiarBootstrap = null;
  let inlineExtraction;
  let functionDefinitionAttribution;
  let familiarFunctionSourceSpans = null;

  if (authoringProfile === FAMILIAR_AUTHORING_PROFILE) {
    familiarBootstrap = synthesizeFamiliarBootstrap(
      backendRoot,
      sourceLayout.operations.map(({ name }) => name),
    );
    const schemaSource = readDefinitionSource(schemaPath, backendRoot, 'SCHEMA_SOURCE');
    const erasedSchema = eraseFamiliarDefinitionSource(schemaSource, schemaPath, diagnostics);
    if (erasedSchema) {
      schemaSourceOverride = erasedSchema.javascript;
      definitionSourceOverrides.set(resolve(schemaPath), erasedSchema);
    }
    const functionModulePaths = new Set(
      sourceLayout.functionModules.map(({ path }) => resolve(path)),
    );
    // @ref LLP 0253#s2-familiar-source-layout-and-discovery — helper modules
    // use the same pinned LLP 0246 erasure and graph identity as schema and
    // function modules; esbuild never becomes an implicit second TS profile.
    for (const path of familiarTypeScriptFiles(backendRoot)) {
      if (resolve(path) === resolve(schemaPath) || functionModulePaths.has(resolve(path))) continue;
      const source = readDefinitionSource(path, backendRoot);
      const erased = eraseFamiliarDefinitionSource(source, path, diagnostics);
      if (erased) definitionSourceOverrides.set(resolve(path), erased);
    }
    const handlers = new Map();
    const authorizationEvaluators = new Map();
    const attributionDefinitions = [];
    const attributionProperties = new Map();
    familiarFunctionSourceSpans = {};
    for (const module of sourceLayout.functionModules) {
      const erased = eraseFamiliarDefinitionSource(module.source, module.path, diagnostics);
      if (!erased) continue;
      const captured = captureFamiliarApiReferences(
        erased.javascript,
        module.path,
        familiarBootstrap.apiDigest,
        err,
      );
      const helperBundle = await bundleFamiliarHandlerHelpers({
        backendRoot,
        modulePath: module.path,
        source: module.source,
        entrySource: captured,
        sourceOverrides: definitionSourceOverrides,
        diagnostics,
      });
      const extractionSource = helperBundle?.javascript ?? captured;
      const extracted = extractInlineHandlers(extractionSource, {
        path: relative(backendRoot, module.path).split(sep).join('/'),
      });
      // @ref LLP 0253#s92-w3-vertical-contract-fixture-catalogue — classify
      // D4 only after operation/handler extraction can distinguish an actual
      // query visibility decision from an ordinary clock use elsewhere in
      // the source module. Both routes still refuse before output exists.
      validateFamiliarDispositionFourHandlerForms({
        source: module.source,
        sourcePath: module.path,
        operations: module.operations,
        extracted,
        err,
      });
      if (erased.sourceMap) {
        const remap = (holder) => {
          if (holder.generatedSourceSpan) return;
          const generatedSourceSpan = holder.sourceSpan;
          const bundled = helperBundle?.sourceMap
            ? mapGeneratedTypeScriptPosition(
                helperBundle.sourceMap,
                generatedSourceSpan.line,
                generatedSourceSpan.column,
              )
            : null;
          const transformedPath = bundled?.file
            ? (isAbsolute(bundled.file)
                ? resolve(bundled.file)
                : resolve(backendRoot, bundled.file))
            : resolve(module.path);
          const transformed = definitionSourceOverrides.get(transformedPath)
            ?? (transformedPath === resolve(module.path) ? erased : null);
          // Attribution crosses both deterministic transforms: esbuild maps
          // the flattened graph to one erased module, then that module's TS
          // map reaches the authored source. Retain the same chain so later
          // write-site offsets are mapped exactly, not merely from the
          // handler/helper declaration start.
          const authored = transformed?.sourceMap
            ? mapGeneratedTypeScriptPosition(
                transformed.sourceMap,
                bundled?.line ?? generatedSourceSpan.line,
                bundled?.column ?? generatedSourceSpan.column,
              )
            : bundled;
          if (!authored) return;
          holder.generatedSourceSpan = generatedSourceSpan;
          holder.sourceMapChain = [
            ...(helperBundle?.sourceMap ? [helperBundle.sourceMap] : []),
            ...(transformed?.sourceMap ? [transformed.sourceMap] : []),
          ];
          holder.sourceMap = holder.sourceMapChain[0] ?? null;
          holder.sourceSpan = {
            file: relative(backendRoot, transformedPath).split(sep).join('/'),
            line: authored.line,
            column: authored.column,
          };
        };
        for (const handler of extracted.handlers.values()) {
          remap(handler);
          for (const helper of handler.helpers ?? []) remap(helper);
        }
        for (const diagnostic of extracted.diagnostics) remap(diagnostic);
      }
      diagnostics.push(...extracted.diagnostics.map(projectFamiliarHandlerDiagnostic));
      definitionSourceOverrides.set(resolve(module.path), {
        ...erased,
        javascript: extracted.transformedSource,
        ...(helperBundle ? { runtimeBytes: helperBundle.runtimeBytes } : {}),
      });
      const attribution = definitionAttributionFromSource(
        captured,
        relative(backendRoot, module.path).split(sep).join('/'),
      );
      const operations = sourceLayout.operations.filter(
        (operation) => resolve(operation.path) === resolve(module.path),
      );
      for (const operation of operations) {
        const local = operation.exportedName;
        const extractedHandler = extracted.handlers.get(local)
          ?? extracted.handlers.get(operation.localName);
        if (extractedHandler) {
          handlers.set(
            operation.name,
            renameExtractedInlineHandler(extractedHandler, operation.name),
          );
        }
        const extractedEvaluator = extracted.authorizationEvaluators.get(local)
          ?? extracted.authorizationEvaluators.get(operation.localName);
        if (extractedEvaluator) {
          authorizationEvaluators.set(operation.name, {
            ...extractedEvaluator,
            name: operation.name,
          });
        }
        const definition = attribution.definitions.find(
          (candidate) => candidate.binding === operation.localName,
        );
        if (definition) {
          attributionDefinitions.push({
            ...definition,
            binding: operation.name,
            exported: true,
          });
          familiarFunctionSourceSpans[operation.name] = {
            path: definition.sourceSpan.file,
            line: definition.sourceSpan.line,
            column: definition.sourceSpan.column,
          };
        }
        for (const [key, span] of attribution.propertySpans) {
          if (key === operation.localName || key.startsWith(`${operation.localName}.`)) {
            attributionProperties.set(
              `${operation.name}${key.slice(operation.localName.length)}`,
              span,
            );
          }
        }
      }
      for (const definition of attribution.definitions) {
        if (definition.exported || operations.some((operation) => operation.localName === definition.binding)) continue;
        attributionDefinitions.push(definition);
      }
    }
    functionDefinitionAttribution = {
      definitions: attributionDefinitions,
      propertySpans: attributionProperties,
    };
    inlineExtraction = {
      transformedSource: functionsSource,
      handlers,
      authorizationEvaluators,
      diagnostics: [],
    };
  } else {
    try {
      functionsSource = readDefinitionSource(functionsPath, backendRoot, 'FUNCTION_SOURCE');
    } catch (error) {
      err(error.codegenCode ?? 'FUNCTION_SOURCE_MISSING', 'function', error.message, {
        path: functionsPath,
      });
      return { ok: false, diagnostics };
    }
    functionDefinitionAttribution = definitionAttributionFromSource(
      functionsSource,
      'functions.mjs',
    );
    inlineExtraction = extractInlineHandlers(functionsSource, {
      path: 'functions.mjs',
    });
    diagnostics.push(...inlineExtraction.diagnostics);
  }
  // @ref LLP 0237#d5-preflight-is-available-before-generation — retain the
  // authored binding/property map across isolated evaluation so definition
  // failures name the exact author-controlled source site.
  for (const definition of functionDefinitionAttribution.definitions) {
    if (definition.exported) continue;
    err(
      'SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED',
      'function',
      `${definition.binding} is a top-level ${definition.builder}(...) definition but is not exported; add export before the binding so codegen can discover it`,
      {
        binding: definition.binding,
        builder: definition.builder,
        path: definition.sourceSpan.file,
        line: definition.sourceSpan.line,
        column: definition.sourceSpan.column,
        sourceSpan: definition.sourceSpan,
        definitionPath: definition.binding,
        details: {
          definitionPath: [definition.binding],
          remediation: `export const ${definition.binding} = ${definition.builder}(...);`,
        },
      },
    );
  }
  // @ref LLP 0010#generated-artifacts — the AST resolver defines the complete
  // hashed graph; evaluation happens only from those bundled bytes, never by
  // letting Node's ambient loader discover a second, unaccounted-for graph.
  // @ref LLP 0009#capability-model — static analysis is defense in depth. The
  // actual boundary is a capability-empty evaluator process plus a VM context
  // with string/Wasm code generation and nondeterministic globals disabled.
  const schemaBuild = await buildDefinitionBundle(
    schemaPath,
    backendRoot,
    diagnostics,
    'schema',
    'schema',
    schemaSourceOverride,
    definitionSourceOverrides,
  );
  const functionsBuild = await buildDefinitionBundle(
    functionsPath,
    backendRoot,
    diagnostics,
    'function',
    'functions',
    inlineExtraction.transformedSource,
    definitionSourceOverrides,
  );
  // The optional route→query manifest declaration (LLP 0092 §0C.1): compiled
  // under the same hashed-graph + isolated-evaluation discipline when
  // `snapback/routes.mjs` exists.
  const routesPath = join(backendRoot, 'routes.mjs');
  const routesBuild = authoringProfile === EXPLICIT_AUTHORING_PROFILE && existsSync(routesPath)
    ? await buildDefinitionBundle(routesPath, backendRoot, diagnostics, 'routes', 'routes')
    : null;
  // Graph shape refusals run over every authored module after the complete
  // hashed graph exists but before any definition byte is evaluated. A graph
  // re-exported from a helper module therefore receives the same fail-closed
  // source register as one declared directly in functions.mjs.
  if (functionsBuild) {
    validateGraphAuthoringGraph(
      functionsBuild.graph,
      functionsPath,
      functionsSource,
      backendRoot,
      err,
    );
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const evaluated = await evaluateDefinitionBundles(
    schemaBuild,
    functionsBuild,
    diagnostics,
    routesBuild,
    functionDefinitionAttribution,
  );
  if (!evaluated || diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const schemaGraph = schemaBuild.graph;
  const functionsGraph = functionsBuild.graph;
  const schemaPropertySourceSpans = authoredPropertySourceSpans(
    graphEntrySource(schemaGraph, schemaPath),
    authoringProfile === FAMILIAR_AUTHORING_PROFILE ? 'schema.ts' : 'schema.mjs',
  );
  const schemaModule = { default: evaluated.schema };
  const functionsModule = evaluated.functions;
  for (const [name, kind] of Object.entries(evaluated.schemaMisplacedDefinitions ?? {})) {
    const code = kind === 'asset-upload'
      ? 'SNAPBACK_ASSET_INTENT_IN_SCHEMA_MODULE'
      : 'SNAPBACK_DEFINITION_IN_SCHEMA_MODULE';
    err(
      code,
      'schema',
      `schema.mjs exports ${name}, a ${kind} definition — schema.mjs contributes only its default defineSchema(...); move ${name} to functions.mjs or it can never generate`,
      { export: name, kind },
    );
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const routesModule = routesBuild ? evaluated.routes : null;

  const schemaDef = schemaModule.default;
  if (!schemaDef || !schemaDef.__schema) {
    err('SCHEMA_NO_DEFAULT_EXPORT', 'schema', `${schemaPath} must default-export defineSchema(...)`);
    return { ok: false, diagnostics };
  }
  const authMode = validateSchemaAuthDefinition(schemaDef, err);
  const authProgramReadiness = compileAuthProgramReadiness(schemaDef, functionsModule, err);
  const apiManifest = validateSchemaApiDefinition(schemaDef, authMode, err);
  const agentRegistrationWarning = schemaDef.auth?.agents?.mode === 'invited'
    && schemaDef.auth.agents.invitedBy === 'operators'
    ? {
        code: 'SNAPBACK_AUTH_AGENT_ONBOARDING_PROD_UNAVAILABLE',
        severity: 'warning',
        subsystem: 'auth',
        message: 'auth.agents invitedBy operators has no production onboarding path; use invitedBy users or open registration',
        details: { mode: 'invited', invitedBy: 'operators' },
      }
    : null;
  if (agentRegistrationWarning) diagnostics.push(agentRegistrationWarning);
  const artifactVersion = authMode === 'sessions' ? SESSIONS_SCHEMA_VERSION : SCHEMA_VERSION;
  const functionDefinitionSourceSpans = familiarFunctionSourceSpans
    ?? exportedDefinitionSourceSpans(
      graphEntrySource(functionsGraph, functionsPath),
    );
  const schemaRequiredCapabilities = [...new Set(schemaDef.requiredCapabilities ?? [])];
  if (authMode === 'sessions' && !schemaRequiredCapabilities.includes('auth.sessions.v1')) {
    schemaRequiredCapabilities.unshift('auth.sessions.v1');
  }
  if (authMode === 'dev' && schemaRequiredCapabilities.includes('auth.sessions.v1')) {
    err('SCHEMA_AUTH_CAPABILITY_INVALID', 'auth', 'a dev schema must not require auth.sessions.v1', { authMode });
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Build + validate schema ------------------------------------------------
  const tables = dict();
  const authorityProfileRequests = [];
  const seenTables = new Set();
  for (const [name, table] of Object.entries(schemaDef.tables)) {
    if (!IDENT.test(name) || name.startsWith('_snapback') || isAuthReservedIdentifier(name)) {
      err('SCHEMA_INVALID_IDENTIFIER', 'schema', `invalid table identifier ${name}`, { table: name });
      continue;
    }
    if (shadowsSystemIdPrefix(name)) {
      err(
        'SCHEMA_RESERVED_ID_PREFIX',
        'schema',
        `table ${name} derives the reserved id prefix ${deriveTablePrefix(name)}_, which Snapback ` +
          `mints for its own objects; rename the table so its documents cannot be mistaken for them`,
        { table: name, prefix: deriveTablePrefix(name) },
      );
      continue;
    }
    if (seenTables.has(name)) {
      err('SCHEMA_DUPLICATE_TABLE', 'schema', `duplicate table ${name}`, { table: name });
    }
    seenTables.add(name);

    const fields = [];
    const seenFields = new Set();
    for (const [fieldName, val] of Object.entries(table.fields)) {
      if (SYSTEM_FIELDS.includes(fieldName)) {
        err('SCHEMA_SYSTEM_FIELD', 'schema', `${fieldName} is managed by Snapback`, { table: name, field: fieldName });
        continue;
      }
      if (!IDENT.test(fieldName)) {
        err('SCHEMA_INVALID_IDENTIFIER', 'schema', `invalid field identifier ${name}.${fieldName}`, { table: name, field: fieldName });
        continue;
      }
      if (seenFields.has(fieldName)) {
        err('SCHEMA_DUPLICATE_FIELD', 'schema', `duplicate field ${name}.${fieldName}`, { table: name, field: fieldName });
      }
      seenFields.add(fieldName);
      const storedEnum = isStoredLiteralUnionCandidate(val)
        ? validateStoredLiteralUnion(val, `${name}.${fieldName}`, (message) => {
            err('SCHEMA_INVALID_VALIDATOR', 'schema', message, { table: name, field: fieldName });
          })
        : { matched: false, values: null };
      if (!storedEnum.matched) {
        const structured = val?.primitive === 'object'
          || val?.resultKind === 'array'
          || val?.resultKind === 'union';
        if (structured) {
          checkObjectValidatorFieldIdents(val, `${name}.${fieldName}`, (invalidName, where) => {
            err(
              'SCHEMA_STRUCTURED_OBJECT_FIELD_INVALID',
              'schema',
              `${where} contains invalid object-member identifier ${JSON.stringify(invalidName)}`,
              { table: name, field: fieldName, member: invalidName },
            );
          });
          const valid = validateStoredStructuredValidator(
            val,
            `${name}.${fieldName}`,
            (code, message, details = {}) => err(
              code,
              'schema',
              message,
              { table: name, field: fieldName, ...details },
            ),
          );
          if (valid) {
            try {
              const contract = {
                version: 1,
                descriptor: storedStructuredContractDescriptor(val),
                encoding: STORED_STRUCTURED_ENCODING_V1,
              };
              val.fieldType = {
                Structured: {
                  contract,
                  contractHash: storedStructuredContractHash(contract),
                },
              };
              const hint = structuredNullableScalarHint(val, `${name}.${fieldName}`);
              if (hint) diagnostics.push(hint);
            } catch (error) {
              err(
                'SCHEMA_STRUCTURED_CONTRACT_INVALID',
                'schema',
                `${name}.${fieldName} could not produce a closed stored structured contract: ${error.message}`,
                { table: name, field: fieldName },
              );
            }
          }
        } else {
          validateAuthoringValidator(val, `${name}.${fieldName}`, (message) => {
            err('SCHEMA_INVALID_VALIDATOR', 'schema', message, { table: name, field: fieldName });
          });
        }
      } else if (storedEnum.values !== null) {
        val.fieldType = { Enum: { values: storedEnum.values } };
      }
      const idTable = idFieldTypeTable(val.fieldType);
      if (idTable !== null && !Object.hasOwn(schemaDef.tables, idTable)) {
        err('SCHEMA_ID_TARGET_UNKNOWN', 'schema', `${name}.${fieldName} references unknown id table ${idTable}`, {
          table: name,
          field: fieldName,
          targetTable: idTable,
        });
      }
      const relation = val.fieldType?.RelationIncarnation;
      if (relation) {
        const foreign = table.fields[relation.foreignKeyField];
        const foreignTarget = foreign ? idFieldTypeTable(foreign.fieldType) : null;
        if (val.optional || !foreign || foreign.optional || foreignTarget !== relation.parentTable) {
          err('SNAPBACK_RELATION_SCHEMA_INVALID', 'schema', `${name}.${fieldName} must be required and pair with a required Id<${relation.parentTable}> field ${relation.foreignKeyField}`, {
            table: name,
            field: fieldName,
            foreignKeyField: relation.foreignKeyField,
            parentTable: relation.parentTable,
          });
        }
      }
      fields.push({
        name: fieldName,
        field_type: val.fieldType,
        optional: val.optional,
      });
      if (
        val.fieldType?.AssetRef?.media
        && !schemaRequiredCapabilities.includes('assets.media-ref-projection.v1')
      ) {
        schemaRequiredCapabilities.push('assets.media-ref-projection.v1');
      }
    }

    const indexes = [];
    const seenIndexes = new Set();
    for (const index of table.indexes) {
      if (!IDENT.test(index.name) || index.name.startsWith('_snapback') || isAuthReservedIdentifier(index.name)) {
        err('SCHEMA_INVALID_IDENTIFIER', 'schema', `invalid index identifier ${name}.${index.name}`, { table: name, index: index.name });
      }
      if (seenIndexes.has(index.name)) {
        err('SCHEMA_DUPLICATE_INDEX', 'schema', `duplicate index ${name}.${index.name}`, { table: name, index: index.name });
      }
      seenIndexes.add(index.name);
      if (index.fields.length === 0) {
        err('SCHEMA_EMPTY_INDEX', 'schema', `index ${name}.${index.name} has no fields`, { table: name, index: index.name });
      }
      if (new Set(index.fields).size !== index.fields.length) {
        err('SCHEMA_DUPLICATE_INDEX_FIELD', 'schema', `index ${name}.${index.name} repeats a field`, { table: name, index: index.name });
      }
      for (const f of index.fields) {
        if (!seenFields.has(f)) {
          err('SCHEMA_UNKNOWN_FIELD', 'schema', `index ${name}.${index.name} references unknown field ${f}`, { table: name, index: index.name, field: f });
        } else if (table.fields[f].fieldType?.Structured) {
          err(
            'SCHEMA_STRUCTURED_INDEX_UNSUPPORTED',
            'schema',
            `index ${name}.${index.name} cannot observe opaque structured field ${f}; declare a scalar projection when indexing is required`,
            { table: name, index: index.name, field: f },
          );
        }
      }
      // @ref LLP 0007#index-contract — optional unique keys automatically use
      //   the manifest-explicit, all-components-present partial-index profile.
      const whereApplicable = index.unique
        && index.fields.some((field) => table.fields[field]?.optional === true);
      indexes.push({
        name: index.name,
        fields: index.fields,
        ...(index.unique ? { unique: true } : {}),
        ...(whereApplicable ? { whereApplicable: true } : {}),
      });
    }

    const searchIndexes = [];
    for (const search of table.searchIndexes ?? []) {
      if (!IDENT.test(search.name) || search.name.startsWith('_snapback') || isAuthReservedIdentifier(search.name)) {
        err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `invalid search index identifier ${name}.${search.name}`, { table: name, index: search.name });
      }
      if (seenIndexes.has(search.name)) {
        err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `duplicate index/search index name ${name}.${search.name}`, { table: name, index: search.name });
      }
      seenIndexes.add(search.name);
      for (const [field, declaration] of Object.entries(search.textFields ?? {})) {
        const source = table.fields[field];
        if (!source) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} references unknown text field ${field}`, { table: name, index: search.name, field });
        } else if (source.fieldType !== 'String') {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} text field ${field} must use v.string()`, { table: name, index: search.name, field });
        }
        if (!Number.isSafeInteger(declaration.weight) || declaration.weight < 1 || declaration.weight > 64) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} text field ${field} weight must be 1..64`, { table: name, index: search.name, field });
        }
        if (declaration.classification === 'sensitive' || declaration.classification === 'forbidden') {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} cannot index ${declaration.classification} field ${field}`, { table: name, index: search.name, field });
        }
        if (search.visibility.kind === 'public-read' && declaration.classification !== 'public') {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `public search index ${name}.${search.name} admits only public text fields`, { table: name, index: search.name, field });
        }
      }
      const participatingNonText = new Set([
        ...(search.equalityFilters ?? []),
        ...(search.storedFields ?? []),
        ...(search.visibility.kind === 'owner' ? [search.visibility.field] : []),
        ...(search.visibility.kind === 'membership' ? [search.visibility.resourceField] : []),
      ]);
      for (const field of Object.keys(search.textFields ?? {})) participatingNonText.delete(field);
      const declaredClassifications = search.fieldClassifications ?? {};
      const requiredClassificationFields = [...participatingNonText].sort();
      const declaredClassificationFields = Object.keys(declaredClassifications).sort();
      if (
        JSON.stringify(requiredClassificationFields)
        !== JSON.stringify(declaredClassificationFields)
      ) {
        err(
          'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
          'search',
          `search index ${name}.${search.name} must classify exactly its participating non-text fields`,
          {
            table: name,
            index: search.name,
            requiredFields: requiredClassificationFields,
            declaredFields: declaredClassificationFields,
          },
        );
      }
      for (const [field, classification] of Object.entries(declaredClassifications)) {
        if (!SEARCH_FIELD_CLASSIFICATIONS.has(classification)) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} field ${field} has unknown classification`, { table: name, index: search.name, field });
        } else if (classification === 'sensitive' || classification === 'forbidden') {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} cannot participate with ${classification} field ${field}`, { table: name, index: search.name, field });
        } else if (search.visibility.kind === 'public-read' && classification !== 'public') {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `public search index ${name}.${search.name} admits only public participating fields`, { table: name, index: search.name, field });
        }
      }
      for (const field of [
        ...(search.equalityFilters ?? []),
        ...(search.storedFields ?? []),
        ...(search.highlightFields ?? []),
      ]) {
        if (!table.fields[field]) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} references unknown field ${field}`, { table: name, index: search.name, field });
        }
      }
      for (const field of search.highlightFields ?? []) {
        if (!Object.hasOwn(search.textFields ?? {}, field)) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} highlight field ${field} must be a declared text field`, { table: name, index: search.name, field });
        }
      }
      for (const field of search.equalityFilters ?? []) {
        const type = table.fields[field]?.fieldType;
        const portable = ['String', 'Principal', 'Integer', 'Boolean'].includes(type)
          || idFieldTypeTable(type) !== null
          || type?.Enum !== undefined;
        if (!portable) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `search index ${name}.${search.name} equality filter ${field} has a non-portable type`, { table: name, index: search.name, field });
        }
      }
      for (const field of search.storedFields ?? []) {
        if (table.fields[field]?.fieldType?.Structured) {
          err(
            'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
            'search',
            `search index ${name}.${search.name} stored field ${field} must be a bounded scalar display field; opaque structured fields cannot be projected`,
            { table: name, index: search.name, field, reason: 'structured-stored-field-opaque' },
          );
        }
      }
      if (search.visibility.kind === 'owner') {
        const owner = table.fields[search.visibility.field];
        if (!owner || owner.optional || !['String', 'Principal'].includes(owner.fieldType)) {
          err('SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID', 'search', `owner search index ${name}.${search.name} requires a non-optional string/principal owner field`, { table: name, index: search.name, field: search.visibility.field });
        }
      } else if (search.visibility.kind === 'membership') {
        const resource = table.fields[search.visibility.resourceField];
        if (
          !resource
          || resource.optional
          || !(
            ['String', 'Principal'].includes(resource.fieldType)
            || idFieldTypeTable(resource.fieldType) !== null
          )
        ) {
          err(
            'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
            'search',
            `membership search index ${name}.${search.name} requires a non-optional string/principal/id resource field`,
            { table: name, index: search.name, field: search.visibility.resourceField },
          );
        }
      }
      searchIndexes.push(search);
    }
    const vectorIndexes = [];
    for (const vector of table.vectorIndexes ?? []) {
      const fail = (message, details = {}) => err(
        'SNAPBACK_VECTOR_INDEX_INVALID',
        'vector',
        `vector index ${name}.${vector.name}: ${message}`,
        { table: name, index: vector.name, ...details },
      );
      if (!IDENT.test(vector.name) || vector.name.startsWith('_snapback') || isAuthReservedIdentifier(vector.name)) fail('has an invalid identifier');
      if (seenIndexes.has(vector.name)) fail('duplicates an index name');
      seenIndexes.add(vector.name);
      const source = table.fields[vector.vectorField];
      const dimensions = source?.fieldType?.Vector?.dimensions;
      if (!source || source.optional || dimensions !== vector.dimensions) fail('vectorField must name a required matching v.vector(D)', { field: vector.vectorField });
      if (!['l2sq', 'dot'].includes(vector.metric)) fail('metric must be l2sq or dot');
      if (vector.distanceProfile !== 'snapback-vector-distance-v1' || vector.orderingProfile !== 'nearest-first-row-id.v1') fail('profile ids do not match vector-search-v1');
      if (!Number.isSafeInteger(vector.maxIndexedVectorsPerPartition) || vector.maxIndexedVectorsPerPartition < 1 || vector.maxIndexedVectorsPerPartition > 65_536) fail('corpus bound must be 1..65536');
      const product = vector.dimensions * vector.maxIndexedVectorsPerPartition;
      if (!Number.isSafeInteger(product) || product > 2 ** 26 || vector.maxScalarPairs !== product) fail('maxScalarPairs must equal dimensions × corpus and remain <= 2^26');
      if (vector.maintenanceLimits?.vectorMaintenanceEffects !== 1_024 || vector.maintenanceLimits?.vectorBytes !== 4 * 1024 * 1024 || Object.keys(vector.maintenanceLimits ?? {}).length !== 2) fail('maintenanceLimits must equal the fixed mutation-global v1 ceiling');
      if ((vector.equalityFilters ?? []).length > 8) fail('admits at most eight equality filters');
      for (const field of [...(vector.equalityFilters ?? []), ...(vector.storedFields ?? [])]) {
        if (!table.fields[field]) fail(`references unknown field ${field}`, { field });
      }
      for (const field of vector.equalityFilters ?? []) {
        const fieldType = table.fields[field]?.fieldType;
        const stringLike = ['String', 'Principal'].includes(fieldType)
          || (fieldType !== null
            && typeof fieldType === 'object'
            && !Array.isArray(fieldType)
            && (Object.hasOwn(fieldType, 'Id')
              || Object.hasOwn(fieldType, 'AssetRef')
              || Object.hasOwn(fieldType, 'Enum')));
        if (!stringLike && !['Boolean', 'Integer'].includes(fieldType)) fail(`equality filter ${field} has a non-portable scalar type`, { field });
      }
      for (const field of vector.storedFields ?? []) {
        if (table.fields[field]?.fieldType?.Vector) fail(`storedFields must not expose vector field ${field}`, { field });
        if (table.fields[field]?.fieldType?.Structured) fail(`storedFields must not expose opaque structured field ${field}`, { field, reason: 'structured-stored-field-opaque' });
      }
      if (vector.visibility?.kind === 'owner') {
        const owner = table.fields[vector.visibility.field];
        if (!owner || owner.optional || !['String', 'Principal'].includes(owner.fieldType)) fail('owner visibility requires a required string/principal field', { field: vector.visibility.field });
      } else if (vector.visibility?.kind !== 'public-read') fail('visibility must be public-read or owner');
      const participating = new Set([
        vector.vectorField,
        ...(vector.equalityFilters ?? []),
        ...(vector.storedFields ?? []),
        ...(vector.visibility?.kind === 'owner' ? [vector.visibility.field] : []),
      ]);
      const classifications = vector.fieldClassifications ?? {};
      if (JSON.stringify([...participating].sort()) !== JSON.stringify(Object.keys(classifications).sort())) fail('classifications must name exactly every participating field');
      for (const [field, classification] of Object.entries(classifications)) {
        if (!SEARCH_FIELD_CLASSIFICATIONS.has(classification) || classification === 'sensitive' || classification === 'forbidden') fail(`field ${field} has refused classification ${classification}`, { field });
        if (vector.visibility?.kind === 'public-read' && classification !== 'public') fail(`public-read field ${field} must be public`, { field });
      }
      vectorIndexes.push(vector);
    }
    if (table.searchLiveLimitsDeclaration !== undefined && searchIndexes.length === 0) {
      err(
        'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
        'search',
        `table ${name} searchLiveLimits requires at least one search index`,
        { table: name },
      );
    }

    if (table.permissionFields !== undefined && !table.permissionBackingDeclared) {
      err('SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING', 'schema', `table ${name} declares permissionFields without permissionBacking`, { table: name });
    }
    if (table.permissionFields !== undefined && !Array.isArray(table.permissionFields)) {
      err('SCHEMA_PERMISSION_FIELDS_INVALID', 'schema', `table ${name} permissionFields must be an array`, { table: name });
    }
    if (Array.isArray(table.permissionFields)) {
      const seenPermissionFields = new Set();
      for (const field of table.permissionFields) {
        if (!seenFields.has(field)) {
          err('SCHEMA_PERMISSION_FIELD_UNKNOWN', 'schema', `table ${name} permissionFields references unknown field ${field}`, { table: name, field });
        }
        if (seenPermissionFields.has(field)) {
          err('SCHEMA_PERMISSION_FIELD_DUPLICATE', 'schema', `table ${name} permissionFields repeats field ${field}`, { table: name, field });
        }
        seenPermissionFields.add(field);
      }
    }

    let membership;
    if (table.membershipDeclaration !== undefined) {
      const declaration = table.membershipDeclaration;
      if (table.permissionBackingDeclared || table.permissionFields !== undefined) {
        err('SCHEMA_MEMBERSHIP_PERMISSION_BACKING_CONFLICT', 'schema', `table ${name} cannot combine membership with permissionBacking`, { table: name });
      }
      const axis = (fieldName, axisName) => {
        const source = table.fields[fieldName];
        if (!source) {
          err('SCHEMA_MEMBERSHIP_UNKNOWN_FIELD', 'schema', `table ${name} membership ${axisName} references unknown field ${String(fieldName)}`, {
            table: name,
            axis: axisName,
            field: fieldName ?? null,
          });
          return null;
        }
        if (source.optional) {
          err('SCHEMA_MEMBERSHIP_OPTIONAL_AXIS', 'schema', `table ${name} membership ${axisName} field ${fieldName} must be required`, {
            table: name,
            axis: axisName,
            field: fieldName,
          });
        }
        return source;
      };
      const principal = axis(declaration.principal, 'principal');
      if (principal && principal.fieldType !== 'Principal') {
        err('SCHEMA_MEMBERSHIP_PRINCIPAL_TYPE', 'schema', `table ${name} membership principal must use v.principal()`, {
          table: name,
          field: declaration.principal,
        });
      }
      const role = axis(declaration.role, 'role');
      if (role && role.fieldType !== 'String') {
        err('SCHEMA_MEMBERSHIP_ROLE_TYPE', 'schema', `table ${name} membership role must use v.string()`, {
          table: name,
          field: declaration.role,
        });
      }
      const declaredRoles = new Set(declaration.roles);
      const vocabulary = [...declaration.roles, ...(declaration.pendingRoles ?? [])];
      for (const field of ['grantedByActor', 'grantedByEffective', 'grantedByGrant']) {
        if (Object.hasOwn(table.fields, field)) {
          err('SCHEMA_MEMBERSHIP_PROVENANCE_FIELD_RESERVED', 'schema', `table ${name} field ${field} is host-managed membership provenance`, {
            table: name,
            declaration: declaration.id ?? name,
            field,
          });
        }
      }
      const foldedRoles = new Map();
      for (const roleName of vocabulary) {
        if (roleName === 'self' || roleName === 'none') {
          err('SCHEMA_MEMBERSHIP_RESERVED_ROLE', 'schema', `table ${name} membership role ${JSON.stringify(roleName)} is a reserved caller class`, {
            table: name,
            role: roleName,
          });
        }
        if (roleName.includes(':')) {
          err('SCHEMA_MEMBERSHIP_ROLE_RESERVED_SEPARATOR', 'schema', `table ${name} membership role ${JSON.stringify(roleName)} contains the reserved ':' separator`, {
            table: name,
            role: roleName,
          });
        }
        if (/[\u0000-\u001f\u007f-\u009f]/u.test(roleName)) {
          err('SCHEMA_MEMBERSHIP_ROLE_CONTROL_CHARACTER', 'schema', `table ${name} membership role ${JSON.stringify(roleName)} contains a control character`, {
            table: name,
            role: roleName,
          });
        }
        const folded = roleName.toLowerCase();
        const prior = foldedRoles.get(folded);
        if (prior !== undefined && prior !== roleName) {
          err('SCHEMA_MEMBERSHIP_CONFUSABLE_ROLES', 'schema', `table ${name} membership roles ${JSON.stringify(prior)} and ${JSON.stringify(roleName)} differ only by case`, {
            table: name,
            roles: [prior, roleName],
          });
        } else {
          foldedRoles.set(folded, roleName);
        }
      }
      if (declaration.bootstrapRole !== undefined && !declaredRoles.has(declaration.bootstrapRole)) {
        err('SCHEMA_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN', 'schema', `table ${name} membership bootstrapRole must name a declared non-pending role`, {
          table: name,
          role: declaration.bootstrapRole,
        });
      }
      if (declaration.scope === 'app' && declaration.bootstrapRole !== undefined) {
        err('SCHEMA_MEMBERSHIP_BOOTSTRAP_APP_SCOPE', 'schema', `table ${name} cannot declare bootstrapRole for app scope`, {
          table: name,
          role: declaration.bootstrapRole,
        });
      }
      if (declaration.lastHolder !== undefined) {
        if (declaration.scope === 'app') {
          err('SCHEMA_MEMBERSHIP_LAST_HOLDER_APP_SCOPE', 'schema', `table ${name} cannot declare lastHolder for app scope`, {
            table: name,
          });
        }
        if (!declaredRoles.has(declaration.lastHolder.protect)) {
          err('SCHEMA_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN', 'schema', `table ${name} membership lastHolder.protect must name a declared non-pending role`, {
            table: name,
            role: declaration.lastHolder.protect,
          });
        }
        if (declaration.bootstrapRole !== declaration.lastHolder.protect) {
          err('SCHEMA_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH', 'schema', `table ${name} membership lastHolder.protect requires the same bootstrapRole`, {
            table: name,
            protectedRole: declaration.lastHolder.protect,
            bootstrapRole: declaration.bootstrapRole ?? null,
          });
        }
      }
      if (declaration.expiry !== undefined) {
        const expiry = table.fields[declaration.expiry.field];
        if (!expiry) {
          err('SCHEMA_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN', 'schema', `table ${name} membership expiry references unknown field ${declaration.expiry.field}`, {
            table: name,
            field: declaration.expiry.field,
          });
        } else if ([declaration.principal, declaration.resource, declaration.role].includes(declaration.expiry.field)) {
          err('SCHEMA_MEMBERSHIP_EXPIRY_FIELD_AXIS', 'schema', `table ${name} membership expiry cannot name an authorization axis`, {
            table: name,
            field: declaration.expiry.field,
          });
        } else if (expiry.fieldType !== 'Integer' || expiry.optional !== true) {
          err('SCHEMA_MEMBERSHIP_EXPIRY_FIELD_TYPE', 'schema', `table ${name} membership expiry field ${declaration.expiry.field} must use v.optional(v.integer())`, {
            table: name,
            field: declaration.expiry.field,
          });
        }
      }
      for (const incidental of declaration.incidental ?? []) {
        if (!Object.hasOwn(table.fields, incidental)) {
          err('SCHEMA_MEMBERSHIP_INCIDENTAL_UNKNOWN', 'schema', `table ${name} membership incidental references unknown field ${incidental}`, {
            table: name,
            field: incidental,
          });
        } else if ([declaration.principal, declaration.resource, declaration.role].includes(incidental)) {
          err('SCHEMA_MEMBERSHIP_INCIDENTAL_FLOOR', 'schema', `table ${name} membership incidental cannot name an authorization axis`, {
            table: name,
            field: incidental,
          });
        }
      }
      for (const transition of declaration.transitions) {
        const hasRoleCaller = transition.by.some((caller) => vocabulary.includes(caller));
        if (transition.target === 'self' && hasRoleCaller) {
          err('SCHEMA_MEMBERSHIP_TRANSITION_GRAMMAR', 'schema', `table ${name} membership ${transition.op} transition combines a role caller with target self, which is unreachable`, {
            table: name,
            declaration: declaration.id ?? name,
            op: transition.op,
          });
        }
        if (transition.target === 'other' && transition.by.includes('self')) {
          err('SCHEMA_MEMBERSHIP_TRANSITION_SELF_ON_OTHER', 'schema', `table ${name} membership ${transition.op} transition combines caller self with target other`, {
            table: name,
            declaration: declaration.id ?? name,
            op: transition.op,
          });
        }
        for (const fieldName of transition.fields ?? []) {
          if (!Object.hasOwn(table.fields, fieldName)) {
            err('SCHEMA_MEMBERSHIP_TRANSITION_FIELD_UNKNOWN', 'schema', `table ${name} membership transition references unknown patch field ${fieldName}`, {
              table: name,
              field: fieldName,
            });
          } else if ([declaration.principal, declaration.resource, declaration.role].includes(fieldName)) {
            err('SCHEMA_MEMBERSHIP_TRANSITION_AXIS_FIELD', 'schema', `table ${name} membership transition cannot patch authorization axis ${fieldName}`, {
              table: name,
              declaration: declaration.id ?? name,
              op: transition.op,
              field: fieldName,
            });
          }
        }
      }
      let resourceTable;
      if (declaration.scope === 'resource') {
        const resource = axis(declaration.resource, 'resource');
        resourceTable = idFieldTypeTable(resource?.fieldType);
        if (resource && resourceTable === null) {
          err('SCHEMA_MEMBERSHIP_RESOURCE_TYPE', 'schema', `table ${name} membership resource must use v.id(table)`, {
            table: name,
            field: declaration.resource,
          });
        }
      }
      membership = {
        ...declaration,
        ...(resourceTable !== null && resourceTable !== undefined ? { resourceTable } : {}),
      };
    }

    // @ref LLP 0044#asset-read-authorization — the sharing declaration is the
    //   explicit statement that this table's analyzable row policy is
    //   sufficient asset-sharing authority; its owner field must exist.
    let assetSharing;
    if (table.assetSharingDeclaration) {
      assetSharing = table.assetSharingDeclaration;
      if (assetSharing.kind === 'owner' && !Object.hasOwn(table.fields, assetSharing.field)) {
        err('SNAPBACK_ASSET_SHARING_FIELD_UNKNOWN', 'schema', `table ${name} assetSharing owner field ${assetSharing.field} does not exist`, {
          table: name,
          field: assetSharing.field,
        });
        assetSharing = undefined;
      }
    }

    const visibility = table.visibilityDeclaration
      ? { ...table.visibilityDeclaration }
      : undefined;
    if (visibility === undefined) {
      const authoredSpan = schemaPropertySourceSpans[`table:${name}`];
      const precondition = { table: name, authoredVisibility: 'omitted' };
      // @ref LLP 0231#d2--a-table-without-a-policy-fails-generation — the
      //   G1 corpus and override-governance closure permit the D2 fail phase.
      diagnostics.push({
        code: 'SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT',
        severity: 'error',
        subsystem: 'auth',
        message: `${name}: generation requires an explicit table visibility policy. Declare the honest narrowest owner, membership, any-of, or genuinely public-by-design policy on the ${name} defineTable(...) chain. For principal-free scheduled reads, use a governed system/revalidatePrincipal/capturedGrant mode or a job-owned/derived table; never declare public-read merely to unblock generation (guide/auth/protecting-data.md#declare-who-can-read-each-table).`,
        table: name,
        ...(authoredSpan
          ? {
              sourceSpan: {
                file: authoredSpan.path,
                line: authoredSpan.line,
                column: authoredSpan.column,
              },
            }
          : {}),
        details: {
          table: name,
          authoredVisibility: 'omitted',
          allowed: ['public-read', 'owner', 'membership', 'any-of'],
          guideAnchor: 'guide/auth/protecting-data.md#declare-who-can-read-each-table',
          remediations: [
            {
              kind: 'setTableVisibility',
              visibilityKind: 'public-read',
              edit: ".visibility({ kind: 'public-read' })",
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'widens-or-confirms-public',
              precondition,
              description: `Declare ${name} public-read only when every row is intentionally readable through all future data-layer paths.`,
            },
            {
              kind: 'setTableVisibility',
              visibilityKind: 'owner',
              edit: ".visibility({ kind: 'owner', field: '<ownerField>' })",
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'narrows',
              precondition,
              description: `Declare ${name} owner-visible after choosing the field whose value is the caller principal.`,
            },
            {
              kind: 'setTableVisibility',
              visibilityKind: 'membership',
              edit: ".visibility({ kind: 'membership', declaration: '<membershipId>', resourceField: '<resourceField>', roles: ['<role>'] })",
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'narrows',
              precondition,
              description: `Declare ${name} membership-visible after choosing the declaration, resource field, and admitted roles.`,
            },
            {
              kind: 'setTableVisibility',
              visibilityKind: 'any-of',
              edit: ".visibility(anyOf([owner('<ownerField>'), membership('<membershipId>', '<resourceField>', ['<role>'])]))",
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'narrows',
              precondition,
              description: `Declare ${name} visible to the explicit union only when each arm independently represents intended row authority.`,
            },
            {
              kind: 'guidePointer',
              pageId: 'auth.protecting-data',
              path: 'guide/auth/protecting-data.md',
              anchor: 'declare-who-can-read-each-table',
              reason: 'Choose the table policy or scheduled-authority restructuring that matches the intended row authority.',
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'none',
              precondition,
              description: 'Read the data-protection guide before choosing the table visibility policy.',
            },
          ],
        },
      });
    }

    tables[name] = {
      name,
      fields,
      indexes,
      ...(searchIndexes.length > 0 ? { searchIndexes } : {}),
      ...(vectorIndexes.length > 0 ? { vectorIndexes } : {}),
      ...(table.searchLiveLimitsDeclaration !== undefined
        ? { searchLiveLimits: { ...table.searchLiveLimitsDeclaration } }
        : {}),
      syncable: table.syncable,
      ...(table.permissionBackingDeclared ? { permissionBacking: true } : {}),
      ...(Array.isArray(table.permissionFields) ? { permissionFields: table.permissionFields } : {}),
      ...(membership ? { membership } : {}),
      ...(assetSharing ? { assetSharing } : {}),
      ...(visibility ? { visibility } : {}),
      ...(table.historyDeclaration ? { history: { ...table.historyDeclaration } } : {}),
    };
    for (const declaration of table.authorityProfileDeclarations ?? []) {
      authorityProfileRequests.push({ tableName: name, tableBuilder: table, declaration });
    }
  }

  // @ref LLP 0214#59-relationship-to-the-guide-binding-gap — compile
  // identity-binding declarations into an activation-visible,
  // storage-enforced ordinary-write seal. This does not compile or activate
  // the still-open verified-provisioning writer.
  const identityBindingTables = [];
  for (const write of schemaDef.authProgram?.verifiedProvisioning?.writes ?? []) {
    if (write.mode !== 'identity-binding') continue;
    const table = tables[write.table];
    const principal = table?.fields.find((field) => field.name === write.principalField);
    const identity = table?.fields.find((field) => field.name === write.identityField);
    const uniqueOn = (field) => table?.indexes.some(
      (index) => index.unique === true && index.fields.length === 1 && index.fields[0] === field,
    ) === true;
    if (!table) {
      err('SNAPBACK_AUTH_BINDING_TABLE_INVALID', 'auth', `verified provisioning references unknown identity-binding table ${write.table}`, { table: write.table });
      continue;
    }
    if (!principal || principal.optional || principal.field_type !== 'Principal') {
      err('SNAPBACK_AUTH_BINDING_TABLE_INVALID', 'auth', `${write.table}.${write.principalField} must be a required v.principal() durable binding key`, { table: write.table, field: write.principalField });
      continue;
    }
    if (!identity || identity.optional || !uniqueOn(write.principalField) || !uniqueOn(write.identityField)) {
      err('SNAPBACK_AUTH_BINDING_TABLE_INVALID', 'auth', `${write.table} identity bindings require required fields and one-field unique indexes on ${write.principalField} and ${write.identityField}`, { table: write.table, identityField: write.identityField, principalField: write.principalField });
      continue;
    }
    identityBindingTables.push({
      table: write.table,
      principalField: write.principalField,
      identityField: write.identityField,
    });
  }

  // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
  // — the facade is admitted only when it decorates one exact LLP 0056
  // membership relation; every refusal is codegen-owned and repair-bearing.
  // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
  // — role hierarchy sugar closes into literal roles on the existing
  // membership/table-policy IR, while the versioned projection points back to
  // those canonical declarations instead of creating another evaluator.
  const authorityProfiles = new Map();
  const authorityProfileRelations = new Map();
  const authorityProfileError = (code, tableName, message, repair, extra = {}) => {
    const authoredSpan = schemaPropertySourceSpans[`table:${tableName}`];
    diagnostics.push({
      code,
      severity: 'error',
      subsystem: 'auth',
      message: `${tableName}: ${message}`,
      table: tableName,
      ...(authoredSpan
        ? {
            sourceSpan: {
              file: authoredSpan.path,
              line: authoredSpan.line,
              column: authoredSpan.column,
            },
          }
        : {}),
      details: { table: tableName, repair, ...extra },
    });
  };
  const closeAuthorityHierarchy = (roles, hierarchy) => {
    const edges = new Map(roles.map((role) => [
      role,
      Object.hasOwn(hierarchy, role) ? hierarchy[role] : [],
    ]));
    const visiting = new Set();
    const closed = new Map();
    const visit = (role) => {
      if (closed.has(role)) return closed.get(role);
      if (visiting.has(role)) throw new Error(`hierarchy contains a cycle through ${role}`);
      visiting.add(role);
      const implied = new Set([role]);
      for (const child of edges.get(role) ?? []) {
        for (const descendant of visit(child)) implied.add(descendant);
      }
      visiting.delete(role);
      const result = [...implied].sort();
      closed.set(role, result);
      return result;
    };
    for (const role of roles) visit(role);
    return closed;
  };
  const authorityHierarchyOrder = (roles, hierarchyClosed) => {
    const implies = new Map(
      roles.map((role) => [role, new Set(hierarchyClosed.get(role) ?? [])]),
    );
    const isStrictSuperset = (left, right) => (
      left.size > right.size && [...right].every((role) => left.has(role))
    );
    return [...roles].sort((leftRole, rightRole) => {
      const left = implies.get(leftRole);
      const right = implies.get(rightRole);
      if (isStrictSuperset(left, right)) return -1;
      if (isStrictSuperset(right, left)) return 1;
      if (left.size !== right.size) return right.size - left.size;
      return compareCodeUnits(leftRole, rightRole);
    });
  };
  const compareCodeUnitLists = (left, right) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const ordering = compareCodeUnits(left[index], right[index]);
      if (ordering !== 0) return ordering;
    }
    return left.length - right.length;
  };
  const compareOptionalCodeUnitLists = (left, right) => {
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    return compareCodeUnitLists(left, right);
  };
  const canonicalAuthorityTransitionMatrix = (transitions) => {
    const matrix = transitions.map((transition) => ({
      op: transition.op,
      target: transition.target,
      by: [...transition.by].sort(compareCodeUnits),
      ...(transition.from === undefined
        ? {}
        : { from: [...transition.from].sort(compareCodeUnits) }),
      ...(transition.to === undefined
        ? {}
        : { to: [...transition.to].sort(compareCodeUnits) }),
      ...(transition.fields === undefined
        ? {}
        : { fields: [...transition.fields].sort(compareCodeUnits) }),
    }));
    return matrix.sort((left, right) => (
      compareCodeUnits(left.op, right.op)
      || compareCodeUnits(left.target, right.target)
      || compareCodeUnitLists(left.by, right.by)
      || compareOptionalCodeUnitLists(left.from, right.from)
      || compareOptionalCodeUnitLists(left.to, right.to)
      || compareOptionalCodeUnitLists(left.fields, right.fields)
    ));
  };
  // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — the
  // operation descriptor truthfully names both generic and dedicated client
  // projections; those names do not add another generated operation.
  const authorityOperationsForMembership = (membership, productProjection = null) => {
    const transitions = membership.transitions ?? [];
    const activeRoles = membership.roles ?? [];
    const pendingRoles = membership.pendingRoles ?? [];
    const transitionRoles = (op, target, key, predicate = () => true) => [...new Set(
      transitions
        .filter((transition) => (
          transition.op === op
          && transition.target === target
          && predicate(transition)
        ))
        .flatMap((transition) => transition[key] ?? []),
    )].sort(compareCodeUnits);
    const inviteRoles = transitionRoles('insert', 'other', 'to');
    const joinRoles = transitionRoles('setRole', 'self', 'to', (transition) => (
      (transition.from ?? []).some((role) => pendingRoles.includes(role))
      && (transition.to ?? []).some((role) => activeRoles.includes(role))
    ));
    const changeRoleRoles = transitionRoles('setRole', 'other', 'to', (transition) => (
      !(transition.from ?? []).includes('owner')
      && !(transition.to ?? []).includes('owner')
    ));
    const operations = [
      {
        name: 'list',
        kind: 'LiveQuery',
        authRequirement: 'authenticated',
        hooks: ['useSnapbackQuery', 'useSnapbackAuthorityRoster'],
        transitionOps: [],
      },
      {
        name: 'myRole',
        kind: 'LiveQuery',
        authRequirement: 'authenticated',
        hooks: ['useSnapbackQuery', 'useSnapbackAuthorityMyRole'],
        transitionOps: [],
      },
      ...(productProjection === null ? [] : [
        {
          name: 'history',
          kind: 'LiveQuery',
          authRequirement: 'authenticated',
          hooks: ['useSnapbackQuery', 'useSnapbackAuthorityHistory'],
          transitionOps: [],
        },
        {
          name: 'incarnations',
          kind: 'LiveQuery',
          authRequirement: 'authenticated',
          hooks: ['useSnapbackQuery', 'useSnapbackAuthorityIncarnations'],
          transitionOps: [],
        },
      ]),
    ];
    const operationOutcomes = (name) => [
      ...(name === 'changeRole' ? [{
        branch: 'already-at-requested-role',
        outcome: 'idempotent-success-unchanged',
      }, {
        branch: 'absent-target',
        outcome: 'typed-precondition-refusal',
      }] : []),
      ...(name === 'remove' ? [{
        branch: 'absent-target',
        outcome: 'idempotent-success-unchanged',
      }] : []),
      ...(['invite', 'transferOwner'].includes(name) ? [{
        branch: name === 'invite' ? 'already-active-member' : 'already-current-owner',
        outcome: 'typed-precondition-refusal',
      }] : []),
      {
        branch: 'hidden-target-or-scope',
        outcome: 'non-enumerating-denial',
      },
    ];
    const addMutation = (name, transitionOps) => operations.push({
      name,
      kind: 'Mutation',
      authRequirement: 'authenticated',
      hooks: [
        'useSnapbackMutation',
        'useSnapbackAuthorityMutation',
        'useSnapbackOutbox.mutationStatus',
        'useSnapbackAuthorityMutationStatus',
      ],
      transitionOps,
      outcomes: operationOutcomes(name),
    });
    if (inviteRoles.length > 0) addMutation('invite', ['insert']);
    if (joinRoles.length > 0) addMutation('join', ['setRole']);
    if (transitions.some((transition) => (
      transition.op === 'remove'
      && transition.target === 'self'
      && (transition.from ?? []).some((role) => activeRoles.includes(role) && role !== 'owner')
    ))) addMutation('leave', ['remove']);
    if (changeRoleRoles.length > 0) addMutation('changeRole', ['setRole']);
    // Owner transfer is a dedicated two-seat planner. Any active non-owner
    // lattice role supplies the caller's valid successor state; the planner
    // prefers admin and otherwise follows the declared hierarchy order.
    if (activeRoles.includes('owner') && activeRoles.some((role) => role !== 'owner')) {
      addMutation('transferOwner', ['transferOwner']);
    }
    if (transitions.some((transition) => (
      transition.op === 'remove'
      && transition.target === 'other'
      && (transition.from ?? []).every((role) => role !== 'owner')
    ))) addMutation('remove', ['remove']);
    return { operations };
  };
  for (const request of authorityProfileRequests) {
    const { tableName, tableBuilder, declaration } = request;
    const table = tables[tableName];
    const spec = declaration?.spec;
    let refused = false;
    const refuse = (code, message, repair, extra = {}) => {
      refused = true;
      authorityProfileError(code, tableName, message, repair, extra);
    };
    if (targetProfile !== TARGET_PROFILE_LOCAL) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_TARGET',
        `authorityProfile() is not qualified for target ${targetProfile}`,
        `Generate this authority profile for ${TARGET_PROFILE_LOCAL}, or remove it until the selected target advertises AuthorityProfileV1.`,
        { targetProfile, supportedTarget: TARGET_PROFILE_LOCAL },
      );
    }
    if (!declaration?.afterMembership || !table?.membership) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_MEMBERSHIP_REQUIRED',
        'authorityProfile() must be chained after membership() on the same table',
        'Move .authorityProfile(...) immediately after this table\'s .membership(...) declaration.',
      );
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_SPEC_INVALID',
        'authorityProfile() requires { name, hierarchy, roster, projection? }',
        'Pass one object containing name, hierarchy, roster, and optional projection.',
      );
      continue;
    }
    const specKeys = Object.keys(spec).sort();
    const expectedSpecKeys = spec.projection === undefined
      ? ['hierarchy', 'name', 'roster']
      : ['hierarchy', 'name', 'projection', 'roster'];
    if (canonicalResultJson(specKeys) !== canonicalResultJson(expectedSpecKeys)) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_SPEC_INVALID',
        `authorityProfile() has invalid keys ${specKeys.join(', ') || '(none)'}`,
        'Use { name, hierarchy, roster, projection? }; move transition and role vocabulary declarations to membership().',
      );
    }
    const membership = table?.membership;
    const membershipId = membership?.id;
    if (typeof membershipId !== 'string' || membershipId.length === 0) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_STABLE_ID_REQUIRED',
        'the underlying membership must pin a stable id',
        'Add a non-empty id to membership(), then use the same value as authorityProfile().name.',
      );
    }
    if (typeof spec.name !== 'string' || !IDENT.test(spec.name)) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_ID_INVALID',
        `profile name ${JSON.stringify(spec.name)} is not a valid stable declaration id`,
        'Choose a non-empty JavaScript identifier for both membership().id and authorityProfile().name.',
      );
    } else if (typeof membershipId === 'string' && spec.name !== membershipId) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_ID_MISMATCH',
        `profile id ${spec.name} differs from membership id ${membershipId}`,
        `Set authorityProfile().name to ${JSON.stringify(membershipId)} so both projections share one stable identity.`,
        { profileId: spec.name, membershipId },
      );
    }
    if ((tableBuilder.authorityProfileDeclarations?.length ?? 0) !== 1) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
        'more than one active authority profile governs this membership relation',
        'Keep exactly one authorityProfile() declaration on the canonical membership table.',
        { declarations: tableBuilder.authorityProfileDeclarations?.length ?? 0 },
      );
    }
    if (typeof spec.name === 'string' && authorityProfiles.has(spec.name)) {
      const prior = authorityProfiles.get(spec.name)?.table?.name ?? null;
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
        `profile id ${spec.name} already governs membership relation ${String(prior)}`,
        'Give every profile-backed membership relation one distinct pinned id, or remove the duplicate profile declaration.',
        { profileId: spec.name, otherTable: prior },
      );
    }
    if (tableBuilder.permissionBackingDeclared || tableBuilder.permissionFields !== undefined) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
        'a legacy permissionBacking declaration also governs this membership relation',
        'Remove permissionBacking()/permissionFields; membership() owns the authority backing derivation.',
        { legacyDeclaration: 'permissionBacking' },
      );
    }
    const fields = new Map((table?.fields ?? []).map((field) => [field.name, field]));
    const principalField = fields.get(membership?.principal);
    if (!principalField || principalField.optional || principalField.field_type !== 'Principal') {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_PRINCIPAL_TYPE_MISMATCH',
        `principal key ${String(membership?.principal)} must be a required v.principal() field`,
        'Point membership().principal at one required v.principal() field.',
        { principalField: membership?.principal ?? null },
      );
    }
    const resourceField = fields.get(membership?.resource);
    const resourceTable = resourceField ? idFieldTypeTable(resourceField.field_type) : null;
    if (membership?.scope !== 'resource' || !resourceField || resourceField.optional || resourceTable === null) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_SCOPE_TYPE_MISMATCH',
        `scope key ${String(membership?.resource)} must be a required nominal v.id(resourceTable) field`,
        'Use resource-scoped membership and point membership().resource at one required v.id(<scope table>) field.',
        { scope: membership?.scope ?? null, resourceField: membership?.resource ?? null },
      );
    } else if (!tables[resourceTable]) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_RESOURCE_BINDING_INVALID',
        `scope key ${membership.resource} binds unknown resource table ${resourceTable}`,
        `Declare table ${resourceTable}, or retarget ${membership.resource} to a declared scope table.`,
        { resourceField: membership.resource, resourceTable },
      );
    }
    const roleField = fields.get(membership?.role);
    const roles = Array.isArray(membership?.roles) ? membership.roles : [];
    const pendingRoles = Array.isArray(membership?.pendingRoles) ? membership.pendingRoles : [];
    if (!roleField || roleField.optional || roleField.field_type !== 'String'
      || roles.length === 0 || new Set([...roles, ...pendingRoles]).size !== roles.length + pendingRoles.length) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_ROLE_VOCABULARY_INVALID',
        'role/status authority must come from one required membership role field with disjoint closed roles and pendingRoles',
        'Use a required v.string() role field, list active values in roles, and list invited values only in pendingRoles.',
      );
    }
    if (!roles.includes('owner')
      || membership?.bootstrapRole !== 'owner'
      || membership?.lastHolder?.protect !== 'owner') {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_AMBIGUOUS_OWNER',
        'owner must be the real bootstrapRole and protected lastHolder membership role',
        "Declare 'owner' in roles with bootstrapRole: 'owner' and lastHolder: { protect: 'owner' }.",
        {
          roles,
          bootstrapRole: membership?.bootstrapRole ?? null,
          protectedRole: membership?.lastHolder?.protect ?? null,
        },
      );
    }
    const ownerMutatingTransition = (membership?.transitions ?? []).find((transition) => (
      transition.to?.includes('owner')
      || ((transition.op === 'setRole' || transition.op === 'remove')
        && (transition.from === undefined || transition.from.includes('owner')))
    ));
    if (ownerMutatingTransition) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_UNGOVERNED_WRITE_PATH',
        `ordinary membership transition ${ownerMutatingTransition.op} can create, change, or remove owner`,
        'Remove owner from ordinary transition from/to sets; owner transfer is a separately qualified atomic operation.',
        { transition: ownerMutatingTransition },
      );
    }
    for (const requiredIndex of ['_membership_pk', '_membership_reverse']) {
      if ((tableBuilder.indexes ?? []).some((index) => index.name === requiredIndex)) {
        refuse(
          'SNAPBACK_AUTHORITY_PROFILE_REQUIRED_INDEX_MISSING',
          `author index ${requiredIndex} prevents membership from owning its required generated index`,
          `Rename the authored ${requiredIndex} index; membership owns that reserved index identity.`,
          { index: requiredIndex },
        );
      }
    }
    const relationIdentity = membership
      ? `${tableName}\u0000${String(membership.resource)}\u0000${String(membership.principal)}`
      : null;
    if (relationIdentity && authorityProfileRelations.has(relationIdentity)) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
        'another active authority profile already governs this scope/principal relation',
        'Keep one authorityProfile() declaration on the canonical membership relation and remove the competing declaration.',
        { otherTable: authorityProfileRelations.get(relationIdentity) },
      );
    }
    let hierarchyClosed = null;
    const hierarchy = spec.hierarchy;
    if (!hierarchy || typeof hierarchy !== 'object' || Array.isArray(hierarchy)) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID',
        'hierarchy must be an object over active membership roles',
        'Declare hierarchy as { role: [impliedRole, ...] } using active roles only.',
      );
    } else {
      let hierarchyValid = true;
      for (const [role, implied] of Object.entries(hierarchy)) {
        if (pendingRoles.includes(role) || (Array.isArray(implied) && implied.some((item) => pendingRoles.includes(item)))) {
          hierarchyValid = false;
          refuse(
            'SNAPBACK_AUTHORITY_PROFILE_PENDING_STATUS_INVALID',
            `pending role/status appears in hierarchy at ${role}`,
            'Keep invited statuses only in membership().pendingRoles; hierarchy may name active roles only.',
            { role },
          );
          continue;
        }
        if (!roles.includes(role) || !Array.isArray(implied) || implied.length !== new Set(implied).size
          || implied.some((item) => typeof item !== 'string' || !roles.includes(item))) {
          hierarchyValid = false;
          refuse(
            'SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID',
            `hierarchy entry ${role} is not a unique list of active roles`,
            'Use only declared active membership roles in hierarchy keys and values.',
            { role },
          );
        }
      }
      if (hierarchyValid) {
        try {
          hierarchyClosed = closeAuthorityHierarchy(roles, hierarchy);
          if (roles.some((role) => !hierarchyClosed.get('owner')?.includes(role))) {
            throw new Error('owner must imply every active role');
          }
        } catch (error) {
          refuse(
            'SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID',
            error.message,
            'Make hierarchy acyclic and ensure owner implies every active role.',
          );
        }
      }
    }
    const roster = spec.roster;
    const visibleFields = roster?.visible;
    if (!roster || typeof roster !== 'object' || Array.isArray(roster)
      || Object.keys(roster).some((key) => key !== 'visible')
      || !Array.isArray(visibleFields) || visibleFields.length === 0
      || visibleFields.length !== new Set(visibleFields).size
      || visibleFields.some((field) => typeof field !== 'string' || !fields.has(field))) {
      refuse(
        'SNAPBACK_AUTHORITY_PROFILE_ROSTER_INVALID',
        'roster must contain one non-empty unique visible field list over this membership table',
        'Set roster to { visible: [<existing membership-table field>, ...] }; these fields are the exact generated list/myRole projection.',
      );
    }
    let productProjection = null;
    if (spec.projection !== undefined) {
      const projection = spec.projection;
      const history = projection?.history;
      const historyVisibleFields = history?.visible;
      const recipients = projection?.recipients;
      const recipientCeiling = recipients?.ceiling;
      const recipientSinks = recipients?.sinks;
      if (membership?.provenance !== 'full') {
        refuse(
          'SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED',
          'authorityProfile().projection requires membership provenance "full"',
          'Set membership({ provenance: "full", ... }) before enabling the generated product projection.',
          { declaration: membershipId, actualProvenance: membership?.provenance ?? null },
        );
      }
      if (!projection || typeof projection !== 'object' || Array.isArray(projection)
        || canonicalResultJson(Object.keys(projection).sort()) !== canonicalResultJson(['history', 'recipients'])
        || !history || typeof history !== 'object' || Array.isArray(history)
        || canonicalResultJson(Object.keys(history).sort()) !== canonicalResultJson(['visible'])
        || !Array.isArray(historyVisibleFields)
        || historyVisibleFields.length !== new Set(historyVisibleFields).size
        || !recipients || typeof recipients !== 'object' || Array.isArray(recipients)
        || canonicalResultJson(Object.keys(recipients).sort()) !== canonicalResultJson(['ceiling', 'sinks'])
        || !Number.isSafeInteger(recipientCeiling)
        || recipientCeiling < 1
        || recipientCeiling > 1_024
        || !Array.isArray(recipientSinks)
        || recipientSinks.length === 0) {
        refuse(
          'SNAPBACK_AUTHORITY_PROJECTION_INVALID',
          'projection must declare history.visible plus recipients.{ceiling,sinks}',
          'Declare a finite ceiling and at least one exact sending-operation/product-row sink.',
        );
      } else {
        const unknown = historyVisibleFields.filter(
          (field) => typeof field !== 'string' || !fields.has(field),
        );
        const authorityAxes = new Set([
          membership?.principal,
          membership?.resource,
          membership?.role,
          '_id',
          '_version',
          '_createdAt',
          '_updatedAt',
        ]);
        const authorityFields = historyVisibleFields.filter((field) => authorityAxes.has(field));
        const currentRosterFields = new Set(Array.isArray(visibleFields) ? visibleFields : []);
        const duplicateCurrentFields = historyVisibleFields.filter(
          (field) => currentRosterFields.has(field),
        );
        const normalizedRecipientSinks = [];
        const sinkOperations = new Set();
        for (const sink of recipientSinks) {
          const keys = sink && typeof sink === 'object' && !Array.isArray(sink)
            ? Object.keys(sink).sort()
            : [];
          const validKeys = canonicalResultJson(keys)
            === canonicalResultJson(['operation', 'recipientsField', 'scopeField', 'table']);
          const operation = sink?.operation;
          const sinkTable = sink?.table;
          const scopeField = sink?.scopeField;
          const recipientsField = sink?.recipientsField;
          const functionDefinition = typeof operation === 'string'
            ? functionsModule[operation]
            : null;
          const rawSinkTable = typeof sinkTable === 'string' ? schemaDef.tables?.[sinkTable] : null;
          const rawScopeField = rawSinkTable?.fields?.[scopeField];
          const rawRecipientsField = rawSinkTable?.fields?.[recipientsField];
          const validScope = idFieldTypeTable(rawScopeField?.fieldType) === resourceTable
            && rawScopeField?.optional !== true;
          const validRecipients = rawRecipientsField?.primitive === 'array'
            && rawRecipientsField?.optional !== true
            && rawRecipientsField?.element?.fieldType === 'Principal'
            && Number.isSafeInteger(rawRecipientsField?.resultOptions?.maxItems)
            && rawRecipientsField.resultOptions.maxItems >= recipientCeiling;
          const validFunction = functionDefinition?.__kind === 'Mutation'
            && Array.isArray(functionDefinition?.js?.writes)
            && functionDefinition.js.writes.includes(sinkTable);
          if (!validKeys
            || !isOperationName(operation)
            || ![sinkTable, scopeField, recipientsField].every(
              (value) => typeof value === 'string' && IDENT.test(value),
            )
            || !validScope
            || !validRecipients
            || !validFunction
            || sinkOperations.has(operation)
            || functionDefinition?.[GENERATED_AUTHORITY_OPERATION] !== undefined) {
            refuse(
              'SNAPBACK_AUTHORITY_RECIPIENT_SINK_INVALID',
              'recipient sinks must bind one unique authored mutation to a declared product row and bounded principal-array field',
              'Declare { operation, table, scopeField, recipientsField }; make operation a mutation that writes table, scopeField a required id of the profile scope table, and recipientsField a required v.array(v.principal(), { maxItems: ceiling-or-greater }).',
              { sink },
            );
            continue;
          }
          // @ref LLP 0240#invariants-the-prototype-must-preserve — freezing
          // keeps the set out of handler results, but table visibility still
          // owns product reads. Public publication remains an author choice;
          // name it rather than silently treating host privacy as read policy.
          if (rawSinkTable.visibilityDeclaration?.kind === 'public-read') {
            warn(
              'SNAPBACK_AUTHORITY_RECIPIENT_SINK_PUBLIC_READ',
              'auth',
              `${sinkTable}.${recipientsField}: recipient snapshots are frozen host-side but this public-read table publishes the principal set to every reader`,
              {
                table: sinkTable,
                details: {
                  operation,
                  table: sinkTable,
                  field: recipientsField,
                  visibility: 'public-read',
                  repair: 'Use owner or membership visibility unless public recipient publication is intentional.',
                },
              },
            );
          }
          sinkOperations.add(operation);
          normalizedRecipientSinks.push({
            operation,
            table: sinkTable,
            scopeField,
            recipientsField,
          });
        }
        if (unknown.length > 0 || authorityFields.length > 0 || duplicateCurrentFields.length > 0) {
          refuse(
            'SNAPBACK_AUTHORITY_PROJECTION_FIELD_INVALID',
            'history-visible projection fields must exist and be historical-only product fields',
            'Remove unknown fields, membership authority axes, and fields already exposed by roster.visible.',
            {
              unknownFields: unknown,
              authorityFields,
              duplicateCurrentFields,
            },
          );
        } else if (normalizedRecipientSinks.length === recipientSinks.length) {
          // @ref LLP 0240#projection-activation-source-capture-and-backfill —
          // the manifest pins row-image capture and the finite send ceiling;
          // the transition ledger is corroboration, never the projection
          // source.
          productProjection = {
            version: 1,
            source: 'writer-seam-row-images',
            history: {
              visibleFields: [...historyVisibleFields].sort(compareCodeUnits),
              incarnationSemantics: 'presence-v1',
            },
            recipients: {
              ceiling: recipientCeiling,
              overflow: 'typed-refusal',
              freeze: 'sending-transaction',
              sinks: normalizedRecipientSinks,
            },
            historyHorizon: {
              carrier: 'operation-envelope',
              coverage: ['full', 'authorization-facts-only'],
            },
            offlineRetention: 'not-implied',
          };
        }
      }
    }
    if (refused || !hierarchyClosed || !membership || !resourceTable) continue;

    const authorizationEventFields = (table.fields ?? [])
      .map((field) => field.name)
      .filter((field) => !(membership.incidental ?? []).includes(field));
    if (membership.provenance) {
      authorizationEventFields.push('grantedByActor', 'grantedByEffective', 'grantedByGrant');
    }
    const requiredIndexes = [
      {
        name: '_membership_pk',
        fields: [membership.principal, membership.resource],
        unique: true,
        lookup: 'principal-in-scope-point',
      },
      {
        name: '_membership_reverse',
        fields: [membership.resource, membership.role, membership.principal],
        unique: false,
        lookup: 'protected-holders-and-scope-invalidation-range',
      },
    ];
    const roleLatticeOrder = authorityHierarchyOrder(roles, hierarchyClosed);
    const authorityOperations = authorityOperationsForMembership(membership, productProjection);
    // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
    // — transferOwner consumes the first active non-owner lattice entry, so
    // the manifest projection carries one canonical hierarchy-topological
    // order rather than the authorial membership vocabulary order.
    const profile = {
      version: 1,
      id: spec.name,
      membership: {
        declaration: membershipId,
        manifestPath: `tables.${tableName}.membership`,
        predicateIdentity: 'snapback.membership-predicate.v1',
      },
      tablePolicy: {
        identity: 'snapback.table-visibility.v1',
        membershipDeclaration: membershipId,
      },
      scopeRelation: {
        table: tableName,
        resourceField: membership.resource,
        resourceTable,
        principalKey: membership.principal,
      },
      statusPredicates: {
        active: 'membership.roles',
        invited: 'membership.pendingRoles',
      },
      roleLattice: roleLatticeOrder.map((role) => ({
        role,
        implies: hierarchyClosed.get(role),
      })),
      ownerBootstrapInvariant: {
        role: 'owner',
        bootstrapRole: 'owner',
        protectedLastHolderRole: 'owner',
      },
      transitionPreconditions: {
        source: 'membership.transitions',
        membershipDeclarationId: membershipId,
        matrix: canonicalAuthorityTransitionMatrix(membership.transitions ?? []),
        provenance: membership.provenance ?? null,
        expiryPresent: membership.expiry !== undefined,
        principalAddressedWritesRemove: membership.principalAddressedWrites?.remove ?? null,
        ownerMutation: 'transfer-owner-only',
      },
      authorizationEventFields,
      subjectDerivation: {
        strategy: 'membership-principal-resource-v1',
        principalField: membership.principal,
        scopeField: membership.resource,
        coarseGlobalWakeUniverse: [
          'membership-relation-insert-update-delete',
          'protected-resource-row-insert-update-delete',
          'effective-principal-or-auth-context-change',
          'authority-profile-generation-activation',
        ],
      },
      requiredIndexes,
      permittedCompositionClasses: [
        'table-visibility.membership.v1',
        'function-admission.membership.v1',
        'membership-visible-search.v1',
        'authority-roster-projection.v1',
        'authority-roster-transitions.v1',
      ],
      notYetQualifiedCompositionClasses: [
        'authority-profile-asset-sharing.v1',
      ],
      roster: { visibleFields: [...visibleFields] },
      ...(productProjection === null ? {} : { projection: productProjection }),
      operations: authorityOperations.operations,
    };
    // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
    // — generation is the closed identity of the complete emitted authority
    // projection. Hashing the canonical profile after every member is derived,
    // but before `generation` itself is attached, binds closure sets, event
    // fields, wake universes, transition descriptors, composition classes,
    // operations, and lattice order without an enumerated-preimage escape.
    profile.generation = `sha256:${sha256(`snapback:authority-profile:v1\n${canonicalResultJson(profile)}`)}`;
    for (const sink of profile.projection?.recipients?.sinks ?? []) {
      functionsModule[sink.operation][GENERATED_AUTHORITY_OPERATION] = {
        id: profile.id,
        generation: profile.generation,
        operation: 'snapshotRecipients',
        recipientSink: { ...sink },
      };
    }
    table.authorityProfile = profile;
    authorityProfiles.set(profile.id, {
      table,
      profile,
      hierarchyClosed,
    });
    authorityProfileRelations.set(relationIdentity, tableName);
  }

  for (const table of Object.values(tables)) {
    const visibilityLeaves = tableVisibilityMembershipLeaves(table.visibility);
    for (const leaf of visibilityLeaves) {
      const authority = authorityProfiles.get(leaf.declaration);
      if (!authority) continue;
      const requested = leaf.roles ?? authority.profile.roleLattice.map(({ role }) => role);
      leaf.roles = [...new Set(requested.flatMap((minimumRole) => (
        authority.profile.roleLattice
          .filter(({ implies }) => implies.includes(minimumRole))
          .map(({ role }) => role)
      )))].sort();
    }
    for (const search of table.searchIndexes ?? []) {
      if (search.visibility?.kind !== 'membership') continue;
      const authority = authorityProfileForMembershipSearch(table, search, authorityProfiles, authorityProfileError);
      if (!authority) continue;
      // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
      // — profile-backed search lowers directly into the existing closed
      // SearchVisibilityV1 membership carrier. The search runtime therefore
      // consumes the same literal role closure and nonenumerating predicate
      // as list visibility; no second visibility plan or evaluator exists.
      const requested = search.visibility.roles
        ?? authority.profile.roleLattice.map(({ role }) => role);
      search.visibility.roles = [...new Set(requested.flatMap((minimumRole) => (
        authority.profile.roleLattice
          .filter(({ implies }) => implies.includes(minimumRole))
          .map(({ role }) => role)
      )))].sort();
      if (table.name === authority.profile.scopeRelation.table) {
        const visibleFields = new Set(authority.profile.roster.visibleFields);
        const authoredProjectionFields = [...new Set([
          ...Object.keys(search.textFields ?? {}),
          ...(search.storedFields ?? []),
          ...(search.highlightFields ?? []),
        ])].sort();
        const invisibleFields = authoredProjectionFields.filter((field) => !visibleFields.has(field));
        // Defense in depth: retain only the roster projection even though an
        // authored invisible field also fails this generation below. Resource
        // partitioning and the lowered role predicate remain unchanged.
        search.textFields = Object.fromEntries(
          Object.entries(search.textFields ?? {}).filter(([field]) => visibleFields.has(field)),
        );
        search.storedFields = (search.storedFields ?? []).filter((field) => visibleFields.has(field));
        search.highlightFields = (search.highlightFields ?? []).filter((field) => visibleFields.has(field));
        if (invisibleFields.length > 0) {
          authorityProfileError(
            'SNAPBACK_AUTHORITY_PROFILE_SEARCH_FIELD_NOT_VISIBLE',
            table.name,
            `profile-backed membership-table search index ${search.name} names roster-invisible fields ${invisibleFields.join(', ')}`,
            'Remove every invisible text/stored/highlight field from the index, or explicitly add the intended projection fields to authorityProfile().roster.visible.',
            {
              compositionClass: 'membership-visible-search.v1',
              declaration: authority.profile.id,
              index: search.name,
              invisibleFields,
              visibleFields: [...visibleFields].sort(),
            },
          );
        }
      }
    }
    if (table.assetSharing?.kind === 'membership'
      && authorityProfiles.has(table.assetSharing.membership)) {
      authorityProfileError(
        'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS',
        table.name,
        `assetSharing references authority profile ${table.assetSharing.membership}, but profile-backed assets are not yet qualified`,
        'Use owner/public assetSharing or remove the profile composition until the asset qualification lane lands.',
        { compositionClass: 'authority-profile-asset-sharing.v1', declaration: table.assetSharing.membership },
      );
    }
  }

  // @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
  // — lower the declaration before physical-index validation so generated
  // child storage participates in the same global namespace and schema hash.
  const assetCollectionCompilation = buildAssetCollections({
    functionsModule,
    tables,
    attribution: functionDefinitionAttribution,
    err,
  });
  Object.assign(functionsModule, assetCollectionCompilation.definitions);
  Object.assign(functionDefinitionSourceSpans, assetCollectionCompilation.sourceSpans);
  const assetCollections = assetCollectionCompilation.collections;
  if (assetCollections.length > 0) {
    for (const capability of [
      'assets.media-collection.v1',
      'assets.media-ref-projection.v1',
      'bounded_children_v1',
    ]) {
      if (!schemaRequiredCapabilities.includes(capability)) {
        schemaRequiredCapabilities.push(capability);
      }
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions —
  // handler admission and roster projections are generated from the same
  // closed lattice/table identity already used by table visibility.
  // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — each
  // profile emits the two reads plus exactly the mutations its closed
  // transition matrix can actually authorize. Missing transition, missing
  // operation: the public namespace never advertises a wider policy than the
  // declaration admits.
  for (const [profileName, authority] of authorityProfiles) {
    const { profile, table } = authority;
    const membership = table.membership;
    const transitions = membership.transitions ?? [];
    const activeRoles = profile.roleLattice.map(({ role }) => role).sort(compareCodeUnits);
    const pendingRoles = membership.pendingRoles ?? [];
    const transitionRoles = (op, target, key, predicate = () => true) => [...new Set(
      transitions
        .filter((transition) => (
          transition.op === op
          && transition.target === target
          && predicate(transition)
        ))
        .flatMap((transition) => transition[key] ?? []),
    )].sort(compareCodeUnits);
    const inviteRoles = transitionRoles('insert', 'other', 'to');
    const joinRoles = transitionRoles('setRole', 'self', 'to', (transition) => (
      (transition.from ?? []).some((role) => pendingRoles.includes(role))
      && (transition.to ?? []).some((role) => activeRoles.includes(role))
    ));
    const changeRoleRoles = transitionRoles('setRole', 'other', 'to', (transition) => (
      !(transition.from ?? []).includes('owner')
      && !(transition.to ?? []).includes('owner')
    ));
    const mutationOperations = [
      ...(inviteRoles.length > 0 ? ['invite'] : []),
      ...(joinRoles.length > 0 ? ['join'] : []),
      ...(transitions.some((transition) => (
        transition.op === 'remove'
        && transition.target === 'self'
        && (transition.from ?? []).some((role) => activeRoles.includes(role) && role !== 'owner')
      )) ? ['leave'] : []),
      ...(changeRoleRoles.length > 0 ? ['changeRole'] : []),
      // transferOwner is the dedicated D1 operation, not a transition-matrix
      // alias. Any active non-owner role supplies a valid caller successor;
      // the runtime planner chooses it in declared hierarchy order.
      ...(activeRoles.includes('owner') && activeRoles.some((role) => role !== 'owner') ? ['transferOwner'] : []),
      ...(transitions.some((transition) => (
        transition.op === 'remove'
        && transition.target === 'other'
        && (transition.from ?? []).every((role) => role !== 'owner')
      )) ? ['remove'] : []),
    ];
    const readOperations = [
      'list',
      'myRole',
      ...(profile.projection === undefined ? [] : ['history', 'incarnations']),
    ];
    const operationNames = [...readOperations, ...mutationOperations]
      .map((operation) => `${profileName}.${operation}`);
    if (GENERATED_API_RESERVED_EXPORTS.has(profileName)) {
      authorityProfileError(
        'SNAPBACK_AUTHORITY_PROFILE_OPERATION_COLLISION',
        table.name,
        `generated authority-profile API for ${profileName} collides with a generated API namespace`,
        'Choose an authorityProfile name that is not api, app, artifacts, defaults, ephemeral, or groups.',
        { declaration: profileName, namespace: profileName },
      );
      continue;
    }
    const collision = [profileName, ...operationNames].find((name) => functionsModule[name] !== undefined);
    if (collision !== undefined) {
      authorityProfileError(
        'SNAPBACK_AUTHORITY_PROFILE_OPERATION_COLLISION',
        table.name,
        `generated authority-profile API for ${profileName} collides with function ${collision}`,
        `Rename the authored function or choose another authorityProfile name; ${operationNames.join(', ')} are reserved by the profile.`,
        { declaration: profileName, function: collision },
      );
      continue;
    }
    const resourceValidator = schemaDef.tables?.[table.name]?.fields?.[membership.resource];
    const roleValidator = (roles) => roles.length === 1
      ? v.literal(roles[0])
      : v.union(roles.map((role) => v.literal(role)));
    const profileRoleValidator = roleValidator(
      [...new Set([...activeRoles, ...pendingRoles])],
    );
    for (const operation of readOperations) {
      const operationName = `${profileName}.${operation}`;
      const historicalVisibleFields = profile.projection?.history?.visibleFields ?? [];
      // History is not a privileged roster escape hatch. Authority axes are
      // present only when the author explicitly placed their membership field
      // in roster.visible; the private incarnation key is never projected.
      const historyShowsPrincipal = profile.roster.visibleFields.includes(membership.principal);
      const historyShowsScope = profile.roster.visibleFields.includes(membership.resource);
      const historyShowsRole = profile.roster.visibleFields.includes(membership.role);
      const historyFacts = operation === 'history'
        ? {
            ...(historyShowsPrincipal ? { principal: v.principal() } : {}),
            ...(historyShowsScope ? { scope: resourceValidator } : {}),
            event: v.union([
              v.literal('join'),
              v.literal('roleChange'),
              v.literal('patch'),
              v.literal('leave'),
            ]),
            ...(historyShowsRole ? {
              role: profileRoleValidator,
              status: v.union([v.literal('active'), v.literal('invited'), v.literal('departed')]),
            } : {}),
            commit: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
            at: v.optional(v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })),
            ...Object.fromEntries(historicalVisibleFields.map((field) => [
              field,
              schemaDef.tables[table.name].fields[field].optional
                ? schemaDef.tables[table.name].fields[field]
                : v.optional(schemaDef.tables[table.name].fields[field]),
            ])),
          }
        : operation === 'incarnations'
          ? {
              ...(historyShowsPrincipal ? { principal: v.principal() } : {}),
              ...(historyShowsScope ? { scope: resourceValidator } : {}),
              joinedAt: v.optional(v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })),
              leftAt: v.optional(v.union([
                v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
                v.null(),
              ])),
              ...(historyShowsRole ? {
                currentRole: profileRoleValidator,
                status: v.union([v.literal('active'), v.literal('invited'), v.literal('departed')]),
              } : {}),
              ...Object.fromEntries(historicalVisibleFields.map((field) => [
                field,
                schemaDef.tables[table.name].fields[field].optional
                  ? schemaDef.tables[table.name].fields[field]
                  : v.optional(schemaDef.tables[table.name].fields[field]),
              ])),
            }
          : null;
      const resultFields = operation === 'list'
        ? Object.fromEntries(profile.roster.visibleFields.map((field) => [
            field,
            field === membership.role
              ? profileRoleValidator
              : schemaDef.tables[table.name].fields[field],
          ]))
        : operation === 'myRole' ? {
            role: profileRoleValidator,
            status: v.union([v.literal('active'), v.literal('invited')]),
          } : historyFacts;
      const historyRowValidator = historyFacts === null ? null : v.object(historyFacts);
      const historyPageValidator = historyRowValidator === null ? null : v.object({
        rows: v.array(historyRowValidator, { maxItems: 1_000 }),
        cursor: v.union([v.string(), v.null()]),
        boundary: v.union([v.literal('exact'), v.literal('at-limit')]),
        horizon: v.object({
          earliestCoveredCommit: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
          coverageClass: v.union([
            v.literal('full'),
            v.literal('authorization-facts-only'),
          ]),
        }),
      });
      const definition = defineJsLiveQuery({
        auth: 'authenticated',
        args: operation === 'list' || operation === 'history' || operation === 'incarnations'
          ? {
              scopeId: resourceValidator,
              page: v.optional(v.object({
                after: v.optional(v.string()),
                limit: v.optional(v.integer({ min: 1, max: 1000 })),
              })),
            }
          : { scopeId: resourceValidator },
        reads: [table.name],
        result: historyPageValidator === null
          ? results.records(v.object(resultFields))
          : results.value(historyPageValidator),
        source: '__snapback_authority_profile_generated__',
        exportName: operationName,
      });
      // These definitions are synthesized after the capability-empty author
      // evaluator, so project the same isolated-definition marker that the
      // evaluator would have copied from defineJsLiveQuery's private symbol.
      definition.__snapbackDefinitionKind = 'function';
      definition.js.generatedSource = authorityProfileProjectionSource({
        declaration: profile.id,
        operation,
        profileName,
      });
      definition[GENERATED_AUTHORITY_OPERATION] = {
        id: profile.id,
        generation: profile.generation,
        operation,
      };
      functionsModule[operationName] = definition;
    }

    const insertExtraFields = [...new Set(
      transitions
        .filter((transition) => transition.op === 'insert' && transition.target === 'other')
        .flatMap((transition) => transition.fields ?? []),
    )]
      .filter((field) => ![membership.resource, membership.principal, membership.role].includes(field))
      .sort(compareCodeUnits);
    for (const operation of mutationOperations) {
      const operationName = `${profileName}.${operation}`;
      const args = { scopeId: resourceValidator };
      if (operation === 'invite' || operation === 'changeRole') {
        args.principal = v.principal();
      }
      if (operation === 'invite') {
        args.role = roleValidator(inviteRoles);
        for (const field of insertExtraFields) {
          args[field] = schemaDef.tables[table.name].fields[field];
        }
      } else if (operation === 'join') {
        args.invitation = roleValidator(joinRoles);
      } else if (operation === 'changeRole') {
        args.role = roleValidator(changeRoleRoles);
      } else if (operation === 'transferOwner' || operation === 'remove') {
        args.principal = v.principal();
      }
      const definition = defineJsMutation({
        auth: 'authenticated',
        authorityCreating: true,
        args,
        reads: [table.name],
        writes: [table.name],
        result: results.value(v.null()),
        source: '__snapback_authority_profile_generated__',
        exportName: operationName,
      });
      definition.__snapbackDefinitionKind = 'function';
      definition.js.generatedSource = authorityProfileMutationSource({
        declaration: profile.id,
        insertExtraFields,
        membership,
        operation,
        operationName,
      });
      definition[GENERATED_AUTHORITY_OPERATION] = {
        id: profile.id,
        generation: profile.generation,
        operation,
      };
      // Roster reads and transitions authorize the authenticated effective
      // principal even when their emitted handler source contains no direct
      // ctx.auth access. Keep that fact explicit in authorization review for
      // both JS query and mutation compilation branches.
      definition.authorizationDependence = ['userId'];
      functionsModule[operationName] = definition;
    }
  }

  if (
    Object.values(tables).some((table) => (table.searchIndexes?.length ?? 0) > 0)
    && !schemaRequiredCapabilities.includes('full_text_search_v1')
  ) {
    schemaRequiredCapabilities.push('full_text_search_v1');
  }
  if (
    Object.values(tables).some((table) => (
      table.searchLiveLimits !== undefined
      || (table.searchIndexes ?? []).some((index) => index.liveLimits !== undefined)
    ))
    && !schemaRequiredCapabilities.includes('live_full_text_search_v1')
  ) {
    schemaRequiredCapabilities.push('live_full_text_search_v1');
  }
  if (
    Object.values(tables).some((table) => (
      (table.vectorIndexes?.length ?? 0) > 0
      || table.fields.some((field) => field.field_type?.Vector)
    ))
    && !schemaRequiredCapabilities.includes('vector_search_v1')
  ) {
    schemaRequiredCapabilities.push('vector_search_v1');
  }
  if (
    Object.values(tables).some((table) => (
      table.fields.some((field) => field.field_type?.Structured)
    ))
    && !schemaRequiredCapabilities.includes('structured_stored_value_v1')
  ) {
    // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
    // — an older runtime must refuse the schema instead of treating the
    // externally tagged carrier as Json or an unknown ignorable field.
    schemaRequiredCapabilities.push('structured_stored_value_v1');
  }
  if (
    schemaDef.pushSeam?.ledger
    && !schemaRequiredCapabilities.includes('notifications.expoPushSeam')
  ) {
    schemaRequiredCapabilities.push('notifications.expoPushSeam');
  }

  // SQLite index names are database-global and the physical spelling joins
  // table/index with `_`. Reserve the two declaration-derived membership
  // indexes in the same namespace as user indexes before emitting artifacts.
  // @ref LLP 0056#declaring-a-membership-table — generated membership indexes
  //   are true schema objects, so a colliding author declaration must fail.
  const physicalIndexNames = new Map();
  for (const table of Object.values(tables)) {
    const entries = table.indexes.map((index) => ({ name: index.name, generatedMembership: false }));
    if (table.membership) {
      entries.push(
        { name: '_membership_pk', generatedMembership: true },
        { name: '_membership_reverse', generatedMembership: true },
      );
    }
    for (const entry of entries) {
      const physicalName = `${table.name}_${entry.name}`;
      const current = { table: table.name, index: entry.name, generatedMembership: entry.generatedMembership };
      const previous = physicalIndexNames.get(physicalName);
      if (previous) {
        const membershipCollision = previous.generatedMembership || current.generatedMembership;
        err(
          membershipCollision ? 'SCHEMA_MEMBERSHIP_INDEX_NAME_COLLISION' : 'SCHEMA_INDEX_NAME_COLLISION',
          'schema',
          `index ${table.name}.${entry.name} collides with ${previous.table}.${previous.index} at physical name ${physicalName}`,
          {
            table: table.name,
            index: entry.name,
            physicalName,
            declarations: [`${previous.table}.${previous.index}`, `${table.name}.${entry.name}`],
          },
        );
      } else {
        physicalIndexNames.set(physicalName, current);
      }
    }
  }

  const membershipDeclarations = new Map();
  const membershipGeneratedSymbols = new Map();
  for (const table of Object.values(tables)) {
    if (!table.membership) continue;
    const declaration = table.membership.id ?? table.name;
    if (!IDENT.test(declaration)) {
      err('SCHEMA_MEMBERSHIP_INVALID_ID', 'schema', `table ${table.name} membership declaration id ${declaration} is invalid`, {
        table: table.name,
        declaration,
      });
    }
    const prior = membershipDeclarations.get(declaration);
    if (prior) {
      err('SCHEMA_MEMBERSHIP_DUPLICATE_ID', 'schema', `membership declaration ${declaration} is used by both ${prior.table.name} and ${table.name}`, {
        declaration,
        tables: [prior.table.name, table.name],
      });
    } else {
      membershipDeclarations.set(declaration, { table, membership: table.membership });
    }
    if (typeof declaration === 'string' && IDENT.test(declaration)) {
      const generatedSymbol = `${pascal(declaration)}Role`;
      const priorSymbol = membershipGeneratedSymbols.get(generatedSymbol);
      if (priorSymbol && priorSymbol.declaration !== declaration) {
        err(
          'SCHEMA_MEMBERSHIP_GENERATED_SYMBOL_COLLISION',
          'schema',
          `membership declarations ${JSON.stringify(priorSymbol.declaration)} and ${JSON.stringify(declaration)} both generate TypeScript symbol ${generatedSymbol}`,
          {
            declaration,
            generatedSymbol,
            declarations: [priorSymbol.declaration, declaration],
            tables: [priorSymbol.table.name, table.name],
          },
        );
      } else if (!priorSymbol) {
        membershipGeneratedSymbols.set(generatedSymbol, { declaration, table });
      }
    }
  }

  // --- Build + validate functions --------------------------------------------
  const ephemeralCollections = buildEphemeralCollections(schemaDef.ephemeral, tables, err, targetProfile);
  const functions = [];
  const contractQueries = dict();
  const contractMutations = dict();
  const contractActions = dict();
  const cronDefs = [];
  const configDefs = [];
  const projectionDefs = [];
  const assetUploadDefs = [];
  const commandDefs = [];
  const surfaceDefs = [];
  const renderInlineOperation = testHooks?.inlineRenderer === 'legacy'
    ? renderInlineOperationModule
    : renderInlineOperationGraphModule;

  const compileHandlerMembershipAdmission = (def, name) => {
    const compiled = [];
    if ((def.membership?.length ?? 0) > 0 && def.__kind !== 'Mutation') {
      const contract = def.resultContract;
      const admitsEmptyRows = contract === undefined
        || contract.kind === 'documents'
        || (contract.kind === 'records' && (contract.rows?.minItems ?? 0) === 0);
      if (!admitsEmptyRows) {
        err(
          'SNAPBACK_AUTHORITY_PROFILE_QUERY_DENIAL_RESULT_INCOMPATIBLE',
          'function',
          `${name}: membership admission blanks denied reads with [], but the declared ${contract.kind} result cannot represent an empty row set`,
          {
            function: name,
            details: {
              resultKind: contract.kind,
              repair: 'Declare a row-set result with results.documents(...), results.records(...) with minItems 0, or the legacy row validator; otherwise move the terminal denial into the handler under a separately designed result contract.',
            },
          },
        );
        return compiled;
      }
    }
    for (const predicate of def.membership ?? []) {
      if (!predicate || predicate.__membershipPredicate !== true) {
        err('QUERY_MEMBERSHIP_INVALID', 'function', `${name}: membership predicate must come from a declaration-bound helper`, { function: name });
        continue;
      }
      const found = membershipDeclarations.get(predicate.declaration);
      const authority = authorityProfiles.get(predicate.declaration);
      if (!found) {
        err('QUERY_MEMBERSHIP_UNKNOWN_DECLARATION', 'function', `${name}: membership predicate names unknown declaration ${String(predicate.declaration)}`, {
          function: name,
          declaration: predicate.declaration ?? null,
        });
        continue;
      }
      if (!authority) {
        err(
          'SNAPBACK_AUTHORITY_PROFILE_FUNCTION_ADMISSION_REQUIRED',
          'function',
          `${name}: opaque handler membership admission requires authorityProfile() on declaration ${predicate.declaration}`,
          { function: name, declaration: predicate.declaration },
        );
        continue;
      }
      if (predicate.roles !== null) {
        if (!Array.isArray(predicate.roles) || predicate.roles.length === 0) {
          err('QUERY_MEMBERSHIP_EMPTY_ROLES', 'function', `${name}: hasRole must name at least one role`, {
            function: name,
            declaration: predicate.declaration,
          });
          continue;
        }
        const vocabulary = new Set(found.membership.roles);
        const unknownRole = predicate.roles.find((role) => !vocabulary.has(role));
        if (unknownRole !== undefined) {
          err('QUERY_MEMBERSHIP_UNKNOWN_ROLE', 'function', `${name}: ${predicate.declaration}.hasRole names undeclared active role ${String(unknownRole)}`, {
            function: name,
            declaration: predicate.declaration,
            role: unknownRole,
          });
          continue;
        }
      }
      const resource = predicate.resource;
      if (!resource || resource.__membershipResourceRef !== true || resource.kind === 'rowField') {
        err(
          'QUERY_MEMBERSHIP_RESOURCE_REF_INVALID',
          'function',
          `${name}: handler admission requires membershipResource.arg(); row-field references exist only inside declarative row plans`,
          { function: name, declaration: predicate.declaration },
        );
        continue;
      }
      let resourceArg = null;
      if (found.membership.scope === 'resource') {
        if (resource.kind !== 'arg') {
          err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: resource-scoped declaration ${predicate.declaration} requires membershipResource.arg()`, {
            function: name,
            declaration: predicate.declaration,
          });
          continue;
        }
        const segments = typeof resource.path === 'string' ? resource.path.split('.') : [];
        let validator = segments.length > 0 ? def.args?.[segments[0]] : null;
        for (const segment of segments.slice(1)) {
          validator = validator?.primitive === 'object' ? validator.fields?.[segment] : null;
        }
        const actualTable = idFieldTypeTable(validator?.fieldType);
        if (actualTable !== found.membership.resourceTable) {
          err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: ${predicate.declaration} expects Id<${found.membership.resourceTable}> but membershipResource.arg(${JSON.stringify(resource.path)}) resolves to ${actualTable === null ? 'a non-id value' : `Id<${actualTable}>`}`, {
            function: name,
            declaration: predicate.declaration,
            expectedTable: found.membership.resourceTable,
            actualTable,
          });
          continue;
        }
        resourceArg = resource.path;
      } else if (resource.kind !== 'app') {
        err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: app-scoped declaration ${predicate.declaration} requires membershipResource.app()`, {
          function: name,
          declaration: predicate.declaration,
        });
        continue;
      }
      compiled.push({
        declaration: predicate.declaration,
        resourceArg,
        roles: lowerAuthorityProfileRoles(predicate, authority),
        table: found.table.name,
      });
    }
    return compiled;
  };

  // @ref LLP 0108#final-author-reconciliation-after-round-3 — codegen
  // evaluates only an opaque marker in the definition sandbox, then binds
  // that marker back to the direct AST expression extracted from the same
  // functions.mjs bytes. Handler source never crosses the definition
  // evaluator and an indirect or forged marker fails closed.
  const resolveJsHandler = (def, name) => {
    if (typeof def.js?.generatedSource === 'string') {
      return {
        source: def.js.generatedSource,
        exportName: def.js.exportName ?? name,
        handlerForm: 'module',
        sourceSpan: null,
        typescriptIdentity: null,
        elevatedDbUses: captureElevatedDbUseSites(def.js.generatedSource, {
          path: '<generated-authority-profile>',
          exportName: def.js.exportName ?? name,
        }),
      };
    }
    if (def.js?.inlineHandler !== undefined) {
      const extracted = inlineExtraction.handlers.get(name);
      const marker = def.js.inlineHandler?.__snapbackInlineHandlerMarker;
      if (!extracted || marker !== extracted.token) {
        err(
          'SNAPBACK_INLINE_HANDLER_MARKER_INVALID',
          'function',
          `${name}: inline handler marker does not match its direct source expression`,
          { function: name },
        );
        return null;
      }
      // @ref LLP 0237#d2-closed-graph-and-frozen-bounds — Rollout 2 renders
      // the unchanged same-file closure through its explicit graph record;
      // the parity corpus freezes the prior byte stream before imports exist.
      // The capability rescan runs over the complete spliced bytes — the
      // handler registration plus every reachable helper — so an ambient
      // dependency inside a shared helper refuses exactly like inline code,
      // with the refusal mapped back to the helper's authored span.
      const canonicalRendered = renderInlineOperation(name, extracted);
      const customAuthorization = def.customAuthorization;
      const extractedEvaluator = inlineExtraction.authorizationEvaluators?.get(name);
      let renderedCustomAuthorization = null;
      if (customAuthorization !== undefined) {
        const marker = customAuthorization.evaluator
          ?.__snapbackInlineAuthorizationEvaluatorMarker;
        if (!extractedEvaluator || marker !== extractedEvaluator.token) {
          err(
            'SNAPBACK_CUSTOM_AUTHORIZATION_EVALUATOR_MARKER_INVALID',
            'auth',
            `${name}: custom authorization evaluator marker does not match its direct source expression`,
            { function: name },
          );
        } else {
          renderedCustomAuthorization = renderInlineCustomAuthorizationModule(
            name,
            extracted,
            extractedEvaluator,
          );
        }
      }
      const capabilityRendered = renderedCustomAuthorization ?? canonicalRendered;
      for (const issue of scanUnsupportedHandlerSource(capabilityRendered.source, 'functions.mjs')) {
        const segment = capabilityRendered.segments.findLast(
          (candidate) => issue.line >= candidate.startLine,
        ) ?? capabilityRendered.segments[0];
        err(issue.code, 'bundle', `${name}: ${issue.message}`, {
          function: name,
          source: segment.sourceSpan.file,
          token: issue.token,
          ...(segment.kind === 'helper' ? { helper: segment.name } : {}),
          ...(segment.kind === 'authorization-evaluator'
            ? { customAuthorizationEvaluator: true }
            : {}),
          sourceSpan: {
            file: segment.sourceSpan.file,
            line: segment.sourceSpan.line + issue.line - segment.startLine,
            column: issue.line === segment.startLine
              ? segment.sourceSpan.column + issue.column
                - (segment.renderedStartColumn ?? 1)
              : issue.column,
          },
        });
      }
      // @ref LLP 0253#s44-handler-contexts —
      // generated facades wrap the already-admitted inline graph; authored
      // handler bytes remain the capability-scan subject.
      const rendered = def.familiarContext
        ? renderFamiliarHandlerRuntime(
            name,
            extracted,
            capabilityRendered,
            def.familiarContext,
            familiarBootstrap.apiDigest,
          )
        : capabilityRendered;
      return {
        source: rendered.source,
        // The write census consumes the canonical splice-rendered closure,
        // not a Familiar or membership runtime wrapper around it. Its
        // segments retain authored positions for the handler and each
        // reachable same-file helper.
        writePolicyAnalysisSource: canonicalRendered.source,
        writePolicySourceSegments: canonicalRendered.segments,
        analysisSource: extracted.expressionSource,
        analysisDirect: true,
        analysisSourceSpan: extracted.sourceSpan,
        exportName: name,
        handlerForm: 'inline',
        inlineAst: extracted.ast,
        plainJoinCandidate: extracted.plainJoinCandidate,
        inlineHelpers: (extracted.helpers ?? []).map(
          ({ name: helperName, contentHash }) => ({ name: helperName, contentHash }),
        ),
        elevatedDbUses: extracted.elevatedDbUses ?? [],
        customAuthorizationEvaluator: extractedEvaluator
          ? {
              token: extractedEvaluator.token,
              sourceSpan: extractedEvaluator.sourceSpan,
              elevatedDbUses: extractedEvaluator.elevatedDbUses ?? [],
            }
          : null,
        sourceSpan: extracted.sourceSpan,
      };
    }
    const loaded = loadHandlerSource(def.js?.source, name);
    const exportName = def.js?.exportName ?? name;
    const capturedElevatedDbUses = loaded
      ? captureElevatedDbUseSites(loaded.authoredSource, {
          path: loaded.identity,
          exportName,
        })
      : [];
    const elevatedDbCapabilities = def.js?.elevatedReads ?? [];
    for (const use of capturedElevatedDbUses) {
      const declared = elevatedDbCapabilities.find(({ form, tables: ceiling }) => (
        form === use.member
        && (ceiling === 'opaque' || use.table === null || ceiling.includes(use.table))
      ));
      if (!declared) {
        err(
          'SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED',
          'auth',
          `${name}: module handler uses ctx.db.elevated.${use.member} outside its declared host-call capability`,
          { function: name, readForm: use.member, table: use.table, sourceSpan: use.source },
        );
      }
    }
    return {
      source: loaded?.source ?? '',
      analysisSource: loaded?.source ?? '',
      analysisDirect: false,
      analysisSourceSpan: loaded
        ? { file: loaded.identity, line: 1, column: 1 }
        : null,
      analysisSourcePosition: loaded?.sourceMap
        ? (line, column) => {
            const mapped = mapGeneratedTypeScriptPosition(loaded.sourceMap, line, column);
            return mapped
              ? { file: loaded.identity, line: mapped.line, column: mapped.column }
              : null;
          }
        : null,
      exportName,
      handlerForm: 'module',
      sourceSpan: null,
      typescriptIdentity: loaded?.typescriptIdentity ?? null,
      elevatedDbUses: capturedElevatedDbUses,
      elevatedDbCapabilities,
    };
  };

  const resolveAdmittedJsHandler = (def, name) => {
    const resolved = resolveJsHandler(def, name);
    if (!resolved) return null;
    const admission = compileHandlerMembershipAdmission(def, name);
    const wrapped = wrapHandlerWithMembershipAdmission(
      resolved.source,
      resolved.exportName ?? name,
      def.__kind,
      admission,
    );
    return {
      ...resolved,
      ...wrapped,
      membershipReads: [...new Set(admission.map(({ table }) => table))],
    };
  };

  const compileCustomAuthorization = (def, name, resolvedHandler) => {
    const declaration = def.customAuthorization;
    if (declaration === undefined) return null;
    // @ref LLP 0240#d4-custom-function-mediated-authority-has-an-honest-declaration
    // — keep the precise lane closed at the compiler boundary as well as the
    // public factory so a future alternate caller cannot bypass the refusal.
    if (declaration.sync === 'reauthorize-on-change') {
      err(
        'SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE',
        'auth',
        `${name}: custom authorization sync "reauthorize-on-change" is unavailable: LLP 0146 enforceable strict input completeness is not yet present`,
        {
          function: name,
          requestedSync: declaration.sync,
          prerequisite: 'LLP 0146 enforceable strict input completeness',
        },
      );
    }
    if (targetProfile !== TARGET_PROFILE_LOCAL) {
      err(
        'SNAPBACK_CUSTOM_AUTHORIZATION_COARSE_WAKE_UNAVAILABLE',
        'auth',
        `${name}: target ${targetProfile} cannot conservatively wake the declared coarse-global custom authorization universe`,
        {
          function: name,
          targetProfile,
          supportedTarget: TARGET_PROFILE_LOCAL,
          coarseGlobalWakeUniverse: declaration.coarseGlobalWakeUniverse,
        },
      );
    }
    const inputTables = [...new Set(declaration.inputs.map(({ table }) => table))].sort();
    for (const table of inputTables) {
      if (!tables[table]) {
        err(
          'SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_TABLE_UNKNOWN',
          'auth',
          `${name}: custom authorization input references unknown table ${table}`,
          { function: name, table },
        );
      }
    }
    const evaluator = resolvedHandler?.customAuthorizationEvaluator;
    const elevatedUses = evaluator?.elevatedDbUses ?? [];
    for (const use of elevatedUses) {
      if (use.table === null || !inputTables.includes(use.table)) {
        err(
          'SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_SITE_UNPROVEN',
          'auth',
          `${name}: custom evaluator elevated ${use.member} site must name one literal declared policy input table`,
          {
            function: name,
            readForm: use.member,
            table: use.table,
            sourceSpan: use.source,
            declaredInputTables: inputTables,
          },
        );
      }
    }
    for (const table of inputTables) {
      if (!elevatedUses.some((use) => use.table === table)) {
        err(
          'SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_SITE_UNPROVEN',
          'auth',
          `${name}: custom authorization input ${table} has no direct elevated evaluator read site`,
          { function: name, table, declaredInputTables: inputTables },
        );
      }
    }
    warn(
      'SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_COMPLETENESS_UNPROVEN',
      'auth',
      `${name}: coarse-global custom authorization is online-only; declared policy inputs are review facts, not a completeness proof, so every relevant app/auth change reauthorizes`,
      {
        function: name,
        details: {
          inputCompleteness: 'unproven',
          sync: declaration.sync,
          offline: declaration.offline,
          pushdown: 'none',
          retention: 'none',
          preciseInvalidation: false,
          coarseGlobalWakeUniverse: declaration.coarseGlobalWakeUniverse,
          inputs: declaration.inputs,
        },
      },
    );
    return {
      offline: declaration.offline,
      sync: declaration.sync,
      inputs: declaration.inputs.map(({ kind, table, subject, key }) => ({
        kind,
        table,
        subject,
        key: [...key],
      })),
      inputCompleteness: declaration.inputCompleteness,
      pushdown: declaration.pushdown,
      retention: declaration.retention,
      preciseInvalidation: declaration.preciseInvalidation,
      coarseGlobalWakeUniverse: [...declaration.coarseGlobalWakeUniverse],
      evaluatorIdentity: `sha256:${evaluator?.token ?? 'invalid'}`,
    };
  };

  const fieldNames = (t) => new Set(tables[t]?.fields.map((f) => f.name) ?? []);
  const isKnownField = (t, f) => SYSTEM_FIELDS.includes(f) || fieldNames(t).has(f);
  const validateIdReferences = (validator, where, details) => {
    const target = idFieldTypeTable(validator?.fieldType);
    if (target !== null && !tables[target]) {
      err('FUNCTION_ID_TARGET_UNKNOWN', 'function', `${where} references unknown id table ${target}`, {
        ...details,
        targetTable: target,
      });
    }
    if (validator?.primitive === 'object') {
      for (const [field, nested] of Object.entries(validator.fields ?? {})) {
        validateIdReferences(nested, `${where}.${field}`, { ...details, field });
      }
    }
    if (validator?.resultKind === 'array' && validator.element?.__validator) {
      validateIdReferences(validator.element, `${where}[]`, details);
    }
    if (validator?.resultKind === 'union' && Array.isArray(validator.variants)) {
      for (const [index, variant] of validator.variants.entries()) {
        validateIdReferences(variant, `${where}|${index}`, details);
      }
    }
  };

  const generatedOperationBindings = new Map();

  for (const [name, def] of Object.entries(functionsModule)) {
    if (isIsolatedDefinition(def, 'cron')) {
      cronDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'config')) {
      configDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'maintained-projection')) {
      projectionDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'asset-upload')) {
      assetUploadDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'command')) {
      commandDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'surface')) {
      surfaceDefs.push({ exportName: name, def });
      continue;
    }
    if (!isIsolatedDefinition(def, 'function')) continue;
    // Function export names flow unescaped into emitted declarations
    // (`export function ${name}(`), pascal-cased type names, unquoted
    // interface members, and contract module file paths (`${name}.query.ts`);
    // ES2022 `export { f as "any string" }` makes arbitrary export names
    // reachable, and `export { f as delete }` makes reserved words reachable.
    // Fail closed like the table/field/ephemeral/cron namespaces.
    if (!isOperationName(name)
      || name.split('.').some((segment) => RESERVED_WORDS.has(segment))) {
      err('FUNCTION_INVALID_IDENTIFIER', 'function', `invalid function export name ${name}`, { function: name });
      continue;
    }
    // @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1
    // — dotted names need safe generated locals; their pascal projection is
    // therefore a closed namespace rather than a best-effort spelling.
    const generatedBinding = pascal(name);
    const bindingPrior = generatedOperationBindings.get(generatedBinding);
    if (bindingPrior !== undefined && bindingPrior !== name) {
      err(
        'SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION',
        'function',
        `operation names ${JSON.stringify(bindingPrior)} and ${JSON.stringify(name)} both generate local binding ${generatedBinding}`,
        { functions: [bindingPrior, name], generatedBinding },
      );
      continue;
    }
    generatedOperationBindings.set(generatedBinding, name);
    for (const [argName, argVal] of Object.entries(def.args)) {
      // Arg names and nested v.object field names become unquoted TS property
      // names in api.d.ts, runtime-links.ts, and the per-binding Args types.
      if (!IDENT.test(argName)) {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: invalid arg identifier ${argName}`, { function: name, arg: argName });
        continue;
      }
      validateAuthoringValidator(argVal, `${name} arg ${argName}`, (message) => {
        err('FUNCTION_INVALID_VALIDATOR', 'function', message, { function: name, arg: argName });
      }, new Set(), 'argument');
      validateIdReferences(argVal, `${name} arg ${argName}`, { function: name, arg: argName });
      checkObjectValidatorFieldIdents(argVal, `arg ${argName}`, (fieldName, where) => {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: ${where} has invalid field identifier ${fieldName}`, { function: name, arg: argName, field: fieldName });
      });
    }
    if (def.result) {
      validateAuthoringValidator(def.result, `${name} result`, (message) => {
        err('FUNCTION_INVALID_VALIDATOR', 'function', message, { function: name });
      });
      checkObjectValidatorFieldIdents(def.result, 'result', (fieldName, where) => {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: ${where} has invalid field identifier ${fieldName}`, { function: name, field: fieldName });
      });
      validateIdReferences(def.result, `${name} result`, { function: name });
    }
    if (GENERATED_API_RESERVED_EXPORTS.has(name)) {
      err('FUNCTION_RESERVED_EXPORT', 'function', `${name}: function export collides with a generated API namespace`, { function: name });
      continue;
    }
    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.plan && !def.js) {
      const tableVisibility = tables[def.plan.table]?.visibility;
      def.plan.tableVisibility = declaredRestrictedTableVisibility(tables, def.plan.table);

      // @ref LLP 0065#3-common-pattern-contracts — an owner predicate needs
      // an owner-leading selected index to preserve the declared access path.
      // This remains advisory for ordinary queries: enforcement is unchanged,
      // but the injected predicate may degrade the selected index to a scan.
      if (def.plan.index && tableVisibility) {
        const selectedIndex = tables[def.plan.table]?.indexes.find(
          (candidate) => candidate.name === def.plan.index,
        );
        for (const ownerVisibility of tableVisibilityOwnerLeaves(tableVisibility)) {
          if (!selectedIndex || selectedIndex.fields[0] === ownerVisibility.field) continue;
          const authoredSpan = functionDefinitionSourceSpans[name];
          const precondition = {
            function: name,
            table: def.plan.table,
            index: def.plan.index,
            ownerField: ownerVisibility.field,
          };
          diagnostics.push({
            code: 'SNAPBACK_TABLE_VISIBILITY_INDEX_PREFIX_MISMATCH',
            severity: 'warning',
            subsystem: 'auth',
            message: `${name}: injected owner visibility on ${def.plan.table}.${ownerVisibility.field} is not the leading field of selected index ${def.plan.table}.${def.plan.index}; the policy remains enforced, but this access path may degrade to a scan. Choose or add an index beginning with ${ownerVisibility.field}.`,
            function: name,
            table: def.plan.table,
            ...(authoredSpan
              ? {
                  sourceSpan: {
                    file: authoredSpan.path,
                    line: authoredSpan.line,
                    column: authoredSpan.column,
                  },
                }
              : {}),
            details: {
              function: name,
              table: def.plan.table,
              policy: structuredClone(tableVisibility),
              ownerField: ownerVisibility.field,
              selectedIndex: def.plan.index,
              selectedIndexFields: selectedIndex?.fields ?? null,
              remediations: [
                {
                  kind: 'chooseOwnerLeadingQueryIndex',
                  edit: `index: '<index beginning with ${ownerVisibility.field}>'`,
                  riskClass: 'performance',
                  machineApplicable: false,
                  requiresApproval: true,
                  authorityEffect: 'none',
                  precondition,
                  description: `Select a declared ${def.plan.table} index whose leading field is ${ownerVisibility.field}.`,
                },
                {
                  kind: 'addOwnerLeadingIndex',
                  edit: `.index('<name>', ['${ownerVisibility.field}', ...])`,
                  riskClass: 'schema',
                  machineApplicable: false,
                  requiresApproval: true,
                  authorityEffect: 'none',
                  precondition,
                  description: `Add an owner-leading ${def.plan.table} index, then select it for ${name}.`,
                },
              ],
            },
          });
        }
      }
    }

    // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
    // — every closed multi-table carrier is stamped from the same normalized
    // schema authority as an ordinary QueryPlan. Surface-local visibility is
    // retained independently and the runtime intersects both predicates.
    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.relationalPlan) {
      stampRelationalTableVisibility(def.relationalPlan, tables);
    }
    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.boundedChildrenPlan) {
      stampBoundedChildrenTableVisibility(def.boundedChildrenPlan, tables);
    }
    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.snapshotBatchPlan) {
      const v2 = def.snapshotBatchPlan.profile === 'snapshot-batch.v2';
      for (const rawNode of def.snapshotBatchPlan.nodes) {
        const classId = v2 ? rawNode.classId : 'bounded_children_v1';
        const node = v2 ? rawNode.plan : rawNode;
        if (classId === 'relational_query_v1') {
          stampRelationalTableVisibility(node, tables);
        } else if (classId === 'bounded_children_v1') {
          stampBoundedChildrenTableVisibility(node, tables);
        }
      }
    }

    const uncomposedVisibilityReads = [];
    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.snapshotBatchPlan) {
      const v2 = def.snapshotBatchPlan.profile === 'snapshot-batch.v2';
      for (const [index, rawNode] of def.snapshotBatchPlan.nodes.entries()) {
        const classId = v2 ? rawNode.classId : 'bounded_children_v1';
        const node = v2 ? rawNode.plan : rawNode;
        if (classId !== 'relational_query_v1' && classId !== 'bounded_children_v1') {
          for (const table of [
            node?.table,
            node?.root,
            node?.joined,
            node?.parentTable,
            node?.childTable,
          ]) {
            if (typeof table === 'string') {
              uncomposedVisibilityReads.push({
                surface: `snapshotBatchPlan.nodes[${index}].${String(classId)}`,
                table,
              });
            }
          }
        }
      }
    }
    const warnedUncomposedVisibilityReads = new Set();
    for (const { surface, table } of uncomposedVisibilityReads) {
      const tableVisibility = tables[table]?.visibility;
      if (!tableVisibility || tableVisibility.kind === 'public-read') continue;
      const identity = `${surface}\0${table}`;
      if (warnedUncomposedVisibilityReads.has(identity)) continue;
      warnedUncomposedVisibilityReads.add(identity);
      const authoredSpan = functionDefinitionSourceSpans[name];
      const precondition = {
        function: name,
        surface,
        table,
        declaredPolicy: structuredClone(tableVisibility),
      };
      // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
      // — all shipped classes compose above. An unknown future class that
      // reaches a restricted table is a codegen refusal, never a warning.
      diagnostics.push({
        code: 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE',
        severity: 'error',
        subsystem: 'auth',
        message: `${name}: cannot generate ${surface} because it reads restricted table ${table} with declared policy ${JSON.stringify(tableVisibility)}, but this read-surface class has no closed table-visibility composition. Add fail-closed composition before using this class.`,
        function: name,
        table,
        ...(authoredSpan
          ? {
              sourceSpan: {
                file: authoredSpan.path,
                line: authoredSpan.line,
                column: authoredSpan.column,
              },
            }
          : {}),
        details: {
          function: name,
          surface,
          table,
          declaredPolicy: structuredClone(tableVisibility),
          analysisLimit: 'the read-surface class is unknown to the closed table-visibility composer',
          remediations: [
            {
              kind: 'implementClosedTableVisibilityComposition',
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'narrows',
              precondition,
              description: `Teach ${surface}'s closed plan carrier, runtime, invalidation matcher, and acceptance tests to compose ${table}'s declared policy.`,
            },
          ],
        },
      });
    }
    validateFunctionAuthDefinition(name, def, err);
    const authScopeField = def.authScopeField ?? def.js?.authScopeField ?? null;
    if (authScopeField !== null) {
      const pairedCallerPredicate = (def.plan?.filters ?? []).some((filter) => (
        filter.field === authScopeField
        && filter.op === 'Eq'
        && filter.value?.kind === 'AuthUserId'
      ));
      if (!pairedCallerPredicate) {
        const authoredSpan = functionDefinitionSourceSpans[name];
        const handlerBacked = def.js !== undefined;
        // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
        // — authScopeField is invalidation/retention metadata. Only an
        // executable caller-identity predicate is authorization evidence.
        diagnostics.push({
          code: 'SNAPBACK_AUTH_SCOPE_FIELD_WITHOUT_CALLER_PREDICATE',
          severity: 'warning',
          subsystem: 'auth',
          message: `${name}: authScopeField ${authScopeField} narrows invalidation/retention bookkeeping but does not authorize reads; add a filter equating ${authScopeField} to authUserId()${handlerBacked ? ' (handler-backed queries have no declarative filter for codegen to prove)' : ''}.`,
          function: name,
          ...(authoredSpan
            ? {
                sourceSpan: {
                  file: authoredSpan.path,
                  line: authoredSpan.line,
                  column: authoredSpan.column,
                },
              }
            : {}),
          details: {
            function: name,
            authScopeField,
            ...(handlerBacked
              ? { analysisLimit: 'handler-backed authorization predicates are opaque to declarative plan analysis' }
              : {}),
            remediations: [
              {
                kind: 'pairAuthScopeFieldWithCallerPredicate',
                edit: `filter: eq('${authScopeField}', authUserId())`,
                riskClass: 'policy',
                machineApplicable: false,
                requiresApproval: true,
                authorityEffect: 'narrows',
                precondition: { function: name, authScopeField },
                description: `Add an executable ${authScopeField} == authUserId() predicate; do not rely on authScopeField as authorization.`,
              },
            ],
          },
        });
      }
    }
    // @ref LLP 0178#v4--function-auth-omission — omission remains valid only
    // through the sessions compatibility phase, so report it as an advisory
    // rather than an unsuppressible validation error.
    // @ref LLP 0186#w3--errors-as-the-primary-docs-channel-sequencing-ask — name the
    // explicit-auth rule and carry every valid repair instead of silently
    // widening the authored operation to optional-user.
    if (authMode === 'sessions' && def.auth === undefined) {
      const authoredSpan = functionDefinitionSourceSpans[name];
      const precondition = {
        function: name,
        authMode: 'sessions',
        authoredRequirement: 'omitted',
        effectiveLegacyRequirement: 'optional-user',
      };
      diagnostics.push({
        code: 'SNAPBACK_AUTH_REQUIREMENT_IMPLICIT',
        severity: 'warning',
        subsystem: 'auth',
        message: `${name}: sessions-mode functions must explicitly set auth; omission currently uses the legacy optional-user requirement. Add auth: 'public', auth: 'optional-user', or auth: 'authenticated' (guide/auth/sessions-and-principals.md#choose-each-functions-auth-requirement).`,
        function: name,
        ...(authoredSpan
          ? {
              sourceSpan: {
                file: authoredSpan.path,
                line: authoredSpan.line,
                column: authoredSpan.column,
              },
            }
          : {}),
        details: {
          function: name,
          authMode: 'sessions',
          effectiveLegacyRequirement: 'optional-user',
          allowed: ['public', 'optional-user', 'authenticated'],
          guideAnchor: 'guide/auth/sessions-and-principals.md#choose-each-functions-auth-requirement',
          remediations: [
            {
              kind: 'setFunctionAuthRequirement',
              requirement: 'public',
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'changes-declared-requirement',
              precondition,
              description: `Add auth: 'public' to ${name} when anonymous invocation is intentional without declaring optional-user behavior.`,
            },
            {
              kind: 'setFunctionAuthRequirement',
              requirement: 'optional-user',
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'none',
              precondition,
              description: `Add auth: 'optional-user' to ${name} when anonymous and user-bearing invocation are both intentional.`,
            },
            {
              kind: 'setFunctionAuthRequirement',
              requirement: 'authenticated',
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'narrows',
              precondition,
              description: `Add auth: 'authenticated' to ${name} when invocation must require a resolved user.`,
            },
            // @ref LLP 0178#2-diagnostic-shape — policy-choice diagnostics
            // may route to the governing guide, but never guess one patch.
            {
              kind: 'guidePointer',
              pageId: 'auth.sessions-and-principals',
              path: 'guide/auth/sessions-and-principals.md',
              anchor: 'choose-each-functions-auth-requirement',
              reason: 'Choose the explicit function auth requirement that matches the intended caller policy.',
              riskClass: 'policy',
              machineApplicable: false,
              requiresApproval: true,
              authorityEffect: 'none',
              precondition,
              description: 'Read the sessions and principals guide before choosing the function auth requirement.',
            },
          ],
        },
      });
    }
    validateFunctionRefusalTrackingDefinition(name, def, err);
    validateProtectedAndRetainabilityDefinition(name, def, err);
    const argNames = new Set(Object.keys(def.args));
    const optionalArgNames = new Set(
      Object.entries(def.args)
        .filter(([, validator]) => validator?.optional === true)
        .map(([argName]) => argName),
    );
    const optionalArgContradictionSites = new Set();

    // @ref LLP 0178#v1--optional-plan-argument-contradiction — a strict Arg
    // node cannot consume a caller-optional argument: the shared runtime
    // evaluator refuses an omitted key with SNAPBACK_ARG_MISSING. Keep the
    // three valid repairs as human policy choices; codegen must not guess one.
    const reportOptionalArgContradiction = (argument, planSite) => {
      if (!optionalArgNames.has(argument)) return;
      const siteKey = `${argument}\0${planSite}`;
      if (optionalArgContradictionSites.has(siteKey)) return;
      optionalArgContradictionSites.add(siteKey);
      const precondition = { function: name, argument, planSite };
      err(
        'SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION',
        'codegen',
        `${name}: optional argument "${argument}" is consumed by presence-requiring plan site "${planSite}" via arg("${argument}")`,
        {
          function: name,
          argument,
          planSite,
          details: {
            argument,
            validator: 'optional',
            planUse: 'required',
            planSite,
            expressionKind: 'Arg',
            runtimeRefusal: 'SNAPBACK_ARG_MISSING',
            remediations: [
              {
                kind: 'makeArgumentRequired',
                riskClass: 'policy',
                machineApplicable: false,
                requiresApproval: true,
                authorityEffect: 'none',
                precondition,
                description: `Make ${argument} required so every caller must supply it.`,
              },
              {
                kind: 'splitOperation',
                riskClass: 'policy',
                machineApplicable: false,
                requiresApproval: true,
                authorityEffect: 'none',
                precondition,
                description: `Split ${name} into a required-argument operation and an omission-safe operation.`,
              },
              {
                kind: 'consumeViaArgOpt',
                riskClass: 'policy',
                machineApplicable: false,
                requiresApproval: true,
                authorityEffect: 'none',
                precondition,
                description: `Consume ${argument} with argOpt("${argument}") — an omitted property evaluates to null (wrap with coalesce(argOpt(...), lit(default)) for a default); a null write requires the target field to be declared optional.`,
              },
              // @ref LLP 0178#2-diagnostic-shape — policy-choice diagnostics
              // may route to the governing guide, but never guess one patch.
              {
                kind: 'guidePointer',
                pageId: 'backend.mutations',
                path: 'guide/backend/mutations.md',
                anchor: 'define-the-write-boundary',
                reason: 'Choose whether callers must supply the argument or the plan must consume its omission branch.',
                riskClass: 'policy',
                machineApplicable: false,
                requiresApproval: true,
                authorityEffect: 'none',
                precondition,
                description: 'Read the mutation guide before choosing the required-argument or omission-safe policy.',
              },
            ],
          },
        },
      );
    };

    // Recursive fail-closed validation of the closed v1 expression profile
    // (LLP 0051 D2): undeclared args, non-expressions, and functions outside
    // the pinned library are authoring errors, never silent passthrough.
    // `If` is the profile's one lazy expression: its condition is always
    // evaluated, but only one branch is. An Arg in one branch therefore does
    // not prove presence is required; an Arg in both branches does. Every
    // other composite expression evaluates all children eagerly today.
    const presenceRequiredArgs = (expr) => {
      if (!expr || !expr.__expr) return new Set();
      if ('Arg' in expr) return new Set([expr.Arg]);
      if ('Field' in expr) return presenceRequiredArgs(expr.Field.base);
      if ('Binary' in expr) {
        return new Set([
          ...presenceRequiredArgs(expr.Binary.left),
          ...presenceRequiredArgs(expr.Binary.right),
        ]);
      }
      if ('Unary' in expr) return presenceRequiredArgs(expr.Unary.expr);
      if ('If' in expr) {
        const required = presenceRequiredArgs(expr.If.cond);
        const thenRequired = presenceRequiredArgs(expr.If.then);
        const elseRequired = presenceRequiredArgs(expr.If.else);
        for (const argument of thenRequired) {
          if (elseRequired.has(argument)) required.add(argument);
        }
        return required;
      }
      if ('Concat' in expr) {
        return new Set(expr.Concat.flatMap((part) => [...presenceRequiredArgs(part)]));
      }
      if ('Call' in expr) {
        return new Set(expr.Call.args.flatMap((argument) => [...presenceRequiredArgs(argument)]));
      }
      if ('Record' in expr) {
        return new Set(
          Object.values(expr.Record.fields).flatMap((fieldExpr) => [...presenceRequiredArgs(fieldExpr)]),
        );
      }
      return new Set();
    };

    const checkExpr = (expr, where, root = true) => {
      if (!expr || !expr.__expr) {
        err('FUNCTION_INVALID_EXPR', 'function', `${name}: ${where} is not a value expression`, { function: name });
        return;
      }
      if ('Arg' in expr && !argNames.has(expr.Arg)) {
        err('FUNCTION_UNKNOWN_ARG', 'function', `${name}: ${where} references undeclared arg "${expr.Arg}"`, { function: name });
      }
      if ('Field' in expr) {
        // argOpt() lowers to Field over the Args root; check declared args at
        // the first hop so optional-arg typos still fail closed.
        if (expr.Field.base?.kind === 'Args' && !argNames.has(expr.Field.key)) {
          err('FUNCTION_UNKNOWN_ARG', 'function', `${name}: ${where} references undeclared arg "${expr.Field.key}"`, { function: name });
        }
        checkExpr(expr.Field.base, where, false);
      }
      if ('Binary' in expr) {
        checkExpr(expr.Binary.left, where, false);
        checkExpr(expr.Binary.right, where, false);
      }
      if ('Unary' in expr) checkExpr(expr.Unary.expr, where, false);
      if ('If' in expr) {
        checkExpr(expr.If.cond, where, false);
        checkExpr(expr.If.then, where, false);
        checkExpr(expr.If.else, where, false);
      }
      if ('Concat' in expr) for (const part of expr.Concat) checkExpr(part, where, false);
      if ('Call' in expr) {
        if (!PINNED_FUNCTIONS.includes(expr.Call.func)) {
          err('MUTATION_UNSUPPORTED_FUNCTION', 'function', `${name}: ${where} calls ${expr.Call.func}, which is not in the pinned v1 library`, { function: name, calledFunction: expr.Call.func });
        }
        for (const argExpr of expr.Call.args) checkExpr(argExpr, where, false);
      }
      if ('Record' in expr) {
        for (const fieldExpr of Object.values(expr.Record.fields)) checkExpr(fieldExpr, where, false);
      }
      if (root) {
        for (const argument of presenceRequiredArgs(expr)) {
          reportOptionalArgContradiction(argument, where);
        }
      }
    };

    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.searchPlan) {
      const plan = def.searchPlan;
      const table = tables[plan.table];
      let searchIndex = null;
      if (!table) {
        err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: search query references unknown table ${plan.table}`, { function: name, table: plan.table });
      } else {
        searchIndex = (table.searchIndexes ?? []).find((candidate) => candidate.name === plan.index) ?? null;
        if (!searchIndex) {
          err('SNAPBACK_SEARCH_INDEX_UNAVAILABLE', 'search', `${name}: search query references unknown search index ${plan.table}.${plan.index}`, { function: name, table: plan.table, index: plan.index });
        }
      }
      if (def.__kind === 'LiveQuery' && searchIndex) {
        const publicRead = searchIndex.visibility?.kind === 'public-read';
        if ((def.authorityIndependent === true) !== publicRead) {
          err(
            'FUNCTION_AUTHORITY_INDEPENDENT_INVALID',
            'auth',
            `${name}: live-search authorityIndependent must exactly match public-read visibility`,
            { function: name, table: plan.table, index: plan.index },
          );
        }
        if (def.publicInline === true) {
          err(
            'FUNCTION_PUBLIC_INLINE_INVALID',
            'auth',
            `${name}: search-plan functions cannot declare publicInline`,
            { function: name },
          );
        }
        if (searchIndex.visibility?.kind === 'membership') {
          err(
            'SNAPBACK_SEARCH_QUERY_PLAN_INVALID',
            'search',
            `${name}: live search does not admit membership visibility in v1`,
            { function: name, table: plan.table, index: plan.index },
          );
        }
      }
      const membershipVisibility = searchIndex?.visibility?.kind === 'membership';
      let membershipDeclaration = null;
      if (membershipVisibility) {
        if (typeof plan.resourceArg !== 'string' || plan.resourceArg.length === 0) {
          err(
            'SNAPBACK_SEARCH_QUERY_PLAN_INVALID',
            'search',
            `${name}: membership search requires resourceArg for its singular membership partition`,
            { function: name, table: plan.table, index: plan.index },
          );
        } else {
          const resourceArg = def.args?.[plan.resourceArg];
          const resourceField = table?.fields.find(
            (field) => field.name === searchIndex.visibility.resourceField,
          );
          const fieldIdTable = idFieldTypeTable(resourceField?.field_type);
          const argIdTable = idFieldTypeTable(resourceArg?.fieldType);
          const equalityCompatible = resourceField !== undefined
            && resourceField.optional !== true
            && resourceArg?.optional === false
            && (
              (resourceField.field_type === 'String' && resourceArg.fieldType === 'String')
              || (resourceField.field_type?.Enum && resourceArg.fieldType?.Enum
                && JSON.stringify(resourceField.field_type.Enum.values)
                  === JSON.stringify(resourceArg.fieldType.Enum.values))
              || (resourceField.field_type === 'Principal' && resourceArg.fieldType === 'Principal')
              || (fieldIdTable !== null && argIdTable === fieldIdTable)
            );
          if (!equalityCompatible) {
            err(
              'SNAPBACK_SEARCH_QUERY_PLAN_INVALID',
              'search',
              `${name}: resourceArg ${plan.resourceArg} must name a required equality-compatible scalar argument matching ${plan.table}.${searchIndex.visibility.resourceField}`,
              {
                function: name,
                resourceArg: plan.resourceArg,
                resourceField: searchIndex.visibility.resourceField,
              },
            );
          }
        }

        membershipDeclaration = membershipDeclarations.get(searchIndex.visibility.declaration) ?? null;
        if (!membershipDeclaration) {
          err(
            'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
            'search',
            `${name}: membership search index ${plan.table}.${plan.index} names unknown declaration ${searchIndex.visibility.declaration}`,
            { function: name, declaration: searchIndex.visibility.declaration },
          );
        } else if (membershipDeclaration.membership.scope !== 'resource') {
          err(
            'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
            'search',
            `${name}: membership search declaration ${searchIndex.visibility.declaration} must be resource-scoped`,
            { function: name, declaration: searchIndex.visibility.declaration },
          );
        }
        if (searchIndex.visibility.roles !== undefined) {
          const roles = searchIndex.visibility.roles;
          if (!Array.isArray(roles) || roles.length === 0 || new Set(roles).size !== roles.length) {
            err(
              'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
              'search',
              `${name}: membership search roles must be a non-empty array of unique strings`,
              { function: name, declaration: searchIndex.visibility.declaration },
            );
          } else if (membershipDeclaration) {
            const vocabulary = new Set([
              ...membershipDeclaration.membership.roles,
              ...(membershipDeclaration.membership.pendingRoles ?? []),
            ]);
            for (const role of roles) {
              if (typeof role !== 'string' || role.length === 0 || !vocabulary.has(role)) {
                err(
                  'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
                  'search',
                  `${name}: membership search role ${String(role)} is outside declaration ${searchIndex.visibility.declaration}'s vocabulary`,
                  { function: name, declaration: searchIndex.visibility.declaration, role },
                );
              }
            }
          }
        }
      } else if (plan.resourceArg !== undefined) {
        err(
          'SNAPBACK_SEARCH_QUERY_PLAN_INVALID',
          'search',
          `${name}: search plan resourceArg is permitted only for membership visibility`,
          { function: name, table: plan.table, index: plan.index, resourceArg: plan.resourceArg },
        );
      }
      // @ref LLP 0131#the-search-fixture-cv-5 — the request portion of the
      // function's argument contract agrees with the exported schema. LLP
      // 0073's membership resource is exactly one required sibling argument,
      // not a change to that Rust-owned request shape.
      try {
        for (const problem of searchArgsSchemaProblems(def.args ?? {}, {
          ...(plan.resourceArg === undefined ? {} : { resourceArg: plan.resourceArg }),
          ...(def.__kind === 'LiveQuery' ? { includeAfter: false } : {}),
        })) {
          err('SNAPBACK_SEARCH_REQUEST_SCHEMA_MISMATCH', 'search', `${name}: ${problem}`, { function: name });
        }
      } catch (error) {
        err(error.code ?? 'SNAPBACK_SEARCH_REQUEST_SCHEMA_DERIVATION', 'search', `${name}: ${error.message}`, { function: name });
      }
      const searchReads = [plan.table];
      if (membershipDeclaration && !searchReads.includes(membershipDeclaration.table.name)) {
        searchReads.push(membershipDeclaration.table.name);
      }
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { HostPlan: { SearchQuery: plan } },
        declaredReads: searchReads,
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: def.auth === 'authenticated' ? ['userId'] : [],
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: searchReads,
        result: {
          kind: 'list',
          row: validatorRowDescriptor(def.resultContract?.validator) ?? { shape: 'unknown' },
        },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Query' && def.vectorPlan) {
      const plan = def.vectorPlan;
      const runtime = { HostPlan: { VectorQuery: plan } };
      const table = tables[plan.table];
      const vectorIndex = (table?.vectorIndexes ?? []).find((candidate) => candidate.name === plan.index);
      if (!table) {
        err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: vector query references unknown table ${plan.table}`, { function: name, table: plan.table });
      } else if (!vectorIndex) {
        err('SNAPBACK_VECTOR_INDEX_UNAVAILABLE', 'vector', `${name}: vector query references unknown index ${plan.table}.${plan.index}`, { function: name, table: plan.table, index: plan.index });
      }
      if (
        Object.keys(plan).sort().join(',') !== 'distanceProfile,index,requiredCapability,resultProjection,table'
        || plan.distanceProfile !== 'snapback-vector-distance-v1'
        || plan.resultProjection !== 'vector-page-v1'
        || plan.requiredCapability !== 'vector_search_v1'
      ) {
        err('SNAPBACK_VECTOR_QUERY_PLAN_INVALID', 'vector', `${name}: vector plan must carry the exact v1 profile ids`, { function: name });
      }
      functions.push({
        name,
        kind: 'Query',
        ...authoredFunctionManifestFields(def),
        runtime,
        declaredReads: [plan.table],
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: vectorIndex?.visibility?.kind === 'owner' ? ['userId'] : [],
        syncabilityClass: 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: [plan.table],
        // Keep the Contract binding exact even before the common result-
        // contract pass below reassigns this field. In particular, stored
        // fields retain their schema-derived scalar/null shapes and the
        // source vector never degrades to `unknown` or leaks into the row.
        // @ref LLP 0132#query-surface
        result: providerResultDescriptor(effectiveResultContract({
          def,
          functionKind: 'Query',
          runtime,
          tables,
        })),
        serverRunnable: true,
        localRunnable: false,
      
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'LiveQuery' && def.graphQuerySource) {
      // @ref LLP 0209#21-the-normalized-carrier — extraction retains only a
      // placeholder here. The common contract pass below supplies the exact
      // result-contract hash and then replaces it with the normalized,
      // host-reconstructible GraphQuery carrier.
      const source = def.graphQuerySource;
      const reads = new Set();
      const visibilities = [];
      const addTable = (table, visibility) => {
        if (typeof table === 'string') reads.add(table);
        if (visibility) visibilities.push(visibility);
      };
      for (const node of source.nodes) {
        addTable(node.table, node.visibility);
        addTable(node.edge?.table, node.edge?.visibility);
        addTable(node.edge?.targetTable, node.edge?.targetVisibility);
        addTable(node.binding?.table, node.binding?.visibility);
      }
      for (const table of tableVisibilityMembershipReadTables(visibilities, membershipDeclarations)) {
        reads.add(table);
      }
      const readList = [...reads].sort(compareCodeUnits);
      const runtime = { HostPlan: { GraphQuery: null } };
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime,
        declaredReads: readList,
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: source.nodes.some((node) => node.authorityClass !== 1)
          ? ['userId']
          : [],
        syncabilityClass: 'syncable-live',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: readList,
        result: { kind: 'list', row: { shape: 'unknown' } },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.snapshotBatchPlan) {
      const plan = def.snapshotBatchPlan;
      const v2 = plan.profile === 'snapshot-batch.v2';
      const serializedPlan = v2
        ? {
            profile: plan.profile,
            nodes: plan.nodes.map((node) => ({
              classId: node.classId,
              plan: node.classId === 'relational_query_v1'
                ? serializeRelationalPlan(node.plan)
                : node.plan,
            })),
          }
        : plan;
      const serializedNodes = v2 ? serializedPlan.nodes : plan.nodes;
      const visibilityPolicies = serializedNodes.flatMap((node) => {
        const classId = v2 ? node.classId : 'bounded_children_v1';
        const nodePlan = v2 ? node.plan : node;
        return classId === 'relational_query_v1'
          ? [nodePlan.rootTableVisibility, nodePlan.joinedTableVisibility]
          : [nodePlan.parentTableVisibility, nodePlan.childTableVisibility];
      });
      const policyReads = tableVisibilityMembershipReadTables(
        visibilityPolicies,
        membershipDeclarations,
      );
      const reads = [...new Set([...serializedNodes.flatMap((node) => {
        const classId = v2 ? node.classId : 'bounded_children_v1';
        const nodePlan = v2 ? node.plan : node;
        return classId === 'relational_query_v1'
          ? [nodePlan.root, nodePlan.joined]
          : [nodePlan.parentTable, nodePlan.childTable];
      }), ...policyReads])].sort();
      const runtime = v2
        ? { HostPlan: { SnapshotBatchV2: serializedPlan } }
        : { HostPlan: { SnapshotBatch: serializedPlan } };
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime,
        declaredReads: reads,
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: composedVisibilityAuthorizationDependence(
          def.auth === 'authenticated' ? ['userId'] : [],
          visibilityPolicies,
        ),
        syncabilityClass: 'syncable-live',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads,
        result: providerResultDescriptor(effectiveResultContract({
          def,
          functionKind: def.__kind,
          runtime,
          tables,
        })),
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.boundedChildrenPlan) {
      const plan = def.boundedChildrenPlan;
      const visibilityPolicies = [plan.parentTableVisibility, plan.childTableVisibility];
      const reads = [...new Set([
        plan.parentTable,
        plan.childTable,
        ...tableVisibilityMembershipReadTables(visibilityPolicies, membershipDeclarations),
      ])].sort();
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { HostPlan: { BoundedChildrenQuery: plan } },
        declaredReads: reads,
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: composedVisibilityAuthorizationDependence(
          plan.parentVisibility === 'publicRead' ? [] : ['userId'],
          visibilityPolicies,
        ),
        syncabilityClass: 'syncable-live',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads,
        result: {
          kind: 'list',
          row: boundedChildrenRowDescriptor(plan, tables),
          minItems: 1,
          maxItems: 1,
        },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.js) {
      const resolvedHandler = resolveAdmittedJsHandler(def, name);
      const customAuthorization = compileCustomAuthorization(def, name, resolvedHandler);
      const readTables = [...new Set([
        ...(def.js.reads ?? []),
        ...(resolvedHandler?.membershipReads ?? []),
        ...(customAuthorization?.inputs.map(({ table }) => table) ?? []),
      ])];
      for (const table of readTables) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: handler declares unknown read table ${table}`, { function: name, table });
        }
      }
      if (def.js.authScopeField != null) {
        const primaryTable = readTables[0];
        if (!primaryTable || !isKnownField(primaryTable, def.js.authScopeField)) {
          err('FUNCTION_UNKNOWN_FIELD', 'function', `${name}: authScopeField references unknown field ${primaryTable ?? '<missing>'}.${def.js.authScopeField}`, {
            function: name,
            table: primaryTable ?? null,
            field: def.js.authScopeField,
          });
        }
      }
      const handlerSource = resolvedHandler?.source ?? '';
      const handlerExportName = resolvedHandler?.exportName ?? name;
      validateStaticUniqueManyCalls(handlerSource, name, tables, err);
      diagnostics.push(...nPlusOneBatchReadAdvisories({
        source: resolvedHandler?.analysisSource ?? '',
        exportName: handlerExportName,
        direct: resolvedHandler?.analysisDirect === true,
        sourceSpan: resolvedHandler?.analysisSourceSpan,
        sourcePosition: resolvedHandler?.analysisSourcePosition,
        functionName: name,
        tables,
      }));
      if (handlerSource) {
        for (const problem of scanStaticallyInvalidJsQueryResults(
          handlerSource,
          handlerExportName,
        )) {
          err(
            'FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS',
            'function',
            `${name}: JavaScript query handler ${handlerExportName} returns an object literal, but query handlers must return a rows array. Wrap a point read as [row] (or return [] when absent).`,
            {
              function: name,
              handler: handlerExportName,
              source: resolvedHandler?.handlerForm === 'inline' ? 'functions.mjs' : def.js.source,
              line: problem.line,
              column: problem.column,
              sourceSpan: {
                file: def.js.source,
                line: problem.line,
                column: problem.column,
              },
            },
          );
        }
      }
      if (handlerSource && isProtectedQueryDefinition(def)) {
        for (const problem of scanProtectedHandlerReachableSource(
          handlerSource,
          handlerExportName,
        )) {
          err(problem.code, 'auth', `${name}: ${problem.message}`, {
            function: name,
            inputKind: problem.inputKind,
            line: problem.line,
            column: problem.column,
          });
        }
      }
      const plainJoin = provePlainJoinAdvisory({
        candidate: resolvedHandler?.plainJoinCandidate,
        def,
        name,
        tables,
      });
      if (plainJoin) {
        const precondition = {
          function: name,
          handlerToken: inlineExtraction.handlers.get(name)?.token,
          root: plainJoin.root,
          rootIndex: plainJoin.rootIndex,
          joined: plainJoin.joined,
          joinedIndex: plainJoin.joinedIndex,
        };
        diagnostics.push({
          code: 'SNAPBACK_AUTHORING_PLAIN_JOIN_RELATIONAL_QUERY',
          severity: 'warning',
          subsystem: 'codegen',
          message: `${name}: this inline defineJsLiveQuery is provably equivalent to the shipped defineRelationalQuery left-join profile; use the relational declaration so codegen can preserve and explain the bounded join (guide/backend/relational-queries.md#recognize-the-messaging-shape).`,
          function: name,
          sourceSpan: resolvedHandler.sourceSpan,
          details: {
            proof: 'defineRelationalQuery.left.public.v1',
            root: plainJoin.root,
            rootIndex: plainJoin.rootIndex,
            joined: plainJoin.joined,
            joinedIndex: plainJoin.joinedIndex,
            join: plainJoin.join,
            kind: 'left',
            take: plainJoin.take,
            projection: plainJoin.projection,
            visibility: {
              root: { kind: 'public-read' },
              joined: { kind: 'public-read' },
              output: 'public-read',
            },
            remediations: [
              // @ref LLP 0178#2-diagnostic-shape — the advisory routes to
              // the governing page while leaving source rewriting to the
              // author; the proof facts above make the conversion mechanical.
              {
                kind: 'guidePointer',
                pageId: 'backend.relational-queries',
                path: 'guide/backend/relational-queries.md',
                anchor: 'recognize-the-messaging-shape',
                reason: 'Replace the proved plain join with the closed relational declaration.',
                riskClass: 'mechanical',
                machineApplicable: false,
                requiresApproval: false,
                authorityEffect: 'none',
                precondition,
                description: 'Use the relational-query guide to spell the equivalent bounded left join.',
              },
            ],
          },
        });
      }
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { IbexModule: { source: handlerSource, export: handlerExportName } },
        handlerForm: resolvedHandler?.handlerForm ?? 'module',
        inlineAst: resolvedHandler?.inlineAst,
        inlineHelpers: resolvedHandler?.inlineHelpers,
        elevatedDbUses: resolvedHandler?.elevatedDbUses ?? [],
        customAuthorizationEvaluator: resolvedHandler?.customAuthorizationEvaluator ?? null,
        elevatedDbCapabilities: resolvedHandler?.elevatedDbCapabilities ?? [],
        typescriptIdentity: resolvedHandler?.typescriptIdentity,
        sourceSpan: resolvedHandler?.sourceSpan ?? null,
        declaredReads: readTables,
        declaredWrites: [],
        ...(def.standardPattern ? { standardPattern: def.standardPattern } : {}),
        ...(def.fieldBoundary === undefined ? {} : { fieldBoundary: def.fieldBoundary }),
        authScopeField: def.js.authScopeField ?? null,
        authorizationDependence: jsAuthorizationDependence(def),
        ...(customAuthorization === null ? {} : {
          customAuthorization,
          authorizationDependence: [...new Set([
            ...jsAuthorizationDependence(def),
            'userId',
            'opaque',
          ])].sort(),
        }),
        syncabilityClass: def.js.syncabilityClass,
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        // Mirror the HostPlan branch: the declared read-set must reach the
        // contract binding, or every JS query's .contract-meta.ts emits
        // `reads: []` and a per-function cacheKey, breaking Exact's
        // table-dependency/invalidation mapping (ENG-23421).
        reads: readTables,
        result: { kind: 'list', row: jsQueryRowDescriptor(def, name, err) },
        serverRunnable: true,
        localRunnable: false,
        ...(def.retainable === true ? { retainable: true } : {}),
        ...contractQueryLivenessFields(def),
      };
    } else if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.relationalPlan) {
      // @ref LLP 0080#1-closed-relational-plan — the authoring surface
      //   already proved the closed shape against installed builders; this
      //   branch serializes the normalized plan and nothing else. Activation
      //   on the server re-proves schema binding and the cardinality claim.
      const plan = def.relationalPlan;
      const visibilityPolicies = [plan.rootTableVisibility, plan.joinedTableVisibility];
      const reads = [...new Set([
        plan.root,
        plan.joined,
        ...tableVisibilityMembershipReadTables(visibilityPolicies, membershipDeclarations),
      ])].sort();
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: {
          HostPlan: {
            RelationalQuery: serializeRelationalPlan(plan),
          },
        },
        declaredReads: reads,
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: composedVisibilityAuthorizationDependence(
          def.authorizationDependence ?? [],
          visibilityPolicies,
        ),
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        // The implicit continuation-cursor argument (LLP 0080 §2) is part of
        // the callable contract even though authors declare no args in v1.
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads,
        // The canonical effective-result pass below derives this from the
        // closed plan and overwrites the placeholder before introspection or
        // any generated TypeScript is emitted.
        result: { kind: 'list', row: { shape: 'unknown' } },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.jobStatusPlan) {
      // The declared job-status query (LLP 0070 first slice; LLP 0121
      // option 3): a Rust-owned plan over the reserved job-status
      // projection — reads no application table, so no schema checks apply.
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { HostPlan: { JobStatusQuery: {} } },
        declaredReads: ['_snapback_jobs'],
        declaredWrites: [],
        authScopeField: null,
        authorizationDependence: [],
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: ['_snapback_jobs'],
        result: { kind: 'list', row: { shape: 'unknown' } },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Query' && def.pushLedgerPlan) {
      if (!schemaDef.pushSeam?.ledger) {
        err(
          'SNAPBACK_PUSH_LEDGER_NOT_DECLARED',
          'function',
          `${name}: definePushLedgerQuery requires definePushSeam with audiences and ledger`,
          { function: name },
        );
      }
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { HostPlan: { PushLedgerQuery: {} } },
        declaredReads: ['_snapback_push_ledger_v1'],
        declaredWrites: [],
        authScopeField: null,
        // The exact audience can differ per stored intent, so the public
        // invalidation vocabulary records this as opaque authorization while
        // EffectCeilingV1 retains the narrower host-only dependency name.
        authorizationDependence: ['opaque'],
        syncabilityClass: 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: ['_snapback_push_ledger_v1'],
        result: { kind: 'list', row: { shape: 'unknown' } },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Query' || def.__kind === 'LiveQuery') {
      const t = def.plan.table;
      const membershipReads = [];
      if (!tables[t]) {
        err('QUERY_UNKNOWN_TABLE', 'function', `${name}: unknown table ${t}`, { function: name, table: t });
      } else {
        if (def.authScopeField != null && !isKnownField(t, def.authScopeField)) {
          err('QUERY_UNKNOWN_FIELD', 'function', `${name}: authScopeField references unknown field ${t}.${def.authScopeField}`, { function: name, table: t, field: def.authScopeField });
        }
        for (const filter of def.plan.filters) {
          if (!isKnownField(t, filter.field)) {
            err('QUERY_UNKNOWN_FIELD', 'function', `${name}: filter on unknown field ${t}.${filter.field}`, { function: name, table: t, field: filter.field });
          } else if (tables[t].fields.find((field) => field.name === filter.field)?.field_type?.Structured) {
            err(
              'SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE',
              'function',
              `${name}: filters and live matchers cannot observe opaque structured field ${t}.${filter.field}`,
              { function: name, table: t, field: filter.field, fieldType: 'Structured' },
            );
          }
          checkExpr(filter.value, `filter ${filter.field}`);
        }
        for (const order of def.plan.order) {
          if (!isKnownField(t, order.field)) {
            err('QUERY_UNKNOWN_FIELD', 'function', `${name}: order by unknown field ${t}.${order.field}`, { function: name, table: t, field: order.field });
          } else if (tables[t].fields.find((field) => field.name === order.field)?.field_type?.Structured) {
            err(
              'SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE',
              'function',
              `${name}: ordering cannot observe opaque structured field ${t}.${order.field}`,
              { function: name, table: t, field: order.field, fieldType: 'Structured' },
            );
          }
        }
        if (def.plan.index && !tables[t].indexes.some((i) => i.name === def.plan.index)) {
          err('QUERY_UNKNOWN_INDEX', 'function', `${name}: unknown index ${t}.${def.plan.index}`, { function: name, table: t, index: def.plan.index });
        }
        for (const leaf of tableVisibilityMembershipLeaves(def.plan.tableVisibility)) {
          const found = membershipDeclarations.get(leaf.declaration);
          if (found && !membershipReads.includes(found.table.name)) {
            membershipReads.push(found.table.name);
          }
        }
        for (const predicate of def.plan.membershipFilters ?? []) {
          if (!predicate || predicate.__membershipPredicate !== true) {
            err('QUERY_MEMBERSHIP_INVALID', 'function', `${name}: membership predicate must come from a declaration-bound helper`, { function: name });
            continue;
          }
          const found = membershipDeclarations.get(predicate.declaration);
          if (!found) {
            err('QUERY_MEMBERSHIP_UNKNOWN_DECLARATION', 'function', `${name}: membership predicate names unknown declaration ${String(predicate.declaration)}`, {
              function: name,
              declaration: predicate.declaration ?? null,
            });
            continue;
          }
          if (!membershipReads.includes(found.table.name)) membershipReads.push(found.table.name);
          if (predicate.roles !== null) {
            if (!Array.isArray(predicate.roles) || predicate.roles.length === 0) {
              err('QUERY_MEMBERSHIP_EMPTY_ROLES', 'function', `${name}: hasRole must name at least one role`, {
                function: name,
                declaration: predicate.declaration,
              });
            } else {
              const vocabulary = new Set([
                ...found.membership.roles,
                ...(found.membership.pendingRoles ?? []),
              ]);
              for (const roleName of predicate.roles) {
                if (!vocabulary.has(roleName)) {
                  err('QUERY_MEMBERSHIP_UNKNOWN_ROLE', 'function', `${name}: ${predicate.declaration}.hasRole names undeclared role ${String(roleName)}`, {
                    function: name,
                    declaration: predicate.declaration,
                    role: roleName,
                  });
                }
              }
            }
          }
          const resource = predicate.resource;
          if (!resource || resource.__membershipResourceRef !== true) {
            err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: membership resource reference is invalid`, {
              function: name,
              declaration: predicate.declaration,
            });
            continue;
          }
          if (found.membership.scope === 'app') {
            if (resource.kind !== 'app') {
              err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: app-scoped declaration ${predicate.declaration} requires the app singleton`, {
                function: name,
                declaration: predicate.declaration,
              });
            }
            continue;
          }
          const expectedTable = found.membership.resourceTable;
          let actualTable = null;
          if (resource.kind === 'rowField') {
            const field = tables[t].fields.find((candidate) => candidate.name === resource.field);
            if (!field) {
              err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: membership row field ${String(resource.field)} does not exist on ${t}`, {
                function: name,
                declaration: predicate.declaration,
                field: resource.field ?? null,
              });
              continue;
            }
            actualTable = idFieldTypeTable(field.field_type);
          } else if (resource.kind === 'arg') {
            const segments = typeof resource.path === 'string' ? resource.path.split('.') : [];
            let validator = segments.length > 0 ? def.args[segments[0]] : null;
            for (const segment of segments.slice(1)) {
              validator = validator?.primitive === 'object' ? validator.fields?.[segment] : null;
            }
            if (!validator) {
              err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: membership argument ${String(resource.path)} is not declared`, {
                function: name,
                declaration: predicate.declaration,
                arg: resource.path ?? null,
              });
              continue;
            }
            actualTable = idFieldTypeTable(validator.fieldType);
          } else {
            err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: resource-scoped declaration ${predicate.declaration} requires an argument or row field reference`, {
              function: name,
              declaration: predicate.declaration,
            });
            continue;
          }
          if (actualTable !== expectedTable) {
            err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: ${predicate.declaration} expects Id<${expectedTable}> but the helper received ${actualTable === null ? 'a non-id value' : `Id<${actualTable}>`}`, {
              function: name,
              declaration: predicate.declaration,
              expectedTable,
              actualTable,
            });
          }
        }
      }
      const queryReads = [...new Set([t, ...membershipReads])];
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { HostPlan: { Query: serializeQueryPlan(def.plan, membershipDeclarations, authorityProfiles) } },
        declaredReads: queryReads,
        declaredWrites: [],
        authScopeField: def.authScopeField ?? null,
        ...(def.standardPattern ? { standardPattern: def.standardPattern } : {}),
        authorizationDependence: hostPlanAuthorizationDependence(def),
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: queryReads,
        result: { kind: 'list', row: rowDescriptor(tables[t]) },
        serverRunnable: true,
        localRunnable: false,
        ...(def.retainable === true ? { retainable: true } : {}),
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Mutation' && def.js) {
      const resolvedHandler = resolveAdmittedJsHandler(def, name);
      const customAuthorization = compileCustomAuthorization(def, name, resolvedHandler);
      const reads = [...new Set([
        ...(def.js.reads ?? []),
        ...(resolvedHandler?.membershipReads ?? []),
        ...(customAuthorization?.inputs.map(({ table }) => table) ?? []),
      ])];
      const writes = def.js.writes ?? [];
      for (const table of [...reads, ...writes]) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: handler declares unknown table ${table}`, { function: name, table });
        }
        if (writes.includes(table) && tables[table]?.frameworkOwned !== undefined) {
          err('SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED', 'asset-collection', `${name}: handler cannot declare raw writes to framework-owned collection storage ${table}`, {
            function: name,
            table,
            ...definitionAttributionDetails(functionDefinitionAttribution, [name]),
            details: {
              ...definitionAttributionDetails(functionDefinitionAttribution, [name]).details,
              remediation: 'Use the generated collection mutation operations.',
            },
          });
        }
      }
      validateStaticUniqueManyCalls(resolvedHandler?.source ?? '', name, tables, err);
      diagnostics.push(...nPlusOneBatchReadAdvisories({
        source: resolvedHandler?.analysisSource ?? '',
        exportName: resolvedHandler?.exportName ?? name,
        direct: resolvedHandler?.analysisDirect === true,
        sourceSpan: resolvedHandler?.analysisSourceSpan,
        sourcePosition: resolvedHandler?.analysisSourcePosition,
        functionName: name,
        tables,
      }));
      functions.push({
        name,
        kind: 'Mutation',
        ...authoredFunctionManifestFields(def, writes, tables),
        runtime: {
          IbexModule: {
            source: resolvedHandler?.source ?? '',
            export: resolvedHandler?.exportName ?? name,
          },
        },
        handlerForm: resolvedHandler?.handlerForm ?? 'module',
        inlineAst: resolvedHandler?.inlineAst,
        inlineHelpers: resolvedHandler?.inlineHelpers,
        elevatedDbUses: resolvedHandler?.elevatedDbUses ?? [],
        customAuthorizationEvaluator: resolvedHandler?.customAuthorizationEvaluator ?? null,
        elevatedDbCapabilities: resolvedHandler?.elevatedDbCapabilities ?? [],
        typescriptIdentity: resolvedHandler?.typescriptIdentity,
        sourceSpan: resolvedHandler?.sourceSpan ?? null,
        // Internal D9 evidence only; decorateFunctions intentionally omits it
        // from the runtime manifest while write-policy projection retains the
        // authored module identity.
        // @ref LLP 0264#d9-authorization-review-projection
        writePolicySourcePath:
          resolvedHandler?.analysisSourceSpan?.file ?? 'functions.mjs',
        writePolicyAnalysisSource:
          resolvedHandler?.writePolicyAnalysisSource ?? resolvedHandler?.source ?? '',
        writePolicySourceSegments:
          resolvedHandler?.writePolicySourceSegments ?? null,
        declaredReads: reads,
        declaredWrites: writes,
        writePolicy: {
          semanticVersion: WRITE_POLICY_SEMANTIC_VERSION,
          disclosures: def.discloseUniqueConflicts ?? [],
          ...(def.opaqueWritePosture === undefined
            ? {}
            : { opaqueWritePosture: def.opaqueWritePosture }),
          ...(def.declaredTableCeiling === undefined
            ? {}
            : { declaredTableCeiling: def.declaredTableCeiling }),
        },
        sequences: def.sequences ?? [],
        ...(customAuthorization === null ? {} : {
          customAuthorization,
          authorizationDependence: [...new Set([
            ...(Array.isArray(def.authorizationDependence)
              ? def.authorizationDependence
              : []),
            'userId',
            'opaque',
          ])].sort(),
        }),
        syncabilityClass: 'mutation',
      });
      // The class-specific "outgrew the IR" diagnostic (LLP 0051 D2 /
      // Increment 3 gate c): a JS-tier mutation that declares WHY it is out
      // of the IR profile gets that reason recorded in the generated
      // manifest as a normal info diagnostic pointing at the JS/WASM path —
      // the tier ladder stays explicit, and profile-creep pressure has a
      // named class to argue against instead of vibes.
      if (def.outgrewIr) {
        infoDiagnostics.push({
          code: 'MUTATION_OUTGREW_IR',
          severity: 'info',
          subsystem: 'function',
          message: `${name} outgrew the IR: ${def.outgrewIr.replaceAll('-', ' ')} — ${OUTGREW_IR_CLASSES[def.outgrewIr]}; stays on the JS/WASM tier (LLP 0051 D2)`,
          details: { function: name, class: def.outgrewIr },
        });
      }
      contractMutations[name] = buildContractJsMutationDescriptor({
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes,
        sequenceCount: (def.sequences ?? []).length,
      });
    } else if (def.__kind === 'Mutation') {
      const collectionPlan = def.plan.steps
        .find((step) => step.AssetCollection !== undefined)
        ?.AssetCollection ?? null;
      const writes = new Set(collectionPlan ? [collectionPlan.childTable] : []);
      let sequenceAllocationCount = 0;
      const checkValuesMap = (t, values, where) => {
        for (const [field, expr] of Object.entries(values)) {
          if (!fieldNames(t).has(field)) err('QUERY_UNKNOWN_FIELD', 'function', `${name}: ${where} sets unknown field ${t}.${field}`, { function: name, table: t, field });
          const declared = tables[t]?.fields.find((candidate) => candidate.name === field);
          if (declared?.field_type?.RelationIncarnation) {
            err('SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED', 'function', `${name}: ${where} cannot author protected relation stamp ${t}.${field}`, { function: name, table: t, field });
          }
          checkExpr(expr, `${where} ${field}`);
        }
      };
      const checkRequiredFields = (t, values, where) => {
        for (const f of tables[t].fields) {
          if (!f.optional && !f.field_type?.RelationIncarnation && !(f.name in values)) {
            err('FUNCTION_MISSING_REQUIRED_FIELD', 'function', `${name}: ${where} into ${t} omits required field ${f.name}`, { function: name, table: t, field: f.name });
          }
        }
      };
      for (const step of def.plan.steps) {
        const kind = Object.keys(step)[0];
        const body = step[kind];
        // Guard/Let carry no table; every other step names one.
        const t = body.table;
        if (t !== undefined && !tables[t]) {
          err('QUERY_UNKNOWN_TABLE', 'function', `${name}: ${kind} on unknown table ${t}`, { function: name, table: t });
          continue;
        }
        if (t !== undefined
          && tables[t]?.frameworkOwned !== undefined
          && ['Insert', 'Patch', 'Delete', 'DeleteWhere', 'InsertEach'].includes(kind)) {
          err(
            'SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED',
            'asset-collection',
            `${name}: generic ${kind} cannot write framework-owned collection storage ${t}`,
            {
              function: name,
              table: t,
              ...definitionAttributionDetails(functionDefinitionAttribution, [name]),
              details: {
                ...definitionAttributionDetails(functionDefinitionAttribution, [name]).details,
                remediation: 'Use the generated append, replace, remove, or reorder operation for the collection.',
              },
            },
          );
          continue;
        }
        if (kind === 'Insert') {
          writes.add(t);
          checkValuesMap(t, body.values, 'insert');
          checkRequiredFields(t, body.values, 'insert');
        } else if (kind === 'Patch') {
          writes.add(t);
          checkExpr(body.id, 'patch id');
          checkValuesMap(t, body.values, 'patch');
        } else if (kind === 'Delete') {
          writes.add(t);
          checkExpr(body.id, 'delete id');
        } else if (kind === 'Get') {
          checkExpr(body.id, 'get id');
        } else if (kind === 'Guard') {
          checkExpr(body.cond, 'guard condition');
        } else if (kind === 'Let') {
          checkExpr(body.expr, 'let expression');
        } else if (kind === 'AllocateSequence') {
          sequenceAllocationCount += 1;
          checkExpr(body.scope, 'sequence scope');
          const declaration = (def.sequences ?? []).find(
            (candidate) => candidate.name === body.counter,
          );
          if (!def.writeWithActivityPlan) {
            err(
              'SNAPBACK_SEQUENCE_DECLARATION_INVALID',
              'function',
              `${name}: AllocateSequence is admitted only by write-with-activity.v1`,
              { function: name, sequence: body.counter },
            );
          } else if (!declaration) {
            err(
              'SNAPBACK_SEQUENCE_UNDECLARED',
              'function',
              `${name}: AllocateSequence names an undeclared counter ${body.counter}`,
              { function: name, sequence: body.counter },
            );
          } else if (
            declaration.scopeTable !== def.writeWithActivityPlan.scopeTable
            || declaration.scopeAccess?.kind !== 'existing-owner.v1'
            || declaration.scopeAccess?.ownerField
              !== def.writeWithActivityPlan.scopeOwnerField
            || JSON.stringify(body.scope) !== JSON.stringify(def.writeWithActivityPlan.scopeId)
          ) {
            err(
              'SNAPBACK_SEQUENCE_DECLARATION_INVALID',
              'function',
              `${name}: allocation declaration must match the exact write-with-activity owner scope`,
              { function: name, sequence: body.counter },
            );
          }
        } else if (kind === 'AssertSourceChanged') {
          checkExpr(body.id, 'source id');
        } else if (kind === 'AssertCurrentRelation') {
          if (!def.writeWithActivityPlan) {
            err(
              'MUTATION_ASSERT_CURRENT_RELATION_FORBIDDEN',
              'function',
              `${name}: AssertCurrentRelation is host-owned by write-with-activity.v1`,
              { function: name, step: kind },
            );
          }
          checkExpr(body.id, 'relation row id');
          checkExpr(body.scope_id, 'relation scope id');
          const scopeTable = tables[body.scope_table];
          if (!scopeTable) {
            err(
              'QUERY_UNKNOWN_TABLE',
              'function',
              `${name}: AssertCurrentRelation names unknown scope table ${body.scope_table}`,
              { function: name, table: body.scope_table },
            );
          }
          const foreignKey = tables[t]?.fields.find(
            (field) => field.name === body.foreign_key_field,
          );
          const incarnation = tables[t]?.fields.find(
            (field) => field.name === body.incarnation_field,
          );
          if (idFieldTypeTable(foreignKey?.field_type) !== body.scope_table) {
            err(
              'FUNCTION_RELATION_ASSERTION_INVALID',
              'function',
              `${name}: AssertCurrentRelation foreign key must be an id of ${body.scope_table}`,
              {
                function: name,
                table: t,
                field: body.foreign_key_field,
                scopeTable: body.scope_table,
              },
            );
          }
          const relation = incarnation?.field_type?.RelationIncarnation;
          if (
            relation?.foreignKeyField !== body.foreign_key_field
            || relation?.parentTable !== body.scope_table
          ) {
            err(
              'FUNCTION_RELATION_ASSERTION_INVALID',
              'function',
              `${name}: AssertCurrentRelation incarnation field does not protect the declared relation`,
              {
                function: name,
                table: t,
                field: body.incarnation_field,
                scopeTable: body.scope_table,
              },
            );
          }
          if (body.else_error !== 'SNAPBACK_ROW_NOT_FOUND') {
            err(
              'FUNCTION_RELATION_ASSERTION_INVALID',
              'function',
              `${name}: AssertCurrentRelation must use the uniform missing-row outcome`,
              { function: name, step: kind },
            );
          }
        } else if (kind === 'DeleteWhere') {
          writes.add(t);
          for (const filter of body.filter) {
            if (!fieldNames(t).has(filter.field) && !SYSTEM_FIELDS.includes(filter.field)) {
              err('QUERY_UNKNOWN_FIELD', 'function', `${name}: deleteWhere filters unknown field ${t}.${filter.field}`, { function: name, table: t, field: filter.field });
            }
            checkExpr(filter.value, `deleteWhere ${filter.field}`);
          }
        } else if (kind === 'InsertEach') {
          writes.add(t);
          checkExpr(body.source, 'insertEach source');
          checkValuesMap(t, body.values, 'insertEach');
          checkRequiredFields(t, body.values, 'insertEach');
        } else if (kind === 'AssetCollection') {
          // Generated-only closed step. Schema/runtime pairing validates the
          // descriptor; its exact effects are handled by the total ceiling.
        } else {
          err('MUTATION_UNSUPPORTED_STEP', 'function', `${name}: unsupported mutation step ${kind}`, { function: name, step: kind });
        }
      }
      if (sequenceAllocationCount > 1) {
        err(
          'SNAPBACK_SEQUENCE_DECLARATION_INVALID',
          'function',
          `${name}: sequence_allocation_v1 admits at most one allocation`,
          { function: name, allocations: sequenceAllocationCount },
        );
      }
      if (def.plan.return_value && 'Document' in def.plan.return_value) {
        checkExpr(def.plan.return_value.Document.id, 'return document id');
      } else if (def.plan.return_value && 'Expr' in def.plan.return_value) {
        checkExpr(def.plan.return_value.Expr, 'return expression');
      }
      const serializedPlan = serializeMutationPlan(def.plan, name, err, tables, {
        standardPattern: def.standardPattern ?? null,
      });
      functions.push({
        name,
        kind: 'Mutation',
        ...authoredFunctionManifestFields(def, writes, tables),
        runtime: {
          HostPlan: def.writeWithActivityPlan
            ? {
              WriteWithActivity: {
                ...def.writeWithActivityPlan,
                scopeId: serializeExpr(def.writeWithActivityPlan.scopeId),
                sourceId: serializeExpr(def.writeWithActivityPlan.sourceId),
                sourceOperation: def.writeWithActivityPlan.sourceOperation,
                mutation: serializedPlan,
              },
            }
            : { Mutation: serializedPlan },
        },
        declaredReads: mutationReadTables(def.plan),
        declaredWrites: [...writes],
        writePolicy: {
          semanticVersion: WRITE_POLICY_SEMANTIC_VERSION,
          disclosures: def.discloseUniqueConflicts ?? [],
        },
        sequences: def.sequences ?? [],
        syncabilityClass: 'mutation',
        ...(def.standardPattern ? { standardPattern: def.standardPattern } : {}),
      });
      contractMutations[name] = buildContractMutationDescriptor({
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes: [...writes],
        plan: serializedPlan,
        sequenceAllocationCount,
      });
    } else if (def.__kind === 'Action' && def.js) {
      const writes = def.js.writes ?? [];
      for (const table of writes) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: action declares unknown write table ${table}`, { function: name, table });
        }
        if (tables[table]?.frameworkOwned !== undefined) {
          err('SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED', 'asset-collection', `${name}: action cannot declare raw writes to framework-owned collection storage ${table}`, {
            function: name,
            table,
            ...definitionAttributionDetails(functionDefinitionAttribution, [name]),
            details: {
              ...definitionAttributionDetails(functionDefinitionAttribution, [name]).details,
              remediation: 'Use the generated collection mutation operations.',
            },
          });
        }
      }
      const resolvedHandler = resolveJsHandler(def, name);
      validateStaticUniqueManyCalls(resolvedHandler?.source ?? '', name, tables, err);
      functions.push({
        name,
        kind: 'Action',
        ...(def.stream === true ? { stream: true } : {}),
        ...authoredFunctionManifestFields(def, writes, tables),
        uses: def.uses ?? [],
        runtime: {
          IbexModule: {
            source: resolvedHandler?.source ?? '',
            export: resolvedHandler?.exportName ?? name,
          },
        },
        handlerForm: resolvedHandler?.handlerForm ?? 'module',
        inlineAst: resolvedHandler?.inlineAst,
        inlineHelpers: resolvedHandler?.inlineHelpers,
        elevatedDbUses: resolvedHandler?.elevatedDbUses ?? [],
        typescriptIdentity: resolvedHandler?.typescriptIdentity,
        sourceSpan: resolvedHandler?.sourceSpan ?? null,
        declaredReads: [],
        declaredWrites: writes,
        syncabilityClass: 'action',
      });
      contractActions[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes,
        serverRunnable: true,
      };
    } else if (def.__kind === 'Action') {
      const writes = def.writes ?? [];
      for (const table of writes) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: action declares unknown write table ${table}`, { function: name, table });
        }
      }
      for (const step of def.plan?.steps ?? []) {
        const runMutation = step?.RunMutation;
        if (!runMutation) continue;
        for (const [argument, expr] of Object.entries(runMutation.args ?? {})) {
          if (expr?.__expr) {
            checkExpr(expr, `runMutation ${runMutation.name} argument ${argument}`);
          }
        }
      }
      functions.push({
        name,
        kind: 'Action',
        ...(def.stream === true ? { stream: true } : {}),
        ...authoredFunctionManifestFields(def, writes, tables),
        uses: def.uses ?? [],
        runtime: { HostPlan: { Action: serializeActionPlan(def.plan, name, err) } },
        declaredReads: [],
        declaredWrites: writes,
        syncabilityClass: 'action',
      });
      contractActions[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes,
        serverRunnable: true,
      };
    }
  }

  for (const name of inlineExtraction.handlers.keys()) {
    // Upload-intent authorizers bind later, in the asset-intent block, with
    // the same marker verification; they are deliberately not functions.
    if (assetUploadDefs.some((intent) => intent.exportName === name)) continue;
    if (!functions.some((fn) => fn.name === name && fn.handlerForm === 'inline')) {
      err(
        'SNAPBACK_INLINE_HANDLER_NOT_BOUND',
        'function',
        `${name}: direct inline handler was not bound to an emitted function`,
        { function: name },
      );
    }
  }

  for (const fn of functions) {
    const declarations = new Set();
    const def = functionsModule[fn.name];
    const query = fn.runtime?.HostPlan?.Query;
    const search = fn.runtime?.HostPlan?.SearchQuery;
    for (const predicate of query?.membershipFilters ?? []) {
      declarations.add(predicate.declaration);
    }
    for (const leaf of tableVisibilityMembershipLeaves(query?.tableVisibility)) {
      declarations.add(leaf.declaration);
    }
    // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
    // — a named search operation is itself a profile consumer, so the same
    // generation identity participates in its runtime fence and review facts.
    if (search) {
      const index = (tables[search.table]?.searchIndexes ?? [])
        .find((candidate) => candidate.name === search.index);
      if (index?.visibility?.kind === 'membership') {
        declarations.add(index.visibility.declaration);
      }
    }
    for (const tableName of fn.declaredWrites ?? []) {
      const id = tables[tableName]?.authorityProfile?.id;
      if (id) declarations.add(id);
    }
    for (const predicate of def?.membership ?? []) {
      if (predicate?.declaration) declarations.add(predicate.declaration);
    }
    if (def?.[GENERATED_AUTHORITY_OPERATION]?.id) {
      declarations.add(def[GENERATED_AUTHORITY_OPERATION].id);
    }
    const dependence = [...declarations]
      .map((declaration) => authorityProfiles.get(declaration)?.profile)
      .filter(Boolean)
      .map(({ id, generation }) => ({ id, generation }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (dependence.length > 0) fn.authorityProfileDependence = dependence;
  }

  // Rust validates these schema-expanded contracts. Deriving them once here
  // keeps the runtime, generated TypeScript, provider introspection, and
  // implementation identity on exactly the same contract bytes.
  for (const fn of functions) {
    const def = functionsModule[fn.name];
    try {
      // @ref LLP 0131#the-argument-contract-descriptor — the extended
      // descriptor (bounds included) is the carrier; the v2 hash is its
      // identity witness, never a resolver. No degraded-args authoring
      // diagnostic is minted here (v0.2 defers that to CV-6/SD-1): a
      // v.json() argument already projects loudly through the provider
      // degraded warning.
      fn.argsContract = effectiveArgsContract(def?.args ?? {});
      fn.argsContractHash = argsContractHash(fn.argsContract);
      if (fn.runtime?.HostPlan?.SnapshotBatch) {
        Object.assign(
          fn.runtime.HostPlan.SnapshotBatch,
          snapshotBatchIdentityV1(fn.runtime.HostPlan.SnapshotBatch, fn.argsContract),
        );
      }
      if (fn.runtime?.HostPlan?.SnapshotBatchV2) {
        Object.assign(
          fn.runtime.HostPlan.SnapshotBatchV2,
          snapshotBatchIdentityV2(fn.runtime.HostPlan.SnapshotBatchV2, fn.argsContract),
        );
      }
      const resultFacts = effectiveResultContractFacts({
        def,
        functionKind: fn.kind,
        runtime: fn.runtime,
        tables,
      });
      fn.resultContract = resultFacts.contract;
      fn.resultContractHash = resultContractHash(fn.resultContract);
      if (def?.graphQuerySource) {
        fn.runtime.HostPlan.GraphQuery = compileGraphQueryV1({
          source: def.graphQuerySource,
          argsContract: fn.argsContract,
          resultContractHash: fn.resultContractHash,
          tables,
        });
      }
      if (fn.runtime?.HostPlan?.Mutation) {
        // @ref LLP 0275#d8-explicit-profile-classification-under-llp-0295-d03-2026-08-21
        // — result/dependency facts proven by a closed plan are emitted once
        // with provenance. Authored authority and policy stay untouched.
        infoDiagnostics.push({
          code: 'SNAPBACK_PLAN_FACTS_DERIVED',
          severity: 'info',
          subsystem: 'function',
          message: `${fn.name}: closed plan result/dependency facts resolved with provenance`,
          guideAnchor: '/_snapback/guide/backend/declarative-plans.md#return-bindings',
          details: {
            function: fn.name,
            resultContractProvenance: resultFacts.provenance,
            resultContractHash: fn.resultContractHash,
            dependencySet: {
              reads: [...(fn.declaredReads ?? [])].sort(compareCodeUnits),
              writes: [...(fn.declaredWrites ?? [])].sort(compareCodeUnits),
            },
            dependencySetProvenance: 'plan-derived',
          },
        });
      }
      if (fn.fieldBoundary !== undefined) {
        for (const field of fn.fieldBoundary.fields) {
          if (resultContractRowHasField(fn.resultContract, field) === false) {
            err(
              'SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN',
              'function',
              `${fn.name}: fieldBoundary names ${field}, which is absent from the effective result row contract`,
              { function: fn.name, field },
            );
          }
        }
      }
      if (contractQueries[fn.name]) {
        contractQueries[fn.name].result = providerResultDescriptor(fn.resultContract);
      }
      if (fn.resultContract.kind === 'unknown') {
        infoDiagnostics.push({
          code: 'SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED',
          severity: 'info',
          subsystem: 'function',
          message: `${fn.name}: no precise result contract was declared; runtime enforcement is limited to the general result budget`,
          details: { function: fn.name },
        });
      }
    } catch (error) {
      err(
        error.code ?? 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID',
        'function',
        `${fn.name}: ${error.message}`,
        { function: fn.name },
      );
    }
  }
  compileApiExposure(apiManifest, functions, err, diagnostics);

  // Ephemeral collections project as Contract read descriptors (ENG-22479;
  // Exact LLP 0284 §2.5): they live in the manifest QUERIES map with
  // `ephemeral: true` (the runtime's subscribeEphemeral looks descriptors up
  // there and the compiler rejects `query`-binding them — §2.4 kind
  // mismatch). They are NOT server functions; name collisions are errors.
  const ephemeralCollectionNames = new Set(ephemeralCollections.map(({ name }) => name));
  for (const collection of ephemeralCollections) {
    if (contractQueries[collection.name] || contractMutations[collection.name]) {
      err('EPHEMERAL_NAME_COLLISION', 'ephemeral', `${collection.name} collides with a function name`, { collection: collection.name });
      continue;
    }
    const publishName = `${collection.name}Publish`;
    if (contractQueries[publishName] || contractMutations[publishName]) {
      err('EPHEMERAL_NAME_COLLISION', 'ephemeral', `${publishName} collides with a function name`, { collection: collection.name, alias: publishName });
      continue;
    }
    if (ephemeralCollectionNames.has(publishName)) {
      err('EPHEMERAL_NAME_COLLISION', 'ephemeral', `${publishName} collides with another ephemeral collection name`, { collection: collection.name, alias: publishName });
      continue;
    }
    contractQueries[collection.name] = contractEphemeralDescriptor(collection, schemaDef);
  }

  validateActionPlans(functions, err);
  const cronJobs = buildCronJobs(cronDefs, functions, err);
  const projections = buildMaintainedProjections(projectionDefs, functions, err);
  const configEntries = buildConfigEntries(
    configDefs,
    functions,
    err,
    schemaDef.pushSeam?.uses ?? [],
  );
  if (apiManifest?.ask?.billing === 'app' && apiManifest.ask.model?.secret !== undefined) {
    const entry = configEntries.find(({ name }) => name === apiManifest.ask.model.secret);
    if (!entry || entry.secret !== true) {
      err(
        'SNAPBACK_API_ASK_SECRET_INVALID',
        'api',
        `api.ask.model.secret names ${apiManifest.ask.model.secret}, which must be a declared secret LLP 0036 config entry`,
        { secret: apiManifest.ask.model.secret },
      );
    }
  }
  // @ref LLP 0080#7-generated-authoring-surface — a maintained projection
  // has no function carrier, so its dependence on the relational engine
  // rides the schema-level requirement: a target without
  // `relational_query_v1` refuses at generation (below) and again at
  // admission, never as a late activation surprise.
  if (projections.length > 0 && !schemaRequiredCapabilities.includes('relational_query_v1')) {
    schemaRequiredCapabilities.push('relational_query_v1');
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Hashes + emit ----------------------------------------------------------
  let seedSource = null;
  if (existsSync(seedPath)) {
    try {
      seedSource = resolveFileReadCapability(seedPath, {
        allowedRoots: [backendRoot],
        codePrefix: 'SEED_SOURCE',
      }).read();
    } catch (error) {
      err(error.codegenCode ?? 'SEED_SOURCE_UNREADABLE', 'seed', error.message, error.details ?? {});
    }
  }
  let contractCapabilitiesSource = Buffer.alloc(0);
  try {
    contractCapabilitiesSource = resolveFileReadCapability(CONTRACT_CAPABILITIES_PATH, {
      allowedRoots: [REPO_ROOT],
      codePrefix: 'CODEGEN_CONTRACT_CAPABILITY_SOURCE',
    }).read();
  } catch (error) {
    err(error.codegenCode ?? 'CODEGEN_CONTRACT_CAPABILITY_SOURCE_UNREADABLE', 'codegen', error.message, error.details ?? {});
  }
  const loadedCanonicalCapability = loadCanonicalCapabilityManifest(err, targetProfile, targetConfig);
  const canonicalCapability = testHooks?.capabilityManifest === undefined
    ? loadedCanonicalCapability
    : {
        manifest: structuredClone(testHooks.capabilityManifest),
        source: Buffer.from(`${stableJson(testHooks.capabilityManifest)}\n`),
      };
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const demoMetadata = readDemoAppMetadata(backendRoot, diagnostics);
  // A nearest-ancestor demo manifest is the stable app-identity authority.
  // Layouts such as <demo>/backends/snapback must not become app "backends"
  // merely because codegen was moved one directory deeper. Bare external
  // backends retain the legacy immediate-parent fallback.
  //
  // @ref LLP 0004#first-slice-api-decisions — appId feeds stable function ids.
  const appId = demoMetadata.appId ?? inferAppId(backendRoot);
  let parsedSeed = null;
  let seedArtifact = null;
  let seedRowCount = null;
  if (seedSource !== null) {
    try {
      parsedSeed = parseSeedSourceV1(seedSource, appId);
      if (parsedSeed.versioned) {
        seedArtifact = parsedSeed.artifact;
        seedRowCount = parsedSeed.seedRowCount;
        validateSeedVersionEvidence(
          backendRoot,
          targetConfig.outputDirectory,
          seedArtifact,
        );
      }
    } catch (error) {
      err(
        error.code ?? 'SNAPBACK_SEED_DECLARATION_INVALID',
        'seed',
        error.message,
        error.details ?? {},
      );
    }
  }
  // @ref LLP 0109#17-dated-amendment-seed-asset-fixtures-2026-07-31 — the
  //   fixtures artifact is a separately versioned sibling; fixture bytes
  //   stay committed files, digested here, never embedded in any artifact.
  let seedAssetFixtures = null;
  const seedAssetsPath = join(backendRoot, 'seed-assets.json');
  if (existsSync(seedAssetsPath)) {
    try {
      const fixturesSource = JSON.parse(
        resolveFileReadCapability(seedAssetsPath, {
          allowedRoots: [backendRoot],
          codePrefix: 'SEED_ASSETS_SOURCE',
        }).read().toString('utf8'),
      );
      const sourceDigests = new Map();
      for (const fixture of Array.isArray(fixturesSource?.fixtures) ? fixturesSource.fixtures : []) {
        if (typeof fixture?.file !== 'string') continue;
        const bytes = resolveFileReadCapability(join(backendRoot, fixture.file), {
          allowedRoots: [backendRoot],
          codePrefix: 'SEED_ASSETS_SOURCE',
        }).read();
        sourceDigests.set(fixture.file, createHash('sha256').update(bytes).digest('hex'));
      }
      seedAssetFixtures = buildSeedAssetFixturesV1(fixturesSource, appId, sourceDigests);
    } catch (error) {
      err(
        error.code ?? error.codegenCode ?? 'SNAPBACK_SEED_ASSET_FIXTURES_INVALID',
        'seed',
        error.message,
        error.details ?? {},
      );
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const decoratedFunctionDefinitions = decorateFunctions(
    appId,
    functions,
    functionDefinitionSourceSpans,
  );
  const writePolicy = buildWritePolicyChecks({
    tables,
    functions: decoratedFunctionDefinitions,
    sourceFunctions: functions,
    err,
    warn,
  });
  for (const fn of decoratedFunctionDefinitions) {
    if (fn.kind === 'Action' && resultContractContainsMedia(fn.resultContract)) {
      err(
        'SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE',
        'asset',
        `${fn.name}: an Action direct result cannot carry mediaRef.v1; return it from a Query or Mutation`,
        { function: fn.name },
      );
    }
  }
  for (const fn of decoratedFunctionDefinitions) {
    const binding = contractQueries[fn.name]
      ?? contractMutations[fn.name]
      ?? contractActions[fn.name];
    if (!binding) continue;
    binding.implementationHash = fn.implementationHash;
    binding.argsHash = fn.argsContractHash;
    binding.resultHash = fn.resultContractHash;
    binding.resultContract = fn.resultContract;
  }
  // @ref LLP 0044#video-location-policy-the-video--location--sibling-block-dated-decision-2026-08-03 —
  //   generation requires the media-specific image.location/video.location
  //   sibling, keeps the image policy preimage intact, and admits `strip`
  //   only where the target advertises the matching rewriting fact.
  const assetUploadIntents = [];
  {
    const supportedTargetCapabilities = new Set(
      Array.isArray(canonicalCapability.manifest?.supportedCapabilities)
        ? canonicalCapability.manifest.supportedCapabilities
        : [],
    );
    const locationBearing = (mediaType) => {
      const lowered = mediaType.toLowerCase();
      return lowered.startsWith('image/') || lowered.startsWith('video/');
    };
    // The closed callback args contract: a callback mutation declares
    // exactly this shape, checked by contract hash so the pin is the same
    // identity the invocation validates against.
    const assetCallbackContractHash = argsContractHash(
      effectiveArgsContract({ event: v.string(), assetId: v.string(), facts: v.json() }),
    );
    // @ref LLP 0044#ceremony-floor-and-bounded-on-demand-widths-dated-amendment-2026-08-01 —
    //   a bare v.assetRef() derives a generated default intent from its
    //   table/field placement; `upload: null` (the `unrestricted` marker)
    //   keeps the prior handler-attach-only shape. Derived defs ride the
    //   ordinary intent loop below so strip/delivery admission, policy
    //   hashing, and emission are byte-identical with explicit intents.
    const DERIVED_DEFAULT_PREFIX = '_assets.default.';
    const DERIVED_DEFAULT_AUTHORIZER_SOURCE =
      'export const defaultAuthorizer = async (ctx) => ({ owner: ctx.auth.userId });\n';
    for (const table of Object.values(tables)) {
      for (const tableField of table.fields ?? []) {
        const ref = tableField.field_type?.AssetRef;
        if (!ref) continue;
        if (ref.unrestricted) {
          delete ref.unrestricted;
          continue;
        }
        if (ref.upload !== undefined) continue;
        const derivedName = `${DERIVED_DEFAULT_PREFIX}${table.name}.${tableField.name}`;
        ref.upload = derivedName;
        assetUploadDefs.push({
          exportName: derivedName,
          def: {
            auth: 'authenticated',
            reads: [],
            accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 10_000_000 },
            delivery: { kind: 'private-strict' },
            access: { read: 'owner-only' },
            image: { location: 'strip' },
            __derivedDefaultSource: DERIVED_DEFAULT_AUTHORIZER_SOURCE,
          },
        });
      }
    }
    const seenIntents = new Set();
    for (const { exportName, def } of assetUploadDefs) {
      const derivedDefault = typeof def.__derivedDefaultSource === 'string';
      if (def.__deliveryDefaulted === true && !derivedDefault) {
        const source = definitionAttributionDetails(
          functionDefinitionAttribution,
          [exportName],
        );
        warn(
          'SNAPBACK_ASSET_DELIVERY_IMPLICIT_PUBLIC_IMMUTABLE',
          'asset',
          `${exportName}: delivery omitted; defaulting to public-immutable (performance default, author ruling 2026-08-16) — declare \`delivery\` explicitly; use private-signed/private-strict when reads must be authorized and revocable.`,
          {
            intent: exportName,
            ...source,
            details: {
              ...(source.details ?? {}),
              authoredDelivery: 'omitted',
              effectiveDelivery: 'public-immutable',
              privateAlternatives: ['private-signed', 'private-strict'],
            },
          },
        );
      }
      const validAuthoredName = authoringProfile === FAMILIAR_AUTHORING_PROFILE
        ? isOperationName(exportName)
          && exportName.split('.').every((segment) => !RESERVED_WORDS.has(segment))
        : IDENT.test(exportName) && !RESERVED_WORDS.has(exportName);
      if (!derivedDefault && !validAuthoredName) {
        err('SCHEMA_INVALID_IDENTIFIER', 'asset', `invalid asset upload intent identifier ${exportName}`, { intent: exportName });
        continue;
      }
      if (seenIntents.has(exportName)) continue;
      seenIntents.add(exportName);
      for (const table of def.reads ?? []) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'asset', `${exportName}: authorizer declares unknown table ${table}`, { intent: exportName, table });
        }
      }
      const bearing = def.accept.mediaTypes.filter(locationBearing);
      const images = bearing.filter((type) => type.toLowerCase().startsWith('image/'));
      const videos = bearing.filter((type) => type.toLowerCase().startsWith('video/'));
      const missingLocationPolicies = [
        ...(images.length > 0 && def.image?.location === undefined ? ['image.location'] : []),
        ...(videos.length > 0 && def.video?.location === undefined ? ['video.location'] : []),
      ];
      if (missingLocationPolicies.length > 0) {
        const declaration = missingLocationPolicies.length === 1
          ? `${missingLocationPolicies[0]} ('strip' or 'retain')`
          : `${missingLocationPolicies.join(' and ')} (each 'strip' or 'retain')`;
        err(
          'SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED',
          'asset',
          `${exportName}: media types ${bearing.join(', ')} carry location metadata; declare ${declaration} — omission refuses at generation, there is no implicit fallback`,
          { intent: exportName, mediaTypes: bearing, policyFields: missingLocationPolicies },
        );
        continue;
      }
      if (def.image !== undefined && images.length === 0) {
        err(
          'SNAPBACK_ASSET_INTENT_IMAGE_SPEC_INVALID',
          'asset',
          `${exportName}: image policy declared but no accepted media type is an image`,
          { intent: exportName, mediaTypes: def.accept.mediaTypes },
        );
        continue;
      }
      if (def.video !== undefined && videos.length === 0) {
        err(
          'SNAPBACK_ASSET_INTENT_VIDEO_SPEC_INVALID',
          'asset',
          `${exportName}: video policy declared but no accepted media type is a video`,
          { intent: exportName, mediaTypes: def.accept.mediaTypes },
        );
        continue;
      }
      const missing = [];
      if (def.image?.location === 'strip'
        && !supportedTargetCapabilities.has('asset_image_finalization_v1')) {
        missing.push({ capability: 'asset_image_finalization_v1', mediaTypes: images });
      }
      if (def.video?.location === 'strip'
        && !supportedTargetCapabilities.has('asset_video_finalization_v1')) {
        missing.push({ capability: 'asset_video_finalization_v1', mediaTypes: videos });
      }
      if (missing.length > 0) {
        err(
          'SNAPBACK_ASSET_INTENT_LOCATION_STRIP_UNSUPPORTED',
          'asset',
          `${exportName}: location 'strip' requires ${missing.map((entry) => entry.capability).join(' and ')}, which target ${canonicalCapability.manifest?.targetProfileId ?? targetProfile} does not advertise; an explicit 'retain' admits without the rewriting fact`,
          { intent: exportName, missing },
        );
        continue;
      }
      // Delivery-profile admission is manifest-keyed like strip admission:
      // a target advertises supported profiles and refuses an intent it
      // cannot honor (LLP 0044 §Delivery profiles). Targets with no assets
      // facts block keep their existing posture — the runtime refuses.
      const declaredProfiles = canonicalCapability.manifest?.assets?.deliveryProfiles;
      if (Array.isArray(declaredProfiles) && !declaredProfiles.includes(def.delivery.kind)) {
        err(
          'SNAPBACK_ASSET_INTENT_DELIVERY_UNSUPPORTED',
          'asset',
          `${exportName}: delivery profile ${def.delivery.kind} is not advertised by target ${canonicalCapability.manifest?.targetProfileId ?? targetProfile}`,
          { intent: exportName, profile: def.delivery.kind, declared: declaredProfiles },
        );
        continue;
      }
      // Declared lifecycle callbacks (LLP 0044 §Declarative processing):
      // each names an ordinary declared mutation whose args contract is
      // exactly the closed callback shape — typed facts, never byte
      // authority. Sessions mode is admitted because the runtime executes
      // this exact declared target through the ruled per-app service grant.
      // @ref LLP 0039#dated-amendment-sessions-asset-callback-execution-authority-2026-08-03
      // @ref LLP 0055#dated-amendment-per-app-asset-callbacks-service-principal-2026-08-03
      if (def.on !== undefined) {
        let callbacksValid = true;
        for (const [event, handler] of Object.entries(def.on)) {
          const target = functions.find((fn) => fn.name === handler);
          if (!target || target.kind !== 'Mutation') {
            err(
              'SNAPBACK_ASSET_CALLBACK_INVALID',
              'asset',
              `${exportName}: on.${event} must name a declared mutation (got ${handler})`,
              { intent: exportName, event, handler },
            );
            callbacksValid = false;
            continue;
          }
          if (target.argsContractHash !== assetCallbackContractHash) {
            err(
              'SNAPBACK_ASSET_CALLBACK_CONTRACT_INVALID',
              'asset',
              `${exportName}: on.${event} mutation ${handler} must declare exactly the callback args { event: v.string(), assetId: v.string(), facts: v.json() }`,
              { intent: exportName, event, handler },
            );
            callbacksValid = false;
          }
        }
        if (!callbacksValid) continue;
      }
      // Restriction targets: every v.assetRef({ upload }) must name a
      // declared intent; collected here so the check covers all intents.
      let resolvedAuthorizer;
      if (typeof def.__derivedDefaultSource === 'string') {
        resolvedAuthorizer = {
          source: def.__derivedDefaultSource,
          exportName: 'defaultAuthorizer',
          handlerForm: 'module',
          sourceSpan: null,
        };
      } else if (def.authorize !== undefined) {
        const extracted = inlineExtraction.handlers.get(exportName);
        const marker = def.authorize?.__snapbackInlineHandlerMarker;
        if (!extracted || marker !== extracted.token) {
          err('SNAPBACK_INLINE_HANDLER_MARKER_INVALID', 'asset', `${exportName}: inline authorizer marker does not match its direct source expression`, { intent: exportName });
          continue;
        }
        const rendered = renderInlineOperation(exportName, extracted);
        for (const issue of scanUnsupportedHandlerSource(rendered.source, 'functions.mjs')) {
          err(issue.code, 'bundle', `${exportName}: ${issue.message}`, { intent: exportName, token: issue.token });
        }
        resolvedAuthorizer = {
          source: rendered.source,
          exportName,
          handlerForm: 'inline',
          inlineAst: extracted.ast,
          inlineHelpers: (extracted.helpers ?? []).map(
            ({ name: helperName, contentHash }) => ({ name: helperName, contentHash }),
          ),
          sourceSpan: extracted.sourceSpan,
        };
      } else {
        const loaded = loadHandlerSource(def.source, exportName);
        resolvedAuthorizer = {
          source: loaded?.source ?? '',
          exportName: def.exportName,
          handlerForm: 'module',
          sourceSpan: null,
          typescriptIdentity: loaded?.typescriptIdentity ?? null,
        };
      }
      const policyIdentity = {
        format: 'snapback.asset-intent-policy.v1',
        app: appId,
        intent: exportName,
        accept: {
          mediaTypes: [...def.accept.mediaTypes].sort(),
          maxBytes: def.accept.maxBytes,
        },
        delivery: def.delivery,
        access: def.access,
        // @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
        //   presence-only opt-in preserves every pre-feature policy preimage.
        ...(def.grants === true ? { grants: true } : {}),
        image: def.image ?? null,
        // Presence-only is deliberate: adding the sibling must not alter the
        // canonical preimage (and frozen hashes) of existing image intents.
        ...(def.video ? { video: def.video } : {}),
        // Spread-when-present keeps pre-existing intent policy hashes
        // unchanged for intents that declare no callbacks.
        ...(def.on ? { on: def.on } : {}),
        authRequirement: def.auth,
        argsContractHash: argsContractHash(def.args ?? {}),
      };
      // @ref LLP 0044#asset-intent-implementation-identity-the-helper-closure-joins-the-carrier-dated-decision-2026-08-03 —
      //   executable identity includes the same sorted reachable-helper
      //   content edges as an ordinary inline function. The asset identity
      //   domain remains v1 per the ruling; helper-free preimages stay exact.
      const inlineHelpers = resolvedAuthorizer.inlineAst !== undefined
        && Array.isArray(resolvedAuthorizer.inlineHelpers)
        && resolvedAuthorizer.inlineHelpers.length > 0
        ? [...resolvedAuthorizer.inlineHelpers]
          .sort((left, right) => (left.name < right.name ? -1 : 1))
        : null;
      const implementationIdentity = {
        format: 'snapback.asset-intent-implementation.v1',
        app: appId,
        intent: exportName,
        handler: resolvedAuthorizer.handlerForm === 'inline'
          ? {
              form: 'inline',
              canonicalAst: resolvedAuthorizer.inlineAst,
              ...(inlineHelpers
                ? {
                    helpers: inlineHelpers.map(
                      ({ name, contentHash }) => ({ name, contentHash }),
                    ),
                  }
                : {}),
            }
          : {
              form: 'module',
              sourceHash: `sha256:${sha256(resolvedAuthorizer.source)}`,
              export: resolvedAuthorizer.exportName,
              ...(resolvedAuthorizer.typescriptIdentity
                ? { typescript: resolvedAuthorizer.typescriptIdentity }
                : {}),
            },
        policy: policyIdentity,
        reads: [...(def.reads ?? [])].sort(),
      };
      assetUploadIntents.push({
        id: `${appId}:${exportName}`,
        name: exportName,
        exportedName: resolvedAuthorizer.exportName ?? exportName,
        argsContractHash: policyIdentity.argsContractHash,
        implementationHash: `sha256:${sha256(canonicalResultJson(implementationIdentity))}`,
        intentPolicyHash: `sha256:${sha256(canonicalResultJson(policyIdentity))}`,
        authRequirement: def.auth,
        accept: policyIdentity.accept,
        delivery: def.delivery,
        access: def.access,
        ...(def.grants === true ? { grants: true } : {}),
        ...(def.image ? { image: def.image } : {}),
        ...(def.video ? { video: def.video } : {}),
        ...(def.on ? { on: def.on } : {}),
        declaredReads: def.reads ?? [],
        runtime: {
          IbexModule: {
            source: resolvedAuthorizer.source,
            export: resolvedAuthorizer.exportName ?? exportName,
          },
        },
        handlerForm: resolvedAuthorizer.handlerForm,
        ...(resolvedAuthorizer.sourceSpan ? { sourceSpan: resolvedAuthorizer.sourceSpan } : {}),
      });
    }
    const declaredIntentNames = new Set(assetUploadDefs.map(({ exportName }) => exportName));
    for (const table of Object.values(tables)) {
      for (const tableField of table.fields) {
        const restriction = tableField.field_type?.AssetRef?.upload;
        if (restriction !== undefined && !declaredIntentNames.has(restriction)) {
          err('SNAPBACK_ASSET_INTENT_UNKNOWN', 'schema', `${table.name}.${tableField.name} restricts to undeclared upload intent ${restriction}`, {
            table: table.name,
            field: tableField.name,
            intent: restriction,
          });
        }
      }
    }
    // @ref LLP 0109#17-dated-amendment-seed-asset-fixtures-2026-07-31 —
    //   fixtures bind to declared intents at generation, and placeholders
    //   are admissible only on v.assetRef fields naming declared fixtures.
    if (seedAssetFixtures) {
      for (const fixture of seedAssetFixtures.fixtures) {
        const intent = assetUploadIntents.find((candidate) => candidate.name === fixture.upload);
        if (!intent) {
          err('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', 'seed', `fixture ${fixture.id} names undeclared upload intent ${fixture.upload}`, {});
          continue;
        }
        const admitted = (intent.accept?.mediaTypes ?? []).some((entry) =>
          entry === fixture.mediaType
          || (entry.endsWith('/*') && fixture.mediaType.startsWith(entry.slice(0, -1))));
        if (!admitted) {
          err('SNAPBACK_SEED_ASSET_FIXTURES_INVALID', 'seed', `fixture ${fixture.id} mediaType ${fixture.mediaType} is outside intent ${fixture.upload}'s accepted media types`, {});
        }
      }
    }
    if (seedArtifact) {
      for (const [tableName, rows] of Object.entries(seedArtifact.tables)) {
        for (const row of rows) {
          for (const [fieldName, value] of Object.entries(row)) {
            const placeholder = value !== null && typeof value === 'object' && !Array.isArray(value)
              && Object.keys(value).length === 1 && typeof value.$assetFixture === 'string'
              ? value.$assetFixture
              : null;
            if (placeholder === null) continue;
            const table = tables[tableName];
            const field = table?.fields?.find((candidate) => candidate.name === fieldName);
            if (!field?.field_type?.AssetRef) {
              err('SNAPBACK_SEED_ASSET_FIXTURE_PLACEMENT_INVALID', 'seed', `${tableName}.${fieldName} carries an $assetFixture placeholder but is not a v.assetRef field`, {});
              continue;
            }
            if (!seedAssetFixtures?.fixtures.some((fixture) => fixture.id === placeholder)) {
              err('SNAPBACK_SEED_ASSET_FIXTURE_UNKNOWN', 'seed', `${tableName}.${fieldName} references undeclared asset fixture ${placeholder}`, {});
            }
          }
        }
      }
    }
    // @ref LLP 0044#asset-read-authorization — the deployment warning lists
    //   every reachable table that confers no via-references authority; the
    //   enumeration covers restriction-less fields too, since handler-side
    //   attach can place any intent's asset in them.
    for (const intent of assetUploadIntents) {
      if (intent.access.read !== 'via-references') continue;
      const uncovered = [];
      for (const table of Object.values(tables)) {
        const reachable = table.fields.some((tableField) => {
          const assetRef = tableField.field_type?.AssetRef;
          return assetRef && (assetRef.upload === undefined || assetRef.upload === intent.name);
        });
        if (reachable && !table.assetSharing) uncovered.push(table.name);
      }
      if (uncovered.length > 0) {
        const warning = {
          code: 'SNAPBACK_ASSET_SHARING_UNDECLARED',
          severity: 'warning',
          subsystem: 'asset',
          message: `${intent.name}: via-references assets reachable from tables without an assetSharing declaration confer no read authority there (owner-only fallback): ${uncovered.sort().join(', ')}`,
          details: { intent: intent.name, tables: uncovered.sort() },
        };
        // Both surfaces deliberately: the generated manifest carries the
        // deployment warning durably; the codegen result surfaces it to the
        // invoking operator/agent.
        infoDiagnostics.push(warning);
        diagnostics.push(warning);
      }
    }
  }
  const mediaCommandBindings = installMediaCommandBindings({
    appId,
    commandDefs,
    functionsModule,
    functions: decoratedFunctionDefinitions,
    assetUploadIntents,
    assetCollections,
    attribution: functionDefinitionAttribution,
    err,
  });
  if (mediaCommandBindings.size > 0) {
    schemaRequiredCapabilities.push('assets.media-command.v1');
  }
  // Schema-level reference GC (LLP 0044 §Deletion): admitted only where the
  // target declares the asset_reference_gc_v1 facts, with the app's grace
  // inside the Enforced bounds; enabling it warns about the field classes
  // that confer no protection — only typed v.assetRef references do.
  let schemaAssetsPolicy;
  if (schemaDef.assets?.referenceGc) {
    const declaredGc = canonicalCapability.manifest?.assets?.referenceGc;
    const graceMs = schemaDef.assets.referenceGc.graceMs;
    if (!declaredGc) {
      err(
        'SNAPBACK_ASSET_REFERENCE_GC_UNSUPPORTED',
        'asset',
        `schema declares assets.referenceGc but target ${canonicalCapability.manifest?.targetProfileId ?? targetProfile} does not advertise asset_reference_gc_v1`,
        { targetProfile: canonicalCapability.manifest?.targetProfileId ?? targetProfile },
      );
    } else if (graceMs < declaredGc.graceMinMs || graceMs > declaredGc.graceMaxMs) {
      err(
        'SNAPBACK_ASSET_REFERENCE_GC_GRACE_INVALID',
        'asset',
        `assets.referenceGc.graceMs ${graceMs} is outside the target's Enforced bounds [${declaredGc.graceMinMs}, ${declaredGc.graceMaxMs}]`,
        { graceMs, graceMinMs: declaredGc.graceMinMs, graceMaxMs: declaredGc.graceMaxMs },
      );
    } else {
      schemaAssetsPolicy = { referenceGc: { graceMs } };
      const unprotectedJsonFields = [];
      let hasTypedAssetFields = false;
      for (const table of Object.values(tables)) {
        for (const tableField of table.fields) {
          if (tableField.field_type?.AssetRef) {
            hasTypedAssetFields = true;
          } else if (
            tableField.field_type === 'Json'
            || tableField.field_type?.Json !== undefined
          ) {
            unprotectedJsonFields.push(`${table.name}.${tableField.name}`);
          }
        }
      }
      if (unprotectedJsonFields.length > 0 || !hasTypedAssetFields) {
        const clauses = [];
        if (unprotectedJsonFields.length > 0) {
          clauses.push(`asset ids inside json fields confer no protection: ${unprotectedJsonFields.sort().join(', ')}`);
        }
        if (!hasTypedAssetFields) {
          clauses.push('no table declares a typed v.assetRef field, so nothing protects any ready asset from reclamation');
        }
        const warning = {
          code: 'SNAPBACK_ASSET_REFERENCE_GC_UNPROTECTED_FIELDS',
          severity: 'warning',
          subsystem: 'asset',
          message: `assets.referenceGc: only typed v.assetRef references protect an asset (LLP 0044 §Deletion); ${clauses.join('; ')}`,
          details: {
            jsonFields: unprotectedJsonFields.sort(),
            hasTypedAssetFields,
          },
        };
        infoDiagnostics.push(warning);
        diagnostics.push(warning);
      }
    }
  }

  // @ref LLP 0234#phase-g0--governance-substrate — generation validates the
  // complete current-tree governance closure without Git before any output is
  // published. Remote predecessor ordering is checked separately by the
  // synchronous admission comparator and protected observer.
  let visibilityGovernance = null;
  try {
    const governanceNow = testHooks?.visibilityGovernance?.now ?? Date.now();
    if (!Number.isFinite(governanceNow)) {
      throw new TypeError('testHooks.visibilityGovernance.now must be a finite trusted timestamp');
    }
    visibilityGovernance = validateVisibilityGovernance({
      backendRoot,
      schemaDef,
      tables,
      writeDisclosures: writePolicy.disclosures,
      now: governanceNow,
      targetObserverPin: testHooks?.visibilityGovernance?.targetObserverPin ?? null,
    });
    if (visibilityGovernance) {
      const generatedOperations = new Set(functions.map(({ name }) => name));
      for (const declaration of visibilityGovernance.visibilityOverrides) {
        for (const operation of declaration.operations) {
          if (!generatedOperations.has(operation)) {
            throw new VisibilityGovernanceError(
              'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
              `visibility override ${declaration.id} names unknown operation ${operation}`,
              { overrideId: declaration.id, operation },
            );
          }
        }
        if (declaration.authority.mode === 'system'
          && !generatedOperations.has(declaration.authority.entrypoint)) {
          throw new VisibilityGovernanceError(
            'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
            `system visibility override ${declaration.id} names unknown entrypoint ${declaration.authority.entrypoint}`,
            { overrideId: declaration.id, entrypoint: declaration.authority.entrypoint },
          );
        }
      }
    }
    if (visibilityGovernance) diagnostics.push(...visibilityGovernance.warnings);
  } catch (error) {
    err(
      error.code ?? 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'auth',
      error.message,
      error.details ?? {},
    );
    return { ok: false, diagnostics };
  }
  refuseGeneratedIdentityBindingWriters(
    identityBindingTables,
    decoratedFunctionDefinitions,
    projections,
    parsedSeed,
    err,
  );

  const requiredTargetCapabilities = new Set(schemaRequiredCapabilities);
  for (const fn of decoratedFunctionDefinitions) {
    for (const capability of fn.requiredCapabilities) requiredTargetCapabilities.add(capability);
  }
  for (const job of cronJobs) {
    for (const capability of job.requiredCapabilities) requiredTargetCapabilities.add(capability);
  }
  if ((routesModule?.routes ?? []).some((route) => (
    routeMixedGroupEligible(route.queries ?? [], functionsModule)
  ))) {
    requiredTargetCapabilities.add('mixed_bundle_boot_v2');
  }
  validateTargetArtifactAuthSupport(
    canonicalCapability.manifest,
    artifactVersion,
    authMode,
    [...requiredTargetCapabilities],
    err,
  );
  const remoteServiceInputs = loadRemoteServiceInputs(backendRoot, appId, targetProfile, err);
  // Compile the optional route→query manifest (LLP 0092 §0C.1) against the
  // authored functions: unknown/non-query functions, pattern grammar,
  // overlap, `params-v1` mapping rules, per-reference arg-schema typing, and
  // required-arg coverage all refuse at compile time — the same rules the
  // served instance re-enforces at ensure.
  const routesManifest = routesModule
    ? compileRoutesManifest(routesModule, functionsModule, appId, err)
    : null;
  if (routesManifest !== null) {
    for (const routeEntry of routesManifest.routes) {
      if (routeEntry.mixedGroupEligible === true) {
        routeEntry.mixedProfile = mixedRouteIdentityV2(
          routeEntry,
          decoratedFunctionDefinitions,
        );
      }
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  // Hash inputs use the MANIFEST-RELATIVE handler path (LLP 0034 review fix
  // 4): keying by absolute path baked the checkout location into inputsHash /
  // bundleHash, so committed artifacts only reproduced from the checkout that
  // generated them.
  const handlerInputs = [];
  const handlerTypeScriptExecutableInputs = [];
  for (const [sourcePath, entry] of [...handlerSourceCache.entries()].sort(([a], [b]) => compareCodeUnits(a, b))) {
    handlerInputs.push(sourcePath, entry.bytes);
    if (entry.typescriptIdentity) {
      // @ref LLP 0246#d5-identity-binds-source-profile-and-output — authored
      // bytes remain the evidence input above; executable identity also binds
      // the closed profile/toolchain and the exact JavaScript Hermes receives.
      handlerTypeScriptExecutableInputs.push(
        sourcePath,
        entry.typescriptIdentity.sourceProfile,
        entry.typescriptIdentity.transformVersion,
        entry.typescriptIdentity.compilerVersion,
        entry.typescriptIdentity.compilerIntegrity,
        entry.runtimeBytes,
      );
    }
  }
  const schemaGraphInputs = moduleGraphIdentity(schemaGraph, backendRoot);
  const functionsGraphInputs = moduleGraphIdentity(functionsGraph, backendRoot);
  // Path/source pairs prove which bytes were admitted. Canonical isolated
  // values prove what those bytes meant under the current AST transformer and
  // evaluator. Binding both closes the case where a toolchain semantic change
  // emits different definitions from identical source under an old hash.
  const schemaEvaluation = stableJson(schemaDef);
  const functionsEvaluation = stableJson(functionsModule);
  const isolatedEvaluationSuffix = testHooks?.identity?.isolatedEvaluationSuffix ?? '';
  if (typeof isolatedEvaluationSuffix !== 'string') {
    throw new TypeError('testHooks.identity.isolatedEvaluationSuffix must be a string');
  }
  const schemaEvaluationIdentity = `${schemaEvaluation}${isolatedEvaluationSuffix}`;
  const functionsEvaluationIdentity = `${functionsEvaluation}${isolatedEvaluationSuffix}`;
  const routesEvaluationIdentity = routesBuild
    ? `${stableJson(routesModule)}${isolatedEvaluationSuffix}`
    : null;
  const routesGraphInputs = routesBuild ? moduleGraphIdentity(routesBuild.graph, backendRoot) : null;
  const inputs = [
    'schema-graph',
    ...schemaGraphInputs,
    'schema-isolated-evaluation',
    schemaEvaluationIdentity,
    'functions-graph',
    ...functionsGraphInputs,
    'functions-isolated-evaluation',
    functionsEvaluationIdentity,
    // Routes participate in the staleness marker only (never in schemaHash /
    // bundleHash — the manifest has its own canonical routeManifestHash
    // identity, LLP 0091 §0A.6); apps without routes.mjs hash identically to
    // before the artifact existed.
    ...(routesGraphInputs === null
      ? []
      : ['routes-graph', ...routesGraphInputs, 'routes-isolated-evaluation', routesEvaluationIdentity]),
    ...(seedSource === null ? [] : [seedSource]),
    ...(demoMetadata.source === null ? [] : [demoMetadata.source]),
    ...(codegenPolicy.source === null ? [] : [codegenPolicy.source]),
    contractCapabilitiesSource,
    canonicalCapability.source,
    ...(remoteServiceInputs?.identityInputs ?? []),
    ...(visibilityGovernance
      ? ['visibility-governance-inputs', visibilityGovernance.generationInputsHash]
      : []),
    ...handlerInputs,
    ...handlerTypeScriptExecutableInputs,
  ];
  // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
  // — this separate identity covers only the existing authored byte items;
  // toolchain module labels preserve graph participation, but their bytes,
  // isolated-evaluation, and artifact-schema framing remain generation-only.
  const authoredSourceItems = [
    ...authoredModuleGraphIdentity(schemaGraph, backendRoot),
    ...authoredModuleGraphIdentity(functionsGraph, backendRoot),
    ...(routesBuild ? authoredModuleGraphIdentity(routesBuild.graph, backendRoot) : []),
    ...(seedSource === null ? [] : [seedSource]),
    ...(demoMetadata.source === null ? [] : [demoMetadata.source]),
    ...(codegenPolicy.source === null ? [] : [codegenPolicy.source]),
    contractCapabilitiesSource,
    ...handlerInputs,
  ];
  // @ref LLP 0010#generated-artifacts — every identity item is framed
  // independently. A sentinel delimiter is insufficient because JavaScript
  // and handler source may legally contain that byte: an author could otherwise
  // move `\0<next path>\0` between two
  // adjacent sources and preserve the hash while changing the emitted bundle.
  // Distinct domains also prevent the three identity contracts from becoming
  // interchangeable when their framed item sequences happen to match.
  const schemaContentItems = [
    ...schemaGraphInputs,
    'schema-isolated-evaluation',
    schemaEvaluationIdentity,
  ];
  const bundleContentItems = [
    ...functionsGraphInputs,
    'functions-isolated-evaluation',
    functionsEvaluationIdentity,
    ...handlerInputs,
    ...handlerTypeScriptExecutableInputs,
  ];
  const generatedAt = generatedAtMillis();
  const appIdentity = demoMetadata.identity;
  const { inputsHash, schemaHash, bundleHash, authoredSourceHash } = computeArtifactIdentityStrings({
    artifactVersion,
    authMode,
    appId,
    sharedInputItems: inputs,
    schemaContentItems,
    bundleContentItems,
    authoredSourceItems,
  });
  // @ref LLP 0093#mutation-wire-artifact-identity-amendment--2026-08-10 —
  // generated references, rather than a server handshake echo, are the
  // mutation client's proof of the build-time artifact generation.
  const expectedGeneration = {
    schemaVersion: artifactVersion,
    appId,
    schemaHash,
    bundleHash,
    inputsHash,
  };
  const trustedActivationPath = join(backendRoot, TRUSTED_COMPOSITION_ACTIVATION_FILE);
  let trustedCompositionActivation = null;
  let activationGenerationAdvanced = null;
  if (existsSync(trustedActivationPath)) {
    try {
      const capability = resolveFileReadCapability(trustedActivationPath, {
        allowedRoots: [backendRoot],
        codePrefix: 'TRUSTED_COMPOSITION_ACTIVATION',
      });
      const candidate = JSON.parse(capability.read().toString('utf8'));
      trustedCompositionActivation = validateTrustedCompositionActivationV1(candidate, {
        expectedGeneration,
        authoredSourceHash,
        targetProfileId: targetProfile,
        authMode,
      });
      if (candidate.activation.format === 'snapback.composition-activation.v2'
        && canonicalResultJson(candidate.activation.mintedGeneration) !== canonicalResultJson(expectedGeneration)) {
        activationGenerationAdvanced = {
          minted: candidate.activation.mintedGeneration,
          current: expectedGeneration,
          at: generatedAt,
        };
      }
    } catch (error) {
      err(
        'TRUSTED_COMPOSITION_ACTIVATION_INVALID',
        'composition',
        `${TRUSTED_COMPOSITION_ACTIVATION_FILE} is invalid: ${error.message}`,
        { path: trustedActivationPath },
      );
      return { ok: false, diagnostics };
    }
  }
  const compiledAuthProgram = schemaDef.authProgram === undefined
    ? undefined
    : (() => {
      const program = schemaDef.authProgram;
      if (program.abuseBudgets === undefined) return program;
      const policy = {
        version: program.abuseBudgets.version,
        preset: program.abuseBudgets.preset,
        budgets: program.abuseBudgets.budgets,
        effectBindings: program.abuseBudgets.effectBindings,
      };
      return {
        ...program,
        abuseBudgets: {
          ...policy,
          policyDigest: compositionDomainHash('snapback.auth-abuse-budget-policy.v1', policy),
        },
      };
    })();
  const schemaManifest = {
    artifactKind: 'schemaManifest',
    schemaVersion: artifactVersion,
    appId,
    // @ref LLP 0253#s12-identity-no-fleet-wide-rotation — manifests retain
    // the resolved source-profile custody fact even for explicit-v1; the
    // semantic preimage below applies the separate default-omission rule.
    authoringProfile,
    ...(appIdentity ? { app: appIdentity } : {}),
    ...(schemaDef.auth !== undefined ? { auth: schemaDef.auth } : {}),
    ...(compiledAuthProgram !== undefined ? { authProgram: compiledAuthProgram } : {}),
    ...(authProgramReadiness ? { authProgramReadiness } : {}),
    ...(apiManifest ? { api: apiManifest } : {}),
    ...(schemaAssetsPolicy ? { assets: schemaAssetsPolicy } : {}),
    ...(schemaDef.pushSeam ? { pushSeam: schemaDef.pushSeam } : {}),
    ...(visibilityGovernance ? { visibilityGovernance: visibilityGovernance.activation } : {}),
    // @ref LLP 0146#d1-declarationobservation-conformance — the per-app
    // strict-declaration opt-in rides the schema manifest so the serving
    // runtime enforces exactly what the author declared.
    ...(schemaDef.strictDeclarations === true ? { strictDeclarations: true } : {}),
    ...(schemaRequiredCapabilities.length > 0
      ? { requiredCapabilities: schemaRequiredCapabilities }
      : {}),
    ...(identityBindingTables.length > 0 ? { identityBindingTables } : {}),
    schemaHash,
    inputsHash,
    authoredSourceHash,
    generatedAt,
    targetProfile,
    portabilityFlags: [],
    artifactDiagnostics: [
      ...(agentRegistrationWarning ? [agentRegistrationWarning] : []),
      ...diagnostics.filter(({ code }) => code === 'SNAPBACK_API_PAGINATION_RECOMMENDED'),
    ],
    ephemeralCollections,
    ...(assetCollections.length > 0 ? { assetCollections } : {}),
    tables: Object.values(tables).map((table) => {
      const { frameworkOwned: _frameworkOwned, ...manifestTable } = table;
      return manifestTable;
    }),
  };
  // @ref LLP 0058#capability-maturity — the artifact pair's experimental
  // acknowledgments: exactly the experimental ids this pair requires
  // (functions, cron, and schema-level requirements — schema and functions
  // are one generated unit). Emitting them is truthful because the same
  // closed table derived the requirements; admission still refuses any
  // requirement the served instance does not positively support.
  const acknowledgedExperimentalCapabilities = [...new Set(
    [
      ...decoratedFunctionDefinitions.flatMap((fn) => fn.requiredCapabilities ?? []),
      ...cronJobs.flatMap((job) => job.requiredCapabilities ?? []),
      ...schemaRequiredCapabilities,
    ].filter((capability) => EXPERIMENTAL_TARGET_CAPABILITY_IDS.has(capability)),
  )].sort();
  const functionManifest = {
    artifactKind: 'functionManifest',
    schemaVersion: artifactVersion,
    appId,
    authoringProfile,
    bundleHash,
    inputsHash,
    authoredSourceHash,
    generatedAt,
    unsupportedDependencyDiagnostics: infoDiagnostics,
    ...(acknowledgedExperimentalCapabilities.length > 0
      ? { acknowledgedExperimentalCapabilities }
      : {}),
    functions: decoratedFunctionDefinitions,
    cronJobs,
    config: configEntries,
    ...(projections.length > 0 ? { projections } : {}),
    ...(assetUploadIntents.length > 0 ? { assetUploadIntents } : {}),
  };
  const applicationAuthBootstrap = deriveApplicationAuthBootstrapV1({
    appId,
    authMode,
    authoringProfile,
    authProgram: schemaDef.authProgram,
    functions: functionManifest.functions,
    tables,
    err,
  });
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const handlerRuntimeProfile = buildHandlerRuntimeProfile({
    appId,
    inputsHash,
    authoredSourceHash,
    targetProfile,
    functions: functionManifest.functions,
    sourceFunctions: functions,
    graphRecords: [...inlineExtraction.handlers.values()].map(
      ({ graphRecord }) => graphRecord,
    ),
    outboundActions: egressAllowedAtCodegen(),
  });
  // Server-declared, never authored here (LLP 0032 P2 / LLP 0037): the
  // selected committed schemas/ instance is generated from the Rust core's
  // target declaration, drift-gated by tests/capability_v0.rs, and embedded
  // verbatim.
  const capabilityManifest = canonicalCapability.manifest;
  const dataIdentity = trustedCompositionActivation?.activation?.databaseId
    ? {
        kind: 'trusted-composition-database',
        databaseId: trustedCompositionActivation.activation.databaseId,
        deploymentId: trustedCompositionActivation.activation.deploymentId,
      }
    : {
        kind: 'unbound-codegen-data-contract',
        schemaHash,
      };
  // @ref LLP 0241#d1-split-identity-by-what-changed — Rollout 1 computes the
  // additive semantic/executable/evidence roots from explicit closed input
  // projections while leaving every legacy hash preimage untouched.
  // @ref LLP 0237#d4-runtime-and-implementation-identity — the S2 normalized
  // graph records (targets + topology, without spans/raw evidence) are direct
  // semantic and executable inputs; codegen does not infer body equivalence.
  const generationIdentityInputs = buildSemanticGenerationInputs({
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
    sourceSpans: functionDefinitionSourceSpans,
    schemaFieldSpans: schemaPropertySourceSpans,
    generationLog: {
      generatedAt,
      diagnostics: [...diagnostics, ...infoDiagnostics]
        .map(({ code, severity }) => ({ code, severity }))
        .sort((left, right) => compareCodeUnits(left.code, right.code)),
    },
    authoringProfile,
    applicationAuthBootstrap,
  });
  const normalizedDefinition = buildNormalizedApplicationDefinitionV1({
    schemaManifest,
    functionManifest,
    routesManifest,
  });
  const generationContentIdentities = {
    ...computeGenerationContentIdentities(generationIdentityInputs),
    normalizedContractId: normalizedDefinition.normalizedContractId,
    normalizedSchemaId: normalizedDefinition.normalizedSchemaId,
  };
  // Exact LLP 0329 E-B: IR-tier mutations embed their plan, so the adapter
  // can derive default optimistic overlays from the generated artifact alone
  // — the flags below claim exactly that and nothing more.
  const contractMutationCapabilities = contractCapabilitiesForMutations(contractMutations);
  const hasDerivedOverlayMutations = contractMutationCapabilities.derivedOptimisticOverlays;
  const allMutationsReplayable = contractMutationCapabilities.offlineReplay;
  // Keep the pre-introspection projection during the migration as an
  // independent emit-both witness. The neutral producer below must reproduce
  // this Exact-owned consumer document exactly or codegen fails before writing.
  const legacyContractManifest = {
    artifactKind: 'contractDataManifest',
    // Contract consumes the same schema/function pair as the server. Session
    // artifacts therefore carry v1 here too; pinning this adjacent artifact
    // to v0 makes the adapter correctly reject an otherwise coherent build.
    schemaVersion: artifactVersion,
    // v2 (LLP 0034 D3): additive per-descriptor liveness/cost facts per Exact
    // LLP 0284 §2.4. Old fields remain valid inputs; unknown new fields are
    // ignored by old consumers.
    manifestVersion: CONTRACT_DATA_MANIFEST_VERSION,
    provider: 'snapback',
    inputsHash,
    schemaHash,
    bundleHash,
    authoredSourceHash,
    capabilities: {
      localReplica: false,
      subscriptions: true,
      initialSnapshot: true,
      // True exactly when some mutation carries a derivable IR plan: the
      // adapter's generated default overlay backs the claim (LLP 0329 §E5).
      optimisticMutations: hasDerivedOverlayMutations,
      // LLP 0051 D6: the same closed IR plans now drive both the derived
      // overlay and the D1-ledgered durable client queue. A manifest with no
      // IR mutation cannot claim offline replay.
      derivedOptimisticOverlays: hasDerivedOverlayMutations,
      offlineReplay: allMutationsReplayable,
      rowSyncState: true,
      serverRunnableQueries: true,
      forceStates: true,
      branchableFixtures: false,
      headlessBoot: true,
    },
    // Shared with the adapter that exposes the kit's mutation/subscription
    // receipt ring. This must never drift back to a generator-only default.
    receipts: SNAPBACK_CONTRACT_RECEIPT_CAPABILITY,
    queries: contractQueries,
    mutations: contractMutations,
    ephemeral: contractEphemeralSection(ephemeralCollections),
  };
  for (const [name, binding] of Object.entries(contractQueries)) {
    // Migration cross-check (0284 §2.4): fail loudly, write nothing, if the
    // legacy `subscription` field and the v2 liveness fields ever disagree.
    diagnostics.push(...crossCheckContractQueryBinding(name, binding));
  }

  // @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop
  //   — Snapback is the first deterministic producer of the neutral provider
  //   declaration; ContractDataManifest is a validated projection, not the
  //   provider-native source.
  const introspectionSource = {
    queries: contractQueries,
    mutations: contractMutations,
    actions: contractActions,
    ephemeral: legacyContractManifest.ephemeral,
  };
  diagnostics.push(...validateSnapbackIntrospectionSource(introspectionSource));
  const providerIntrospection = createSnapbackProviderIntrospection({
    artifactVersion,
    inputsHash,
    schemaHash,
    bundleHash,
    authoredSourceHash,
    capabilities: legacyContractManifest.capabilities,
    receipts: legacyContractManifest.receipts,
    ...introspectionSource,
  });
  diagnostics.push(...validateProviderIntrospection(providerIntrospection));
  diagnostics.push(...validateContractDataManifestProjection(
    providerIntrospection,
    legacyContractManifest,
  ));
  const providerBindingResult = createProviderBindingMetadata(providerIntrospection);
  diagnostics.push(...providerBindingResult.diagnostics);
  const providerBindingMetadata = providerBindingResult.metadata;
  const contractManifest = projectContractDataManifest(providerIntrospection);

  // DK-7 (LLP 0037): validate the Snapback-owned artifacts against the committed
  // Rust-derived schemas before writing. Fail closed (write nothing) on any
  // mismatch. The Exact-owned contract-data manifest is out of scope (scope fence).
  for (const [schemaFile, instance, expected] of [
    ['schema.manifest.schema.json', schemaManifest, { artifactKind: 'schemaManifest', schemaVersion: artifactVersion }],
    ['functions.manifest.schema.json', functionManifest, { artifactKind: 'functionManifest', schemaVersion: artifactVersion }],
    ['normalized-definition.v1.schema.json', normalizedDefinition, { schemaVersion: NORMALIZED_DEFINITION_SCHEMA_VERSION }],
    ['capability.manifest.schema.json', capabilityManifest, { artifactKind: 'capabilityManifest', schemaVersion: SCHEMA_VERSION }],
    ...(routesManifest ? [['routes.manifest.schema.json', routesManifest, {}]] : []),
  ]) {
    const { missing, problems } = validateArtifactAgainstSchema(schemaFile, instance, expected);
    if (missing) {
      err('CODEGEN_ARTIFACT_SCHEMA_MISSING', 'codegen',
        `cannot validate ${instance.artifactKind} against committed schema: ${missing}`,
        { artifact: instance.artifactKind, schema: `schemas/${schemaFile}` });
    } else if (problems.length > 0) {
      err('CODEGEN_ARTIFACT_SCHEMA_INVALID', 'codegen',
        `${instance.artifactKind} does not match committed schemas/${schemaFile}: ${problems.join('; ')}`,
        { artifact: instance.artifactKind, schema: `schemas/${schemaFile}`, problems });
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const outDir = join(backendRoot, targetConfig.outputDirectory);
  // DK-7 for the asset reference DTO: every emitted upload reference must
  // match the committed Rust-owned schema exactly (LLP 0037 dated alignment).
  for (const reference of renderAssetUploadReferences(appId, assetUploadIntents, functionsModule)) {
    const { missing, problems } = validateArtifactAgainstSchema(
      'asset.upload-reference.schema.json',
      reference,
      { artifactKind: 'assetUploadReference', schemaVersion: SCHEMA_VERSION },
    );
    if (missing) {
      err('CODEGEN_ARTIFACT_SCHEMA_MISSING', 'codegen',
        `cannot validate assetUploadReference against committed schema: ${missing}`,
        { artifact: 'assetUploadReference', schema: 'schemas/asset.upload-reference.schema.json' });
    } else if (problems.length > 0) {
      err('CODEGEN_ARTIFACT_SCHEMA_INVALID', 'codegen',
        `assetUploadReference ${reference.name} does not match committed schemas/asset.upload-reference.schema.json: ${problems.join('; ')}`,
        { artifact: 'assetUploadReference', intent: reference.name, problems });
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const functionSourceSpans = exportedDefinitionSourceSpans(
    graphEntrySource(functionsGraph, functionsPath),
  );
  const generatedReferences = buildGeneratedReferences(
    appId,
    functionManifest.functions,
    functionsModule,
    schemaManifest,
    ephemeralCollections,
    routesManifest,
    assetUploadIntents,
    { schemaVersion: artifactVersion, appId, schemaHash, bundleHash, inputsHash },
    authoredSourceHash,
    functionDefinitionSourceSpans,
  );
  const generatedCommands = buildGeneratedCommands({
    commandDefs,
    functionsModule,
    functions: functionManifest.functions,
    generatedReferences,
    err,
  });
  for (const functionName of new Set(
    [...mediaCommandBindings.values()].map((binding) => binding.targetMutation.name),
  )) {
    delete generatedReferences.api.mutations[functionName];
  }
  let clientLifecycleManifest;
  try {
    clientLifecycleManifest = buildClientLifecycleManifest({
      appId,
      inputsHash,
      authoredSourceHash,
      targetProfile,
      functions: functionManifest.functions,
      commands: generatedCommands,
      // @ref LLP 0247#d5-generated-lifecycle-metadata-owns-normalization-and-failure-tables
      // — extend LLP 0238's one lifecycle manifest instead of publishing a
      // competing normalization/failure table.
      ordinaryRows: buildOrdinaryClientLifecycleRows({
        functions: functionManifest.functions,
        ephemeralCollections,
      }),
      applicationAuth: {
        authProgram: schemaDef.authProgram,
        applicationAuthBootstrap,
        authProgramFields: AUTH_PROGRAM_FIELDS,
        mechanismKinds: AUTH_PROGRAM_MECHANISM_KINDS,
        entryMechanisms: APPLICATION_AUTH_BOOTSTRAP_ENTRY_MECHANISMS,
        platformKinds: APPLICATION_AUTH_PLATFORM_KINDS,
        authoringProfiles: [EXPLICIT_AUTHORING_PROFILE, FAMILIAR_AUTHORING_PROFILE],
        authoringProfile,
        familiarDispositions: FAMILIAR_DISPOSITIONS.authProgramFields,
      },
    });
  } catch (error) {
    err(
      error?.code ?? 'SNAPBACK_AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED',
      'auth',
      error.message,
      error?.details ?? {},
    );
    return { ok: false, diagnostics };
  }
  const generatedSurfaces = buildGeneratedSurfaces({
    appId,
    surfaceDefs,
    functionsModule,
    schemaDef,
    generatedReferences,
    generatedCommands,
    functionSourceSpans,
    err,
  });
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const appDescriptor = createAppDescriptorV1({
    app: appId,
    authoringProfile,
    schema: schemaHash,
    functions: bundleHash,
    authBootstrap: applicationAuthBootstrap,
    api: generatedReferences.api,
    commands: generatedCommands,
    surfaces: generatedSurfaces,
    // `auth.application-bootstrap.v1` is a client-package closure fact, not a
    // runtime target capability. It therefore joins the portable application
    // requirements only after target-artifact admission has checked the
    // runtime-owned set above. Older generated descriptors intentionally lack
    // this second opt-in fact and retain the legacy Expo provider path.
    requiredCapabilities: [
      ...requiredTargetCapabilities,
      ...(applicationAuthBootstrap == null
        ? []
        : [APPLICATION_AUTH_BOOTSTRAP_CAPABILITY]),
    ],
  });
  // @ref LLP 0178#integration-with-the-descriptor-spine — descriptor
  // validation joins the existing unsuppressible lane before any generated
  // graph is published, preserving the prior complete output on refusal.
  for (const problem of validateAppDescriptorV1(appDescriptor)) {
    err(problem.code, 'app-descriptor', problem.message, {
      path: problem.path,
      details: problem.details,
    });
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const appDescriptorSource = serializeAppDescriptorV1(appDescriptor);
  const hostedDevelopmentAdmissions = codegenPolicy.hostedDevelopmentTargets.map((entry) => ({
    target: {
      app: appDescriptor.identity.app,
      schema: appDescriptor.identity.schema,
      functions: appDescriptor.identity.functions,
      origin: entry.origin,
      routing: 'https',
    },
    hostedTargetReceipt: entry.hostedTargetReceipt,
  }));
  const appBindingIdentity = compositionDomainHash('snapback:app-binding:v1:', {
    descriptor: appDescriptor.identity.descriptor,
    artifacts: { trustedCompositionActivation },
    ...(hostedDevelopmentAdmissions.length === 0 ? {} : { hostedDevelopmentAdmissions }),
  });
  const contentAddressedDescriptorFile = contentAddressedArtifactPath(
    'app.descriptor.json',
    appDescriptor.identity.descriptor,
  );
  const contentAddressedAppBindingFile = contentAddressedArtifactPath(
    'app.binding.mjs',
    appBindingIdentity,
  );
  const contentAddressedAppBindingModule = renderAppBindingModule(
    functionManifest.functions,
    appDescriptor.identity.descriptor,
    trustedCompositionActivation,
    hostedDevelopmentAdmissions,
  );
  const appBindingModule = renderAppBindingAlias(
    functionManifest.functions,
    appBindingIdentity,
  );
  const appModule = renderAppModule(
    functionManifest.functions,
    appBindingIdentity,
  );
  const appTypes = renderAppTypes(
    functionManifest.functions,
    assetUploadIntents,
    generatedCommands,
    generatedSurfaces,
    clientLifecycleManifest,
    authoringProfile,
    applicationAuthBootstrap,
  );
  const canonicalApiModule = renderApiModule(
    functionManifest.functions,
    generatedReferences.actions,
    generatedReferences.defaultAssetNames,
    appBindingIdentity,
    [...authorityProfiles.keys()].sort(compareCodeUnits),
  );
  const familiarOperationNames = [
    ...functionManifest.functions.map(({ name }) => name),
    ...assetUploadIntents.map(({ name }) => name).filter(isOperationName),
  ];
  const apiFlatModule = null;
  const apiModule = authoringProfile === FAMILIAR_AUTHORING_PROFILE
    ? renderFamiliarApiNamespaceModule(
        familiarOperationNames,
        generatedReferences.actions,
        generatedReferences.defaultAssetNames,
        appBindingIdentity,
      )
    : canonicalApiModule;
  const familiarServerModule = authoringProfile === FAMILIAR_AUTHORING_PROFILE
    ? renderFamiliarServerModule()
    : null;
  const familiarServerTypes = authoringProfile === FAMILIAR_AUTHORING_PROFILE
    ? renderFamiliarServerTypes()
    : null;
  const apiTypes = renderApiTypes(
    functionManifest.functions,
    functionsModule,
    ephemeralCollections,
    schemaDef,
    providerBindingMetadata,
    routesManifest,
    assetUploadIntents,
    capabilityManifest,
    clientLifecycleManifest,
    authoringProfile,
    [...authorityProfiles.keys()].sort(compareCodeUnits),
  );
  const microArtifacts = buildMicroArtifacts({
    backendRoot,
    targetProfile,
    capabilityManifest,
    functionManifest,
    functionsModule,
    schemaDef,
    expectedGeneration: {
      schemaVersion: artifactVersion,
      appId,
      schemaHash,
      bundleHash,
      inputsHash,
    },
    authoredSourceHash,
    err,
  });
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const providerBindingTypes = renderProviderBindingTypes(providerBindingMetadata);
  for (const [sourcePath, entry] of handlerSourceCache) {
    if (!entry.typescriptIdentity) continue;
    const typeDiagnostics = typecheckTypeScriptHandler({
      source: entry.authoredSource,
      sourcePath,
      // Rollout 2 is deliberately single-file, but it checks in the same
      // lib-bearing program as the declarations generated for this candidate.
      // Application tsconfig files never enter this program.
      declarations: {
        '/__snapback_generated_app.d.ts': appTypes,
        '/__snapback_generated_api.d.ts': apiTypes,
        '/__snapback_generated_provider_bindings.d.ts': providerBindingTypes,
      },
    });
    for (const issue of typeDiagnostics) {
      const functions = [...entry.functions].sort(compareCodeUnits);
      err(issue.code, 'bundle', `${functions.join(', ')}: ${issue.message}`, {
        ...(functions.length === 1 ? { function: functions[0] } : { functions }),
        source: sourcePath,
        sourceSpan: {
          file: sourcePath,
          line: issue.line,
          column: issue.column,
        },
        details: issue.details,
      });
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const renderedContractModules = renderContractModules(
    contractManifest,
    functionManifest.functions,
    functionsModule,
    ephemeralCollections,
    schemaDef,
  );
  // @ref LLP 0021#implementation-note--exact-dependent-generated-metadata-is-opt-in-2026-08-11
  // — the committed codegen policy, never installed-package presence, selects
  // whether Exact-importing sidecars join the default Contract-neutral set.
  // Classify the emitted source itself because neutral and dependent modules
  // deliberately share generated/contract/.
  const contractModules = codegenPolicy.contractMetadata === 'exact'
    ? renderedContractModules
    : renderedContractModules.filter(({ source }) => !importsExactPackage(source));
  const operationSchemas = renderOperationSchemas(appId, functionManifest.functions, functionsModule);
  // @ref LLP 0204#d1--the-exposure-declaration-keystone — codegen filters
  // both operation schemas and declaration bindings from the same compiled
  // fact the server uses for its public function projection.
  const envelopeFunctionManifest = apiManifest?.enabled === true
    && apiManifest.disclosure === 'exposed-only'
    ? {
        ...functionManifest,
        functions: functionManifest.functions.filter((fn) => fn.apiExposure?.expose === true),
      }
    : functionManifest;
  const apiEnvelopeMembers = buildApiEnvelopeMembers(
    envelopeFunctionManifest,
    operationSchemas,
    clientLifecycleManifest,
    authoringProfile,
  );
  validateContractModuleFilenames(contractModules, err);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const remoteServicePublication = remoteServiceInputs
    ? buildRemoteServicePublication({
        outDir,
        publicationRoot: applicationRepositoryRoot(backendRoot),
        appId,
        targetProfile,
        schemaManifest,
        functionManifest,
        capabilityManifest,
        operationSchemas,
        inputs: remoteServiceInputs,
        err,
      })
    : null;
  for (const artifact of remoteServicePublication?.artifacts ?? []) {
    const { missing, problems } = validateArtifactAgainstSchema(
      artifact.schemaFile,
      artifact.value,
      { artifactKind: artifact.value.artifactKind, schemaVersion: SCHEMA_VERSION },
    );
    if (missing) {
      err('CODEGEN_ARTIFACT_SCHEMA_MISSING', 'codegen',
        `cannot validate ${artifact.value.artifactKind} against committed schema: ${missing}`,
        { artifact: artifact.value.artifactKind, schema: `schemas/${artifact.schemaFile}` });
    } else if (problems.length > 0) {
      err('CODEGEN_ARTIFACT_SCHEMA_INVALID', 'codegen',
        `${artifact.value.artifactKind} does not match committed schemas/${artifact.schemaFile}: ${problems.join('; ')}`,
        { artifact: artifact.value.artifactKind, schema: `schemas/${artifact.schemaFile}`, problems });
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const packageJson = {
    type: 'module',
    exports: {
      '.': {
        types: './api.d.ts',
        import: './api.mjs',
      },
      ...(authoringProfile === FAMILIAR_AUTHORING_PROFILE ? {
        './server': {
          types: './server.d.ts',
          import: './server.mjs',
        },
      } : {}),
      './app': {
        types: './app.d.ts',
        import: './app.mjs',
      },
      './app-descriptor': './app.descriptor.json',
      './schema': './schema.manifest.json',
      './functions': './functions.manifest.json',
      './normalized-definition': './normalized-definition.v1.json',
      './handler-runtime-profile': './handler-runtime-profile.v1.json',
      './capabilities': './capability.manifest.json',
      // Both lifecycle filenames are emitted during the LLP 0238/0247
      // compatibility window; the ordinary-TS package path names the shared
      // manifest bytes.
      './client-lifecycle': './client-lifecycle.manifest.json',
      ...(trustedCompositionActivation
        ? { './trusted-composition-activation': `./${TRUSTED_COMPOSITION_ACTIVATION_FILE}` }
        : {}),
      './provider-introspection': './provider-introspection.json',
      './provider-bindings': {
        types: './provider-bindings.d.ts',
        default: './provider-bindings.json',
      },
      ...(routesManifest ? { './routes': './routes.manifest.json' } : {}),
      ...(seedArtifact ? { './seed': './seed.artifact.json' } : {}),
      ...(seedAssetFixtures ? { './seed-assets': './seed.asset-fixtures.artifact.json' } : {}),
      './operations/*': './operations/*',
      './contract/*': './contract/*',
      ...(remoteServicePublication ? {
        './remote-service-profile': './remote-service.profile.json',
        './remote-auth-capability': './remote-auth-capability.manifest.json',
        './remote-data-capability': './remote-data-capability.manifest.json',
      } : {}),
      ...(microArtifacts ? {
        './micro': {
          types: './micro.d.ts',
          import: './micro.mjs',
        },
        './micro-profile': './micro.profile.json',
      } : {}),
    },
  };
  const contractArtifactFiles = contractModules.map((module) => `contract/${module.file}`);
  const operationArtifactFiles = operationSchemas.map((schema) => `operations/${schema.file}`);
  const remoteServiceArtifactFiles = remoteServicePublication?.artifacts.map((artifact) => artifact.file) ?? [];
  const governanceArtifactFiles = [
    'elevated-read-site-baseline.json',
    ...(visibilityGovernance
      ? [
          'visibility-override-owner-baseline.json',
          'visibility-override-baseline.json',
          'table-visibility-policy-baseline.json',
          'table-visibility-policy-transition-ledger.json',
          'visibility-governance-quarantine-ledger.json',
        ]
      : []),
  ];
  const authorizationSummary = createCodegenSummary({
    appId,
    inputsHash,
    tables,
    functions: functionManifest.functions,
    ephemeralCollections,
    fileRecords: [],
    diagnostics: [...diagnostics, ...infoDiagnostics],
    sourceSpans: functionDefinitionSourceSpans,
    schemaFieldSpans: schemaPropertySourceSpans,
    outputDirectory: targetConfig.outputDirectory,
    seedArtifact,
    seedRowCount,
  });
  const legacyArtifactIndex = {
    artifactKind: 'artifactIndex',
    // @ref LLP 0037#revisit-triggers — this codegen-owned review index follows
    // the paired auth artifact generation, not the Rust-owned capability format.
    schemaVersion: artifactVersion,
    appId,
    inputsHash,
    generatedAt,
    schemaHash,
    bundleHash,
    authoredSourceHash,
    ...(activationGenerationAdvanced === null ? {} : { activationGenerationAdvanced }),
    artifacts: ['schema.manifest.json', 'functions.manifest.json', AUTHORIZATION_REVIEW_FILE, 'normalized-definition.v1.json', 'handler-runtime-profile.v1.json', HANDLER_TYPESCRIPT_PROFILE_ARTIFACT_FILE, CLIENT_LIFECYCLE_MANIFEST_FILE, 'client-lifecycle.manifest.json', 'capability.manifest.json', ...(trustedCompositionActivation ? [TRUSTED_COMPOSITION_ACTIVATION_FILE] : []), 'provider-introspection.json', 'provider-bindings.json', 'provider-bindings.d.ts', 'contract-data.manifest.json', 'app.descriptor.json', contentAddressedDescriptorFile, 'app.binding.mjs', contentAddressedAppBindingFile, 'app.mjs', 'app.d.ts', 'app.d.mts', 'api.mjs', 'api.d.ts', 'api.d.mts', ...(apiFlatModule ? ['api.flat.mjs'] : []), ...(familiarServerModule ? ['server.mjs', 'server.d.ts'] : []), API_ENVELOPE_MEMBERS_FILE, 'package.json', ...(microArtifacts ? ['micro.mjs', 'micro.d.ts', 'micro.profile.json'] : []), ...(routesManifest ? ['routes.manifest.json'] : []), ...(seedArtifact ? ['seed.artifact.json'] : []), ...(seedAssetFixtures ? ['seed.asset-fixtures.artifact.json'] : []), ...operationArtifactFiles, ...remoteServiceArtifactFiles, ...contractArtifactFiles],
    tables: Object.keys(tables),
    ephemeralCollections: ephemeralCollections.map((collection) => collection.name),
    functions: functionManifest.functions.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
    cronJobs: cronJobs.map((job) => ({ name: job.name, action: job.action, enabled: job.enabled })),
    // Names and requirement flags only — the index mirrors declarations,
    // never values (LLP 0036).
    config: configEntries.map((entry) => ({ name: entry.name, required: entry.required, pool: entry.pool })),
    ...(seedArtifact
      ? {
          seed: {
            version: seedArtifact.seedVersion,
            digest: seedArtifact.seedDigest,
            rows: seedRowCount,
          },
        }
      : {}),
  };
  legacyArtifactIndex.artifacts.splice(3, 0, ...governanceArtifactFiles);
  const tmpOutDir = join(backendRoot, `.generated.tmp-${process.pid}-${Date.now()}`);
  let artifactIndex;
  let summary;
  let verifiedGraph;
  let splitIdentities;
  let generationEnvelope = null;
  let authorizationReview;
  try {
    // @ref LLP 0173#1-artifact-and-custody — build and validate the review
    // projection from the same in-memory graph as the executable pair before
    // the complete candidate inventory is hashed and atomically published.
    authorizationReview = createAuthorizationReview({
      appId,
      authMode,
      inputsHash,
      tables,
      functions: functionManifest.functions,
      sourceFunctions: functions,
      uncomposedReadSurfaceDiagnostics: diagnostics.filter(
        ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE',
      ),
      summary: authorizationSummary,
      visibilityGovernance,
      writePolicyChecks: writePolicy.rows,
    });
    const authorizationReviewProblems = validateAuthorizationReview(authorizationReview);
    if (authorizationReviewProblems.length > 0) {
      throw new TypeError(
        `authorization review projection is invalid: ${authorizationReviewProblems.join('; ')}`,
      );
    }
    writeGeneratedOutput(tmpOutDir, {
      schemaManifest,
      functionManifest,
      authorizationReview,
      visibilityGovernance,
      normalizedDefinition,
      handlerRuntimeProfile,
      clientLifecycleManifest,
      capabilityManifest,
      handlerTypeScriptProfile: HANDLER_TYPESCRIPT_PROFILE,
      routesManifest,
      providerIntrospection,
      providerBindingMetadata,
      providerBindingTypes,
      contractManifest,
      appDescriptorSource,
      contentAddressedDescriptorFile,
      appBindingModule,
      contentAddressedAppBindingFile,
      contentAddressedAppBindingModule,
      appModule,
      appTypes,
      apiModule,
      apiFlatModule,
      apiTypes,
      familiarServerModule,
      familiarServerTypes,
      apiEnvelopeMembers,
      microArtifacts,
      operationSchemas,
      remoteServicePublication,
      contractModules,
      packageJson,
      seedArtifact,
      seedAssetFixtures,
      trustedCompositionActivation,
      artifactIndex: null,
    });
    const files = createArtifactFileRecords(tmpOutDir, legacyArtifactIndex.artifacts, {
      // @ref LLP 0234#d5--exact-ratchets-cover-overrides-and-ordinary-policy-widening
      // — governance baselines and ledgers are retained review/ratchet state,
      // never disposable codegen cache bytes.
      committedProjectionPaths: [
        ...codegenPolicy.committedProjections,
        ...governanceArtifactFiles,
      ],
      targetProfile,
    });
    summary = createCodegenSummary({
      appId,
      inputsHash,
      tables,
      functions: functionManifest.functions,
      ephemeralCollections,
      fileRecords: files,
      diagnostics: [...diagnostics, ...infoDiagnostics],
      sourceSpans: functionDefinitionSourceSpans,
      schemaFieldSpans: schemaPropertySourceSpans,
      outputDirectory: targetConfig.outputDirectory,
      seedArtifact,
      seedRowCount,
    });
    const currentExecutableId = generationContentIdentities
      .executableIdsByTarget[targetProfile];
    const addressNeutralIdentities = {
      schemaVersion: SEMANTIC_IDENTITY_SCHEMA_VERSION,
      ...generationContentIdentities,
      executableId: currentExecutableId,
    };
    const addressNeutralReviewManifest = createReviewManifest({
      legacyIndex: {
        ...legacyArtifactIndex,
        identities: addressNeutralIdentities,
      },
      backendRoot,
      outputDirectory: targetConfig.outputDirectory,
      files,
      summary,
    });
    const bundleMembers = files.map(({
      path,
      sha256: memberSha256,
      bytes,
      logicalKind,
      custody,
      consumer,
    }) => ({ path, sha256: memberSha256, bytes, logicalKind, custody, consumer }));
    const addressNeutralReviewMember = {
      path: 'artifacts.json',
      projectionSha256: generationDomainHash(
        'snapback:application-generation:address-neutral-review-manifest:v1',
        addressNeutralReviewManifest,
      ),
      logicalKind: 'review-manifest',
      custody: 'review-manifest',
      consumer: 'review-tooling',
    };
    const addressNeutralMembers = [...bundleMembers, addressNeutralReviewMember]
      .sort((left, right) => compareCodeUnits(left.path, right.path));
    const generationProjection = generationAddressNeutralProjection({
      appIdentity: generationIdentityInputs.appIdentity,
      dataIdentity: generationIdentityInputs.dataIdentity,
      targetIdentity: generationIdentityInputs.targetIdentity,
      members: addressNeutralMembers,
      identities: addressNeutralIdentities,
    });
    const bundleId = computeBundleId({
      schemaVersion: APPLICATION_GENERATION_SCHEMA_VERSION,
      members: addressNeutralMembers,
      reviewManifest: addressNeutralReviewManifest,
      generationEnvelope: generationProjection,
    });
    splitIdentities = completeGenerationIdentities({
      contentIdentities: generationContentIdentities,
      bundleId,
      appIdentity: generationIdentityInputs.appIdentity,
      dataIdentity: generationIdentityInputs.dataIdentity,
      targetIdentity: generationIdentityInputs.targetIdentity,
    });
    artifactIndex = {
      ...addressNeutralReviewManifest,
      identities: splitIdentities,
    };
    const artifactIndexBytes = Buffer.from(`${stableArtifactJson(artifactIndex)}\n`, 'utf8');
    const envelopeMembers = [
      ...bundleMembers,
      {
        path: 'artifacts.json',
        sha256: artifactSha256(artifactIndexBytes),
        bytes: artifactIndexBytes.byteLength,
        logicalKind: 'review-manifest',
        custody: 'review-manifest',
        consumer: 'review-tooling',
      },
    ].sort((left, right) => compareCodeUnits(left.path, right.path));
    if (checkOnly) {
      // The complete candidate graph above has already been rendered,
      // inventoried, hashed, and contract-checked. Preflight discards only
      // that temporary candidate and never enters graph or generation-
      // envelope publication.
      rmSync(tmpOutDir, { recursive: true, force: true });
    } else {
      // @ref LLP 0241#d2-one-application-generation-envelope — publish the
      // immutable content-addressed envelope from a temp directory before
      // materialization. It has no current pointer or activation authority;
      // latest-emitted is updated only after the ordinary graph publication
      // succeeds and is explicitly non-authoritative build metadata.
      generationEnvelope = publishGenerationEnvelope({
        backendRoot,
        identities: splitIdentities,
        appIdentity: generationIdentityInputs.appIdentity,
        dataIdentity: generationIdentityInputs.dataIdentity,
        targetIdentity: generationIdentityInputs.targetIdentity,
        members: envelopeMembers,
        testHooks: testHooks?.generationEnvelope,
      });
      verifiedGraph = publishGeneratedGraph({
        temporaryGraphRoot: tmpOutDir,
        cacheGraphRoot: codegenCacheGraphRoot(backendRoot, inputsHash),
        materializedRoot: outDir,
        reviewManifest: artifactIndex,
        testHooks: testHooks?.publication,
      });
      recordLatestEmittedGeneration(generationEnvelope);
    }
  } catch (error) {
    rmSync(tmpOutDir, { recursive: true, force: true });
    err(
      error.code ?? 'CODEGEN_WRITE_FAILED',
      'codegen',
      `failed to write generated artifacts transactionally: ${error.message}`,
      { path: outDir, error: error.message, ...(error.details ?? {}) },
    );
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    diagnostics,
    inputsHash,
    authoredSourceHash,
    identities: splitIdentities,
    outDir,
    schemaManifest,
    functionManifest,
    authorizationReview,
    visibilityGovernance,
    normalizedDefinition,
    handlerRuntimeProfile,
    clientLifecycleManifest,
    capabilityManifest,
    trustedCompositionActivation,
    microProfile: microArtifacts?.profile ?? null,
    providerIntrospection,
    providerBindingMetadata,
    contractManifest,
    appDescriptor,
    artifactIndex,
    summary,
    checked: checkOnly,
    emitted: !checkOnly,
    cacheGraphRoot: verifiedGraph?.graphRoot ?? null,
    generationEnvelopeRoot: generationEnvelope?.envelopeRoot ?? null,
  };

  // Cache and hash by the fd-attested target's canonical backend-relative POSIX
  // identity, never an authored alias or absolute checkout path. TypeScript
  // entries retain both byte streams: authored bytes are identity/evidence;
  // emitted bytes are the only bytes handed to the runtime.
  function loadHandlerSource(sourcePath, functionName) {
    let capability;
    try {
      capability = resolveHandlerSourceCapability(backendRoot, sourcePath);
    } catch (error) {
      err(error.codegenCode ?? 'BUNDLE_SOURCE_UNREADABLE', 'bundle', `${functionName}: ${error.message}`, {
        function: functionName,
        source: sourcePath,
        ...(error.details ?? {}),
      });
      return null;
    }
    if (!handlerSourceCache.has(capability.identity)) {
      let bytes;
      let source;
      try {
        bytes = capability.read();
        source = decodeUtf8Source(bytes, capability.identity, 'BUNDLE_SOURCE');
      } catch (error) {
        err(error.codegenCode ?? 'BUNDLE_SOURCE_UNREADABLE', 'bundle', `${functionName}: ${error.message}`, {
          function: functionName,
          source: sourcePath,
          identity: capability.identity,
          ...(error.details ?? {}),
        });
        return null;
      }
      const blocked = scanUnsupportedHandlerSource(source, capability.identity);
      if (blocked.length > 0) {
        for (const issue of blocked) {
          err(issue.code, 'bundle', `${functionName}: ${issue.message}`, {
            function: functionName,
            source: capability.identity,
            token: issue.token,
            sourceSpan: { file: capability.identity, line: issue.line, column: issue.column },
          });
        }
      }
      if (/\.(?:ts|mts|tsx|cts)$/iu.test(capability.identity)) {
        const transformed = transformTypeScriptHandler({
          source,
          sourcePath: capability.identity,
        });
        if (!transformed.ok) {
          for (const issue of transformed.diagnostics) {
            err(issue.code, 'bundle', `${functionName}: ${issue.message}`, {
              function: functionName,
              source: capability.identity,
              sourceSpan: {
                file: capability.identity,
                line: issue.line,
                column: issue.column,
              },
              details: issue.details,
            });
          }
          handlerSourceCache.set(capability.identity, {
            identity: capability.identity,
            bytes,
            authoredSource: source,
            runtimeBytes: Buffer.alloc(0),
            source: '',
            sourceMap: null,
            typescriptIdentity: null,
            functions: new Set([functionName]),
          });
        } else {
          const authoredIssueKeys = new Set(blocked.map((issue) => `${issue.code}\0${issue.token}`));
          // @ref LLP 0246#d4-type-only-and-runtime-edges-are-distinct — the
          // existing capability scan runs again over the exact emitted JS so
          // erasure cannot smuggle in a helper, import, global, or capability.
          for (const issue of scanUnsupportedHandlerSource(
            transformed.javascript,
            transformed.javascriptPath,
          )) {
            if (authoredIssueKeys.has(`${issue.code}\0${issue.token}`)) continue;
            const mapped = mapGeneratedTypeScriptPosition(
              transformed.sourceMap,
              issue.line,
              issue.column,
            );
            if (!mapped) {
              err(
                'SNAPBACK_CODEGEN_TYPESCRIPT_SOURCE_MAP_FAILED',
                'bundle',
                `${functionName}: emitted TypeScript refusal could not be mapped to authored source`,
                {
                  function: functionName,
                  source: capability.identity,
                  generatedSourceSpan: {
                    file: transformed.javascriptPath,
                    line: issue.line,
                    column: issue.column,
                  },
                },
              );
              continue;
            }
            err(issue.code, 'bundle', `${functionName}: ${issue.message}`, {
              function: functionName,
              source: capability.identity,
              token: issue.token,
              sourceSpan: {
                file: capability.identity,
                line: mapped.line,
                column: mapped.column,
              },
            });
          }
          handlerSourceCache.set(capability.identity, {
            identity: capability.identity,
            bytes,
            authoredSource: source,
            runtimeBytes: transformed.javascriptBytes,
            source: transformed.javascript,
            sourceMap: transformed.sourceMap,
            sourceMapText: transformed.sourceMapText,
            typescriptIdentity: transformed.identity,
            functions: new Set([functionName]),
          });
        }
      } else {
        handlerSourceCache.set(capability.identity, {
          identity: capability.identity,
          bytes,
          authoredSource: source,
          runtimeBytes: bytes,
          source,
          sourceMap: null,
          typescriptIdentity: null,
          functions: new Set([functionName]),
        });
      }
    }
    const entry = handlerSourceCache.get(capability.identity);
    entry.functions.add(functionName);
    return entry;
  }
}

function buildEphemeralCollections(ephemeralDef, tables, err, targetProfile) {
  if (!ephemeralDef) return [];

  const membershipDeclarations = new Map();
  for (const table of Object.values(tables)) {
    if (!table.membership) continue;
    const declaration = table.membership.id ?? table.name;
    if (!membershipDeclarations.has(declaration)) {
      membershipDeclarations.set(declaration, { table, membership: table.membership });
    }
  }

  // @ref LLP 0013#agent-and-developer-diagnostics — missing TTL/auth/routing
  // and unsupported targets must be generated diagnostics, not silent drops.
  const collections = [];
  for (const [name, def] of Object.entries(ephemeralDef.collections ?? {})) {
    if (!IDENT.test(name) || Buffer.byteLength(name) > MAX_EPHEMERAL_COLLECTION_NAME_BYTES) {
      err('EPHEMERAL_INVALID_IDENTIFIER', 'ephemeral', `invalid ephemeral collection identifier ${name}`, { collection: name });
      continue;
    }
    if (!isIsolatedDefinition(def, 'ephemeral-collection')) {
      err('EPHEMERAL_INVALID_COLLECTION', 'ephemeral', `${name} must be ephemeral.collection(...)`, { collection: name });
      continue;
    }

    const scopeFields = Object.keys(def.scope ?? {});
    if (scopeFields.length === 0) {
      err('EPHEMERAL_EMPTY_SCOPE', 'ephemeral', `${name} needs at least one scope field`, { collection: name });
    }
    if (scopeFields.length > MAX_EPHEMERAL_SCOPE_FIELDS) {
      err('EPHEMERAL_SCOPE_TOO_WIDE', 'ephemeral', `${name} has too many scope fields`, {
        collection: name,
        fields: scopeFields.length,
        maximum: MAX_EPHEMERAL_SCOPE_FIELDS,
      });
    }
    let contractsValid = true;
    for (const field of scopeFields) {
      if (!IDENT.test(field) || Buffer.byteLength(field) > MAX_EPHEMERAL_SCOPE_KEY_BYTES) {
        err('EPHEMERAL_INVALID_SCOPE_FIELD', 'ephemeral', `${name} has invalid scope field ${field}`, { collection: name, field });
        contractsValid = false;
        continue;
      }
      if (!validateAuthoringValidator(def.scope?.[field], `${name} scope ${field}`, (message) => {
        err('EPHEMERAL_INVALID_VALIDATOR', 'ephemeral', message, { collection: name, field });
      })) contractsValid = false;
      checkObjectValidatorFieldIdents(def.scope?.[field], `scope field ${field}`, (fieldName, where) => {
        err('EPHEMERAL_INVALID_SCOPE_FIELD', 'ephemeral', `${name} ${where} has invalid field identifier ${fieldName}`, { collection: name, field: fieldName });
      });
    }
    if (!validateAuthoringValidator(def.value, `${name} value`, (message) => {
      err('EPHEMERAL_INVALID_VALIDATOR', 'ephemeral', message, { collection: name });
    })) contractsValid = false;
    // The value validator's nested v.object field names reach the emitted
    // scope/value TS types (typeForValidator) unescaped, same as scope fields.
    checkObjectValidatorFieldIdents(def.value, 'value', (fieldName, where) => {
      err('EPHEMERAL_INVALID_VALUE_FIELD', 'ephemeral', `${name} ${where} has invalid field identifier ${fieldName}`, { collection: name, field: fieldName });
    });

    const requestedRoutingFields = def.routing ?? scopeFields;
    const routingFields = Array.isArray(requestedRoutingFields) ? requestedRoutingFields : [];
    if (routingFields.length === 0) {
      err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} needs at least one routing field`, { collection: name });
    }
    const seenRoutingFields = new Set();
    for (const field of routingFields) {
      if (seenRoutingFields.has(field)) {
        err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} needs unique routing fields`, { collection: name, field });
      }
      seenRoutingFields.add(field);
      if (!scopeFields.includes(field)) {
        err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} routes by ${field}, which is not in its scope`, { collection: name, field, scopeFields });
      }
    }

    if (!isPositiveSafeInteger(def.ttlMs)) {
      err('EPHEMERAL_MISSING_TTL', 'ephemeral', `${name} needs a positive ttlMs`, { collection: name });
    }
    if (!isPositiveSafeInteger(def.maxTtlMs)) {
      err('EPHEMERAL_INVALID_BUDGET', 'ephemeral', `${name} maxTtlMs must be a positive integer`, { collection: name, field: 'maxTtlMs', value: def.maxTtlMs });
    } else if (def.maxTtlMs > 30_000) {
      err('EPHEMERAL_INVALID_BUDGET', 'ephemeral', `${name} maxTtlMs exceeds the local paved-path ceiling`, { collection: name, field: 'maxTtlMs', value: def.maxTtlMs, maximum: 30_000 });
    } else if (def.maxTtlMs < def.ttlMs) {
      err('EPHEMERAL_INVALID_TTL', 'ephemeral', `${name} maxTtlMs is below ttlMs`, { collection: name, ttlMs: def.ttlMs, maxTtlMs: def.maxTtlMs });
    }
    if (
      !isPositiveSafeInteger(def.withdrawalVisibilityDeadlineMs)
      || !isPositiveSafeInteger(def.ttlMs)
      || def.withdrawalVisibilityDeadlineMs > Math.floor(def.ttlMs / 2)
    ) {
      err(
        'EPHEMERAL_INVALID_BUDGET',
        'ephemeral',
        `${name} withdrawalVisibilityDeadlineMs must be a positive integer no greater than ttlMs/2`,
        {
          collection: name,
          field: 'withdrawalVisibilityDeadlineMs',
          value: def.withdrawalVisibilityDeadlineMs,
          maximum: isPositiveSafeInteger(def.ttlMs) ? Math.floor(def.ttlMs / 2) : null,
        },
      );
    }
    for (const [field, value, maximum] of [
      ['maxValueBytes', def.maxValueBytes, 4_096],
      ['hardMaxValueBytes', def.hardMaxValueBytes, 4_096],
      ['sustainedHz', def.publishRate?.sustainedHz, 0xffff_ffff],
      ['burst', def.publishRate?.burst, 0xffff_ffff],
      ['dispatchMs', def.delivery?.dispatchMs, Number.MAX_SAFE_INTEGER],
      ['maxPendingEphemeralKeys', def.maxPendingEphemeralKeys, LOCAL_MAX_PENDING_EPHEMERAL_KEYS],
    ]) {
      if (!isPositiveSafeInteger(value) || value > maximum) {
        err('EPHEMERAL_INVALID_BUDGET', 'ephemeral', `${name} ${field} must be a positive integer${maximum < Number.MAX_SAFE_INTEGER ? ` no greater than ${maximum}` : ''}`, {
          collection: name,
          field,
          value: Number.isFinite(value) ? value : String(value),
          ...(maximum < Number.MAX_SAFE_INTEGER ? { maximum } : {}),
        });
      }
    }
    if (def.maxValueBytes > def.hardMaxValueBytes || def.maxValueBytes > 4_096) {
      err('EPHEMERAL_VALUE_BUDGET_TOO_LARGE', 'ephemeral', `${name} maxValueBytes exceeds the local hard cap`, {
        collection: name,
        maxValueBytes: def.maxValueBytes,
        hardMaxValueBytes: def.hardMaxValueBytes,
      });
    }
    let permissionBacking;
    if (!def.publish || !def.publish.__accessPolicy || !def.subscribe || !def.subscribe.__accessPolicy) {
      err('EPHEMERAL_MISSING_AUTH', 'ephemeral', `${name} needs explicit publish and subscribe auth policies`, { collection: name });
    } else {
      const membershipPolicies = [];
      for (const [operation, policy] of [['publish', def.publish], ['subscribe', def.subscribe]]) {
        if (
          policy.kind === 'RequireRoomPermission'
          && (
            !IDENT.test(policy.prefix ?? '')
            || Buffer.byteLength(policy.prefix ?? '') > MAX_EPHEMERAL_SCOPE_KEY_BYTES
          )
        ) {
          err('EPHEMERAL_INVALID_AUTH', 'ephemeral', `${name} ${operation} room-permission prefix must be a portable identifier`, {
            collection: name,
            operation,
            prefix: policy.prefix,
          });
        } else if (
          policy.kind === 'RequireRoomPermission'
          && isReservedRoomPermissionPrefix(policy.prefix)
        ) {
          err(
            'EPHEMERAL_RESERVED_AUTH_PREFIX',
            'ephemeral',
            `${name} ${operation} room-permission prefix ${policy.prefix} is reserved by Snapback`,
            {
              collection: name,
              operation,
              prefix: policy.prefix,
              namespace: policy.prefix === '_snapback_stream_server'
                ? 'platform-stream'
                : 'generated-membership',
            },
          );
        } else if (policy.kind === 'RequireMembership') {
          membershipPolicies.push({ operation, policy });
          const prefix = membershipPermissionPrefix(policy.declaration);
          if (!IDENT.test(prefix) || Buffer.byteLength(prefix) > MAX_EPHEMERAL_SCOPE_KEY_BYTES) {
            err(
              'EPHEMERAL_INVALID_AUTH',
              'ephemeral',
              `${name} ${operation} generated membership prefix must be a portable identifier within ${MAX_EPHEMERAL_SCOPE_KEY_BYTES} bytes`,
              {
                collection: name,
                operation,
                declaration: policy.declaration ?? null,
                prefix,
                maximum: MAX_EPHEMERAL_SCOPE_KEY_BYTES,
              },
            );
          }
        } else if (policy.kind !== 'AllowAll' && policy.kind !== 'RequireRoomPermission') {
          err('EPHEMERAL_INVALID_AUTH', 'ephemeral', `${name} ${operation} uses an unsupported access policy`, {
            collection: name,
            operation,
            policyKind: policy.kind,
          });
        }
      }

      if (membershipPolicies.length > 0) {
        const membershipIds = new Set(membershipPolicies.map(({ policy }) => policy.declaration));
        const hasUniformMembershipPolicy = membershipPolicies.length === 2
          && membershipIds.size === 1;
        if (!hasUniformMembershipPolicy) {
          err(
            'EPHEMERAL_MEMBERSHIP_MIXED_POLICY',
            'ephemeral',
            `${name} publish and subscribe must both use allow.members with the same declaration; v1 refuses per-operation mixing because the runtime derives room authority from the subscribe policy. Per-operation mixing is a future runtime capability`,
            {
              collection: name,
              declarations: [...membershipIds],
              publishPolicy: def.publish.kind,
              subscribePolicy: def.subscribe.kind,
            },
          );
        }

        const resolvedDeclarations = new Map();
        for (const declaration of membershipIds) {
          const resolved = membershipDeclarations.get(declaration);
          if (!resolved) {
            err(
              'EPHEMERAL_MEMBERSHIP_UNKNOWN_DECLARATION',
              'ephemeral',
              `${name} allow.members names unknown membership declaration ${String(declaration)}`,
              { collection: name, declaration: declaration ?? null },
            );
          } else {
            resolvedDeclarations.set(declaration, resolved);
          }
        }

        if (hasUniformMembershipPolicy) {
          const declaration = membershipIds.values().next().value;
          const resolved = resolvedDeclarations.get(declaration);
          if (resolved) {
            let roleMismatch = false;
            const activeRoleVocabulary = new Set(resolved.membership.roles);
            const effectiveRolePolicies = [];
            for (const { operation, policy } of membershipPolicies) {
              const roles = Object.hasOwn(policy, 'roles')
                ? policy.roles
                : resolved.membership.roles;
              const validShape = Array.isArray(roles)
                && roles.length > 0
                && roles.every((role) => typeof role === 'string' && role.length > 0)
                && new Set(roles).size === roles.length;
              if (!validShape) {
                err(
                  'EPHEMERAL_MEMBERSHIP_ROLES_INVALID',
                  'ephemeral',
                  `${name} ${operation} allow.members roles must be a non-empty unique string array`,
                  { collection: name, operation, declaration },
                );
                roleMismatch = true;
                continue;
              }
              const unknownRoles = roles.filter((role) => !activeRoleVocabulary.has(role));
              if (unknownRoles.length > 0) {
                err(
                  'EPHEMERAL_MEMBERSHIP_ROLE_UNKNOWN',
                  'ephemeral',
                  `${name} ${operation} allow.members roles must be drawn from membership declaration ${declaration}'s active role vocabulary`,
                  {
                    collection: name,
                    operation,
                    declaration,
                    unknownRoles,
                    activeRoles: resolved.membership.roles,
                  },
                );
                roleMismatch = true;
                continue;
              }
              effectiveRolePolicies.push({ operation, roles });
            }
            if (!roleMismatch && effectiveRolePolicies.length === 2) {
              const [first, second] = effectiveRolePolicies;
              const secondRoles = new Set(second.roles);
              if (
                first.roles.length !== second.roles.length
                || first.roles.some((role) => !secondRoles.has(role))
              ) {
                err(
                  'EPHEMERAL_MEMBERSHIP_MIXED_POLICY',
                  'ephemeral',
                  `${name} publish and subscribe must admit the same effective membership roles because v1 activates one room permission projection`,
                  {
                    collection: name,
                    declaration,
                    publishRoles: effectiveRolePolicies.find(({ operation }) => operation === 'publish')?.roles,
                    subscribeRoles: effectiveRolePolicies.find(({ operation }) => operation === 'subscribe')?.roles,
                  },
                );
                roleMismatch = true;
              }
            }
            let roomScopeField = null;
            let scopeMismatch = false;
            if (resolved.membership.scope !== 'resource' || !resolved.membership.resource) {
              err(
                'EPHEMERAL_MEMBERSHIP_SCOPE_MISMATCH',
                'ephemeral',
                `${name} cannot bind app-scoped membership declaration ${declaration} to a room scope`,
                { collection: name, declaration, reason: 'app-scope' },
              );
              scopeMismatch = true;
            } else if (scopeFields.length !== 1) {
              const explicitScopeFields = membershipPolicies
                .filter(({ policy }) => Object.hasOwn(policy, 'scopeField'))
                .map(({ policy }) => policy.scopeField);
              const invalidExplicit = explicitScopeFields.find((field) => !scopeFields.includes(field));
              err(
                'EPHEMERAL_MEMBERSHIP_SCOPE_MISMATCH',
                'ephemeral',
                invalidExplicit !== undefined
                  ? `${name} allow.members scopeField ${String(invalidExplicit)} is not in the collection scope`
                  : `${name} has ${scopeFields.length} scope fields; v1 membership backing requires exactly one because every room scope field needs a backing column`,
                {
                  collection: name,
                  declaration,
                  scopeFields,
                  ...(invalidExplicit !== undefined ? { scopeField: invalidExplicit } : {}),
                  reason: invalidExplicit !== undefined ? 'unknown-scope-field' : 'multi-scope-unbacked',
                },
              );
              scopeMismatch = true;
            } else {
              [roomScopeField] = scopeFields;
              const mismatchedPolicy = membershipPolicies.find(({ policy }) => (
                Object.hasOwn(policy, 'scopeField') && policy.scopeField !== roomScopeField
              ));
              if (mismatchedPolicy) {
                err(
                  'EPHEMERAL_MEMBERSHIP_SCOPE_MISMATCH',
                  'ephemeral',
                  `${name} ${mismatchedPolicy.operation} allow.members scopeField must name the collection scope field ${roomScopeField}`,
                  {
                    collection: name,
                    operation: mismatchedPolicy.operation,
                    declaration,
                    scopeFields,
                    scopeField: mismatchedPolicy.policy.scopeField ?? null,
                    reason: 'unknown-scope-field',
                  },
                );
                scopeMismatch = true;
              }
            }

            const expectedResourceTable = resolved.membership.resourceTable;
            if (!scopeMismatch && typeof expectedResourceTable !== 'string') {
              // The membership declaration's own schema diagnostic explains
              // why its resource axis is not a nominal id. Do not lower a
              // projection whose resource domain codegen could not establish.
              scopeMismatch = true;
            } else if (!scopeMismatch) {
              const scopeValidator = def.scope?.[roomScopeField];
              const actualResourceTable = idFieldTypeTable(scopeValidator?.fieldType);
              const actualOptional = scopeValidator?.optional === true;
              if (actualResourceTable !== expectedResourceTable || actualOptional) {
                const actualDomain = actualResourceTable === null
                  ? 'a non-id validator'
                  : `${actualOptional ? 'v.optional(' : ''}v.id(${JSON.stringify(actualResourceTable)})${actualOptional ? ')' : ''}`;
                err(
                  'EPHEMERAL_MEMBERSHIP_SCOPE_DOMAIN_MISMATCH',
                  'ephemeral',
                  `${name} scope field ${roomScopeField} must use v.id(${JSON.stringify(expectedResourceTable)}) to bind membership declaration ${declaration}; found ${actualDomain}`,
                  {
                    collection: name,
                    declaration,
                    scopeField: roomScopeField,
                    expectedResourceTable,
                    actualResourceTable,
                    actualOptional,
                    reason: 'resource-domain-mismatch',
                  },
                );
                scopeMismatch = true;
              }
            }

            const prefix = membershipPermissionPrefix(declaration);
            const prefixValid = IDENT.test(prefix)
              && Buffer.byteLength(prefix) <= MAX_EPHEMERAL_SCOPE_KEY_BYTES;
            if (!scopeMismatch && !roleMismatch && prefixValid) {
              // @ref LLP 0013#lowering-and-one-validator-convergence — the
              // declaration's active-role subset lowers into the same durable
              // projection that Rust validates for direct artifacts.
              permissionBacking = {
                table: resolved.table.name,
                subjectField: resolved.membership.principal,
                scopeFields: { [roomScopeField]: resolved.membership.resource },
                roleField: resolved.membership.role,
                allowedRoles: effectiveRolePolicies[0].roles,
              };
            }
          }
        }
      }
    }
    for (const target of def.targets ?? []) {
      if (!TARGET_PROFILES.has(target)) {
        err('EPHEMERAL_UNSUPPORTED_TARGET', 'ephemeral', `${name} declares unsupported ephemeral target ${target}`, { collection: name, target });
      }
    }
    if (!(def.targets ?? []).includes(targetProfile)) {
      err('EPHEMERAL_TARGET_NOT_DECLARED', 'ephemeral', `${name} is not declared for selected target ${targetProfile}`, { collection: name, targetProfile });
    }
    if (def.delivery?.mode !== 'latest') {
      err('EPHEMERAL_UNSUPPORTED_DELIVERY_MODE', 'ephemeral', `${name} uses unsupported delivery mode ${def.delivery?.mode}`, { collection: name, mode: def.delivery?.mode });
    }

    const resolvedKeyMode = keyMode(def.key);
    if (!resolvedKeyMode) {
      err('EPHEMERAL_UNSUPPORTED_KEY_MODE', 'ephemeral', `${name} declares unsupported ephemeral key mode ${def.key}`, {
        collection: name,
        key: def.key,
        supportedKeys: ['connection', 'session', 'user', 'custom'],
      });
    }

    // Preserve all independently actionable diagnostics above, but never feed
    // a known-invalid mutable definition object into the result-contract
    // projector. A projector exception would collapse the field-specific
    // authoring errors into one worker failure and obscure the remaining
    // budget/auth findings.
    if (!contractsValid) continue;
    collections.push({
      name,
      scopeFields,
      scopeContract: {
        kind: 'object',
        fields: Object.entries(def.scope ?? {}).map(([fieldName, validator]) => ({
          name: fieldName,
          required: validator.optional !== true,
          value: validatorResultValue(validator),
        })),
        allowExtra: false,
      },
      valueContract: validatorResultValue(def.value),
      keyMode: resolvedKeyMode ?? 'Connection',
      routingFields,
      defaultTtlMs: def.ttlMs ?? 0,
      maxTtlMs: def.maxTtlMs,
      withdrawalVisibilityDeadlineMs: def.withdrawalVisibilityDeadlineMs,
      maxValueBytes: def.maxValueBytes,
      hardMaxValueBytes: def.hardMaxValueBytes,
      sustainedHz: def.publishRate?.sustainedHz ?? 20,
      burst: def.publishRate?.burst ?? 60,
      dispatchMs: def.delivery?.dispatchMs ?? 33,
      publish: serializeAccessPolicy(def.publish),
      subscribe: serializeAccessPolicy(def.subscribe),
      ...(permissionBacking ? { permissionBacking } : {}),
      maxPendingEphemeralKeys: def.maxPendingEphemeralKeys,
    });
  }
  return collections;
}

function keyMode(key) {
  return {
    connection: 'Connection',
    session: 'Session',
    user: 'User',
    custom: 'Custom',
  }[key] ?? null;
}

/// The Contract read descriptor for one ephemeral collection (ENG-22479;
/// Exact LLP 0284 §2.4/§2.5): the queries-map entry the runtime's
/// subscribeEphemeral resolves. Field shape mirrors the Exact conformance
/// fixture descriptor (ephemeral+mode:'live'+livePush+initialSnapshot with
/// the delivery-budget facts riding along).
function contractEphemeralDescriptor(collection, schemaDef) {
  const def = schemaDef.ephemeral?.collections?.[collection.name];
  return {
    name: collection.name,
    args: argDescriptors(def?.scope ?? {}),
    argOrder: Object.keys(def?.scope ?? {}),
    // The generated Contract row is known from the same collection validator
    // that feeds api.d.ts and the per-collection descriptor sidecar. Preserve
    // it across provider introspection instead of deliberately degrading the
    // entire entry to unknown at the neutral metadata boundary.
    //
    // @ref LLP 0012#contract-artifacts — generated packages are typed,
    // trustworthy contract artifacts rather than decorative declarations.
    result: { kind: 'list', row: ephemeralEntryDescriptor(def?.value) },
    serverRunnable: false,
    localRunnable: true,
    subscription: 'initial-snapshot',
    ephemeral: true,
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
    defaultLive: true,
    maxDeltaRateHz: Math.round(1_000 / collection.dispatchMs),
    coalesce: true,
    keyMode: collection.keyMode,
    scopeFields: collection.scopeFields,
    defaultTtlMs: collection.defaultTtlMs,
    maxTtlMs: collection.maxTtlMs,
    withdrawalVisibilityDeadlineMs: collection.withdrawalVisibilityDeadlineMs,
  };
}

function ephemeralEntryDescriptor(valueValidator) {
  return {
    shape: 'object',
    fields: {
      key: { shape: 'primitive', name: 'string' },
      value: validatorDescriptor(valueValidator),
      updatedAt: { shape: 'primitive', name: 'number' },
      expiresAt: { shape: 'primitive', name: 'number', optional: true },
      sourceClientId: { shape: 'primitive', name: 'string' },
      self: { shape: 'primitive', name: 'boolean' },
    },
  };
}

/// Contract-manifest ephemeral facts (LLP 0034 D3; Exact LLP 0284 §2.4/§2.5.1).
///
/// The read-side delivery budget is derived from the collection's dispatch
/// window: latest-state coalescing on a 33 ms dispatch tick delivers at most
/// ~30 map updates/s per entry, so `maxDeltaRateHz = round(1000 / dispatchMs)`
/// and `coalesce: true` (LLP 0013 latest-state semantics). The publish budget
/// facts ride along so Exact LLP 0281's rated `publish` can compile against
/// them; the `*.ephemeral.ts` / `*.publish.ts` descriptor-kind migration is
/// deferred until Exact ships an `ephemeral` binding (LLP 0034 §4, deferred).
function contractEphemeralSection(ephemeralCollections) {
  const section = dict();
  for (const collection of ephemeralCollections) {
    section[collection.name] = {
      name: collection.name,
      ephemeral: true,
      keyMode: collection.keyMode,
      scopeFields: collection.scopeFields,
      routingFields: collection.routingFields,
      defaultTtlMs: collection.defaultTtlMs,
      maxTtlMs: collection.maxTtlMs,
      withdrawalVisibilityDeadlineMs: collection.withdrawalVisibilityDeadlineMs,
      deliveryMode: 'latest',
      maxDeltaRateHz: Math.round(1_000 / collection.dispatchMs),
      coalesce: true,
      publishBudget: {
        sustainedHz: collection.sustainedHz,
        burst: collection.burst,
        maxValueBytes: collection.maxValueBytes,
      },
    };
  }
  return section;
}

function serializeAccessPolicy(policy) {
  if (!policy || !policy.__accessPolicy) return 'AllowAll';
  if (policy.kind === 'RequireRoomPermission') {
    return { RequireRoomPermission: { prefix: policy.prefix } };
  }
  if (policy.kind === 'RequireMembership') {
    return { RequireRoomPermission: { prefix: membershipPermissionPrefix(policy.declaration) } };
  }
  return 'AllowAll';
}

function membershipPermissionPrefix(declaration) {
  return `m_${String(declaration ?? '')}`;
}

function isReservedRoomPermissionPrefix(prefix) {
  return prefix === '_snapback_stream_server' || prefix.startsWith('m_');
}

// --- serialization helpers ---------------------------------------------------

export function serializeExpr(expr) {
  if (expr.kind === 'AuthUserId') return 'AuthUserId';
  if (expr.kind === 'AuthKind') return 'AuthKind';
  if (expr.kind === 'AuthActorKind') return 'AuthActorKind';
  if (expr.kind === 'AuthIsDelegated') return 'AuthIsDelegated';
  if (expr.kind === 'AuthActorUserId') return 'AuthActorUserId';
  if (expr.kind === 'AuthActivityActorKind') return 'AuthActivityActorKind';
  if (expr.kind === 'AuthGrantId') return 'AuthGrantId';
  if (expr.kind === 'ClientMutationDigest') return 'ClientMutationDigest';
  if (expr.kind === 'RuntimeId') return 'RuntimeId';
  if (expr.kind === 'RuntimeNow') return 'RuntimeNow';
  if (expr.kind === 'Args') return 'Args';
  if ('Arg' in expr) return { Arg: expr.Arg };
  if ('Literal' in expr) return { Literal: expr.Literal };
  if ('Binding' in expr) return { Binding: expr.Binding };
  if ('Field' in expr) {
    return { Field: { base: serializeExpr(expr.Field.base), key: expr.Field.key } };
  }
  if ('Binary' in expr) {
    return { Binary: { op: expr.Binary.op, left: serializeExpr(expr.Binary.left), right: serializeExpr(expr.Binary.right) } };
  }
  if ('Unary' in expr) {
    return { Unary: { op: expr.Unary.op, expr: serializeExpr(expr.Unary.expr) } };
  }
  if ('If' in expr) {
    return { If: { cond: serializeExpr(expr.If.cond), then: serializeExpr(expr.If.then), else: serializeExpr(expr.If.else) } };
  }
  if ('Concat' in expr) return { Concat: expr.Concat.map(serializeExpr) };
  if ('Call' in expr) {
    return { Call: { func: expr.Call.func, args: expr.Call.args.map(serializeExpr) } };
  }
  if ('Record' in expr) {
    const fields = dict();
    for (const [key, fieldExpr] of Object.entries(expr.Record.fields)) fields[key] = serializeExpr(fieldExpr);
    return { Record: { fields } };
  }
  throw codegenError(
    'SNAPBACK_CODEGEN_EXPRESSION_UNSERIALIZABLE',
    `unserializable expr ${JSON.stringify(expr)}`,
  );
}

function serializeQueryPlan(plan, membershipDeclarations, authorityProfiles = new Map()) {
  return {
    table: plan.table,
    ...(plan.tableVisibility !== undefined
      ? { tableVisibility: structuredClone(plan.tableVisibility) }
      : {}),
    filters: plan.filters.map((f) => ({ field: f.field, op: f.op, value: serializeExpr(f.value) })),
    membershipFilters: (plan.membershipFilters ?? []).map((predicate) => {
      const membership = membershipDeclarations.get(predicate.declaration)?.membership;
      const authority = authorityProfiles.get(predicate.declaration);
      const loweredRoles = authority
        ? lowerAuthorityProfileRoles(predicate, authority)
        : predicate.roles;
      return {
        declaration: predicate.declaration,
        resource: predicate.resource.kind === 'rowField'
          ? { rowField: predicate.resource.field }
          : {
              arg: {
                path: predicate.resource.kind === 'app' ? '__snapbackApp' : predicate.resource.path,
                resourceTable: membership?.resourceTable ?? null,
              },
            },
        ...(loweredRoles === null || loweredRoles === undefined ? {} : { roles: loweredRoles }),
      };
    }),
    order: plan.order.map(serializeOrderExpr),
    limit: plan.limit,
    indexed_by: plan.index,
  };
}

function lowerAuthorityProfileRoles(predicate, authority) {
  const requestedRoles = predicate.roles === null
    ? authority.profile.roleLattice.map(({ role }) => role)
    : predicate.roles;
  return [...new Set(requestedRoles.flatMap((minimumRole) => (
    authority.profile.roleLattice
      .filter(({ implies }) => implies.includes(minimumRole))
      .map(({ role }) => role)
  )))].sort(compareCodeUnits);
}

function authorityProfileProjectionSource({
  declaration,
  operation,
  profileName,
}) {
  const operationName = `${profileName}.${operation}`;
  const body = operation === 'list'
    ? `var page = await ctx.authority[${JSON.stringify(declaration)}].list(args.scopeId, args.page);
    return page.rows;`
    : operation === 'myRole'
      ? `var role = await ctx.authority[${JSON.stringify(declaration)}].myRole(args.scopeId);
    return [role];`
      : `return ctx.authority[${JSON.stringify(declaration)}][${JSON.stringify(operation)}](args.scopeId, args.page);`;
  return `globalThis.__snapbackHandlers = globalThis.__snapbackHandlers || {};
globalThis.__snapbackHandlers[${JSON.stringify(operationName)}] = async function(ctx, args) {
    ${body}
};
`;
}

function authorityProfileMutationSource({
  declaration,
  insertExtraFields,
  membership,
  operation,
  operationName,
}) {
  const member = `ctx.membership[${JSON.stringify(declaration)}]`;
  let body;
  if (operation === 'invite') {
    const values = [
      `${JSON.stringify(membership.resource)}: args.scopeId`,
      `${JSON.stringify(membership.principal)}: args.principal`,
      `${JSON.stringify(membership.role)}: args.role`,
      ...insertExtraFields.map((field) => `${JSON.stringify(field)}: args[${JSON.stringify(field)}]`),
    ].join(', ');
    body = `await ${member}.invite({ ${values} });`;
  } else if (operation === 'join') {
    body = `await ${member}.join(args.scopeId, args.invitation);`;
  } else if (operation === 'leave') {
    body = `await ${member}.leave(args.scopeId);`;
  } else if (operation === 'changeRole') {
    body = `await ${member}.changeRole(args.scopeId, args.principal, args.role);`;
  } else if (operation === 'transferOwner') {
    body = `await ${member}.transferOwner(args.scopeId, args.principal);`;
  } else if (operation === 'remove') {
    body = `await ${member}.removeAuthorityPrincipal(args.scopeId, args.principal);`;
  } else {
    throw new TypeError(`unknown authority-profile mutation ${operation}`);
  }
  return `globalThis.__snapbackHandlers = globalThis.__snapbackHandlers || {};
globalThis.__snapbackHandlers[${JSON.stringify(operationName)}] = async function(ctx, args) {
    ${body}
    return null;
};
`;
}

function wrapHandlerWithMembershipAdmission(source, exportName, kind, predicates) {
  if (predicates.length === 0) return { source, exportName };
  const wrapper = `__snapbackAuthorityAdmission_${sha256(canonicalResultJson({ exportName, kind, predicates })).slice(0, 16)}`;
  const checks = predicates.map((predicate) => {
    const resource = predicate.resourceArg === null
      ? 'null'
      : predicate.resourceArg.split('.').reduce(
          (expression, segment) => `${expression}[${JSON.stringify(segment)}]`,
          'args',
        );
    const call = `ctx.permissions[${JSON.stringify(predicate.declaration)}]`;
    const argumentsList = [resource, ...predicate.roles.map(JSON.stringify)].join(', ');
    return kind === 'Mutation'
      ? `await ${call}.requireRole(${argumentsList});`
      : `if (!(await ${call}.allowsRole(${argumentsList}))) return [];`;
  }).join('\n  ');
  return {
    source: `${source}\nvar __snapbackAuthorityOriginal = globalThis.__snapbackHandlers[${JSON.stringify(exportName)}];
globalThis.__snapbackHandlers[${JSON.stringify(wrapper)}] = async function(ctx, args) {
  ${checks}
  return await __snapbackAuthorityOriginal(ctx, args);
};\n`,
    exportName: wrapper,
  };
}

function tableVisibilityMembershipLeaves(visibility) {
  if (!visibility) return [];
  if (visibility.kind === 'membership') return [visibility];
  if (visibility.kind === 'any-of') {
    return visibility.arms.filter((arm) => arm.kind === 'membership');
  }
  return [];
}

function tableVisibilityOwnerLeaves(visibility) {
  if (!visibility) return [];
  if (visibility.kind === 'owner') return [visibility];
  if (visibility.kind === 'any-of') {
    return visibility.arms.filter((arm) => arm.kind === 'owner');
  }
  return [];
}

function declaredRestrictedTableVisibility(tables, tableName) {
  const visibility = tables[tableName]?.visibility;
  return visibility && visibility.kind !== 'public-read'
    ? structuredClone(visibility)
    : undefined;
}

function stampRelationalTableVisibility(plan, tables) {
  const root = declaredRestrictedTableVisibility(tables, plan.root);
  const joined = declaredRestrictedTableVisibility(tables, plan.joined);
  if (root === undefined) delete plan.rootTableVisibility;
  else plan.rootTableVisibility = root;
  if (joined === undefined) delete plan.joinedTableVisibility;
  else plan.joinedTableVisibility = joined;
}

function stampBoundedChildrenTableVisibility(plan, tables) {
  const parent = declaredRestrictedTableVisibility(tables, plan.parentTable);
  const child = declaredRestrictedTableVisibility(tables, plan.childTable);
  if (parent === undefined) delete plan.parentTableVisibility;
  else plan.parentTableVisibility = parent;
  if (child === undefined) delete plan.childTableVisibility;
  else plan.childTableVisibility = child;
}

function tableVisibilityMembershipReadTables(visibilities, membershipDeclarations) {
  const reads = [];
  for (const visibility of visibilities) {
    for (const leaf of tableVisibilityMembershipLeaves(visibility)) {
      const found = membershipDeclarations.get(leaf.declaration);
      if (found && !reads.includes(found.table.name)) reads.push(found.table.name);
    }
  }
  return reads;
}

function composedVisibilityAuthorizationDependence(existing, visibilities) {
  const dimensions = new Set(existing ?? []);
  if (visibilities.some((visibility) => visibility !== undefined)) {
    dimensions.add('userId');
  }
  return [...dimensions].sort();
}

// @ref LLP 0135#4-fold-on-acceptance-amendments-applied-2026-08-02 — retain
// the optional string-order UTF-8 ceiling in every normalized plan carrier.
function serializeOrderExpr(order) {
  return {
    field: order.field,
    direction: order.direction,
    ...(order.maxEncodedBytes !== undefined
      ? { maxEncodedBytes: order.maxEncodedBytes }
      : {}),
  };
}

function relationalJoinKeyClassFromManifest(field) {
  const type = field?.field_type;
  if (type === 'String' || type === 'Principal' || type === 'Integer' || type === 'Boolean') {
    return type;
  }
  if (type?.Id?.table && typeof type.Id.table === 'string') return `Id<${type.Id.table}>`;
  if (Array.isArray(type?.Enum?.values)) return `Enum<${canonicalResultJson(type.Enum.values)}>`;
  return null;
}

function relationalProjectionScalarFromManifest(field) {
  const type = field?.field_type;
  return type === 'String'
    || type === 'Principal'
    || type === 'Boolean'
    || type === 'Integer'
    || type === 'Real'
    || Boolean(type?.Enum || type?.Id || type?.AssetRef);
}

// @ref LLP 0178#3-initial-checks — authoring advisories never change
// admission; this proof returns null on every incomplete fact.
// @ref LLP 0187#t2--diagnostics-as-the-router-delegated-to-llp-0178 — the
// plain-join router pays the high precision bar before it spends author trust.
// @ref LLP 0080#1-closed-relational-plan — AST facts are insufficient until
// joined with exact schema indexes, key types, projection types, and the
// index-served root window. This first slice admits only all-public left joins,
// so no source or output visibility is inferred from relation metadata.
function provePlainJoinAdvisory({ candidate, def, name, tables }) {
  if (!candidate || def.__kind !== 'LiveQuery' || def.auth !== 'public') return null;
  if (
    Object.keys(def.args ?? {}).length !== 0
    || def.js?.authScopeField !== null
    || def.authorityIndependent !== undefined
    || def.retainable !== undefined
    || def.defaultLive !== undefined
    || def.authorizationDependence !== undefined
    || def.refusals !== undefined
    || def.trackedRefusals !== undefined
  ) return null;
  if (candidate.root === candidate.joined) return null;
  const reads = def.js?.reads;
  if (
    !Array.isArray(reads)
    || reads.length !== 2
    || new Set(reads).size !== 2
    || !reads.includes(candidate.root)
    || !reads.includes(candidate.joined)
  ) return null;
  const root = tables[candidate.root];
  const joined = tables[candidate.joined];
  if (!root || !joined) return null;
  const rootIndex = root.indexes.find((index) => index.name === candidate.rootIndex);
  const joinedIndex = joined.indexes.find((index) => index.name === candidate.joinedIndex);
  if (!rootIndex || !joinedIndex?.unique) return null;
  if (
    joinedIndex.fields.length !== candidate.joinOn.length
    || !joinedIndex.fields.every(
      (field, index) => field === candidate.joinOn[index].joinedField,
    )
  ) return null;
  const rootFields = new Map(root.fields.map((field) => [field.name, field]));
  const joinedFields = new Map(joined.fields.map((field) => [field.name, field]));
  for (const pair of candidate.joinOn) {
    const rootField = rootFields.get(pair.rootField);
    const joinedField = joinedFields.get(pair.joinedField);
    const rootClass = relationalJoinKeyClassFromManifest(rootField);
    if (
      rootClass === null
      || rootClass !== relationalJoinKeyClassFromManifest(joinedField)
      || rootField?.optional === true
      || joinedField?.optional === true
    ) return null;
  }
  const projection = [];
  for (const leaf of candidate.projection) {
    if (leaf.source.kind === 'literal') {
      projection.push({ name: leaf.name, source: { Literal: leaf.source.value } });
      continue;
    }
    const fields = leaf.source.kind === 'root' ? rootFields : joinedFields;
    const field = fields.get(leaf.source.field);
    // Optional stored fields have omission semantics in an opaque JS row,
    // while the relational result materializes them as null. Staying on
    // required scalar leaves keeps the returned JSON image byte-equivalent.
    if (!field || field.optional === true || !relationalProjectionScalarFromManifest(field)) {
      return null;
    }
    projection.push({
      name: leaf.name,
      source: leaf.source.kind === 'root'
        ? { RootField: leaf.source.field }
        : { JoinedField: leaf.source.field },
    });
  }
  const plan = {
    root: candidate.root,
    rootAlias: candidate.root,
    joined: candidate.joined,
    joinedAlias: candidate.joined,
    joinKind: 'Left',
    joinOn: candidate.joinOn,
    rootFilters: [],
    rootVisibility: [],
    joinedVisibility: [],
    projection,
    order: rootIndex.fields.map((field) => ({ field, direction: 'Asc' })),
    take: candidate.take,
    rootIndex: candidate.rootIndex,
    joinedIndex: candidate.joinedIndex,
  };
  try {
    const authoredContract = effectiveResultContract({
      def,
      functionKind: 'LiveQuery',
      runtime: { IbexModule: {} },
      tables,
    });
    const relationalContract = effectiveResultContract({
      def: {},
      functionKind: 'LiveQuery',
      runtime: { HostPlan: { RelationalQuery: plan } },
      tables,
    });
    if (canonicalResultJson(authoredContract) !== canonicalResultJson(relationalContract)) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    root: candidate.root,
    rootIndex: candidate.rootIndex,
    joined: candidate.joined,
    joinedIndex: candidate.joinedIndex,
    join: candidate.joinOn.map(({ rootField, joinedField }) => ({
      root: rootField,
      joined: joinedField,
    })),
    take: candidate.take,
    projection: candidate.projection.map((leaf) => ({
      name: leaf.name,
      [leaf.source.kind]: leaf.source.kind === 'literal'
        ? leaf.source.value
        : leaf.source.field,
    })),
  };
}

function serializeRelationalPlan(plan) {
  const serializeFilters = (filters) => filters.map((filter) => ({
    field: filter.field,
    op: filter.op,
    value: serializeExpr(filter.value),
  }));
  return {
    root: plan.root,
    rootAlias: plan.rootAlias,
    joined: plan.joined,
    joinedAlias: plan.joinedAlias,
    joinKind: plan.joinKind,
    joinOn: plan.joinOn,
    rootFilters: serializeFilters(plan.rootFilters ?? []),
    rootVisibility: serializeFilters(plan.rootVisibility),
    ...(plan.rootTableVisibility !== undefined
      ? { rootTableVisibility: structuredClone(plan.rootTableVisibility) }
      : {}),
    joinedVisibility: serializeFilters(plan.joinedVisibility),
    ...(plan.joinedTableVisibility !== undefined
      ? { joinedTableVisibility: structuredClone(plan.joinedTableVisibility) }
      : {}),
    projection: plan.projection,
    order: plan.order.map(serializeOrderExpr),
    take: plan.take,
    rootIndex: plan.rootIndex,
    joinedIndex: plan.joinedIndex,
  };
}

// Declared plan bounds — the JS mirror of `src/value_expr.rs` (the corpus
// pins both sides). Authoring over bounds fails closed here, before the
// server would reject the same plan at execution (LLP 0051 D2).
const MAX_PLAN_STEPS = 64;
const MAX_EXPR_DEPTH = 32;
const MAX_PLAN_SERIALIZED_BYTES = 65_536;

function exprDepth(expr) {
  if (typeof expr === 'string') return 1;
  if ('Field' in expr) return 1 + exprDepth(expr.Field.base);
  if ('Binary' in expr) return 1 + Math.max(exprDepth(expr.Binary.left), exprDepth(expr.Binary.right));
  if ('Unary' in expr) return 1 + exprDepth(expr.Unary.expr);
  if ('If' in expr) return 1 + Math.max(exprDepth(expr.If.cond), exprDepth(expr.If.then), exprDepth(expr.If.else));
  if ('Concat' in expr) return 1 + Math.max(0, ...expr.Concat.map(exprDepth));
  if ('Call' in expr) return 1 + Math.max(0, ...expr.Call.args.map(exprDepth));
  if ('Record' in expr) return 1 + Math.max(0, ...Object.values(expr.Record.fields).map(exprDepth));
  return 1;
}

function planExprs(serialized) {
  const exprs = [];
  for (const step of serialized.steps) {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'Insert' || kind === 'InsertEach') exprs.push(...Object.values(body.values));
    if (kind === 'InsertEach') exprs.push(body.source);
    if (kind === 'Patch') exprs.push(body.id, ...Object.values(body.values));
    if (kind === 'Delete' || kind === 'Get') exprs.push(body.id);
    if (kind === 'AssertCurrentRelation') exprs.push(body.id, body.scope_id);
    if (kind === 'Guard') exprs.push(body.cond);
    if (kind === 'Let') exprs.push(body.expr);
    if (kind === 'AllocateSequence') exprs.push(body.scope);
    if (kind === 'DeleteWhere') exprs.push(...body.filter.map((f) => f.value));
  }
  const rv = serialized.return_value;
  if (rv && typeof rv === 'object') {
    if ('Document' in rv) exprs.push(rv.Document.id);
    if ('Expr' in rv) exprs.push(rv.Expr);
  }
  return exprs;
}

export function serializeMutationPlan(plan, functionName, err, tables = null, options = {}) {
  const steps = plan.steps.map((step) => {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'AllocateSequence') {
      return {
        AllocateSequence: {
          counter: body.counter,
          scope: serializeExpr(body.scope),
          into: body.into,
        },
      };
    }
    if (kind === 'Insert') {
      const values = dict();
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { Insert: { table: body.table, values, bind_id_as: body.bind_id_as } };
    }
    if (kind === 'Patch') {
      const values = dict();
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { Patch: { table: body.table, id: serializeExpr(body.id), values } };
    }
    if (kind === 'Get') {
      return { Get: { table: body.table, id: serializeExpr(body.id), bind_as: body.bind_as, else_error: body.else_error } };
    }
    if (kind === 'Guard') {
      return { Guard: { cond: serializeExpr(body.cond), else_error: body.else_error } };
    }
    if (kind === 'Let') {
      return { Let: { bind_as: body.bind_as, expr: serializeExpr(body.expr) } };
    }
    if (kind === 'DeleteWhere') {
      return { DeleteWhere: { table: body.table, filter: body.filter.map((f) => ({ field: f.field, op: f.op, value: serializeExpr(f.value) })) } };
    }
    if (kind === 'InsertEach') {
      const values = dict();
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { InsertEach: { table: body.table, source: serializeExpr(body.source), item_as: body.item_as, values } };
    }
    if (kind === 'AssetCollection') {
      return { AssetCollection: structuredClone(body) };
    }
    if (kind === 'AssertSourceChanged') {
      return {
        AssertSourceChanged: {
          table: body.table,
          id: serializeExpr(body.id),
          operation: body.operation,
        },
      };
    }
    if (kind === 'AssertCurrentRelation') {
      return {
        AssertCurrentRelation: {
          table: body.table,
          id: serializeExpr(body.id),
          scope_table: body.scope_table,
          scope_id: serializeExpr(body.scope_id),
          foreign_key_field: body.foreign_key_field,
          incarnation_field: body.incarnation_field,
          else_error: body.else_error,
        },
      };
    }
    if (kind === 'Delete') {
      return { Delete: { table: body.table, id: serializeExpr(body.id) } };
    }
    throw new TypeError(`${functionName}: unsupported mutation step ${kind}`);
  });
  let return_value = null;
  const rv = plan.return_value;
  if (rv) {
    if (rv.kind === 'ChangedCount') return_value = 'ChangedCount';
    else if ('Binding' in rv) return_value = { Binding: rv.Binding };
    else if ('Literal' in rv) return_value = { Literal: rv.Literal };
    else if ('Document' in rv) return_value = { Document: { table: rv.Document.table, id: serializeExpr(rv.Document.id) } };
    else if ('Expr' in rv) return_value = { Expr: serializeExpr(rv.Expr) };
  }
  const ownerWriteChecks = tables === null ? [] : steps.flatMap((step, stepIndex) => {
    const [kind, body] = Object.entries(step)[0] ?? [];
    if (!['Patch', 'Delete'].includes(kind)) return [];
    if (tables[body.table]?.visibility?.kind !== 'owner') return [];
    if (options.standardPattern?.helper === 'owned-crud.v1') {
      const writeForm = kind === 'Patch' ? 'patch' : 'delete';
      const refusal = {
        code: 'SNAPBACK_ROW_NOT_FOUND',
        message: 'owner-policy row is unavailable',
        details: { table: body.table, writeForm },
      };
      return [{
        stepIndex,
        absent: {
          kind: 'refuse',
          ...refusal,
          digest: `sha256:${sha256(canonicalResultJson(refusal))}`,
        },
      }];
    }
    return [{ stepIndex, absent: { kind: 'no-effect' } }];
  });
  const serialized = {
    steps,
    return_value,
    ...(ownerWriteChecks.length === 0 ? {} : { ownerWriteChecks }),
  };
  if (functionName && err) {
    if (steps.length > MAX_PLAN_STEPS) {
      err('MUTATION_PLAN_BOUNDS', 'function', `${functionName}: plan has ${steps.length} steps; the declared bound is ${MAX_PLAN_STEPS}`, { function: functionName });
    }
    const bytes = JSON.stringify(serialized).length;
    if (bytes > MAX_PLAN_SERIALIZED_BYTES) {
      err('MUTATION_PLAN_BOUNDS', 'function', `${functionName}: plan serializes to ${bytes} bytes; the declared bound is ${MAX_PLAN_SERIALIZED_BYTES}`, { function: functionName });
    }
    for (const expr of planExprs(serialized)) {
      if (exprDepth(expr) > MAX_EXPR_DEPTH) {
        err('MUTATION_PLAN_BOUNDS', 'function', `${functionName}: expression depth exceeds the declared bound (${MAX_EXPR_DEPTH})`, { function: functionName });
        break;
      }
    }
  }
  return serialized;
}

function serializeActionPlan(plan, functionName, err) {
  if (!plan || !Array.isArray(plan.steps)) {
    err('ACTION_INVALID_PLAN', 'function', `${functionName}: action plan must have steps`, { function: functionName });
    return { steps: [], returnValue: null };
  }
  const steps = plan.steps.map((step) => {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind !== 'RunMutation') {
      err('ACTION_UNSUPPORTED_STEP', 'function', `${functionName}: unsupported action step ${kind}`, { function: functionName, step: kind });
      return null;
    }
    const args = dict();
    for (const [k, e] of Object.entries(body.args ?? {})) {
      if (!e || !e.__expr) {
        err('ACTION_INVALID_EXPR', 'function', `${functionName}: runMutation arg ${k} is not a value expression`, { function: functionName, arg: k });
        continue;
      }
      args[k] = serializeExpr(e);
    }
    return { RunMutation: { name: body.name, args, bind_result_as: body.bind_result_as } };
  }).filter(Boolean);
  let return_value = null;
  const rv = plan.return_value;
  if (rv) {
    if (rv.kind === 'ChangedCount') return_value = 'ChangedCount';
    else if (rv.kind === 'LastMutationResult') return_value = 'LastMutationResult';
    else if ('Binding' in rv) return_value = { Binding: rv.Binding };
    else if ('Literal' in rv) return_value = { Literal: rv.Literal };
  }
  return { steps, returnValue: return_value };
}

function buildCronJobs(cronDefs, functions, err) {
  const functionsByName = new Map(functions.map((fn) => [fn.name, fn]));
  const jobs = [];
  const seen = new Set();
  for (const { def } of cronDefs) {
    for (const [name, spec] of Object.entries(def.jobs)) {
      if (seen.has(name)) {
        err('CRON_DUPLICATE_JOB', 'cron', `duplicate cron job ${name}`, { jobName: name });
        continue;
      }
      seen.add(name);
      if (!IDENT.test(name)) {
        err('CRON_INVALID_IDENTIFIER', 'cron', `invalid cron job identifier ${name}`, { jobName: name });
        continue;
      }
      const schedule = normalizeCronSchedule(name, spec.schedule, err);
      const action = spec.action;
      if (typeof action !== 'string' || action.length === 0) {
        err('CRON_ACTION_MISSING', 'cron', `${name}: cron job requires an action`, { jobName: name });
      } else if (!functionsByName.has(action)) {
        err('CRON_ACTION_UNKNOWN', 'cron', `${name}: unknown action ${action}`, { jobName: name, action });
      } else if (functionsByName.get(action).kind !== 'Action') {
        err('CRON_ACTION_KIND_MISMATCH', 'cron', `${name}: ${action} is not an action`, { jobName: name, action, kind: functionsByName.get(action).kind });
      } else if ((functionsByName.get(action).authRequirement ?? 'optional-user') === 'authenticated') {
        err('CRON_AUTH_REQUIREMENT_INVALID', 'cron', `${name}: authenticated action ${action} cannot run as system authority`, {
          jobName: name,
          action,
          authRequirement: 'authenticated',
        });
      }
      jobs.push({
        name,
        schedule,
        action,
        enabled: spec.enabled ?? true,
        activation: normalizeActivation(spec.activation),
        jitterPolicy: normalizeJitterPolicy(spec.schedule, spec),
        overlapPolicy: spec.overlapPolicy ?? 'NoOverlap',
        retryPolicy: spec.retryPolicy ?? { mode: 'NextTick' },
        requiredCapabilities: ['cron', 'cron_action_run_mutation'],
        targetWakeup: normalizeTargetWakeup(schedule, spec.activation),
        sourceSpan: null,
      });
    }
  }
  return jobs;
}

// @ref LLP 0036#declared-configuration-in-the-manifest — config entries are
// validated the way cron jobs are: duplicates, bad identifiers, unknown or
// non-action probes, and (v1) non-secret entries all fail closed here, before
// the server validates the same facts again at manifest load.
function buildConfigEntries(configDefs, functions, err, pushUses = []) {
  const functionKinds = new Map(functions.map((fn) => [fn.name, fn.kind]));
  const declared = new Set();
  const entries = [];
  const CONFIG_IDENT = /^[A-Za-z0-9_-]+$/;
  for (const { def } of configDefs) {
    for (const [name, spec] of Object.entries(def.entries)) {
      if (declared.has(name)) {
        err('CONFIG_DUPLICATE_ENTRY', 'config', `duplicate config entry ${name}`, { entry: name });
        continue;
      }
      declared.add(name);
      if (!CONFIG_IDENT.test(name)) {
        err('CONFIG_INVALID_IDENTIFIER', 'config', `invalid config entry name ${name}`, { entry: name });
        continue;
      }
      if (spec.secret === false) {
        err('CONFIG_NON_SECRET_UNIMPLEMENTED', 'config', `${name}: non-secret config entries are not implemented yet (LLP 0036 v1 is secret entries only)`, { entry: name });
        continue;
      }
      if (spec.default !== undefined) {
        err('CONFIG_DEFAULT_UNIMPLEMENTED', 'config', `${name}: defaults belong to non-secret entries, which are not implemented yet`, { entry: name });
        continue;
      }
      if (spec.probe !== undefined) {
        if (!functionKinds.has(spec.probe)) {
          err('CONFIG_PROBE_UNKNOWN', 'config', `${name}: unknown probe ${spec.probe}`, { entry: name, probe: spec.probe });
          continue;
        }
        if (functionKinds.get(spec.probe) !== 'Action') {
          err('CONFIG_PROBE_KIND_MISMATCH', 'config', `${name}: probe ${spec.probe} is not an action`, { entry: name, probe: spec.probe, kind: functionKinds.get(spec.probe) });
          continue;
        }
      }
      entries.push({
        name,
        description: spec.description ?? null,
        purpose: spec.purpose ?? null,
        secret: true,
        required: spec.required ?? true,
        pool: Boolean(spec.pool),
        probe: spec.probe ?? null,
        howToGet: spec.howToGet ?? null,
        // Omitted (not null) when absent: the server treats an explicit null
        // acquisition as present-but-empty rather than absent.
        ...(spec.acquisition !== undefined ? { acquisition: spec.acquisition } : {}),
        sourceSpan: null,
      });
    }
  }
  // D8: every `uses` grant names a declared entry; an unknown name would fail
  // at runtime with SNAPBACK_CONFIG_UNDECLARED, so catch it at codegen time.
  for (const fn of functions) {
    for (const name of fn.uses ?? []) {
      if (!declared.has(name)) {
        err('CONFIG_USES_UNKNOWN', 'config', `${fn.name}: uses names ${name}, which is not a declared config entry`, { function: fn.name, entry: name });
      }
    }
  }
  for (const name of pushUses) {
    if (!declared.has(name)) {
      err('CONFIG_USES_UNKNOWN', 'config', `definePushSeam uses names ${name}, which is not a declared config entry`, { surface: 'definePushSeam', entry: name });
    }
  }
  return entries;
}

function normalizeCronSchedule(name, schedule, err) {
  if (!schedule || typeof schedule !== 'object') {
    err('CRON_INVALID_SCHEDULE', 'cron', `${name}: cron job requires a schedule object`, { jobName: name });
    return {};
  }
  const hasEvery = Number.isInteger(schedule.everyMs);
  const hasCron = typeof schedule.cron === 'string';
  if (hasEvery === hasCron) {
    err('CRON_INVALID_SCHEDULE', 'cron', `${name}: specify exactly one of schedule.everyMs or schedule.cron`, { jobName: name });
    return {};
  }
  if (hasEvery) {
    if (schedule.everyMs < 1_000) {
      err('CRON_TARGET_CADENCE_UNSUPPORTED', 'cron', `${name}: local cron floor is 1000ms`, { jobName: name, everyMs: schedule.everyMs });
    }
    return { everyMs: schedule.everyMs };
  }
  if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(schedule.cron.trim())) {
    err('CRON_INVALID_EXPRESSION', 'cron', `${name}: cron expression must have five fields`, { jobName: name, cron: schedule.cron });
  }
  return { cron: schedule.cron.trim() };
}

function normalizeActivation(value) {
  if (!value || value === 'always') {
    return { kind: 'Always', whileLive: [] };
  }
  if (value.whileLive) {
    return { kind: 'WhileLive', whileLive: [...value.whileLive] };
  }
  return { kind: 'Always', whileLive: [] };
}

function normalizeJitterPolicy(schedule, spec) {
  const explicit = spec.jitter ?? schedule?.jitter;
  const enabled = explicit === false ? false : true;
  return { enabled, maxOffsetMs: spec.jitterMaxMs ?? 0 };
}

function normalizeTargetWakeup(schedule, activation) {
  if (schedule.everyMs) {
    return {
      kind: schedule.everyMs < 60_000 || activation?.whileLive ? 'DynamicAlarm' : 'IntervalMs',
      needsDurableRunner: true,
    };
  }
  return { kind: 'CronExpression', needsDurableRunner: true };
}

function validateActionPlans(functions, err) {
  const functionKinds = new Map(functions.map((fn) => [fn.name, fn.kind]));
  for (const fn of functions) {
    const steps = fn.runtime?.HostPlan?.Action?.steps ?? [];
    for (const step of steps) {
      const call = step.RunMutation;
      if (!call) {
        err('ACTION_UNSUPPORTED_STEP', 'function', `${fn.name}: unsupported action step`, { function: fn.name, step });
        continue;
      }
      if (!functionKinds.has(call.name)) {
        err('ACTION_MUTATION_UNKNOWN', 'function', `${fn.name}: unknown mutation ${call.name}`, { function: fn.name, mutation: call.name });
      } else if (functionKinds.get(call.name) !== 'Mutation') {
        err('ACTION_MUTATION_KIND_MISMATCH', 'function', `${fn.name}: ${call.name} is not a mutation`, { function: fn.name, mutation: call.name, kind: functionKinds.get(call.name) });
      }
    }
  }
}

function mutationReadTables(plan) {
  const reads = new Set();
  for (const step of plan.steps) {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'AssetCollection') {
      reads.add(body.ownerTable);
      reads.add(body.childTable);
      for (const table of body.sharingDerivationTables ?? []) reads.add(table);
    }
    if (kind === 'Patch' || kind === 'Delete' || kind === 'Get' || kind === 'DeleteWhere' || kind === 'AssertSourceChanged') {
      reads.add(body.table);
    }
    if (kind === 'AssertCurrentRelation') {
      reads.add(body.table);
      reads.add(body.scope_table);
    }
  }
  // @ref LLP 0275#d8-explicit-profile-classification-under-llp-0295-d03-2026-08-21
  // — resolving ReturnValue::Document performs a storage read even when no
  // step names that table. Publish it so patch-A/return-B cannot under-report.
  if (plan.return_value?.Document?.table) {
    reads.add(plan.return_value.Document.table);
  }
  return [...reads];
}

const GENERATED_LOCAL_MUTATION_FORMAT_V1 = 'snapback.generated-mutation-ir.v1';
const GENERATED_LOCAL_MUTATION_EFFECT_CLASS_V1 =
  'snapback.browser-ir.insert-get-guard-patch.v1';
const GENERATED_LOCAL_MUTATION_STEPS_V1 = new Set(['Insert', 'Get', 'Guard', 'Patch', 'Delete']);
const GENERATED_LOCAL_MUTATION_AUTHORITATIVE_EXPRESSIONS_V1 = new Set([
  'AuthKind',
  'AuthActorKind',
  'AuthActivityActorKind',
  'AuthActorUserId',
  'AuthGrantId',
  'ClientMutationDigest',
  'AuthIsDelegated',
  'MembershipExists',
]);

function generatedMutationPlanExpressions(plan) {
  const expressions = [];
  for (const step of plan?.steps ?? []) {
    const kind = Object.keys(step ?? {})[0];
    const body = step?.[kind];
    if (body?.id !== undefined) expressions.push(body.id);
    if (body?.cond !== undefined) expressions.push(body.cond);
    if (body?.values && typeof body.values === 'object') {
      expressions.push(...Object.values(body.values));
    }
  }
  if (plan?.return_value?.Document?.id !== undefined) {
    expressions.push(plan.return_value.Document.id);
  }
  if (plan?.return_value?.Expr !== undefined) expressions.push(plan.return_value.Expr);
  return expressions;
}

function generatedMutationExpressionKinds(expression, into = new Set()) {
  if (typeof expression === 'string') {
    into.add(expression);
    return into;
  }
  if (expression === null || typeof expression !== 'object') return into;
  const kind = Object.keys(expression)[0];
  if (typeof kind !== 'string') return into;
  into.add(kind);
  const body = expression[kind];
  if (kind === 'Field') generatedMutationExpressionKinds(body?.base, into);
  if (kind === 'Binary') {
    generatedMutationExpressionKinds(body?.left, into);
    generatedMutationExpressionKinds(body?.right, into);
  }
  if (kind === 'Unary') generatedMutationExpressionKinds(body?.expr, into);
  if (kind === 'If') {
    generatedMutationExpressionKinds(body?.cond, into);
    generatedMutationExpressionKinds(body?.then, into);
    generatedMutationExpressionKinds(body?.else, into);
  }
  if (kind === 'Concat' && Array.isArray(body)) {
    for (const part of body) generatedMutationExpressionKinds(part, into);
  }
  if (kind === 'Call' && Array.isArray(body?.args)) {
    for (const argument of body.args) generatedMutationExpressionKinds(argument, into);
  }
  if (kind === 'Record' && body?.fields && typeof body.fields === 'object') {
    for (const field of Object.values(body.fields)) {
      generatedMutationExpressionKinds(field, into);
    }
  }
  return into;
}

function collectGeneratedMutationBindingFields(expression, binding, fields) {
  if (expression === null || typeof expression !== 'object') return;
  const kind = Object.keys(expression)[0];
  const body = expression[kind];
  if (
    kind === 'Field'
    && body?.base?.Binding === binding
    && typeof body.key === 'string'
  ) fields.add(body.key);
  if (kind === 'Field') collectGeneratedMutationBindingFields(body?.base, binding, fields);
  if (kind === 'Binary') {
    collectGeneratedMutationBindingFields(body?.left, binding, fields);
    collectGeneratedMutationBindingFields(body?.right, binding, fields);
  }
  if (kind === 'Unary') collectGeneratedMutationBindingFields(body?.expr, binding, fields);
  if (kind === 'If') {
    collectGeneratedMutationBindingFields(body?.cond, binding, fields);
    collectGeneratedMutationBindingFields(body?.then, binding, fields);
    collectGeneratedMutationBindingFields(body?.else, binding, fields);
  }
  if (kind === 'Concat' && Array.isArray(body)) {
    for (const part of body) collectGeneratedMutationBindingFields(part, binding, fields);
  }
  if (kind === 'Call' && Array.isArray(body?.args)) {
    for (const argument of body.args) {
      collectGeneratedMutationBindingFields(argument, binding, fields);
    }
  }
  if (kind === 'Record' && body?.fields && typeof body.fields === 'object') {
    for (const field of Object.values(body.fields)) {
      collectGeneratedMutationBindingFields(field, binding, fields);
    }
  }
}

// @ref LLP 0155#execution-contract — the generated reference is the sole
// authored write carrier: exact plan/source identity, effect ceiling, read
// requirements, and capability class travel together to the browser.
function generatedMutationIrV1(fn, schemaManifest, expectedGeneration, authoredSourceHash) {
  if (fn.kind !== 'Mutation') return null;
  const hostPlan = fn.runtime?.HostPlan;
  const plan = hostPlan?.Mutation ?? hostPlan?.WriteWithActivity?.mutation ?? null;
  if (!plan) return null;

  let capabilityClass = 'local-executable';
  let capabilityCode = 'SNAPBACK_GENERATED_IR_LOCAL_EXECUTABLE';
  const requirements = new Map();
  const expressions = generatedMutationPlanExpressions(plan);
  const expressionKinds = new Set();
  for (const expression of expressions) {
    generatedMutationExpressionKinds(expression, expressionKinds);
  }
  if (hostPlan?.Mutation === undefined) {
    capabilityClass = 'server-only';
    capabilityCode = 'SNAPBACK_GENERATED_IR_HOST_WRAPPER_SERVER_ONLY';
  } else if ((plan.steps ?? []).some((step) => (
    !GENERATED_LOCAL_MUTATION_STEPS_V1.has(Object.keys(step ?? {})[0])
  ))) {
    capabilityClass = 'server-only';
    capabilityCode = 'SNAPBACK_GENERATED_IR_EFFECT_SERVER_ONLY';
  } else if ([...expressionKinds].some((kind) => (
    GENERATED_LOCAL_MUTATION_AUTHORITATIVE_EXPRESSIONS_V1.has(kind)
  ))) {
    capabilityClass = 'server-only';
    capabilityCode = 'SNAPBACK_GENERATED_IR_AUTHORITATIVE_EXPR_SERVER_ONLY';
  } else if (expressionKinds.has('RuntimeId')) {
    // RuntimeId is in the M1 evaluator ceiling, but a branch-dependent mint
    // stream needs a generated claim-program rather than a static site list.
    // Phase-1's Insert/Get/Guard/Patch common path needs only Insert row ids.
    capabilityClass = 'server-only';
    capabilityCode = 'SNAPBACK_GENERATED_IR_DYNAMIC_MINT_SERVER_ONLY';
  }

  const insertedIdBindings = new Set();
  const writtenPointKeys = new Set();
  for (const step of plan.steps ?? []) {
    const kind = Object.keys(step ?? {})[0];
    const body = step[kind];
    if (kind === 'Insert' && typeof body?.bind_id_as === 'string') {
      insertedIdBindings.add(body.bind_id_as);
      continue;
    }
    if (kind !== 'Get' && kind !== 'Patch' && kind !== 'Delete') continue;
    if (
      kind === 'Get'
      && body?.id?.Binding !== undefined
      && insertedIdBindings.has(body.id.Binding)
    ) continue;
    const pointKey = typeof body?.id?.Arg === 'string'
      ? `${body.table}\u0000${body.id.Arg}`
      : null;
    if (kind === 'Get' && pointKey !== null && writtenPointKeys.has(pointKey)) continue;
    if (
      body?.id === null
      || typeof body?.id !== 'object'
      || Object.keys(body.id).length !== 1
      || typeof body.id.Arg !== 'string'
    ) {
      capabilityClass = 'server-only';
      capabilityCode = 'SNAPBACK_GENERATED_IR_POINT_ID_SERVER_ONLY';
      continue;
    }
    const key = pointKey;
    const current = requirements.get(key) ?? {
      kind: 'point',
      table: body.table,
      idArg: body.id.Arg,
      binding: null,
      requiredFields: ['_id'],
    };
    if (kind === 'Get') {
      if (current.binding !== null && current.binding !== body.bind_as) {
        capabilityClass = 'server-only';
        capabilityCode = 'SNAPBACK_GENERATED_IR_POINT_BINDING_SERVER_ONLY';
      }
      current.binding = body.bind_as;
    }
    requirements.set(key, current);
    if (kind === 'Patch' || kind === 'Delete') writtenPointKeys.add(key);
  }
  for (const requirement of requirements.values()) {
    if (requirement.binding === null) continue;
    const fields = new Set(requirement.requiredFields);
    for (const expression of expressions) {
      collectGeneratedMutationBindingFields(expression, requirement.binding, fields);
    }
    requirement.requiredFields = [...fields].sort();
  }

  const schema = {
    tables: (schemaManifest.tables ?? []).map((table) => ({
      name: table.name,
      fields: (table.fields ?? []).map((field) => ({ name: field.name })),
    })),
  };
  const mintSites = (plan.steps ?? []).flatMap((step, stepIndex) => (
    Object.keys(step ?? {})[0] === 'Insert'
      ? [`plan/steps/${stepIndex}/insert/row-id`]
      : []
  ));
  const declaredReads = [...new Set(
    [...requirements.values()].map((requirement) => requirement.table),
  )];
  const descriptor = {
    format: GENERATED_LOCAL_MUTATION_FORMAT_V1,
    sourceIdentity: {
      functionId: fn.id,
      implementationHash: fn.implementationHash,
      activation: expectedGeneration,
      authoredSourceHash,
    },
    schemaIdentity: {
      schemaVersion: expectedGeneration.schemaVersion,
      appId: expectedGeneration.appId,
      schemaHash: expectedGeneration.schemaHash,
    },
    capabilityClass,
    capabilityCode,
    declaredEffectClass: GENERATED_LOCAL_MUTATION_EFFECT_CLASS_V1,
    declaredReads,
    localReadRequirements: [...requirements.values()],
    schema,
    plan,
    mintSites,
    usesRuntimeNow: expressionKinds.has('RuntimeNow'),
    boundedSkew: fn.boundedSkew ?? null,
  };
  return {
    ...descriptor,
    operationHash: compositionDomainHash(
      'snapback:generated-mutation-ir:v1:',
      descriptor,
    ),
  };
}

// Nested v.object field names are emitted as unquoted TS property names by
// typeForValidator (api.d.ts, runtime-links.ts, per-binding Args types) and as
// manifest keys, so they must satisfy IDENT like every other codegen
// namespace. Recurses through nested objects; reports each bad name once via
// the caller-supplied diagnostic emitter (reserved words are fine here —
// property positions accept them).
function checkObjectValidatorFieldIdents(val, where, report) {
  if (!val?.__validator) return;
  if (val.resultKind === 'array' && val.element?.__validator) {
    checkObjectValidatorFieldIdents(val.element, `${where}[]`, report);
    return;
  }
  if (val.resultKind === 'union' && Array.isArray(val.variants)) {
    for (const [index, variant] of val.variants.entries()) {
      checkObjectValidatorFieldIdents(variant, `${where}|${index}`, report);
    }
    return;
  }
  if (val.primitive !== 'object') return;
  for (const [fieldName, field] of Object.entries(val.fields ?? {})) {
    if (!IDENT.test(fieldName)) {
      report(fieldName, where);
      continue;
    }
    checkObjectValidatorFieldIdents(field, `${where}.${fieldName}`, report);
  }
}

// Stored unions are the one deliberately admitted recursive shape at the
// schema-field position. Keep this pre-check separate so no other closed
// position (ephemeral scope/value or legacy result) inherits the widening.
// @ref LLP 0004#dated-alignment-stored-literal-union-domains-2026-08-08
function isStoredLiteralUnionCandidate(val) {
  return val?.resultKind === 'union'
    && Array.isArray(val.variants)
    && val.variants.length > 0
    && val.variants.every((variant) => (
      variant?.resultKind === 'literal' && typeof variant.literal === 'string'
    ));
}

function validateStoredLiteralUnion(val, where, report) {
  if (val?.resultKind !== 'union') return { matched: false, values: null };
  const fail = (message) => {
    report(`${where} ${message}; stored unions must be closed string-literal domains`);
    return { matched: true, values: null };
  };
  if (val.__validator !== true || val.primitive !== 'union') {
    return fail('must be a Snapback v.union(...) validator');
  }
  if (!Array.isArray(val.variants)) {
    return fail('union validator must carry a variants array');
  }
  // Seven, not the argument grammar's eight: an optional field's document
  // contract expands to null|…, and LLP 0108 bounds a result union at eight.
  // One bound for required and optional avoids an evolution trap where making
  // an eight-value domain optional would refuse later.
  if (val.variants.length < 2 || val.variants.length > 7) {
    return fail(`union validator must carry 2–7 variants (got ${val.variants.length})`);
  }
  if (typeof val.optional !== 'boolean') {
    return fail('union validator optional must be boolean');
  }
  const values = [];
  const seen = new Set();
  for (const [index, variant] of val.variants.entries()) {
    const label = `union variant ${index + 1}`;
    if (variant?.__validator !== true || variant.resultKind !== 'literal') {
      return fail(`${label} must be v.literal(...)`);
    }
    if (variant.optional !== false) {
      return fail(`${label} must be required, not v.optional(...)`);
    }
    if (typeof variant.literal !== 'string') {
      return fail(`${label} must be a string literal`);
    }
    const bytes = Buffer.byteLength(variant.literal, 'utf8');
    if (bytes === 0) {
      return fail(`${label} must be a non-empty string literal`);
    }
    if (bytes > 64) {
      return fail(`${label} is ${bytes} UTF-8 bytes; the maximum is 64`);
    }
    if (seen.has(variant.literal)) {
      return fail(`${label} duplicates ${JSON.stringify(variant.literal)}; values must be unique`);
    }
    seen.add(variant.literal);
    values.push(variant.literal);
  }
  return { matched: true, values };
}

function structuredNullableScalarHint(val, where) {
  if (val?.resultKind !== 'union' || !Array.isArray(val.variants)) return null;
  const nulls = val.variants.filter((variant) => variant?.resultKind === 'null');
  if (nulls.length !== 1) return null;
  const nonNull = val.variants.filter((variant) => variant?.resultKind !== 'null');
  const literalDomain = nonNull.length >= 2 && nonNull.every((variant) => (
    variant?.resultKind === 'literal' && typeof variant.literal === 'string'
  ));
  if (literalDomain) {
    return {
      code: 'SCHEMA_STRUCTURED_NULLABLE_LITERAL_UNION_HINT',
      severity: 'warning',
      subsystem: 'schema',
      message: `${where} is stored as opaque structured JSON; if this is a nullable closed string domain, use v.optional(v.union([...string literals])) to retain the Enum path`,
      details: { field: where, suggestedValidator: 'v.optional(v.union([...string literals]))' },
    };
  }
  if (nonNull.length === 1 && ['String', 'Boolean', 'Integer', 'Real'].includes(nonNull[0]?.fieldType)) {
    return {
      code: 'SCHEMA_STRUCTURED_NULLABLE_SCALAR_HINT',
      severity: 'warning',
      subsystem: 'schema',
      message: `${where} is stored as opaque structured JSON; if this is a nullable scalar column, use v.optional(<scalar>) to retain scalar predicates and indexes`,
      details: { field: where, suggestedValidator: 'v.optional(<scalar>)' },
    };
  }
  return null;
}

// Storage-position admissibility is deliberately narrower than the shared
// argument/result grammar. Keep every refused class explicit: adding a new
// builder must choose a row here instead of falling through to Json.
// @ref LLP 0211#declaration-closed-dispatch-closed-interior
function validateStoredStructuredValidator(
  val,
  where,
  report,
  seen = new Set(),
  position = 'root',
) {
  const fail = (code, reason, details = {}) => {
    report(code, `${where} ${reason}; structured stored interiors are closed by LLP 0211`, details);
    return false;
  };
  if (!val || typeof val !== 'object' || val.__validator !== true) {
    return fail('SCHEMA_STRUCTURED_VALIDATOR_INVALID', 'must be a Snapback validator');
  }
  if (seen.has(val)) {
    return fail('SCHEMA_STRUCTURED_VALIDATOR_CYCLIC', 'contains a cyclic validator shape');
  }
  if (typeof val.optional !== 'boolean') {
    return fail('SCHEMA_STRUCTURED_OPTIONAL_POSITION_INVALID', 'must carry boolean optionality');
  }
  if (val.optional && position !== 'root' && position !== 'objectMember') {
    return fail(
      'SCHEMA_STRUCTURED_OPTIONAL_POSITION_INVALID',
      'uses v.optional(...) outside the top-level column or an object-member position; omission is not an array/union value',
      { position },
    );
  }
  if (val.resultKind === 'vector' || val.fieldType?.Vector !== undefined) {
    return fail(
      'SCHEMA_STRUCTURED_VECTOR_INTERIOR_UNSUPPORTED',
      'contains v.vector(), whose binary64 representation, dimensions, and index eligibility cannot hide in canonical JSON',
    );
  }
  if (val.fieldType?.AssetRef !== undefined) {
    return fail(
      'SCHEMA_STRUCTURED_ASSET_REF_INTERIOR_UNSUPPORTED',
      'contains v.assetRef(), whose authority and lifecycle machinery requires an addressable top-level field',
    );
  }
  if (val.fieldType?.Id !== undefined) {
    return fail(
      'SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED',
      'contains v.id(), whose referential-integrity lifecycle cannot hide in an opaque value',
    );
  }
  if (val.fieldType?.RelationIncarnation !== undefined) {
    return fail(
      'SCHEMA_STRUCTURED_RELATION_INTERIOR_UNSUPPORTED',
      'contains v.relationIncarnationOf(), which is framework-authored lifecycle state',
    );
  }
  if (val.primitive === 'platformSchemaRef' || val.primitive === 'appSchemaRef'
      || val.fieldType?.PlatformSchemaRef !== undefined || val.fieldType?.AppSchemaRef !== undefined) {
    return fail(
      'SCHEMA_STRUCTURED_PLATFORM_REF_INTERIOR_UNSUPPORTED',
      'contains a platform/application schema reference, which is not an admitted stored plain-data leaf',
    );
  }
  if (val.resultKind === 'tuple') {
    return fail(
      'SCHEMA_STRUCTURED_TUPLE_INTERIOR_UNSUPPORTED',
      'contains v.tuple(), which is deferred from stored structured v1',
    );
  }
  if (val.resultKind === 'null') {
    return position === 'unionVariant'
      ? true
      : fail(
          'SCHEMA_STRUCTURED_NULL_POSITION_INVALID',
          'contains v.null() outside a union variant; explicit null is a union member',
          { position },
        );
  }
  if (val.resultKind === 'literal') {
    const literal = val.literal;
    return literal === null || typeof literal === 'string' || typeof literal === 'boolean'
      || (typeof literal === 'number' && Number.isFinite(literal))
      || fail('SCHEMA_STRUCTURED_LITERAL_INVALID', 'contains a non-finite or non-scalar literal');
  }

  const recurse = (children) => {
    seen.add(val);
    let valid = true;
    for (const [childWhere, child, childPosition] of children) {
      if (!validateStoredStructuredValidator(child, childWhere, report, seen, childPosition)) {
        valid = false;
      }
    }
    seen.delete(val);
    return valid;
  };
  if (val.resultKind === 'array') {
    if (!val.element?.__validator) {
      return fail('SCHEMA_STRUCTURED_ARRAY_INVALID', 'array node has no element validator');
    }
    const maxItems = val.resultOptions?.maxItems;
    if (maxItems !== undefined
        && (!Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > 1_024)) {
      return fail('SCHEMA_STRUCTURED_ARRAY_INVALID', 'array maxItems must be in 0..1024');
    }
    return recurse([[`${where}[]`, val.element, 'arrayElement']]);
  }
  if (val.resultKind === 'union') {
    if (!Array.isArray(val.variants) || val.variants.length < 2 || val.variants.length > 8) {
      return fail('SCHEMA_STRUCTURED_UNION_INVALID', 'union must carry 2–8 variants');
    }
    return recurse(val.variants.map((variant, index) => [
      `${where}|${index}`,
      variant,
      'unionVariant',
    ]));
  }
  if (val.primitive === 'object') {
    if (!val.fields || typeof val.fields !== 'object' || Array.isArray(val.fields)) {
      return fail('SCHEMA_STRUCTURED_OBJECT_INVALID', 'object node must carry a fields object');
    }
    return recurse(Object.entries(val.fields).map(([name, field]) => [
      `${where}.${name}`,
      field,
      'objectMember',
    ]));
  }
  if (val.fieldType === 'Json' || val.primitive === 'unknown') {
    return fail(
      'SCHEMA_STRUCTURED_JSON_INTERIOR_UNSUPPORTED',
      'contains v.json(), an unvalidated escape hatch inside a declared validated value',
    );
  }
  const admittedScalar = (
    (val.fieldType === 'String' && val.primitive === 'string')
    || (val.fieldType === 'Principal' && val.primitive === 'string')
    || (val.fieldType === 'Boolean' && val.primitive === 'boolean')
    || (['Integer', 'Real'].includes(val.fieldType) && val.primitive === 'number')
  );
  return admittedScalar || fail(
    'SCHEMA_STRUCTURED_INTERIOR_UNSUPPORTED',
    `contains unsupported validator primitive/field type ${JSON.stringify(val.primitive)}/${JSON.stringify(val.fieldType)}`,
  );
}

// One recursive gate for every authoring position that accepts a validator:
// schema fields, function args/results, and ephemeral scope/value shapes.
// Builders catch ordinary mistakes early, but definition objects are mutable
// JavaScript; codegen must re-establish the closed vocabulary before emitting.
//
// The gate stays one recursive function with a per-position grammar
// parameter (LLP 0131 §One argument grammar): ARGUMENT positions admit the
// full LLP 0108 recursive v1 value vocabulary — v.null/v.literal/v.array/
// v.union plus the platform-constructed SchemaRef — while schema fields,
// ephemeral scope/value shapes, and the legacy `result` position keep the
// closed scalar primitive map (widening them is CV-4b's and later work).
function validateAuthoringValidator(val, where, report, seen = new Set(), position = 'closed') {
  if (!val || typeof val !== 'object' || val.__validator !== true) {
    report(`${where} must be a Snapback validator (v.string(), v.object(), ...)`);
    return false;
  }
  if (seen.has(val)) {
    report(`${where} contains a cyclic validator shape`);
    return false;
  }
  if (val.resultKind === 'vector') {
    const dimensions = val.fieldType?.Vector?.dimensions;
    if (
      val.primitive !== 'vector'
      || dimensions !== val.dimensions
      || !Number.isSafeInteger(dimensions)
      || dimensions < 1
      || dimensions > 4_096
      || Object.keys(val.fieldType ?? {}).length !== 1
      || Object.keys(val.fieldType?.Vector ?? {}).length !== 1
    ) {
      report(`${where} vector validator must carry one exact dimension in 1..4096`);
      return false;
    }
    return typeof val.optional === 'boolean';
  }
  const argument = position === 'argument';
  if (argument) {
    const recurse = (children) => {
      seen.add(val);
      let valid = true;
      for (const [childWhere, child] of children) {
        if (!validateAuthoringValidator(child, childWhere, report, seen, position)) valid = false;
      }
      seen.delete(val);
      return valid;
    };
    if (val.primitive === 'platformSchemaRef') {
      const reference = val.fieldType?.PlatformSchemaRef;
      if (reference?.authority !== 'platform' || reference?.schema !== SEARCH_QUERY_AST_SCHEMA_REF) {
        report(`${where} references unregistered schema ${JSON.stringify(reference?.schema)}`);
        return false;
      }
      return true;
    }
    if (val.resultKind === 'null' || val.resultKind === 'literal') return true;
    if (val.resultKind === 'array') {
      if (!val.element?.__validator) {
        report(`${where} array validator must carry an element validator`);
        return false;
      }
      return recurse([[`${where}[]`, val.element]]);
    }
    if (val.resultKind === 'union') {
      if (!Array.isArray(val.variants) || val.variants.length < 2 || val.variants.length > 8) {
        report(`${where} union validator must carry 2–8 variants`);
        return false;
      }
      return recurse(val.variants.map((variant, index) => [`${where}|${index}`, variant]));
    }
  }
  const primitives = new Map([
    ['string', new Set(['String', 'Principal'])],
    ['boolean', new Set(['Boolean'])],
    ['number', new Set(['Integer', 'Real'])],
    ['unknown', new Set(['Json'])],
    ['object', new Set(['Json'])],
  ]);
  const idTable = idFieldTypeTable(val.fieldType);
  const relationIncarnation = val.fieldType?.RelationIncarnation;
  const assetRef = val.fieldType?.AssetRef;
  if (!primitives.get(val.primitive)?.has(val.fieldType)
      && !(val.primitive === 'string' && (idTable !== null || relationIncarnation || assetRef))) {
    const arrayHint = val.primitive === 'array'
      ? ' (table fields have no array node; store the field as v.json() and narrow it with v.array(...) in the result contract of any function that returns it, or model one row per element — see guide/getting-started/your-first-backend.md#declare-the-schema)'
      : '';
    report(`${where} has unsupported validator primitive/field type ${JSON.stringify(val.primitive)}/${JSON.stringify(val.fieldType)}${arrayHint}`);
    return false;
  }
  if (typeof val.optional !== 'boolean') {
    report(`${where} validator optional must be boolean`);
    return false;
  }
  if (val.primitive !== 'object') return true;
  if (!val.fields || typeof val.fields !== 'object' || Array.isArray(val.fields)) {
    report(`${where} object validator must have a fields object`);
    return false;
  }
  seen.add(val);
  let valid = true;
  for (const [name, field] of Object.entries(val.fields)) {
    if (!validateAuthoringValidator(field, `${where}.${name}`, report, seen, position)) valid = false;
  }
  seen.delete(val);
  return valid;
}

function idFieldTypeTable(fieldType) {
  if (!fieldType || typeof fieldType !== 'object' || Array.isArray(fieldType)) return null;
  if (Object.keys(fieldType).length !== 1 || !Object.hasOwn(fieldType, 'Id')) return null;
  const id = fieldType.Id;
  if (!id || typeof id !== 'object' || Array.isArray(id)) return null;
  if (Object.keys(id).length !== 1 || typeof id.table !== 'string' || id.table.length === 0) return null;
  return id.table;
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function argDescriptors(args) {
  const out = dict();
  for (const [name, val] of Object.entries(args)) {
    out[name] = validatorDescriptor(val);
  }
  return out;
}

function validatorDescriptor(val) {
  let descriptor;
  if (!val || val.primitive === 'unknown') {
    descriptor = { shape: 'unknown' };
  } else if (val.primitive === 'platformSchemaRef') {
    // @ref LLP 0131#the-search-fixture-cv-5 — the provider projection
    // carries the reference with its expansion embedded by value, derived
    // from the exported Rust-owned schema; the search argument stops
    // projecting as `unknown`.
    descriptor = {
      shape: 'platformSchemaRef',
      authority: 'platform',
      schema: val.fieldType?.PlatformSchemaRef?.schema,
      expansion: searchAstEmission().queryDescriptorExpansion,
    };
  } else if (val.resultKind === 'null') {
    descriptor = { shape: 'literal', value: null };
  } else if (val.resultKind === 'literal') {
    descriptor = { shape: 'literal', value: val.literal };
  } else if (val.resultKind === 'vector') {
    descriptor = {
      shape: 'array',
      items: {
        shape: 'primitive',
        name: 'number',
        minimum: -VECTOR_COMPONENT_ABS_MAX,
        maximum: VECTOR_COMPONENT_ABS_MAX,
      },
      minItems: val.dimensions,
      maxItems: val.dimensions,
    };
  } else if (val.resultKind === 'array') {
    descriptor = {
      shape: 'array',
      items: validatorDescriptor(val.element),
    };
  } else if (val.resultKind === 'union') {
    descriptor = { shape: 'union', variants: (val.variants ?? []).map(validatorDescriptor) };
  } else if (val.primitive === 'object') {
    descriptor = { shape: 'object', fields: argDescriptors(val.fields ?? {}) };
  } else {
    descriptor = { shape: 'primitive', name: val.primitive };
  }
  if (val?.optional) descriptor.optional = true;
  return descriptor;
}

// Operation argument schemas are a client/publication artifact, not a second
// function definition. They are projected from the exact validator objects
// that also feed generated API types, so consumers never have to re-author an
// app function's request shape (ENG-24556).
export function renderOperationSchemas(appId, functions, functionsModule) {
  return functions.map((fn) => ({
    file: `${fn.name}.args.schema.json`,
    value: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://schemas.snapback.dev/apps/${encodeURIComponent(appId)}/${encodeURIComponent(fn.name)}.args.schema.json`,
      title: `${appId}:${fn.name} arguments`,
      type: 'object',
      additionalProperties: false,
      ...jsonSchemaObjectProperties(functionsModule[fn.name]?.args ?? {}),
    },
  }));
}

function jsonSchemaObjectProperties(fields) {
  const properties = dict();
  const required = [];
  for (const [name, validator] of Object.entries(fields)) {
    properties[name] = jsonSchemaForValidator(validator);
    if (!validator?.optional) required.push(name);
  }
  return {
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function jsonSchemaForValidator(validator) {
  if (!validator || validator.primitive === 'unknown') return {};
  if (validator.fieldType?.Enum) {
    return { type: 'string', enum: [...validator.fieldType.Enum.values] };
  }
  if (validator.primitive === 'platformSchemaRef') {
    // Operation schemas stay self-contained: the reference's expansion is
    // embedded by value from the exported Rust-owned schema (LLP 0131).
    return structuredClone(searchAstEmission().queryJsonSchema);
  }
  if (validator.resultKind === 'null') return { type: 'null' };
  if (validator.resultKind === 'literal') return { const: validator.literal };
  if (validator.resultKind === 'vector') {
    return {
      type: 'array',
      items: { type: 'number', minimum: -(2 ** 100), maximum: 2 ** 100 },
      minItems: validator.dimensions,
      maxItems: validator.dimensions,
    };
  }
  if (validator.resultKind === 'array') {
    const maxItems = validator.resultOptions?.maxItems;
    return {
      type: 'array',
      items: jsonSchemaForValidator(validator.element),
      ...(maxItems !== undefined ? { maxItems } : {}),
    };
  }
  if (validator.resultKind === 'union') {
    return { anyOf: (validator.variants ?? []).map(jsonSchemaForValidator) };
  }
  if (validator.primitive === 'object') {
    return {
      type: 'object',
      additionalProperties: false,
      ...jsonSchemaObjectProperties(validator.fields ?? {}),
    };
  }
  if (validator.primitive === 'string') return { type: 'string' };
  if (validator.primitive === 'boolean') return { type: 'boolean' };
  if (validator.primitive === 'number') {
    const { min, max } = validator.resultOptions ?? {};
    return {
      type: validator.fieldType === 'Integer' ? 'integer' : 'number',
      ...(min !== undefined ? { minimum: min } : {}),
      ...(max !== undefined ? { maximum: max } : {}),
    };
  }
  return {};
}

function buildRemoteServicePublication({
  outDir,
  publicationRoot,
  appId,
  targetProfile,
  schemaManifest,
  functionManifest,
  capabilityManifest,
  operationSchemas,
  inputs,
  err,
}) {
  if (targetProfile !== TARGET_PROFILE_REMOTE) return null;
  if (capabilityManifest.localServerLifecycle !== false
      || capabilityManifest.targetProfileId !== targetProfile) {
    err('REMOTE_SERVICE_CAPABILITY_MISMATCH', 'publication', 'remote target requires the server-declared no-lifecycle capability manifest');
    return null;
  }

  const dataTierProfile = inputs.dataTierProfile.value;
  const corpusManifest = inputs.corpusManifest.value;
  if (dataTierProfile.artifactKind !== 'dataTierProfile'
      || corpusManifest.artifactKind !== 'dataTierCorpusManifest'
      || dataTierProfile.corpus !== corpusManifest.corpus
      || dataTierProfile.profileVersion !== corpusManifest.profileVersion
      || dataTierProfile.corpusFormatVersion !== corpusManifest.corpusFormatVersion
      || dataTierProfile.ledgerVersion !== corpusManifest.ledgerVersion
      || !Array.isArray(corpusManifest.cases)) {
    err('REMOTE_SERVICE_DATA_TIER_INVALID', 'publication', 'remote profile data-tier identity is internally inconsistent');
    return null;
  }

  const schemaArtifact = generatedJsonArtifact(outDir, 'schema.manifest.json', schemaManifest, publicationRoot, err);
  const functionsArtifact = generatedJsonArtifact(outDir, 'functions.manifest.json', functionManifest, publicationRoot, err);
  const capabilityArtifact = generatedJsonArtifact(outDir, 'capability.manifest.json', capabilityManifest, publicationRoot, err);
  const operationSchemaByName = new Map(operationSchemas.map((schema) => [schema.file.replace(/\.args\.schema\.json$/, ''), schema]));
  const functionByName = new Map(functionManifest.functions.map((fn) => [fn.name, fn]));
  const operations = [];
  for (const name of inputs.config.operations ?? []) {
    const fn = functionByName.get(name);
    const argsSchema = operationSchemaByName.get(name);
    if (!fn || fn.kind !== 'Mutation' || !argsSchema || typeof fn.authRequirement !== 'string') {
      err('REMOTE_SERVICE_OPERATION_INVALID', 'publication', `${name} is not a generated mutation with an auth requirement and argument schema`, { function: name });
      continue;
    }
    const argumentsArtifact = generatedJsonArtifact(outDir, `operations/${argsSchema.file}`, argsSchema.value, publicationRoot, err);
    operations.push({
      name,
      functionId: fn.id,
      kind: fn.kind,
      authRequirement: fn.authRequirement,
      argumentsSchema: argumentsArtifact?.reference,
      requestSchema: inputs.wireSchemas.mutationInput.reference,
      responseSchema: inputs.wireSchemas.mutationOutput.reference,
      receiptSchema: inputs.wireSchemas.receipt.reference,
      errorSchema: inputs.wireSchemas.errorResponse.reference,
    });
  }
  if (operations.length !== inputs.config.operations?.length
      || !schemaArtifact || !functionsArtifact || !capabilityArtifact) {
    return null;
  }

  const authValue = {
    artifactKind: 'remoteAuthCapabilityManifest',
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: 1,
    capabilityId: inputs.config.authCapabilityId,
    appId,
    targetProfileId: targetProfile,
    credentialPolicy: {
      presentation: 'authorization-bearer',
      authority: 'host-private',
      valueInArtifacts: false,
      valueInArguments: false,
      valueInEnvironment: false,
      valueInInfoPlist: false,
      supportsRotation: true,
    },
  };
  const authArtifact = generatedJsonArtifact(outDir, 'remote-auth-capability.manifest.json', authValue, publicationRoot, err);
  const wireSchemas = dict();
  for (const [name, artifact] of Object.entries(inputs.wireSchemas)) {
    wireSchemas[name] = artifact.reference;
  }
  const dataValue = {
    artifactKind: 'remoteDataCapabilityManifest',
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: 1,
    capabilityId: inputs.config.dataCapabilityId,
    appId,
    targetProfileId: targetProfile,
    schemaManifest: schemaArtifact.reference,
    functionManifest: functionsArtifact.reference,
    capabilityManifest: capabilityArtifact.reference,
    wireSchemas,
    operations,
  };
  const dataArtifact = generatedJsonArtifact(outDir, 'remote-data-capability.manifest.json', dataValue, publicationRoot, err);
  if (!authArtifact || !dataArtifact) return null;

  const profilePath = repositoryRelativePath(join(outDir, 'remote-service.profile.json'), publicationRoot, err);
  if (!profilePath) return null;
  const profileValue = {
    artifactKind: 'remoteServiceProfile',
    schemaVersion: SCHEMA_VERSION,
    profileVersion: 1,
    profileId: inputs.config.profileId,
    appId,
    targetProfileId: targetProfile,
    localServerLifecycle: false,
    publication: {
      kind: 'gitPinnedCheckout',
      addressing: 'commitSha',
      repository: dataTierProfile.publication.repository,
      profilePath,
    },
    endpointPolicy: {
      scheme: 'https',
      authority: 'host-private',
      valueInArtifacts: false,
      valueInArguments: false,
      valueInEnvironment: false,
      valueInInfoPlist: false,
      allowRedirects: false,
      allowAmbientProxy: false,
    },
    serverCapabilityManifest: capabilityArtifact.reference,
    authCapabilityManifest: authArtifact.reference,
    dataCapabilityManifest: dataArtifact.reference,
    dataTier: {
      corpus: dataTierProfile.corpus,
      profileVersion: dataTierProfile.profileVersion,
      corpusFormatVersion: dataTierProfile.corpusFormatVersion,
      ledgerVersion: dataTierProfile.ledgerVersion,
      caseCount: corpusManifest.cases.length,
      profile: inputs.dataTierProfile.reference,
      corpusManifest: inputs.corpusManifest.reference,
    },
  };
  const profileArtifact = generatedJsonArtifact(outDir, 'remote-service.profile.json', profileValue, publicationRoot, err);
  if (!profileArtifact) return null;
  return {
    artifacts: [
      { ...authArtifact, schemaFile: 'remote-service.auth-capability.manifest.schema.json' },
      { ...dataArtifact, schemaFile: 'remote-service.data-capability.manifest.schema.json' },
      { ...profileArtifact, schemaFile: 'remote-service.profile.schema.json' },
    ],
  };
}

function generatedJsonArtifact(outDir, file, value, publicationRoot, err) {
  const path = repositoryRelativePath(join(outDir, file), publicationRoot, err);
  if (!path) return null;
  const source = `${stableJson(value)}\n`;
  return {
    file,
    path,
    value,
    reference: { path, sha256: `sha256:${sha256(source)}` },
  };
}

function repositoryRelativePath(path, publicationRoot, err) {
  const repoRelative = relative(publicationRoot, path);
  if (!isPathInside(repoRelative)) {
    err('REMOTE_SERVICE_PUBLICATION_PATH_INVALID', 'publication', 'remote service publication output must live inside the repository', { path });
    return null;
  }
  return repoRelative.split(sep).join('/');
}

function applicationRepositoryRoot(backendRoot) {
  let candidate = resolve(backendRoot);
  for (;;) {
    if (existsSync(join(candidate, '.git'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  // The conventional app layout is <app>/snapback. A non-git consumer still
  // gets stable app-relative publication paths instead of package-install
  // paths from node_modules.
  return dirname(resolve(backendRoot));
}

// JS-handler query results are typed only when declared (LLP 0032 P3): a
// ctx.db handler can return any shape, so the earlier first-read-table guess
// (which typed egress-probe's `{fetchState, config}` rows as `probe` rows) is
// replaced by the declared `result` row validator — app fields, with the
// system fields every row carries merged in — or an honest unknown.
function jsQueryRowDescriptor(def, name, err) {
  if (!def.result) return { shape: 'unknown' };
  const declared = validatorRowDescriptor(def.result);
  if (!declared) {
    err('FUNCTION_INVALID_RESULT', 'function', `${name}: result must be a v.object(...) row validator`, { function: name });
    return { shape: 'unknown' };
  }
  return {
    shape: 'object',
    fields: {
      _id: { shape: 'primitive', name: 'string' },
      _version: { shape: 'primitive', name: 'number' },
      _createdAt: { shape: 'primitive', name: 'number' },
      _updatedAt: { shape: 'primitive', name: 'number' },
      ...declared.fields,
    },
  };
}

function providerResultDescriptor(contract) {
  const value = (entry) => {
    if (!entry) return { shape: 'unknown' };
    if (entry.kind === 'null') return { shape: 'literal', value: null };
    if (entry.kind === 'boolean') return { shape: 'primitive', name: 'boolean' };
    if (entry.kind === 'integer' || entry.kind === 'finiteReal') {
      return { shape: 'primitive', name: 'number' };
    }
    if (entry.kind === 'string' || entry.kind === 'principal' || entry.kind === 'assetRef' || entry.kind === 'id') {
      return { shape: 'primitive', name: 'string' };
    }
    if (entry.kind === 'mediaRef.v1') {
      return {
        shape: 'object',
        fields: {
          assetId: { shape: 'primitive', name: 'string' },
          kind: entry.kinds.length === 1
            ? { shape: 'literal', value: entry.kinds[0] }
            : {
                shape: 'union',
                variants: entry.kinds.map((kind) => ({ shape: 'literal', value: kind })),
              },
        },
      };
    }
    if (entry.kind === 'literal') {
      return { shape: 'literal', value: entry.value };
    }
    if (entry.kind === 'array') {
      return { shape: 'array', items: value(entry.element) };
    }
    if (entry.kind === 'tuple') {
      return {
        shape: 'array',
        items: { shape: 'union', variants: entry.elements.map(value) },
        minItems: entry.elements.length,
        maxItems: entry.elements.length,
      };
    }
    if (entry.kind === 'vector') {
      return {
        shape: 'array',
        items: {
          shape: 'primitive',
          name: 'number',
          minimum: -VECTOR_COMPONENT_ABS_MAX,
          maximum: VECTOR_COMPONENT_ABS_MAX,
        },
        minItems: entry.dimensions,
        maxItems: entry.dimensions,
      };
    }
    if (entry.kind === 'union') {
      return { shape: 'union', variants: entry.variants.map(value) };
    }
    if (entry.kind === 'object') {
      const fields = dict();
      for (const field of entry.fields ?? []) {
        const descriptor = value(field.value);
        if (!field.required) descriptor.optional = true;
        fields[field.name] = descriptor;
      }
      return { shape: 'object', fields };
    }
    return { shape: 'unknown' };
  };
  if (contract?.kind === 'documents') return { kind: 'list', row: value(contract.document) };
  if (contract?.kind === 'records') {
    return {
      kind: 'list',
      row: value(contract.record),
      ...(contract.rows ?? {}),
    };
  }
  if (contract?.kind === 'legacyQueryRowsV0') return { kind: 'list', row: value(contract.row) };
  return { kind: 'list', row: { shape: 'unknown' } };
}

function rowDescriptor(table) {
  const fields = dict();
  Object.assign(fields, {
    _id: { shape: 'primitive', name: 'string' },
    _version: { shape: 'primitive', name: 'number' },
    _createdAt: { shape: 'primitive', name: 'number' },
    _updatedAt: { shape: 'primitive', name: 'number' },
  });
  for (const f of table.fields) {
    if (f.field_type?.Structured) {
      const descriptor = resultValueContractDescriptor(
        f.field_type.Structured.contract.descriptor,
      );
      if (f.optional) descriptor.optional = true;
      fields[f.name] = descriptor;
      continue;
    }
    if (f.field_type?.Enum) {
      const descriptor = {
        shape: 'union',
        variants: f.field_type.Enum.values.map((value) => ({ shape: 'literal', value })),
      };
      if (f.optional) descriptor.optional = true;
      fields[f.name] = descriptor;
      continue;
    }
    if (f.field_type?.Vector) {
      const descriptor = {
        shape: 'array',
        items: {
          shape: 'primitive',
          name: 'number',
          minimum: -VECTOR_COMPONENT_ABS_MAX,
          maximum: VECTOR_COMPONENT_ABS_MAX,
        },
        minItems: f.field_type.Vector.dimensions,
        maxItems: f.field_type.Vector.dimensions,
      };
      if (f.optional) descriptor.optional = true;
      fields[f.name] = descriptor;
      continue;
    }
    const prim = f.field_type === 'Principal'
      || idFieldTypeTable(f.field_type) !== null
      || (f.field_type && typeof f.field_type === 'object' && f.field_type.RelationIncarnation)
      ? 'string'
      : { String: 'string', Boolean: 'boolean', Integer: 'number', Real: 'number' }[f.field_type];
    const descriptor = prim ? { shape: 'primitive', name: prim } : { shape: 'unknown' };
    if (f.optional) descriptor.optional = true;
    fields[f.name] = descriptor;
  }
  return { shape: 'object', fields };
}

function resultValueContractDescriptor(contract) {
  if (!contract || typeof contract !== 'object') return { shape: 'unknown' };
  if (contract.kind === 'null') return { shape: 'literal', value: null };
  if (contract.kind === 'literal') return { shape: 'literal', value: contract.value };
  if (contract.kind === 'boolean') return { shape: 'primitive', name: 'boolean' };
  if (contract.kind === 'string') return { shape: 'primitive', name: 'string' };
  if (contract.kind === 'integer' || contract.kind === 'finiteReal') {
    return { shape: 'primitive', name: 'number' };
  }
  if (contract.kind === 'array') {
    return {
      shape: 'array',
      items: resultValueContractDescriptor(contract.element),
      maxItems: contract.maxItems,
    };
  }
  if (contract.kind === 'union') {
    return {
      shape: 'union',
      variants: (contract.variants ?? []).map(resultValueContractDescriptor),
    };
  }
  if (contract.kind === 'object') {
    const nested = dict();
    for (const field of contract.fields ?? []) {
      const value = resultValueContractDescriptor(field.value);
      if (!field.required) value.optional = true;
      nested[field.name] = value;
    }
    return { shape: 'object', fields: nested };
  }
  return { shape: 'unknown' };
}

function boundedChildrenRowDescriptor(plan, tables) {
  const projected = (tableName, projection) => {
    const source = rowDescriptor(tables[tableName]);
    const fields = dict();
    for (const leaf of projection) {
      fields[leaf.name] = source.fields[leaf.field] ?? { shape: 'unknown' };
    }
    return { shape: 'object', fields };
  };
  const child = projected(plan.childTable, plan.childProjection);
  return {
    shape: 'union',
    variants: [
      {
        shape: 'object',
        fields: {
          kind: { shape: 'literal', value: 'absent' },
          parent: { shape: 'literal', value: null },
          children: { shape: 'array', items: child },
          continuation: { shape: 'literal', value: null },
        },
      },
      {
        shape: 'object',
        fields: {
          kind: { shape: 'literal', value: 'visible' },
          parent: projected(plan.parentTable, plan.parentProjection),
          children: { shape: 'array', items: child },
          continuation: {
            shape: 'union',
            variants: [
              { shape: 'literal', value: null },
              { shape: 'primitive', name: 'string' },
            ],
          },
        },
      },
    ],
  };
}

const ASSET_COLLECTION_KINDS = new Set(['image', 'video', 'audio', 'file']);
const ASSET_COLLECTION_GRANT_STATES = new Set(['active', 'pending']);
const ASSET_COLLECTION_GRANT_KINDS = new Set([
  'none', 'owner-only', 'recipients', 'derived', 'inherit-command',
]);
const ASSET_COLLECTION_PLAN_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

function uploadIntentMediaKinds(intent) {
  const kinds = new Set();
  for (const entry of intent?.accept?.mediaTypes ?? []) {
    const mediaType = String(entry).toLowerCase();
    if (mediaType === '*/*') {
      kinds.add('image');
      kinds.add('video');
      kinds.add('audio');
      kinds.add('file');
    } else if (mediaType.startsWith('image/')) kinds.add('image');
    else if (mediaType.startsWith('video/')) kinds.add('video');
    else if (mediaType.startsWith('audio/')) kinds.add('audio');
    else kinds.add('file');
  }
  return kinds;
}

function normalizeAssetCollectionSharing(definition, refuse) {
  const authored = definition.grants;
  const policy = typeof authored === 'string'
    ? {
        ceiling: {
          [authored]: { kind: authored },
        },
        default: authored,
      }
    : authored;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    refuse(
      'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
      'grants',
      'grants must be "none", "owner-only", "inherit-command", or a closed { ceiling, default } policy',
      'Declare a shorthand or an object whose ceiling maps 1–8 plan names to closed plan descriptors.',
    );
    return null;
  }
  const policyKeys = Object.keys(policy);
  if (policyKeys.some((key) => key !== 'ceiling' && key !== 'default')) {
    refuse(
      'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
      'grants',
      `grants contains unknown field ${policyKeys.find((key) => key !== 'ceiling' && key !== 'default')}`,
      'Use exactly grants: { ceiling: { <plan>: <descriptor> }, default: <plan> }.',
    );
    return null;
  }
  if (!policy.ceiling || typeof policy.ceiling !== 'object' || Array.isArray(policy.ceiling)) {
    refuse(
      'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
      'grants',
      'grants.ceiling must be an object of named exact plans',
      'Map 1–8 stable plan names to closed sharing descriptors.',
    );
    return null;
  }
  const entries = Object.entries(policy.ceiling);
  if (entries.length < 1 || entries.length > 8) {
    refuse(
      'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
      'grants',
      `grants.ceiling must contain 1–8 plans (got ${entries.length})`,
      'Keep the sharing ceiling explicit and bounded to at most eight plans.',
    );
    return null;
  }
  const plans = [];
  for (const [name, raw] of entries) {
    if (!ASSET_COLLECTION_PLAN_NAME.test(name)) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
        'grants',
        `sharing plan name ${JSON.stringify(name)} is not portable`,
        'Use a 1–64 character ASCII plan name beginning with a letter.',
        { plan: name },
      );
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || typeof raw.kind !== 'string' || !ASSET_COLLECTION_GRANT_KINDS.has(raw.kind)) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
        'grants',
        `sharing plan ${name} has an unknown or missing kind`,
        'Use exactly none, owner-only, recipients, derived, or inherit-command.',
        { plan: name },
      );
      continue;
    }
    const allowed = raw.kind === 'recipients'
      ? new Set(['kind', 'state', 'maxRecipients'])
      : raw.kind === 'derived'
        ? new Set([
            'kind', 'state', 'maxRecipients', 'function', 'table', 'parentField',
            'principalField',
          ])
        : new Set(['kind']);
    const unknown = Object.keys(raw).find((key) => !allowed.has(key));
    if (unknown !== undefined) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
        'grants',
        `sharing plan ${name} contains unknown field ${unknown}`,
        `Remove ${unknown}; ${raw.kind} is a closed sharing-plan shape.`,
        { plan: name, field: unknown },
      );
      continue;
    }
    if (raw.kind === 'recipients' || raw.kind === 'derived') {
      if (!ASSET_COLLECTION_GRANT_STATES.has(raw.state)) {
        refuse(
          'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
          'grants',
          `sharing plan ${name}.state must be "active" or "pending"`,
          'Choose the exact LLP 0210 grant state this named plan mints.',
          { plan: name },
        );
        continue;
      }
      if (!Number.isSafeInteger(raw.maxRecipients)
        || raw.maxRecipients < 1 || raw.maxRecipients > 32) {
        refuse(
          'SNAPBACK_MEDIA_COLLECTION_SHARING_PLAN_INVALID',
          'grants',
          `sharing plan ${name}.maxRecipients must be an integer in 1..32`,
          'Choose a bounded recipient fan-out from 1 through 32.',
          { plan: name },
        );
        continue;
      }
    }
    plans.push({ name, ...structuredClone(raw) });
  }
  if (plans.length !== entries.length) return null;
  if (typeof policy.default !== 'string'
    || !plans.some((plan) => plan.name === policy.default)) {
    refuse(
      'SNAPBACK_MEDIA_COLLECTION_SHARING_DEFAULT_INVALID',
      'grants',
      `grants.default must name one plan inside the ceiling (got ${JSON.stringify(policy.default)})`,
      'Set grants.default to an input-free plan name declared in grants.ceiling.',
    );
    return null;
  }
  if (plans.find((plan) => plan.name === policy.default)?.kind === 'recipients') {
    refuse(
      'SNAPBACK_MEDIA_COLLECTION_SHARING_DEFAULT_INVALID',
      'grants',
      `direct-recipient plan ${policy.default} cannot be the default because it requires invocation principals`,
      'Default to none, owner-only, a named derivation, or inherit-command; callers can explicitly select a direct-recipient plan.',
      { plan: policy.default },
    );
    return null;
  }
  return {
    format: 'snapback.asset-collection-sharing.v1',
    ceiling: plans,
    default: policy.default,
  };
}

// Lower one LLP 0239 D2 declaration into a protected child table, one
// bounded-children read, and four ordinary mutation-host plans. The plans are
// closed manifest data; no callback or second transaction owner is created.
// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
function buildAssetCollections({ functionsModule, tables, attribution, err }) {
  const collections = [];
  const definitions = dict();
  const sourceSpans = dict();
  const collectionDefs = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'asset-collection'));
  const intentDefs = new Map(
    Object.entries(functionsModule)
      .filter(([, value]) => isIsolatedDefinition(value, 'asset-upload')),
  );
  const occupiedFunctions = new Set(Object.keys(functionsModule));
  const report = (code, binding, property, message, remediation, details = {}) => {
    const path = [binding, ...(property ? [property] : [])];
    const source = definitionAttributionDetails(attribution, path);
    err(code, 'asset-collection', `${binding}${property ? `.${property}` : ''}: ${message}`, {
      collection: binding,
      property: property ?? null,
      ...source,
      ...details,
      details: {
        ...(source.details ?? {}),
        remediation,
        ...details,
      },
    });
  };

  for (const [binding, def] of collectionDefs) {
    let valid = true;
    const refuse = (code, property, message, remediation, details = {}) => {
      report(code, binding, property, message, remediation, details);
      valid = false;
    };
    if (!IDENT.test(binding) || RESERVED_WORDS.has(binding)) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_INVALID_IDENTIFIER',
        null,
        'the exported binding must be a portable identifier',
        'Rename the exported collection binding to an ASCII identifier that is not reserved.',
      );
    }
    const owner = typeof def.ownerTable === 'string' ? tables[def.ownerTable] : null;
    if (!owner) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_UNKNOWN',
        'ownerTable',
        `ownerTable must name an existing application table (got ${JSON.stringify(def.ownerTable)})`,
        'Set ownerTable to an existing ordinary table with owner visibility.',
      );
    } else if (
      owner.frameworkOwned !== undefined
      || owner.permissionBacking === true
      || owner.membership !== undefined
      || owner.authorityProfile !== undefined
      || owner.visibility?.kind !== 'owner'
    ) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE',
        'ownerTable',
        `${def.ownerTable} is not an ordinary owner-visible collection parent`,
        'Use an ordinary table with visibility({ kind: "owner", field: <required principal/string field> }); membership/profile composition remains generation-refused.',
        { ownerTable: def.ownerTable },
      );
    }
    const intent = typeof def.intent === 'string' ? intentDefs.get(def.intent) : null;
    if (!intent) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_INTENT_UNKNOWN',
        'intent',
        `intent must name one exported defineAssetUpload binding (got ${JSON.stringify(def.intent)})`,
        'Set intent to the exported name of the upload policy whose finalized assets this collection admits.',
      );
    }
    if (!Number.isSafeInteger(def.maxItems) || def.maxItems < 1 || def.maxItems > 32) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_MAX_ITEMS_INVALID',
        'maxItems',
        `maxItems must be an integer in 1..32 (got ${JSON.stringify(def.maxItems)})`,
        'Choose an explicit collection maximum from 1 through 32.',
      );
    }
    if (def.order !== 'manual' && def.order !== 'created') {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_ORDER_INVALID',
        'order',
        `order must be "manual" or "created" (got ${JSON.stringify(def.order)})`,
        'Use order: "manual" for caller-controlled ordinal order or order: "created" for append order.',
      );
    }
    const kinds = [];
    if (!Array.isArray(def.kinds) || def.kinds.length === 0) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_KINDS_INVALID',
        'kinds',
        'kinds must be a non-empty array',
        'Declare one or more of image, video, audio, or file.',
      );
    } else {
      for (const kind of def.kinds) {
        if (typeof kind !== 'string' || !ASSET_COLLECTION_KINDS.has(kind)) {
          refuse(
            'SNAPBACK_MEDIA_COLLECTION_KINDS_INVALID',
            'kinds',
            `kinds contains unsupported value ${JSON.stringify(kind)}`,
            'Use only image, video, audio, or file.',
          );
        } else if (kinds.includes(kind)) {
          refuse(
            'SNAPBACK_MEDIA_COLLECTION_DUPLICATE_POLICY_INVALID',
            'kinds',
            `kinds repeats ${kind}; collection asset ids are also duplicate-refused in v1`,
            'Remove the duplicate declaration entry; v1 has no duplicate-asset opt-in.',
          );
        } else kinds.push(kind);
      }
    }
    if (intent) {
      const admitted = uploadIntentMediaKinds(intent);
      const impossible = kinds.filter((kind) => !admitted.has(kind));
      if (impossible.length > 0) {
        refuse(
          'SNAPBACK_MEDIA_COLLECTION_INTENT_KIND_INCOMPATIBLE',
          'kinds',
          `intent ${def.intent} cannot finalize declared collection kinds ${impossible.join(', ')}`,
          'Narrow kinds or select an upload intent whose accepted media types can finalize every declared kind.',
          { intent: def.intent, impossibleKinds: impossible, admittedKinds: [...admitted].sort() },
        );
      }
    }
    // @ref LLP 0239#d4-grants-and-authority-are-declarative-at-the-command-edge —
    // the declaration owns a closed named ceiling and one input-free default;
    // invocation data selects a plan but never creates a new authority class.
    const sharing = normalizeAssetCollectionSharing(def, refuse);
    if (sharing && sharing.ceiling.some((plan) => (
      plan.kind === 'recipients' || plan.kind === 'derived'
    )) && intent?.grants !== true) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED',
        'grants',
        `recipient sharing requires upload intent ${String(def.intent)} to declare grants: true`,
        'Enable grants on the upload intent before admitting active or pending recipient plans.',
        { intent: def.intent },
      );
    }
    if (sharing && owner) {
      for (const plan of sharing.ceiling.filter(({ kind }) => kind === 'derived')) {
        const source = typeof plan.table === 'string' ? tables[plan.table] : null;
        const sourceField = (name) => source?.fields?.find((field) => field.name === name);
        const parentField = sourceField(plan.parentField);
        const principalField = sourceField(plan.principalField);
        const sourceEligible = source
          && source.frameworkOwned === undefined
          && source.permissionBacking !== true
          && source.membership === undefined
          && source.authorityProfile === undefined
          && source.visibility?.kind === 'owner';
        if (!IDENT.test(plan.function) || RESERVED_WORDS.has(plan.function)
          || !sourceEligible
          || parentField?.optional === true
          || parentField?.field_type?.Id?.table !== def.ownerTable
          || principalField?.optional === true
          || principalField?.field_type !== 'Principal') {
          refuse(
            'SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID',
            'grants',
            `derived plan ${plan.name} must name a portable generated function and an owner-visible ordinary table with required Id<${String(def.ownerTable)}> ${String(plan.parentField)} plus required Principal ${String(plan.principalField)}`,
            'Fix the derived plan function/table/parentField/principalField; membership and authority-profile derivations remain generation-refused.',
            { plan: plan.name, function: plan.function ?? null, table: plan.table ?? null },
          );
        }
      }
    }
    if (!valid || !owner || !intent || !sharing) continue;

    const names = {
      query: `${binding}List`,
      append: `${binding}Append`,
      replace: `${binding}Replace`,
      remove: `${binding}Remove`,
      ...(def.order === 'manual' ? { reorder: `${binding}Reorder` } : {}),
    };
    const derivedNames = sharing.ceiling
      .filter(({ kind }) => kind === 'derived')
      .map((plan) => ({ operation: `sharing derivation ${plan.name}`, name: plan.function }));
    const generatedNames = new Set();
    for (const [operation, name] of [
      ...Object.entries(names),
      ...derivedNames.map(({ operation, name }) => [operation, name]),
    ]) {
      if (occupiedFunctions.has(name)
        || Object.hasOwn(definitions, name)
        || generatedNames.has(name)) {
        refuse(
          'SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_COLLISION',
          null,
          `generated ${operation} operation ${name} collides with an authored definition`,
          `Rename collection ${binding} or the authored ${name} definition so the generated collection namespace is exclusive.`,
          { operation, generatedName: name },
        );
      }
      generatedNames.add(name);
    }
    if (!valid) continue;

    const generationPreimage = {
      format: 'snapback.asset-collection.v1',
      binding,
      ownerTable: def.ownerTable,
      ownerVisibility: owner.visibility,
      intent: def.intent,
      maxItems: def.maxItems,
      order: def.order,
      kinds,
      duplicatePolicy: 'refuse.v1',
      grants: sharing,
    };
    const generation = `sha256:${sha256(`snapback:asset-collection:v1\n${canonicalResultJson(generationPreimage)}`)}`;
    const childTable = `_snapback_asset_collection_${sha256(`${binding}\n${generation}`).slice(0, 20)}`;
    if (Object.hasOwn(tables, childTable)) {
      refuse(
        'SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_COLLISION',
        null,
        `generated child table ${childTable} collides with an existing table`,
        `Rename collection ${binding}; framework-owned child table identities may not alias authored storage.`,
        { childTable },
      );
      continue;
    }
    const mediaDescriptor = {
      intent: def.intent,
      policy: generation,
      kinds,
      classificationProfile: 'detected-content-type.v1',
      retentionClass: 'media-reference.v1',
      targetCapability: 'assets.media-ref-projection.v1',
    };
    tables[childTable] = {
      name: childTable,
      fields: [
        { name: 'parentId', field_type: { Id: { table: def.ownerTable } }, optional: false },
        {
          name: 'parentIncarnation',
          field_type: { RelationIncarnation: { foreignKeyField: 'parentId', parentTable: def.ownerTable } },
          optional: false,
        },
        {
          name: 'assetId',
          field_type: { AssetRef: { upload: def.intent, media: mediaDescriptor } },
          optional: false,
        },
        { name: 'kind', field_type: 'String', optional: false },
        { name: 'policyGeneration', field_type: 'String', optional: false },
        { name: 'ordinal', field_type: 'Integer', optional: false },
      ],
      indexes: [
        { name: 'byParentOrdinal', fields: ['parentId', 'parentIncarnation', 'ordinal'] },
        { name: 'uniqueParentAsset', fields: ['parentId', 'parentIncarnation', 'assetId'], unique: true },
      ],
      syncable: false,
      frameworkOwned: {
        kind: 'asset-collection.v1',
        collection: binding,
        generation,
      },
    };
    const descriptor = {
      format: 'snapback.asset-collection.v1',
      name: binding,
      generation,
      ownerTable: def.ownerTable,
      ownerField: owner.visibility.field,
      intent: def.intent,
      maxItems: def.maxItems,
      order: def.order,
      kinds,
      duplicatePolicy: 'refuse.v1',
      sharing,
      childTable,
      fields: {
        parentId: 'parentId',
        parentIncarnation: 'parentIncarnation',
        assetId: 'assetId',
        kind: 'kind',
        policyGeneration: 'policyGeneration',
        ordinal: 'ordinal',
      },
      operations: names,
    };
    collections.push(descriptor);

    const resultContract = results.value(v.object({
      parentId: v.id(def.ownerTable),
      itemIds: v.array(v.string(), { maxItems: def.maxItems }),
    }));
    const parentArgs = { parentId: v.id(def.ownerTable) };
    const sharingVariants = sharing.ceiling.map((plan) => v.object({
      plan: v.literal(plan.name),
      ...(plan.kind === 'recipients'
        ? { principals: v.array(v.principal(), { maxItems: plan.maxRecipients }) }
        : {}),
    }));
    const sharingSelection = v.optional(
      sharingVariants.length === 1 ? sharingVariants[0] : v.union(sharingVariants),
    );
    const operationDefinition = (operation, args) => ({
      __snapbackDefinitionKind: 'function',
      __kind: 'Mutation',
      auth: 'authenticated',
      args,
      resultContract,
      plan: {
        steps: [{
          AssetCollection: {
            collection: binding,
            generation,
            operation,
            ownerTable: def.ownerTable,
            ownerField: owner.visibility.field,
            childTable,
            parentIdArg: 'parentId',
            itemsArg: operation === 'append' || operation === 'replace' ? 'assetIds' : 'itemIds',
            maxItems: def.maxItems,
            order: def.order,
            intent: def.intent,
            kinds,
            duplicatePolicy: 'refuse.v1',
            policyGeneration: generation,
            sharingArg: operation === 'reorder' ? null : 'sharing',
            defaultSharingPlan: sharing.default,
            sharingDerivationTables: [...new Set(sharing.ceiling
              .filter(({ kind }) => kind === 'derived')
              .map((plan) => plan.table))].sort(),
            sharingGrantCapable: sharing.ceiling.some((plan) => (
              plan.kind === 'recipients' || plan.kind === 'derived'
            )),
          },
        }],
        return_value: null,
      },
      standardPattern: { helper: 'assetCollection', profile: 'asset-collection.v1' },
    });
    const assetArray = v.array(v.assetRef({ upload: def.intent }), { maxItems: def.maxItems });
    const itemIdArray = v.array(v.string(), { maxItems: def.maxItems });
    definitions[names.append] = operationDefinition('append', {
      ...parentArgs,
      assetIds: assetArray,
      sharing: sharingSelection,
    });
    definitions[names.replace] = operationDefinition('replace', {
      ...parentArgs,
      assetIds: assetArray,
      sharing: sharingSelection,
    });
    definitions[names.remove] = operationDefinition('remove', {
      ...parentArgs,
      itemIds: itemIdArray,
      sharing: sharingSelection,
    });
    if (names.reorder !== undefined) {
      definitions[names.reorder] = operationDefinition('reorder', { ...parentArgs, itemIds: itemIdArray });
    }
    definitions[names.query] = {
      __snapbackDefinitionKind: 'function',
      __kind: 'LiveQuery',
      auth: 'authenticated',
      args: { ...parentArgs, cursor: v.optional(v.string({ maxBytes: 1_024 })) },
      boundedChildrenPlan: {
        profile: 'bounded-children.v1',
        requiredCapability: 'bounded_children_v1',
        parentTable: def.ownerTable,
        parentIdArg: 'parentId',
        parentVisibility: { owner: { field: owner.visibility.field } },
        parentProjection: [{ name: 'parentId', field: '_id' }],
        childTable,
        childForeignKey: 'parentId',
        childRelationIncarnation: 'parentIncarnation',
        childIndex: 'byParentOrdinal',
        order: [{ field: 'ordinal', direction: 'Asc' }],
        take: def.maxItems,
        childProjection: [
          { name: 'itemId', field: '_id' },
          { name: 'ordinal', field: 'ordinal' },
          { name: 'media', field: 'assetId' },
        ],
        parentDeletion: 'hide-orphans.v1',
      },
      standardPattern: { helper: 'assetCollection', profile: 'asset-collection.v1' },
    };
    for (const plan of sharing.ceiling.filter(({ kind }) => kind === 'derived')) {
      const source = tables[plan.table];
      definitions[plan.function] = {
        __snapbackDefinitionKind: 'function',
        __kind: 'Query',
        auth: 'authenticated',
        args: { parentId: v.id(def.ownerTable) },
        plan: {
          table: plan.table,
          filters: [{
            field: plan.parentField,
            op: 'Eq',
            value: { __expr: true, Arg: 'parentId' },
          }],
          order: [{ field: plan.principalField, direction: 'Asc' }],
          // One-row overfetch turns a source fan-out beyond the declared
          // ceiling into a typed commit refusal instead of silent truncation.
          limit: plan.maxRecipients + 1,
          index: null,
          membershipFilters: [],
          tableVisibility: structuredClone(source.visibility),
        },
      };
    }
    const bindingSpan = definitionAttributionDetails(attribution, [binding]).sourceSpan;
    if (bindingSpan) {
      for (const name of [
        ...Object.values(names),
        ...sharing.ceiling
          .filter(({ kind }) => kind === 'derived')
          .map((plan) => plan.function),
      ]) {
        sourceSpans[name] = {
          path: bindingSpan.file,
          line: bindingSpan.line,
          column: bindingSpan.column,
        };
      }
    }
  }
  return { collections, definitions, sourceSpans };
}

function authoredFunctionManifestFields(def, declaredWrites = [], tables = {}) {
  // @ref LLP 0055#grants — static authority-creation is best-effort, while the
  // runtime write gate remains authoritative. Declared permission-backing
  // writes derive the marker by default; an explicit false supports a
  // creator-only bootstrap wrapper, whose dynamic host gate can perform only
  // the structurally non-authority-creating one-seat bootstrap operation. An
  // initial roster is authority-creating and the host requires consent even
  // though it shares that bootstrap command; ordinary membership writes are
  // likewise still refused here.
  const authorityCreating = def.authorityCreating === true
    || (def.authorityCreating !== false && [...declaredWrites].some((table) => (
      tables[table]?.permissionBacking === true || tables[table]?.membership !== undefined
    )));
  return {
    ...(def.auth !== undefined ? { authRequirement: def.auth } : {}),
    ...(def.authorityIndependent === true ? { authorityIndependent: true } : {}),
    ...(def.publicInline === true ? { publicInline: true } : {}),
    ...(authorityCreating ? { authorityCreating: true } : {}),
    ...(def.retainable === true ? { retainable: true } : {}),
    ...(def.retentionClass !== undefined ? { retentionClass: def.retentionClass } : {}),
    ...(Array.isArray(def.refusals) && def.refusals.length > 0 ? { refusals: [...def.refusals] } : {}),
    ...(Array.isArray(def.trackedRefusals) && def.trackedRefusals.length > 0
      ? { trackedRefusals: [...def.trackedRefusals] }
      : {}),
    ...(Array.isArray(def.authorizationDependence)
      ? { authorizationDependence: [...def.authorizationDependence] }
      : {}),
    ...(def[GENERATED_AUTHORITY_OPERATION] !== undefined
      ? { generatedAuthorityOperation: { ...def[GENERATED_AUTHORITY_OPERATION] } }
      : {}),
    ...(def.boundedSkew !== undefined ? { boundedSkew: { ...def.boundedSkew } } : {}),
  };
}

function collectAuthoredAuthorizationDimensions(expr, dimensions) {
  if (!expr || typeof expr !== 'object') return;
  if (expr.kind === 'AuthUserId') dimensions.add('userId');
  if (expr.kind === 'AuthKind') dimensions.add('kind');
  if (expr.kind === 'AuthActorKind') dimensions.add('actorKind');
  if (expr.kind === 'AuthIsDelegated') dimensions.add('isDelegated');
  if ('Field' in expr) collectAuthoredAuthorizationDimensions(expr.Field.base, dimensions);
  if ('Binary' in expr) {
    collectAuthoredAuthorizationDimensions(expr.Binary.left, dimensions);
    collectAuthoredAuthorizationDimensions(expr.Binary.right, dimensions);
  }
  if ('Unary' in expr) collectAuthoredAuthorizationDimensions(expr.Unary.expr, dimensions);
  if ('If' in expr) {
    collectAuthoredAuthorizationDimensions(expr.If.cond, dimensions);
    collectAuthoredAuthorizationDimensions(expr.If.then, dimensions);
    collectAuthoredAuthorizationDimensions(expr.If.else, dimensions);
  }
  if ('Concat' in expr) for (const value of expr.Concat) collectAuthoredAuthorizationDimensions(value, dimensions);
  if ('Call' in expr) for (const value of expr.Call.args) collectAuthoredAuthorizationDimensions(value, dimensions);
  if ('Record' in expr) for (const value of Object.values(expr.Record.fields)) collectAuthoredAuthorizationDimensions(value, dimensions);
}

function hostPlanAuthorizationDependence(def) {
  // Relational authoring owns its visibility filters outside `def.plan` and
  // emits the mechanically derived, closed dependence vector itself.
  if (def.relationalPlan && Array.isArray(def.authorizationDependence)) {
    return [...def.authorizationDependence].sort();
  }
  const dimensions = new Set();
  for (const filter of def.plan?.filters ?? []) {
    collectAuthoredAuthorizationDimensions(filter.value, dimensions);
  }
  if ((def.plan?.membershipFilters?.length ?? 0) > 0) dimensions.add('userId');
  if (def.plan?.tableVisibility !== undefined) dimensions.add('userId');
  if (def.authScopeField != null) dimensions.add('userId');
  return [...dimensions].sort();
}

function jsAuthorizationDependence(def) {
  if (Array.isArray(def.authorizationDependence)) return [...def.authorizationDependence];
  if ((def.membership?.length ?? 0) > 0 || def[GENERATED_AUTHORITY_OPERATION] !== undefined) {
    return ['userId'];
  }
  if (def.js?.authScopeField != null) return ['userId'];
  return ['opaque'];
}

function isProtectedQueryDefinition(def) {
  return def.retainable === true
    || (def.__kind === 'LiveQuery' && def.authorityIndependent !== true);
}

function visitAuthoredExpr(expr, visit) {
  if (!expr || typeof expr !== 'object') return;
  visit(expr);
  if ('Field' in expr) visitAuthoredExpr(expr.Field.base, visit);
  if ('Binary' in expr) {
    visitAuthoredExpr(expr.Binary.left, visit);
    visitAuthoredExpr(expr.Binary.right, visit);
  }
  if ('Unary' in expr) visitAuthoredExpr(expr.Unary.expr, visit);
  if ('If' in expr) {
    visitAuthoredExpr(expr.If.cond, visit);
    visitAuthoredExpr(expr.If.then, visit);
    visitAuthoredExpr(expr.If.else, visit);
  }
  if ('Concat' in expr) for (const value of expr.Concat) visitAuthoredExpr(value, visit);
  if ('Call' in expr) for (const value of expr.Call.args) visitAuthoredExpr(value, visit);
  if ('Record' in expr) for (const value of Object.values(expr.Record.fields)) visitAuthoredExpr(value, visit);
}

function validateProtectedAndRetainabilityDefinition(name, def, err) {
  if (isProtectedQueryDefinition(def) && def.plan) {
    for (const filter of def.plan.filters ?? []) {
      visitAuthoredExpr(filter.value, (expr) => {
        if (expr.kind === 'RuntimeNow') {
          err('SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY', 'auth', `${name}: protected result depends on RuntimeNow`, { function: name, inputKind: 'RuntimeNow' });
        } else if (expr.kind === 'RuntimeId') {
          err('SNAPBACK_AUTH_MUTABLE_INPUT_DENIED', 'auth', `${name}: protected result depends on RuntimeId`, { function: name, inputKind: 'RuntimeId' });
        }
      });
    }
  }

  if (def.retainable !== true) return;
  if (def.js) {
    err(
      'SNAPBACK_AUTH_UNDECLARABLE_RETENTION',
      'auth',
      `${name}: JavaScript handler retention is refused until ctx.auth and module-state reset equivalence are mechanically proved`,
      { function: name, reason: 'opaqueJavaScript', authorizationDependence: jsAuthorizationDependence(def) },
    );
    return;
  }

  const dependence = hostPlanAuthorizationDependence(def);
  const valid = def.authorityIndependent === true
    ? dependence.length === 0
    : (dependence.length === 1 && dependence[0] === 'userId')
      || (dependence.length === 2 && dependence[0] === 'kind' && dependence[1] === 'userId');
  if (!valid) {
    err(
      'SNAPBACK_AUTH_UNDECLARABLE_RETENTION',
      'auth',
      `${name}: retainable query must be authorityIndependent or depend on userId only`,
      { function: name, reason: 'notUserIdOnly', authorizationDependence: dependence },
    );
  }

}

function authoredExprUsesAuthorityOrAmbientInput(expr) {
  if (!expr || typeof expr !== 'object') return false;
  if (expr.kind === 'AuthUserId'
    || expr.kind === 'AuthKind'
    || expr.kind === 'AuthActorKind'
    || expr.kind === 'AuthIsDelegated'
    || expr.kind === 'RuntimeId'
    || expr.kind === 'RuntimeNow') return true;
  if ('Field' in expr) return authoredExprUsesAuthorityOrAmbientInput(expr.Field.base);
  if ('Binary' in expr) {
    return authoredExprUsesAuthorityOrAmbientInput(expr.Binary.left)
      || authoredExprUsesAuthorityOrAmbientInput(expr.Binary.right);
  }
  if ('Unary' in expr) return authoredExprUsesAuthorityOrAmbientInput(expr.Unary.expr);
  if ('If' in expr) {
    return authoredExprUsesAuthorityOrAmbientInput(expr.If.cond)
      || authoredExprUsesAuthorityOrAmbientInput(expr.If.then)
      || authoredExprUsesAuthorityOrAmbientInput(expr.If.else);
  }
  if ('Concat' in expr) return expr.Concat.some(authoredExprUsesAuthorityOrAmbientInput);
  if ('Call' in expr) return expr.Call.args.some(authoredExprUsesAuthorityOrAmbientInput);
  if ('Record' in expr) return Object.values(expr.Record.fields).some(authoredExprUsesAuthorityOrAmbientInput);
  return false;
}

function validateFunctionAuthDefinition(name, def, err) {
  if (def.auth !== undefined && !AUTH_REQUIREMENTS.has(def.auth)) {
    err('FUNCTION_AUTH_REQUIREMENT_INVALID', 'auth', `${name}: auth must be public, optional-user, or authenticated`, { function: name, authRequirement: def.auth });
  }
  if (def.authorityIndependent !== undefined && typeof def.authorityIndependent !== 'boolean') {
    err('FUNCTION_AUTHORITY_INDEPENDENT_INVALID', 'auth', `${name}: authorityIndependent must be boolean`, { function: name });
    return;
  }
  if (def.publicInline === true && def.authorityIndependent !== true) {
    // @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact —
    // the disclosure fact is accepted only beside a valid
    // authorityIndependent declaration (which entails public); v1 keeps the
    // narrower rule fail-closed.
    err(
      'FUNCTION_PUBLIC_INLINE_INVALID',
      'auth',
      `${name}: publicInline requires a valid authorityIndependent: true declaration`,
      { function: name },
    );
  }
  if (def.authorityIndependent !== true) return;

  const queryKind = def.__kind === 'Query' || def.__kind === 'LiveQuery';
  const plainHostPlanQuery = queryKind && def.plan && !def.js;
  const liveSearchPlan = def.__kind === 'LiveQuery' && def.searchPlan && !def.js;
  const hostPlanQuery = plainHostPlanQuery || liveSearchPlan;
  const publicRequirement = def.auth === 'public';
  // @ref LLP 0058#authority-independent-live-declaration — membership and
  // auth-scope declarations are authority dependencies even when the ordinary
  // filter expressions themselves contain no explicit auth value.
  const authorizationFree = hostPlanQuery
    && hostPlanAuthorizationDependence(def).length === 0;
  const ambientFree = hostPlanQuery
    && (liveSearchPlan || (def.plan.filters ?? []).every(
      (filter) => !authoredExprUsesAuthorityOrAmbientInput(filter.value),
    ));
  if (!(queryKind && hostPlanQuery && publicRequirement && authorizationFree && ambientFree)) {
    err(
      'FUNCTION_AUTHORITY_INDEPENDENT_INVALID',
      'auth',
      `${name}: authorityIndependent requires a public HostPlan query with no auth, membership, auth-scope, runtime-clock, or runtime-id dependency`,
      { function: name, kind: def.__kind, authRequirement: def.auth ?? 'optional-user' },
    );
  }
}

// Builders reject ordinary mistakes, but authored definition objects remain
// mutable JavaScript values. Re-establish both the refusal vocabulary and the
// tracking-subset invariant before emitting a manifest.
//
// @ref LLP 0108#tracked-refusal-opt-in
function validateFunctionRefusalTrackingDefinition(name, def, err) {
  const validateSet = (field, value, diagnosticCode) => {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length > 64) {
      err(diagnosticCode, 'function', `${name}: ${field} must be an array of at most 64 codes`, { function: name, field });
      return null;
    }
    const seen = new Set();
    for (const code of value) {
      if (typeof code !== 'string'
          || code.length === 0
          || code.length > 64
          || code.startsWith('SNAPBACK_')
          || !/^[A-Z0-9_]+$/.test(code)) {
        err(diagnosticCode, 'function', `${name}: ${field} contains invalid app refusal code ${String(code)}`, { function: name, field, refusal: code });
        continue;
      }
      if (seen.has(code)) {
        err(diagnosticCode, 'function', `${name}: ${field} repeats ${code}`, { function: name, field, refusal: code });
        continue;
      }
      seen.add(code);
    }
    return seen;
  };

  const declared = validateSet('refusals', def.refusals, 'FUNCTION_REFUSAL_DECLARATION_INVALID')
    ?? new Set();
  const tracked = validateSet(
    'trackedRefusals',
    def.trackedRefusals,
    'FUNCTION_TRACKED_REFUSAL_INVALID',
  );
  if (tracked !== null) {
    for (const code of tracked) {
      if (!declared.has(code)) {
        err(
          'FUNCTION_TRACKED_REFUSAL_INVALID',
          'function',
          `${name}: tracked refusal ${code} must also appear in refusals`,
          { function: name, field: 'trackedRefusals', refusal: code },
        );
      }
    }
  }

  // @ref LLP 0108#declared-application-refusals — an app-namespaced code
  // emitted by the declarative mutation plan is part of the same closed
  // declaration as ctx.refuse(). Platform SNAPBACK_* outcomes remain owned
  // by the host and cannot appear in the app declaration by design.
  if (def.__kind !== 'Mutation' || !def.plan || def.writeWithActivityPlan) return;
  for (const [stepIndex, step] of (def.plan.steps ?? []).entries()) {
    const [stepKind, body] = Object.entries(step ?? {})[0] ?? [];
    const code = stepKind === 'Get'
      ? body?.else_error
      : (stepKind === 'Guard' ? body?.else_error : null);
    if (typeof code !== 'string' || code.length === 0 || code.startsWith('SNAPBACK_')) {
      continue;
    }
    if (!declared.has(code)) {
      err(
        'FUNCTION_PLAN_REFUSAL_UNDECLARED',
        'function',
        `${name}: ${stepKind} step ${stepIndex} emits app refusal ${code}, which must appear in refusals`,
        {
          function: name,
          field: 'refusals',
          refusal: code,
          stepKind,
          stepIndex,
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Route→query manifest compilation (LLP 0092 §0C.1 / §0E.6, ENG-25448).
// ---------------------------------------------------------------------------

const ROUTE_PARAM_IDENT = /^[A-Za-z0-9_]+$/;
const ROUTE_PARAM_PRIMITIVES = new Set(['string', 'number', 'boolean']);

/// Parse a v1 route pattern into its param names; null (with a diagnostic)
/// when the pattern violates the exact grammar: `/`-separated static
/// segments plus `:name` params, no wildcards/optional/trailing-slash forms.
function parseRoutePattern(pattern, err) {
  const invalid = (why) => {
    err('ROUTES_PATTERN_INVALID', 'routes', `route pattern ${pattern} is invalid: ${why}`, { route: pattern });
    return null;
  };
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) return invalid('must start with /');
  if (pattern === '/') return [];
  if (pattern.endsWith('/')) return invalid('no trailing slash');
  const params = [];
  for (const segment of pattern.slice(1).split('/')) {
    if (segment.length === 0) return invalid('empty segment');
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!ROUTE_PARAM_IDENT.test(name)) return invalid(`bad param name ${segment}`);
      if (params.includes(name)) return invalid(`duplicate param ${name}`);
      params.push(name);
    } else if (segment.includes(':')) {
      return invalid(`mid-segment colon in ${segment}`);
    }
  }
  return params;
}

/// Two valid v1 patterns overlap when some concrete path matches both
/// (LLP 0092 §0C.1's unambiguity rule; mirrors src/bundle.rs).
function routePatternsOverlap(a, b) {
  const split = (pattern) => (pattern === '/' ? [] : pattern.slice(1).split('/'));
  const [left, right] = [split(a), split(b)];
  if (left.length !== right.length) return false;
  return left.every((segment, index) => (
    segment.startsWith(':') || right[index].startsWith(':') || segment === right[index]
  ));
}

function isPlainRouteObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRouteParamRef(value) {
  return isPlainRouteObject(value) && Object.hasOwn(value, '$param');
}

function routeMappingParamReferences(mapping, visitArrayInteriors, initialPath = []) {
  const references = [];
  const visit = (value, path, insideArray) => {
    if (Array.isArray(value)) {
      if (!visitArrayInteriors) return;
      value.forEach((entry, index) => visit(entry, [...path, String(index)], true));
      return;
    }
    if (!isPlainRouteObject(value)) return;
    if (isRouteParamRef(value)) references.push({ path, value, insideArray });
    for (const [key, entry] of Object.entries(value)) {
      visit(entry, [...path, key], insideArray);
    }
  };
  visit(mapping, initialPath, false);
  return references;
}

function routeValidatorAtPath(path, fnArgs) {
  if (path.length === 0) return null;
  let validator = fnArgs?.[path[0]];
  for (let index = 1; index < path.length; index += 1) {
    if (
      validator?.primitive !== 'object'
      || validator.resultKind !== undefined
    ) return null;
    validator = validator.fields?.[path[index]];
  }
  return validator ?? null;
}

/** @internal Every `{"$param"}` reference in a params-v1 mapping, paired with
 * the declared validator its path resolves to (null when unresolvable). */
export function routeMappingParamTargets(mapping, fnArgs) {
  return routeMappingParamReferences(mapping, false).map(({ path, value }) => ({
    path,
    param: value.$param,
    validator: routeValidatorAtPath(path, fnArgs),
  }));
}

function routeLiteralMatches(validator, value) {
  if (isRouteParamRef(value)) return true;
  if (!validator || validator.primitive === 'unknown') return true;
  if (validator.resultKind === 'null') return value === null;
  if (validator.resultKind === 'literal') return value === validator.literal;
  if (validator.resultKind === 'union') {
    return (validator.variants ?? []).some((variant) => routeLiteralMatches(variant, value));
  }
  if (validator.resultKind === 'array') {
    return Array.isArray(value)
      && (
        typeof validator.resultOptions?.maxItems !== 'number'
        || value.length <= validator.resultOptions.maxItems
      )
      && value.every((entry) => routeLiteralMatches(validator.element, entry));
  }
  if (validator.resultKind === 'vector') {
    return Array.isArray(value)
      && value.length === validator.dimensions
      && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
  }
  if (validator.primitive === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = validator.fields ?? {};
    for (const [name, field] of Object.entries(fields)) {
      if (value[name] === undefined) {
        if (!field?.optional) return false;
      } else if (!routeLiteralMatches(field, value[name])) return false;
    }
    return Object.keys(value).every((name) => name in fields);
  }
  return typeof value === validator.primitive;
}

/// Compile the authored routes declaration into the routes.manifest.json
/// artifact, validating against the authored functions (LLP 0092 §0C.1
/// admission, run at compile time): function exists and is a query; the
/// `params-v1` mapping grammar holds (references at object positions only,
/// sole-`$param`-key rule, every reference naming a pattern param);
/// each reference's target arg-schema type is string/number/boolean; literal
/// portions validate statically; every required arg is covered.
function compileRoutesManifest(routesModule, functionsModule, appId, err) {
  if (!isIsolatedDefinition(routesModule, 'routes')) {
    err('ROUTES_NO_DEFAULT_EXPORT', 'routes', 'snapback/routes.mjs must default-export defineRoutes([...])');
    return null;
  }
  const compiled = [];
  const seenPatterns = [];
  for (const entry of routesModule.routes ?? []) {
    const route = entry.route;
    const params = parseRoutePattern(route, err);
    if (params === null) continue;
    for (const prior of seenPatterns) {
      if (routePatternsOverlap(prior, route)) {
        err('ROUTES_PATTERN_OVERLAP', 'routes', `route patterns ${prior} and ${route} can match the same path`, { routes: [prior, route] });
      }
    }
    seenPatterns.push(route);
    const queries = entry.queries ?? [];
    if (queries.length === 0 || queries.length > 32) {
      err('ROUTES_QUERY_COUNT_INVALID', 'routes', `route ${route} must declare 1..32 queries`, { route, count: queries.length });
      continue;
    }
    for (const spec of queries) {
      const fn = functionsModule[spec.function];
      const fail = (code, message, extra = {}) =>
        err(code, 'routes', `route ${route} query ${spec.function}: ${message}`, { route, function: spec.function, ...extra });
      if (!fn || (fn.__kind !== 'Query' && fn.__kind !== 'LiveQuery')) {
        fail('ROUTES_FUNCTION_INVALID', 'names an unknown or non-query function');
        continue;
      }
      const fnArgs = fn.args ?? {};
      const mapping = spec.args ?? {};

      // Pass A: admit and type every reference before treating the remaining
      // structure as literals. Array interiors deliberately have no typable
      // target path, even when an enclosing object field has a contract.
      if (isRouteParamRef(mapping)) {
        fail('ROUTES_ARGS_INVALID', 'a bare top-level $param reference has no named arg position');
        continue;
      }
      const referencePathPrefix = Array.isArray(mapping) ? ['args'] : [];
      for (const { path, value, insideArray } of routeMappingParamReferences(
        mapping,
        true,
        referencePathPrefix,
      )) {
        const referencePath = path.join('.');
        if (insideArray) {
          fail('ROUTES_ARGS_INVALID', `a $param reference at ${referencePath} is nested inside an array literal; references are typable only at object positions`);
        } else if (Object.keys(value).length !== 1 || typeof value.$param !== 'string') {
          fail('ROUTES_ARGS_INVALID', `the reference at ${referencePath} must be a sole-key {"$param": name} object`);
        } else if (!params.includes(value.$param)) {
          fail('ROUTES_ARGS_INVALID', `references :${value.$param}, which is not in the route pattern`);
        } else {
          const validator = routeValidatorAtPath(path, fnArgs);
          if (path.length === 1) {
            // Preserve the historical top-level rule byte-for-byte: result
            // node refinements do not narrow any previously admitted app.
            if (!validator || !ROUTE_PARAM_PRIMITIVES.has(validator.primitive)) {
              fail('ROUTES_ARGS_INVALID', `references param into arg ${path[0]}, whose schema type is not string/number/boolean`);
            }
          // @ref LLP 0131#the-argument-contract-descriptor — nested positions
          // are newly typable from the carried recursive contract, whose
          // scalar leaf rule both codegen and the server can reproduce.
          } else if (
            !validator
            || !ROUTE_PARAM_PRIMITIVES.has(validator.primitive)
            || validator.resultKind !== undefined
          ) {
            fail('ROUTES_ARGS_INVALID', `references param into ${referencePath}, whose declared type is not a string/number/boolean argument position`);
          }
        }
      }

      // Pass B: validate each complete top-level literal template. Reference
      // nodes already admitted in pass A match their resolved positions.
      if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) {
        for (const [key, value] of Object.entries(mapping)) {
          const validator = fnArgs[key];
          if (validator && !routeLiteralMatches(validator, value)) {
            fail('ROUTES_ARGS_INVALID', `literal for arg ${key} does not match its arg schema`);
          }
        }
        for (const [name, validator] of Object.entries(fnArgs)) {
          if (!validator?.optional && mapping[name] === undefined) {
            fail('ROUTES_ARGS_INVALID', `required arg ${name} is not covered by the mapping`);
          }
        }
      }
    }
    const registerGroupEligible = routeRegisterGroupEligible(queries, functionsModule);
    const mixedGroupEligible = routeMixedGroupEligible(queries, functionsModule);
    compiled.push({
      route,
      queries: queries.map((spec) => ({ function: spec.function, args: spec.args ?? {} })),
      ...(entry.persist === false ? { persist: false } : {}),
      ...(registerGroupEligible ? { registerGroupEligible: true } : {}),
      ...(mixedGroupEligible ? { mixedGroupEligible: true } : {}),
    });
  }
  return { formatVersion: 1, app: appId, routes: compiled };
}

/** @internal Focused authoring seam for the closed register-mode predicate. */
function routeQueryGroupResultEligible(fn) {
  const resultKind = fn?.resultContract?.kind;
  if (resultKind !== undefined) {
    return resultKind === 'documents' || resultKind === 'records';
  }
  // The legacy v.object query result is row-shaped. HostPlan query builders
  // derive an array contract later from their plan. An opaque JS handler with
  // no result declaration is Unknown and cannot enter a typed group.
  if (fn?.result !== undefined) return true;
  return fn?.js === undefined;
}

export function routeRegisterGroupEligible(queries, functionsModule) {
  return queries.every((spec) => {
    const fn = functionsModule[spec.function];
    if (fn?.__kind !== 'LiveQuery') return false;
    // @ref LLP 0108#generated-references-and-consumers — typed query groups
    // admit only array contracts; document/value carriers are projected by
    // single-query consumers and must not leak into row-group references.
    if (!routeQueryGroupResultEligible(fn)) return false;
    // @ref LLP 0136#client-composition-llp-0112--llp-0114 — a literal AST
    // must not let live search enter register mode before that path owns
    // cursor and ceiling admission.
    if (fn.searchPlan !== undefined) return false;
    return routeMappingParamTargets(spec.args ?? {}, fn.args).every(
      ({ validator }) => validator?.primitive === 'string',
    );
  });
}

/** @internal Closed v2 predicate: at least one child of each query export
 * kind, and the same pre-I/O args materialization restrictions as format 1. */
export function routeMixedGroupEligible(queries, functionsModule) {
  let query = false;
  let live = false;
  for (const spec of queries) {
    const fn = functionsModule[spec.function];
    if (fn?.__kind === 'Query') query = true;
    else if (fn?.__kind === 'LiveQuery') live = true;
    else return false;
    if (!routeQueryGroupResultEligible(fn)) return false;
    if (fn.searchPlan !== undefined) return false;
    if (!routeMappingParamTargets(spec.args ?? {}, fn.args).every(
      ({ validator }) => validator?.primitive === 'string',
    )) return false;
  }
  return query && live;
}

// The stable function id: a pure function of (appId, exported name), so
// regenerating unchanged source is byte-identical and a rename mints a new id
// (the old id is retired with the old name, never re-pointed at a different
// function). Grants and consent key on this id; determinism means deleting and
// re-adding a same-named function reproduces the same id, so revival of stale
// authority is refused by the grant's durable basis generation (LLP 0055),
// which this deterministic scheme deliberately leaves room for.
//
// @ref LLP 0004#first-slice-api-decisions — Function ids: required, emitted as
//   `{appId}:{exportedName}`, deterministic across regeneration of unchanged
//   source; a rename is a different function.
function functionId(appId, name) {
  if (typeof appId !== 'string' || appId === '' || typeof name !== 'string' || name === '') {
    // Fail closed: emitting a function without a stable id would produce a
    // manifest the server refuses to load (LLP 0012 requires the id).
    throw codegenError(
      'SNAPBACK_CODEGEN_FUNCTION_ID_INVALID',
      `codegen internal error: cannot derive a stable function id from appId=${JSON.stringify(appId)} name=${JSON.stringify(name)}`,
      { details: { appId, name } },
    );
  }
  return `${appId}:${name}`;
}

// @ref LLP 0234#d1--an-override-is-an-alternate-invocation-bound-table-policy
// — compile the scanner/metadata result into the closed host-call carrier;
// runtime never needs to infer authority from JavaScript aliases or source.
function manifestElevatedDbCapabilities(fn) {
  if (fn.handlerForm !== 'inline') {
    return [...(fn.elevatedDbCapabilities ?? [])]
      .map(({ form, tables: ceiling }) => ({
        form,
        tables: ceiling === 'opaque' ? 'opaque' : [...ceiling].sort(compareCodeUnits),
      }))
      .sort((left, right) => compareCodeUnits(left.form, right.form));
  }
  const byForm = new Map();
  for (const use of fn.elevatedDbUses ?? []) {
    const prior = byForm.get(use.member);
    if (use.table === null || prior === 'opaque') {
      byForm.set(use.member, 'opaque');
    } else {
      const tables = prior ?? new Set();
      tables.add(use.table);
      byForm.set(use.member, tables);
    }
  }
  return [...byForm.entries()]
    .map(([form, ceiling]) => ({
      form,
      tables: ceiling === 'opaque' ? 'opaque' : [...ceiling].sort(compareCodeUnits),
    }))
    .sort((left, right) => compareCodeUnits(left.form, right.form));
}

function decorateFunctions(appId, functions, sourceSpans = {}) {
  return functions.map((fn) => {
    const reads = readSummary(fn);
    const writes = writeSummary(fn);
    // @ref LLP 0065#1-fact-classes — fail closed: a plan node the ceiling
    //   walker does not recognize aborts generation instead of shipping a
    //   function whose effects escaped the recorded ceiling.
    let effectCeiling;
    try {
      effectCeiling = computeEffectCeiling(fn);
    } catch (error) {
      const span = sourceSpans[fn.name] ?? {};
      throw codegenError(
        'SNAPBACK_CODEGEN_EFFECT_CEILING_FAILED',
        `${fn.name}: ${error.message}`,
        { cause: error, ...span, details: { function: fn.name } },
      );
    }
    // @ref LLP 0118#findings — finding 4: the v1 hash carries no dependency
    // field by design, so helper-using operations move to the v2 format whose
    // handler carries named helper-content edges (name + content hash, no
    // paths, no graph encoding). Operations without helpers keep the exact v1
    // encoding, so every existing implementation hash is unchanged and
    // invalidation is exactly per-operation: an edit to a helper re-hashes
    // only the operations whose reachable subsets contain it.
    const inlineHelpers = fn.inlineAst !== undefined
      && Array.isArray(fn.inlineHelpers)
      && fn.inlineHelpers.length > 0
      ? [...fn.inlineHelpers].sort((left, right) => (left.name < right.name ? -1 : 1))
      : null;
    const sequences = Array.isArray(fn.sequences) ? fn.sequences : [];
    // @ref LLP 0135#4-fold-on-acceptance-amendments-applied-2026-08-02 —
    // `sequences` extends the frozen implementation identity only through a
    // new format domain; sequence-free v1/v2 hashes remain byte-identical.
    const hasAuthorityProfileDependence = Array.isArray(fn.authorityProfileDependence)
      && fn.authorityProfileDependence.length > 0;
    const elevatedDbCapabilities = manifestElevatedDbCapabilities(fn);
    // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
    // — profile generation is an implementation-identity input only for
    // operations that mechanically depend on that profile. Legacy functions
    // retain their byte-identical v1-v4 hashes.
    const implementationFormatVersion = fn.customAuthorization !== undefined
      ? 'v7'
      : elevatedDbCapabilities.length > 0
        ? 'v6'
      : hasAuthorityProfileDependence
        ? 'v5'
        : (fn.stream === true
          ? 'v4'
          : (sequences.length > 0 ? 'v3' : (inlineHelpers ? 'v2' : 'v1')));
    const implementationIdentity = {
      format: `snapback.function-implementation.${implementationFormatVersion}`,
      app: appId,
      operation: fn.name,
      kind: fn.kind,
      handler: fn.inlineAst !== undefined
        ? {
            form: 'inline',
            canonicalAst: fn.inlineAst,
            ...(inlineHelpers
              ? {
                  helpers: inlineHelpers.map(({ name, contentHash }) => ({ name, contentHash })),
                }
              : {}),
          }
        : fn.runtime?.IbexModule
          ? {
              form: 'module',
              sourceHash: `sha256:${sha256(fn.runtime.IbexModule.source ?? '')}`,
              export: fn.runtime.IbexModule.export,
              // @ref LLP 0108#identity-artifacts-and-public-custody — a
              // transformed module binds the compiler custody facts beside
              // the exact runtime bytes already represented by sourceHash.
              // Presence-only keeps every JS/MJS implementation preimage.
              // @ref LLP 0246#d5-identity-binds-source-profile-and-output
              ...(fn.typescriptIdentity ? { typescript: fn.typescriptIdentity } : {}),
            }
          : { form: 'plan', plan: fn.runtime?.HostPlan ?? null },
      argsContractHash: fn.argsContractHash,
      resultContractHash: fn.resultContractHash,
      reads,
      writes,
      authRequirement: fn.authRequirement ?? 'optional-user',
      authorizationDependence: fn.authorizationDependence ?? [],
      ...(hasAuthorityProfileDependence
        ? { authorityProfileDependence: fn.authorityProfileDependence }
        : {}),
      ...(fn.generatedAuthorityOperation !== undefined
        ? { generatedAuthorityOperation: fn.generatedAuthorityOperation }
        : {}),
      uses: fn.uses ?? [],
      standardPattern: fn.standardPattern ?? null,
      ...(fn.stream === true ? { stream: true } : {}),
      ...(sequences.length > 0 ? { sequences } : {}),
      ...(fn.boundedSkew !== undefined ? { boundedSkew: fn.boundedSkew } : {}),
      ...(elevatedDbCapabilities.length > 0 ? { elevatedDbCapabilities } : {}),
      ...(fn.writePolicy !== undefined ? { writePolicy: fn.writePolicy } : {}),
      ...(fn.customAuthorization !== undefined
        ? { customAuthorization: fn.customAuthorization }
        : {}),
    };
    return {
      id: functionId(appId, fn.name),
      name: fn.name,
      exportedName: fn.name,
      kind: fn.kind,
      ...(fn.stream === true ? { stream: true } : {}),
      sourceSpan: fn.sourceSpan ?? null,
      handlerForm: fn.handlerForm
        ?? (fn.runtime?.IbexModule ? 'module' : 'plan'),
      implementationHash: `sha256:${sha256(
        `snapback:function-implementation:${implementationFormatVersion}\n${canonicalResultJson(implementationIdentity)}`,
      )}`,
      argsContractHash: fn.argsContractHash,
      argsContract: fn.argsContract,
      ...(fn.boundedSkew !== undefined ? { boundedSkew: { ...fn.boundedSkew } } : {}),
      ...(sequences.length > 0 ? { sequences: sequences.map((sequence) => ({ ...sequence })) } : {}),
      resultContract: fn.resultContract,
      resultContractHash: fn.resultContractHash,
      requiredCapabilities: requiredCapabilities(fn),
      authRequirement: fn.authRequirement ?? 'optional-user',
      ...(fn.apiExposure !== undefined ? { apiExposure: { ...fn.apiExposure } } : {}),
      ...(fn.authorityIndependent === true ? { authorityIndependent: true } : {}),
      ...(fn.publicInline === true ? { publicInline: true } : {}),
      ...(fn.authorityCreating === true ? { authorityCreating: true } : {}),
      ...(fn.retainable === true ? { retainable: true } : {}),
      ...(fn.retentionClass !== undefined ? { retentionClass: fn.retentionClass } : {}),
      ...(Array.isArray(fn.refusals) && fn.refusals.length > 0 ? { refusals: [...fn.refusals] } : {}),
      ...(Array.isArray(fn.trackedRefusals) && fn.trackedRefusals.length > 0
        ? { trackedRefusals: [...fn.trackedRefusals] }
        : {}),
      ...(Array.isArray(fn.authorizationDependence) && fn.authorizationDependence.length > 0
        ? { authorizationDependence: fn.authorizationDependence }
        : {}),
      ...(Array.isArray(fn.authorityProfileDependence) && fn.authorityProfileDependence.length > 0
        ? { authorityProfileDependence: fn.authorityProfileDependence }
        : {}),
      ...(fn.generatedAuthorityOperation !== undefined
        ? { generatedAuthorityOperation: { ...fn.generatedAuthorityOperation } }
        : {}),
      ...(fn.customAuthorization !== undefined
        ? { customAuthorization: structuredClone(fn.customAuthorization) }
        : {}),
      ...(fn.fieldBoundary !== undefined ? { fieldBoundary: fn.fieldBoundary } : {}),
      ...(elevatedDbCapabilities.length > 0 ? { elevatedDbCapabilities } : {}),
      ...(fn.writePolicy !== undefined
        ? { writePolicy: structuredClone(fn.writePolicy) }
        : {}),
      syncabilityClass: syncabilityClass(fn),
      readSetSummary: reads,
      writeSetSummary: writes,
      effectCeiling,
      ...(fn.standardPattern ? { standardPattern: fn.standardPattern } : {}),
      bundleEntrypoint: fn.name,
      uses: fn.uses ?? [],
      runtime: fn.runtime,
    };
  });
}

function readSummary(fn) {
  // The relational read summary names its own mode and both declared
  // sources in root-then-joined order (LLP 0080 §4; retention admission
  // validates this exact shape).
  const relationalPlan = fn.runtime?.HostPlan?.RelationalQuery;
  if (relationalPlan) {
    return {
      mode: 'relational',
      primaryTable: relationalPlan.root,
      tables: [relationalPlan.root, relationalPlan.joined],
      authScopeField: null,
    };
  }
  const searchPlan = fn.runtime?.HostPlan?.SearchQuery;
  if (searchPlan) {
    return {
      mode: 'singleTable',
      primaryTable: searchPlan.table,
      tables: fn.declaredReads ?? [searchPlan.table],
      authScopeField: null,
    };
  }
  if (fn.declaredReads) {
    return { mode: fn.runtime?.IbexModule ? 'handlerDeclared' : (fn.declaredReads.length ? 'singleTable' : 'none'), primaryTable: fn.declaredReads[0] ?? null, tables: fn.declaredReads, authScopeField: fn.authScopeField ?? null };
  }
  const plan = fn.runtime?.HostPlan;
  if (plan?.Query) {
    return { mode: 'singleTable', primaryTable: plan.Query.table, tables: [plan.Query.table] };
  }
  if (plan?.Mutation) {
    const tables = new Set();
    for (const step of plan.Mutation.steps ?? []) {
      const kind = Object.keys(step)[0];
      if (kind === 'Patch' || kind === 'Delete') tables.add(step[kind].table);
    }
    return { mode: tables.size ? 'pointWritePrecondition' : 'none', primaryTable: [...tables][0] ?? null, tables: [...tables] };
  }
  return { mode: 'opaque', primaryTable: null, tables: [] };
}

function writeSummary(fn) {
  if (fn.declaredWrites) {
    return { mode: fn.runtime?.IbexModule ? 'handlerDeclared' : (fn.declaredWrites.length ? 'mutationPlan' : 'none'), primaryTable: fn.declaredWrites[0] ?? null, tables: fn.declaredWrites };
  }
  const plan = fn.runtime?.HostPlan;
  if (plan?.Action) return { mode: 'actionRunMutation', primaryTable: null, tables: [] };
  if (!plan?.Mutation) return { mode: 'none', primaryTable: null, tables: [] };
  const tables = new Set();
  for (const step of plan.Mutation.steps ?? []) {
    const kind = Object.keys(step)[0];
    tables.add(step[kind].table);
  }
  return { mode: 'mutationPlan', primaryTable: [...tables][0] ?? null, tables: [...tables] };
}

export function buildContractMutationDescriptor({
  name,
  args,
  argOrder,
  writes,
  plan,
  sequenceAllocationCount = 0,
}) {
  const optimistic = sequenceAllocationCount === 0;
  return {
    name,
    args,
    argOrder,
    writes,
    invalidates: writes,
    // IR-tier mutations normally embed their plan (Exact LLP 0329 E-B), so
    // the adapter can derive the default optimistic overlay from it.
    optimistic,
    ...(sequenceAllocationCount > 0 ? { atomicOptimisticWithholding: true } : {}),
    // The complete plan remains the durable lane-Q replay authority. Sequence
    // allocation is withheld only from optimistic presentation; reconnect may
    // still submit the original intent for idempotent authoritative settlement.
    plan,
    serverRunnable: true,
  };
}

export function buildContractJsMutationDescriptor({
  name,
  args,
  argOrder,
  writes,
  sequenceCount = 0,
}) {
  return {
    name,
    args,
    argOrder,
    writes,
    invalidates: writes,
    // Ordinary JS mutations retain app-authored reducer eligibility. The
    // distinct atomic marker is the authority to withhold a whole changeset.
    optimistic: false,
    ...(sequenceCount > 0 ? { atomicOptimisticWithholding: true } : {}),
    serverRunnable: true,
  };
}

export function contractCapabilitiesForMutations(contractMutations) {
  const descriptors = Object.values(contractMutations);
  const hasDerivedOverlayMutations = descriptors.some(
    (descriptor) => descriptor.plan !== undefined
      && descriptor.atomicOptimisticWithholding !== true,
  );
  const allMutationsReplayable = descriptors.length > 0
    && descriptors.every((descriptor) => descriptor.plan !== undefined);
  return {
    optimisticMutations: hasDerivedOverlayMutations,
    derivedOptimisticOverlays: hasDerivedOverlayMutations,
    offlineReplay: allMutationsReplayable,
  };
}

function requiredCapabilities(fn) {
  const runtimeCapability = fn.runtime?.IbexModule ? 'ibex_ctx_db_host_bridge' : 'host_plan_runtime';
  const contractCapabilities = [
    'result_contract_v1',
    // @ref LLP 0131#runtime-ingress-validation — the capability posture is
    // app-wide: every v2-generated function carries the descriptor (scalar
    // and empty argument roots included), so deployment to a target that
    // does not run the fail-closed ingress seam refuses outright.
    'args_contract_v1',
    ...(resultContractContainsMedia(fn.resultContract)
      ? ['assets.media-ref-projection.v1']
      : []),
    ...(fn.handlerForm === 'inline' ? ['inline_handler_v1'] : []),
    ...(moduleUsesBoundedBatchReads(fn.runtime?.IbexModule?.source ?? '')
      ? ['bounded_batch_reads_v1']
      : []),
  ];
  if (fn.runtime?.HostPlan?.Mutation?.steps?.some(
    (step) => step.AssetCollection !== undefined,
  )) {
    return [
      runtimeCapability,
      'assets.media-collection.v1',
      'assets.media-ref-projection.v1',
      ...contractCapabilities,
    ];
  }
  if (fn.runtime?.HostPlan?.SearchQuery) {
    return fn.kind === 'LiveQuery'
      ? [
          'live_subscriptions',
          runtimeCapability,
          'full_text_search_v1',
          'live_full_text_search_v1',
          ...contractCapabilities,
        ]
      : [runtimeCapability, 'full_text_search_v1', ...contractCapabilities];
  }
  if (fn.runtime?.HostPlan?.VectorQuery) {
    return [runtimeCapability, 'vector_search_v1', ...contractCapabilities];
  }
  // @ref LLP 0070#non-goals-and-claim-boundary — the jobs surface is an
  // experimental registry id while LLP 0070 is Draft; requiring it forces the
  // artifact-level acknowledgment, and it can never imply a
  // durable-background-work capability class.
  if (fn.runtime?.HostPlan?.JobStatusQuery) {
    const jobs = [runtimeCapability, 'jobs_one_off_v1'];
    return fn.kind === 'LiveQuery'
      ? ['live_subscriptions', ...jobs, ...contractCapabilities]
      : [...jobs, ...contractCapabilities];
  }
  if (fn.runtime?.HostPlan?.PushLedgerQuery) {
    return [runtimeCapability, 'notifications.expoPushSeam', ...contractCapabilities];
  }
  // @ref LLP 0080#2-portable-evaluation-semantics — a target that cannot
  //   execute the relational plan refuses at generation with a
  //   machine-readable capability gap, never at runtime.
  if (fn.runtime?.HostPlan?.RelationalQuery) {
    const relational = [runtimeCapability, 'relational_query_v1'];
    return fn.kind === 'LiveQuery'
      ? ['live_subscriptions', ...relational, ...contractCapabilities]
      : [...relational, ...contractCapabilities];
  }
  // @ref LLP 0209#2-the-graph-ir — GraphQuery is a distinct explicit
  // profile. Its G0 carrier is admitted even though B intentionally ships no
  // evaluator; target capability negotiation remains fail closed.
  if (fn.runtime?.HostPlan?.GraphQuery) {
    return [
      'live_subscriptions',
      runtimeCapability,
      'graph_query_v1',
      ...contractCapabilities,
    ];
  }
  // @ref LLP 0157#d1--the-node-algebra — this capability is selected
  // only from the host-derived normalized single-table node class. Authors
  // cannot assert membership, and the experimental requirement forces target
  // support plus explicit artifact acknowledgment before activation.
  if (singleTableRqsDigestKind(fn) !== null) {
    return [
      'live_subscriptions',
      runtimeCapability,
      'single_table_v1',
      ...contractCapabilities,
    ];
  }
  // @ref LLP 0110#local-and-packaged-publication-authority — these profiles
  // retain dedicated requirements even where the exact local source target
  // publishes them; application artifacts acknowledge but cannot mint the
  // experimental support facts.
  // @ref LLP 0113#1-closed-capability-registry-assignment — static maturity
  // and runtime support remain independent admission gates.
  if (fn.runtime?.HostPlan?.BoundedChildrenQuery) {
    return [
      'live_subscriptions',
      runtimeCapability,
      'bounded_children_v1',
      ...contractCapabilities,
    ];
  }
  if (fn.runtime?.HostPlan?.SnapshotBatch) {
    return [
      'live_subscriptions',
      runtimeCapability,
      'snapshot_batch_v1',
      'bounded_children_v1',
      ...contractCapabilities,
    ];
  }
  if (fn.runtime?.HostPlan?.SnapshotBatchV2) {
    const bounded = fn.runtime.HostPlan.SnapshotBatchV2.nodes
      .some((node) => node.classId === 'bounded_children_v1');
    return [
      'live_subscriptions',
      runtimeCapability,
      'snapshot_batch_v2',
      'relational_query_v1',
      ...(bounded ? ['bounded_children_v1'] : []),
      ...contractCapabilities,
    ];
  }
  if (fn.runtime?.HostPlan?.WriteWithActivity) {
    return [
      runtimeCapability,
      'mutation_read_set_validation',
      'write_activity_v1',
      ...(Array.isArray(fn.sequences) && fn.sequences.length > 0
        ? ['sequence_allocation_v1']
        : []),
      ...contractCapabilities,
    ];
  }
  if (fn.kind === 'LiveQuery') return ['live_subscriptions', runtimeCapability, ...contractCapabilities];
  if (fn.kind === 'Mutation') {
    return [
      runtimeCapability,
      'mutation_read_set_validation',
      ...(Array.isArray(fn.sequences) && fn.sequences.length > 0
        ? ['sequence_allocation_v1']
        : []),
      ...(fn.boundedSkew !== undefined ? ['settlement.bounded_skew'] : []),
      ...contractCapabilities,
    ];
  }
  if (fn.kind === 'Action') {
    const required = [runtimeCapability, 'cron_action_run_mutation'];
    // @ref LLP 0076#target-contract — a streamed action must be refused at
    // artifact admission on targets without the named reader profile, before
    // the handler reaches an external effect. IbexModule source is the closed
    // bundle codegen already owns; the AST-derived detection below can
    // over-require sibling actions but can never invent target authority.
    if (moduleUsesFetchStream(fn.runtime?.IbexModule?.source ?? '')) {
      required.push('bounded_response_stream_v1');
    }
    return [...required, ...contractCapabilities];
  }
  return [runtimeCapability, ...contractCapabilities];
}

// @ref LLP 0076#target-contract — AST-derived rather than textual: a
// `fetchStream` member access (`ctx.fetchStream(...)`, computed string
// access, or a destructuring alias `const { fetchStream } = ctx`) marks the
// module as stream-requiring; comments and unrelated string literals do not.
// An unparseable bundle falls back to the conservative textual scan, which
// can over-require but never widens target authority.
function moduleUsesFetchStream(source) {
  if (!source) return false;
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
    });
  } catch (_) {
    return /\bfetchStream\s*\(/u.test(source);
  }
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'MemberExpression') {
      const property = node.property;
      if (
        (!node.computed && property?.type === 'Identifier' && property.name === 'fetchStream')
        || (node.computed && property?.type === 'Literal' && property.value === 'fetchStream')
      ) {
        found = true;
        return;
      }
    }
    if (node.type === 'Property') {
      const key = node.key;
      if (
        (key?.type === 'Identifier' && key.name === 'fetchStream')
        || (key?.type === 'Literal' && key.value === 'fetchStream')
      ) {
        found = true;
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (found) return;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child);
        }
      } else if (value && typeof value.type === 'string') {
        walk(value);
      }
    }
  };
  walk(program);
  return found;
}

// @ref LLP 0248#d4-dependency-and-cost-evidence-remain-conservative — an
// imperative handler using either batch-read member requires the dedicated
// experimental target capability. AST member/property recognition avoids
// comments and unrelated string literals; parse failure over-requires via a
// conservative textual fallback and never manufactures target support.
function moduleUsesBoundedBatchReads(source) {
  if (!source) return false;
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
    });
  } catch (_) {
    return /\b(?:getMany|uniqueMany)\s*\(/u.test(source);
  }
  const names = new Set(['getMany', 'uniqueMany']);
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'MemberExpression') {
      const property = node.property;
      if (
        (!node.computed && property?.type === 'Identifier' && names.has(property.name))
        || (node.computed && property?.type === 'Literal' && names.has(property.value))
      ) {
        found = true;
        return;
      }
    }
    if (node.type === 'Property') {
      const key = node.key;
      if (
        (key?.type === 'Identifier' && names.has(key.name))
        || (key?.type === 'Literal' && names.has(key.value))
      ) {
        found = true;
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (found) return;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child);
        }
      } else if (value && typeof value.type === 'string') {
        walk(value);
      }
    }
  };
  walk(program);
  return found;
}

function scanStaticUniqueManyCalls(source) {
  if (!source) return [];
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
    });
  } catch (_) {
    return [];
  }
  const calls = [];
  const literalString = (node) => (
    node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null
  );
  const propertyName = (property) => {
    if (!property || property.computed || property.kind !== 'init' || property.type !== 'Property') {
      return null;
    }
    if (property.key?.type === 'Identifier') return property.key.name;
    if (property.key?.type === 'Literal' && typeof property.key.value === 'string') {
      return property.key.value;
    }
    return null;
  };
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const member = node.callee;
      const name = !member.computed && member.property?.type === 'Identifier'
        ? member.property.name
        : member.computed && member.property?.type === 'Literal'
          ? member.property.value
          : null;
      if (name === 'uniqueMany') {
        const table = literalString(node.arguments[0]);
        const index = literalString(node.arguments[1]);
        if (table !== null && index !== null) {
          let literalKeys = null;
          const keys = node.arguments[2];
          if (keys?.type === 'ArrayExpression') {
            literalKeys = keys.elements.map((element) => {
              if (element?.type !== 'ObjectExpression') {
                return {
                  malformed: 'key-not-object', fields: [], nullFields: [], literalValues: [],
                };
              }
              const fields = [];
              const nullFields = [];
              const literalValues = [];
              for (const property of element.properties) {
                const field = propertyName(property);
                if (field === null) {
                  return {
                    malformed: 'key-property-not-static', fields, nullFields, literalValues,
                  };
                }
                fields.push(field);
                if (property.value?.type === 'Literal') {
                  literalValues.push([field, property.value.value]);
                  if (property.value.value === null) nullFields.push(field);
                }
              }
              return { malformed: null, fields, nullFields, literalValues };
            });
          }
          calls.push({
            table,
            index,
            literalKeys,
            line: node.loc?.start.line ?? null,
            column: node.loc?.start.column == null ? null : node.loc.start.column + 1,
          });
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child);
        }
      } else if (value && typeof value.type === 'string') {
        walk(value);
      }
    }
  };
  walk(program);
  return calls;
}

function staticBatchKeyLiteralMatchesField(value, field) {
  if (!field) return false;
  const type = field.field_type;
  if (value === null) return field.optional === true;
  if (type === 'String' || type === 'Principal') return typeof value === 'string';
  if (type === 'Boolean') return typeof value === 'boolean';
  if (type === 'Integer') return Number.isSafeInteger(value);
  if (type === 'Real') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'Json') return true;
  if (!type || typeof type !== 'object' || Array.isArray(type)) return false;
  if (type.Id || type.AssetRef || type.RelationIncarnation) return typeof value === 'string';
  if (type.Enum) {
    return typeof value === 'string' && (type.Enum.values ?? []).includes(value);
  }
  return false;
}

function validateStaticUniqueManyCalls(source, functionName, tables, err) {
  for (const call of scanStaticUniqueManyCalls(source)) {
    const table = tables[call.table];
    const index = table?.indexes?.find((candidate) => candidate.name === call.index) ?? null;
    if (!index || index.unique !== true) {
      err(
        'SNAPBACK_BATCH_READ_INDEX_INVALID',
        'function',
        `${functionName}: ctx.db.uniqueMany requires a declared unique index; ${call.table}.${call.index} is ${index ? 'non-unique' : 'unknown'}`,
        {
          function: functionName,
          table: call.table,
          index: call.index,
          line: call.line,
          column: call.column,
          reason: index ? 'non-unique-index' : 'unknown-index',
        },
      );
      continue;
    }
    if (call.literalKeys === null) continue;
    const expected = [...index.fields].sort();
    for (const [position, key] of call.literalKeys.entries()) {
      const actual = [...key.fields].sort();
      const malformed = key.malformed !== null
        || actual.length !== expected.length
        || actual.some((field, fieldIndex) => field !== expected[fieldIndex]);
      const whereApplicableNull = index.whereApplicable === true
        && key.nullFields.some((field) => expected.includes(field));
      const literalTypeMismatch = key.literalValues.find(([field, value]) => (
        !staticBatchKeyLiteralMatchesField(
          value,
          table.fields?.find((candidate) => candidate.name === field),
        )
      ));
      if (!malformed && !whereApplicableNull && literalTypeMismatch === undefined) continue;
      err(
        'SNAPBACK_BATCH_READ_KEY_INVALID',
        'function',
        `${functionName}: ctx.db.uniqueMany literal key ${position} must be a closed, complete key for ${call.table}.${call.index}${index.whereApplicable === true ? ' with no null components' : ''}`,
        {
          function: functionName,
          table: call.table,
          index: call.index,
          position,
          expectedFields: index.fields,
          actualFields: key.fields,
          line: call.line,
          column: call.column,
          reason: key.malformed
            ?? (whereApplicableNull
              ? 'where-applicable-component-null'
              : literalTypeMismatch !== undefined
                ? 'component-type-mismatch'
                : 'component-set-mismatch'),
          ...(literalTypeMismatch === undefined
            ? {}
            : { field: literalTypeMismatch[0], value: literalTypeMismatch[1] }),
        },
      );
    }
  }
}

function syncabilityClass(fn) {
  if (fn.syncabilityClass) return fn.syncabilityClass;
  if (fn.kind === 'LiveQuery') return 'syncable-live';
  if (fn.kind === 'Query') return 'online-only';
  if (fn.kind === 'Action') return 'action';
  return 'mutation';
}

// Outbound action egress (fetch/timers) is an opt-in DX relaxation that mirrors
// the runtime's SNAPBACK_OUTBOUND_ACTIONS seam. The runtime — not codegen — is the
// security boundary and still gates fetch by handler kind (LLP 0027 / LLP 0009).
function egressAllowedAtCodegen() {
  return /^(1|true)$/i.test(process.env.SNAPBACK_OUTBOUND_ACTIONS || '');
}

// @ref LLP 0051#d1-the-ctx-answer-ledger-recordable-replayable-deterministic-ops — ambient time and entropy are
// refused before bundle load, so the diagnostic must steer authors to the
// host-recorded context values that preserve replay.
function unsupportedAmbientDependencyMessage(code, token) {
  const guide = 'guide/backend/trusted-runtime-values.md';
  if (code === 'BUNDLE_UNSUPPORTED_TIME') {
    return `unsupported ambient dependency ${token}; use ctx.runtime.now() for a trusted integer timestamp (${guide})`;
  }
  if (code === 'BUNDLE_UNSUPPORTED_RANDOM') {
    return `unsupported ambient dependency ${token}; use ctx.runtime.id() for a fresh identifier, or pass an explicit deterministic input for other values (${guide})`;
  }
  if (code === 'BUNDLE_UNSUPPORTED_TIMER') {
    return `unsupported ambient dependency ${token}; do not wait on ambient timers in this handler—use ctx.runtime.now() only when you need a trusted timestamp (${guide})`;
  }
  if (code === 'BUNDLE_UNSUPPORTED_EXPORT') {
    // The 0137 A4 arm dead-ended between this refusal and the runtime's
    // SNAPBACK_HANDLER_EXPORT_MISSING because neither named the actual
    // contract: handler source files are closed scripts, and the loader
    // resolves `exportName` on `globalThis.__snapbackHandlers`.
    return `handler source files are closed scripts, not ES modules; remove the ${token} and register the `
      + 'function on globalThis.__snapbackHandlers = { <exportName>: async (ctx, args) => { ... } } '
      + '(guide/backend/actions-and-fetch.md#the-handler-file-is-a-closed-script)';
  }
  return `unsupported ambient dependency ${token}`;
}

function scanUnsupportedHandlerSource(source, sourcePath = 'handler.mjs') {
  if (/\.(?:ts|mts|tsx|cts)$/iu.test(sourcePath)) {
    return scanUnsupportedTypeScriptHandlerSource(source, sourcePath);
  }
  const allowEgress = egressAllowedAtCodegen();
  let program;
  try {
    // Handler files are closed single-file scripts, not modules. Permit
    // import/export syntax only so the walker can return the stable authored
    // diagnostic instead of degrading it into a parser exception. Runtime
    // execution remains strict and rejects those forms independently.
    //
    // @ref LLP 0009#capability-model — authoring checks are AST-based
    // defense-in-depth; aliases and reflective constructor walks remain the
    // runtime boundary's responsibility.
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
      locations: true,
    });
  } catch (error) {
    const line = Number.isInteger(error?.loc?.line) ? error.loc.line : 1;
    const column = Number.isInteger(error?.loc?.column) ? error.loc.column + 1 : 1;
    const message = String(error?.message ?? error).replace(/\s*\(\d+:\d+\)\s*$/u, '');
    return [{
      code: 'BUNDLE_HANDLER_PARSE_FAILED',
      token: 'syntax',
      message: `handler source is not valid JavaScript: ${message}`,
      line,
      column,
    }];
  }

  const issues = [];
  const seen = new Set();
  const functionConstructors = new Set(CLOSED_SCRIPT_HANDLER_RULES.functionConstructors);
  const timerFunctions = new Set(CLOSED_SCRIPT_HANDLER_RULES.timerFunctions);

  function addIssue(code, token, node, message = unsupportedAmbientDependencyMessage(code, token)) {
    const key = `${code}\0${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      code,
      token,
      message,
      line: node?.loc?.start?.line ?? 1,
      column: (node?.loc?.start?.column ?? 0) + 1,
      offset: node?.start ?? 0,
    });
  }

  function staticMemberName(node) {
    if (!node || node.type !== 'MemberExpression') return null;
    if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
    if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') {
      return node.property.value;
    }
    if (
      node.computed
      && node.property?.type === 'TemplateLiteral'
      && node.property.expressions.length === 0
    ) {
      return node.property.quasis[0]?.value?.cooked ?? null;
    }
    return null;
  }

  function unwrapCallable(node) {
    let current = node;
    while (current?.type === 'ChainExpression') current = current.expression;
    if (current?.type === 'SequenceExpression' && current.expressions.length > 0) {
      return unwrapCallable(current.expressions.at(-1));
    }
    return current;
  }

  // Resolve only an explicit global spelling. This deliberately does not try
  // to follow variables: runtime denial owns aliases and constructor walks.
  function explicitGlobalName(node) {
    const target = unwrapCallable(node);
    if (target?.type === 'Identifier') return target.name;
    if (
      target?.type === 'MemberExpression'
      && unwrapCallable(target.object)?.type === 'Identifier'
      && unwrapCallable(target.object).name === 'globalThis'
    ) {
      return staticMemberName(target);
    }
    return null;
  }

  function explicitGlobalNode(node) {
    const target = unwrapCallable(node);
    if (target?.type === 'MemberExpression') return target.property;
    return target;
  }

  function invokedGlobal(node) {
    const target = unwrapCallable(node);
    const direct = explicitGlobalName(target);
    if (direct) return { name: direct, node: explicitGlobalNode(target) };
    if (target?.type === 'MemberExpression') {
      const method = staticMemberName(target);
      if (method === 'call' || method === 'apply' || method === 'bind') {
        const name = explicitGlobalName(target.object);
        if (name) return { name, node: explicitGlobalNode(target.object) };
      }
    }
    return null;
  }

  function matchesGlobalMember(node, holder, member) {
    const target = unwrapCallable(node);
    return target?.type === 'MemberExpression'
      && staticMemberName(target) === member
      && explicitGlobalName(target.object) === holder;
  }

  function isNonReferenceIdentifier(node, parent, key) {
    if (!parent) return false;
    if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
    if (
      (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
      && key === 'key'
      && !parent.computed
    ) return true;
    if (parent.type === 'VariableDeclarator' && key === 'id') return true;
    if (
      (parent.type === 'FunctionDeclaration'
        || parent.type === 'FunctionExpression'
        || parent.type === 'ArrowFunctionExpression')
      && (key === 'id' || key === 'params')
    ) return true;
    if ((parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && key === 'id') return true;
    if (parent.type === 'CatchClause' && key === 'param') return true;
    if (
      (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')
      && key === 'label'
    ) return true;
    if (parent.type.startsWith('Import') || parent.type === 'ExportSpecifier') return true;
    if (parent.type === 'MetaProperty') return true;
    return false;
  }

  function visit(node, parent, key) {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ImportExpression':
        addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
        break;
      case 'MetaProperty':
        if (node.meta?.name === 'import') {
          addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
        }
        break;
      case 'ExportAllDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        addIssue('BUNDLE_UNSUPPORTED_EXPORT', 'export', node);
        break;
      case 'WithStatement':
        addIssue(
          'BUNDLE_UNSUPPORTED_WITH',
          'with',
          node,
          'unsupported dynamic scope statement with',
        );
        break;
      case 'Identifier':
        if (!isNonReferenceIdentifier(node, parent, key)) {
          if (node.name === 'process') {
            addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', node);
          } else if (node.name === 'WebAssembly') {
            addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', node);
          }
        }
        break;
      case 'MemberExpression': {
        if (unwrapCallable(node.object)?.type === 'Identifier' && unwrapCallable(node.object).name === 'globalThis') {
          const name = staticMemberName(node);
          if (name === 'process') {
            addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', node.property);
          } else if (name === 'WebAssembly') {
            addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', node.property);
          }
        }
        break;
      }
      case 'CallExpression': {
        const invoked = invokedGlobal(node.callee);
        if (invoked?.name === 'eval') {
          addIssue(
            'BUNDLE_UNSUPPORTED_EVAL',
            'eval',
            invoked.node,
            'unsupported dynamic code evaluation eval',
          );
        } else if (functionConstructors.has(invoked?.name)) {
          addIssue(
            'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
            invoked.name,
            invoked.node,
            `unsupported dynamic code constructor ${invoked.name}`,
          );
        } else if (invoked?.name === 'require') {
          addIssue('BUNDLE_UNSUPPORTED_REQUIRE', 'require', invoked.node);
        } else if (!allowEgress && invoked?.name === 'fetch') {
          addIssue('BUNDLE_UNSUPPORTED_FETCH', 'fetch', invoked.node);
        } else if (!allowEgress && timerFunctions.has(invoked?.name)) {
          addIssue('BUNDLE_UNSUPPORTED_TIMER', 'timer', invoked.node);
        }

        // Obvious reflective spellings are still authored direct uses. More
        // complex aliases intentionally fall through to the runtime boundary.
        if (
          matchesGlobalMember(node.callee, 'Reflect', 'apply')
          || matchesGlobalMember(node.callee, 'Reflect', 'construct')
        ) {
          const reflected = explicitGlobalName(node.arguments[0]);
          const reflectedNode = explicitGlobalNode(node.arguments[0]);
          if (reflected === 'eval') {
            addIssue(
              'BUNDLE_UNSUPPORTED_EVAL',
              'eval',
              reflectedNode,
              'unsupported dynamic code evaluation eval',
            );
          } else if (functionConstructors.has(reflected)) {
            addIssue(
              'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
              reflected,
              reflectedNode,
              `unsupported dynamic code constructor ${reflected}`,
            );
          }
        }

        if (matchesGlobalMember(node.callee, 'Math', 'random')) {
          addIssue('BUNDLE_UNSUPPORTED_RANDOM', 'Math.random', unwrapCallable(node.callee));
        }
        if (matchesGlobalMember(node.callee, 'Date', 'now')) {
          addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', unwrapCallable(node.callee));
        }
        break;
      }
      case 'NewExpression': {
        const invoked = invokedGlobal(node.callee);
        if (functionConstructors.has(invoked?.name)) {
          addIssue(
            'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
            invoked.name,
            invoked.node,
            `unsupported dynamic code constructor ${invoked.name}`,
          );
        }
        if (invoked?.name === 'Date') {
          addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', invoked.node);
        }
        break;
      }
      case 'TaggedTemplateExpression': {
        const invoked = invokedGlobal(node.tag);
        if (functionConstructors.has(invoked?.name)) {
          addIssue(
            'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
            invoked.name,
            invoked.node,
            `unsupported dynamic code constructor ${invoked.name}`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  function walk(node, parent = null, key = null) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    visit(node, parent, key);
    for (const [childKey, child] of Object.entries(node)) {
      if (childKey === 'loc' || childKey === 'start' || childKey === 'end') continue;
      if (Array.isArray(child)) {
        for (const item of child) walk(item, node, childKey);
      } else {
        walk(child, node, childKey);
      }
    }
  }

  walk(program);
  return issues
    .sort((left, right) => left.offset - right.offset || left.code.localeCompare(right.code))
    .map(({ offset: _offset, ...issue }) => issue);
}

// TypeScript handler files are a declared authoring surface. Parse authored
// bytes with the pinned TypeScript AST for capability diagnostics; the closed
// syntax-erasure transform later emits the separate JavaScript runtime bytes.
function scanUnsupportedTypeScriptHandlerSource(source, sourcePath) {
  const allowEgress = egressAllowedAtCodegen();
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostic = sourceFile.parseDiagnostics?.[0];
  if (parseDiagnostic) {
    const start = Number.isInteger(parseDiagnostic.start) ? parseDiagnostic.start : 0;
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    return [{
      code: 'BUNDLE_HANDLER_PARSE_FAILED',
      token: 'syntax',
      message: `handler source is not valid TypeScript: ${ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, '\n')}`,
      line: location.line + 1,
      column: location.character + 1,
    }];
  }

  const issues = [];
  const seen = new Set();
  const functionConstructors = new Set(CLOSED_SCRIPT_HANDLER_RULES.functionConstructors);
  const timerFunctions = new Set(CLOSED_SCRIPT_HANDLER_RULES.timerFunctions);

  function addIssue(code, token, node, message = unsupportedAmbientDependencyMessage(code, token)) {
    const key = `${code}\0${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    const offset = node?.getStart?.(sourceFile) ?? 0;
    const location = sourceFile.getLineAndCharacterOfPosition(offset);
    issues.push({
      code,
      token,
      message,
      line: location.line + 1,
      column: location.character + 1,
      offset,
    });
  }

  function isMember(node) {
    return Boolean(node)
      && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node));
  }

  function memberObject(node) {
    return isMember(node) ? node.expression : null;
  }

  function memberNameNode(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name;
    return ts.isElementAccessExpression(node) ? node.argumentExpression : null;
  }

  function staticMemberName(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (!ts.isElementAccessExpression(node)) return null;
    const argument = node.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return argument.text;
    }
    return null;
  }

  function unwrapCallable(node) {
    let current = node;
    while (
      current
      && (ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current)
        || ts.isNonNullExpression(current)
        || ts.isSatisfiesExpression(current))
    ) {
      current = current.expression;
    }
    if (current && ts.isCommaListExpression?.(current) && current.elements.length > 0) {
      return unwrapCallable(current.elements.at(-1));
    }
    if (current && ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return unwrapCallable(current.right);
    }
    return current;
  }

  function explicitGlobalName(node) {
    const target = unwrapCallable(node);
    if (!target) return null;
    if (ts.isIdentifier(target)) return target.text;
    if (
      isMember(target)
      && ts.isIdentifier(unwrapCallable(memberObject(target)))
      && unwrapCallable(memberObject(target)).text === 'globalThis'
    ) {
      return staticMemberName(target);
    }
    return null;
  }

  function explicitGlobalNode(node) {
    const target = unwrapCallable(node);
    return isMember(target) ? memberNameNode(target) : target;
  }

  function invokedGlobal(node) {
    const target = unwrapCallable(node);
    const direct = explicitGlobalName(target);
    if (direct) return { name: direct, node: explicitGlobalNode(target) };
    if (isMember(target)) {
      const method = staticMemberName(target);
      if (method === 'call' || method === 'apply' || method === 'bind') {
        const name = explicitGlobalName(memberObject(target));
        if (name) return { name, node: explicitGlobalNode(memberObject(target)) };
      }
    }
    return null;
  }

  function matchesGlobalMember(node, holder, member) {
    const target = unwrapCallable(node);
    return isMember(target)
      && staticMemberName(target) === member
      && explicitGlobalName(memberObject(target)) === holder;
  }

  function isNamedDeclarationIdentifier(node, parent) {
    if (parent?.name !== node) return false;
    return ts.isVariableDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isBindingElement(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)
      || ts.isInterfaceDeclaration(parent)
      || ts.isTypeAliasDeclaration(parent)
      || ts.isEnumDeclaration(parent)
      || ts.isModuleDeclaration(parent)
      || ts.isImportClause(parent)
      || ts.isImportSpecifier(parent)
      || ts.isNamespaceImport(parent)
      || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent);
  }

  function isNonReferenceIdentifier(node, parent) {
    if (!parent) return false;
    if (ts.isTypeNode(parent) || isNamedDeclarationIdentifier(node, parent)) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
    if (
      (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent))
      && parent.name === node
    ) return true;
    if (ts.isLabeledStatement(parent) && parent.label === node) return true;
    if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return true;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
    if (ts.isMetaProperty(parent)) return true;
    return false;
  }

  function exportModifier(node) {
    if (!ts.canHaveModifiers(node)) return null;
    return ts.getModifiers(node)?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? null;
  }

  function visit(node) {
    const parent = node.parent;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
    } else if (
      ts.isExportDeclaration(node)
      || ts.isExportAssignment(node)
      || exportModifier(node)
    ) {
      addIssue('BUNDLE_UNSUPPORTED_EXPORT', 'export', exportModifier(node) ?? node);
    } else if (ts.isWithStatement(node)) {
      addIssue('BUNDLE_UNSUPPORTED_WITH', 'with', node, 'unsupported dynamic scope statement with');
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
    } else if (ts.isIdentifier(node) && !isNonReferenceIdentifier(node, parent)) {
      if (node.text === 'process') {
        addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', node);
      } else if (node.text === 'WebAssembly') {
        addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', node);
      }
    }

    if (isMember(node)) {
      const holder = unwrapCallable(memberObject(node));
      if (ts.isIdentifier(holder) && holder.text === 'globalThis') {
        const name = staticMemberName(node);
        if (name === 'process') {
          addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', memberNameNode(node));
        } else if (name === 'WebAssembly') {
          addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', memberNameNode(node));
        }
      }
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node.expression);
      }
      const invoked = invokedGlobal(node.expression);
      if (invoked?.name === 'eval') {
        addIssue('BUNDLE_UNSUPPORTED_EVAL', 'eval', invoked.node, 'unsupported dynamic code evaluation eval');
      } else if (functionConstructors.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', invoked.name, invoked.node, `unsupported dynamic code constructor ${invoked.name}`);
      } else if (invoked?.name === 'require') {
        addIssue('BUNDLE_UNSUPPORTED_REQUIRE', 'require', invoked.node);
      } else if (!allowEgress && invoked?.name === 'fetch') {
        addIssue('BUNDLE_UNSUPPORTED_FETCH', 'fetch', invoked.node);
      } else if (!allowEgress && timerFunctions.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_TIMER', 'timer', invoked.node);
      }

      if (matchesGlobalMember(node.expression, 'Reflect', 'apply')
        || matchesGlobalMember(node.expression, 'Reflect', 'construct')) {
        const reflected = explicitGlobalName(node.arguments[0]);
        const reflectedNode = explicitGlobalNode(node.arguments[0]);
        if (reflected === 'eval') {
          addIssue('BUNDLE_UNSUPPORTED_EVAL', 'eval', reflectedNode, 'unsupported dynamic code evaluation eval');
        } else if (functionConstructors.has(reflected)) {
          addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', reflected, reflectedNode, `unsupported dynamic code constructor ${reflected}`);
        }
      }
      if (matchesGlobalMember(node.expression, 'Math', 'random')) {
        addIssue('BUNDLE_UNSUPPORTED_RANDOM', 'Math.random', unwrapCallable(node.expression));
      }
      if (matchesGlobalMember(node.expression, 'Date', 'now')) {
        addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', unwrapCallable(node.expression));
      }
    } else if (ts.isNewExpression(node)) {
      const invoked = invokedGlobal(node.expression);
      if (functionConstructors.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', invoked.name, invoked.node, `unsupported dynamic code constructor ${invoked.name}`);
      }
      if (invoked?.name === 'Date') addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', invoked.node);
    } else if (ts.isTaggedTemplateExpression(node)) {
      const invoked = invokedGlobal(node.tag);
      if (functionConstructors.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', invoked.name, invoked.node, `unsupported dynamic code constructor ${invoked.name}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues
    .sort((left, right) => left.offset - right.offset || left.code.localeCompare(right.code))
    .map(({ offset: _offset, ...issue }) => issue);
}

function scanStaticallyInvalidJsQueryResults(source, exportName) {
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch {
    // The handler bundle's existing syntax/evaluation path owns parse errors.
    return [];
  }

  const functions = [];
  const visitDeclarations = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      (node.type === 'FunctionDeclaration' && node.id?.name === exportName) ||
      (node.type === 'VariableDeclarator'
        && node.id?.name === exportName
        && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type))
    ) {
      functions.push(node.type === 'FunctionDeclaration' ? node : node.init);
      return;
    }
    if (
      node.type === 'Property'
      && !node.computed
      && (node.key?.name === exportName || node.key?.value === exportName)
      && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.value?.type)
    ) {
      functions.push(node.value);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visitDeclarations);
      else if (value && typeof value === 'object') visitDeclarations(value);
    }
  };
  visitDeclarations(program);

  const problems = [];
  const inspectBody = (node, rootFunction) => {
    if (!node || typeof node !== 'object') return;
    if (
      node !== rootFunction
      && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) return;
    if (node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression') {
      problems.push({
        line: node.argument.loc?.start.line ?? node.loc?.start.line ?? 1,
        column: (node.argument.loc?.start.column ?? node.loc?.start.column ?? 0) + 1,
      });
      return;
    }
    if (node === rootFunction && node.type === 'ArrowFunctionExpression' && node.body?.type === 'ObjectExpression') {
      problems.push({
        line: node.body.loc?.start.line ?? 1,
        column: (node.body.loc?.start.column ?? 0) + 1,
      });
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => inspectBody(child, rootFunction));
      else if (value && typeof value === 'object') inspectBody(value, rootFunction);
    }
  };
  functions.forEach((fn) => inspectBody(fn, fn));
  return problems;
}

function legacyProtectedHandlerSourceScan(source) {
  const searchable = maskCommentsAndStrings(source);
  const checks = [
    [
      'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY',
      /\bctx\s*\.\s*runtime\s*\.\s*now\s*\(/u,
      'RuntimeNow',
    ],
    [
      'SNAPBACK_AUTH_MUTABLE_INPUT_DENIED',
      /\bctx\s*\.\s*runtime\s*\.\s*id\s*\(/u,
      'RuntimeId',
    ],
  ];
  return checks
    .map(([code, pattern, inputKind]) => {
      const match = pattern.exec(searchable);
      if (!match) return null;
      return {
        code,
        inputKind,
        message: `protected result depends on denied mutable input ${inputKind}`,
        ...sourcePosition(source, match.index),
      };
    })
    .filter(Boolean);
}

// Attribute denied mutable inputs to one exported handler's conservative
// local call graph. Handler files cannot import modules, so the graph's
// relevant edges are declarations, local aliases, object methods, callbacks,
// `this` siblings, and nested closures. Every ambiguous edge on a known local
// helper object follows all possible methods; it never guesses one.
function scanProtectedHandlerReachableSource(source, exportName) {
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
      locations: true,
    });
  } catch {
    return legacyProtectedHandlerSourceScan(source);
  }

  const functionKinds = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
  ]);
  const directTargets = new Map();
  const aliasTargets = new Map();
  const objectTargets = new Map();
  const functionOwners = new WeakMap();
  const exportedFunctions = [];
  const addSetValue = (map, key, value) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  const propertyName = (property) => {
    if (!property?.computed && property?.key?.type === 'Identifier') return property.key.name;
    if (property?.key?.type === 'Literal' && typeof property.key.value === 'string') {
      return property.key.value;
    }
    return null;
  };
  const expressionKey = (expression) => {
    if (expression?.type === 'Identifier') return expression.name;
    if (expression?.type !== 'MemberExpression') return null;
    const base = expressionKey(expression.object);
    if (base === null) return null;
    const member = expression.computed
      ? (expression.property?.type === 'Literal' && typeof expression.property.value === 'string'
        ? expression.property.value
        : null)
      : (expression.property?.type === 'Identifier' ? expression.property.name : null);
    return member === null ? null : `${base}.${member}`;
  };
  const registerBinding = (key, value) => {
    if (!key || !value) return;
    if (functionKinds.has(value.type)) {
      addSetValue(directTargets, key, value);
      return;
    }
    const target = expressionKey(value);
    if (target !== null) addSetValue(aliasTargets, key, target);
  };
  const registerObject = (object, key = null) => {
    if (object?.type !== 'ObjectExpression') return;
    const owner = new Map();
    for (const property of object.properties ?? []) {
      if (property?.type !== 'Property') continue;
      const member = propertyName(property);
      if (member === null) continue;
      const ownerEntry = { functions: new Set(), keys: new Set() };
      if (functionKinds.has(property.value?.type)) {
        ownerEntry.functions.add(property.value);
        if (key !== null) {
          addSetValue(directTargets, `${key}.${member}`, property.value);
          addSetValue(objectTargets, key, property.value);
        }
      } else {
        const target = expressionKey(property.value);
        if (target !== null) {
          ownerEntry.keys.add(target);
          if (key !== null) addSetValue(aliasTargets, `${key}.${member}`, target);
        }
      }
      owner.set(member, ownerEntry);
    }
    for (const entry of owner.values()) {
      for (const fn of entry.functions) {
        if (!functionOwners.has(fn)) functionOwners.set(fn, new Set());
        functionOwners.get(fn).add(owner);
      }
    }
  };
  const indexFunctions = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      addSetValue(directTargets, node.id.name, node);
      if (node.id.name === exportName) exportedFunctions.push(node);
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      registerBinding(node.id.name, node.init);
      registerObject(node.init, node.id.name);
      if (node.id.name === exportName && functionKinds.has(node.init?.type)) {
        exportedFunctions.push(node.init);
      }
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'ObjectPattern') {
      const sourceKey = expressionKey(node.init);
      if (sourceKey !== null) {
        for (const property of node.id.properties ?? []) {
          if (property?.type !== 'Property') continue;
          const member = propertyName(property);
          const local = property.value?.type === 'Identifier' ? property.value.name : null;
          if (member !== null && local !== null) {
            addSetValue(aliasTargets, local, `${sourceKey}.${member}`);
          }
        }
      }
    } else if (
      node.type === 'Property'
      && propertyName(node) === exportName
      && functionKinds.has(node.value?.type)
    ) {
      exportedFunctions.push(node.value);
    } else if (node.type === 'AssignmentExpression') {
      const key = expressionKey(node.left);
      if (key !== null) {
        registerBinding(key, node.right);
        registerObject(node.right, key);
      }
    }
    if (node.type === 'ObjectExpression') registerObject(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) indexFunctions(child);
      } else if (value && typeof value === 'object') {
        indexFunctions(value);
      }
    }
  };
  indexFunctions(program);
  if (exportedFunctions.length === 0) return legacyProtectedHandlerSourceScan(source);

  const targetsForKey = (key, seen = new Set()) => {
    if (key === null || seen.has(key)) return new Set();
    seen.add(key);
    const targets = new Set(directTargets.get(key) ?? []);
    for (const alias of aliasTargets.get(key) ?? []) {
      for (const target of targetsForKey(alias, seen)) targets.add(target);
    }
    const dot = key.indexOf('.');
    if (dot > 0) {
      const base = key.slice(0, dot);
      const suffix = key.slice(dot);
      for (const alias of aliasTargets.get(base) ?? []) {
        for (const target of targetsForKey(`${alias}${suffix}`, seen)) targets.add(target);
      }
    }
    return targets;
  };
  const objectFunctionsForKey = (key, seen = new Set()) => {
    if (key === null || seen.has(key)) return new Set();
    seen.add(key);
    const targets = new Set(objectTargets.get(key) ?? []);
    for (const alias of aliasTargets.get(key) ?? []) {
      for (const target of objectFunctionsForKey(alias, seen)) targets.add(target);
    }
    return targets;
  };
  const pending = [];
  const functionRoles = new WeakMap();
  const enqueueFunction = (fn, {
    contextIndexes = [],
    runtimeIndexes = [],
    capturedContextNames = [],
    capturedRuntimeNames = [],
    capturedRuntimeMethods = [],
    assumeFirstContext = true,
  } = {}) => {
    if (!functionKinds.has(fn?.type)) return;
    let state = functionRoles.get(fn);
    if (!state) {
      state = {
        contextIndexes: new Set(),
        runtimeIndexes: new Set(),
        capturedContextNames: new Set(),
        capturedRuntimeNames: new Set(),
        capturedRuntimeMethods: new Map(),
        version: 0,
        analyzedVersion: -1,
        queued: false,
      };
      functionRoles.set(fn, state);
    }
    const addIndexes = (target, indexes) => {
      for (const index of indexes) {
        if (!Number.isSafeInteger(index) || index < 0 || target.has(index)) continue;
        target.add(index);
        state.version += 1;
      }
    };
    if (assumeFirstContext && (fn.params?.length ?? 0) > 0) {
      addIndexes(state.contextIndexes, [0]);
    }
    addIndexes(state.contextIndexes, contextIndexes);
    addIndexes(state.runtimeIndexes, runtimeIndexes);
    const addNames = (target, names) => {
      for (const name of names) {
        if (typeof name !== 'string' || target.has(name)) continue;
        target.add(name);
        state.version += 1;
      }
    };
    addNames(state.capturedContextNames, capturedContextNames);
    addNames(state.capturedRuntimeNames, capturedRuntimeNames);
    for (const [name, method] of capturedRuntimeMethods) {
      if (
        typeof name !== 'string'
        || (method !== 'now' && method !== 'id')
        || state.capturedRuntimeMethods.get(name) === method
      ) continue;
      state.capturedRuntimeMethods.set(name, method);
      state.version += 1;
    }
    if (!state.queued && state.analyzedVersion !== state.version) {
      state.queued = true;
      pending.push(fn);
    }
  };
  for (const fn of new Set(exportedFunctions)) enqueueFunction(fn);
  const issues = [];
  const issueKinds = new Set();
  const addIssue = (code, inputKind, node) => {
    if (issueKinds.has(code)) return;
    issueKinds.add(code);
    issues.push({
      code,
      inputKind,
      message: `protected result depends on denied mutable input ${inputKind}`,
      line: node.loc?.start.line ?? 1,
      column: (node.loc?.start.column ?? 0) + 1,
    });
  };

  while (pending.length > 0) {
    const fn = pending.shift();
    const roleState = functionRoles.get(fn);
    roleState.queued = false;
    if (roleState.analyzedVersion === roleState.version) continue;
    roleState.analyzedVersion = roleState.version;
    const contextNames = new Set(['ctx', ...roleState.capturedContextNames]);
    const runtimeNames = new Set(roleState.capturedRuntimeNames);
    const runtimeMethods = new Map(roleState.capturedRuntimeMethods);
    const bindParameterRole = (pattern, role) => {
      if (pattern?.type === 'AssignmentPattern') {
        bindParameterRole(pattern.left, role);
        return;
      }
      if (pattern?.type === 'RestElement') {
        bindParameterRole(pattern.argument, role);
        return;
      }
      if (pattern?.type === 'Identifier') {
        if (role === 'context') contextNames.add(pattern.name);
        else if (role === 'runtime') runtimeNames.add(pattern.name);
        return;
      }
      if (pattern?.type !== 'ObjectPattern') return;
      for (const property of pattern.properties ?? []) {
        if (property?.type !== 'Property') continue;
        const member = propertyName(property);
        const value = property.value?.type === 'AssignmentPattern'
          ? property.value.left
          : property.value;
        if (role === 'context' && member === 'runtime') {
          bindParameterRole(value, 'runtime');
        } else if (
          role === 'runtime'
          && (member === 'now' || member === 'id')
          && value?.type === 'Identifier'
        ) {
          runtimeMethods.set(value.name, member);
        }
      }
    };
    for (const index of roleState.contextIndexes) {
      bindParameterRole(fn.params?.[index], 'context');
    }
    for (const index of roleState.runtimeIndexes) {
      bindParameterRole(fn.params?.[index], 'runtime');
    }

    let aliasesChanged = true;
    while (aliasesChanged) {
      aliasesChanged = false;
      const collectAliases = (node, root) => {
        if (!node || typeof node !== 'object') return;
        if (node !== root && functionKinds.has(node.type)) return;
        if (node.type === 'VariableDeclarator') {
          if (node.id?.type === 'Identifier' && node.init?.type === 'Identifier') {
            if (contextNames.has(node.init.name) && !contextNames.has(node.id.name)) {
              contextNames.add(node.id.name);
              aliasesChanged = true;
            }
            if (runtimeNames.has(node.init.name) && !runtimeNames.has(node.id.name)) {
              runtimeNames.add(node.id.name);
              aliasesChanged = true;
            }
            const method = runtimeMethods.get(node.init.name);
            if (method && runtimeMethods.get(node.id.name) !== method) {
              runtimeMethods.set(node.id.name, method);
              aliasesChanged = true;
            }
          } else if (node.id?.type === 'Identifier' && node.init?.type === 'MemberExpression') {
            const base = node.init.object;
            const member = node.init.computed
              ? (node.init.property?.type === 'Literal' ? node.init.property.value : null)
              : node.init.property?.name;
            if (
              member === 'runtime'
              && base?.type === 'Identifier'
              && contextNames.has(base.name)
              && !runtimeNames.has(node.id.name)
            ) {
              runtimeNames.add(node.id.name);
              aliasesChanged = true;
            } else if (
              (member === 'now' || member === 'id')
              && base?.type === 'Identifier'
              && runtimeNames.has(base.name)
              && runtimeMethods.get(node.id.name) !== member
            ) {
              runtimeMethods.set(node.id.name, member);
              aliasesChanged = true;
            }
          } else if (node.id?.type === 'ObjectPattern') {
            const source = node.init;
            const sourceIsContext =
              source?.type === 'Identifier' && contextNames.has(source.name);
            const sourceIsRuntime = (
              source?.type === 'Identifier' && runtimeNames.has(source.name)
            ) || (
              source?.type === 'MemberExpression'
              && !source.computed
              && source.property?.name === 'runtime'
              && source.object?.type === 'Identifier'
              && contextNames.has(source.object.name)
            );
            for (const property of node.id.properties ?? []) {
              if (property?.type !== 'Property' || property.value?.type !== 'Identifier') continue;
              const member = propertyName(property);
              if (
                sourceIsContext
                && member === 'runtime'
                && !runtimeNames.has(property.value.name)
              ) {
                runtimeNames.add(property.value.name);
                aliasesChanged = true;
              } else if (
                sourceIsRuntime
                && (member === 'now' || member === 'id')
                && runtimeMethods.get(property.value.name) !== member
              ) {
                runtimeMethods.set(property.value.name, member);
                aliasesChanged = true;
              }
            }
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const child of value) collectAliases(child, root);
          } else if (value && typeof value === 'object') {
            collectAliases(value, root);
          }
        }
      };
      collectAliases(fn, fn);
    }

    const isRuntimeInputCall = (node, method) => {
      if (node?.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (callee?.type === 'Identifier' && runtimeMethods.get(callee.name) === method) {
        return true;
      }
      if (
        callee?.type !== 'MemberExpression'
        || callee.computed
        || callee.property?.type !== 'Identifier'
        || callee.property.name !== method
      ) return false;
      const runtime = callee.object;
      return (
        runtime?.type === 'Identifier'
        && runtimeNames.has(runtime.name)
      ) || (
        runtime?.type === 'MemberExpression'
        && !runtime.computed
        && runtime.property?.type === 'Identifier'
        && runtime.property.name === 'runtime'
        && runtime.object?.type === 'Identifier'
        && contextNames.has(runtime.object.name)
      );
    };
    const argumentRole = (expression) => {
      const value = expression?.type === 'ChainExpression'
        ? expression.expression
        : expression;
      if (value?.type === 'Identifier') {
        if (runtimeNames.has(value.name)) return 'runtime';
        if (contextNames.has(value.name)) return 'context';
        return null;
      }
      if (value?.type !== 'MemberExpression') return null;
      const member = value.computed
        ? (value.property?.type === 'Literal' ? value.property.value : null)
        : value.property?.name;
      if (
        member === 'runtime'
        && value.object?.type === 'Identifier'
        && contextNames.has(value.object.name)
      ) return 'runtime';
      return null;
    };
    const enqueueCallTarget = (target, args) => {
      const contextIndexes = [];
      const runtimeIndexes = [];
      for (const [index, argument] of (args ?? []).entries()) {
        const role = argumentRole(argument);
        if (role === 'context') contextIndexes.push(index);
        else if (role === 'runtime') runtimeIndexes.push(index);
      }
      enqueueFunction(target, { contextIndexes, runtimeIndexes });
    };
    const inspectReachableBody = (node, root) => {
      if (!node || typeof node !== 'object') return;
      if (node !== root && functionKinds.has(node.type)) {
        // A nested closure may consume the protected handler's context,
        // runtime, or destructured runtime methods without receiving them as
        // call arguments. Carry the lexical role environment into its own
        // work-list analysis so renamed context captures cannot hide mutable
        // visibility inputs.
        enqueueFunction(node, {
          capturedContextNames: contextNames,
          capturedRuntimeNames: runtimeNames,
          capturedRuntimeMethods: runtimeMethods,
        });
        return;
      }
      if (node.type === 'CallExpression') {
        if (isRuntimeInputCall(node, 'now')) {
          addIssue('SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY', 'RuntimeNow', node);
        } else if (isRuntimeInputCall(node, 'id')) {
          addIssue('SNAPBACK_AUTH_MUTABLE_INPUT_DENIED', 'RuntimeId', node);
        }
        const calleeKey = expressionKey(node.callee);
        const callTargets = new Set(targetsForKey(calleeKey));
        if (functionKinds.has(node.callee?.type)) {
          callTargets.add(node.callee);
        } else if (node.callee?.type === 'MemberExpression') {
          if (node.callee.object?.type === 'ThisExpression') {
            const member = node.callee.computed
              ? (node.callee.property?.type === 'Literal' ? node.callee.property.value : null)
              : node.callee.property?.name;
            for (const owner of functionOwners.get(fn) ?? []) {
              const entries = member === null
                ? [...owner.values()]
                : [owner.get(member)].filter(Boolean);
              for (const entry of entries) {
                for (const target of entry.functions) callTargets.add(target);
                for (const key of entry.keys) {
                  for (const target of targetsForKey(key)) callTargets.add(target);
                }
              }
            }
          } else if (calleeKey === null || targetsForKey(calleeKey).size === 0) {
            const base = expressionKey(node.callee.object);
            for (const target of objectFunctionsForKey(base)) callTargets.add(target);
          }
        }
        for (const target of callTargets) enqueueCallTarget(target, node.arguments);
      }
      if (node.type === 'Identifier') {
        for (const target of targetsForKey(node.name)) enqueueFunction(target);
      } else if (node.type === 'MemberExpression') {
        for (const target of targetsForKey(expressionKey(node))) enqueueFunction(target);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) inspectReachableBody(child, root);
        } else if (value && typeof value === 'object') {
          inspectReachableBody(value, root);
        }
      }
    };
    inspectReachableBody(fn, fn);
  }
  return issues;
}

function maskCommentsAndStrings(source) {
  const masked = maskSourceSegment(source, 0, null);
  return masked.out;
}

function maskSourceSegment(source, start, until) {
  let out = '';
  let i = start;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (until && c === until) break;
    if (c === '/' && n === '/') {
      out += '  ';
      i += 2;
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '/' && isRegexLiteralStart(source, i)) {
      out += ' ';
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const current = source[i];
        out += current === '\n' ? '\n' : ' ';
        if (current === '\\' && i + 1 < source.length) {
          out += source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        i += 1;
        if (current === '/' && !inClass) {
          while (/[A-Za-z]/.test(source[i] ?? '')) {
            out += ' ';
            i += 1;
          }
          break;
        }
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += ' ';
      i += 1;
      while (i < source.length) {
        const current = source[i];
        out += current === '\n' ? '\n' : ' ';
        if (current === '\\' && i + 1 < source.length) {
          out += source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        i += 1;
        if (current === quote) break;
      }
      continue;
    }
    if (c === '`') {
      out += ' ';
      i += 1;
      while (i < source.length) {
        const current = source[i];
        const next = source[i + 1];
        if (current === '\\' && i + 1 < source.length) {
          out += ' ';
          out += next === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (current === '$' && next === '{') {
          out += '  ';
          i += 2;
          const expr = maskSourceSegment(source, i, '}');
          out += expr.out;
          i = expr.index;
          if (source[i] === '}') {
            out += ' ';
            i += 1;
          }
          continue;
        }
        out += current === '\n' ? '\n' : ' ';
        i += 1;
        if (current === '`') break;
      }
      continue;
    }
    if (c === '{' && until === '}') {
      out += c;
      i += 1;
      const inner = maskSourceSegment(source, i, '}');
      out += inner.out;
      i = inner.index;
      if (source[i] === '}') {
        out += '}';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return { out, index: i };
}

function isRegexLiteralStart(source, slashIndex) {
  let i = slashIndex - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;
  const prev = source[i];
  if ('([{=,:;!&|?+-*~^<>%'.includes(prev)) return true;
  const prefix = source.slice(0, i + 1);
  const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(prefix)?.[1];
  return ['return', 'case', 'throw', 'typeof', 'delete', 'void', 'yield', 'await', 'in', 'of'].includes(word ?? '');
}

function sourcePosition(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function queryGroupEntryName(functionName, occurrences, usedNames) {
  let count = (occurrences.get(functionName) ?? 0) + 1;
  let candidate = count === 1 ? functionName : `${functionName}${count}`;
  while (usedNames.has(candidate)) {
    count += 1;
    candidate = `${functionName}${count}`;
  }
  occurrences.set(functionName, count);
  usedNames.add(candidate);
  return candidate;
}

// @ref LLP 0112#generated-reference — generated bundle groups are the bounded
// LiveQuery-only projection of the broader preload manifest, and runtime
// values and declarations share one admission function.
function generatedQueryGroupRoutes(functions, routesManifest) {
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  return (routesManifest?.routes ?? []).filter((routeEntry) => (
    (routeEntry.registerGroupEligible === true || routeEntry.mixedGroupEligible === true)
    &&
    routeEntry.queries.length >= 1
    && routeEntry.queries.length <= 32
    && routeEntry.queries.every((query) => {
      const fn = byName.get(query.function);
      const kind = fn?.kind;
      if (!['documents', 'records', 'legacyQueryRowsV0'].includes(fn?.resultContract?.kind)) {
        return false;
      }
      return routeEntry.registerGroupEligible === true
        ? kind === 'LiveQuery'
        : kind === 'Query' || kind === 'LiveQuery';
    })
  ));
}

function queryGroupDefinition(routeEntry) {
  return {
    route: routeEntry.route,
    queries: routeEntry.queries,
    ...(routeEntry.persist === false ? { persist: false } : {}),
  };
}

function queryGroupDefinitionHash(routeEntry) {
  const canonicalDefinition = stableJson(queryGroupDefinition(routeEntry), 0);
  return `sha256:${sha256(`snapback:query-group-reference:v1\n${canonicalDefinition}`)}`;
}

function mixedQueryGroupDefinitionHash(routeEntry) {
  const canonicalDefinition = stableJson({
    ...queryGroupDefinition(routeEntry),
    planHash: routeEntry.mixedProfile.planHash,
  }, 0);
  return `sha256:${sha256(`snapback:query-group-reference:v2\n${canonicalDefinition}`)}`;
}

function renderQueryGroupReferences(
  appId,
  functions,
  routesManifest,
  expectedGeneration,
  authoredSourceHash,
) {
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const groups = dict();
  for (const routeEntry of generatedQueryGroupRoutes(functions, routesManifest)) {
    const occurrences = new Map();
    const usedNames = new Set();
    const mixed = routeEntry.mixedGroupEligible === true;
    const queries = routeEntry.queries.map((query, position) => {
      const fn = byName.get(query.function);
      if (!fn) {
        throw codegenError(
          'SNAPBACK_CODEGEN_QUERY_GROUP_FUNCTION_UNKNOWN',
          `codegen internal error: query group references unknown function ${query.function}`,
          { details: { function: query.function, route: routeEntry.route } },
        );
      }
      return {
        name: queryGroupEntryName(query.function, occurrences, usedNames),
        ref: {
          artifactKind: 'functionReference',
          schemaVersion: SCHEMA_VERSION,
          appId,
          id: fn.id,
          name: fn.name,
          kind: fn.kind,
          // @ref LLP 0253#s53-reference-profile-fact-and-brand — the app
          // profile and kind-derived delivery facts are hydrated, while only
          // non-default retention spends bytes in the portable reference.
          ...serializedReferenceRetention(fn),
          authRequirement: fn.authRequirement ?? 'optional-user',
          implementationHash: fn.implementationHash,
          argsContractHash: fn.argsContractHash,
          resultContractHash: fn.resultContractHash,
          expectedGeneration,
          authoredSourceHash,
        },
        args: query.args ?? {},
        ...(mixed ? {
          nodePlan: routeEntry.mixedProfile.normalizedCompositePlan.nodes[position].nodePlan,
          nodePlanHash: routeEntry.mixedProfile.normalizedCompositePlan.nodes[position].nodePlanHash,
          // @ref LLP 0157#d2--plan-identity — mixed consumers classify the
          // child only from this explicit, hash-bound owner fact. `ref.kind`
          // and the normalized storage plan are validation cross-checks,
          // never substitute liveness oracles.
          liveness: routeEntry.mixedProfile
            .normalizedCompositePlan.nodes[position].nodePlan.capability.live,
        } : {}),
      };
    });
    groups[routeEntry.route] = {
      artifactKind: 'queryGroupReference',
      formatVersion: mixed ? 2 : 1,
      schemaVersion: SCHEMA_VERSION,
      appId,
      id: mixed
        ? `${appId}:query-group-v2:${routeEntry.route}`
        : `${appId}:query-group:${routeEntry.route}`,
      route: routeEntry.route,
      definitionHash: mixed
        ? mixedQueryGroupDefinitionHash(routeEntry)
        : queryGroupDefinitionHash(routeEntry),
      queries,
      ...(mixed ? {
        profile: 'mixed-route.v2',
        planHash: routeEntry.mixedProfile.planHash,
      } : {}),
      ...(routeEntry.persist === false ? { persist: false } : {}),
    };
  }
  return groups;
}

// @ref LLP 0044#generated-upload-intents — the emitted reference is the exact
//   Rust-owned `assetUploadReference` DTO. `policyGeneration` is 0 at
//   generation: the deployment mints real generations at activation, and the
//   client→server carrier is the pair (`intentPolicyHash`,
//   `implementationHash`), never the generation.
function renderAssetUploadReferences(appId, assetUploadIntents, functionsModule) {
  return assetUploadIntents.map((intent) => ({
    artifactKind: 'assetUploadReference',
    schemaVersion: SCHEMA_VERSION,
    appId,
    id: intent.id,
    name: intent.name,
    implementationHash: intent.implementationHash,
    argsContractHash: intent.argsContractHash,
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      ...jsonSchemaObjectProperties(functionsModule[intent.name]?.args ?? {}),
    },
    intentPolicyHash: intent.intentPolicyHash,
    policyGeneration: 0,
    requiredCapabilities: [],
  }));
}

function microProfileDiagnostic(err, code, message, details = {}) {
  err(code, 'micro-profile', message, details);
}

function canonicalStringArray(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function microContractIsConcrete(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'unknown') return false;
  if (value.kind === 'schemaRef') return false;
  if (value.kind === 'array') return microContractIsConcrete(value.element);
  if (value.kind === 'tuple') {
    return Array.isArray(value.elements)
      && value.elements.length > 0
      && value.elements.every(microContractIsConcrete);
  }
  if (value.kind === 'union') {
    return Array.isArray(value.variants)
      && value.variants.length > 0
      && value.variants.every(microContractIsConcrete);
  }
  if (value.kind === 'object') {
    return Array.isArray(value.fields)
      && value.fields.every((field) => microContractIsConcrete(field.value));
  }
  return true;
}

/** Stable fail-closed capability diagnostics used by generation and its 7a negative fixture. */
export function microProfileCapabilityProblems(profile, capabilityManifest) {
  const problems = [];
  const maturity = capabilityManifest?.capabilityMaturity ?? {};
  if (maturity.args_contract_v1 !== 'experimental' && maturity.args_contract_v1 !== 'stable') {
    problems.push({
      code: 'CODEGEN_MICRO_ARGS_CONTRACT_CAPABILITY_REQUIRED',
      message: 'the selected target does not advertise args_contract_v1',
    });
  }
  if (maturity.result_contract_v1 !== 'experimental' && maturity.result_contract_v1 !== 'stable') {
    problems.push({
      code: 'CODEGEN_MICRO_RESULT_CONTRACT_CAPABILITY_REQUIRED',
      message: 'the selected target does not advertise result_contract_v1',
    });
  }
  if (profile?.selectedKinds?.includes('LiveQuery') && capabilityManifest?.liveSubscriptions !== true) {
    problems.push({
      code: 'CODEGEN_MICRO_LIVE_CAPABILITY_REQUIRED',
      message: 'the selected target does not advertise live subscriptions',
    });
  }
  return problems;
}

/** Digest verifier for publication/metrology gates; runtime never imports the profile. */
export function verifyMicroProfileArtifacts(profile, runtimeEntry, declaration) {
  const problems = [];
  if (profile?.runtimeEntryDigest !== `sha256:${sha256(runtimeEntry)}`) {
    problems.push({
      code: 'CODEGEN_MICRO_RUNTIME_DIGEST_DRIFT',
      message: 'generated Micro runtime digest differs from the profile artifact',
    });
  }
  if (profile?.declarationDigest !== `sha256:${sha256(declaration)}`) {
    problems.push({
      code: 'CODEGEN_MICRO_DECLARATION_DIGEST_DRIFT',
      message: 'generated Micro declaration digest differs from the profile artifact',
    });
  }
  return problems;
}

function buildMicroArtifacts({
  backendRoot,
  targetProfile,
  capabilityManifest,
  functionManifest,
  functionsModule,
  schemaDef,
  expectedGeneration,
  authoredSourceHash,
  err,
}) {
  const path = join(backendRoot, MICRO_PROFILE_INPUT_FILE);
  if (!existsSync(path)) return null;
  let source;
  let input;
  try {
    source = resolveFileReadCapability(path, {
      allowedRoots: [backendRoot],
      allowSymlink: false,
      codePrefix: 'MICRO_PROFILE_INPUT',
    }).read();
    input = JSON.parse(decodeUtf8Source(source, path, 'MICRO_PROFILE_INPUT'));
  } catch (error) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_PROFILE_INPUT_INVALID',
      `${MICRO_PROFILE_INPUT_FILE} is unavailable or invalid: ${error.message}`,
      { path },
    );
    return null;
  }
  const expectedKeys = [
    'arm',
    'authProfileSet',
    'carriers',
    'custodyOwner',
    'explicitNonclaims',
    'formatVersion',
    'lane',
    'modules',
    'packagingProfile',
    'profileName',
    'selectedOperations',
  ];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join('\0') !== expectedKeys.join('\0')) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_PROFILE_INPUT_INVALID',
      `${MICRO_PROFILE_INPUT_FILE} must be a closed ${expectedKeys.join(', ')} object`,
    );
    return null;
  }
  if (input.formatVersion !== 'snapback.micro-profile-input.v1'
    || input.packagingProfile !== 'micro.v1'
    || typeof input.profileName !== 'string'
    || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(input.profileName)) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_PROFILE_INPUT_INVALID',
      'Micro profile requires format snapback.micro-profile-input.v1, packaging micro.v1, and a stable profileName',
    );
  }
  const selectedOperationsValid = canonicalStringArray(input.selectedOperations);
  const modulesValid = canonicalStringArray(input.modules);
  const nonclaimsValid = canonicalStringArray(input.explicitNonclaims);
  if (!selectedOperationsValid) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_SELECTED_OPERATIONS_INVALID',
      'selectedOperations must be a duplicate-free array of operation names',
    );
  }
  if (!modulesValid) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_MODULE_SET_INVALID',
      'modules must be a duplicate-free array',
    );
  }
  if (!nonclaimsValid) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_NONCLAIMS_INVALID',
      'explicitNonclaims must be a duplicate-free array',
    );
  }
  if (!selectedOperationsValid || !modulesValid || !nonclaimsValid) return null;
  if (input.arm !== 'local-dev'
    || input.lane !== 'poll'
    || !Array.isArray(input.authProfileSet)
    || input.authProfileSet.length !== 0) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_AUTH_LANE_UNSUPPORTED',
      'Phase-B Micro requires arm local-dev, lane poll, and no auth profiles',
      { arm: input.arm, lane: input.lane },
    );
  }
  if (input.custodyOwner !== 'none'
    || !Array.isArray(input.carriers)
    || input.carriers.length !== 0) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_CUSTODY_MODULE_REQUIRED',
      'Phase-B Micro carries no credential custody or carrier claim',
      { custodyOwner: input.custodyOwner },
    );
  }
  const functionsByName = new Map(functionManifest.functions.map((fn) => [fn.name, fn]));
  const selected = [];
  for (const name of input.selectedOperations ?? []) {
    const fn = functionsByName.get(name);
    if (!fn) {
      microProfileDiagnostic(
        err,
        'CODEGEN_MICRO_OPERATION_UNKNOWN',
        `selected Micro operation ${name} is not generated`,
        { operation: name },
      );
      continue;
    }
    if (!['Query', 'Mutation', 'Action', 'LiveQuery'].includes(fn.kind)) {
      microProfileDiagnostic(
        err,
        'CODEGEN_MICRO_OPERATION_KIND_UNSUPPORTED',
        `${name} has unsupported Micro operation kind ${fn.kind}`,
        { operation: name, kind: fn.kind },
      );
      continue;
    }
    if (['createClient', 'microProfileIdentity'].includes(name)) {
      microProfileDiagnostic(
        err,
        'CODEGEN_MICRO_OPERATION_EXPORT_COLLISION',
        `${name} collides with a generated Micro runtime export`,
        { operation: name },
      );
    }
    const argsConcrete = Array.isArray(fn.argsContract?.fields)
      && fn.argsContract.fields.every((field) => microContractIsConcrete(field.value));
    const resultConcrete = fn.resultContract?.kind !== 'unknown'
      && (fn.resultContract?.kind !== 'value' || microContractIsConcrete(fn.resultContract.value))
      && (fn.resultContract?.kind !== 'records' || microContractIsConcrete(fn.resultContract.record));
    if (!argsConcrete || !resultConcrete
      || typeof fn.argsContractHash !== 'string'
      || typeof fn.resultContractHash !== 'string'
      || typeof fn.implementationHash !== 'string') {
      microProfileDiagnostic(
        err,
        'CODEGEN_MICRO_OPERATION_CONTRACT_REQUIRED',
        `${name} requires concrete argument and result contracts`,
        { operation: name },
      );
      continue;
    }
    selected.push(fn);
  }
  const selectedKinds = [...new Set(selected.map((fn) => fn.kind))].sort();
  const requiredModules = [
    ...MICRO_PROFILE_REQUIRED_MODULES,
    ...(selectedKinds.includes('LiveQuery') ? ['live'] : []),
  ].sort();
  const modules = [...(input.modules ?? [])].sort();
  if (modules.join('\0') !== requiredModules.join('\0')) {
    microProfileDiagnostic(
      err,
      selectedKinds.includes('LiveQuery') && !modules.includes('live')
        ? 'CODEGEN_MICRO_LIVE_MODULE_REQUIRED'
        : 'CODEGEN_MICRO_MODULE_SET_INVALID',
      `Micro module set must be exactly ${requiredModules.join(', ')}`,
      { requiredModules, selectedModules: modules },
    );
  }
  const nonclaims = [...(input.explicitNonclaims ?? [])].sort();
  if (nonclaims.join('\0') !== [...MICRO_PROFILE_NONCLAIMS].sort().join('\0')) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_NONCLAIMS_INVALID',
      `Phase-B Micro must state the complete nonclaim set: ${MICRO_PROFILE_NONCLAIMS.join(', ')}`,
    );
  }
  for (const problem of microProfileCapabilityProblems({ selectedKinds }, capabilityManifest)) {
    microProfileDiagnostic(err, problem.code, problem.message, { targetProfile });
  }
  if (selected.length !== (input.selectedOperations ?? []).length) return null;

  const runtimeEntry = renderMicroRuntimeEntry(
    selected,
    expectedGeneration,
    input.profileName,
    modules.includes('live'),
  );
  const declaration = renderMicroDeclaration(selected, functionsModule, schemaDef);
  const syntax = ts.transpileModule(declaration, {
    compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  }).diagnostics ?? [];
  if (syntax.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    microProfileDiagnostic(
      err,
      'CODEGEN_MICRO_DECLARATION_TYPECHECK_FAILED',
      'generated Micro declaration failed strict TypeScript syntax checking',
      { diagnostics: syntax.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')) },
    );
  }
  const profile = {
    formatVersion: 'microProfile.v1',
    profileName: input.profileName,
    packagingProfile: 'micro.v1',
    capabilityClass: null,
    selectedOperations: selected.map((fn) => ({
      id: fn.id,
      name: fn.name,
      kind: fn.kind,
      authRequirement: fn.authRequirement ?? 'optional-user',
      implementationHash: fn.implementationHash,
      argsContractHash: fn.argsContractHash,
      argsContract: fn.argsContract,
      resultContractHash: fn.resultContractHash,
    })),
    expectedGeneration,
    authoredSourceHash,
    modules,
    arm: 'local-dev',
    lane: 'poll',
    authProfileSet: [],
    custodyOwner: 'none',
    carriers: [],
    explicitNonclaims: nonclaims,
    sourceDigest: `sha256:${sha256(source)}`,
    runtimeEntryDigest: `sha256:${sha256(runtimeEntry)}`,
    declarationDigest: `sha256:${sha256(declaration)}`,
  };
  return { runtimeEntry, declaration, profile };
}

function renderMicroRuntimeEntry(functions, expectedGeneration, profileName, includesLive) {
  const descriptors = Object.fromEntries(functions.map((fn) => [fn.name, {
    name: fn.name,
    kind: fn.kind,
  }]));
  const lines = [
    HEADER,
    '// @ref LLP 0147#runtime-entry — generated named wrappers bind one frozen',
    '// operation set and generation to the standalone Micro transport.',
    "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
    ...(includesLive
      ? ["import { withMicroLive } from '@expo/snapback-client/micro/live';"]
      : []),
    '',
    `const expectedGeneration = Object.freeze(${stableJson(expectedGeneration)});`,
    `const descriptors = Object.freeze(${stableJson(descriptors)});`,
    `export const microProfileIdentity = Object.freeze({ profileName: ${JSON.stringify(profileName)}, packagingProfile: 'micro.v1' });`,
    'export function createClient(options) {',
    `  const core = createMicroCoreRuntime({ ...options, expectedGeneration, requireGenerationFacts: false });`,
    ...(includesLive ? ['  return withMicroLive(core);'] : ['  return core;']),
    '}',
  ];
  for (const fn of functions) {
    const local = IDENT.test(fn.name) ? fn.name : generatedOperationLocal(fn.name);
    if (fn.kind === 'LiveQuery') {
      lines.push(
        `export function ${local}(client, args, options) {`,
        `  return client.subscribe(descriptors[${JSON.stringify(fn.name)}], args, options);`,
        '}',
      );
    } else {
      lines.push(
        `export function ${local}(client, args) {`,
        `  return client.invoke(descriptors[${JSON.stringify(fn.name)}], args);`,
        '}',
      );
    }
  }
  lines.push(`export const operations = Object.freeze({ ${functions.map((fn) => `${JSON.stringify(fn.name)}: ${IDENT.test(fn.name) ? fn.name : generatedOperationLocal(fn.name)}`).join(', ')} });`);
  return `${lines.join('\n')}\n`;
}

function renderMicroDeclaration(functions, functionsModule, schemaDef) {
  const selectedTables = new Set();
  for (const fn of functions) {
    if (typeof fn.resultContract?.table === 'string') selectedTables.add(fn.resultContract.table);
  }
  const lines = [
    HEADER,
    "import type { MicroActionOutput, MicroCoreRuntime, MicroMutationOutput, MicroQueryOutput, MicroRuntimeOptions } from '@expo/snapback-client/micro/core';",
    ...(functions.some((fn) => resultContractContainsMedia(fn.resultContract))
      ? ["import type { MediaRef } from '@expo/snapback-client/assets';"]
      : []),
    ...(functions.some((fn) => fn.kind === 'LiveQuery')
      ? ["import type { MicroLiveHandle, MicroRuntime } from '@expo/snapback-client/micro/live';"]
      : ["type MicroRuntime = MicroCoreRuntime;"]),
    "export type Id<Table extends string> = string & { readonly __snapbackIdTable: Table };",
    "export type ProvisionalId<Table extends string> = string & { readonly __snapbackProvisionalIdTable: Table };",
    "export type Principal = string & { readonly __snapbackPrincipal: unique symbol };",
    'export interface MicroDataModel {',
  ];
  for (const tableName of [...selectedTables].sort()) {
    const table = schemaDef.tables?.[tableName];
    const fields = Object.entries(table?.fields ?? {}).map(([fieldName, validator]) => {
      const type = typeForGeneratedValidator(validator).replace(/ \| undefined$/u, '');
      return `${JSON.stringify(fieldName)}: ${validator.optional ? `null | ${type}` : type}`;
    });
    lines.push(`  ${JSON.stringify(tableName)}: { _id: Id<${JSON.stringify(tableName)}>; _version: number; _createdAt: number; _updatedAt: number${fields.length > 0 ? `; ${fields.join('; ')}` : ''} };`);
  }
  lines.push(
    '}',
    'export type MicroClientOptions = Omit<MicroRuntimeOptions, "expectedGeneration" | "requireGenerationFacts">;',
    "export const microProfileIdentity: Readonly<{ profileName: string; packagingProfile: 'micro.v1' }> ;",
    'export function createClient(options: MicroClientOptions): MicroRuntime;',
  );
  for (const fn of functions) {
    const local = IDENT.test(fn.name) ? fn.name : generatedOperationLocal(fn.name);
    const args = typeForGeneratedArgs(functionsModule[fn.name]?.args ?? {});
    const result = resultContractType(fn.resultContract);
    if (fn.kind === 'LiveQuery') {
      lines.push(`export function ${local}(client: MicroRuntime, args: ${args}, options?: { readonly onUpdate?: (rows: ${result}, detail: Readonly<{ kind: string; version: number }>) => void }): Promise<MicroLiveHandle<${result}>>;`);
    } else {
      const output = fn.kind === 'Mutation'
        ? `MicroMutationOutput<${result}>`
        : fn.kind === 'Action'
          ? `MicroActionOutput<${result}>`
          : `MicroQueryOutput<${result}>`;
      lines.push(`export function ${local}(client: MicroRuntime, args: ${args}): Promise<${output}>;`);
    }
  }
  lines.push(`export declare const operations: Readonly<{ ${functions.map((fn) => `readonly ${JSON.stringify(fn.name)}: typeof ${IDENT.test(fn.name) ? fn.name : generatedOperationLocal(fn.name)}`).join('; ')} }>;`);
  return `${lines.join('\n')}\n`;
}

function generatedReferenceSourceSpan(sourceSpans, name, fallbackFile) {
  const span = sourceSpans?.[name];
  return span
    ? { file: span.path, line: span.line, column: span.column }
    : { file: fallbackFile };
}

function serializedReferenceRetention(fn) {
  return fn.retainable === true
    ? { retention: fn.retentionClass ?? 'opaque-authorized-snapshot-v1' }
    : {};
}

function surfaceContract(validator) {
  if (validator?.__commandAssetSource === true) {
    return { kind: 'commandAssetSource' };
  }
  return validatorResultValue(validator, { args: true });
}

function sameSurfaceContract(left, right) {
  return canonicalResultJson(surfaceContract(left)) === canonicalResultJson(surfaceContract(right));
}

function surfaceLiteralMatchesValidator(value, validator) {
  if (value === undefined) return validator?.optional === true;
  if (!validator?.__validator) return false;
  if (validator.resultKind === 'null') return value === null;
  if (validator.resultKind === 'literal') return Object.is(value, validator.literal);
  if (validator.resultKind === 'array' || validator.resultKind === 'vector') {
    return Array.isArray(value)
      && (validator.resultKind !== 'vector' || value.length === validator.dimensions)
      && value.every((entry) => surfaceLiteralMatchesValidator(entry, validator.element ?? { __validator: true, primitive: 'number' }));
  }
  if (validator.resultKind === 'union') {
    return (validator.variants ?? []).some((variant) => surfaceLiteralMatchesValidator(value, variant));
  }
  if (validator.primitive === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = validator.fields ?? {};
    return Object.keys(value).every((name) => fields[name] !== undefined)
      && Object.entries(fields).every(([name, field]) => (
        Object.hasOwn(value, name)
          ? surfaceLiteralMatchesValidator(value[name], field)
          : field.optional === true
      ));
  }
  if (idFieldTypeTable(validator.fieldType) !== null || validator.fieldType === 'Principal') {
    return typeof value === 'string';
  }
  if (validator.primitive === 'string') return typeof value === 'string';
  if (validator.primitive === 'boolean') return typeof value === 'boolean';
  if (validator.primitive === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (validator.primitive === 'unknown') return true;
  return value !== undefined;
}

function installMediaCommandBindings({
  appId,
  commandDefs,
  functionsModule,
  functions,
  assetUploadIntents,
  assetCollections,
  attribution,
  err,
}) {
  const installed = new Map();
  const canonical = (value) => canonicalResultJson(value);
  const authoredFunctions = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'function'));
  const functionByName = new Map(functions.map((fn) => [fn.name, fn]));
  const intentByName = new Map(assetUploadIntents.map((intent) => [intent.name, intent]));
  const collectionByName = new Map(assetCollections.map((collection) => [collection.name, collection]));
  const sourceFor = (command, path) => definitionAttributionDetails(
    attribution,
    [command, ...path.split('.').filter(Boolean)],
  );
  const report = (code, command, path, message, remediation, details = {}) => {
    const source = sourceFor(command, path);
    err(code, 'media-command', `${command}.${path}: ${message}`, {
      command,
      property: path,
      ...source,
      ...details,
      details: { ...(source.details ?? {}), remediation, ...details },
    });
  };
  const validatorAtResultPath = (contract, path) => {
    let value = contract?.document ?? contract?.value ?? contract;
    for (const component of path) {
      if (value?.kind !== 'object') return null;
      const field = (value.fields ?? []).find((candidate) => candidate.name === component);
      if (!field?.required) return null;
      value = field.value;
    }
    return value;
  };
  const planBody = (plan) => {
    const { name: _name, ...body } = plan;
    return body;
  };

  for (const { exportName: command, def } of commandDefs.filter(({ def }) => def.__kind === 'MediaCommand')) {
    let valid = true;
    const refuse = (code, path, message, remediation, details = {}) => {
      valid = false;
      report(code, command, path, message, remediation, details);
    };
    if (!IDENT.test(command) || RESERVED_WORDS.has(command)) {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_INVALID_IDENTIFIER',
        '',
        'the exported binding must be a portable identifier',
        'Rename the command to an ASCII identifier that is not reserved.',
      );
    }
    const mutationMatches = authoredFunctions.filter(([, candidate]) => (
      candidate.__kind === 'Mutation' && canonical(candidate) === canonical(def.mutation)
    ));
    if (mutationMatches.length !== 1) {
      refuse(
        mutationMatches.length === 0
          ? 'SNAPBACK_MEDIA_COMMAND_MUTATION_UNKNOWN'
          : 'SNAPBACK_MEDIA_COMMAND_MAPPING_AMBIGUOUS',
        'mutation',
        'mutation must resolve to exactly one ordinary mutation export',
        'Pass one directly exported defineMutation/defineJsMutation value.',
      );
    }
    const [mutationName, mutationDef] = mutationMatches[0] ?? [];
    const target = functionByName.get(mutationName);
    if (target?.kind !== 'Mutation') {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_MUTATION_UNKNOWN',
        'mutation',
        'target mutation is absent from the generated function manifest',
        'Use an admitted ordinary mutation from this functions module.',
      );
    }
    if (target?.authRequirement !== 'authenticated') {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_MUTATION_INCOMPATIBLE',
        'mutation',
        'media-command targets must require an authenticated principal',
        'Declare the target mutation with auth: "authenticated".',
      );
    }
    const media = def.media ?? {};
    if (!IDENT.test(media.input ?? '')) {
      refuse('SNAPBACK_MEDIA_COMMAND_MEDIA_INVALID', 'media.input', 'input must be a portable identifier', 'Use a portable command input name.');
    }
    const intent = typeof media.intent === 'string' ? intentByName.get(media.intent) : null;
    if (!intent) {
      refuse('SNAPBACK_MEDIA_COMMAND_INTENT_UNKNOWN', 'media.intent', 'intent must name one generated upload intent', 'Use the exported defineAssetUpload name.');
    }
    if (!Number.isSafeInteger(media.minItems) || media.minItems < 0
      || !Number.isSafeInteger(media.maxItems) || media.maxItems < 1
      || media.maxItems > 32 || media.minItems > media.maxItems) {
      refuse('SNAPBACK_MEDIA_COMMAND_MEDIA_INVALID', 'media.maxItems', 'minItems/maxItems must define a bounded 0..32 interval', 'Choose 0 <= minItems <= maxItems <= 32.');
    }
    const kinds = Array.isArray(media.kinds) ? [...media.kinds] : [];
    if (kinds.length === 0 || kinds.length !== new Set(kinds).size
      || kinds.some((kind) => !ASSET_COLLECTION_KINDS.has(kind))) {
      refuse('SNAPBACK_MEDIA_COMMAND_MEDIA_INVALID', 'media.kinds', 'kinds must be a non-empty unique media-kind list', 'Use image, video, audio, or file exactly once each.');
    }
    const mapping = def.mapping ?? {};
    const collection = typeof mapping.collection === 'string'
      ? collectionByName.get(mapping.collection)
      : null;
    if (!collection) {
      refuse('SNAPBACK_MEDIA_COMMAND_COLLECTION_UNKNOWN', 'mapping.collection', 'collection must name one generated assetCollection', 'Use an exported assetCollection binding.');
    } else {
      if (collection.intent !== media.intent
        || collection.maxItems < media.maxItems
        || kinds.some((kind) => !collection.kinds.includes(kind))) {
        refuse(
          'SNAPBACK_MEDIA_COMMAND_COLLECTION_INCOMPATIBLE',
          'mapping.collection',
          'collection intent, item ceiling, or media kinds do not admit this command',
          'Use the same upload intent and a command subset of the collection bounds.',
        );
      }
      if (collection.order !== 'manual') {
        refuse(
          'SNAPBACK_MEDIA_COMMAND_COLLECTION_INCOMPATIBLE',
          'mapping.collection',
          'v1 media commands require a manual-order collection so input order is preserved',
          'Declare the target assetCollection with order: "manual".',
        );
      }
    }
    const operation = mapping.operation;
    if (operation !== 'append' && operation !== 'replace') {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_OPERATION_INVALID',
        'mapping.operation',
        'operation must be the explicit collection operation append or replace',
        'Set mapping.operation to "append" or "replace"; no default is inferred.',
      );
    }
    const passthrough = Array.isArray(mapping.passthrough) ? [...mapping.passthrough] : [];
    if (passthrough.length !== new Set(passthrough).size
      || passthrough.some((name) => !IDENT.test(name))) {
      refuse('SNAPBACK_MEDIA_COMMAND_MAPPING_INVALID', 'mapping.passthrough', 'passthrough must be a unique portable argument-name list', 'List each ordinary mutation argument once.');
    }
    const mutationArgs = mutationDef?.args ?? {};
    const mutationArg = mapping.assetsToMutationArg;
    const assetArray = mutationArgs[mutationArg];
    if (!IDENT.test(mutationArg ?? '')
      || assetArray?.resultKind !== 'array'
      || assetArray.element?.fieldType?.AssetRef?.upload !== media.intent
      || assetArray.optional === true
      || assetArray.resultOptions?.maxItems !== media.maxItems) {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_MAPPING_INCOMPATIBLE',
        'mapping.assetsToMutationArg',
        'mapped mutation argument must be a required v.array(v.assetRef({ upload: intent })) with the same maxItems',
        'Make the target argument a required bounded asset-ref array using this command intent.',
      );
    }
    const ordinaryArgs = Object.keys(mutationArgs).filter((name) => name !== mutationArg);
    if (canonical([...passthrough].sort()) !== canonical([...ordinaryArgs].sort())) {
      refuse('SNAPBACK_MEDIA_COMMAND_MAPPING_INCOMPATIBLE', 'mapping.passthrough', 'passthrough must name every non-media mutation argument exactly once', 'List the target mutation ordinary arguments and no others.');
    }
    for (const name of passthrough) {
      if (mutationArgs[name]?.fieldType === 'Principal') {
        refuse('SNAPBACK_MEDIA_COMMAND_AUTHORITY_INPUT_REFUSED', `mapping.passthrough.${name}`, 'a passthrough argument cannot inject an authority principal', 'Derive authority from the authenticated mutation context.');
      }
    }
    if (Object.hasOwn(mutationArgs, media.input) && media.input !== mutationArg) {
      refuse('SNAPBACK_MEDIA_COMMAND_INPUT_COLLISION', 'media.input', 'media input collides with an ordinary mutation argument', 'Rename the command media input.');
    }
    const parentPath = typeof mapping.parentResultPath === 'string'
      ? mapping.parentResultPath.split('.').filter(Boolean)
      : [];
    const parentValue = validatorAtResultPath(target?.resultContract, parentPath);
    if (parentPath.length === 0 || parentValue?.kind !== 'id'
      || parentValue.table !== collection?.ownerTable) {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_PARENT_RESULT_PATH_INVALID',
        'mapping.parentResultPath',
        'parent result path must resolve through required closed object fields to the collection owner Id',
        'Return the owner row id at a required exact-result path and name that path.',
      );
    }
    const sharing = def.sharing;
    const sharingMatches = collection?.sharing?.ceiling?.filter((candidate) => (
      canonical(planBody(candidate)) === canonical(sharing)
    )) ?? [];
    if (sharingMatches.length !== 1) {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_SHARING_PLAN_INVALID',
        'sharing',
        'sharing must select exactly one concrete plan inside the collection ceiling',
        'Use an assetSharing selector matching one declared collection grant plan.',
      );
    }
    const principalInput = mapping.principals;
    if (sharing?.kind === 'recipients') {
      if (!principalInput || typeof principalInput !== 'object' || Array.isArray(principalInput)
        || !IDENT.test(principalInput.input ?? '')
        || !Number.isSafeInteger(principalInput.minItems) || principalInput.minItems < 1
        || !Number.isSafeInteger(principalInput.maxItems)
        || principalInput.maxItems < principalInput.minItems
        || principalInput.maxItems > 32
        || principalInput.maxItems > sharing.maxRecipients) {
        refuse(
          'SNAPBACK_MEDIA_COMMAND_PRINCIPAL_INPUT_INVALID',
          'mapping.principals',
          'direct-recipient sharing requires one named principal input bounded within the selected plan',
          'Declare mapping.principals with input and 1 <= minItems <= maxItems <= the plan maxRecipients.',
        );
      } else if (principalInput.input === media.input || passthrough.includes(principalInput.input)
        || Object.hasOwn(mutationArgs, principalInput.input)) {
        refuse(
          'SNAPBACK_MEDIA_COMMAND_INPUT_COLLISION',
          'mapping.principals.input',
          'principal input collides with a media, passthrough, or mutation argument',
          'Choose a distinct host-only command input name.',
        );
      }
    } else if (principalInput !== undefined) {
      refuse(
        'SNAPBACK_MEDIA_COMMAND_PRINCIPAL_INPUT_INVALID',
        'mapping.principals',
        'a principal input is admitted only for a selected direct-recipient plan',
        'Remove mapping.principals or select an admitted assetSharing.recipients() plan.',
      );
    }
    if (!valid || !target || !collection || !intent) continue;
    const selectedSharing = { ...structuredClone(sharingMatches[0]) };
    const bindingCore = {
      format: 'snapback.media-command-binding.v1',
      command: { id: `${appId}:${command}`, name: command },
      targetMutation: {
        id: target.id,
        name: target.name,
        implementationHash: target.implementationHash,
        argsContractHash: target.argsContractHash,
        resultContractHash: target.resultContractHash,
      },
      passthroughArgs: passthrough,
      media: {
        input: media.input,
        intent: media.intent,
        intentPolicyHash: intent.intentPolicyHash,
        mutationArg,
        minItems: media.minItems,
        maxItems: media.maxItems,
        kinds,
      },
      parentResultPath: parentPath,
      collection: {
        name: collection.name,
        generation: collection.generation,
        ownerTable: collection.ownerTable,
        ownerField: collection.ownerField,
        childTable: collection.childTable,
      },
      itemIdentityPlan: {
        format: 'snapback:asset-collection-item-id:v1',
        operation,
        order: 'input',
      },
      sharing: selectedSharing,
      ...(principalInput === undefined ? {} : { principalInput: { ...principalInput } }),
      taskProfile: { concurrency: 3 },
    };
    const identity = `sha256:${sha256(`snapback:media-command-binding:v1\n${canonical(bindingCore)}`)}`;
    const binding = { ...bindingCore, identity };
    target.mediaCommandBindings = [...(target.mediaCommandBindings ?? []), binding];
    target.requiredCapabilities = [...new Set([
      ...(target.requiredCapabilities ?? []),
      'assets.media-command.v1',
      'assets.media-collection.v1',
      'assets.media-ref-projection.v1',
    ])].sort();
    // Presence moves this function to a distinct implementation-identity
    // domain; the binding itself includes the pre-binding implementation.
    target.implementationHash = `sha256:${sha256(
      `snapback:function-media-command-implementation:v1\n${canonical({
        implementationHash: target.implementationHash,
        mediaCommandBindings: target.mediaCommandBindings,
      })}`,
    )}`;
    installed.set(command, binding);
  }
  return installed;
}

// @ref LLP 0180#declaration — generated commands retain
// the exact small logical descriptor. The enclosing commands map supplies the
// name; mutation and intent children are existing generated references.
function buildGeneratedCommands({
  commandDefs,
  functionsModule,
  functions,
  generatedReferences,
  err,
}) {
  const commands = dict();
  const canonicalDefinition = (value) => canonicalResultJson(value);
  const functionDefinitions = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'function'));
  const assetDefinitions = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'asset-upload'));
  const report = (code, command, message, details = {}) => err(
    code,
    'command',
    `${command}: ${message}`,
    { command, ...details },
  );

  for (const { exportName: commandName, def } of commandDefs) {
    if (def.__kind === 'MediaCommand') {
      const target = functions.find((fn) => (
        fn.mediaCommandBindings?.some((binding) => binding.command.name === commandName)
      ));
      const binding = target?.mediaCommandBindings?.find(
        (candidate) => candidate.command.name === commandName,
      );
      const mutation = generatedReferences.api.mutations[target?.name];
      const intent = generatedReferences.api.assets[binding?.media?.intent];
      if (binding && mutation && intent) {
        commands[commandName] = {
          kind: 'media-command.v1',
          mutation,
          intent,
          binding,
          passthroughArgs: binding.passthroughArgs,
        };
      }
      continue;
    }
    let valid = true;
    if (!IDENT.test(commandName) || RESERVED_WORDS.has(commandName)) {
      report('SNAPBACK_COMMAND_INVALID_IDENTIFIER', commandName, 'command export name must be a portable identifier');
      continue;
    }
    const authoredMutations = Array.isArray(def.mutation)
      ? def.mutation
      : def.mutation === null
        ? []
        : [def.mutation];
    if (authoredMutations.length !== 1) {
      report(
        'SNAPBACK_COMMAND_MUTATION_CARDINALITY_INVALID',
        commandName,
        'v1 requires exactly one ordinary mutation',
        { mutations: authoredMutations.length },
      );
      continue;
    }
    const [authoredMutation] = authoredMutations;
    const mutationCandidates = functionDefinitions.filter(([, candidate]) => (
      candidate.__kind === 'Mutation'
      && canonicalDefinition(candidate) === canonicalDefinition(authoredMutation)
    ));
    if (mutationCandidates.length !== 1) {
      report(
        mutationCandidates.length === 0
          ? 'SNAPBACK_COMMAND_MUTATION_UNKNOWN'
          : 'SNAPBACK_COMMAND_MAPPING_AMBIGUOUS',
        commandName,
        mutationCandidates.length === 0
          ? 'mutation target is not one generated ordinary mutation'
          : 'mutation target has multiple generated export identities',
      );
      continue;
    }
    const [mutationName, mutationDefinition] = mutationCandidates[0];
    const mutation = generatedReferences.api.mutations[mutationName];
    if (!mutation) {
      report('SNAPBACK_COMMAND_MUTATION_UNKNOWN', commandName, `${mutationName} is not in the generated mutation namespace`);
      continue;
    }
    const assetEntries = Object.entries(def.assets ?? {});
    if (assetEntries.length > 1) {
      report('SNAPBACK_COMMAND_MULTI_ASSET_UNSUPPORTED', commandName, 'v1 admits at most one asset input');
      continue;
    }
    let asset = null;
    let mappedMutationArg = null;
    if (assetEntries.length === 1) {
      const [inputName, mapping] = assetEntries[0];
      const intentCandidates = assetDefinitions.filter(([, candidate]) => (
        canonicalDefinition(candidate) === canonicalDefinition(mapping.intent)
      ));
      if (intentCandidates.length !== 1) {
        report(
          intentCandidates.length === 0
            ? 'SNAPBACK_COMMAND_ASSET_INTENT_UNKNOWN'
            : 'SNAPBACK_COMMAND_MAPPING_AMBIGUOUS',
          commandName,
          'asset intent must resolve to exactly one generated upload intent',
          { input: inputName },
        );
        valid = false;
      } else {
        const [intentName, intentDefinition] = intentCandidates[0];
        if (Object.keys(intentDefinition.args ?? {}).length > 0) {
          report(
            'SNAPBACK_COMMAND_ASSET_INTENT_ARGS_UNSUPPORTED',
            commandName,
            'v1 command assets do not define a second upload-intent argument mapping',
            { input: inputName, intent: intentName },
          );
          valid = false;
        }
        const mutationArg = mutationDefinition.args?.[mapping.mutationArg];
        const upload = mutationArg?.fieldType?.AssetRef?.upload;
        // @ref LLP 0210#d4--the-mapping-is-admitted-where-safe-the-remaining-refusal-teaches —
        // a command may require an asset that its mutation accepts optionally,
        // but an optional child cannot leave a required mutation argument empty.
        if (!mutationArg || upload !== intentName) {
          report(
            'SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE',
            commandName,
            `asset ${inputName} must map to a v.assetRef({ upload: ${JSON.stringify(intentName)} }) mutation argument`,
            { input: inputName, mutationArg: mapping.mutationArg, intent: intentName },
          );
          valid = false;
        } else if (mapping.optional && mutationArg.optional !== true) {
          report(
            'SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE',
            commandName,
            `optional asset ${inputName} cannot map to required mutation argument ${mapping.mutationArg}; make the child required, or make the argument optional`,
            {
              input: inputName,
              mutationArg: mapping.mutationArg,
              intent: intentName,
              fixes: [
                {
                  kind: 'make-command-asset-required',
                  description: `Make the child required by setting assets.${inputName}.optional to false.`,
                },
                {
                  kind: 'make-mutation-argument-optional',
                  description: `Make the argument optional with v.optional(v.assetRef({ upload: ${JSON.stringify(intentName)} })).`,
                },
              ],
            },
          );
          valid = false;
        }
        if (Object.hasOwn(mutationDefinition.args ?? {}, inputName) && inputName !== mapping.mutationArg) {
          report(
            'SNAPBACK_COMMAND_INPUT_COLLISION',
            commandName,
            `asset input ${inputName} collides with an ordinary mutation input`,
            { input: inputName },
          );
          valid = false;
        }
        const intent = generatedReferences.api.assets[intentName];
        if (!intent) {
          report('SNAPBACK_COMMAND_ASSET_INTENT_UNKNOWN', commandName, `${intentName} is not in the generated asset namespace`);
          valid = false;
        } else {
          mappedMutationArg = mapping.mutationArg;
          asset = {
            input: inputName,
            intent,
            mutationArg: mapping.mutationArg,
            optional: mapping.optional,
          };
        }
      }
    }
    const passthroughArgs = Object.keys(mutationDefinition.args ?? {})
      .filter((name) => name !== mappedMutationArg);
    for (const name of passthroughArgs) {
      if (mutationDefinition.args[name]?.fieldType === 'Principal') {
        report(
          'SNAPBACK_COMMAND_AUTHORITY_INPUT_REFUSED',
          commandName,
          `ordinary input ${name} attempts to inject an authority principal`,
          { input: name },
        );
        valid = false;
      }
    }
    if (!valid) continue;
    commands[commandName] = {
      kind: 'asset-bearing-command.v1',
      mutation,
      asset,
      passthroughArgs,
    };
  }
  return commands;
}

// @ref LLP 0179#binding-is-not-authorization — generation performs only
// closed argument/scope substitution. It never binds, derives, or records a
// session principal; runtime authority remains an independent registry axis.
function buildGeneratedSurfaces({
  appId,
  surfaceDefs,
  functionsModule,
  schemaDef,
  generatedReferences,
  generatedCommands,
  functionSourceSpans,
  err,
}) {
  const surfaces = dict();
  const canonicalDefinition = (value) => canonicalResultJson(value);
  const functionDefinitions = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'function'));
  const assetDefinitions = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'asset-upload'));
  const commandDefinitions = Object.entries(functionsModule)
    .filter(([, value]) => isIsolatedDefinition(value, 'command'));
  const ephemeralDefinitions = Object.entries(schemaDef.ephemeral?.collections ?? {})
    .filter(([, value]) => isIsolatedDefinition(value, 'ephemeral-collection'));
  const schemaVersion = Object.values(generatedReferences.api.queries)[0]?.schemaVersion
    ?? Object.values(generatedReferences.api.mutations)[0]?.schemaVersion
    ?? Object.values(generatedReferences.api.ephemeral)[0]?.schemaVersion
    ?? SCHEMA_VERSION;

  const report = (code, surface, member, message, details = {}) => {
    err(code, 'surface', `${surface}${member ? `.${member}` : ''}: ${message}`, {
      surface,
      ...(member ? { member } : {}),
      ...details,
    });
  };

  // @ref LLP 0179#binding-is-not-authorization — numeric declaration
  // ceilings refuse unbounded fan-out before a surface can become authority.
  if (surfaceDefs.length > SURFACE_MAX_PER_APP) {
    err(
      'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
      'surface',
      `app declares ${surfaceDefs.length} surfaces; the maximum is ${SURFACE_MAX_PER_APP}`,
      { surfaces: surfaceDefs.length, maximum: SURFACE_MAX_PER_APP },
    );
  }

  for (const { exportName: surfaceName, def } of surfaceDefs) {
    if (!IDENT.test(surfaceName) || RESERVED_WORDS.has(surfaceName)) {
      report('SNAPBACK_SURFACE_INVALID_IDENTIFIER', surfaceName, null, 'surface export name must be a portable identifier');
      continue;
    }
    const params = dict();
    let valid = true;
    const paramCount = Object.keys(def.params ?? {}).length;
    if (paramCount > SURFACE_MAX_PARAMS) {
      report(
        'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
        surfaceName,
        null,
        `${paramCount} params exceed the maximum ${SURFACE_MAX_PARAMS}`,
        { params: paramCount, maximum: SURFACE_MAX_PARAMS },
      );
      valid = false;
    }
    const memberCount = ['reads', 'mutations', 'commands', 'assets', 'presence']
      .reduce((count, namespace) => count + Object.keys(def[namespace] ?? {}).length, 0);
    if (memberCount > SURFACE_MAX_MEMBERS) {
      report(
        'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
        surfaceName,
        null,
        `${memberCount} members exceed the maximum ${SURFACE_MAX_MEMBERS}`,
        { members: memberCount, maximum: SURFACE_MAX_MEMBERS },
      );
      valid = false;
    }
    for (const [name, validator] of Object.entries(def.params ?? {})) {
      if (!IDENT.test(name) || RESERVED_WORDS.has(name)) {
        report('SNAPBACK_SURFACE_INVALID_IDENTIFIER', surfaceName, null, `invalid parameter ${name}`, { parameter: name });
        valid = false;
        continue;
      }
      const validatorValid = validateAuthoringValidator(validator, `${surfaceName} parameter ${name}`, (message) => {
        report('SNAPBACK_SURFACE_PARAMETER_TYPE_MISMATCH', surfaceName, null, message, { parameter: name });
      }, new Set(), 'argument');
      if (!validatorValid) valid = false;
      params[name] = surfaceContract(validator);
    }

    const compileLeaf = (
      authored,
      validator,
      namespace,
      memberPath,
      inputs,
      usedInputs,
      allowScopeRecord = true,
    ) => {
      if (validator?.fieldType === 'Principal') {
        report(
          'SNAPBACK_SURFACE_AUTH_BINDING_REFUSED',
          surfaceName,
          memberPath,
          'surface application data cannot bind an authority principal',
        );
        valid = false;
        return null;
      }
      if (authored?.__surfaceValue === true && authored.kind === 'param') {
        const parameter = def.params?.[authored.name];
        if (!parameter) {
          report('SNAPBACK_SURFACE_PARAMETER_UNKNOWN', surfaceName, memberPath, `binding names unknown parameter ${authored.name}`, { parameter: authored.name });
          valid = false;
          return null;
        }
        if (!sameSurfaceContract(parameter, validator)) {
          report('SNAPBACK_SURFACE_PARAMETER_TYPE_MISMATCH', surfaceName, memberPath, `parameter ${authored.name} does not match its target contract`, { parameter: authored.name });
          valid = false;
          return null;
        }
        return { kind: 'param', name: authored.name };
      }
      if (authored?.__surfaceValue === true && authored.kind === 'input') {
        if (namespace !== 'mutations' && namespace !== 'commands' && namespace !== 'assets') {
          report('SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED', surfaceName, memberPath, 'input(...) is admitted only for mutation, command, and asset calls');
          valid = false;
          return null;
        }
        if (usedInputs.has(authored.name)) {
          report('SNAPBACK_SURFACE_BINDING_AMBIGUOUS', surfaceName, memberPath, `input ${authored.name} is bound more than once`, { input: authored.name });
          valid = false;
          return null;
        }
        usedInputs.add(authored.name);
        inputs[authored.name] = {
          contract: surfaceContract(validator),
          optional: validator.optional === true,
        };
        return { kind: 'input', name: authored.name };
      }
      if (authored && typeof authored === 'object' && !Array.isArray(authored)) {
        if (!allowScopeRecord || validator?.primitive !== 'object') {
          report(
            'SNAPBACK_SURFACE_BINDING_UNPORTABLE',
            surfaceName,
            memberPath,
            'bounded scope records are admitted only at one object-keyed target level',
          );
          valid = false;
          return null;
        }
        const fields = validator.fields ?? {};
        const compiledFields = dict();
        const authoredFields = Object.keys(authored);
        if (authoredFields.length > SURFACE_MAX_SCOPE_RECORD_FIELDS) {
          report(
            'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
            surfaceName,
            memberPath,
            `${authoredFields.length} scope record fields exceed the maximum ${SURFACE_MAX_SCOPE_RECORD_FIELDS}`,
            { fields: authoredFields.length, maximum: SURFACE_MAX_SCOPE_RECORD_FIELDS },
          );
          valid = false;
        }
        for (const field of authoredFields) {
          if (!Object.hasOwn(fields, field)) {
            report('SNAPBACK_SURFACE_INPUT_UNKNOWN', surfaceName, memberPath, `scope names unknown field ${field}`, { input: field });
            valid = false;
          }
        }
        for (const [field, fieldValidator] of Object.entries(fields)) {
          if (!Object.hasOwn(authored, field)) {
            if (fieldValidator.optional !== true) {
              report('SNAPBACK_SURFACE_REQUIRED_INPUT_UNBOUND', surfaceName, memberPath, `required scope field ${field} is not bound`, { input: field });
              valid = false;
            }
            continue;
          }
          const leaf = compileLeaf(
            authored[field],
            fieldValidator,
            namespace,
            memberPath,
            inputs,
            usedInputs,
            false,
          );
          if (leaf) compiledFields[field] = leaf;
        }
        return { kind: 'scope', fields: compiledFields };
      }
      try {
        canonicalResultJson(authored);
      } catch {
        report('SNAPBACK_SURFACE_BINDING_UNPORTABLE', surfaceName, memberPath, 'literal binding is not portable JSON');
        valid = false;
        return null;
      }
      if (!surfaceLiteralMatchesValidator(authored, validator)) {
        report('SNAPBACK_SURFACE_PARAMETER_TYPE_MISMATCH', surfaceName, memberPath, 'literal binding does not match its target contract');
        valid = false;
        return null;
      }
      return { kind: 'literal', value: authored };
    };

    const compileMembers = (namespace) => {
      const output = dict();
      for (const [memberName, binding] of Object.entries(def[namespace] ?? {})) {
        const memberPath = `${namespace}.${memberName}`;
        if (!IDENT.test(memberName) || RESERVED_WORDS.has(memberName)) {
          report('SNAPBACK_SURFACE_INVALID_IDENTIFIER', surfaceName, memberPath, 'member name must be a portable identifier');
          valid = false;
          continue;
        }
        const expectedDefinitionKind = namespace === 'presence'
          ? 'ephemeral-collection'
          : namespace === 'assets'
            ? 'asset-upload'
            : namespace === 'commands'
              ? 'command'
            : 'function';
        if (binding?.__surfaceBinding !== true
          || binding.reference?.__snapbackDefinitionKind !== expectedDefinitionKind) {
          report('SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED', surfaceName, memberPath, `unsupported ${namespace} member class`);
          valid = false;
          continue;
        }
        const candidates = (namespace === 'presence'
          ? ephemeralDefinitions
          : namespace === 'assets'
            ? assetDefinitions
            : namespace === 'commands'
              ? commandDefinitions
            : functionDefinitions)
          .filter(([, candidate]) => canonicalDefinition(candidate) === canonicalDefinition(binding.reference));
        if (candidates.length !== 1) {
          report(
            candidates.length === 0 ? 'SNAPBACK_SURFACE_REFERENCE_UNKNOWN' : 'SNAPBACK_SURFACE_BINDING_AMBIGUOUS',
            surfaceName,
            memberPath,
            candidates.length === 0 ? 'binding target is not a generated app member' : 'binding target has multiple generated export identities',
          );
          valid = false;
          continue;
        }
        const [targetName, targetDefinition] = candidates[0];
        let reference;
        let targetArgs;
        if (namespace === 'reads') {
          reference = generatedReferences.api.queries[targetName];
          targetArgs = targetDefinition.args ?? {};
        } else if (namespace === 'mutations') {
          reference = generatedReferences.api.mutations[targetName];
          targetArgs = targetDefinition.args ?? {};
        } else if (namespace === 'commands') {
          reference = generatedCommands[targetName];
          const commandAsset = Object.entries(targetDefinition.assets ?? {})[0] ?? null;
          const mappedMutationArg = commandAsset?.[1]?.mutationArg ?? null;
          targetArgs = Object.fromEntries(Object.entries(targetDefinition.mutation?.args ?? {})
            .filter(([name]) => name !== mappedMutationArg));
          if (commandAsset) {
            targetArgs[commandAsset[0]] = {
              __validator: true,
              __commandAssetSource: true,
              fieldType: 'Json',
              primitive: 'unknown',
              optional: commandAsset[1].optional,
            };
          }
        } else if (namespace === 'presence') {
          reference = generatedReferences.api.ephemeral[targetName];
          targetArgs = {
            scope: {
              __validator: true,
              fieldType: 'Json',
              primitive: 'object',
              optional: false,
              fields: targetDefinition.scope ?? {},
            },
          };
        } else {
          reference = generatedReferences.api.assets[targetName];
          targetArgs = targetDefinition.args ?? {};
        }
        if (!reference) {
          report('SNAPBACK_SURFACE_MEMBER_CLASS_UNSUPPORTED', surfaceName, memberPath, `target ${targetName} is in the wrong generated namespace`, { target: targetName });
          valid = false;
          continue;
        }
        const authoredBindings = binding.bindings ?? {};
        for (const target of Object.keys(authoredBindings)) {
          if (!Object.hasOwn(targetArgs, target)) {
            report('SNAPBACK_SURFACE_INPUT_UNKNOWN', surfaceName, memberPath, `binding names unknown target input ${target}`, { input: target });
            valid = false;
          }
        }
        const compiledBindings = dict();
        const inputs = dict();
        const usedInputs = new Set();
        let bindingCount = 0;
        for (const [target, validator] of Object.entries(targetArgs)) {
          if (!Object.hasOwn(authoredBindings, target)) {
            if (validator.optional !== true) {
              report('SNAPBACK_SURFACE_REQUIRED_INPUT_UNBOUND', surfaceName, memberPath, `required target input ${target} is not bound`, { input: target });
              valid = false;
            }
            continue;
          }
          const authored = authoredBindings[target];
          bindingCount += (
            authored
            && typeof authored === 'object'
            && !Array.isArray(authored)
            && authored.__surfaceValue !== true
            && validator?.primitive === 'object'
          ) ? Object.keys(authored).length : 1;
          const leaf = compileLeaf(authored, validator, namespace, memberPath, inputs, usedInputs);
          if (leaf) compiledBindings[target] = leaf;
        }
        if (bindingCount > SURFACE_MAX_MEMBER_BINDINGS) {
          report(
            'SNAPBACK_SURFACE_BUDGET_EXCEEDED',
            surfaceName,
            memberPath,
            `${bindingCount} bindings exceed the maximum ${SURFACE_MAX_MEMBER_BINDINGS}`,
            { bindings: bindingCount, maximum: SURFACE_MAX_MEMBER_BINDINGS },
          );
          valid = false;
        }
        output[memberName] = {
          artifactKind: 'surfaceMemberBinding',
          reference,
          bindings: compiledBindings,
          inputs,
        };
      }
      return output;
    };

    const reads = compileMembers('reads');
    const mutations = compileMembers('mutations');
    const commands = compileMembers('commands');
    const assets = compileMembers('assets');
    const presence = compileMembers('presence');
    if (!valid) continue;
    surfaces[surfaceName] = {
      artifactKind: 'surfaceDescriptor',
      schemaVersion,
      appId,
      id: `${appId}:surface:${surfaceName}`,
      name: surfaceName,
      sourceSpan: generatedReferenceSourceSpan(functionSourceSpans, surfaceName, 'functions.mjs'),
      params,
      reads,
      mutations,
      commands,
      assets,
      presence,
    };
  }
  return surfaces;
}

function lifecycleOptionalPaths(contract, prefix = 'args') {
  const paths = [];
  const visit = (node, path) => {
    const object = Array.isArray(node?.fields)
      ? { kind: 'object', fields: node.fields }
      : node;
    if (object?.kind === 'union') {
      for (const variant of object.variants ?? []) visit(variant, path);
      return;
    }
    if (object?.kind === 'array') {
      visit(object.element, `${path}[]`);
      return;
    }
    if (object?.kind === 'tuple') {
      for (const [index, element] of (object.elements ?? []).entries()) {
        visit(element, `${path}[${index}]`);
      }
      return;
    }
    if (object?.kind === 'object') {
      for (const field of object.fields ?? []) {
        const childPath = `${path}.${field.name}`;
        if (field.required !== true) paths.push(childPath);
        if (field.value?.kind !== 'json') visit(field.value, childPath);
      }
    }
  };
  visit(contract, prefix);
  return [...new Set(paths)].sort();
}

// @ref LLP 0247#d5-generated-lifecycle-metadata-owns-normalization-and-failure-tables
// — these rows extend LLP 0238's lifecycle origin rather than creating a
// competing lifecycle artifact.
function buildOrdinaryClientLifecycleRows({
  functions,
  ephemeralCollections,
}) {
  const verbForKind = (kind) => ({
    Query: 'query',
    LiveQuery: 'liveQuery',
    Mutation: 'mutate',
    Action: 'run',
  })[kind];
  return {
    argumentNormalization: {
      version: ARGUMENT_NORMALIZATION_VERSION,
      operations: functions.map((fn) => ({
        functionId: fn.id,
        name: fn.name,
        kind: fn.kind,
        verb: verbForKind(fn.kind),
        optionalPropertyPaths: lifecycleOptionalPaths(fn.argsContract),
      })),
    },
    authorityAdmission: {
      operations: functions.map((fn) => ({
        functionId: fn.id,
        name: fn.name,
        kind: fn.kind,
        verb: verbForKind(fn.kind),
        authRequirement: fn.authRequirement ?? 'optional-user',
        outcome: (fn.authRequirement ?? 'optional-user') === 'authenticated'
          ? 'local-refusal-until-authenticated'
          : 'dispatch-under-captured-authority',
      })),
    },
    presenceLifecycle: {
      stopAction: 'fenced-withdrawal',
      disposeAction: 'fenced-withdrawal',
      neverPublishedAction: 'none',
      authorityLossBarrierOwner: 'server-connection-cleanup',
      collections: ephemeralCollections.map((collection) => ({
        collection: collection.name,
        withdrawalVisibilityDeadlineMs: collection.withdrawalVisibilityDeadlineMs,
      })),
    },
    primaryFailureCarrier: {
      publicErrorType: 'SnapbackDiagnosticError',
      verbs: [
        { verb: 'query', operationKind: 'Query', carrier: 'throw' },
        { verb: 'run', operationKind: 'Action', carrier: 'throw' },
        { verb: 'mutate', operationKind: 'Mutation', carrier: 'throw-immediate' },
        { verb: 'action', operationKind: 'Action', carrier: 'raw-envelope-deprecated' },
        { verb: 'queued-mutate', operationKind: 'Mutation', carrier: 'resolved-queued-union' },
      ],
    },
    anchors: {
      guide: [
        'guide/clients/headless.md',
        'guide/clients/react.md',
        'guide/realtime/ephemeral-state.md',
      ],
      diagnostics: [
        'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
        'SNAPBACK_ARGUMENT_VALIDATION_FAILED',
        'SNAPBACK_EPHEMERAL_WITHDRAWAL_FENCE_INVALID',
      ],
    },
  };
}

function buildGeneratedReferences(
  appId,
  functions,
  functionsModule,
  schemaManifest,
  ephemeralCollections,
  routesManifest,
  assetUploadIntents = [],
  expectedGeneration,
  authoredSourceHash,
  functionSourceSpans = {},
) {
  const queries = dict();
  const mutations = dict();
  const actions = dict();
  const assets = dict();
  // Derived default intents also project as api.defaults.<table>.<field>
  // so the zero-ceremony flow reads naturally (LLP 0044 §Ceremony floor).
  const defaultAssetNames = dict();
  for (const reference of renderAssetUploadReferences(appId, assetUploadIntents, functionsModule)) {
    assets[reference.name] = reference;
    if (reference.name.startsWith('_assets.default.')) {
      const [tableName, fieldName] = reference.name.slice('_assets.default.'.length).split('.');
      if (tableName && fieldName) {
        (defaultAssetNames[tableName] ??= dict())[fieldName] = reference.name;
      }
    }
  }
  for (const fn of functions) {
    const composition = functionCompositionIdentityV1(fn);
    const mutationIr = generatedMutationIrV1(
      fn,
      schemaManifest,
      expectedGeneration,
      authoredSourceHash,
    );
    const searchPlan = fn.runtime?.HostPlan?.SearchQuery;
    // @ref LLP 0131#amendment-2026-08-09-typed-search-selector-witness-for-resource-scoped-references
    // — argsContractHash continues to identify the complete operation contract,
    // while the typed-search discriminator identifies the unchanged
    // SearchRequestV1 portion after removing its generated resource sibling.
    const searchRequestContractHash = searchPlan && fn.kind === 'Query'
      ? argsContractHash({
          fields: fn.argsContract.fields.filter(
            ({ name }) => name !== searchPlan.resourceArg,
          ),
        })
      : null;
    const reference = {
      artifactKind: 'functionReference',
      schemaVersion: SCHEMA_VERSION,
      appId,
      id: fn.id,
      name: fn.name,
      kind: fn.kind,
      // @ref LLP 0253#s53-reference-profile-fact-and-brand — generated
      // references serialize only non-default retention. Binding hydration
      // stamps the app-level profile, derives query delivery from the nominal
      // kind, and supplies the default retention fact.
      ...serializedReferenceRetention(fn),
      authRequirement: fn.authRequirement ?? 'optional-user',
      implementationHash: fn.implementationHash,
      argsContractHash: fn.argsContractHash,
      argsContract: fn.argsContract,
      resultContractHash: fn.resultContractHash,
      ...(searchRequestContractHash === null ? {} : {
        searchRequestContractHash,
        searchResourceArg: searchPlan.resourceArg ?? null,
      }),
      expectedGeneration,
      authoredSourceHash,
      sourceSpan: generatedReferenceSourceSpan(functionSourceSpans, fn.name, 'functions.mjs'),
      resultContract: fn.resultContract,
      ...(mutationIr ? { mutationIr } : {}),
      ...(composition ? {
        composition: {
          ...composition,
          // The result-contract descriptor is verification input for the L2
          // bridge. Its hash already rides the function reference; carrying
          // the descriptor here avoids reconstructing authority from rows.
          resultContract: fn.resultContract,
        },
      } : {}),
      // @ref LLP 0065#3-common-pattern-contracts — trusted defaults are
      // absent and additional properties are closed on the generated client
      // boundary. Reuse the operation-schema projection, never a second model.
      argumentSchema: {
        type: 'object',
        additionalProperties: false,
        ...jsonSchemaObjectProperties(functionsModule[fn.name]?.args ?? {}),
      },
    };
    if (fn.kind === 'Query' || fn.kind === 'LiveQuery') queries[fn.name] = reference;
    else if (fn.kind === 'Mutation') mutations[fn.name] = reference;
    else actions[fn.name] = reference;
  }
  const ephemeralRefs = dict();
  for (const collection of ephemeralCollections) {
    ephemeralRefs[collection.name] = {
      artifactKind: 'ephemeralCollectionReference',
      schemaVersion: SCHEMA_VERSION,
      appId,
      id: `${appId}:ephemeral:${collection.name}`,
      name: collection.name,
      sourceSpan: { file: 'schema.mjs' },
      keyMode: collection.keyMode,
      scopeFields: collection.scopeFields,
      scopeContract: collection.scopeContract,
      valueContract: collection.valueContract,
      routingFields: collection.routingFields,
      defaultTtlMs: collection.defaultTtlMs,
      maxTtlMs: collection.maxTtlMs,
      withdrawalVisibilityDeadlineMs: collection.withdrawalVisibilityDeadlineMs,
      maxValueBytes: collection.maxValueBytes,
      publishRate: {
        sustainedHz: collection.sustainedHz,
        burst: collection.burst,
      },
      deliveryMode: 'latest',
    };
  }
  const groupRefs = renderQueryGroupReferences(
    appId,
    functions,
    routesManifest,
    expectedGeneration,
    authoredSourceHash,
  );
  return {
    api: {
      queries,
      mutations,
      assets,
      ephemeral: ephemeralRefs,
      queryGroups: groupRefs,
    },
    actions,
    defaultAssetNames,
  };
}

function standaloneDescriptorFunctions(functions) {
  return functions.filter(({ kind, mediaCommandBindings }) => (
    (kind === 'Query' || kind === 'LiveQuery' || kind === 'Mutation')
    && !(Array.isArray(mediaCommandBindings) && mediaCommandBindings.length > 0)
  ));
}

// @ref LLP 0253#s51-the-api-namespace — Familiar actions remain ordinary
// generated api members even though AppDescriptorV1 partitions actions out.
function standaloneApiFunctions(functions) {
  return functions.filter(({ mediaCommandBindings }) => (
    !(Array.isArray(mediaCommandBindings) && mediaCommandBindings.length > 0)
  ));
}

function generatedOperationLocal(name) {
  return `__snapback${pascal(name)}`;
}

function standaloneIdentifierFunctions(functions) {
  return standaloneDescriptorFunctions(functions).filter(({ name }) => IDENT.test(name));
}

function contentAddressedArtifactPath(path, identity) {
  const digest = identity.replace(/^sha256:/, '');
  const extensionIndex = path.lastIndexOf('.');
  if (extensionIndex <= 0 || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError('content-addressed generated artifact needs a filename extension and SHA-256 identity');
  }
  return `${path.slice(0, extensionIndex)}.${digest}${path.slice(extensionIndex)}`;
}

function contentAddressedModuleSpecifier(path, identity) {
  // @ref LLP 0179#appdescriptor-v1 — the portable descriptor identity also
  // keys its generated hydration graph, so regenerating in a live process
  // cannot retain a prior descriptor through the ESM dependency cache. Use a
  // real content-addressed filename, not a URL query: Metro resolves the
  // latter as literal filesystem text and refuses the otherwise-valid graph.
  return contentAddressedArtifactPath(path, identity);
}

function renderAppBindingModule(
  functions,
  descriptorIdentity,
  trustedCompositionActivation = null,
  hostedDevelopmentAdmissions = [],
) {
  const standalone = standaloneIdentifierFunctions(functions);
  const aliases = standalone.map(({ name, kind }) => {
    const namespace = kind === 'Mutation' ? 'mutations' : 'queries';
    return `export const ${name} = app.api.${namespace}[${JSON.stringify(name)}];`;
  });
  const descriptorSpecifier = contentAddressedModuleSpecifier('./app.descriptor.json', descriptorIdentity);
  // @ref LLP 0181#hosted-development-binding — the hydrated generated app is
  // the trust root: its frozen, non-enumerable record owns both the exact
  // hosted target set and the target-bound receipt predicate.
  return `${HEADER}\n` +
    `import descriptorDocument from ${JSON.stringify(descriptorSpecifier)} with { type: 'json' };\n` +
    `const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };\n` +
    `const hostedDevelopmentAdmissions = deepFreeze(${stableJson(hostedDevelopmentAdmissions)});\n` +
    `const targetTuple = (target) => ['app', 'functions', 'origin', 'routing', 'schema'].map((key) => target?.[key]).join('\\u0000');\n` +
    `const generatedHostedTargets = deepFreeze(hostedDevelopmentAdmissions.map(({ target }) => structuredClone(target)));\n` +
    `const verifyHostedTargetAdmission = Object.freeze((receipt, candidate) => hostedDevelopmentAdmissions.some((entry) => entry.hostedTargetReceipt === receipt && targetTuple(entry.target) === targetTuple(candidate?.target)));\n` +
    `const generatedHostedDevelopmentAdmission = Object.freeze({ format: 'snapback.generated-hosted-development-admission.v1', generatedHostedTargets, verifyHostedTargetAdmission });\n` +
    `/** @type {import('./api.d.ts').GeneratedArtifacts} */\n` +
    `export const artifacts = deepFreeze(${stableJson({ trustedCompositionActivation })});\n` +
    `const hydratedDescriptor = structuredClone(descriptorDocument);\n` +
    `Object.defineProperty(hydratedDescriptor, Symbol.for('@expo/snapback-client/generated-hosted-development-admission.v1'), { value: generatedHostedDevelopmentAdmission, enumerable: false });\n` +
    `const hydrateFunctionReference = (reference) => { reference.authoringProfile = hydratedDescriptor.authoringProfile; reference.retention ??= 'none'; if (reference.kind === 'LiveQuery') reference.delivery = 'live'; else if (reference.kind === 'Query') reference.delivery = 'read'; Object.defineProperty(reference, 'artifacts', { value: artifacts, enumerable: false }); };\n` +
    `for (const namespace of [hydratedDescriptor.api.queries, hydratedDescriptor.api.mutations]) { for (const reference of Object.values(namespace)) hydrateFunctionReference(reference); }\n` +
    `for (const group of Object.values(hydratedDescriptor.api.queryGroups)) { for (const query of group.queries) hydrateFunctionReference(query.ref); }\n` +
    `const commandReferences = new Map(Object.values(hydratedDescriptor.commands).map((command) => [JSON.stringify(command), command]));\n` +
    `for (const command of Object.values(hydratedDescriptor.commands)) { if (command.kind === 'media-command.v1') { hydrateFunctionReference(command.mutation); command.intent = hydratedDescriptor.api.assets[command.intent.name]; } else command.mutation = hydratedDescriptor.api.mutations[command.mutation.name]; if (command.asset) command.asset.intent = hydratedDescriptor.api.assets[command.asset.intent.name]; }\n` +
    `for (const surface of Object.values(hydratedDescriptor.surfaces)) { for (const member of Object.values(surface.reads)) member.reference = hydratedDescriptor.api.queries[member.reference.name]; for (const member of Object.values(surface.mutations)) member.reference = hydratedDescriptor.api.mutations[member.reference.name]; for (const member of Object.values(surface.commands)) member.reference = commandReferences.get(JSON.stringify(member.reference)); for (const member of Object.values(surface.assets)) member.reference = hydratedDescriptor.api.assets[member.reference.name]; for (const member of Object.values(surface.presence)) member.reference = hydratedDescriptor.api.ephemeral[member.reference.name]; }\n` +
    `/** @type {import('./app.d.ts').GeneratedAppDescriptorV1} */\n` +
    `export const app = deepFreeze(hydratedDescriptor);\n` +
    `${aliases.join('\n')}\n` +
    `export default app;\n`;
}

function renderAppBindingAlias(functions, appBindingIdentity) {
  const standalone = standaloneIdentifierFunctions(functions);
  const reexports = ['app', 'artifacts', ...standalone.map(({ name }) => name)].join(', ');
  const bindingSpecifier = contentAddressedModuleSpecifier('./app.binding.mjs', appBindingIdentity);
  return `${HEADER}\n` +
    `// Stable compatibility alias; the digest-named module is the sole hydrated binding.\n` +
    `export { ${reexports} } from ${JSON.stringify(bindingSpecifier)};\n` +
    `export { default } from ${JSON.stringify(bindingSpecifier)};\n`;
}

function renderAppModule(functions, appBindingIdentity) {
  const standalone = standaloneIdentifierFunctions(functions);
  const reexports = ['app', 'artifacts', ...standalone.map(({ name }) => name)].join(', ');
  const bindingSpecifier = contentAddressedModuleSpecifier('./app.binding.mjs', appBindingIdentity);
  return `${HEADER}\n` +
    `export { ${reexports} } from ${JSON.stringify(bindingSpecifier)};\n` +
    `export { default } from ${JSON.stringify(bindingSpecifier)};\n`;
}

function surfaceContractType(value) {
  if (!value || typeof value !== 'object') return 'unknown';
  if (value.kind === 'null') return 'null';
  if (value.kind === 'string' || value.kind === 'assetRef') return 'string';
  if (value.kind === 'mediaRef.v1') {
    return `{ readonly assetId: string; readonly kind: ${(value.kinds ?? []).map(JSON.stringify).join(' | ')} }`;
  }
  if (value.kind === 'commandAssetSource') return 'CommandAssetSource';
  if (value.kind === 'principal') return 'Principal';
  if (value.kind === 'id') return `Id<${JSON.stringify(value.table)}>`;
  if (value.kind === 'integer' || value.kind === 'finiteReal') return 'number';
  if (value.kind === 'boolean') return 'boolean';
  if (value.kind === 'literal') return JSON.stringify(value.value);
  if (value.kind === 'json') return 'unknown';
  if (value.kind === 'array') return `ReadonlyArray<${surfaceContractType(value.element)}>`;
  if (value.kind === 'tuple') return `readonly [${(value.elements ?? []).map(surfaceContractType).join(', ')}]`;
  if (value.kind === 'vector') return `ReadonlyArray<number> & { readonly length: ${value.dimensions} }`;
  if (value.kind === 'union') return (value.variants ?? []).map(surfaceContractType).join(' | ');
  if (value.kind === 'object') {
    const fields = (value.fields ?? []).map((field) => (
      `${JSON.stringify(field.name)}${field.required === false ? '?' : ''}: ${surfaceContractType(field.value)}`
    ));
    return fields.length === 0 ? 'Record<string, never>' : `{ ${fields.join('; ')} }`;
  }
  return 'unknown';
}

function renderSurfaceTypeMap(members, referenceNamespace, commandMap = {}) {
  const entries = Object.entries(members ?? {}).map(([name, member]) => {
    const inputs = Object.entries(member.inputs ?? {});
    const inputType = inputs.length === 0
      ? 'Record<string, never>'
      : `{ ${inputs.map(([inputName, descriptor]) => `${JSON.stringify(inputName)}${descriptor.optional ? '?' : ''}: ${surfaceContractType(descriptor.contract)}`).join('; ')} }`;
    const referenceName = referenceNamespace === 'GeneratedAppCommands'
      ? Object.entries(commandMap).find(([, command]) => (
        canonicalResultJson(command) === canonicalResultJson(member.reference)
      ))?.[0]
      : member.reference.name;
    return `${JSON.stringify(name)}: SurfaceMemberDescriptor<${referenceNamespace}[${JSON.stringify(referenceName)}], ${inputType}>`;
  });
  return entries.length === 0 ? 'Record<string, never>' : `{ ${entries.join('; ')} }`;
}

function renderAppTypes(
  functions,
  assetUploadIntents = [],
  commands = {},
  surfaces = {},
  clientLifecycleManifest,
  authoringProfile = EXPLICIT_AUTHORING_PROFILE,
  applicationAuthBootstrap = undefined,
) {
  const standalone = standaloneDescriptorFunctions(functions);
  const queryNames = standalone
    .filter(({ kind }) => kind === 'Query' || kind === 'LiveQuery')
    .map(({ name }) => JSON.stringify(name));
  const mutationNames = standalone
    .filter(({ kind }) => kind === 'Mutation')
    .map(({ name }) => JSON.stringify(name));
  const assetNames = assetUploadIntents.map(({ name }) => JSON.stringify(name));
  const union = (names) => names.join(' | ') || 'never';
  const lines = [
    HEADER,
    "import type { GeneratedApi, GeneratedArtifacts, GeneratedCommandTargets, GeneratedEphemeral, GeneratedQueryGroups, Id, Principal } from './api.d.ts';",
    `export type GeneratedAppQueryName = ${union(queryNames)};`,
    `export type GeneratedAppMutationName = ${union(mutationNames)};`,
    `export type GeneratedAppAssetName = ${union(assetNames)};`,
    'export type CapabilityRequirement = string;',
    'export interface CommandBlobSource { readonly size: number; readonly name?: string; readonly type?: string; slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } }',
    'export interface CommandPlatformAssetSource { readonly uri: string; readonly fileName?: string | null; readonly mimeType?: string | null; readonly fileSize?: number | null }',
    'export type CommandAssetSource = CommandBlobSource | CommandPlatformAssetSource;',
    'type ReferenceArgs<Reference> = Reference extends { readonly __args?: infer Args } ? Args : Record<string, unknown>;',
    'type ReferenceResult<Reference> = Reference extends { readonly __result?: infer Result } ? Result : unknown;',
    'type CommandAssetInput<Input extends string | never, Optional extends boolean> = [Input] extends [never] ? unknown : Optional extends true ? { readonly [Field in Input]?: CommandAssetSource } : { readonly [Field in Input]: CommandAssetSource };',
    'type MediaCommandAssetInput<Input extends string, MinItems extends number> = MinItems extends 0 ? { readonly [Field in Input]?: CommandAssetSource | readonly CommandAssetSource[] } : { readonly [Field in Input]: CommandAssetSource | readonly CommandAssetSource[] };',
    'type CommandPrincipalInput<Input extends string | never> = [Input] extends [never] ? unknown : { readonly [Field in Input]: readonly Principal[] };',
    'export interface CommandDescriptor<Mutation = unknown, Input extends string | never = never, MutationArg extends string | never = never, Optional extends boolean = false, Intent = unknown> {',
    "  readonly kind: 'asset-bearing-command.v1';",
    "  readonly __snapbackReferenceKind: 'Command';",
    '  readonly mutation: Mutation;',
    '  readonly asset: [Input] extends [never] ? null : Readonly<{ input: Input; intent: Intent; mutationArg: MutationArg; optional: Optional }>;',
    '  readonly passthroughArgs: readonly string[];',
    '  readonly __args?: Omit<ReferenceArgs<Mutation>, MutationArg> & CommandAssetInput<Input, Optional>;',
    '  readonly __result?: ReferenceResult<Mutation>;',
    '}',
    'export interface MediaCommandDescriptor<Mutation = unknown, Input extends string = string, MutationArg extends string = string, MinItems extends number = number, MaxItems extends number = number, PrincipalInput extends string | never = never, Intent = unknown> {',
    "  readonly kind: 'media-command.v1';",
    "  readonly __snapbackReferenceKind: 'Command';",
    '  readonly mutation: Mutation;',
    '  readonly intent: Intent;',
    '  readonly binding: Readonly<Record<string, unknown>> & Readonly<{ format: \'snapback.media-command-binding.v1\'; identity: `sha256:${string}`; command: Readonly<{ id: string; name: string }>; media: Readonly<{ input: Input; intent: string; mutationArg: MutationArg; minItems: MinItems; maxItems: MaxItems }>; taskProfile: Readonly<{ concurrency: number }>; principalInput?: Readonly<{ input: PrincipalInput; minItems: number; maxItems: number }> }>;',
    '  readonly passthroughArgs: readonly string[];',
    '  readonly __args?: Omit<ReferenceArgs<Mutation>, MutationArg> & MediaCommandAssetInput<Input, MinItems> & CommandPrincipalInput<PrincipalInput>;',
    '  readonly __result?: ReferenceResult<Mutation>;',
    '}',
    'export interface GeneratedAppCommands {',
    ...Object.entries(commands).flatMap(([name, command]) => [
      ...renderReferenceJSDoc(
        { kind: 'Command', name },
        clientLifecycleManifest,
        authoringProfile,
      )
        .split('\n')
        .map((line) => `  ${line}`),
      command.kind === 'media-command.v1'
        ? `  readonly ${JSON.stringify(name)}: MediaCommandDescriptor<GeneratedCommandTargets[${JSON.stringify(command.mutation.name)}], ${JSON.stringify(command.binding.media.input)}, ${JSON.stringify(command.binding.media.mutationArg)}, ${command.binding.media.minItems}, ${command.binding.media.maxItems}, ${command.binding.principalInput ? JSON.stringify(command.binding.principalInput.input) : 'never'}, GeneratedApi[${JSON.stringify(command.intent.name)}]>;`
        : `  readonly ${JSON.stringify(name)}: CommandDescriptor<GeneratedApi[${JSON.stringify(command.mutation.name)}], ${command.asset ? JSON.stringify(command.asset.input) : 'never'}, ${command.asset ? JSON.stringify(command.asset.mutationArg) : 'never'}, ${command.asset?.optional === true}, ${command.asset ? `GeneratedApi[${JSON.stringify(command.asset.intent.name)}]` : 'never'}>;`,
    ]),
    '}',
    '/** Surface member call payloads follow strict omission semantics: an optional input the caller omits is omitted from the composed operation payload (never sent as undefined); passing undefined explicitly is refused by the client value gate before any network work. */',
    'export interface SurfaceMemberDescriptor<Reference = unknown, Input = Record<string, never>> {',
    "  readonly artifactKind: 'surfaceMemberBinding';",
    '  readonly reference: Reference;',
    '  readonly bindings: Readonly<Record<string, unknown>>;',
    '  readonly inputs: Readonly<Record<string, unknown>>;',
    '  readonly __input?: Input;',
    '}',
    'export interface SurfaceDescriptor<Params = Record<string, never>, Reads = Record<string, never>, Mutations = Record<string, never>, Commands = Record<string, never>, Presence = Record<string, never>, Assets = Record<string, never>> {',
    "  readonly artifactKind: 'surfaceDescriptor';",
    '  readonly id: string;',
    '  readonly name: string;',
    '  readonly params: Readonly<Record<string, unknown>>;',
    '  readonly reads: Reads;',
    '  readonly mutations: Mutations;',
    '  readonly presence: Presence;',
    '  readonly commands: Commands;',
    '  readonly assets: Assets;',
    '  readonly __params?: Params;',
    '}',
    'export interface GeneratedAppSurfaces {',
    ...Object.entries(surfaces).map(([name, surface]) => {
      const params = Object.entries(surface.params ?? {});
      const paramType = params.length === 0
        ? 'Record<string, never>'
        : `{ ${params.map(([paramName, contract]) => `${JSON.stringify(paramName)}: ${surfaceContractType(contract)}`).join('; ')} }`;
      return `  readonly ${JSON.stringify(name)}: SurfaceDescriptor<${paramType}, ${renderSurfaceTypeMap(surface.reads, 'GeneratedApi')}, ${renderSurfaceTypeMap(surface.mutations, 'GeneratedApi')}, ${renderSurfaceTypeMap(surface.commands, 'GeneratedAppCommands', commands)}, ${renderSurfaceTypeMap(surface.presence, 'GeneratedEphemeral')}, ${renderSurfaceTypeMap(surface.assets, 'GeneratedApi')}>;`;
    }),
    '}',
    ...(applicationAuthBootstrap === undefined ? [] : [
      'export interface ApplicationAuthBootstrapV1 {',
      "  readonly format: 'snapback.application-auth-bootstrap.v1';",
      '  readonly appId: string;',
      "  readonly mode: 'sessions';",
      "  readonly custody: 'durable-required' | 'volatile-explicit';",
      "  readonly entryMechanisms: readonly ('guest-v1' | 'password-v1' | 'email-code-v1' | 'external-session-explicit-v1')[];",
      "  readonly anonymousPublic: 'allowed' | 'refused';",
      '  readonly lifecycleProtocol: 1;',
      '}',
    ]),
    'export interface AppDescriptorV1 {',
    "  readonly format: 'snapback.app.v1';",
    `  readonly authoringProfile: ${JSON.stringify(authoringProfile)};`,
    ...(applicationAuthBootstrap === undefined
      ? []
      : ['  readonly authBootstrap: ApplicationAuthBootstrapV1;']),
    '  readonly identity: Readonly<{ app: string; schema: string; functions: string; descriptor: `sha256:${string}` }>;',
    '  readonly api: Readonly<{',
    '    queries: Readonly<Pick<GeneratedApi, GeneratedAppQueryName>>;',
    '    mutations: Readonly<Pick<GeneratedApi, GeneratedAppMutationName>>;',
    '    assets: Readonly<Pick<GeneratedApi, GeneratedAppAssetName>>;',
    '    ephemeral: GeneratedEphemeral;',
    '    queryGroups: GeneratedQueryGroups;',
    '  }>;',
    '  readonly commands: Readonly<GeneratedAppCommands>;',
    '  readonly surfaces: Readonly<GeneratedAppSurfaces>;',
    '  readonly capabilities: Readonly<{ required: readonly CapabilityRequirement[] }>;',
    '}',
    'export type GeneratedAppDescriptorV1 = AppDescriptorV1;',
    'export declare const artifacts: GeneratedArtifacts;',
    'export declare const app: GeneratedAppDescriptorV1;',
  ];
  for (const { name, kind } of standalone.filter(({ name }) => IDENT.test(name))) {
    const namespace = kind === 'Mutation' ? 'mutations' : 'queries';
    lines.push(`export declare const ${name}: GeneratedAppDescriptorV1['api']['${namespace}'][${JSON.stringify(name)}];`);
  }
  lines.push('export default app;');
  return `${lines.join('\n')}\n`;
}

function renderApiModule(
  functions,
  actionReferences,
  defaultAssetNames,
  appBindingIdentity,
  authorityProfileNames = [],
) {
  const standalone = standaloneIdentifierFunctions(functions);
  const reexports = ['app', ...standalone.map(({ name }) => name)].join(', ');
  const appSpecifier = contentAddressedModuleSpecifier('./app.binding.mjs', appBindingIdentity);
  const defaultAssignments = [];
  const authorityAssignments = [];
  for (const [tableName, fields] of Object.entries(defaultAssetNames)) {
    defaultAssignments.push(`defaults[${JSON.stringify(tableName)}] = Object.create(null);`);
    for (const [fieldName, assetName] of Object.entries(fields)) {
      defaultAssignments.push(`defaults[${JSON.stringify(tableName)}][${JSON.stringify(fieldName)}] = app.api.assets[${JSON.stringify(assetName)}];`);
    }
  }
  for (const profileName of authorityProfileNames) {
    const members = functions
      .map(({ name }) => name)
      .filter((name) => name.startsWith(`${profileName}.`))
      .map((name) => name.slice(profileName.length + 1));
    authorityAssignments.push(
      `references[${JSON.stringify(profileName)}] = { ${members.map((member) => `${JSON.stringify(member)}: references[${JSON.stringify(`${profileName}.${member}`)}]`).join(', ')} };`,
    );
  }
  return `${HEADER}\n` +
    `import { app, artifacts } from ${JSON.stringify(appSpecifier)};\n` +
    `export { ${reexports}, artifacts } from ${JSON.stringify(appSpecifier)};\n` +
    `const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };\n` +
    `/** @type {import('./api.d.ts').GeneratedEphemeral} */\n` +
    `export const ephemeral = app.api.ephemeral;\n` +
    `/** @type {import('./api.d.ts').GeneratedQueryGroups} */\n` +
    `export const groups = app.api.queryGroups;\n` +
    `/** @type {import('./api.d.ts').GeneratedAssetUploadDefaults} */\n` +
    `export const defaults = Object.create(null);\n` +
    `${defaultAssignments.join('\n')}\n` +
    `deepFreeze(defaults);\n` +
    `const actionReferences = ${stableJson(actionReferences)};\n` +
    `for (const reference of Object.values(actionReferences)) { reference.authoringProfile = app.authoringProfile; reference.retention ??= 'none'; Object.defineProperty(reference, 'artifacts', { value: artifacts, enumerable: false }); }\n` +
    `const references = { ...app.api.assets, ...app.api.queries, ...app.api.mutations, ...actionReferences, ephemeral, groups };\n` +
    `${authorityAssignments.join('\n')}\n` +
    `/** @type {import('./api.d.ts').GeneratedApi} */\n` +
    `export const api = deepFreeze(references);\n` +
    `export default api;\n`;
}

function renderApiTypes(
  functions,
  functionsModule,
  ephemeralCollections,
  schemaDef,
  providerBindingMetadata,
  routesManifest,
  assetUploadIntents = [],
  capabilityManifest = null,
  clientLifecycleManifest,
  authoringProfile = EXPLICIT_AUTHORING_PROFILE,
  authorityProfileNames = [],
) {
  const hasSearchFunction = functions.some(
    (fn) => fn.runtime?.HostPlan?.SearchQuery !== undefined,
  );
  const hasVectorFunction = functions.some(
    (fn) => fn.runtime?.HostPlan?.VectorQuery !== undefined,
  );
  const hasMediaResult = functions.some(
    (fn) => resultContractContainsMedia(fn.resultContract),
  );
  const schemaTables = Object.entries(schemaDef.tables ?? {});
  const membershipTableNames = new Set(
    schemaTables
      .filter(([, table]) => table.membershipDeclaration !== undefined)
      .map(([tableName]) => tableName),
  );
  const lastHolderResourceTableNames = new Set();
  const identityBindingTableNames = new Set(
    (schemaDef.authProgram?.verifiedProvisioning?.writes ?? [])
      .filter((write) => write.mode === 'identity-binding')
      .map((write) => write.table),
  );
  for (const [, table] of schemaTables) {
    const membership = table.membershipDeclaration;
    if (membership?.scope !== 'resource' || membership.lastHolder === undefined) continue;
    const resourceTable = idFieldTypeTable(table.fields?.[membership.resource]?.fieldType);
    if (resourceTable !== null) lastHolderResourceTableNames.add(resourceTable);
  }
  const typeUnion = (names) => [...names].map((name) => JSON.stringify(name)).join(' | ') || 'never';
  const pushAudiences = Object.entries(schemaDef.pushSeam?.audiences ?? {});
  const pushAudienceNames = pushAudiences.map(([name]) => name);
  const hasPushSend = schemaDef.pushSeam?.ledger !== undefined && pushAudiences.length > 0;
  const hasConnectedClientPredicate = schemaDef.auth?.mode === 'sessions'
    && capabilityManifest?.supportedCapabilities?.includes('realtime.connected-client-predicate');
  const pushAudienceReferenceType = ([name, audience]) => {
    const args = new Map();
    for (const clause of [audience.resolve, audience.authorize]) {
      if (clause?.kind === 'explicitPrincipals') {
        args.set(clause.principalsArg, 'readonly Principal[]');
      } else if (clause?.kind === 'membership' && clause.resourceArg !== undefined) {
        args.set(clause.resourceArg, 'string');
      }
    }
    const argsType = args.size === 0
      ? 'Record<string, never>'
      : `Readonly<{ ${[...args].map(([key, type]) => `${JSON.stringify(key)}: ${type}`).join('; ')} }>`;
    return `Readonly<{ audience: ${JSON.stringify(name)}; args: ${argsType} }>`;
  };
  const storageWriteValueType = (validator) => {
    const type = typeForGeneratedValidator(validator).replace(/ \| undefined$/, '');
    return validator.optional ? `null | ${type}` : type;
  };
  const lines = [
    HEADER,
    `import type { ActionContext, AnonymousAuthContext, AssetsContext, AuthContext, AuthenticatedAuthContext, Handler, HandlerSchema, JobsContext, MutationContext, MutationDatabase, MutationIdentityContext, MutationSettlement, QueryBuilder, QueryContext, QueryDatabase, RealtimeContext, RuntimeContext, SecretsContext, SequenceContext } from '${CTX_DECLARATION_MODULE}';`,
    `export type * from '${CTX_DECLARATION_MODULE}';`,
    ...(hasSearchFunction
      ? ["import type { SearchPageV1 as ClientSearchPageV1 } from '@expo/snapback-client';"]
      : []),
    ...(hasVectorFunction
      ? ["import type { VectorPageV1 as ClientVectorPageV1 } from '@expo/snapback-client';"]
      : []),
    ...(hasMediaResult
      ? ["import type { MediaRef } from '@expo/snapback-client/assets';"]
      : []),
    "export type SchemaVersion = 'snapback.v0';",
    "export type Principal = string & { readonly __snapbackPrincipal: unique symbol };",
    "export interface AuthorityMembershipStateV1 { readonly role: string; readonly status: 'active' | 'invited' }",
    "export interface AuthorityTransitionReceiptV1 { readonly declaration: string; readonly predecessor: AuthorityMembershipStateV1 | null; readonly successor: AuthorityMembershipStateV1 | null; readonly subject: string; readonly scope: string | null; readonly invalidationDisposition: 'global-authorization-epoch-advanced' | 'no-authorization-event' | 'preview-rolled-back' }",
    "export type Id<Table extends string> = string & { readonly __snapbackIdTable: Table };",
    "export type ProvisionalId<Table extends string> = string & { readonly __snapbackProvisionalIdTable: Table };",
    "export type FunctionKind = 'Query' | 'Mutation' | 'LiveQuery' | 'Action';",
    "export type AuthoringProfile = 'snapback-explicit-v1' | 'snapback-familiar-ts-v1';",
    // @ref LLP 0131#the-search-fixture-cv-5 — the request-grammar types are
    // derived from the exported Rust-owned search.request.schema.json, not
    // hand-authored; the derivation fails closed on unknown constructs.
    ...searchAstEmission().tsLines,
    'export interface SearchMatchRangeV1 { start: number; end: number }',
    'export interface SearchHighlightV1 { field: string; text: string; matches: readonly SearchMatchRangeV1[] }',
    // @ref LLP 0073#ranking-order-and-cursors — each generated search ref
    // instantiates the client-owned nominal page phantom with its closed
    // stored-field and row-id types. The shared alias prevents an ordinary
    // structurally page-shaped query from entering client.search().
    'export interface SearchItemV1<Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, RowId extends string = string> { rowId: RowId; score: number; fields: Fields; highlights: readonly SearchHighlightV1[] }',
    hasSearchFunction
      ? 'export type SearchPageV1<Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, RowId extends string = string> = ClientSearchPageV1<Fields, RowId>;'
      : 'export interface SearchPageV1<Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, RowId extends string = string> { items: readonly SearchItemV1<Fields, RowId>[]; cursor: string | null; hasMore: boolean }',
    'export interface VectorItemV1<Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, RowId extends string = string> { rowId: RowId; distance: number; fields: Fields }',
    hasVectorFunction
      ? 'export type VectorPageV1<Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, RowId extends string = string> = ClientVectorPageV1<Fields, RowId>;'
      : 'export interface VectorPageV1<Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, RowId extends string = string> { items: readonly VectorItemV1<Fields, RowId>[] }',
    'export interface GeneratedArtifacts { readonly trustedCompositionActivation: Readonly<Record<string, unknown>> | null }',
    'export const artifacts: GeneratedArtifacts;',
    "export type EphemeralKeyMode = 'Connection' | 'Session' | 'User' | 'Custom';",
    "export interface GeneratedMutationIrV1 {",
    "  readonly format: 'snapback.generated-mutation-ir.v1';",
    "  readonly operationHash: `sha256:${string}`;",
    "  readonly sourceIdentity: Readonly<{ functionId: string; implementationHash: string; authoredSourceHash: `sha256:${string}`; activation: Readonly<{ schemaVersion: SchemaVersion; appId: string; schemaHash: string; bundleHash: string; inputsHash: string }> }> ;",
    "  readonly schemaIdentity: Readonly<{ schemaVersion: SchemaVersion; appId: string; schemaHash: string }> ;",
    "  readonly capabilityClass: 'local-executable' | 'server-only';",
    "  readonly capabilityCode: string;",
    "  readonly declaredEffectClass: 'snapback.browser-ir.insert-get-guard-patch.v1';",
    "  readonly declaredReads: readonly string[];",
    "  readonly localReadRequirements: readonly Readonly<{ kind: 'point'; table: string; idArg: string; binding: string | null; requiredFields: readonly string[] }>[];",
    "  readonly schema: Readonly<{ tables: readonly Readonly<{ name: string; fields: readonly Readonly<{ name: string }>[] }>[] }> ;",
    "  readonly plan: Readonly<Record<string, unknown>>;",
    "  readonly mintSites: readonly string[];",
    "  readonly usesRuntimeNow: boolean;",
    "  readonly boundedSkew: Readonly<{ field: string; maxSkewMs: number }> | null;",
    "}",
    '/** Optional own-property `undefined` is normalized exactly as omission; required, array, and open-JSON undefined still refuse before dispatch. */',
    "export type FunctionReferenceDelivery<Kind extends FunctionKind> = Kind extends 'LiveQuery' ? Readonly<{ delivery: 'live' }> : Kind extends 'Query' ? Readonly<{ delivery: 'read' }> : Readonly<Record<never, never>>;",
    'export interface FunctionReferenceBase<Name extends string, Kind extends FunctionKind, Args, Result = unknown, Profile extends AuthoringProfile = AuthoringProfile> {',
    "  artifactKind: 'functionReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  kind: Kind;',
    '  readonly __snapbackReferenceKind: Kind;',
    '  authoringProfile: Profile;',
    '  retention: string;',
    '  readonly __snapbackAuthoringProfile?: Profile;',
    "  authRequirement: 'public' | 'optional-user' | 'authenticated';",
    '  implementationHash: string;',
    '  argsContractHash: string;',
    '  argsContract: Readonly<{ fields: readonly Readonly<{ name: string; required: boolean; value: Readonly<Record<string, unknown>> }>[] }>;',
    '  resultContractHash: string;',
    '  expectedGeneration: Readonly<{ schemaVersion: SchemaVersion; appId: string; schemaHash: string; bundleHash: string; inputsHash: string }>;',
    '  authoredSourceHash: `sha256:${string}`;',
    '  sourceSpan?: Readonly<{ file: string; line?: number; column?: number }>;',
    '  resultContract?: Readonly<Record<string, unknown>>;',
    '  mutationIr?: GeneratedMutationIrV1;',
    '  composition?: Readonly<{ normalizedCompositePlan: Readonly<Record<string, unknown>>; planHash: `sha256:${string}`; resultContract: Readonly<Record<string, unknown>> }>;',
    '  readonly artifacts?: GeneratedArtifacts;',
    '  argumentSchema: Readonly<Record<string, unknown>>;',
    '  readonly __args?: Args;',
    '  readonly __result?: Result;',
    '}',
    'export type FunctionReference<Name extends string, Kind extends FunctionKind, Args, Result = unknown, Profile extends AuthoringProfile = AuthoringProfile> = FunctionReferenceBase<Name, Kind, Args, Result, Profile> & FunctionReferenceDelivery<Kind>;',
    "export type QueryRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown, Profile extends AuthoringProfile = AuthoringProfile> = FunctionReference<Name, 'Query', Args, Result, Profile>;",
    "export type LiveQueryRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown, Profile extends AuthoringProfile = AuthoringProfile> = FunctionReference<Name, 'LiveQuery', Args, Result, Profile>;",
    "export type MutationRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown, Profile extends AuthoringProfile = AuthoringProfile> = FunctionReference<Name, 'Mutation', Args, Result, Profile>;",
    "export type ActionRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown, Profile extends AuthoringProfile = AuthoringProfile> = FunctionReference<Name, 'Action', Args, Result, Profile>;",
    'export type FunctionArgs<Ref> = Ref extends FunctionReference<string, FunctionKind, infer Args, unknown> ? Args : never;',
    'export type FunctionResult<Ref> = Ref extends FunctionReference<string, FunctionKind, unknown, infer Result> ? Result : never;',
    "export type QueryInvocation<Ref extends FunctionReference<string, 'Query' | 'LiveQuery', unknown, unknown>> = { function: Ref; args: FunctionArgs<Ref> };",
    "export type MutationInvocation<Ref extends FunctionReference<string, 'Mutation', unknown, unknown>> = { function: Ref; args: FunctionArgs<Ref> };",
    "export type ActionInvocation<Ref extends FunctionReference<string, 'Action', unknown, unknown>> = { function: Ref; args: FunctionArgs<Ref> };",
    'export interface QueryGroupEntry<Name extends string = string, Ref extends FunctionReference<string, "LiveQuery", unknown, unknown> = FunctionReference<string, "LiveQuery", unknown, unknown>, Args extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {',
    '  readonly name: Name;',
    '  readonly ref: Ref;',
    '  readonly args: Args;',
    '}',
    'export type QueryGroupEntryResults<Queries extends readonly QueryGroupEntry[]> = {',
    '  readonly [Entry in Queries[number] as Entry["name"]]: { readonly ref: Entry["ref"]; readonly args: FunctionArgs<Entry["ref"]> };',
    '};',
    'export interface QueryGroupReference<Route extends string, Params, Queries extends readonly QueryGroupEntry[]> {',
    "  readonly artifactKind: 'queryGroupReference';",
    '  readonly formatVersion: 1;',
    '  readonly schemaVersion: SchemaVersion;',
    '  readonly appId: string;',
    '  readonly id: `${string}:query-group:${Route}`;',
    '  readonly route: Route;',
    '  readonly definitionHash: `sha256:${string}`;',
    '  readonly queries: Queries;',
    '  readonly persist?: false;',
    '  readonly __params?: Params;',
    '  readonly __entries?: QueryGroupEntryResults<Queries>;',
    '}',
    'export interface MixedQueryGroupEntry<Name extends string = string, Ref extends FunctionReference<string, "Query" | "LiveQuery", unknown, unknown> = FunctionReference<string, "Query" | "LiveQuery", unknown, unknown>, Args extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {',
    '  readonly name: Name;',
    '  readonly ref: Ref;',
    '  readonly args: Args;',
    '  readonly nodePlan: Readonly<Record<string, unknown>>;',
    '  readonly nodePlanHash: `sha256:${string}`;',
    '}',
    'export type MixedQueryGroupEntryResults<Queries extends readonly MixedQueryGroupEntry[]> = {',
    '  readonly [Entry in Queries[number] as Entry["name"]]: { readonly ref: Entry["ref"]; readonly args: FunctionArgs<Entry["ref"]> };',
    '};',
    'export interface MixedQueryGroupReference<Route extends string, Params, Queries extends readonly MixedQueryGroupEntry[]> {',
    "  readonly artifactKind: 'queryGroupReference';",
    '  readonly formatVersion: 2;',
    "  readonly profile: 'mixed-route.v2';",
    '  readonly schemaVersion: SchemaVersion;',
    '  readonly appId: string;',
    '  readonly id: `${string}:query-group-v2:${Route}`;',
    '  readonly route: Route;',
    '  readonly definitionHash: `sha256:${string}`;',
    '  readonly planHash: `sha256:${string}`;',
    '  readonly queries: Queries;',
    '  readonly persist?: false;',
    '  readonly __params?: Params;',
    '  readonly __entries?: MixedQueryGroupEntryResults<Queries>;',
    '}',
    'export type QueryGroupParams<Ref> = Ref extends QueryGroupReference<string, infer Params, readonly QueryGroupEntry[]> ? Params : Ref extends MixedQueryGroupReference<string, infer Params, readonly MixedQueryGroupEntry[]> ? Params : never;',
    'export type QueryGroupEntries<Ref> = Ref extends QueryGroupReference<string, unknown, infer Queries> ? QueryGroupEntryResults<Queries> : Ref extends MixedQueryGroupReference<string, unknown, infer Queries> ? MixedQueryGroupEntryResults<Queries> : never;',
    // @ref LLP 0044#generated-upload-intents — the declaration twin of the
    // Rust-owned assetUploadReference DTO renderAssetUploadReferences emits at
    // runtime, structurally accepted by useSnapbackAssetUpload and
    // createAssetClient(...).start without a cast.
    'export interface AssetUploadReference<Name extends string, Args = Record<string, never>> {',
    "  artifactKind: 'assetUploadReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  implementationHash: string;',
    '  argsContractHash: string;',
    '  argumentSchema: Readonly<Record<string, unknown>>;',
    '  intentPolicyHash: string;',
    '  policyGeneration: number;',
    '  requiredCapabilities: readonly string[];',
    '  readonly __args?: Args;',
    '}',
    'export interface EphemeralCollectionReference<Name extends string, Scope, Value, KeyMode extends EphemeralKeyMode = EphemeralKeyMode> {',
    "  artifactKind: 'ephemeralCollectionReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  sourceSpan: Readonly<{ file: string; line?: number; column?: number }>;',
    '  keyMode: KeyMode;',
    '  scopeFields: readonly string[];',
    '  scopeContract: Readonly<Record<string, unknown>>;',
    '  valueContract: Readonly<Record<string, unknown>>;',
    '  routingFields: readonly string[];',
    '  defaultTtlMs: number;',
    '  maxTtlMs: number;',
    '  withdrawalVisibilityDeadlineMs: number;',
    '  maxValueBytes: number;',
    '  publishRate: { readonly sustainedHz: number; readonly burst: number };',
    "  deliveryMode: 'latest';",
    '  readonly __scope?: Scope;',
    '  readonly __value?: Value;',
    '}',
    'export interface GeneratedDataModel {',
  ];
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const properties = Object.entries(table.fields ?? {}).map(([fieldName, validator]) => {
      const type = typeForGeneratedValidator(validator).replace(/ \| undefined$/, '');
      // @ref LLP 0108#adversarial-implementation-closure--2026-07-28 —
      // persisted optionals materialize as present nulls, never omitted keys.
      return `${fieldName}: ${validator.optional ? `null | ${type}` : type}`;
    });
    lines.push(`  ${tableName}: { _id: Id<'${tableName}'>; _version: number; _createdAt: number; _updatedAt: number${properties.length ? `; ${properties.join('; ')}` : ''} };`);
  }
  lines.push(
    '}',
    // @ref LLP 0004#ctxdb-contract — generated handler interiors expose the
    // exact read/write split of the shipped ctx.db surface. Every row and
    // write shape below is projected from schemaDef, the same manifest input
    // that emits GeneratedDataModel; this is not a parallel type model.
    'export type GeneratedTableName = keyof GeneratedDataModel & string;',
    `export type GeneratedReadableTableName = Exclude<GeneratedTableName, ${typeUnion(membershipTableNames)}>;`,
    `export type GeneratedInsertableTableName = Exclude<GeneratedReadableTableName, ${typeUnion(new Set([...lastHolderResourceTableNames, ...identityBindingTableNames]))}>;`,
    identityBindingTableNames.size > 0
      ? `export type GeneratedPatchableTableName = Exclude<GeneratedReadableTableName, ${typeUnion(identityBindingTableNames)}>;`
      : 'export type GeneratedPatchableTableName = GeneratedReadableTableName;',
    `export type GeneratedDeletableTableName = Exclude<GeneratedReadableTableName, ${typeUnion(new Set([...lastHolderResourceTableNames, ...identityBindingTableNames]))}>;`,
    'export interface GeneratedInsertModel {',
  );
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    if (membershipTableNames.has(tableName) || lastHolderResourceTableNames.has(tableName) || identityBindingTableNames.has(tableName)) continue;
    const properties = Object.entries(table.fields ?? {})
      .filter(([, validator]) => validator.protectedWrite !== true)
      .map(([fieldName, validator]) => {
        return `${JSON.stringify(fieldName)}${validator.optional ? '?' : ''}: ${storageWriteValueType(validator)}`;
      });
    lines.push(`  ${JSON.stringify(tableName)}: { ${properties.join('; ')} };`);
  }
  lines.push(
    '}',
    'export interface GeneratedPatchModel {',
  );
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    if (table.membershipDeclaration !== undefined || identityBindingTableNames.has(tableName)) continue;
    const properties = Object.entries(table.fields ?? {})
      .filter(([, validator]) => validator.protectedWrite !== true)
      .map(([fieldName, validator]) => {
        return `${JSON.stringify(fieldName)}?: ${storageWriteValueType(validator)}`;
      });
    lines.push(`  ${JSON.stringify(tableName)}: { ${properties.join('; ')} };`);
  }
  lines.push(
    '}',
    'export interface GeneratedIndexNames {',
  );
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const indexes = (table.indexes ?? []).map((index) => JSON.stringify(index.name));
    lines.push(`  ${JSON.stringify(tableName)}: ${indexes.join(' | ') || 'never'};`);
  }
  lines.push(
    '}',
    'export interface GeneratedUniqueIndexKeys {',
  );
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const indexes = (table.indexes ?? []).filter((index) => index.unique === true);
    const entries = indexes.map((index) => {
      const fields = index.fields.map((field) => (
        `${JSON.stringify(field)}: NonNullable<GeneratedDataModel[${JSON.stringify(tableName)}][${JSON.stringify(field)}]>`
      ));
      return `${JSON.stringify(index.name)}: Readonly<{ ${fields.join('; ')} }>`;
    });
    lines.push(`  ${JSON.stringify(tableName)}: { ${entries.join('; ')} };`);
  }
  lines.push(
    '}',
    'export interface GeneratedTableAdmissionMaps {',
    '  readonly read: Record<GeneratedReadableTableName, true>;',
    '  readonly insert: Record<GeneratedInsertableTableName, true>;',
    '  readonly patch: Record<GeneratedPatchableTableName, true>;',
    '  readonly delete: Record<GeneratedDeletableTableName, true>;',
    '}',
    'export type GeneratedHandlerSchema = HandlerSchema<GeneratedDataModel, GeneratedIndexNames, GeneratedInsertModel, GeneratedPatchModel, GeneratedTableAdmissionMaps, GeneratedUniqueIndexKeys>;',
    'export type GeneratedQueryBuilder<Table extends GeneratedReadableTableName> = QueryBuilder<GeneratedHandlerSchema, Table>;',
    'export type GeneratedQueryDatabase = QueryDatabase<GeneratedHandlerSchema>;',
    'export type GeneratedMutationDatabase = MutationDatabase<GeneratedHandlerSchema>;',
    // The Rust HandlerAuthProjection always carries userId/sessionId, using
    // null for anonymous or non-session authority; all other authority facts
    // are omitted for anonymous calls. Keep that distinction exact so a
    // helper must narrow before treating optional-user authority as human.
    'export type GeneratedAnonymousAuthContext = AnonymousAuthContext;',
    'export type GeneratedAuthenticatedAuthContext = AuthenticatedAuthContext<Principal>;',
    'export type GeneratedAuthContext = AuthContext<Principal>;',
    'export type GeneratedRuntimeContext = RuntimeContext;',
    'export type GeneratedMutationSettlement = MutationSettlement;',
    'export type GeneratedAssetsContext = AssetsContext<string, Readonly<{ upload?: string | Readonly<{ name?: string; id?: string }> }>, any>;',
  );
  if (hasPushSend) {
    lines.push(
      `export type GeneratedPushAudienceReference = ${pushAudiences.map(pushAudienceReferenceType).join(' | ')};`,
      'export interface GeneratedPushSendRequest { readonly to: GeneratedPushAudienceReference; readonly title: string; readonly body: string; readonly data?: Readonly<Record<string, unknown>>; readonly dedupeKey: string; /** Explicit duplicate-risk acknowledgement; accepted only for an ambiguous predecessor. */ readonly redriveAmbiguous?: boolean }',
      'export interface GeneratedPushSendResult { readonly intentId: string; readonly attempt: number; readonly targetCount: number; readonly batchCount: number; readonly state: string; readonly deduplicated: boolean }',
    );
  }
  lines.push('export interface GeneratedPermissions {');
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const membership = table.membershipDeclaration;
    if (!membership) continue;
    const declaration = membership.id ?? tableName;
    const typeName = pascal(declaration);
    const resourceTable = membership.scope === 'resource'
      ? idFieldTypeTable(table.fields?.[membership.resource]?.fieldType)
      : null;
    const resourceType = resourceTable ? `Id<'${resourceTable}'>` : 'null';
    lines.push(`  ${declaration}: { allowsRole(resource: ${resourceType}, role: ${typeName}Role, ...roles: ${typeName}Role[]): Promise<boolean>; requireRole(resource: ${resourceType}, role: ${typeName}Role, ...roles: ${typeName}Role[]): Promise<void> };`);
  }
  lines.push('}');
  lines.push(
    'export interface AuthorityRosterPageV1<Row> { readonly rows: readonly Row[]; readonly cursor: string | null }',
    "export interface AuthorityHistoryHorizonV1 { readonly earliestCoveredCommit: number; readonly coverageClass: 'full' | 'authorization-facts-only' }",
    "export interface AuthorityHistoryPageV1<Row> { readonly rows: readonly Row[]; readonly cursor: string | null; readonly boundary: 'exact' | 'at-limit'; readonly horizon: AuthorityHistoryHorizonV1 }",
    'export interface GeneratedAuthority {',
  );
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const membership = table.membershipDeclaration;
    if (!membership) continue;
    const declaration = membership.id ?? tableName;
    if (!authorityProfileNames.includes(declaration)) continue;
    const resourceTable = idFieldTypeTable(table.fields?.[membership.resource]?.fieldType);
    const scopeType = resourceTable ? `Id<'${resourceTable}'>` : 'string';
    const roleType = `${pascal(declaration)}Role`;
    const rowType = `FunctionResult<GeneratedApi[${JSON.stringify(`${declaration}.list`)}]>[number]`;
    const hasProjection = functions.some(({ name }) => name === `${declaration}.history`);
    const projectionMethods = hasProjection
      ? ` history(scopeId: ${scopeType}, page?: Readonly<{ after?: string; limit?: number }>): Promise<FunctionResult<GeneratedApi[${JSON.stringify(`${declaration}.history`)}]>>; incarnations(scopeId: ${scopeType}, page?: Readonly<{ after?: string; limit?: number }>): Promise<FunctionResult<GeneratedApi[${JSON.stringify(`${declaration}.incarnations`)}]>>;`
      : '';
    lines.push(`  ${JSON.stringify(declaration)}: { list(scopeId: ${scopeType}, page?: Readonly<{ after?: string; limit?: number }>): Promise<AuthorityRosterPageV1<${rowType}>>; myRole(scopeId: ${scopeType}): Promise<Readonly<{ role: ${roleType}; status: 'active' | 'invited' }>>;${projectionMethods} };`);
  }
  lines.push('}', 'export interface GeneratedMutationAuthority {');
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const membership = table.membershipDeclaration;
    if (!membership) continue;
    const declaration = membership.id ?? tableName;
    if (!authorityProfileNames.includes(declaration)) continue;
    const resourceTable = idFieldTypeTable(table.fields?.[membership.resource]?.fieldType);
    const scopeType = resourceTable ? `Id<'${resourceTable}'>` : 'string';
    const hasProjection = functions.some(({ name }) => name === `${declaration}.history`);
    const mutationMethods = hasProjection
      ? ` & { snapshotRecipients(scopeId: ${scopeType}, rowId: string): Promise<null> }`
      : '';
    lines.push(`  ${JSON.stringify(declaration)}: GeneratedAuthority[${JSON.stringify(declaration)}]${mutationMethods};`);
  }
  lines.push('}');
  const membershipAliases = [];
  const membershipMembers = [];
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const membership = table.membershipDeclaration;
    if (!membership) continue;
    const declaration = membership.id ?? tableName;
    const typeName = pascal(declaration);
    const membershipResourceTable = membership.scope === 'resource'
      ? idFieldTypeTable(table.fields?.[membership.resource]?.fieldType)
      : null;
    const resourceType = membershipResourceTable ? `Id<'${membershipResourceTable}'>` : 'string';
    const roles = [...membership.roles, ...(membership.pendingRoles ?? [])];
    membershipAliases.push(`export type ${typeName}Role = ${roles.map((role) => JSON.stringify(role)).join(' | ') || 'never'};`);
    const insertFields = Object.entries(table.fields ?? {}).map(([fieldName, validator]) => {
      const fieldType = fieldName === membership.role
        ? `${typeName}Role`
        : storageWriteValueType(validator);
      return `${fieldName}${validator.optional ? '?' : ''}: ${fieldType}`;
    });
    const patchFields = Object.entries(table.fields ?? {})
      .filter(([fieldName]) => ![membership.principal, membership.resource, membership.role].includes(fieldName))
      .map(([fieldName, validator]) => `${fieldName}?: ${storageWriteValueType(validator)}`);
    membershipAliases.push(`export type ${typeName}Insert = { ${insertFields.join('; ')} };`);
    const patchType = patchFields.length === 0
      ? 'Record<string, never>'
      : `{ ${patchFields.join('; ')} }`;
    membershipAliases.push(`export type ${typeName}Patch = ${patchType};`);
    let bootstrapMethod = '';
    if (membership.bootstrapRole !== undefined && membership.scope === 'resource') {
      const resourceTable = idFieldTypeTable(table.fields?.[membership.resource]?.fieldType);
      const resourceDefinition = resourceTable ? schemaDef.tables?.[resourceTable] : null;
      if (resourceTable && resourceDefinition) {
        const bootstrapFields = Object.entries(resourceDefinition.fields ?? {}).map(([fieldName, validator]) => (
          `${fieldName}${validator.optional ? '?' : ''}: ${storageWriteValueType(validator)}`
        ));
        const bootstrapMemberFields = Object.entries(table.fields ?? {})
          .filter(([fieldName]) => fieldName !== membership.resource)
          .map(([fieldName, validator]) => {
            const fieldType = fieldName === membership.role
              ? `${typeName}Role`
              : storageWriteValueType(validator);
            return `${fieldName}${validator.optional ? '?' : ''}: ${fieldType}`;
          });
        membershipAliases.push(`export type ${typeName}Bootstrap = { ${bootstrapFields.join('; ')} };`);
        membershipAliases.push(`export type ${typeName}BootstrapMember = { ${bootstrapMemberFields.join('; ')} };`);
        bootstrapMethod = `bootstrap(values: ${typeName}Bootstrap, initialMembers?: readonly ${typeName}BootstrapMember[]): Promise<Id<'${resourceTable}'>>; `;
      }
    }
    // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    // generated self variants expose the host-private resolver without
    // weakening the transition matrix or revealing a roster row id.
    const selfMethods = membership.scope === 'app'
      ? `setSelfRole(role: ${typeName}Role): Promise<unknown>; removeSelf(): Promise<unknown>; patchSelf(values: ${typeName}Patch): Promise<unknown>; `
      : (() => {
          return `setSelfRole(resource: ${resourceType}, role: ${typeName}Role): Promise<unknown>; removeSelf(resource: ${resourceType}): Promise<unknown>; patchSelf(resource: ${resourceType}, values: ${typeName}Patch): Promise<unknown>; `;
        })();
    // @ref LLP 0100#2-opting-into-principal-addressed-removal — codegen emits
    // removePrincipal only when the declaration opts in; the result is always
    // Promise<null> (never removed/missing/role/id/count).
    let principalAddressedMethods = '';
    if (membership.principalAddressedWrites?.remove === true) {
      if (membership.scope === 'app') {
        principalAddressedMethods = 'removePrincipal(principal: string): Promise<null>; ';
      } else {
        principalAddressedMethods = `removePrincipal(resource: ${resourceType}, principal: string): Promise<null>; `;
      }
    }
    const authorityMethods = authorityProfileNames.includes(declaration)
      ? `invite(values: ${typeName}Insert): Promise<null>; join(resource: ${resourceType}, invitation: ${typeName}Role): Promise<null>; leave(resource: ${resourceType}): Promise<null>; changeRole(resource: ${resourceType}, principal: Principal, role: ${typeName}Role): Promise<null>; transferOwner(resource: ${resourceType}, principal: Principal): Promise<null>; removeAuthorityPrincipal(resource: ${resourceType}, principal: Principal): Promise<null>; `
      : '';
    membershipMembers.push(`  ${declaration}: { ${bootstrapMethod}insert(values: ${typeName}Insert): Promise<unknown>; ${authorityMethods}${selfMethods}${principalAddressedMethods}setRole(memberId: Id<'${tableName}'>, role: ${typeName}Role): Promise<unknown>; remove(memberId: Id<'${tableName}'>): Promise<unknown>; patch(memberId: Id<'${tableName}'>, values: ${typeName}Patch): Promise<unknown> };`);
  }
  lines.push(...membershipAliases);
  lines.push('export interface GeneratedMembership {');
  lines.push(...membershipMembers);
  lines.push('}');
  if (hasPushSend) {
    lines.push(
      `export type GeneratedPushAudienceName = ${typeUnion(new Set(pushAudienceNames))};`,
      'export interface GeneratedPush {',
      '  audience<Name extends GeneratedPushAudienceName>(name: Name, args: Extract<GeneratedPushAudienceReference, { readonly audience: Name }>["args"]): Extract<GeneratedPushAudienceReference, { readonly audience: Name }>;',
      '  readonly audiences: { readonly [Name in GeneratedPushAudienceName]: (args: Extract<GeneratedPushAudienceReference, { readonly audience: Name }>["args"]) => Extract<GeneratedPushAudienceReference, { readonly audience: Name }> };',
      '  send(request: GeneratedPushSendRequest): Promise<GeneratedPushSendResult>;',
      '}',
    );
  }
  lines.push(
    'export type GeneratedQueryContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = QueryContext<GeneratedHandlerSchema, Auth, GeneratedPermissions, any, GeneratedRuntimeContext> & { readonly authority: GeneratedAuthority };',
    'export type GeneratedMutationContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = MutationContext<GeneratedHandlerSchema, Auth, GeneratedPermissions, GeneratedAssetsContext, GeneratedRuntimeContext, GeneratedMembership, JobsContext, SequenceContext, MutationIdentityContext> & { readonly authority: GeneratedMutationAuthority };',
    `export type GeneratedActionContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = ActionContext<Auth, GeneratedRuntimeContext, any, SecretsContext<any>, unknown, ${hasPushSend ? 'GeneratedPush' : 'never'}, ${hasConnectedClientPredicate ? 'RealtimeContext' : 'never'}>;`,
    'export interface GeneratedFunctionContexts {',
  );
  for (const fn of functions) {
    const authType = fn.authRequirement === 'authenticated'
      ? '<GeneratedAuthenticatedAuthContext>'
      : '';
    const context = fn.kind === 'Mutation'
      ? `GeneratedMutationContext${authType}`
      : fn.kind === 'Action'
        ? `GeneratedActionContext${authType}`
        : `GeneratedQueryContext${authType}`;
    lines.push(`  ${JSON.stringify(fn.name)}: ${context};`);
  }
  lines.push(
    '}',
    'export interface GeneratedEphemeral {',
  );
  for (const collection of ephemeralCollections) {
    const def = schemaDef.ephemeral?.collections?.[collection.name];
    lines.push(`  ${collection.name}: EphemeralCollectionReference<'${collection.name}', ${typeForScope(def?.scope ?? {})}, ${typeForValidator(def?.value)}, '${collection.keyMode}'>;`);
  }
  lines.push(
    '}',
    'export interface GeneratedQueryGroups {',
  );
  const functionsByName = new Map(functions.map((fn) => [fn.name, fn]));
  for (const routeEntry of generatedQueryGroupRoutes(functions, routesManifest)) {
    const routeParams = parseRoutePattern(routeEntry.route, () => {}) ?? [];
    const paramTypes = new Map(routeParams.map((name) => [name, 'string']));
    const occurrences = new Map();
    const usedNames = new Set();
    const queryTypes = [];
    for (const query of routeEntry.queries) {
      const fn = functionsByName.get(query.function);
      const def = functionsModule[query.function];
      const argsType = typeForGeneratedArgs(def?.args ?? {});
      const resultType = resultContractType(
        fn?.resultContract ?? { kind: 'unknown' },
      );
      const refType = `FunctionReference<'${query.function}', '${fn?.kind ?? 'Query'}', ${argsType}, ${resultType}, ${JSON.stringify(authoringProfile)}>`;
      const entryName = queryGroupEntryName(query.function, occurrences, usedNames);
      const identityFields = routeEntry.mixedGroupEligible === true
        ? `; nodePlan: Readonly<Record<string, unknown>>; nodePlanHash: \`sha256:\${string}\`; liveness: ${fn?.kind === 'LiveQuery'
          ? "Readonly<{ kind: 'admitted'; delivery: 'live_replace'; pageDomain: 'whole-result' }>"
          : "Readonly<{ kind: 'none' }>"}`
        : '';
      queryTypes.push(`Readonly<{ name: ${JSON.stringify(entryName)}; ref: ${refType}; args: ${typeForQueryGroupTemplate(query.args ?? {})}${identityFields} }>`);
    }
    const paramsType = routeParams.length === 0
      ? 'Record<string, never>'
      : `{ ${routeParams.map((name) => `${JSON.stringify(name)}: ${paramTypes.get(name) ?? 'string'}`).join('; ')} }`;
    const referenceType = routeEntry.mixedGroupEligible === true
      ? 'MixedQueryGroupReference'
      : 'QueryGroupReference';
    lines.push(
      `  ${JSON.stringify(routeEntry.route)}: ${referenceType}<${JSON.stringify(routeEntry.route)}, ${paramsType}, readonly [${queryTypes.join(', ')}]>;`,
    );
  }
  lines.push(
    '}',
    'export interface GeneratedApi {',
  );
  const renderGeneratedFunctionReference = (fn) => {
    const def = functionsModule[fn.name];
    const search = fn.runtime?.HostPlan?.SearchQuery;
    const vector = fn.runtime?.HostPlan?.VectorQuery;
    const result = search
      ? searchPageResultType(fn.resultContract)
      : vector
        ? vectorPageResultType(fn.resultContract)
        : resultContractType(
          fn.resultContract ?? { kind: 'unknown' },
        );
    const args = search
      ? search.resourceArg === undefined
        ? fn.kind === 'LiveQuery'
          ? "Omit<SearchRequestV1, 'after'>"
          : 'SearchRequestV1'
        : `SearchRequestV1 & ${typeForGeneratedArgs({
          [search.resourceArg]: def?.args?.[search.resourceArg],
        })}`
      : typeForGeneratedArgs(def?.args ?? {});
    return [
      ...renderReferenceJSDoc(fn, clientLifecycleManifest, authoringProfile)
        .split('\n')
        .map((line) => `  ${line}`),
      `  ${JSON.stringify(fn.name)}: FunctionReference<${JSON.stringify(fn.name)}, '${fn.kind}', ${args}, ${result}, ${JSON.stringify(authoringProfile)}>;`,
    ];
  };
  for (const fn of standaloneApiFunctions(functions)) {
    lines.push(...renderGeneratedFunctionReference(fn));
  }
  for (const profileName of authorityProfileNames) {
    const members = functions
      .map(({ name }) => name)
      .filter((name) => name.startsWith(`${profileName}.`))
      .map((name) => name.slice(profileName.length + 1));
    lines.push(
      `  readonly ${JSON.stringify(profileName)}: Readonly<{ ${members.map((member) => `${JSON.stringify(member)}: GeneratedApi[${JSON.stringify(`${profileName}.${member}`)}]`).join('; ')} }>;`,
    );
  }
  // Explicit and derived upload intents are api members like functions —
  // the runtime module already emits them, and the declaration surface must
  // agree so useSnapbackAssetUpload({ upload: api.<intent> }) typechecks
  // without an app-side cast. Derived names (`_assets.default.<t>.<f>`)
  // carry dots and emit as quoted keys.
  const uploadRefType = (intent) =>
    `AssetUploadReference<${JSON.stringify(intent.name)}, ${typeForGeneratedArgs(functionsModule[intent.name]?.args ?? {})}>`;
  for (const intent of assetUploadIntents) {
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(intent.name) ? intent.name : JSON.stringify(intent.name);
    lines.push(`  ${key}: ${uploadRefType(intent)};`);
  }
  lines.push('  ephemeral: GeneratedEphemeral;');
  lines.push('  groups: GeneratedQueryGroups;');
  lines.push('}');
  lines.push('export interface GeneratedCommandTargets {');
  for (const fn of functions.filter(({ mediaCommandBindings }) => (
    Array.isArray(mediaCommandBindings) && mediaCommandBindings.length > 0
  ))) {
    lines.push(...renderGeneratedFunctionReference(fn));
  }
  lines.push('}');
  lines.push('export type GeneratedFunctionName = keyof GeneratedFunctionContexts & keyof GeneratedApi;');
  lines.push('export type GeneratedHandler<Name extends GeneratedFunctionName> = GeneratedApi[Name] extends FunctionReference<string, FunctionKind, infer Args, infer Result> ? Handler<GeneratedFunctionContexts[Name], Args, Result> : never;');
  lines.push('export declare const ephemeral: GeneratedEphemeral;');
  lines.push('export declare const groups: GeneratedQueryGroups;');
  // Derived default upload intents (LLP 0044 §Ceremony floor) project as
  // defaults.<table>.<field>; reference objects share the upload-reference
  // shape the client validates at runtime.
  lines.push('export interface GeneratedAssetUploadDefaults {');
  const defaultsByTable = new Map();
  for (const intent of assetUploadIntents) {
    if (!intent.name.startsWith('_assets.default.')) continue;
    const [tableName, fieldName] = intent.name.slice('_assets.default.'.length).split('.');
    if (!tableName || !fieldName) continue;
    if (!defaultsByTable.has(tableName)) defaultsByTable.set(tableName, []);
    defaultsByTable.get(tableName).push(`${fieldName}: ${uploadRefType(intent)}`);
  }
  for (const [tableName, members] of defaultsByTable) {
    lines.push(`  ${tableName}: { ${members.join('; ')} };`);
  }
  lines.push('}');
  lines.push('export declare const defaults: GeneratedAssetUploadDefaults;');
  if (authoringProfile === FAMILIAR_AUTHORING_PROFILE) {
    lines.push('export interface FamiliarGeneratedApi {');
    const tree = familiarNamespaceTree([
      ...functions.map(({ name }) => name),
      ...assetUploadIntents.map(({ name }) => name).filter(isOperationName),
    ]);
    for (const [moduleName, exportNames] of Object.entries(tree)
      .sort(([left], [right]) => compareCodeUnits(left, right))) {
      const members = [...exportNames]
        .sort(compareCodeUnits)
        .map((exportName) => `${JSON.stringify(exportName)}: GeneratedApi[${JSON.stringify(`${moduleName}.${exportName}`)}]`);
      lines.push(`  readonly ${JSON.stringify(moduleName)}: Readonly<{ ${members.join('; ')} }>;`);
    }
    lines.push('}');
    lines.push('export declare const api: FamiliarGeneratedApi;');
  } else {
    lines.push('export declare const api: GeneratedApi;');
  }
  const descriptorExports = standaloneIdentifierFunctions(functions)
    .map(({ name }) => name);
  lines.push(`export { app${descriptorExports.length > 0 ? `, ${descriptorExports.join(', ')}` : ''} } from './app';`);
  lines.push("export type { AppDescriptorV1, CapabilityRequirement, CommandDescriptor, GeneratedAppDescriptorV1, SurfaceDescriptor } from './app';");
  lines.push('export default api;');
  return lines.join('\n') + '\n';
}

function renderContractModules(contractManifest, functions, functionsModule, ephemeralCollections = [], schemaDef = null) {
  const modules = [
    {
      file: 'runtime-links.ts',
      source: renderContractRuntimeLinks(functions, functionsModule, ephemeralCollections, schemaDef),
    },
  ];

  // Ephemeral descriptor pair (ENG-22479; Exact LLP 0284 §2.5 / LLP 0034
  // §4): the read descriptor (`ephemeral` binding target) and the
  // mutation-shaped publish callable carrying the LLP 0281 budget facts.
  for (const collection of ephemeralCollections) {
    const def = schemaDef?.ephemeral?.collections?.[collection.name];
    const binding = contractManifest.queries[collection.name];
    modules.push({
      file: `${collection.name}.ephemeral.ts`,
      source: renderContractEphemeralModule(collection, def),
    });
    modules.push({
      file: `${collection.name}.ephemeral.contract-meta.ts`,
      source: renderContractEphemeralMeta(collection.name, binding, def),
    });
    modules.push({
      file: `${collection.name}.publish.ts`,
      source: renderContractPublishModule(collection, def),
    });
    modules.push({
      file: `${collection.name}.publish.contract-meta.ts`,
      source: renderContractPublishMeta(collection),
    });
  }

  for (const fn of functions) {
    if (fn.kind === 'Action') continue;
    if (fn.kind === 'Mutation') {
      const binding = contractManifest.mutations[fn.name];
      modules.push({
        file: `${fn.name}.mutation.ts`,
        source: renderContractBindingModule(fn, functionsModule[fn.name], 'mutation'),
      });
      modules.push({
        file: `${fn.name}.mutation.contract-meta.ts`,
        source: renderContractMutationMeta(fn.name, binding),
      });
    } else {
      const binding = contractManifest.queries[fn.name];
      modules.push({
        file: `${fn.name}.query.ts`,
        source: renderContractBindingModule(fn, functionsModule[fn.name], 'query'),
      });
      modules.push({
        file: `${fn.name}.query.contract-meta.ts`,
        source: renderContractQueryMeta(fn.name, binding),
      });
    }
  }

  return modules;
}

function renderContractRuntimeLinks(functions, functionsModule, ephemeralCollections = [], schemaDef = null) {
  const entries = [];
  for (const fn of functions) {
    if (fn.kind === 'Action') continue;
    const def = functionsModule[fn.name];
    entries.push({ name: fn.name, argsType: typeForArgs(def?.args ?? {}) });
  }
  for (const collection of ephemeralCollections) {
    const def = schemaDef?.ephemeral?.collections?.[collection.name];
    entries.push({ name: collection.name, argsType: typeForScope(def?.scope ?? {}) });
    entries.push({ name: `${collection.name}Publish`, argsType: publishArgsType(def) });
  }
  return renderRuntimeLinksModule({
    header: HEADER,
    refLine: '// @ref LLP 0021#phase-1-specify-contractdatamanifest - Contract runtime links are projected from Snapback generated artifacts.',
    linksBaseName: 'SnapbackContract',
    errorMessage: 'Snapback Contract links were used before the browser bridge was configured.',
    entries,
  });
}

function renderContractBindingModule(fn, def, kind) {
  return renderBindingModule({
    header: HEADER,
    refLine: '// @ref LLP 0021#phase-1-specify-contractdatamanifest - per-binding Contract modules import ordinary query/mutation symbols.',
    bindingComment: `// Contract ${kind} binding for ${fn.id}.`,
    name: fn.name,
    argsType: typeForArgs(def?.args ?? {}),
    linksBaseName: 'SnapbackContract',
  });
}

function renderContractQueryMeta(name, binding) {
  const reads = readTablesFromBinding(binding);
  const readMode = binding?.subscription === 'initial-snapshot' ? 'sync' : 'async';
  const cacheKey = reads[0] ?? name;
  const row = binding?.result?.row;
  // An untyped row (undeclared JS-handler result) is emitted as an honest
  // `unknown` result with no shape entry, never an empty object shape.
  const rowIsTyped = row?.shape === 'object';
  const rowType = `${pascal(name)}Row`;
  const resultType = binding?.result?.kind === 'list'
    ? (
        binding.result.minItems === 1 && binding.result.maxItems === 1
          ? (rowIsTyped ? `readonly [${rowType}]` : 'readonly [unknown]')
          : (rowIsTyped ? `${rowType}[]` : 'unknown[]')
      )
    : (rowIsTyped ? rowType : 'unknown');
  return renderQueryMetaModule({
    header: HEADER,
    name,
    reads,
    readMode,
    cacheKey,
    resultType,
    shapeName: rowIsTyped ? rowType : null,
    shapeFields: rowIsTyped ? contractShapeFields(row) : null,
    extraFacts: livenessFactsLiteral(binding),
  });
}

// Exact 0284 §2.4 liveness facts, emitted into the contract-meta descriptor
// entries under EXACTLY these names (ENG-22527 item 4): the exact-side
// ENG-22526 compiler reads them for compile-time info diagnostics. Restricted
// to exact's six ImportLivenessFacts fields (packages/exact-contract
// compiler/ir.ts) — delivery facts (maxDeltaRateHz/coalesce) ride the
// contract-data manifest and the ephemeral module exports, never the
// descriptor entry, so the sidecars typecheck against the exact surface.
function livenessFactsLiteral(binding) {
  const facts = {
    mode: binding?.mode,
    livePush: binding?.livePush,
    initialSnapshot: binding?.initialSnapshot,
    ephemeral: binding?.ephemeral ?? false,
  };
  if (binding?.pollCadenceMs !== undefined) facts.pollCadenceMs = binding.pollCadenceMs;
  if (binding?.transport !== undefined) facts.transport = binding.transport;
  return Object.entries(facts)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ');
}

function renderContractMutationMeta(name, binding) {
  const writes = binding?.writes ?? [];
  return renderMutationMetaModule({
    header: HEADER,
    name,
    effects: writes.map((table) => `${table}.write`),
    invalidates: binding?.invalidates ?? writes,
  });
}

function renderContractEphemeralModule(collection, def) {
  const scopeType = typeForScope(def?.scope ?? {});
  const valueType = typeForValidator(def?.value);
  const pascalName = pascal(collection.name);
  return [
    HEADER,
    `// Ephemeral read descriptor for ${collection.name} (ENG-22479; Exact LLP 0284 §2.5):`,
    '// the `ephemeral` binding target. Entries are the typed presence map;',
    '// delivery facts ride the contract-data manifest (maxDeltaRateHz/coalesce).',
    '',
    "import { getSnapbackContractLinks } from './runtime-links';",
    '',
    `export const descriptor = '${collection.name}';`,
    `export const ephemeral = true;`,
    `export const keyMode = '${collection.keyMode}';`,
    `export const scopeFields = ${jsonLiteral(collection.scopeFields)};`,
    `export const defaultTtlMs = ${collection.defaultTtlMs};`,
    `export const maxTtlMs = ${collection.maxTtlMs};`,
    `export const withdrawalVisibilityDeadlineMs = ${collection.withdrawalVisibilityDeadlineMs};`,
    `export const maxDeltaRateHz = ${Math.round(1_000 / collection.dispatchMs)};`,
    `export const coalesce = true;`,
    `export type ${pascalName}Scope = ${scopeType};`,
    `export type ${pascalName}Value = ${valueType};`,
    '',
    `export function ${collection.name}(args: ${pascalName}Scope) {`,
    `  return getSnapbackContractLinks().${collection.name}(args);`,
    '}',
    '',
  ].join('\n');
}

function renderContractEphemeralMeta(name, binding, def) {
  const pascalName = pascal(name);
  // The REAL value shape from the collection's value schema (ENG-22527 item
  // 2): member reads through `c.value.<field>` get shape_unknown_member
  // exactly like durable rows, via the named-shape reference chain
  // Entry.value -> <Pascal>Value. Optionality carries over.
  const valueFields = shapeFieldsFromValidator(def?.value);
  const entryFields = {
    key: 'string',
    value: valueFields ? `${pascalName}Value` : 'unknown',
    updatedAt: 'number',
    expiresAt: { type: 'number', optional: true },
    sourceClientId: 'string',
    self: 'boolean',
  };
  const lines = [
    HEADER,
    "import { defineContractModule, shape } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.ephemeral.ts', {`,
    `  ${name}: { kind: 'ephemeral', reads: ${jsonLiteral([name])}, result: '${pascalName}Entry[]', ${livenessFactsLiteral(binding)} },`,
    `  ${pascalName}Entry: shape({ fields: ${jsonLiteral(entryFields)} }),`,
  ];
  if (valueFields) {
    lines.push(`  ${pascalName}Value: shape({ fields: ${jsonLiteral(valueFields)} }),`);
  }
  lines.push('});', '');
  return lines.join('\n');
}

// A value-schema validator's object fields as shape() field descriptors,
// carrying optionality (`{ type, optional }`); non-object validators yield
// null (the entry's value falls back to 'unknown').
function shapeFieldsFromValidator(validator) {
  if (!validator || validator.primitive !== 'object') return null;
  const fields = dict();
  for (const [name, field] of Object.entries(validator.fields ?? {})) {
    const type = { string: 'string', number: 'number', boolean: 'boolean' }[field.primitive] ?? 'unknown';
    fields[name] = field.optional ? { type, optional: true } : type;
  }
  return fields;
}

function renderContractPublishModule(collection, def) {
  const pascalName = pascal(collection.name);
  return [
    HEADER,
    `// Publish descriptor for ${collection.name} (ENG-22479; LLP 0034 §4): the`,
    '// budget facts Exact LLP 0281 rated `publish` compiles against. The',
    '// sidecar declares the publish descriptor KIND (ENG-22525 shape:',
    '// `publish({ effects, budget })`); a channel publishes through this',
    '// at a declared rate the analyzer checks against sustainedHz.',
    '',
    "import { getSnapbackContractLinks } from './runtime-links';",
    '',
    `export const descriptor = '${collection.name}';`,
    `export const sustainedHz = ${collection.sustainedHz};`,
    `export const burst = ${collection.burst};`,
    `export const maxValueBytes = ${collection.maxValueBytes};`,
    `export const hardMaxValueBytes = ${collection.hardMaxValueBytes};`,
    `export type ${pascalName}PublishArgs = ${publishArgsType(def)};`,
    '',
    `export function ${collection.name}Publish(args: ${pascalName}PublishArgs) {`,
    `  return getSnapbackContractLinks().${collection.name}Publish(args);`,
    '}',
    '',
  ].join('\n');
}

function renderContractPublishMeta(collection) {
  const name = collection.name;
  // `budget` is the descriptor fact Exact LLP 0281 stage 0's rated
  // `publish` compiles against: the analyzer rejects a channel that
  // declares rate above sustainedHz (channel_rate_exceeds_budget). The
  // descriptor-kind migration (ENG-22525): `publish({ effects, budget })`,
  // no longer mutation-shaped.
  const budget = {
    sustainedHz: collection.sustainedHz,
    burst: collection.burst,
    maxValueBytes: collection.maxValueBytes,
  };
  return [
    HEADER,
    "import { defineContractModule, publish } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.publish.ts', {`,
    `  ${name}Publish: publish({ effects: ${jsonLiteral([`ephemeral:${name}`])}, budget: ${jsonLiteral(budget)} }),`,
    '});',
    '',
  ].join('\n');
}

function publishArgsType(def) {
  const scope = Object.entries(def?.scope ?? {})
    .map(([name, val]) => `${name}: ${typeForValidator(val)}`)
    .join('; ');
  const valueType = typeForValidator(def?.value);
  return `{ ${scope}${scope ? '; ' : ''}value: ${valueType}; ttlMs?: number }`;
}

function validatorRowDescriptor(validator) {
  if (!validator || validator.primitive !== 'object') return null;
  const fields = dict();
  for (const [name, field] of Object.entries(validator.fields ?? {})) {
    const descriptor = { shape: 'primitive', name: { string: 'string', number: 'number', boolean: 'boolean' }[field.primitive] ?? 'unknown' };
    if (field.optional) descriptor.optional = true;
    fields[name] = descriptor;
  }
  return { shape: 'object', fields };
}

function readTablesFromBinding(binding) {
  return binding?.reads ?? [];
}

function contractShapeFields(row) {
  if (!row || row.shape !== 'object' || !row.fields) return {};
  const out = dict();
  for (const [name, descriptor] of Object.entries(row.fields)) {
    out[name] = contractShapeField(descriptor);
  }
  return out;
}

function contractShapeField(descriptor) {
  const type = contractShapeType(descriptor);
  return descriptor?.optional ? { type, optional: true } : type;
}

// Contract's descriptor stores a source type string. Its current analyzer
// understands only a subset of these recursively precise spellings, but an
// opaque exact spelling is safe while "unknown" would discard the generated
// result-contract fact entirely.
// @ref LLP 0108#generated-references-and-consumers — every generated consumer
// carries the same result shape without re-inferring handler behavior.
function contractShapeType(descriptor) {
  if (!descriptor || descriptor.shape === 'unknown') return 'unknown';
  if (descriptor.shape === 'primitive') return descriptor.name ?? 'unknown';
  if (descriptor.shape === 'literal') return JSON.stringify(descriptor.value);
  if (descriptor.shape === 'array') {
    const item = contractShapeType(descriptor.items);
    const array = descriptor.items?.shape === 'union' ? `(${item})[]` : `${item}[]`;
    return descriptor.minItems !== undefined && descriptor.minItems === descriptor.maxItems
      ? `${array} & { readonly length: ${descriptor.maxItems} }`
      : array;
  }
  if (descriptor.shape === 'union') {
    return descriptor.variants.map(contractShapeType).join(' | ');
  }
  if (descriptor.shape === 'object') {
    return `{ ${Object.entries(descriptor.fields ?? {}).map(([name, field]) => (
      `${JSON.stringify(name)}${field?.optional ? '?' : ''}: ${contractShapeType(field)}`
    )).join('; ')} }`;
  }
  return 'unknown';
}

function typeForArgs(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => typeProperty(name, val)).join('; ')} }`;
}

function typeForGeneratedArgs(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => `${name}${val?.optional ? '?' : ''}: ${typeForGeneratedValidator(val).replace(/ \| undefined$/, '')}`).join('; ')} }`;
}

function typeForQueryGroupTemplate(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `readonly [${value.map(typeForQueryGroupTemplate).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const fields = Object.keys(value)
      .sort()
      .map((name) => `readonly ${JSON.stringify(name)}: ${typeForQueryGroupTemplate(value[name])}`);
    return fields.length === 0
      ? 'Readonly<Record<string, never>>'
      : `{ ${fields.join('; ')} }`;
  }
  return 'never';
}

function typeForGeneratedValidator(val) {
  if (!val || !val.__validator) return 'unknown';
  let type;
  const idTable = idFieldTypeTable(val.fieldType);
  if (val.primitive === 'platformSchemaRef') {
    // api.d.ts declares the derived SearchQueryAstV1 type (renderApiTypes).
    type = 'SearchQueryAstV1';
  } else if (val.resultKind === 'null') type = 'null';
  else if (val.resultKind === 'literal') type = JSON.stringify(val.literal);
  else if (val.resultKind === 'vector') {
    type = `ReadonlyArray<number> & { readonly length: ${val.dimensions} }`;
  }
  else if (val.resultKind === 'array') {
    const element = typeForGeneratedValidator(val.element).replace(/ \| undefined$/, '');
    type = `ReadonlyArray<${element}>`;
  } else if (val.resultKind === 'union') {
    type = (val.variants ?? [])
      .map((variant) => typeForGeneratedValidator(variant).replace(/ \| undefined$/, ''))
      .join(' | ');
  } else if (val.fieldType === 'Principal') type = 'Principal';
  else if (idTable !== null) type = `Id<'${idTable}'>`;
  else type = { string: 'string', boolean: 'boolean', number: 'number', unknown: 'unknown' }[val.primitive] ?? 'unknown';
  if (val.primitive === 'object') {
    const fields = Object.entries(val.fields ?? {});
    type = fields.length === 0
      ? 'Record<string, never>'
      : `{ ${fields.map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${typeForGeneratedValidator(field).replace(/ \| undefined$/, '')}`).join('; ')} }`;
  }
  return val.optional ? `${type} | undefined` : type;
}

function typeForScope(scope) {
  const entries = Object.entries(scope);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => typeProperty(name, val)).join('; ')} }`;
}

function typeProperty(name, val) {
  return `${name}${val?.optional ? '?' : ''}: ${typeForValidator(val).replace(/ \| undefined$/, '')}`;
}

function typeForValidator(val) {
  if (!val || !val.__validator) return 'unknown';
  let type = { string: 'string', boolean: 'boolean', number: 'number', unknown: 'unknown' }[val.primitive] ?? 'unknown';
  if (val.primitive === 'platformSchemaRef') {
    // Contract runtime-links/binding modules have no named search types in
    // scope; the reference projects as its fully inlined structural
    // expansion derived from the exported schema.
    type = searchAstEmission().queryTypeInline;
  } else if (val.resultKind === 'null') type = 'null';
  else if (val.resultKind === 'literal') type = JSON.stringify(val.literal);
  else if (val.resultKind === 'vector') {
    type = `ReadonlyArray<number> & { readonly length: ${val.dimensions} }`;
  }
  else if (val.resultKind === 'array') {
    type = `ReadonlyArray<${typeForValidator(val.element).replace(/ \| undefined$/, '')}>`;
  } else if (val.resultKind === 'union') {
    type = (val.variants ?? [])
      .map((variant) => typeForValidator(variant).replace(/ \| undefined$/, ''))
      .join(' | ');
  } else if (val.primitive === 'object') {
    const fields = Object.entries(val.fields ?? {});
    type = fields.length === 0
      ? 'Record<string, never>'
      : `{ ${fields.map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${typeForValidator(field).replace(/ \| undefined$/, '')}`).join('; ')} }`;
  }
  return val.optional ? `${type} | undefined` : type;
}

function inferAppId(backendDir) {
  return resolve(backendDir).split(/[\\/]/).slice(-2, -1)[0] || 'local-app';
}

function nearestDemoManifest(backendDir) {
  let directory = dirname(resolve(backendDir));
  while (true) {
    const candidate = join(directory, 'demo.snapback.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

// The manifest id participates in stable function ids and unescaped schema
// URI path segments. Keep it a portable, case-stable slug rather than asking
// every downstream consumer to invent its own escaping or normalization rule.
const PORTABLE_DEMO_APP_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

function readDemoAppMetadata(backendDir, diagnostics) {
  const demoManifestPath = nearestDemoManifest(backendDir);
  if (demoManifestPath === null) return { source: null, identity: null, appId: null };
  let source;
  let sourceBytes;
  try {
    sourceBytes = resolveFileReadCapability(demoManifestPath, {
      allowedRoots: [dirname(demoManifestPath)],
      allowSymlink: false,
      codePrefix: 'DEMO_MANIFEST',
    }).read();
    source = decodeUtf8Source(sourceBytes, demoManifestPath, 'DEMO_MANIFEST');
  } catch (cause) {
    diagnostics.push({
      code: 'DEMO_MANIFEST_READ_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: `demo manifest ${demoManifestPath} could not be read: ${cause.message}`,
      path: demoManifestPath,
    });
    return { source: null, identity: null, appId: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (cause) {
    diagnostics.push({
      code: 'DEMO_MANIFEST_INVALID_JSON',
      severity: 'error',
      subsystem: 'codegen',
      message: `demo manifest ${demoManifestPath} is not valid JSON: ${cause.message}`,
      path: demoManifestPath,
    });
    return { source: sourceBytes, identity: null, appId: null };
  }
  let appId = null;
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || !Object.hasOwn(manifest, 'id')
    || typeof manifest.id !== 'string'
    || !PORTABLE_DEMO_APP_ID.test(manifest.id)
  ) {
    diagnostics.push({
      code: 'DEMO_MANIFEST_APP_ID_INVALID',
      severity: 'error',
      subsystem: 'codegen',
      message: `demo manifest ${demoManifestPath} must declare id as a 1-64 character lowercase ASCII slug that begins and ends with a letter or digit and otherwise contains only letters, digits, or hyphens`,
      path: demoManifestPath,
    });
  } else {
    appId = manifest.id;
  }
  const app = manifest?.app && typeof manifest.app === 'object' ? manifest.app : {};
  const identity = cleanObject({
    name: readString(app.name) ?? readString(manifest?.title),
    description: readString(app.description) ?? readString(manifest?.description),
    iconUrl: readString(app.iconUrl) ?? readString(app.icon_url) ?? readString(manifest?.iconUrl) ?? readString(manifest?.icon_url),
    wordmarkUrl: readString(app.wordmarkUrl) ?? readString(app.wordmark_url) ?? readString(manifest?.wordmarkUrl) ?? readString(manifest?.wordmark_url),
  });
  if (identity.name === appId) delete identity.name;
  return {
    source: sourceBytes,
    identity: Object.keys(identity).length === 0 ? null : identity,
    appId,
  };
}

const FAMILIAR_CONSTRUCTORS = new Set(['query', 'mutation', 'action', 'defineAssetUpload']);
const FAMILIAR_ENTRYPOINTS = new Set([
  '@expo/snapback/server',
  '@expo/snapback-codegen/familiar',
]);

function readDefinitionSource(path, backendRoot, codePrefix = 'FUNCTION_SOURCE') {
  const capability = resolveFileReadCapability(path, {
    allowedRoots: [backendRoot],
    codePrefix,
  });
  return decodeUtf8Source(capability.read(), path, codePrefix);
}

function sourceFileForDefinition(path, source) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    true,
    /\.mts$/iu.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.TS,
  );
}

function staticImportSpecifiers(source, path) {
  const sourceFile = sourceFileForDefinition(path, source);
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .filter((statement) => ts.isStringLiteral(statement.moduleSpecifier))
    .map((statement) => statement.moduleSpecifier.text);
}

function familiarModuleClassification(path, source) {
  const sourceFile = sourceFileForDefinition(path, source);
  const constructorLocals = new Set();
  const constructorKinds = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !(FAMILIAR_ENTRYPOINTS.has(statement.moduleSpecifier.text)
        || /(?:^|\/)familiar\.(?:mjs|js|mts|ts)$/u.test(statement.moduleSpecifier.text)
        || /(?:^|\/)generated\/server(?:\.(?:mjs|js|mts|ts))?$/u.test(statement.moduleSpecifier.text))) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (FAMILIAR_CONSTRUCTORS.has(imported)) {
        constructorLocals.add(specifier.name.text);
        constructorKinds.set(specifier.name.text, imported);
      }
    }
  }
  const declared = new Map();
  const directExports = new Map();
  const exported = new Map();
  let hasDefaultExport = false;
  const hasExportModifier = (node) => ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const call = declaration.initializer;
        const constructor = ts.isCallExpression(call) && ts.isIdentifier(call.expression)
          && constructorLocals.has(call.expression.text)
          ? call.expression.text
          : null;
        declared.set(declaration.name.text, constructor);
        if (hasExportModifier(statement)) {
          directExports.set(declaration.name.text, declaration.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name && hasExportModifier(statement)) {
        directExports.set(statement.name.text, statement.name.text);
      }
    } else if (ts.isExportAssignment(statement)) {
      hasDefaultExport = true;
    }
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause && !statement.isTypeOnly) {
        exported.set('*', { local: '*', constructor: null });
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          if (statement.isTypeOnly || specifier.isTypeOnly) continue;
          const local = specifier.propertyName?.text ?? specifier.name.text;
          exported.set(specifier.name.text, { local, constructor: declared.get(local) ?? null });
        }
      }
    }
  }
  for (const [name, local] of directExports) {
    exported.set(name, { local, constructor: declared.get(local) ?? null });
  }
  const operations = [...exported.entries()]
    .filter(([, entry]) => entry.constructor !== null)
    .map(([exportedName, entry]) => ({
      exportedName,
      localName: entry.local,
      constructorLocal: entry.constructor,
      constructorKind: constructorKinds.get(entry.constructor),
    }));
  const unsupportedExports = operations.length === 0
    ? []
    : [
        ...[...exported.entries()]
          .filter(([, entry]) => entry.constructor === null)
          .map(([name]) => name),
        ...(hasDefaultExport ? ['default'] : []),
      ];
  return { operations, unsupportedExports, sourceFile };
}

function nestedTypeScriptFiles(root) {
  const output = [];
  const visit = (directory, topLevel = false) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_generated' || entry.name === 'generated' || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, false);
      else if (!topLevel && /\.(?:ts|mts)$/iu.test(entry.name)) output.push(path);
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '_generated' || entry.name === 'generated' || entry.name === 'node_modules') continue;
    visit(join(root, entry.name), false);
  }
  return output;
}

function familiarTypeScriptFiles(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_generated' || entry.name === 'generated' || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|mts)$/iu.test(entry.name)) output.push(path);
    }
  };
  visit(root);
  return output.sort(compareCodeUnits);
}

function discoverAuthoringSources(backendRoot, authoringProfile, err) {
  if (authoringProfile === EXPLICIT_AUTHORING_PROFILE) {
    const schemaTs = join(backendRoot, 'schema.ts');
    if (existsSync(schemaTs)) {
      err(
        'SNAPBACK_CODEGEN_EXPLICIT_FAMILIAR_SOURCE_PRESENT',
        'codegen',
        'explicit authoring found schema.ts; remove familiar sources or select snapback-familiar-ts-v1',
        { path: schemaTs },
      );
    }
    for (const entry of readdirSync(backendRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:mjs|js|ts|mts)$/iu.test(entry.name)) continue;
      const path = join(backendRoot, entry.name);
      let source;
      try { source = readDefinitionSource(path, backendRoot); } catch { continue; }
      const specifier = staticImportSpecifiers(source, path)
        .find((candidate) => FAMILIAR_ENTRYPOINTS.has(candidate));
      if (specifier) {
        err(
          'SNAPBACK_CODEGEN_EXPLICIT_FAMILIAR_SOURCE_PRESENT',
          'codegen',
          `explicit authoring module ${entry.name} imports familiar entrypoint ${specifier}`,
          { path, specifier },
        );
      }
    }
    return {
      schemaPath: join(backendRoot, 'schema.mjs'),
      functionsPath: join(backendRoot, 'functions.mjs'),
      operations: [],
      functionModules: [],
    };
  }

  for (const path of familiarTypeScriptFiles(backendRoot)) {
    let source;
    try { source = readDefinitionSource(path, backendRoot); } catch { continue; }
    for (const specifier of staticImportSpecifiers(source, path)) {
      if (!/(?:^|\/)_generated\/(?:server|api)(?:\.(?:mjs|js|mts|ts))?$/u.test(specifier)) continue;
      err(
        'SNAPBACK_CODEGEN_LEGACY_GENERATED_IMPORT',
        'codegen',
        `${relative(backendRoot, path)} imports retired path ${specifier}; use ${specifier.replace('_generated/', 'generated/')} and keep no _generated symlink`,
        {
          path,
          specifier,
          canonicalSpecifier: specifier.replace('_generated/', 'generated/'),
        },
      );
    }
  }

  for (const name of ['schema.mjs', 'functions.mjs', 'routes.mjs']) {
    const path = join(backendRoot, name);
    if (existsSync(path)) {
      err(
        'SNAPBACK_CODEGEN_FAMILIAR_EXPLICIT_SOURCE_PRESENT',
        'codegen',
        `familiar authoring cannot coexist with explicit entry module ${name}`,
        { path },
      );
    }
  }
  for (const name of ['crons.ts', 'crons.mts', 'http.ts', 'http.mts']) {
    const path = join(backendRoot, name);
    if (existsSync(path)) {
      err(
        'SNAPBACK_CODEGEN_FAMILIAR_RESERVED_MODULE_UNSUPPORTED',
        'codegen',
        `${name} is reserved but unsupported in snapback-familiar-ts-v1; use defineCron/defineRoutes in the explicit profile`,
        { path },
      );
    }
  }
  const schemaPath = join(backendRoot, 'schema.ts');
  if (!existsSync(schemaPath)) {
    err('SCHEMA_SOURCE_MISSING', 'schema', `${schemaPath} is required by snapback-familiar-ts-v1`, { path: schemaPath });
  }
  for (const path of nestedTypeScriptFiles(backendRoot)) {
    let source;
    try { source = readDefinitionSource(path, backendRoot); } catch { continue; }
    if (familiarModuleClassification(path, source).operations.length > 0) {
      err(
        'SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED',
        'function',
        `familiar function exports must be top-level; ${relative(backendRoot, path)} is nested`,
        { path },
      );
    }
  }
  const functionModules = [];
  const operations = [];
  for (const entry of readdirSync(backendRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ts|mts)$/iu.test(entry.name) || entry.name === 'schema.ts') continue;
    if (/^(?:crons|http)\.(?:ts|mts)$/iu.test(entry.name)) continue;
    const path = join(backendRoot, entry.name);
    let source;
    try {
      source = readDefinitionSource(path, backendRoot);
    } catch (error) {
      err(error.codegenCode ?? 'FUNCTION_SOURCE_MISSING', 'function', error.message, { path });
      continue;
    }
    const classified = familiarModuleClassification(path, source);
    if (classified.operations.length === 0) continue;
    if (classified.unsupportedExports.length > 0) {
      err(
        'SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED',
        'function',
        `${entry.name} mixes familiar functions with unsupported runtime exports: ${classified.unsupportedExports.join(', ')}`,
        { path, exports: classified.unsupportedExports },
      );
      continue;
    }
    const moduleName = entry.name.replace(/\.(?:ts|mts)$/iu, '');
    for (const operation of classified.operations) {
      const name = `${moduleName}.${operation.exportedName}`;
      if (!isOperationName(name)) {
        err(
          'SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED',
          'function',
          `${entry.name} export ${operation.exportedName} cannot form one IDENT.IDENT operation name`,
          { path, function: name },
        );
        continue;
      }
      operations.push({ ...operation, name, moduleName, path });
    }
    functionModules.push({ path, source, moduleName, operations: classified.operations });
  }
  const generatedNames = new Map();
  for (const operation of operations) {
    const local = pascal(operation.name);
    const prior = generatedNames.get(local);
    if (prior && prior !== operation.name) {
      err(
        'SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION',
        'function',
        `operation names ${JSON.stringify(prior)} and ${JSON.stringify(operation.name)} both generate local binding ${local}`,
        { functions: [prior, operation.name], generatedBinding: local },
      );
    } else {
      generatedNames.set(local, operation.name);
    }
  }
  const functionsPath = join(backendRoot, '__snapback_familiar_functions__.mjs');
  const functionsSource = operations
    .sort((left, right) => compareCodeUnits(left.name, right.name))
    .map((operation) => {
      const specifier = `./${relative(backendRoot, operation.path).split(sep).join('/')}`;
      return `export { ${operation.exportedName} as ${JSON.stringify(operation.name)} } from ${JSON.stringify(specifier)};`;
    })
    .join('\n') + '\n';
  return { schemaPath, functionsPath, functionsSource, operations, functionModules };
}

function renderFamiliarServerModule() {
  // @ref LLP 0253#s32-generated-local-modules — this bootstrap cannot depend
  // on Phase C's umbrella package; every runtime value comes from the Phase B
  // adapter that codegen already owns.
  return `${HEADER}\nexport { defineSchema, defineTable, defineAssetUpload, defineEphemeral, ephemeral, query, mutation, action, allow, membershipResource, v } from '@expo/snapback-codegen/familiar';\n`;
}

function renderFamiliarServerTypes() {
  return `${HEADER}
import { v as familiarV } from '@expo/snapback-codegen/familiar';
import type { InferObjectValidatorFields, InferValidator, MembershipPredicate, Validator } from '@expo/snapback-codegen/define';
import type { FunctionArgs, FunctionReference, FunctionResult, GeneratedActionContext, GeneratedDataModel, GeneratedHandlerSchema, GeneratedIndexNames, GeneratedMutationContext, GeneratedQueryContext, GeneratedReadableTableName, Id, QueryBuilder } from './api';
export { allow, defineAssetUpload, defineEphemeral, defineSchema, defineTable, ephemeral, membershipResource } from '@expo/snapback-codegen/familiar';
export declare const v: Omit<typeof familiarV, 'doc' | 'id'> & {
  doc<const Table extends keyof GeneratedDataModel & string>(table: Table): Validator<GeneratedDataModel[Table], { readonly AppSchemaRef: { readonly authority: 'app'; readonly table: Table } }, false>;
  id<const Table extends keyof GeneratedDataModel & string>(table: Table): Validator<Id<Table>, { readonly Id: { readonly table: Table } }, false>;
};
type FamiliarAuth = 'public' | 'optional-user' | 'authenticated';
type FamiliarIndexRange<Table extends GeneratedReadableTableName> = Readonly<{
  eq<Field extends keyof GeneratedDataModel[Table] & string>(field: Field, value: GeneratedDataModel[Table][Field]): FamiliarIndexRange<Table>;
  in<Field extends keyof GeneratedDataModel[Table] & string>(field: Field, values: ReadonlyArray<GeneratedDataModel[Table][Field]>): FamiliarIndexRange<Table>;
  lt<Field extends keyof GeneratedDataModel[Table] & string>(field: Field, value: GeneratedDataModel[Table][Field]): FamiliarIndexRange<Table>;
  lte<Field extends keyof GeneratedDataModel[Table] & string>(field: Field, value: GeneratedDataModel[Table][Field]): FamiliarIndexRange<Table>;
  gt<Field extends keyof GeneratedDataModel[Table] & string>(field: Field, value: GeneratedDataModel[Table][Field]): FamiliarIndexRange<Table>;
  gte<Field extends keyof GeneratedDataModel[Table] & string>(field: Field, value: GeneratedDataModel[Table][Field]): FamiliarIndexRange<Table>;
}>;
type FamiliarQueryBuilder<Table extends GeneratedReadableTableName> = Omit<QueryBuilder<GeneratedHandlerSchema, Table>, 'withIndex'> & Readonly<{
  withIndex(index: GeneratedIndexNames[Table], callback?: (q: FamiliarIndexRange<Table>) => FamiliarIndexRange<Table>): FamiliarQueryBuilder<Table>;
}>;
type FamiliarQueryDatabase = Omit<GeneratedQueryContext['db'], 'query'> & Readonly<{
  query<Table extends GeneratedReadableTableName>(table: Table): FamiliarQueryBuilder<Table>;
}>;
type FamiliarMutationDatabase = Omit<GeneratedMutationContext['db'], 'query'> & Readonly<{
  query<Table extends GeneratedReadableTableName>(table: Table): FamiliarQueryBuilder<Table>;
}>;
export type FamiliarQueryContext = Omit<GeneratedQueryContext, 'db'> & Readonly<{ db: FamiliarQueryDatabase }>;
export type FamiliarMutationContext = Omit<GeneratedMutationContext, 'db'> & Readonly<{ db: FamiliarMutationDatabase }>;
type FamiliarCommon<Args extends Record<string, Validator>, Returns extends Validator, Context> = Readonly<{
  args: Args;
  returns: Returns;
  auth: FamiliarAuth;
  handler: (ctx: Context, args: InferObjectValidatorFields<Args>) => InferValidator<Returns> | Promise<InferValidator<Returns>>;
  refusals?: readonly string[];
  trackedRefusals?: readonly string[];
}>;
export type FamiliarActionContext = Readonly<Pick<GeneratedActionContext, 'auth' | 'runtime' | 'secrets' | 'refuse' | 'isDirectHuman'> & {
  runMutation<Ref extends FunctionReference<string, 'Mutation', any, any, 'snapback-familiar-ts-v1'>>(reference: Ref, args: FunctionArgs<Ref>): Promise<FunctionResult<Ref>>;
  runQuery(...args: never[]): never;
  fetch(...args: never[]): never;
  fetchStream(...args: never[]): never;
}>;
export declare function query<const Args extends Record<string, Validator>, Returns extends Validator>(spec: FamiliarCommon<Args, Returns, FamiliarQueryContext> & Readonly<{ reads: readonly string[]; delivery?: 'live' | 'read'; retainable?: boolean; authScopeField?: string; membership?: readonly MembershipPredicate[] }>): unknown;
export declare function mutation<const Args extends Record<string, Validator>, Returns extends Validator>(spec: FamiliarCommon<Args, Returns, FamiliarMutationContext> & Readonly<{ reads: readonly string[]; writes: readonly string[]; membership?: readonly MembershipPredicate[] }>): unknown;
export declare function action<const Args extends Record<string, Validator>, Returns extends Validator>(spec: FamiliarCommon<Args, Returns, FamiliarActionContext> & Readonly<{ secrets?: readonly string[] }>): unknown;
`;
}

function familiarNamespaceTree(operationNames) {
  const root = dict();
  for (const name of operationNames) {
    const [moduleName, exportName] = name.split('.');
    (root[moduleName] ??= []).push(exportName);
  }
  return root;
}

function renderFamiliarApiNamespaceModule(
  operationNames,
  actionReferences,
  defaultAssetNames,
  appBindingIdentity,
) {
  const tree = familiarNamespaceTree(operationNames);
  const appSpecifier = contentAddressedModuleSpecifier('./app.binding.mjs', appBindingIdentity);
  const lines = [
    HEADER,
    `import { app, artifacts } from ${JSON.stringify(appSpecifier)};`,
    `export { app, artifacts } from ${JSON.stringify(appSpecifier)};`,
    "const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };",
    'export const ephemeral = app.api.ephemeral;',
    'export const groups = app.api.queryGroups;',
    'export const defaults = Object.create(null);',
  ];
  for (const [tableName, fields] of Object.entries(defaultAssetNames)) {
    lines.push(`defaults[${JSON.stringify(tableName)}] = Object.create(null);`);
    for (const [fieldName, assetName] of Object.entries(fields)) {
      lines.push(`defaults[${JSON.stringify(tableName)}][${JSON.stringify(fieldName)}] = app.api.assets[${JSON.stringify(assetName)}];`);
    }
  }
  lines.push(
    'deepFreeze(defaults);',
    `const actionReferences = ${stableJson(actionReferences)};`,
    "for (const reference of Object.values(actionReferences)) { reference.authoringProfile = app.authoringProfile; reference.retention ??= 'none'; Object.defineProperty(reference, 'artifacts', { value: artifacts, enumerable: false }); }",
    'const references = deepFreeze({ ...app.api.assets, ...app.api.queries, ...app.api.mutations, ...actionReferences, ephemeral, groups });',
    'const root = Object.create(null);',
  );
  for (const [moduleName, exports] of Object.entries(tree).sort(([a], [b]) => compareCodeUnits(a, b))) {
    lines.push(`root[${JSON.stringify(moduleName)}] = Object.create(null);`);
    for (const exportName of [...exports].sort(compareCodeUnits)) {
      const operationName = `${moduleName}.${exportName}`;
      lines.push(`root[${JSON.stringify(moduleName)}][${JSON.stringify(exportName)}] = references[${JSON.stringify(operationName)}];`);
    }
    lines.push(`Object.freeze(root[${JSON.stringify(moduleName)}]);`);
  }
  lines.push('export const api = Object.freeze(root);', 'export default api;', '');
  return lines.join('\n');
}

function renderFamiliarApiBootstrapModule(operationNames) {
  const tree = familiarNamespaceTree(operationNames);
  const lines = [HEADER, '// Familiar definition bootstrap; replaced by the transactional final projection.', 'const root = Object.create(null);'];
  for (const [moduleName, exports] of Object.entries(tree).sort(([a], [b]) => compareCodeUnits(a, b))) {
    lines.push(`root[${JSON.stringify(moduleName)}] = Object.create(null);`);
    for (const exportName of [...exports].sort(compareCodeUnits)) {
      lines.push(`root[${JSON.stringify(moduleName)}][${JSON.stringify(exportName)}] = Object.freeze(Object.create(null));`);
    }
    lines.push(`Object.freeze(root[${JSON.stringify(moduleName)}]);`);
  }
  lines.push('export const api = Object.freeze(root);', 'export default api;', '');
  return lines.join('\n');
}

function synthesizeFamiliarBootstrap(backendRoot, operationNames) {
  const directory = join(backendRoot, 'generated');
  mkdirSync(directory, { recursive: true });
  const files = new Map([
    ['server.mjs', renderFamiliarServerModule()],
    ['server.d.ts', renderFamiliarServerTypes()],
    // @ref LLP 0253#s2-familiar-source-layout-and-discovery — definition
    // evaluation gets a deterministic, capability-empty bootstrap graph. The
    // final app-bound namespace cannot exist until definitions have evaluated.
    ['api.mjs', renderFamiliarApiBootstrapModule(operationNames)],
    ['api.d.ts', renderFamiliarApiBootstrapTypes()], ['api.d.mts', renderFamiliarApiBootstrapTypes()],
  ]);
  for (const [name, source] of files) {
    const path = join(directory, name);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const apiProjection = name === 'api.mjs' || name === 'api.d.ts' || name === 'api.d.mts';
    // A previously completed api projection is already a valid definition
    // import. Do not replace it with bootstrap bytes before the transactional
    // write: a later source refusal must preserve the prior complete graph.
    if (apiProjection
      && current !== null
      && !current.includes('Familiar definition bootstrap;')) continue;
    if (current !== source) writeFileSync(path, source);
  }
  return {
    apiSource: files.get('api.mjs'),
    apiDigest: `sha256:${sha256(files.get('api.mjs'))}`,
  };
}

function eraseFamiliarDefinitionSource(source, sourcePath, diagnostics) {
  const transformed = ts.transpileModule(source, {
    compilerOptions: handlerTypeScriptCompilerOptions({ emit: true }),
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (transformed.diagnostics ?? [])
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    for (const entry of errors) {
      const point = Number.isInteger(entry.start) && entry.file
        ? entry.file.getLineAndCharacterOfPosition(entry.start)
        : { line: 0, character: 0 };
      diagnostics.push({
        code: 'SNAPBACK_CODEGEN_TYPESCRIPT_TRANSFORM_FAILED',
        severity: 'error',
        subsystem: 'codegen',
        message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
        path: sourcePath,
        line: point.line + 1,
        column: point.character + 1,
        details: { typescriptCode: entry.code },
      });
    }
    return null;
  }
  const javascript = transformed.outputText
    .replace(/\/\/# sourceMappingURL=.*?(?:\r?\n)?$/u, '');
  let sourceMap = null;
  try {
    sourceMap = typeof transformed.sourceMapText === 'string'
      ? JSON.parse(transformed.sourceMapText) : null;
  } catch {
    sourceMap = null;
  }
  return {
    javascript,
    sourceMap,
    identity: handlerTypeScriptIdentity(),
    runtimeBytes: Buffer.from(javascript, 'utf8'),
  };
}

async function bundleFamiliarHandlerHelpers({
  backendRoot,
  modulePath,
  source,
  entrySource,
  sourceOverrides,
  diagnostics,
}) {
  const relativeImports = staticImportSpecifiers(source, modulePath).filter(
    (specifier) => isLocalModuleSpecifier(specifier)
      && !/(?:^|\/)generated\/(?:server|api)(?:\.(?:mjs|js|mts|ts))?$/u.test(specifier),
  );
  if (relativeImports.length === 0) return null;
  const withinBackend = (candidate) => {
    const rel = relative(resolve(backendRoot), resolve(candidate));
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  const helperSources = [];
  try {
    const result = await esbuild({
      absWorkingDir: backendRoot,
      entryPoints: [modulePath],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: ['es2022'],
      treeShaking: false,
      write: false,
      outfile: 'familiar-handler-bundle.mjs',
      sourcemap: 'external',
      sourcesContent: true,
      logLevel: 'silent',
      legalComments: 'none',
      plugins: [{
        name: 'snapback-familiar-handler-helpers',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (DEFINITION_PACKAGE_IMPORTS.has(args.path)
              || /(?:^|\/)generated\/(?:server|api)(?:\.(?:mjs|js|mts|ts))?$/u.test(args.path)) {
              return { path: args.path, external: true };
            }
            if (!isLocalModuleSpecifier(args.path)) {
              return {
                errors: [{
                  text: `Familiar handler helper import ${JSON.stringify(args.path)} is not a relative S2 helper-module path`,
                  detail: { snapbackCode: 'SNAPBACK_CODEGEN_FAMILIAR_HELPER_IMPORT_UNAVAILABLE' },
                }],
              };
            }
            let candidate = args.path.startsWith('file:')
              ? fileURLToPath(args.path)
              : resolve(args.resolveDir || dirname(args.importer), args.path);
            if (!existsSync(candidate) && !/\.[A-Za-z0-9]+$/u.test(candidate)) {
              candidate = ['.mts', '.ts', '.mjs', '.js']
                .map((extension) => `${candidate}${extension}`)
                .find((path) => existsSync(path)) ?? candidate;
            }
            if (!withinBackend(candidate) || !existsSync(candidate)) {
              return {
                errors: [{
                  text: `Familiar handler helper ${JSON.stringify(args.path)} is outside the admitted app graph; place it under the backend (a helper subdirectory is supported) and import it relatively`,
                  detail: {
                    snapbackCode: 'SNAPBACK_CODEGEN_FAMILIAR_HELPER_IMPORT_UNAVAILABLE',
                    specifier: args.path,
                  },
                }],
              };
            }
            return { path: resolve(candidate), namespace: 'file' };
          });
          build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
            const override = sourceOverrides.get(resolve(args.path));
            const loaded = resolve(args.path) === resolve(modulePath)
              ? entrySource
              : override?.javascript
              ?? readDefinitionSource(args.path, backendRoot, 'FAMILIAR_HELPER_SOURCE');
            if (resolve(args.path) !== resolve(modulePath)) {
              helperSources.push({
                path: relative(backendRoot, args.path).split(sep).join('/'),
                source: loaded,
              });
            }
            return {
              contents: loaded,
              loader: resolve(args.path) === resolve(modulePath) || override
                ? 'js'
                : definitionLoader(args.path),
              resolveDir: dirname(args.path),
            };
          });
        },
      }],
    });
    const bundledJavaScript = result.outputFiles?.find(({ path }) => !path.endsWith('.map'))?.text;
    if (typeof bundledJavaScript !== 'string') throw new Error('esbuild returned no helper bundle');
    const javascript = bundledJavaScript.replace(/\/\/# sourceMappingURL=.*?(?:\r?\n)?$/u, '');
    const sourceMapText = result.outputFiles?.find(({ path }) => path.endsWith('.map'))?.text;
    if (typeof sourceMapText !== 'string') throw new Error('esbuild returned no helper source map');
    const sourceMap = JSON.parse(sourceMapText);
    return {
      javascript,
      sourceMap,
      // @ref LLP 0253#s2-familiar-source-layout-and-discovery — bind every
      // admitted helper's path and erased bytes into executable identity even
      // though the evaluator consumes the flattened bounded closure.
      runtimeBytes: Buffer.from([
        javascript,
        ...helperSources
          .sort((left, right) => compareCodeUnits(left.path, right.path))
          .flatMap(({ path, source: helperSource }) => [`\n/* helper:${path} */\n`, helperSource]),
      ].join(''), 'utf8'),
    };
  } catch (error) {
    const failures = Array.isArray(error?.errors) && error.errors.length > 0
      ? error.errors
      : [error];
    for (const failure of failures) {
      diagnostics.push({
        code: failure?.detail?.snapbackCode
          ?? 'SNAPBACK_CODEGEN_FAMILIAR_HELPER_IMPORT_UNAVAILABLE',
        severity: 'error',
        subsystem: 'function',
        message: failure?.text ?? failure?.message ?? String(failure),
        path: modulePath,
        alternative: 'Place the helper under the Familiar backend and import it with a relative S2 helper-module path.',
        guideAnchor: '/_snapback/guide/backend/familiar-profile.md#translate-the-familiar-handler-dialect',
        ...(failure?.detail?.specifier
          ? { details: { specifier: failure.detail.specifier } }
          : {}),
      });
    }
    return null;
  }
}

function validateFamiliarWithIndexCallbacks(sourceFile, sourcePath, err) {
  const allowedMethods = new Set(['eq', 'in', 'lt', 'lte', 'gt', 'gte']);
  const unwrap = (node) => {
    let current = node;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
  };
  const containsIdentifier = (node, name) => {
    let found = false;
    const inspect = (current) => {
      if (found) return;
      if (ts.isIdentifier(current) && current.text === name) {
        found = true;
        return;
      }
      ts.forEachChild(current, inspect);
    };
    inspect(node);
    return found;
  };
  const isRecorderChain = (node, parameterName) => {
    const current = unwrap(node);
    if (ts.isIdentifier(current)) return current.text === parameterName;
    if (!ts.isCallExpression(current)) return false;
    const callee = unwrap(current.expression);
    let receiver;
    let method;
    if (ts.isPropertyAccessExpression(callee)) {
      receiver = callee.expression;
      method = callee.name.text;
    } else if (ts.isElementAccessExpression(callee)
      && (ts.isStringLiteral(callee.argumentExpression)
        || ts.isNoSubstitutionTemplateLiteral(callee.argumentExpression))) {
      receiver = callee.expression;
      method = callee.argumentExpression.text;
    } else {
      return false;
    }
    return allowedMethods.has(method)
      && current.arguments.every((argument) => !containsIdentifier(argument, parameterName))
      && isRecorderChain(receiver, parameterName);
  };
  const callbackExpression = (callback) => {
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
    if (callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) return null;
    if (!ts.isBlock(callback.body)) return callback.body;
    if (callback.body.statements.length !== 1 || !ts.isReturnStatement(callback.body.statements[0])) return null;
    return callback.body.statements[0].expression ?? null;
  };
  const report = (node) => {
    const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    err(
      'SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED',
      'function',
      `${relative(process.cwd(), sourcePath)}:${point.line + 1}:${point.character + 1}: withIndex callback must return one canonical eq/in/lt/lte/gt/gte chain rooted at its recorder parameter`,
      { path: sourcePath, line: point.line + 1, column: point.character + 1 },
    );
  };
  const inspect = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const callee = unwrap(node.expression);
      const isWithIndex = (ts.isPropertyAccessExpression(callee) && callee.name.text === 'withIndex')
        || (ts.isElementAccessExpression(callee)
          && (ts.isStringLiteral(callee.argumentExpression)
            || ts.isNoSubstitutionTemplateLiteral(callee.argumentExpression))
          && callee.argumentExpression.text === 'withIndex');
      if (isWithIndex) {
        const callback = unwrap(node.arguments[1]);
        const expression = callbackExpression(callback);
        const parameter = (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          && callback.parameters.length === 1
          && ts.isIdentifier(callback.parameters[0].name)
          ? callback.parameters[0].name.text
          : null;
        if (!expression || !parameter || !isRecorderChain(expression, parameter)) report(node.arguments[1]);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
}

function validateFamiliarDispositionFourHandlerForms({
  source,
  sourcePath,
  operations,
  extracted,
  err,
}) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const familiarGuide = '/_snapback/guide/backend/familiar-profile.md#translate-the-familiar-handler-dialect';
  const point = (node) => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: start.line + 1, column: start.character + 1 };
  };
  const report = (code, message, node, route) => {
    const sourcePoint = point(node);
    err(code, 'function', message, {
      path: sourcePath,
      ...sourcePoint,
      sourceSpan: { file: sourcePath, ...sourcePoint },
      guideAnchor: familiarGuide,
      alternative: message,
      ...(route === null ? {} : {
        profileSwitchSuggestion: {
          from: FAMILIAR_AUTHORING_PROFILE,
          to: EXPLICIT_AUTHORING_PROFILE,
          route,
        },
      }),
    });
  };
  const within = (node, container) => container.pos <= node.pos && node.end <= container.end;
  const extractedQueryBindings = new Set(
    operations
      .filter((operation) => operation.constructorKind === 'query')
      .filter((operation) => (
        extracted.handlers.has(operation.exportedName)
        || extracted.handlers.has(operation.localName)
      ))
      .map((operation) => operation.localName),
  );
  const unwrap = (node) => {
    let current = node;
    while (current && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current)
    )) current = current.expression;
    return current;
  };
  const authoredName = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
    if (!ts.isComputedPropertyName(node)) return null;
    const expression = unwrap(node.expression);
    return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
      ? expression.text
      : null;
  };
  const queryHandlers = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)
        || !extractedQueryBindings.has(declaration.name.text)) continue;
      const call = unwrap(declaration.initializer);
      const spec = ts.isCallExpression(call) ? unwrap(call.arguments[0]) : null;
      if (!spec || !ts.isObjectLiteralExpression(spec)) continue;
      const member = spec.properties.find((property) => (
        ts.isPropertyAssignment(property)
        && authoredName(property.name) === 'handler'
      ));
      const handler = member ? unwrap(member.initializer) : null;
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        queryHandlers.push(handler);
      }
    }
  }
  const containsQueryDatabaseRead = (node, contextName) => {
    let found = false;
    const inspect = (current) => {
      if (found) return;
      if (
        ts.isPropertyAccessExpression(current)
        && current.name.text === 'db'
        && ts.isIdentifier(current.expression)
        && current.expression.text === contextName
      ) {
        found = true;
        return;
      }
      ts.forEachChild(current, inspect);
    };
    inspect(node);
    return found;
  };
  const visibilityQueryHandlers = queryHandlers
    .map((handler) => {
      const context = handler.parameters[0]?.name;
      return {
        contextName: context && ts.isIdentifier(context) ? context.text : null,
        handler,
      };
    })
    .filter(({ contextName, handler }) => (
      contextName !== null && containsQueryDatabaseRead(handler.body, contextName)
    ));
  const controlledBranch = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isIfStatement(parent) && within(node, parent.expression)) return parent;
      if (ts.isConditionalExpression(parent) && within(node, parent.condition)) return parent;
      if (ts.isWhileStatement(parent) && within(node, parent.expression)) return parent;
      if (ts.isDoStatement(parent) && within(node, parent.expression)) return parent;
      if (ts.isForStatement(parent) && parent.condition && within(node, parent.condition)) return parent;
      if (
        ts.isBinaryExpression(parent)
        && [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(parent.operatorToken.kind)
      ) return parent;
      if (ts.isFunctionLike(parent)) return null;
    }
    return null;
  };
  const visibilityReturnExpression = (expression, contextName) => {
    const returned = unwrap(expression);
    return returned?.kind === ts.SyntaxKind.NullKeyword
      || (ts.isArrayLiteralExpression(returned) && returned.elements.length === 0)
      || containsQueryDatabaseRead(returned, contextName);
  };
  const containsVisibilityReturn = (node, contextName) => {
    if (!node) return false;
    let found = false;
    const inspect = (current) => {
      if (found) return;
      if (
        ts.isReturnStatement(current)
        && current.expression
        && visibilityReturnExpression(current.expression, contextName)
      ) {
        found = true;
        return;
      }
      ts.forEachChild(current, inspect);
    };
    inspect(node);
    return found;
  };
  const branchDecidesQueryVisibility = (branch, handler, contextName) => {
    if (ts.isIfStatement(branch)) {
      return containsVisibilityReturn(branch.thenStatement, contextName)
        || containsVisibilityReturn(branch.elseStatement, contextName)
        || containsQueryDatabaseRead(branch.thenStatement, contextName)
        || (branch.elseStatement
          ? containsQueryDatabaseRead(branch.elseStatement, contextName)
          : false);
    }
    if (ts.isWhileStatement(branch) || ts.isDoStatement(branch) || ts.isForStatement(branch)) {
      return containsVisibilityReturn(branch.statement, contextName)
        || containsQueryDatabaseRead(branch.statement, contextName);
    }
    for (let parent = branch.parent; parent && parent !== handler; parent = parent.parent) {
      if (
        ts.isReturnStatement(parent)
        && parent.expression
        && visibilityReturnExpression(parent.expression, contextName)
      ) return true;
      if (
        ts.isCallExpression(parent)
        && ts.isPropertyAccessExpression(parent.expression)
        && ['filter', 'withIndex'].includes(parent.expression.name.text)
      ) return true;
    }
    return !ts.isBlock(handler.body)
      && visibilityReturnExpression(handler.body, contextName);
  };
  const inspect = (node) => {
    const ambientClock = (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'now'
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Date'
    ) || (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Date'
      && (node.arguments?.length ?? 0) === 0
    );
    const branch = ambientClock ? controlledBranch(node) : null;
    if (ambientClock && branch) {
      if (visibilityQueryHandlers.some(({ contextName, handler }) => (
        within(node, handler)
        && branchDecidesQueryVisibility(branch, handler, contextName)
      ))) {
        report(
          'BUNDLE_UNSUPPORTED_TIME',
          'Familiar clock-dependent visibility cannot use an ambient clock; model visibility as persisted application state, update it through a mutation, and query that stored state',
          node,
          null,
        );
      } else {
        const sourcePoint = point(node);
        err(
          'BUNDLE_UNSUPPORTED_TIME',
          'function',
          unsupportedAmbientDependencyMessage('BUNDLE_UNSUPPORTED_TIME', 'Date'),
          {
            path: sourcePath,
            ...sourcePoint,
            sourceSpan: { file: sourcePath, ...sourcePoint },
          },
        );
      }
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'allocate'
      && ts.isPropertyAccessExpression(node.expression.expression)
      && node.expression.expression.name.text === 'sequence'
    ) {
      report(
        'SNAPBACK_CODEGEN_FAMILIAR_SEQUENCE_UNSUPPORTED',
        'Familiar has no sequence allocator; use the Explicit profile declared sequences surface',
        node,
        'sequences',
      );
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
}

function projectFamiliarHandlerDiagnostic(diagnostic) {
  const guideAnchor = '/_snapback/guide/backend/familiar-profile.md#translate-the-familiar-handler-dialect';
  if (
    diagnostic.code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN'
    && /dynamic computed member access/u.test(diagnostic.message)
  ) {
    return {
      ...diagnostic,
      message: `${diagnostic.message}; use static/destructured access or pass the selected value through args`,
      alternative: 'Use static/destructured access or pass the selected value through args.',
      guideAnchor,
    };
  }
  if (
    diagnostic.code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
    && diagnostic.identifierDeclarations?.some(
      ({ declarationKind }) => declarationKind !== 'import',
    )
  ) {
    return {
      ...diagnostic,
      message: `${diagnostic.message}; inline the value or pass it through args`,
      alternative: 'Inline the value or pass it through args.',
      guideAnchor,
    };
  }
  if (
    diagnostic.code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
    && diagnostic.identifierDeclarations?.some(
      ({ declarationKind }) => declarationKind === 'import',
    )
  ) {
    return {
      ...diagnostic,
      message: `${diagnostic.message}; place the helper under the backend and import it with a relative S2 helper-module path`,
      alternative: 'Place the helper under the backend and import it with a relative S2 helper-module path.',
      guideAnchor,
    };
  }
  return diagnostic;
}

function captureFamiliarApiReferences(source, sourcePath, apiDigest, err) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  // @ref LLP 0253#s45-callback-withindex-lowering-r5-pin-no-drop-gate — an
  // inert assignment cannot be observed by a runtime recorder. Prove the
  // callback's single-chain grammar before evaluation so every q escape is a
  // deterministic refusal rather than a latent capability.
  validateFamiliarWithIndexCallbacks(sourceFile, sourcePath, err);
  const apiBindings = new Set();
  const replacements = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !/^\.\/generated\/api(?:\.(?:mjs|js|mts|ts))?$/u.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if ((specifier.propertyName?.text ?? specifier.name.text) === 'api') {
          apiBindings.add(specifier.name.text);
        }
      }
    }
    // Keep every line/column position stable for the TypeScript source map
    // consumed by authored write-site attribution. Whitespace removes the
    // definition-time import just as completely as an empty replacement.
    replacements.push({
      start: statement.getFullStart(),
      end: statement.end,
      value: source.slice(statement.getFullStart(), statement.end)
        .replace(/[^\r\n]/gu, ' '),
    });
  }
  const reported = new Set();
  const report = (node, reason) => {
    const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const key = `${point.line}:${point.character}`;
    if (reported.has(key)) return;
    reported.add(key);
    err(
      'SNAPBACK_FAMILIAR_API_REFERENCE_DYNAMIC',
      'function',
      `${relative(process.cwd(), sourcePath)}:${point.line + 1}:${point.character + 1}: ${reason}; use api.module.operation`,
      { path: sourcePath, line: point.line + 1, column: point.character + 1 },
    );
  };
  const staticSegment = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)
      && (ts.isStringLiteral(node.argumentExpression)
        || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))) {
      return node.argumentExpression.text;
    }
    return null;
  };
  const inspect = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const parentContinues = (ts.isPropertyAccessExpression(node.parent)
          || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node;
      if (!parentContinues) {
        const segments = [];
        let cursor = node;
        let dynamic = false;
        while (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
          const segment = staticSegment(cursor);
          if (segment === null) dynamic = true;
          else segments.unshift(segment);
          cursor = cursor.expression;
        }
        if (ts.isIdentifier(cursor) && apiBindings.has(cursor.text)) {
          if (dynamic || segments.length !== 2 || segments.some((entry) => !IDENT.test(entry))) {
            report(node, 'generated api references must contain two static identifier members');
          } else {
            const name = segments.join('.');
            replacements.push({
              start: node.getStart(sourceFile),
              end: node.end,
              value: `Object.freeze({__snapbackFamiliarApiReference:Object.freeze({name:${JSON.stringify(name)},apiDigest:${JSON.stringify(apiDigest)}})})`,
            });
          }
        }
      }
    } else if (ts.isIdentifier(node) && apiBindings.has(node.text)) {
      const parentUsesAsRoot = (ts.isPropertyAccessExpression(node.parent)
          || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node;
      const importUse = ts.isImportSpecifier(node.parent);
      if (!parentUsesAsRoot && !importUse) report(node, 'the generated api binding cannot escape or be used dynamically');
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  let output = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return output;
}

export function renderFamiliarHandlerRuntime(name, extracted, canonicalRendered, contextKind, apiDigest) {
  const registrationEnd = renderInlineHandlerModule(name, extracted.expressionSource).length;
  const helpers = canonicalRendered.source.slice(registrationEnd);
  // esbuild retains the exact marker shape while inserting presentation
  // whitespace when an admitted helper graph is flattened. Match both the
  // unbundled and flattened spellings; the closed keys/order keep this scoped
  // to captureFamiliarApiReferences output.
  const capturedReferencePattern = /Object\.freeze\(\s*\{\s*__snapbackFamiliarApiReference\s*:\s*Object\.freeze\(\s*\{\s*name\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*apiDigest\s*:\s*("(?:[^"\\]|\\.)*")\s*\}\s*\)\s*\}\s*\)/gu;
  const runtimeExpressionSource = extracted.expressionSource.replace(
    capturedReferencePattern,
    '__snapbackFamiliarReference($1, $2)',
  );
  const runtimeHelpers = helpers.replace(
    capturedReferencePattern,
    '__snapbackFamiliarReference($1, $2)',
  );
  // @ref LLP 0253#s44-handler-contexts — digest-shaped lookalikes are still
  // foreign objects. Only markers minted while evaluating the statically
  // rewritten handler expression enter this closure-private nominal set.
  const lines = [
    // @ref LLP 0253#s92-w3-vertical-contract-fixture-catalogue — direct
    // facade callers inspect `code`; the trusted settle wrapper reads the
    // private marker before both serving decoders admit A1's exact code.
    'function __snapbackFamiliarFail(code, message) { const error = new Error(message); error.code = code; error.__snapbackCode = code; throw error; }',
    'const __snapbackFamiliarReferences = new WeakSet();',
    'function __snapbackFamiliarReference(name, apiDigest) { const reference = Object.freeze({ __snapbackFamiliarApiReference: Object.freeze({ name, apiDigest }) }); __snapbackFamiliarReferences.add(reference); return reference; }',
    `const __snapbackFamiliarHandler = (${runtimeExpressionSource});`,
    'function __snapbackFamiliarWrapBuilder(builder) {',
    '  const wrapped = Object.create(null);',
    '  const chain = (method, args) => __snapbackFamiliarWrapBuilder(builder[method](...args));',
    '  wrapped.withIndex = (index, callback) => {',
    '    if (callback === undefined) return __snapbackFamiliarWrapBuilder(builder.withIndex(index));',
    '    if (typeof callback !== "function") __snapbackFamiliarFail("SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED", "withIndex callback must be a chained canonical range predicate");',
    '    const calls = [];',
    '    let active = true;',
    '    let tail;',
    '    const makeRecorder = () => {',
    '      const recorder = Object.create(null);',
    '      for (const method of ["eq", "in", "lt", "lte", "gt", "gte"]) recorder[method] = (...args) => {',
    '        if (!active) __snapbackFamiliarFail("SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED", "withIndex recorder escaped its callback");',
    '        if (recorder !== tail) __snapbackFamiliarFail("SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED", "withIndex predicates must form one chain");',
    '        calls.push([method, args]);',
    '        tail = makeRecorder();',
    '        return tail;',
    '      };',
    '      return Object.freeze(recorder);',
    '    };',
    '    const recorder = makeRecorder();',
    '    tail = recorder;',
    '    let result;',
    '    try { result = callback(recorder); } catch (error) { if (error && error.code === "SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED") throw error; __snapbackFamiliarFail("SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED", "withIndex callback used an unsupported recorder operation"); }',
    '    active = false;',
    '    if (result !== tail) __snapbackFamiliarFail("SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED", "withIndex callback must return its complete chained recorder");',
    '    let lowered = builder.withIndex(index);',
    '    for (const [method, args] of calls) lowered = lowered[method](...args);',
    '    return __snapbackFamiliarWrapBuilder(lowered);',
    '  };',
    '  for (const method of ["eq", "in", "lt", "lte", "gt", "gte", "order", "take"]) wrapped[method] = (...args) => chain(method, args);',
    '  wrapped.collect = (...args) => builder.collect(...args);',
    '  wrapped.first = (...args) => builder.first(...args);',
    '  return Object.freeze(wrapped);',
    '}',
    'function __snapbackFamiliarDataContext(ctx) {',
    '  const db = Object.freeze({ ...ctx.db, query: (table) => __snapbackFamiliarWrapBuilder(ctx.db.query(table)) });',
    '  return Object.freeze({ ...ctx, db });',
    '}',
    'function __snapbackFamiliarActionContext(ctx) {',
    '  const runMutation = (reference, args) => {',
    '    const outerKeys = reference && typeof reference === "object" ? Object.keys(reference) : [];',
    '    const marker = outerKeys.length === 1 && outerKeys[0] === "__snapbackFamiliarApiReference" ? reference.__snapbackFamiliarApiReference : null;',
    '    const markerKeys = marker && typeof marker === "object" ? Object.keys(marker).sort() : [];',
    `    if (!__snapbackFamiliarReferences.has(reference) || !Object.isFrozen(reference) || !Object.isFrozen(marker) || markerKeys.join(",") !== "apiDigest,name" || marker.apiDigest !== ${JSON.stringify(apiDigest)} || typeof marker.name !== "string" || !${OPERATION_NAME_PATTERN}.test(marker.name)) __snapbackFamiliarFail("SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED", "runMutation requires a generated api.module.operation reference from this application generation");`,
    '    return ctx.runMutation(marker.name, args);',
    '  };',
    '  const runQuery = () => __snapbackFamiliarFail("SNAPBACK_FAMILIAR_RUNQUERY_UNSUPPORTED", "familiar v1 actions do not expose runQuery; route through an explicit profile action when required");',
    '  const hostEffect = () => __snapbackFamiliarFail("SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED", "familiar v1 actions do not expose fetch or fetchStream; use the explicit profile");',
    '  return Object.freeze({',
    '    auth: ctx.auth,',
    '    runtime: ctx.runtime,',
    '    secrets: ctx.secrets,',
    '    refuse: ctx.refuse,',
    '    isDirectHuman: ctx.isDirectHuman,',
    '    runMutation,',
    '    runQuery,',
    '    fetch: hostEffect,',
    '    ["fetch" + "Stream"]: hostEffect,',
    '  });',
    '}',
    `globalThis.__snapbackHandlers = { ${JSON.stringify(name)}: (ctx, args) => __snapbackFamiliarHandler(${contextKind === 'action' ? '__snapbackFamiliarActionContext(ctx)' : '__snapbackFamiliarDataContext(ctx)'}, args) };`,
    '',
  ];
  return {
    source: `${lines.join('\n')}${runtimeHelpers}`,
    segments: canonicalRendered.segments,
  };
}

function readCodegenPolicy(backendRoot, diagnostics, err) {
  const path = join(backendRoot, 'codegen.policy.json');
  if (!existsSync(path)) {
    return {
      source: null,
      committedProjections: [],
      contractMetadata: null,
      authoringProfile: EXPLICIT_AUTHORING_PROFILE,
      hostedDevelopmentTargets: [],
    };
  }
  let source;
  let policy;
  try {
    source = resolveFileReadCapability(path, {
      allowedRoots: [backendRoot],
      allowSymlink: false,
      codePrefix: 'CODEGEN_POLICY',
    }).read();
    policy = JSON.parse(decodeUtf8Source(source, path, 'CODEGEN_POLICY'));
  } catch (cause) {
    diagnostics.push({
      code: 'CODEGEN_POLICY_INVALID',
      severity: 'error',
      subsystem: 'codegen',
      message: `codegen policy ${path} could not be read as JSON: ${cause.message}`,
      path,
    });
    return {
      source: source ?? null,
      committedProjections: [],
      contractMetadata: null,
      authoringProfile: EXPLICIT_AUTHORING_PROFILE,
      hostedDevelopmentTargets: [],
    };
  }
  const requiredKeys = ['committedProjections', 'schemaVersion'];
  const allowedKeys = [...requiredKeys, 'authoringProfile', 'contractMetadata', 'hostedDevelopmentTargets'];
  const actualKeys = policy && typeof policy === 'object' && !Array.isArray(policy)
    ? Object.keys(policy).sort()
    : [];
  const committed = policy?.committedProjections;
  const contractMetadata = policy?.contractMetadata;
  const authoringProfile = policy?.authoringProfile;
  const hostedDevelopmentTargets = policy?.hostedDevelopmentTargets;
  if (
    authoringProfile !== undefined
    && authoringProfile !== EXPLICIT_AUTHORING_PROFILE
    && authoringProfile !== FAMILIAR_AUTHORING_PROFILE
  ) {
    err(
      'SNAPBACK_CODEGEN_AUTHORING_PROFILE_INVALID',
      'codegen',
      `codegen policy ${path} authoringProfile must be "snapback-explicit-v1" or "snapback-familiar-ts-v1"`,
      { path, authoringProfile },
    );
    return {
      source,
      committedProjections: [],
      contractMetadata: null,
      authoringProfile: EXPLICIT_AUTHORING_PROFILE,
      hostedDevelopmentTargets: [],
    };
  }
  let normalizedHostedDevelopmentTargets = [];
  let hostedDevelopmentTargetsValid = true;
  if (hostedDevelopmentTargets !== undefined) {
    hostedDevelopmentTargetsValid = Array.isArray(hostedDevelopmentTargets);
    const seenOrigins = new Set();
    if (hostedDevelopmentTargetsValid) {
      normalizedHostedDevelopmentTargets = hostedDevelopmentTargets.map((entry) => {
        const keys = entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.keys(entry).sort()
          : [];
        if (
          keys.length !== 2
          || keys[0] !== 'hostedTargetReceipt'
          || keys[1] !== 'origin'
          || typeof entry.hostedTargetReceipt !== 'string'
          || entry.hostedTargetReceipt.length === 0
          || entry.hostedTargetReceipt.trim() !== entry.hostedTargetReceipt
          || typeof entry.origin !== 'string'
        ) {
          hostedDevelopmentTargetsValid = false;
          return null;
        }
        try {
          const origin = new URL(entry.origin);
          if (
            origin.protocol !== 'https:'
            || origin.username !== ''
            || origin.password !== ''
            || origin.pathname !== '/'
            || origin.search !== ''
            || origin.hash !== ''
            || origin.origin !== entry.origin
            || seenOrigins.has(origin.origin)
          ) {
            hostedDevelopmentTargetsValid = false;
            return null;
          }
          seenOrigins.add(origin.origin);
          return {
            origin: origin.origin,
            hostedTargetReceipt: entry.hostedTargetReceipt,
          };
        } catch {
          hostedDevelopmentTargetsValid = false;
          return null;
        }
      });
    }
  }
  if (
    !policy
    || typeof policy !== 'object'
    || Array.isArray(policy)
    || policy.schemaVersion !== 'snapback.codegen-policy.v1'
    || requiredKeys.some((key) => !actualKeys.includes(key))
    || actualKeys.some((key) => !allowedKeys.includes(key))
    || (contractMetadata !== undefined && contractMetadata !== 'exact')
    || !hostedDevelopmentTargetsValid
    || !Array.isArray(committed)
    || new Set(committed).size !== committed.length
    || committed.some((entry) => (
      typeof entry !== 'string'
      || entry.length === 0
      || entry.includes('\\')
      || entry.startsWith('/')
      || entry.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ))
  ) {
    diagnostics.push({
      code: 'CODEGEN_POLICY_INVALID',
      severity: 'error',
      subsystem: 'codegen',
      message: `codegen policy ${path} must be a closed snapback.codegen-policy.v1 record with unique portable committedProjections, optional authoringProfile, optional contractMetadata: "exact", and optional unique canonical-HTTPS hostedDevelopmentTargets`,
      path,
    });
    return {
      source,
      committedProjections: [],
      contractMetadata: null,
      authoringProfile: EXPLICIT_AUTHORING_PROFILE,
      hostedDevelopmentTargets: [],
    };
  }
  return {
    source,
    committedProjections: [...committed].sort(compareCodeUnits),
    contractMetadata: contractMetadata ?? null,
    authoringProfile: authoringProfile ?? EXPLICIT_AUTHORING_PROFILE,
    hostedDevelopmentTargets: normalizedHostedDevelopmentTargets.sort((left, right) => (
      compareCodeUnits(left.origin, right.origin)
    )),
  };
}

function readString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function cleanObject(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && entry !== undefined) out[key] = entry;
  }
  return out;
}

function generatedAtMillis() {
  if (process.env.SNAPBACK_GENERATED_AT_MS) return Number(process.env.SNAPBACK_GENERATED_AT_MS);
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH) * 1000;
  return 0;
}

// Deterministic JSON with recursively sorted object keys (stable diffs).
function stableJson(value, indent = 2) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = dict();
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}

// Summary links are an author aid, not generated identity. They point to the
// authored export declaration while the hash continues to bind the complete
// source graph independently.
function graphEntrySource(graph, path) {
  try {
    return graph.get(realpathSync(path))?.source ?? null;
  } catch {
    return null;
  }
}

function exportedDefinitionSourceSpans(source) {
  let tree;
  try {
    if (typeof source !== 'string') return {};
    tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    return {};
  }
  const spans = {};
  for (const statement of tree.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;
    if (statement.declaration?.type === 'VariableDeclaration') {
      for (const declaration of statement.declaration.declarations) {
        if (declaration.id?.type === 'Identifier') {
          spans[declaration.id.name] = {
            path: 'functions.mjs',
            line: declaration.id.loc.start.line,
            column: declaration.id.loc.start.column + 1,
          };
        }
      }
    } else if (statement.declaration?.id?.name) {
      spans[statement.declaration.id.name] = {
        path: 'functions.mjs',
        line: statement.declaration.id.loc.start.line,
        column: statement.declaration.id.loc.start.column + 1,
      };
    }
    for (const specifier of statement.specifiers ?? []) {
      const exported = specifier.exported?.name ?? specifier.exported?.value;
      if (typeof exported === 'string') {
        spans[exported] = {
          path: 'functions.mjs',
          line: specifier.exported.loc.start.line,
          column: specifier.exported.loc.start.column + 1,
        };
      }
    }
  }
  return spans;
}

const GRAPH_SOURCE_FAULT_ORDER = new Map([
  ['SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN', 1],
  ['SNAPBACK_GRAPH_CODE_FORBIDDEN', 2],
  ['SNAPBACK_GRAPH_RECURSION_FORBIDDEN', 3],
  ['SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', 4],
]);

function graphResolveImportPath(specifier, sourcePath) {
  let candidate = DEFINITION_PACKAGE_IMPORTS.get(specifier);
  try {
    if (!candidate && specifier.startsWith('file:')) candidate = fileURLToPath(specifier);
    if (!candidate && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      candidate = resolve(dirname(sourcePath), specifier);
      if (!existsSync(candidate) && !/\.[A-Za-z0-9]+$/u.test(candidate)) {
        candidate = ['.mjs', '.js', '.mts', '.ts']
          .map((extension) => `${candidate}${extension}`)
          .find((path) => existsSync(path));
      }
    }
    if (!candidate && isAbsolute(specifier)) candidate = specifier;
    if (!candidate) return null;
    try { return realpathSync(candidate); } catch { return resolve(candidate); }
  } catch {
    return null;
  }
}

function graphImportResolvesToOwnDefine(specifier, sourcePath) {
  const ownDefine = graphResolveImportPath('@expo/snapback-codegen/define', sourcePath);
  return graphResolveImportPath(specifier, sourcePath) === ownDefine;
}

function graphBindingNameContains(name, expected) {
  if (ts.isIdentifier(name)) return name.text === expected;
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some((element) => (
      ts.isBindingElement(element) && graphBindingNameContains(element.name, expected)
    ));
  }
  return false;
}

function graphModuleBindingIsUnshadowed(identifier, expected, sourceFile) {
  let child = identifier;
  for (let scope = identifier.parent; scope && scope !== sourceFile; child = scope, scope = scope.parent) {
    if (ts.isFunctionLike(scope)
      && scope.parameters.some((parameter) => graphBindingNameContains(parameter.name, expected))) {
      return false;
    }
    if (ts.isCatchClause(scope)
      && scope.variableDeclaration
      && graphBindingNameContains(scope.variableDeclaration.name, expected)) {
      return false;
    }
    if (ts.isBlock(scope) || ts.isModuleBlock(scope)) {
      for (const statement of scope.statements) {
        if (statement === child) continue;
        if (ts.isVariableStatement(statement)
          && statement.declarationList.declarations.some(
            (declaration) => graphBindingNameContains(declaration.name, expected),
          )) return false;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
          && statement.name?.text === expected) return false;
      }
    }
  }
  return true;
}

// @ref LLP 0209#2-the-graph-ir — every syntactic graph-builder call site is
// admitted only when its binding resolves through the captured module graph
// to the one codegen-owned define.mjs export.
function graphAuthoringBindingResolver(modules) {
  const ownDefine = graphResolveImportPath('@expo/snapback-codegen/define', import.meta.url);
  const byPath = new Map();
  for (const module of modules) {
    const path = graphResolveImportPath(module.path, module.path) ?? resolve(module.path);
    const sourceFile = ts.createSourceFile(
      path,
      module.source,
      ts.ScriptTarget.ES2022,
      true,
      /\.tsx?$/iu.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );
    byPath.set(path, { ...module, path, sourceFile });
  }

  const moduleFor = (path) => byPath.get(
    graphResolveImportPath(path, path) ?? resolve(path),
  );
  const importedPath = (specifier, sourcePath) => {
    const path = graphResolveImportPath(specifier, sourcePath);
    return path && (byPath.has(path) || path === ownDefine) ? path : null;
  };
  const hasExportModifier = (node) => ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  const resolveLocal = (modulePath, localName, seen = new Set()) => {
    const key = `local:${modulePath}:${localName}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const module = moduleFor(modulePath);
    if (!module) return null;
    for (const statement of module.sourceFile.statements) {
      if (ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = importedPath(statement.moduleSpecifier.text, module.path);
        if (!target) continue;
        if (statement.importClause?.name?.text === localName) {
          return resolveExport(target, 'default', seen);
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === localName) {
          return { kind: 'namespace', modulePath: target };
        }
        if (bindings && ts.isNamedImports(bindings)) {
          const binding = bindings.elements.find((element) => element.name.text === localName);
          if (binding) {
            return resolveExport(target, binding.propertyName?.text ?? binding.name.text, seen);
          }
        }
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === localName) {
            return {
              kind: 'local', modulePath: module.path, localName, declaration,
            };
          }
        }
      }
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
        && statement.name?.text === localName) {
        return { kind: 'local', modulePath: module.path, localName, declaration: statement };
      }
    }
    return null;
  };

  const resolveExport = (modulePath, exportName, seen = new Set()) => {
    if (modulePath === ownDefine) {
      return { kind: 'own-export', modulePath, exportName };
    }
    const key = `export:${modulePath}:${exportName}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const module = moduleFor(modulePath);
    if (!module) return null;
    for (const statement of module.sourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        const target = ts.isStringLiteral(statement.moduleSpecifier)
          ? importedPath(statement.moduleSpecifier.text, module.path)
          : null;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const binding = statement.exportClause.elements.find(
            (element) => element.name.text === exportName,
          );
          if (!binding) continue;
          const imported = binding.propertyName?.text ?? binding.name.text;
          return target
            ? resolveExport(target, imported, seen)
            : resolveLocal(module.path, imported, seen);
        }
        if (!statement.exportClause && target) {
          const resolved = resolveExport(target, exportName, new Set(seen));
          if (resolved) return resolved;
        }
      }
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
            return {
              kind: 'local', modulePath: module.path, localName: exportName, declaration,
            };
          }
        }
      }
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
        && hasExportModifier(statement) && statement.name?.text === exportName) {
        return {
          kind: 'local', modulePath: module.path, localName: exportName, declaration: statement,
        };
      }
      if (exportName === 'default' && ts.isExportAssignment(statement)) {
        return ts.isIdentifier(statement.expression)
          ? resolveLocal(module.path, statement.expression.text, seen)
          : { kind: 'expression', modulePath: module.path, expression: statement.expression };
      }
    }
    return null;
  };

  const ownExport = (descriptor, exportName) => descriptor?.kind === 'own-export'
    && descriptor.modulePath === ownDefine
    && descriptor.exportName === exportName;
  const propertyName = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)
      && (ts.isStringLiteral(node.argumentExpression)
        || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))) {
      return node.argumentExpression.text;
    }
    return null;
  };
  const propertyReceiver = (node) => (
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? node.expression
      : null
  );
  const calleeOwnExport = (node, sourcePath, sourceFile, exportName, unwrap) => {
    const target = unwrap(node);
    const modulePath = graphResolveImportPath(sourcePath, sourcePath) ?? resolve(sourcePath);
    if (ts.isIdentifier(target)) {
      return graphModuleBindingIsUnshadowed(target, target.text, sourceFile)
        && ownExport(resolveLocal(modulePath, target.text), exportName);
    }
    if (propertyName(target) !== exportName) return false;
    const receiver = unwrap(propertyReceiver(target));
    if (!ts.isIdentifier(receiver)
      || !graphModuleBindingIsUnshadowed(receiver, receiver.text, sourceFile)) return false;
    const namespace = resolveLocal(modulePath, receiver.text);
    return namespace?.kind === 'namespace'
      && ownExport(resolveExport(namespace.modulePath, exportName), exportName);
  };
  const builderTarget = (node, sourcePath, sourceFile, unwrap) => {
    const target = unwrap(node);
    const invocation = propertyName(target);
    if ((invocation === 'call' || invocation === 'apply') && propertyReceiver(target)) {
      const base = builderTarget(propertyReceiver(target), sourcePath, sourceFile, unwrap);
      return base ? { ...base, invocation } : null;
    }
    if (ts.isIdentifier(target)) {
      const descriptor = graphModuleBindingIsUnshadowed(
        target, target.text, sourceFile,
      ) ? resolveLocal(
          graphResolveImportPath(sourcePath, sourcePath) ?? resolve(sourcePath),
          target.text,
        ) : null;
      if (target.text === 'defineGraphQuery' || ownExport(descriptor, 'defineGraphQuery')) {
        return { kind: 'builder', owned: ownExport(descriptor, 'defineGraphQuery'), invocation: null };
      }
      return null;
    }
    if (propertyName(target) !== 'defineGraphQuery') return null;
    const receiver = unwrap(propertyReceiver(target));
    let owned = false;
    if (ts.isIdentifier(receiver)
      && graphModuleBindingIsUnshadowed(receiver, receiver.text, sourceFile)) {
      const namespace = resolveLocal(
        graphResolveImportPath(sourcePath, sourcePath) ?? resolve(sourcePath),
        receiver.text,
      );
      owned = namespace?.kind === 'namespace'
        && ownExport(resolveExport(namespace.modulePath, 'defineGraphQuery'), 'defineGraphQuery');
    }
    return { kind: 'builder', owned, invocation: null };
  };

  const isTableBuilder = (initializer, module) => {
    let current = initializer;
    while (current && ts.isCallExpression(current)) {
      const callee = current.expression;
      if (calleeOwnExport(callee, module.path, module.sourceFile, 'defineTable', (value) => value)) {
        return true;
      }
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        current = callee.expression;
        continue;
      }
      break;
    }
    return false;
  };
  const tableInstalled = (descriptor) => {
    if (descriptor?.kind !== 'local' || !ts.isVariableDeclaration(descriptor.declaration)) {
      return false;
    }
    const module = moduleFor(descriptor.modulePath);
    if (!module || !isTableBuilder(descriptor.declaration.initializer, module)) return false;
    let installed = false;
    const visit = (node) => {
      if (installed) return;
      if (ts.isCallExpression(node)
        && calleeOwnExport(
          node.expression, module.path, module.sourceFile, 'defineSchema', (value) => value,
        )) {
        const tables = node.arguments[0];
        if (tables && ts.isObjectLiteralExpression(tables)) {
          installed = tables.properties.some((property) => (
            ts.isShorthandPropertyAssignment(property)
              ? property.name.text === descriptor.localName
              : ts.isPropertyAssignment(property)
                && ts.isIdentifier(property.initializer)
                && property.initializer.text === descriptor.localName
          ));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
    return installed;
  };

  return {
    builderTarget,
    isDeclaredTableBinding(identifier, sourcePath, sourceFile) {
      if (!graphModuleBindingIsUnshadowed(identifier, identifier.text, sourceFile)) return false;
      const descriptor = resolveLocal(
        graphResolveImportPath(sourcePath, sourcePath) ?? resolve(sourcePath),
        identifier.text,
      );
      return tableInstalled(descriptor);
    },
  };
}

function graphPropertyName(property) {
  const name = property?.name;
  if (ts.isComputedPropertyName(name)) return { computed: true, name: null };
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return { computed: false, name: name.text };
  }
  return { computed: false, name: null };
}

function validateGraphAuthoringSource(source, path, bindings) {
  if (typeof source !== 'string') return [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    true,
    /\.tsx?$/iu.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const helperExports = new Set([
    'arg', 'lit', 'literal',
    'eq', 'ltFilter', 'lteFilter', 'gtFilter', 'gteFilter',
    'asc', 'desc',
  ]);
  const graphLiteralHelpers = new Map();
  const graphNamespaces = new Set();
  const validatorRoots = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !graphImportResolvesToOwnDefine(statement.moduleSpecifier.text, path)) continue;
    const importedBindings = statement.importClause?.namedBindings;
    if (importedBindings && ts.isNamespaceImport(importedBindings)) {
      graphNamespaces.add(importedBindings.name.text);
      continue;
    }
    if (!importedBindings || !ts.isNamedImports(importedBindings)) continue;
    for (const specifier of importedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (helperExports.has(imported)) graphLiteralHelpers.set(specifier.name.text, imported);
      if (imported === 'v') validatorRoots.add(specifier.name.text);
    }
  }
  const unwrap = (node) => {
    let current = node;
    while (current && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current)
    )) current = current.expression;
    return current;
  };
  const ownCallee = (node) => {
    const callee = unwrap(node);
    const builder = bindings.builderTarget(callee, path, sourceFile, unwrap);
    if (builder) return builder;
    if (ts.isIdentifier(callee)) {
      if (graphLiteralHelpers.has(callee.text)) {
        return { kind: 'helper', name: graphLiteralHelpers.get(callee.text) };
      }
      return null;
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      if (graphNamespaces.has(callee.expression.text)) {
        if (callee.name.text === 'defineGraphQuery') return { kind: 'builder', name: callee.name.text };
        if (helperExports.has(callee.name.text)) return { kind: 'helper', name: callee.name.text };
      }
      if (validatorRoots.has(callee.expression.text)) {
        return { kind: 'validator', name: callee.name.text };
      }
    }
    if (ts.isPropertyAccessExpression(callee)
      && ts.isPropertyAccessExpression(callee.expression)
      && ts.isIdentifier(callee.expression.expression)
      && graphNamespaces.has(callee.expression.expression.text)
      && callee.expression.name.text === 'v') {
      return { kind: 'validator', name: callee.name.text };
    }
    return null;
  };
  const span = (node) => {
    const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { file: path, line: point.line + 1, column: point.character + 1 };
  };
  const faults = new Map();
  const report = (code, node, message) => {
    if (!faults.has(code)) faults.set(code, { code, node, message, sourceSpan: span(node), path });
  };
  const calls = [];
  const collect = (node) => {
    if (!node) return;
    if (ts.isCallExpression(node)) {
      const binding = ownCallee(node.expression);
      if (binding?.kind === 'builder') calls.push({ call: node, binding });
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  for (const entry of calls) {
    const { call, binding } = entry;
    if (!binding.owned) {
      report(
        'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
        call,
        'defineGraphQuery binding does not resolve to the codegen-owned define.mjs export',
      );
      continue;
    }
    let specArgument = binding.invocation === 'call' ? call.arguments[1] : call.arguments[0];
    if (binding.invocation === 'apply') {
      const applied = unwrap(call.arguments[1]);
      if (applied && ts.isArrayLiteralExpression(applied) && applied.elements.length === 1
        && !ts.isSpreadElement(applied.elements[0])) {
        [specArgument] = applied.elements;
      } else {
        report(
          'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
          call,
          'defineGraphQuery.apply requires one literal source-carrier argument',
        );
        continue;
      }
    }
    const spec = unwrap(specArgument);
    if (!spec || !ts.isObjectLiteralExpression(spec)) {
      report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', call, 'defineGraphQuery requires an unconditional object-literal source carrier');
      continue;
    }
    const inspect = (node, propertyPath = []) => {
      if (!node) return;
      const current = unwrap(node);
      if (ts.isStringLiteral(current) || ts.isNumericLiteral(current)
        || ts.isNoSubstitutionTemplateLiteral(current)
        || current.kind === ts.SyntaxKind.TrueKeyword
        || current.kind === ts.SyntaxKind.FalseKeyword
        || current.kind === ts.SyntaxKind.NullKeyword) return;
      if (ts.isPrefixUnaryExpression(current)
        && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(current.operator)
        && ts.isNumericLiteral(unwrap(current.operand))) return;
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)
        || ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)
        || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)
        || ts.isClassExpression(current) || ts.isClassDeclaration(current)
        || ts.isNewExpression(current)) {
        report('SNAPBACK_GRAPH_CODE_FORBIDDEN', current, 'defineGraphQuery contains executable code');
        return;
      }
      if (ts.isConditionalExpression(current)
        || ts.isTemplateExpression(current)
        || ts.isBinaryExpression(current) && [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(current.operatorToken.kind)) {
        report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', current, 'defineGraphQuery shape is data-dependent');
        return;
      }
      if (ts.isSpreadAssignment(current) || ts.isSpreadElement(current)) {
        report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', current, 'defineGraphQuery shape may not be spread or data-dependent');
        return;
      }
      if (ts.isCallExpression(current)) {
        const nestedBinding = ownCallee(current.expression);
        if (nestedBinding?.kind === 'builder' && current !== call) {
          report(
            nestedBinding.owned
              ? 'SNAPBACK_GRAPH_RECURSION_FORBIDDEN'
              : 'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
            current,
            nestedBinding.owned
              ? 'a graph declaration may not invoke another graph declaration recursively'
              : 'nested defineGraphQuery binding does not resolve to the codegen-owned export',
          );
          return;
        }
        const inArgs = propertyPath[0] === 'args';
        const inFilters = propertyPath.includes('filters');
        const inOrder = propertyPath.includes('order');
        const helperAllowed = nestedBinding?.kind === 'helper' && (
          (['arg', 'lit', 'literal', 'eq', 'ltFilter', 'lteFilter', 'gtFilter', 'gteFilter'].includes(nestedBinding.name) && inFilters)
          || (['asc', 'desc'].includes(nestedBinding.name) && inOrder)
        );
        if (nestedBinding?.kind === 'helper' && nestedBinding.name === 'arg' && !inFilters) {
          report(
            'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
            current,
            'an argument helper may bind only a closed filter value, never graph shape',
          );
        } else if (!(helperAllowed || (nestedBinding?.kind === 'validator' && inArgs))) {
          report(
            'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
            current,
            'graph values may call only codegen-owned helpers in their declared literal positions',
          );
          return;
        }
        for (const argument of current.arguments) inspect(argument, propertyPath);
        return;
      }
      if (ts.isObjectLiteralExpression(current)) {
        for (const property of current.properties) {
          if (ts.isSpreadAssignment(property)) {
            report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', property, 'defineGraphQuery source carrier may not use object spread');
            continue;
          }
          const named = graphPropertyName(property);
          if (named.computed) {
            report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', property.name, 'computed graph property keys are dynamic construction');
          }
          if (ts.isPropertyAssignment(property)) {
            inspect(property.initializer, [...propertyPath, named.name]);
          } else if (ts.isShorthandPropertyAssignment(property)) {
            inspect(property.name, [...propertyPath, named.name]);
          } else {
            report('SNAPBACK_GRAPH_CODE_FORBIDDEN', property, 'graph objects admit data properties only');
          }
        }
        return;
      }
      if (ts.isArrayLiteralExpression(current)) {
        for (const element of current.elements) {
          if (ts.isOmittedExpression(element)) {
            report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', current, 'graph arrays must be dense literal arrays');
          } else {
            inspect(element, propertyPath);
          }
        }
        return;
      }
      if (ts.isIdentifier(current)) {
        const property = propertyPath.at(-1);
        if ((property === 'table' || property === 'targetTable')
          && bindings.isDeclaredTableBinding(current, path, sourceFile)) return;
        report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', current, 'identifier references are unavailable outside declared table/helper positions');
        return;
      }
      if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        report('SNAPBACK_GRAPH_CODE_FORBIDDEN', current, 'dynamic property access is executable graph data');
        return;
      }
      report('SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', current, 'graph values must be a syntactic object/array/primitive literal tree');
    };
    inspect(spec);
  }
  return [...faults.values()];
}

function validateGraphAuthoringGraph(graph, entryPath, entrySource, backendRoot, err) {
  const faults = new Map();
  const modules = [...graph.values()]
    .filter(({ path }) => /\.(?:mjs|js|mts|ts)$/iu.test(path))
    .sort((left, right) => compareCodeUnits(
      moduleIdentityLabel(left.path, backendRoot),
      moduleIdentityLabel(right.path, backendRoot),
    ));
  const bindingResolver = graphAuthoringBindingResolver(modules.map((module) => ({
    ...module,
    source: resolve(module.path) === resolve(entryPath) ? entrySource : module.source,
  })));
  for (const module of modules) {
    const source = resolve(module.path) === resolve(entryPath) ? entrySource : module.source;
    const path = moduleIdentityLabel(module.path, backendRoot)
      ?? relative(backendRoot, module.path).split(sep).join('/');
    for (const fault of validateGraphAuthoringSource(source, module.path, bindingResolver)) {
      if (!faults.has(fault.code)) faults.set(fault.code, { ...fault, path });
    }
  }
  for (const fault of [...faults.values()].sort((left, right) => (
    (GRAPH_SOURCE_FAULT_ORDER.get(left.code) ?? 255)
      - (GRAPH_SOURCE_FAULT_ORDER.get(right.code) ?? 255)
  ))) {
    err(fault.code, 'graph', fault.message, {
      sourceSpan: { ...fault.sourceSpan, file: fault.path },
      path: fault.path,
    });
  }
}

const TOP_LEVEL_DEFINITION_BUILDERS = new Set([
  'defineSearchQuery', 'defineVectorQuery', 'defineLiveSearchQuery',
  'defineEphemeral', 'defineCommand', 'defineMediaCommand', 'defineSurface', 'defineLiveQuery',
  'defineQuery', 'defineJobStatusQuery', 'definePushLedgerQuery',
  'defineBoundedChildrenQuery', 'defineSnapshotBatchQuery',
  'defineRelationalQuery', 'defineGraphQuery', 'defineMaintainedProjection', 'defineJsLiveQuery',
  'defineJsQuery', 'defineWriteWithActivity', 'defineMutation',
  'defineJsMutation', 'defineAction', 'defineCron', 'defineRoutes',
  'defineConfig', 'defineAssetUpload', 'assetCollection',
  'query', 'mutation', 'action',
]);

function definitionAttributionFromSource(source, path = 'functions.mjs') {
  const sourceFile = ts.createSourceFile(
    path,
    typeof source === 'string' ? source : '',
    ts.ScriptTarget.ES2022,
    true,
    /\.tsx?$/iu.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const exportedLocals = new Set();
  const exportedNamesByLocal = new Map();
  const builderLocals = new Map();
  const builderModuleSpecifier = (specifier) => (
    specifier === '@expo/snapback-codegen/define'
    || specifier === '@snapback/codegen/define'
    || FAMILIAR_ENTRYPOINTS.has(specifier)
    || /(?:^|\/)generated\/server(?:\.(?:mjs|js|mts|ts))?$/u.test(specifier)
    || /(?:^|\/)familiar\.(?:mjs|js|mts|ts)(?:[?#].*)?$/u.test(specifier)
    || /(?:^|\/)define\.(?:mjs|js|mts|ts)(?:[?#].*)?$/u.test(specifier)
  );
  const hasExport = (node) => ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && builderModuleSpecifier(statement.moduleSpecifier.text)
      && statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const specifier of statement.importClause.namedBindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (TOP_LEVEL_DEFINITION_BUILDERS.has(imported)) {
          builderLocals.set(specifier.name.text, imported);
        }
      }
    }
    if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exportedLocals.add(declaration.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        const local = specifier.propertyName?.text ?? specifier.name.text;
        exportedLocals.add(local);
        exportedNamesByLocal.set(local, specifier.name.text);
      }
    }
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      exportedLocals.add(statement.expression.text);
    }
  }

  const unwrap = (node) => {
    let current = node;
    while (current && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current)
    )) current = current.expression;
    return current;
  };
  const authoredName = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isComputedPropertyName(node)) {
      const expression = unwrap(node.expression);
      if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) return expression.text;
    }
    return null;
  };
  const span = (node) => {
    const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { file: path, line: point.line + 1, column: point.character + 1 };
  };
  const propertySpans = new Map();
  const definitions = [];
  const visitProperties = (node, segments) => {
    const object = unwrap(node);
    if (!object || !ts.isObjectLiteralExpression(object)) return;
    for (const property of object.properties) {
      if (!('name' in property) || !property.name) continue;
      const name = authoredName(property.name);
      if (name === null) continue;
      const next = [...segments, name];
      propertySpans.set(next.join('.'), span(property.name));
      if (ts.isPropertyAssignment(property)) visitProperties(property.initializer, next);
    }
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = unwrap(declaration.initializer);
      if (!ts.isCallExpression(initializer)) continue;
      const callee = unwrap(initializer.expression);
      if (!ts.isIdentifier(callee) || !builderLocals.has(callee.text)) continue;
      const binding = declaration.name.text;
      const exported = exportedLocals.has(binding) || hasExport(statement);
      const exportedBinding = hasExport(statement)
        ? binding
        : exportedNamesByLocal.get(binding) ?? binding;
      const bindingSpan = span(declaration.name);
      propertySpans.set(exportedBinding, bindingSpan);
      visitProperties(initializer.arguments[0], [exportedBinding]);
      definitions.push({
        binding: exportedBinding,
        builder: builderLocals.get(callee.text),
        exported,
        sourceSpan: bindingSpan,
      });
    }
  }
  return { definitions, propertySpans };
}

function definitionPathText(segments) {
  return segments.map((segment, index) => (
    /^\d+$/u.test(String(segment))
      ? `[${segment}]`
      : `${index === 0 ? '' : '.'}${segment}`
  )).join('');
}

function definitionAttributionDetails(attribution, definitionPath) {
  const segments = Array.isArray(definitionPath)
    ? definitionPath.map(String)
    : typeof definitionPath === 'string' && definitionPath.length > 0
      ? definitionPath.split('.')
      : [];
  if (segments.length === 0) return {};
  let sourceSpan = null;
  for (let length = segments.length; length > 0 && sourceSpan === null; length -= 1) {
    sourceSpan = attribution?.propertySpans?.get(segments.slice(0, length).join('.')) ?? null;
  }
  const text = definitionPathText(segments);
  return {
    definitionPath: text,
    details: { definitionPath: segments },
    ...(sourceSpan ? {
      line: sourceSpan.line,
      column: sourceSpan.column,
      sourceSpan,
    } : {}),
  };
}

function inferredDefinitionEvaluationPath(message, attribution) {
  if (!attribution || typeof message !== 'string') return null;
  const mediaCommandRootField = /defineMediaCommand\(\)(?: has unknown field)?\s*([A-Za-z_][A-Za-z0-9_]*)?/u.exec(message);
  if (mediaCommandRootField) {
    const field = mediaCommandRootField[1];
    const candidates = attribution.definitions
      .filter(({ exported, builder }) => exported && builder === 'defineMediaCommand')
      .map(({ binding }) => [binding, ...(field ? [field] : [])])
      .filter((segments) => {
        const key = segments.join('.');
        return attribution.propertySpans.has(key)
          || [...attribution.propertySpans.keys()].some((candidate) => candidate.startsWith(`${key}.`));
      });
    if (candidates.length === 1) return candidates[0];
  }
  const collectionField = /assetCollection\(\)(?: has unknown field)?\s*([A-Za-z_][A-Za-z0-9_]*)?/u.exec(message);
  if (collectionField) {
    const field = collectionField[1];
    const candidates = attribution.definitions
      .filter(({ exported, builder }) => exported && builder === 'assetCollection')
      .map(({ binding }) => [binding, ...(field ? [field] : [])])
      .filter((segments) => {
        const key = segments.join('.');
        return attribution.propertySpans.has(key)
          || [...attribution.propertySpans.keys()].some((candidate) => candidate.startsWith(`${key}.`));
      });
    if (candidates.length === 1) return candidates[0];
  }
  const commandAsset = /defineCommand\(\) asset ([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/u.exec(message);
  if (commandAsset) {
    const [, input, field] = commandAsset;
    const candidates = attribution.definitions
      .filter(({ exported, builder }) => exported && builder === 'defineCommand')
      .map(({ binding }) => [binding, 'assets', input, ...(field ? [field] : [])])
      .filter((segments) => {
        const key = segments.join('.');
        return attribution.propertySpans.has(key)
          || [...attribution.propertySpans.keys()].some((candidate) => candidate.startsWith(`${key}.`));
      });
    if (candidates.length === 1) return candidates[0];
  }
  const mediaCommandField = /defineMediaCommand\(\) (media|mapping|sharing)(?:\s|\.)([A-Za-z_][A-Za-z0-9_]*)?/u.exec(message);
  if (mediaCommandField) {
    const [, group, field] = mediaCommandField;
    const candidates = attribution.definitions
      .filter(({ exported, builder }) => exported && builder === 'defineMediaCommand')
      .map(({ binding }) => [binding, group, ...(field ? [field] : [])])
      .filter((segments) => {
        const key = segments.join('.');
        return attribution.propertySpans.has(key)
          || [...attribution.propertySpans.keys()].some((candidate) => candidate.startsWith(`${key}.`));
      });
    if (candidates.length === 1) return candidates[0];
  }
  const exported = attribution.definitions.filter((definition) => definition.exported);
  return exported.length === 1 ? [exported[0].binding] : null;
}

function authoredPropertySourceSpans(source, label) {
  let tree;
  try {
    if (typeof source !== 'string') return {};
    tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    return {};
  }
  const spans = {};
  const propertyName = (property) => (
    property?.computed
      ? null
      : (property?.key?.name ?? (typeof property?.key?.value === 'string' ? property.key.value : null))
  );
  const findCall = (node, name) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === name) return node;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const entry of value) {
          const found = findCall(entry, name);
          if (found) return found;
        }
      } else {
        const found = findCall(value, name);
        if (found) return found;
      }
    }
    return null;
  };
  const schemaCall = findCall(tree, 'defineSchema');
  const tables = schemaCall?.arguments?.[0];
  if (tables?.type !== 'ObjectExpression') return spans;
  for (const tableProperty of tables.properties) {
    if (tableProperty.type !== 'Property') continue;
    const tableName = propertyName(tableProperty);
    if (!tableName) continue;
    // The table property itself is always an authored repair location, even
    // when its value is a separately declared builder identifier. Field spans
    // remain available below for inline defineTable(...) declarations.
    spans[`table:${tableName}`] = {
      path: label,
      line: tableProperty.key.loc.start.line,
      column: tableProperty.key.loc.start.column + 1,
    };
    const tableCall = findCall(tableProperty.value, 'defineTable');
    const fields = tableCall?.arguments?.[0];
    if (fields?.type !== 'ObjectExpression') continue;
    for (const fieldProperty of fields.properties) {
      if (fieldProperty.type !== 'Property') continue;
      const fieldName = propertyName(fieldProperty);
      if (!fieldName) continue;
      const span = {
        path: label,
        line: fieldProperty.key.loc.start.line,
        column: fieldProperty.key.loc.start.column + 1,
      };
      spans[`${tableName}.${fieldName}`] = span;
      if (!spans[fieldName]) spans[fieldName] = span;
    }
  }
  return spans;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sha256Framed(domain, items) {
  const hash = createHash('sha256');
  const append = (value) => {
    const bytes = Buffer.from(value, 'utf8');
    hash.update(`${bytes.length}:`, 'ascii');
    hash.update(bytes);
  };
  append('snapback-codegen-framed-sha256/v1');
  append(domain);
  append(String(items.length));
  for (const item of items) append(item);
  return hash.digest('hex');
}

/** Pure identity authority used by codegen and golden-vector tests. V0 keeps
 * its historical domains/truncation byte-for-byte; only the closed v1+sessions
 * tuple enters the disjoint serialized namespaces from LLP 0012/0058. */
export function computeArtifactIdentityStrings({
  artifactVersion,
  authMode,
  appId,
  sharedInputItems,
  schemaContentItems,
  bundleContentItems,
  authoredSourceItems = sharedInputItems,
}) {
  const authoredSourceHash = `sha256:${sha256Framed(
    'snapback-codegen/authored-source-hash/v1',
    authoredSourceItems,
  )}`;
  // @ref LLP 0058#disjoint-v1-identity-strings — preserve v0's domains and
  // truncation; v1 sessions uses the three exact full-digest namespaces.
  if (artifactVersion === SCHEMA_VERSION && authMode === 'dev') {
    return {
      inputsHash: sha256Framed('snapback-codegen/inputs-hash/v1', sharedInputItems),
      schemaHash: `sha256:${sha256Framed('snapback-codegen/schema-content-hash/v1', schemaContentItems).slice(0, 16)}`,
      bundleHash: `sha256:${sha256Framed('snapback-codegen/bundle-content-hash/v1', bundleContentItems).slice(0, 16)}`,
      authoredSourceHash,
    };
  }
  if (artifactVersion !== SESSIONS_SCHEMA_VERSION || authMode !== 'sessions') {
    throw codegenError(
      'SNAPBACK_CODEGEN_ARTIFACT_AUTH_TUPLE_UNSUPPORTED',
      `unsupported artifact/auth identity tuple ${artifactVersion} + ${authMode}`,
      { details: { artifactVersion, authMode } },
    );
  }
  const inputsDigest = sha256Framed(
    'snapback-codegen/inputs-hash/snapback.v1/sessions',
    ['schemaFunctionPair', SESSIONS_SCHEMA_VERSION, 'sessions', appId, ...sharedInputItems],
  );
  const schemaDigest = sha256Framed(
    'snapback-codegen/schema-content-hash/snapback.v1/sessions',
    ['schemaManifest', SESSIONS_SCHEMA_VERSION, 'sessions', appId, ...schemaContentItems],
  );
  const bundleDigest = sha256Framed(
    'snapback-codegen/bundle-content-hash/snapback.v1/sessions',
    ['functionManifest', SESSIONS_SCHEMA_VERSION, 'sessions', appId, ...bundleContentItems],
  );
  return {
    inputsHash: `${SESSIONS_SCHEMA_VERSION}:sessions:inputs:sha256:${inputsDigest}`,
    schemaHash: `${SESSIONS_SCHEMA_VERSION}:sessions:schema:sha256:${schemaDigest}`,
    bundleHash: `${SESSIONS_SCHEMA_VERSION}:sessions:function:sha256:${bundleDigest}`,
    authoredSourceHash,
  };
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function dict() {
  return Object.create(null);
}

function codegenWorkerFailure(error) {
  return {
    ok: false,
    diagnostics: [{
      code: 'CODEGEN_WORKER_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: error instanceof Error ? error.message : String(error),
    }],
  };
}

const DEFINITION_EVALUATION_TIMEOUT_MS = 5_000;
const DEFINITION_EVALUATOR_PROCESS_TIMEOUT_MS = 15_000;
const DEFINITION_EVALUATOR_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// @ref LLP 0007#index-contract — whereApplicable is a generated manifest fact,
// not a second authoring syntax for optional unique indexes.
// @ref LLP 0178#2-diagnostic-shape — preserve the existing refusal code while
// teaching the supported declaration only for this exact evaluation message.
function definitionEvaluationMessage(message) {
  const match = /^\[snapback-define\] index ([A-Za-z_][A-Za-z0-9_]*) options has unknown field whereApplicable$/u.exec(message);
  if (match === null) return message;
  return `${message}; codegen derives whereApplicable when { unique: true } indexes a v.optional(...) field. Declare the optional component with v.optional(...) and use .index(${JSON.stringify(match[1])}, fields, { unique: true }).`;
}

const DEFINITION_EVALUATION_DIAGNOSTIC_CODES = new Set([
  'SNAPBACK_AUTH_RECOVERY_POLICY_UNSUPPORTED',
  'SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING',
  'SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID',
  'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED',
  'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE',
  'SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED',
  'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE',
  'SNAPBACK_CUSTOM_AUTHORIZATION_DECLARATION_INVALID',
  'SNAPBACK_CUSTOM_AUTHORIZATION_EVALUATOR_FORM_UNAVAILABLE',
  'SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE',
  'SNAPBACK_CUSTOM_AUTHORIZATION_RETENTION_UNAVAILABLE',
  'SNAPBACK_API_BUDGETS_UNAVAILABLE',
  'SNAPBACK_API_ASK_BUDGETS_INVALID',
  'SNAPBACK_API_ASK_BUDGETS_REQUIRED',
  'SNAPBACK_API_ASK_MANIFEST_INVALID',
  'SNAPBACK_API_ASK_MODEL_INVALID',
  'SNAPBACK_API_ASK_REQUIRES_API',
  'SNAPBACK_DELETE_WHERE_FILTER_INVALID',
  'SNAPBACK_DELETE_WHERE_FILTER_REQUIRED',
  'SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID',
  'SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID',
  'SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID',
  'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN',
  // LLP 0209 source-carrier refusals originate inside the capability-denied
  // definition evaluator. Preserve only the closed ids that defineGraphQuery
  // itself can mint so the CLI receives the same stable refusal vocabulary.
  'SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE',
  'SNAPBACK_GRAPH_ARGUMENT_UNBOUND',
  'SNAPBACK_GRAPH_BOUND_INVALID',
  'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
  'SNAPBACK_GRAPH_CODE_FORBIDDEN',
  'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  'SNAPBACK_GRAPH_INDEX_UNPROVABLE',
  'SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED',
  'SNAPBACK_GRAPH_ORDER_NOT_TOTAL',
  'SNAPBACK_GRAPH_PROJECTION_COUNT_INVALID',
  'SNAPBACK_GRAPH_PROJECTION_OPEN',
  'SNAPBACK_GRAPH_RECURSION_FORBIDDEN',
  'SNAPBACK_GRAPH_ROOT_COUNT_INVALID',
  'SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID',
  'SNAPBACK_GRAPH_SEARCH_UNADMITTED',
  'SNAPBACK_GRAPH_THROUGH_TABLE_UNDECLARED',
  'SNAPBACK_GRAPH_UNBOUNDED_EXPANSION',
  'SNAPBACK_GRAPH_UNKNOWN_FIELD',
  'SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED',
  'SNAPBACK_TABLE_VISIBILITY_ALREADY_DECLARED',
  'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARMS_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_ANY_OF_DUPLICATE_ARM',
  'SNAPBACK_TABLE_VISIBILITY_ANY_OF_NESTED',
  'SNAPBACK_TABLE_VISIBILITY_ANY_OF_PUBLIC_READ_ARM',
  'SNAPBACK_TABLE_VISIBILITY_KIND_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN',
  'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLES_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN',
  'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN',
  'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_INVALID',
  'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_TYPE_MISMATCH',
  'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN',
  'SNAPBACK_TABLE_VISIBILITY_SPEC_INVALID',
  'SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED',
]);

// A second process is intentional even though generate() already uses a
// worker. The generation worker needs filesystem and output authority; this
// evaluator gets none. On the Node 24 LTS baseline, `--permission` denies
// filesystem, child, worker, addon, and inspector capabilities; the VM removes
// process and all network globals as the network boundary. Filesystem
// permission remains the backstop if a future V8/VM escape is discovered.
const ISOLATED_DEFINITION_EVALUATOR = String.raw`
import vm from 'node:vm';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: { message } }));
  process.exit(0);
}

if (typeof process.permission?.has !== 'function') {
  fail('Node permission isolation is unavailable');
}
for (const capability of ['fs.read', 'fs.write', 'child', 'worker', 'addons', 'inspector']) {
  if (process.permission.has(capability)) fail('isolated evaluator unexpectedly has ' + capability);
}

let activeItem = null;
try {
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const values = Object.create(null);
  for (const item of request.items) {
    activeItem = item;
    const sandbox = Object.create(null);
    const context = vm.createContext(sandbox, {
      name: 'snapback-codegen-' + item.label,
      codeGeneration: { strings: false, wasm: false },
    });
    vm.runInContext(
      "(() => {\n" +
        "const denied = (name) => () => { const error = new Error('[snapback-codegen] ambient ' + name + ' is unavailable'); error.code = 'SNAPBACK_CODEGEN_DEFINITION_AMBIENT_UNAVAILABLE'; throw error; };\n" +
        "const denyMethod = (prototype, name) => Object.defineProperty(prototype, name, { value: denied(name), writable: false, configurable: false });\n" +
        "for (const [prototype, names] of [\n" +
          "[String.prototype, ['localeCompare', 'toLocaleLowerCase', 'toLocaleUpperCase']],\n" +
          "[Number.prototype, ['toLocaleString']],\n" +
          "[BigInt.prototype, ['toLocaleString']],\n" +
          "[Date.prototype, ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']],\n" +
          "[Array.prototype, ['toLocaleString']],\n" +
          "[Object.prototype, ['toLocaleString']],\n" +
          "[Object.getPrototypeOf(Uint8Array.prototype), ['toLocaleString']],\n" +
        "]) for (const name of names) denyMethod(prototype, name);\n" +
        "Object.defineProperty(Math, 'random', { value: denied('Math.random'), writable: false, configurable: false });\n" +
        "Object.defineProperty(globalThis, 'Date', { value: undefined, writable: false, configurable: false });\n" +
        "Object.defineProperty(globalThis, 'Intl', { value: undefined, writable: false, configurable: false });\n" +
      "})()",
      context,
      { timeout: ${DEFINITION_EVALUATION_TIMEOUT_MS} },
    );
    vm.runInContext(item.bundle, context, {
      timeout: ${DEFINITION_EVALUATION_TIMEOUT_MS},
      displayErrors: false,
      filename: 'snapback-codegen-' + item.label + '.bundle.js',
    });
    const serialized = sandbox[item.resultKey];
    if (typeof serialized !== 'string') {
      const error = new Error(item.label + ' did not publish a serialized definition');
      error.code = 'SNAPBACK_CODEGEN_DEFINITION_RESULT_MISSING';
      throw error;
    }
    values[item.label] = JSON.parse(serialized);
  }
  process.stdout.write(JSON.stringify({ ok: true, values }));
} catch (error) {
  const errorObject = error !== null && typeof error === 'object';
  process.stdout.write(JSON.stringify({
    ok: false,
    error: {
      name: errorObject && typeof error.name === 'string' ? error.name : null,
      code: errorObject && typeof error.code === 'string' ? error.code : null,
      message: errorObject && typeof error.message === 'string' ? error.message : String(error),
      label: activeItem && typeof activeItem.label === 'string' ? activeItem.label : null,
      path: activeItem && typeof activeItem.sourcePath === 'string' ? activeItem.sourcePath : null,
      definitionPath: errorObject && Array.isArray(error.definitionPath) ? error.definitionPath : null,
    },
  }));
}
`;

async function buildDefinitionBundle(
  entryPath,
  backendDir,
  diagnostics,
  subsystem,
  kind,
  entrySourceOverride = null,
  sourceOverrides = new Map(),
) {
  const graph = new Map();
  const resultKey = `__snapback_definition_${kind}_${sha256(entryPath).slice(0, 16)}`;
  const facadeNamespace = `snapback-definition-${kind}`;
  const facadePath = `${facadeNamespace}:entry`;
  const definePath = join(packageDir(), 'define.mjs');

  const problem = (code, text, detail = {}) => ({
    text,
    detail: { snapbackCode: code, ...detail },
  });

  const addGraphFile = (candidate, importedFrom = null) => {
    const normalizedCandidate = resolve(candidate);
    if (normalizedCandidate === resolve(entryPath)
      && entrySourceOverride !== null
      && !existsSync(normalizedCandidate)) {
      if (!graph.has(normalizedCandidate)) {
        graph.set(normalizedCandidate, {
          path: normalizedCandidate,
          label: moduleIdentityLabel(normalizedCandidate, backendDir),
          source: entrySourceOverride,
          bytes: Buffer.from(entrySourceOverride, 'utf8'),
        });
      }
      return { path: normalizedCandidate, source: entrySourceOverride };
    }
    let capability;
    try {
      capability = resolveFileReadCapability(candidate, {
        allowedRoots: [backendDir, REPO_ROOT],
        codePrefix: 'CODEGEN_IMPORT',
      });
    } catch (error) {
      const isEntry = resolve(candidate) === entryPath;
      const code = error.codegenCode === 'CODEGEN_IMPORT_OUTSIDE_ROOT'
        ? 'CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT'
        : isEntry && error.codegenCode === 'CODEGEN_IMPORT_UNREADABLE'
          ? (kind === 'schema' ? 'SCHEMA_SOURCE_MISSING' : 'FUNCTION_SOURCE_MISSING')
          : error.codegenCode === 'CODEGEN_IMPORT_UNREADABLE'
            ? 'CODEGEN_IMPORT_UNRESOLVED'
            : (error.codegenCode ?? 'CODEGEN_IMPORT_UNRESOLVED');
      return { error: problem(code, `could not resolve local module ${candidate}: ${error.message}`, { path: candidate, importedFrom }) };
    }
    const path = capability.realPath;
    if (graph.has(path)) return { path, source: graph.get(path).source };
    const label = moduleIdentityLabel(path, backendDir);
    if (!label) {
      return { error: problem('CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT', `local module ${path} is outside the app, repository, and a package install; its identity would not be reproducible`, { path, importedFrom }) };
    }
    let bytes;
    let source;
    try {
      bytes = capability.read();
      source = decodeUtf8Source(bytes, path, 'CODEGEN_IMPORT');
    } catch (error) {
      return { error: problem(error.codegenCode ?? 'CODEGEN_IMPORT_UNREADABLE', `could not read local module ${path}: ${error.message}`, { path, importedFrom }) };
    }
    const override = sourceOverrides.get(resolve(path));
    graph.set(path, {
      path,
      label,
      source,
      bytes,
      ...(override?.identity ? { typescriptIdentity: override.identity } : {}),
      ...(override?.runtimeBytes ? { runtimeBytes: override.runtimeBytes } : {}),
    });
    return { path, source, bytes };
  };

  const facade = definitionFacadeSource(entryPath, definePath, resultKey, kind);
  try {
    const result = await esbuild({
      absWorkingDir: REPO_ROOT,
      entryPoints: [facadePath],
      bundle: true,
      format: 'iife',
      platform: 'neutral',
      target: ['es2022'],
      treeShaking: false,
      write: false,
      logLevel: 'silent',
      legalComments: 'none',
      logOverride: { 'empty-import-meta': 'error' },
      banner: {
        js: [
          'const __snapbackApply = Reflect.apply;',
          'const __snapbackObjectKeys = Object.keys;',
          'const __snapbackObjectCreate = Object.create;',
          'const __snapbackObjectDefineProperty = Object.defineProperty;',
          'const __snapbackObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;',
          'const __snapbackObjectGetPrototypeOf = Object.getPrototypeOf;',
          'const __snapbackObjectHasOwn = Object.prototype.hasOwnProperty;',
          'const __snapbackObjectIs = Object.is;',
          'const __snapbackObjectPrototype = Object.prototype;',
          'const __snapbackObjectSetPrototypeOf = Object.setPrototypeOf;',
          'const __snapbackArrayIsArray = Array.isArray;',
          'const __snapbackArrayPrototype = Array.prototype;',
          'const __snapbackNumberIsFinite = Number.isFinite;',
          'const __snapbackReflectOwnKeys = Reflect.ownKeys;',
          'const __snapbackString = String;',
          'const __snapbackSet = Set;',
          'const __snapbackSetHas = Set.prototype.has;',
          'const __snapbackSetAdd = Set.prototype.add;',
          'const __snapbackSetDelete = Set.prototype.delete;',
          'const __snapbackJsonStringify = JSON.stringify;',
        ].join('\n'),
      },
      plugins: [{
        name: 'snapback-definition-graph',
        setup(build) {
          build.onResolve({ filter: /^snapback-definition-(?:schema|functions|routes):entry$/ }, (args) => ({
            path: args.path,
            namespace: facadeNamespace,
          }));
          build.onLoad({ filter: /.*/, namespace: facadeNamespace }, () => ({
            contents: facade,
            loader: 'js',
            resolveDir: dirname(entryPath),
          }));
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'dynamic-import') {
              return { errors: [problem('CODEGEN_DYNAMIC_IMPORT_UNHASHABLE', `${args.importer || entryPath} uses dynamic import(); codegen cannot prove a complete dependency graph`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (args.kind === 'require-call' || args.kind === 'require-resolve') {
              return { errors: [problem('CODEGEN_COMMONJS_LOADER_UNHASHABLE', `${args.importer || entryPath} uses ${args.kind === 'require-resolve' ? 'require.resolve()' : 'require()'}; codegen cannot prove the dependency graph behind CommonJS loaders`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (args.path.startsWith('node:')) {
              return { errors: [problem('CODEGEN_AMBIENT_IMPORT_UNHASHABLE', `${args.importer || entryPath} imports ${args.path}; codegen definitions receive no host builtin capabilities`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            const definitionPackagePath = DEFINITION_PACKAGE_IMPORTS.get(args.path);
            if (!definitionPackagePath && !isLocalModuleSpecifier(args.path)) {
              return { errors: [problem('CODEGEN_AMBIGUOUS_IMPORT', `${args.importer || entryPath} imports bare specifier ${JSON.stringify(args.path)}; use a deterministic relative or file URL`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (/[?#]/.test(args.path)) {
              return { errors: [problem('CODEGEN_AMBIGUOUS_IMPORT', `${args.importer || entryPath} imports ${JSON.stringify(args.path)} with a query/hash identity that codegen does not support`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            let candidate;
            try {
              candidate = definitionPackagePath ?? (args.path.startsWith('file:')
                ? fileURLToPath(args.path)
                : isAbsolute(args.path)
                  ? args.path
                  : resolve(args.resolveDir || dirname(args.importer), args.path));
            } catch (error) {
              return { errors: [problem('CODEGEN_AMBIGUOUS_IMPORT', `${args.importer || entryPath} has invalid local import ${JSON.stringify(args.path)}: ${error.message}`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (!existsSync(candidate) && !/\.[A-Za-z0-9]+$/u.test(candidate)) {
              const inferred = ['.mjs', '.js', '.mts', '.ts']
                .map((extension) => `${candidate}${extension}`)
                .find((path) => existsSync(path));
              if (inferred) candidate = inferred;
            }
            const loaded = addGraphFile(candidate, args.importer || null);
            if (loaded.error) return { errors: [loaded.error] };
            return { path: loaded.path, namespace: 'file' };
          });
          build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
            const loaded = addGraphFile(args.path);
            if (loaded.error) return { errors: [loaded.error] };
            if (!/\.(?:mjs|mts|cjs|cts|js|ts|json)$/i.test(loaded.path)) {
              return { errors: [problem('CODEGEN_IMPORT_UNSUPPORTED', `${loaded.path} is not a supported JavaScript, TypeScript, or JSON definition dependency`, { path: loaded.path })] };
            }
            const override = sourceOverrides.get(resolve(loaded.path));
            const moduleFormat = graphModuleFormat(loaded.path);
            if (!override && moduleFormat.packageJson) {
              const manifest = addGraphFile(moduleFormat.packageJson, loaded.path);
              if (manifest.error) return { errors: [manifest.error] };
              try {
                moduleFormat.commonJs = JSON.parse(manifest.source)?.type !== 'module';
              } catch {
                moduleFormat.commonJs = true;
              }
            }
            if (!override && moduleFormat.commonJs) {
              return { errors: [problem('CODEGEN_COMMONJS_MODULE_UNHASHABLE', `${moduleIdentityLabel(loaded.path, backendDir)} is a CommonJS module${moduleFormat.packageJson ? ` under ${moduleFormat.packageJson}` : ''}; codegen cannot prove its transitive loader graph`, { path: loaded.path })] };
            }
            return {
              contents: override?.javascript
                ?? (resolve(loaded.path) === resolve(entryPath) && entrySourceOverride !== null
                  ? entrySourceOverride
                  : loaded.source),
              loader: override || (resolve(loaded.path) === resolve(entryPath) && entrySourceOverride !== null)
                ? 'js'
                : definitionLoader(loaded.path),
              resolveDir: dirname(loaded.path),
            };
          });
        },
      }],
    });
    const output = result.outputFiles?.[0]?.text;
    if (typeof output !== 'string') {
      throw codegenError(
        'SNAPBACK_CODEGEN_BUNDLE_OUTPUT_MISSING',
        'esbuild did not return the in-memory definition bundle',
        { path: entryPath },
      );
    }
    return { graph, bundle: output, resultKey, sourcePath: entryPath };
  } catch (error) {
    const failures = Array.isArray(error?.errors) && error.errors.length > 0 ? error.errors : [error];
    for (const failure of failures) {
      const detail = failure?.detail && typeof failure.detail === 'object' ? failure.detail : {};
      const code = detail.snapbackCode ?? failure?.code
        ?? (failure?.text?.includes('Top-level await') && failure?.location?.lineText?.includes('import(')
          ? 'CODEGEN_DYNAMIC_IMPORT_UNHASHABLE'
          : 'CODEGEN_MODULE_PARSE_FAILED');
      diagnostics.push({
        code,
        severity: 'error',
        subsystem,
        message: failure?.text ?? failure?.message ?? String(failure),
        ...(detail.path ? { path: detail.path } : {}),
        ...(detail.importedFrom ? { importedFrom: detail.importedFrom } : {}),
        ...(detail.specifier ? { specifier: detail.specifier } : {}),
        ...(failure?.location ? {
          path: failure.location.file || detail.path,
          line: failure.location.line,
          column: failure.location.column + 1,
        } : {}),
      });
    }
    return null;
  }
}

function definitionFacadeSource(entryPath, definePath, resultKey, kind) {
  const entry = JSON.stringify(entryPath);
  const define = JSON.stringify(definePath);
  const imports = `import { isAssetCollectionDef, isAssetUploadDef, isCommandDef, isConfigDef, isCronDef, isEphemeralCollectionDef, isEphemeralDef, isFunctionDef, isMaintainedProjectionDef, isRoutesDef, isSurfaceBinding, isSurfaceDef, isTableDef } from ${define};`;
const normalization = String.raw`
function __snapbackPathAppend(path, segment) {
  const next = [];
  __snapbackApply(__snapbackObjectSetPrototypeOf, null, [next, null]);
  for (let index = 0; index < path.length; index += 1) {
    __snapbackApply(__snapbackObjectDefineProperty, null, [next, __snapbackString(index), {
      value: path[index], enumerable: true, configurable: true, writable: true,
    }]);
  }
  __snapbackApply(__snapbackObjectDefineProperty, null, [next, __snapbackString(path.length), {
    value: segment, enumerable: true, configurable: true, writable: true,
  }]);
  return next;
}
function __snapbackPathText(path) {
  let output = '';
  for (let index = 0; index < path.length; index += 1) {
    const segment = __snapbackString(path[index]);
    output += /^\d+$/.test(segment) ? '[' + segment + ']' : (index === 0 ? segment : '.' + segment);
  }
  return output;
}
function __snapbackFail(code, message, path = []) {
  const error = new Error(message);
  error.code = code;
  error.definitionPath = path;
  const renderedPath = __snapbackPathText(path);
  if (renderedPath) error.message += ' at ' + renderedPath;
  throw error;
}
function __snapbackDefinitionKind(value) {
  if (isFunctionDef(value)) return 'function';
  if (isAssetUploadDef(value)) return 'asset-upload';
  if (isAssetCollectionDef(value)) return 'asset-collection';
  if (isCommandDef(value)) return 'command';
  if (isCronDef(value)) return 'cron';
  if (isConfigDef(value)) return 'config';
  if (isEphemeralCollectionDef(value)) return 'ephemeral-collection';
  if (isRoutesDef(value)) return 'routes';
  if (isMaintainedProjectionDef(value)) return 'maintained-projection';
  if (isSurfaceDef(value)) return 'surface';
  return null;
}
function __snapbackKnownMarkerKind(value) {
  const definitionKind = __snapbackDefinitionKind(value);
  if (definitionKind !== null) return definitionKind;
  if (isTableDef(value)) return 'table';
  if (isEphemeralDef(value)) return 'ephemeral';
  if (isSurfaceBinding(value)) return 'surface-binding';
  return null;
}
function __snapbackOwnDescriptor(value, key) {
  return __snapbackApply(__snapbackObjectGetOwnPropertyDescriptor, null, [value, key]);
}
function __snapbackIsDataDescriptor(descriptor) {
  return __snapbackApply(__snapbackObjectHasOwn, descriptor, ['value']);
}
function __snapbackNormalize(value, path = [], stack = new __snapbackSet()) {
  const valueType = typeof value;
  if (value === null || valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') {
    if (!__snapbackNumberIsFinite(value) || __snapbackObjectIs(value, -0)) {
      __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_NUMBER_INVALID', 'definition numbers must be finite canonical JSON numbers (negative zero is unavailable)', path);
    }
    return value;
  }
  if (valueType !== 'object') __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE', 'definition values must be strict JSON data; undefined, functions, symbols, and bigint are unavailable', path);
  if (__snapbackApply(__snapbackSetHas, stack, [value])) __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_CYCLE', 'definition values must not contain cycles', path);
  __snapbackApply(__snapbackSetAdd, stack, [value]);
  let output;
  if (__snapbackArrayIsArray(value)) {
    if (__snapbackApply(__snapbackObjectGetPrototypeOf, null, [value]) !== __snapbackArrayPrototype) {
      __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_ARRAY_PROTOTYPE_INVALID', 'definition arrays must use the intrinsic Array prototype', path);
    }
    const ownKeys = __snapbackApply(__snapbackReflectOwnKeys, null, [value]);
    if (ownKeys.length !== value.length + 1) {
      __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_ARRAY_SHAPE_INVALID', 'definition arrays must be dense and must not carry extra or symbol properties', path);
    }
    output = [];
    __snapbackApply(__snapbackObjectSetPrototypeOf, null, [output, null]);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = __snapbackOwnDescriptor(value, __snapbackString(index));
      if (!descriptor) __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_ARRAY_HOLE', 'definition arrays must not contain holes', __snapbackPathAppend(path, index));
      if (!descriptor.enumerable || !__snapbackIsDataDescriptor(descriptor)) {
        __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_ARRAY_ACCESSOR', 'definition arrays must contain enumerable data elements, not accessors', __snapbackPathAppend(path, index));
      }
      output[index] = __snapbackNormalize(descriptor.value, __snapbackPathAppend(path, index), stack);
    }
  } else {
    const markerKind = __snapbackKnownMarkerKind(value);
    const prototype = __snapbackApply(__snapbackObjectGetPrototypeOf, null, [value]);
    if (prototype !== null && prototype !== __snapbackObjectPrototype && markerKind !== 'table') {
      __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID', 'definition objects must be plain JSON objects', path);
    }
    output = __snapbackObjectCreate(null);
    let markerSeen = false;
    const ownKeys = __snapbackApply(__snapbackReflectOwnKeys, null, [value]);
    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      const key = ownKeys[keyIndex];
      const descriptor = __snapbackOwnDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !__snapbackIsDataDescriptor(descriptor)) {
        __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_OBJECT_DESCRIPTOR_INVALID', 'definition objects must contain enumerable data properties, not accessors or hidden state', __snapbackPathAppend(path, key));
      }
      if (typeof key === 'symbol') {
        if (markerKind === null || markerSeen || descriptor.value !== true) {
          __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_OBJECT_SYMBOL_KEY_INVALID', 'definition objects must not contain symbol-keyed data', path);
        }
        markerSeen = true;
        continue;
      }
      if (markerKind !== null && key === '__snapbackDefinitionKind') {
        __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_RESERVED_FIELD', 'definition objects must not define the reserved __snapbackDefinitionKind field', __snapbackPathAppend(path, key));
      }
      output[key] = __snapbackNormalize(descriptor.value, __snapbackPathAppend(path, key), stack);
    }
    if (markerKind !== null && !markerSeen) __snapbackFail('SNAPBACK_CODEGEN_DEFINITION_MARKER_INVALID', 'definition builder marker must be an own data property', path);
    const definitionKind = __snapbackDefinitionKind(value);
    if (definitionKind !== null) output.__snapbackDefinitionKind = definitionKind;
  }
  __snapbackApply(__snapbackSetDelete, stack, [value]);
  return output;
}
`;
  if (kind === 'schema') {
    // Besides the default export, capture each named export's isolated-
    // definition kind: a defineAssetUpload (or any handler-family
    // definition) exported from the schema module would otherwise vanish
    // silently at evaluation (0137 A1: schema-module intent ignored).
    return `${imports}\nimport schema, * as __schemaNamespace from ${entry};\n${normalization}\nconst __misplaced = {};\nfor (const [__name, __value] of Object.entries(__schemaNamespace)) {\n  if (__name === 'default') continue;\n  const __kind = __value && typeof __value === 'object' ? __snapbackDefinitionKind(__value) : null;\n  if (typeof __kind === 'string') __misplaced[__name] = __kind;\n}\nglobalThis[${JSON.stringify(resultKey)}] = __snapbackJsonStringify({ schema: __snapbackNormalize(schema, __snapbackPathAppend([], 'default')), misplacedDefinitions: __misplaced });\n`;
  }
  if (kind === 'routes') {
    // The route manifest declaration (LLP 0092 §0C.1): one default-exported
    // defineRoutes(...) value, normalized under the same isolation rules.
    return `${imports}\nimport routes from ${entry};\n${normalization}\nglobalThis[${JSON.stringify(resultKey)}] = __snapbackJsonStringify(__snapbackNormalize(routes, __snapbackPathAppend([], 'default')));\n`;
  }
  return `${imports}\nimport * as definitions from ${entry};\n${normalization}\nconst output = __snapbackObjectCreate(null);\nconst definitionNames = __snapbackObjectKeys(definitions);\nfor (let nameIndex = 0; nameIndex < definitionNames.length; nameIndex += 1) {\n  const name = definitionNames[nameIndex];\n  if (__snapbackDefinitionKind(definitions[name]) !== null) output[name] = __snapbackNormalize(definitions[name], __snapbackPathAppend([], name));\n}\nglobalThis[${JSON.stringify(resultKey)}] = __snapbackJsonStringify(output);\n`;
}

function definitionLoader(path) {
  if (/\.json$/i.test(path)) return 'json';
  if (/\.(?:ts|mts)$/i.test(path)) return 'ts';
  return 'js';
}

function evaluateDefinitionBundles(
  schemaBuild,
  functionsBuild,
  diagnostics,
  routesBuild = null,
  functionDefinitionAttribution = null,
) {
  if (!process.allowedNodeEnvironmentFlags.has('--permission')) {
    diagnostics.push({
      code: 'CODEGEN_ISOLATED_EVALUATOR_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: 'codegen requires Node 24 or newer for stable filesystem permission isolation',
    });
    return Promise.resolve(null);
  }
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ['--permission', '--input-type=module', '--eval', ISOLATED_DEFINITION_EVALUATOR], {
      cwd: REPO_ROOT,
      env: {},
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const fail = (message, extra = {}) => {
      if (settled) return;
      diagnostics.push({
        code: 'CODEGEN_ISOLATED_EVALUATOR_FAILED',
        severity: 'error',
        subsystem: 'codegen',
        message,
        ...extra,
      });
      finish(null);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`isolated definition evaluation exceeded ${DEFINITION_EVALUATOR_PROCESS_TIMEOUT_MS} ms`);
    }, DEFINITION_EVALUATOR_PROCESS_TIMEOUT_MS);
    child.once('error', (error) => fail(`could not start the isolated definition evaluator: ${error.message}`, { error: error.message }));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > DEFINITION_EVALUATOR_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        fail('isolated definition evaluator output exceeded the 16 MiB protocol limit');
      }
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr) <= 1024 * 1024) stderr += chunk;
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        fail(`isolated definition evaluator exited unsuccessfully (code ${code}, signal ${signal})${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
        return;
      }
      let response;
      try {
        response = JSON.parse(stdout);
      } catch (error) {
        fail(`isolated definition evaluator returned invalid JSON: ${error.message}`);
        return;
      }
      if (!response?.ok) {
        const evaluationCode = response?.error?.code;
        // R6: the evaluator reuses this code for malformed/missing `returns`
        // and for the genuine disposition-4 composite. Only the latter is a
        // truthful profile-switch suggestion.
        const resultProfileSwitch = evaluationCode === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE'
          && /\breturns .+ cannot lower exactly\b/u.test(response?.error?.message ?? '')
          ? {
              profileSwitchSuggestion: {
                from: FAMILIAR_AUTHORING_PROFILE,
                to: EXPLICIT_AUTHORING_PROFILE,
                route: 'result:',
              },
            }
          : {};
        const attribution = response?.error?.label === 'functions'
          ? definitionAttributionDetails(
              functionDefinitionAttribution,
              response?.error?.definitionPath
                ?? inferredDefinitionEvaluationPath(
                  response?.error?.message,
                  functionDefinitionAttribution,
                ),
            )
          : {};
        const collectionRemediation = evaluationCode === 'SNAPBACK_MEDIA_COLLECTION_DECLARATION_INVALID'
          ? 'Pass assetCollection() exactly { ownerTable, intent, maxItems, order, kinds, grants }; remove unknown fields.'
          : null;
        diagnostics.push({
          code: DEFINITION_EVALUATION_DIAGNOSTIC_CODES.has(evaluationCode)
              || /^SNAPBACK_CODEGEN_[A-Z0-9_]+$/u.test(evaluationCode ?? '')
              || /^SNAPBACK_MEDIA_COLLECTION_[A-Z0-9_]+$/u.test(evaluationCode ?? '')
              || /^SNAPBACK_MEDIA_COMMAND_[A-Z0-9_]+$/u.test(evaluationCode ?? '')
            ? evaluationCode
            : 'CODEGEN_MODULE_EVALUATION_FAILED',
          severity: 'error',
          subsystem: 'codegen',
          message: definitionEvaluationMessage(
            response?.error?.message ?? 'isolated definition evaluation failed',
          ),
          ...(response?.error?.name ? { errorName: response.error.name } : {}),
          ...(response?.error?.path ? { path: response.error.path } : {}),
          ...handlerDiagnosticDetails(evaluationCode),
          ...resultProfileSwitch,
          ...attribution,
          ...(collectionRemediation === null ? {} : {
            details: {
              ...(attribution.details ?? {}),
              remediation: collectionRemediation,
            },
          }),
        });
        finish(null);
        return;
      }
      if (!response.values || typeof response.values.schema !== 'object' || response.values.schema === null || typeof response.values.functions !== 'object' || response.values.functions === null) {
        fail('isolated definition evaluator returned an invalid result shape');
        return;
      }
      if (routesBuild && (typeof response.values.routes !== 'object' || response.values.routes === null)) {
        fail('isolated definition evaluator returned an invalid routes result shape');
        return;
      }
      // The schema payload carries the normalized default export plus the
      // named-export definition kinds the facade captured (0137 A1: a
      // definition exported from schema.mjs must refuse, never vanish).
      const schemaPayload = response.values.schema;
      const wrapped = typeof schemaPayload.schema === 'object' && schemaPayload.schema !== null;
      finish({
        schema: wrapped ? schemaPayload.schema : schemaPayload,
        schemaMisplacedDefinitions: wrapped ? (schemaPayload.misplacedDefinitions ?? {}) : {},
        functions: response.values.functions,
        ...(routesBuild ? { routes: response.values.routes } : {}),
      });
    });
    child.stdin.on('error', (error) => fail(`could not send definition bundles to the isolated evaluator: ${error.message}`));
    child.stdin.end(JSON.stringify({
      items: [
        { label: 'schema', bundle: schemaBuild.bundle, resultKey: schemaBuild.resultKey, sourcePath: schemaBuild.sourcePath },
        { label: 'functions', bundle: functionsBuild.bundle, resultKey: functionsBuild.resultKey, sourcePath: functionsBuild.sourcePath },
        ...(routesBuild
          ? [{ label: 'routes', bundle: routesBuild.bundle, resultKey: routesBuild.resultKey, sourcePath: routesBuild.sourcePath }]
          : []),
      ],
    }));
  });
}

/// Cross-plan and cross-function validation for maintained projections
/// (LLP 0080 §5/§Acceptance): generation refuses chains/diamonds, duplicate
/// outputs, an unprovable per-source write budget, any function writing an
/// output table, a raw HostPlan read of an owner-visible output without its
/// visibility predicate, and opaque handler access to an output table. The
/// per-plan rules were already proved by defineMaintainedProjection against
/// the installed table builders; activation re-proves everything server-side.
function buildMaintainedProjections(projectionDefs, functions, err) {
  const projections = [];
  const seenIds = new Set();
  const outputs = new Map();
  for (const { exportName, def } of projectionDefs) {
    const plan = def.plan;
    if (seenIds.has(plan.id)) {
      err('PROJECTION_DUPLICATE_ID', 'projection', `${exportName}: duplicate projection id ${plan.id}`, { projection: plan.id });
      continue;
    }
    seenIds.add(plan.id);
    if (outputs.has(plan.outputTable)) {
      err('PROJECTION_OUTPUT_SHARED', 'projection', `${exportName}: output table ${plan.outputTable} already belongs to projection ${outputs.get(plan.outputTable)}`, { projection: plan.id, table: plan.outputTable });
      continue;
    }
    outputs.set(plan.outputTable, plan.id);
    projections.push(plan);
  }
  for (const plan of projections) {
    for (const source of [plan.root, plan.joined]) {
      if (outputs.has(source)) {
        err('PROJECTION_CHAIN_REFUSED', 'projection', `projection ${plan.id} sources ${source}, which is projection ${outputs.get(source)}'s output; chains and diamonds are refused at generation`, { projection: plan.id, table: source });
      }
    }
  }
  // Static per-source write budget: one direct write plus every plan's
  // worst-case output writes from a single-row non-key-moving mutation.
  const budget = new Map();
  for (const plan of projections) {
    budget.set(plan.root, (budget.get(plan.root) ?? 1) + 1);
    budget.set(plan.joined, (budget.get(plan.joined) ?? 1) + plan.fanOutLimit);
  }
  for (const [source, writes] of budget) {
    if (writes > 1_024) {
      err('PROJECTION_WRITE_BUDGET_EXCEEDED', 'projection', `a single-row mutation of ${source} could require ${writes} writes across direct effects and projections; the mutation bound is 1024`, { table: source, writes });
    }
  }
  if (projections.length === 0) return projections;
  const ownerOutputs = new Map(
    projections
      .filter((plan) => plan.outputVisibility !== 'public-read')
      .map((plan) => [plan.outputTable, plan.outputVisibility.owner.field]),
  );
  for (const fn of functions) {
    const hostPlan = fn.runtime?.HostPlan;
    const mutationSteps = hostPlan?.Mutation?.steps ?? [];
    for (const step of mutationSteps) {
      const target = Object.values(step)[0]?.table;
      if (target && outputs.has(target) && !('Get' in step) && !('Guard' in step) && !('Let' in step)) {
        err('PROJECTION_OUTPUT_WRITE_DENIED', 'projection', `${fn.name}: writes projection output table ${target}; outputs are maintained only by their source mutations`, { function: fn.name, table: target });
      }
    }
    const queryPlan = hostPlan?.Query;
    if (queryPlan && ownerOutputs.has(queryPlan.table)) {
      const ownerField = ownerOutputs.get(queryPlan.table);
      const enforced = (queryPlan.filters ?? []).some((filter) => (
        filter.field === ownerField && filter.op === 'Eq' && filter.value === 'AuthUserId'
      ));
      if (!enforced) {
        err('PROJECTION_OUTPUT_READ_UNENFORCED', 'projection', `${fn.name}: reads owner-visible projection output ${queryPlan.table} without composing its visibility predicate`, { function: fn.name, table: queryPlan.table });
      }
    }
    if (fn.runtime?.IbexModule) {
      for (const table of [...(fn.declaredReads ?? []), ...(fn.declaredWrites ?? [])]) {
        if (outputs.has(table)) {
          err('PROJECTION_OUTPUT_OPAQUE_ACCESS', 'projection', `${fn.name}: declares opaque access to projection output ${table}; nothing proves an opaque handler applies the output visibility predicate`, { function: fn.name, table });
        }
      }
    }
  }
  return projections;
}

// Identity-binding tables have one deliberately unwired writer: verified
// provisioning. Reject every codegen-expressible non-provisioning write role
// at authoring time, after generated functions and seeds have been closed.
// Migrations are operator artifacts rather than codegen writers and remain
// governed by the migration authorization boundary.
function refuseGeneratedIdentityBindingWriters(
  identityBindingTables,
  functions,
  projections,
  parsedSeed,
  err,
) {
  const sealed = new Set(identityBindingTables.map(({ table }) => table));
  if (sealed.size === 0) return;

  for (const fn of functions) {
    const writes = fn.writeSetSummary ?? writeSummary(fn);
    for (const table of new Set(writes.tables ?? [])) {
      if (!sealed.has(table)) continue;
      err(
        'SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN',
        'auth',
        `${fn.name}: codegen function write target ${table} is a sealed identity-binding table; only verified provisioning may write it`,
        { function: fn.name, table, writerRole: 'function' },
      );
    }
  }

  for (const projection of projections) {
    if (!sealed.has(projection.outputTable)) continue;
    err(
      'SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN',
      'auth',
      `${projection.id}: maintained-projection output ${projection.outputTable} is a sealed identity-binding table; only verified provisioning may write it`,
      { projection: projection.id, table: projection.outputTable, writerRole: 'maintainedProjection' },
    );
  }

  for (const { tables, label, writerRole } of [
    { tables: parsedSeed?.artifact?.tables, label: 'versioned seed', writerRole: 'versionedSeed' },
    { tables: parsedSeed?.seed?.tables, label: 'legacy seed', writerRole: 'legacySeed' },
  ]) {
    for (const [table, rows] of Object.entries(tables ?? {})) {
      if (!sealed.has(table) || !Array.isArray(rows) || rows.length === 0) continue;
      err(
        'SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN',
        'auth',
        `${label} rows target sealed identity-binding table ${table}; only verified provisioning may write it`,
        { table, writerRole },
      );
    }
  }
}

function isIsolatedDefinition(value, expectedKind) {
  return Boolean(value && typeof value === 'object' && value.__snapbackDefinitionKind === expectedKind);
}

function graphModuleFormat(path) {
  if (/\.(?:cjs|cts)$/i.test(path)) return { commonJs: true, packageJson: null };
  if (!/\.(?:js|ts)$/i.test(path) || /\.(?:mjs|mts)$/i.test(path)) {
    return { commonJs: false, packageJson: null };
  }
  const packageJson = nearestPackageJson(path);
  if (!packageJson) return { commonJs: true, packageJson: null };
  // The caller loads and hashes this manifest through addGraphFile before
  // deciding the format, so classification and identity use the same fd bytes.
  return { commonJs: null, packageJson };
}

function nearestPackageJson(path) {
  let directory = dirname(path);
  for (;;) {
    // Node package scopes never inherit across a node_modules boundary. A
    // manifest-less dependency is therefore CommonJS even when the consuming
    // app has `type: module`; walking through this directory would classify
    // the bytes differently from Node and leave computed CJS loads unhashed.
    if (directory.split(sep).at(-1) === 'node_modules') return null;
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function moduleGraphIdentity(graph, backendDir) {
  return [...graph.values()]
    .map(({ path, bytes, runtimeBytes, typescriptIdentity }) => [
      moduleIdentityLabel(path, backendDir),
      bytes,
      ...(typescriptIdentity
        ? [
            'definition-typescript',
            typescriptIdentity.sourceProfile,
            typescriptIdentity.transformVersion,
            typescriptIdentity.compilerVersion,
            typescriptIdentity.compilerIntegrity,
            runtimeBytes,
          ]
        : []),
    ])
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .flat();
}

function authoredModuleGraphIdentity(graph, backendDir) {
  return [...graph.values()]
    .map(({ path, bytes }) => [moduleIdentityLabel(path, backendDir), bytes])
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .flatMap(([label, source]) => (
      label?.startsWith('toolchain:') === true ? [label] : [label, source]
    ));
}

function moduleIdentityLabel(path, backendDir) {
  let appRoot;
  try {
    appRoot = realpathSync(backendDir);
  } catch {
    appRoot = resolve(backendDir);
  }
  const appRelative = relative(appRoot, path);
  if (isPathInside(appRelative)) return `app:${appRelative.split(sep).join('/')}`;
  const toolchainRelative = relative(packageDir(), path);
  if (isPathInside(toolchainRelative)) {
    return `toolchain:@expo/snapback-codegen/${toolchainRelative.split(sep).join('/')}`;
  }
  const repoRelative = relative(REPO_ROOT, path);
  if (isPathInside(repoRelative)) return `repo:${repoRelative.split(sep).join('/')}`;
  const normalized = path.split(sep).join('/');
  const marker = '/node_modules/';
  const packageIndex = normalized.lastIndexOf(marker);
  if (packageIndex !== -1) return `package:${normalized.slice(packageIndex + marker.length)}`;
  return null;
}

function isPathInside(path) {
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function isLocalModuleSpecifier(specifier) {
  return specifier.startsWith('./')
    || specifier.startsWith('../')
    || specifier.startsWith('file:')
    || isAbsolute(specifier);
}

function validateContractModuleFilenames(modules, err) {
  const seen = new Map();
  for (const module of modules) {
    const key = module.file.toLowerCase();
    const prior = seen.get(key);
    if (prior) {
      err('CODEGEN_CONTRACT_MODULE_FILENAME_COLLISION', 'contract', `${module.file} collides case-insensitively with ${prior}`, { file: module.file, collidesWith: prior });
    } else {
      seen.set(key, module.file);
    }
  }

}

// Version labels are durable identities. A materialized or cached graph is
// prior evidence even when its source checkout has moved on; reusing the
// label for different canonical bytes fails before the next graph is written.
// @ref LLP 0109#16-final-author-reconciliation-after-round-3 — version reuse is
// a deterministic codegen refusal, not a runtime best effort.
function validateSeedVersionEvidence(backendRoot, outputDirectory, candidate) {
  const evidence = new Set([
    join(backendRoot, outputDirectory, 'seed.artifact.json'),
  ]);
  const cacheRoot = join(
    codegenProjectRoot(backendRoot),
    '.snapback',
    'codegen-cache',
  );
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        evidence.add(join(cacheRoot, entry.name, 'seed.artifact.json'));
      }
    }
  }
  for (const path of evidence) {
    if (!existsSync(path)) continue;
    let prior;
    try {
      prior = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      const error = new Error(`prior seed identity evidence is invalid at ${path}`);
      error.code = 'SNAPBACK_SEED_EVIDENCE_INVALID';
      error.details = { path };
      throw error;
    }
    if (
      prior?.appId === candidate.appId
      && prior?.seedVersion === candidate.seedVersion
      && prior?.seedDigest !== candidate.seedDigest
    ) {
      const error = new Error(
        `seedVersion ${JSON.stringify(candidate.seedVersion)} was already used for different seed bytes`,
      );
      error.code = 'SNAPBACK_SEED_VERSION_REUSED';
      error.details = {
        appId: candidate.appId,
        seedVersion: candidate.seedVersion,
        priorDigest: prior.seedDigest ?? null,
        candidateDigest: candidate.seedDigest,
      };
      throw error;
    }
  }
}

function writeGeneratedOutput(outDir, {
  schemaManifest,
  functionManifest,
  authorizationReview,
  visibilityGovernance,
  normalizedDefinition,
  handlerRuntimeProfile,
  clientLifecycleManifest,
  capabilityManifest,
  handlerTypeScriptProfile,
  routesManifest,
  providerIntrospection,
  providerBindingMetadata,
  providerBindingTypes,
  contractManifest,
  appDescriptorSource,
  contentAddressedDescriptorFile,
  appBindingModule,
  contentAddressedAppBindingFile,
  contentAddressedAppBindingModule,
  appModule,
  appTypes,
  apiModule,
  apiFlatModule,
  apiTypes,
  familiarServerModule,
  familiarServerTypes,
  apiEnvelopeMembers,
  microArtifacts,
  operationSchemas,
  remoteServicePublication,
  contractModules,
  packageJson,
  seedArtifact,
  seedAssetFixtures,
  trustedCompositionActivation,
  artifactIndex,
}) {
  const contractOutDir = join(outDir, 'contract');
  const operationsOutDir = join(outDir, 'operations');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(contractOutDir, { recursive: true });
  mkdirSync(operationsOutDir, { recursive: true });
  writeFileSync(join(outDir, 'schema.manifest.json'), stableJson(schemaManifest) + '\n');
  writeFileSync(join(outDir, 'functions.manifest.json'), stableJson(functionManifest) + '\n');
  writeFileSync(join(outDir, AUTHORIZATION_REVIEW_FILE), serializeAuthorizationReview(authorizationReview));
  const elevatedReadEntries = authorizationReview.elevatedReadSites;
  writeFileSync(join(outDir, 'elevated-read-site-baseline.json'), stableJson({
    schemaVersion: 'snapback.elevated-read-site-baseline.v1',
    entries: elevatedReadEntries,
    exactSetDigest: `sha256:${createHash('sha256')
      .update(`snapback:elevated-read-site-baseline:v1\n${stableJson(elevatedReadEntries)}`)
      .digest('hex')}`,
  }) + '\n');
  if (visibilityGovernance) {
    writeFileSync(join(outDir, 'visibility-override-owner-baseline.json'),
      stableJson(visibilityGovernance.ownerBaseline) + '\n');
    writeFileSync(join(outDir, 'visibility-override-baseline.json'),
      stableJson(visibilityGovernance.overrideBaseline) + '\n');
    writeFileSync(join(outDir, 'table-visibility-policy-baseline.json'),
      stableJson(visibilityGovernance.policyBaseline) + '\n');
    writeFileSync(join(outDir, 'table-visibility-policy-transition-ledger.json'),
      stableJson(visibilityGovernance.transitionLedger.artifact) + '\n');
    writeFileSync(join(outDir, 'visibility-governance-quarantine-ledger.json'), stableJson(
      visibilityGovernance.quarantine.artifact ?? {
        schemaVersion: 'snapback.visibility-governance-quarantine-ledger.v1',
        records: [],
        retiredIds: [],
        headDigest: visibilityGovernance.quarantine.headDigest,
      },
    ) + '\n');
  }
  writeFileSync(join(outDir, 'normalized-definition.v1.json'), stableJson(normalizedDefinition) + '\n');
  writeFileSync(join(outDir, 'handler-runtime-profile.v1.json'), stableJson(handlerRuntimeProfile) + '\n');
  writeFileSync(join(outDir, CLIENT_LIFECYCLE_MANIFEST_FILE), stableJson(clientLifecycleManifest) + '\n');
  writeFileSync(join(outDir, 'capability.manifest.json'), stableJson(capabilityManifest) + '\n');
  writeFileSync(
    join(outDir, HANDLER_TYPESCRIPT_PROFILE_ARTIFACT_FILE),
    stableJson(handlerTypeScriptProfile) + '\n',
  );
  writeFileSync(
    join(outDir, 'client-lifecycle.manifest.json'),
    stableJson(clientLifecycleManifest) + '\n',
  );
  if (trustedCompositionActivation) {
    writeFileSync(
      join(outDir, TRUSTED_COMPOSITION_ACTIVATION_FILE),
      stableJson(trustedCompositionActivation) + '\n',
    );
  }
  if (routesManifest) {
    writeFileSync(join(outDir, 'routes.manifest.json'), stableJson(routesManifest) + '\n');
  }
  writeFileSync(join(outDir, 'provider-introspection.json'), serializeProviderIntrospection(providerIntrospection));
  writeFileSync(join(outDir, 'provider-bindings.json'), serializeProviderBindingMetadata(providerBindingMetadata));
  writeFileSync(join(outDir, 'provider-bindings.d.ts'), providerBindingTypes);
  writeFileSync(join(outDir, 'contract-data.manifest.json'), stableJson(contractManifest) + '\n');
  writeFileSync(join(outDir, 'app.descriptor.json'), appDescriptorSource);
  writeFileSync(join(outDir, contentAddressedDescriptorFile), appDescriptorSource);
  writeFileSync(join(outDir, 'app.binding.mjs'), appBindingModule);
  writeFileSync(join(outDir, contentAddressedAppBindingFile), contentAddressedAppBindingModule);
  writeFileSync(join(outDir, 'app.mjs'), appModule);
  writeDeclarationPair(outDir, 'app', appTypes);
  writeFileSync(join(outDir, 'api.mjs'), apiModule);
  if (apiFlatModule) writeFileSync(join(outDir, 'api.flat.mjs'), apiFlatModule);
  writeDeclarationPair(outDir, 'api', apiTypes);
  if (familiarServerModule) writeFileSync(join(outDir, 'server.mjs'), familiarServerModule);
  if (familiarServerTypes) writeFileSync(join(outDir, 'server.d.ts'), familiarServerTypes);
  if (microArtifacts) {
    writeFileSync(join(outDir, 'micro.mjs'), microArtifacts.runtimeEntry);
    writeFileSync(join(outDir, 'micro.d.ts'), microArtifacts.declaration);
    writeFileSync(join(outDir, 'micro.profile.json'), stableJson(microArtifacts.profile) + '\n');
  }
  if (apiEnvelopeMembers) {
    writeFileSync(join(outDir, API_ENVELOPE_MEMBERS_FILE), stableJson(apiEnvelopeMembers) + '\n');
  }
  if (seedArtifact) {
    writeFileSync(join(outDir, 'seed.artifact.json'), canonicalSeedArtifactJson(seedArtifact));
  }
  if (seedAssetFixtures) {
    writeFileSync(join(outDir, 'seed.asset-fixtures.artifact.json'), canonicalSeedAssetFixturesJson(seedAssetFixtures));
  }
  for (const schema of operationSchemas) {
    writeFileSync(join(operationsOutDir, schema.file), stableJson(schema.value) + '\n');
  }
  for (const artifact of remoteServicePublication?.artifacts ?? []) {
    writeFileSync(join(outDir, artifact.file), stableJson(artifact.value) + '\n');
  }
  for (const module of contractModules) {
    writeFileSync(join(contractOutDir, module.file), module.source);
  }
  writeFileSync(join(outDir, 'package.json'), generatedPackageJson(packageJson) + '\n');
  if (artifactIndex) {
    writeFileSync(join(outDir, 'artifacts.json'), stableJson(artifactIndex) + '\n');
  }
}

// Package export condition order is semantic: catch-all `default` must follow
// `types`, and type-aware tools should see `types` before runtime conditions.
// Keep every other object key recursively sorted for deterministic artifacts.
function generatedPackageJson(value) {
  const ordered = JSON.parse(stableJson(value));
  for (const [subpath, target] of Object.entries(ordered.exports ?? {})) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
    const conditions = {};
    for (const condition of ['types', 'import', 'require', 'default']) {
      if (Object.hasOwn(target, condition)) conditions[condition] = target[condition];
    }
    for (const condition of Object.keys(target)) {
      if (!Object.hasOwn(conditions, condition)) conditions[condition] = target[condition];
    }
    ordered.exports[subpath] = conditions;
  }
  return JSON.stringify(ordered, null, 2);
}

function replaceDirectory(tmpDir, outDir) {
  const backupDir = `${outDir}.bak-${process.pid}-${Date.now()}`;
  rmSync(backupDir, { recursive: true, force: true });
  const hadExisting = existsSync(outDir);
  if (hadExisting) renameSync(outDir, backupDir);
  try {
    renameSync(tmpDir, outDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (hadExisting && !existsSync(outDir) && existsSync(backupDir)) {
      renameSync(backupDir, outDir);
    }
    throw error;
  }
}

function loadRemoteServiceInputs(backendRoot, appId, targetProfile, err) {
  if (targetProfile !== TARGET_PROFILE_REMOTE) return null;

  const configPath = join(backendRoot, 'remote-service.publication.json');
  let configSource;
  let config;
  try {
    configSource = resolveFileReadCapability(configPath, {
      allowedRoots: [backendRoot],
      allowSymlink: false,
      codePrefix: 'REMOTE_SERVICE_PUBLICATION_CONFIG',
    }).read();
    config = JSON.parse(decodeUtf8Source(configSource, configPath, 'REMOTE_SERVICE_PUBLICATION_CONFIG'));
  } catch (error) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', `remote service publication config is unavailable or invalid: ${error.message}`, { path: configPath });
    return null;
  }

  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const expectedKeys = ['authCapabilityId', 'dataCapabilityId', 'operations', 'profileId', 'targetProfileId'];
  const actualKeys = Object.keys(config).sort();
  if (stableJson(actualKeys) !== stableJson(expectedKeys)) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', 'remote service publication config is not the closed record', { expectedKeys, actualKeys });
  }
  for (const key of ['profileId', 'targetProfileId', 'authCapabilityId', 'dataCapabilityId']) {
    if (typeof config[key] !== 'string' || !idPattern.test(config[key])) {
      err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', `${key} must be a bounded opaque id`, { field: key });
    }
  }
  if (config.profileId !== targetProfile || config.targetProfileId !== targetProfile) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', 'remote profile and target ids must match the selected target', {
      profileId: config.profileId,
      targetProfileId: config.targetProfileId,
      selectedTarget: targetProfile,
    });
  }
  if (!Array.isArray(config.operations) || config.operations.length === 0
      || new Set(config.operations).size !== config.operations.length
      || config.operations.some((name) => typeof name !== 'string' || !IDENT.test(name))) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', 'operations must be a non-empty unique list of function identifiers');
  }

  const dataTierProfile = loadRepositoryArtifact('schemas/data-tier.profile.json', err);
  const corpusPath = dataTierProfile?.value?.publication?.corpusManifestPath;
  const corpusManifest = typeof corpusPath === 'string'
    ? loadRepositoryArtifact(corpusPath, err)
    : null;
  if (!corpusManifest) {
    err('REMOTE_SERVICE_DATA_TIER_INVALID', 'publication', 'data-tier profile does not resolve a corpus manifest');
  }
  const wireSchemas = dict();
  for (const [name, path] of Object.entries(REMOTE_SERVICE_WIRE_SCHEMAS)) {
    wireSchemas[name] = loadRepositoryArtifact(path, err);
  }
  if (!dataTierProfile || !corpusManifest || Object.values(wireSchemas).some((entry) => !entry)) {
    return null;
  }
  const identityEntries = [
    ['remote-service.publication.json', configSource],
    [dataTierProfile.path, dataTierProfile.source],
    [corpusManifest.path, corpusManifest.source],
    ...Object.values(wireSchemas).map((entry) => [entry.path, entry.source]),
  ];
  return {
    appId,
    config,
    dataTierProfile,
    corpusManifest,
    wireSchemas,
    identityInputs: identityEntries.flat(),
  };
}

function loadRepositoryArtifact(path, err) {
  const absolutePath = resolve(TOOLCHAIN_ARTIFACT_ROOT, path);
  try {
    const source = resolveFileReadCapability(absolutePath, {
      allowedRoots: [TOOLCHAIN_ARTIFACT_ROOT],
      allowSymlink: false,
      codePrefix: 'REMOTE_SERVICE_PUBLICATION_INPUT',
    }).read();
    return {
      path,
      source,
      value: JSON.parse(decodeUtf8Source(source, absolutePath, 'REMOTE_SERVICE_PUBLICATION_INPUT')),
      reference: { path, sha256: `sha256:${sha256(source)}` },
    };
  } catch (error) {
    err('REMOTE_SERVICE_PUBLICATION_INPUT_INVALID', 'publication', `published input ${path} is unavailable or invalid: ${error.message}`, { path });
    return null;
  }
}

function packageDir() {
  return dirname(fileURLToPath(import.meta.url));
}

// The server-declared capability manifest for the selected target (LLP 0032
// P2 / LLP 0037): generated from the Rust core by tests/capability_v0.rs
// (SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_) and embedded — this
// module asserts nothing about server capabilities on its own.
function canonicalCapabilityManifestPath(targetProfile, targetConfig) {
  const manifest = targetProfile === TARGET_PROFILE_LOCAL && egressAllowedAtCodegen()
    ? 'capability.manifest.local-dev-sqlite-ibex.outbound-actions.json'
    : targetConfig.capabilityManifest;
  return join(TOOLCHAIN_ARTIFACT_ROOT, 'schemas', manifest);
}

function loadCanonicalCapabilityManifest(err, targetProfile, targetConfig) {
  const path = canonicalCapabilityManifestPath(targetProfile, targetConfig);
  let source;
  let sourceBytes;
  try {
    sourceBytes = resolveFileReadCapability(path, {
      allowedRoots: [TOOLCHAIN_ARTIFACT_ROOT],
      allowSymlink: false,
      codePrefix: 'CODEGEN_CAPABILITY_MANIFEST',
    }).read();
    source = decodeUtf8Source(sourceBytes, path, 'CODEGEN_CAPABILITY_MANIFEST');
  } catch (error) {
    err('CODEGEN_CAPABILITY_MANIFEST_MISSING', 'capability', `the server-declared capability manifest could not be read; regenerate with SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_`, { path, error: error.message });
    return { source: '', manifest: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    err('CODEGEN_CAPABILITY_MANIFEST_INVALID', 'capability', `the server-declared capability manifest is not valid JSON`, { path, error: error.message });
    return { source: '', manifest: null };
  }
  if (manifest?.artifactKind !== 'capabilityManifest' || manifest?.targetProfileId !== targetProfile) {
    err('CODEGEN_CAPABILITY_MANIFEST_MISMATCH', 'capability', `expected a capabilityManifest for ${targetProfile}`, {
      path,
      artifactKind: manifest?.artifactKind ?? null,
      targetProfileId: manifest?.targetProfileId ?? null,
    });
    return { source: '', manifest: null };
  }
  return { source: sourceBytes, manifest };
}

// --- CLI ---------------------------------------------------------------------

// Exported so the demos/_kit/codegen.mjs compatibility shim can delegate its
// own `node demos/_kit/codegen.mjs <backendDir>` invocation here.
export async function runCodegenCli(argv = process.argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const check = args.includes('--check');
  if (check) args.splice(args.indexOf('--check'), 1);
  const targetFlag = args.indexOf('--target-profile');
  let targetProfile = TARGET_PROFILE_LOCAL;
  if (targetFlag !== -1) {
    targetProfile = args[targetFlag + 1];
    args.splice(targetFlag, 2);
  }
  const backendDir = resolve(args[0] ?? join(packageDir(), '..', '..', 'demos', 'todo', 'snapback'));
  const result = await generate(backendDir, { targetProfile, check });
  // @ref LLP 0264#d9-authorization-review-projection — the summary owns the
  // grouped human rendering while --json and authorization-review keep every
  // independently actionable table/site fact.
  const summaryGroupedCodes = groupedCodegenSummaryDiagnosticCodes(
    result.ok ? result.summary : null,
  );
  for (const d of result.diagnostics) {
    if (d.severity === 'warning' && summaryGroupedCodes.has(d.code)) continue;
    console.error(`[${d.severity}] ${d.code} (${d.subsystem}) ${d.message}`);
  }
  if (result.ok) {
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${formatCodegenSummary(result.summary)}\n${check ? 'codegen preflight ok (no artifacts emitted)' : `codegen ok: ${result.outDir}`}  (inputsHash ${result.inputsHash.slice(0, 12)}…)`);
  } else {
    if (json) console.log(JSON.stringify(result, null, 2));
    console.error('codegen failed: no artifacts written (no silent stale output).');
    process.exitCode = 1;
  }
}

function isDirectCliInvocation(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return metaUrl === pathToFileURL(argv1).href;
  }
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  await runCodegenCli(process.argv);
}

// @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions — a
// profile membership table cannot select another declaration's roster or
// generation identity while retaining its own authority-table semantics.
function authorityProfileForMembershipSearch(
  table,
  search,
  authorityProfiles,
  reportAuthorityProfileError,
) {
  const tableProfileDeclaration = table.authorityProfile?.id;
  if (tableProfileDeclaration !== undefined
    && search.visibility.declaration !== tableProfileDeclaration) {
    reportAuthorityProfileError(
      'SNAPBACK_AUTHORITY_PROFILE_SEARCH_DECLARATION_MISMATCH',
      table.name,
      `authority-profile membership table search index ${search.name} names visibility declaration ${search.visibility.declaration} instead of its own declaration ${tableProfileDeclaration}`,
      `Set the index membership visibility declaration to ${JSON.stringify(tableProfileDeclaration)}; cross-declaration membership visibility remains available only on non-profile tables.`,
      {
        compositionClass: 'membership-visible-search.v1',
        index: search.name,
        tableProfileDeclaration,
        visibilityDeclaration: search.visibility.declaration,
      },
    );
    return null;
  }
  return authorityProfiles.get(search.visibility.declaration);
}

// @ref LLP 0277#f11-small-clientcodegen-papercuts--single-run-each — relative
// `.mjs` imports resolve through `.d.mts`; `.d.ts` preserves compatibility.
function writeDeclarationPair(outDir, stem, source) {
  writeFileSync(join(outDir, `${stem}.d.ts`), source);
  writeFileSync(join(outDir, `${stem}.d.mts`), source);
}

function renderFamiliarApiBootstrapTypes() {
  return `${HEADER}\n// Familiar definition bootstrap; replaced by the transactional final projection.\nexport declare const api: Readonly<Record<string, Readonly<Record<string, unknown>>>>;\nexport default api;\n`;
}
