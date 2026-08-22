// Executable handler admission tables and their generated product projection.
// Keep rule metadata here so scanners, diagnostics, and the generated profile
// cannot acquire independent hand-maintained restriction lists.

export const HANDLER_RUNTIME_PROFILE_VERSION = 'snapback.handler-runtime-profile.v1';
export const HANDLER_ADMISSION_VERSION = 'snapback.handler-admission.legacy.v1';
export const HANDLER_GRAPH_RECORD_VERSION = 'snapback.handler-graph-record.v1';
export const HANDLER_GRAPH_EXTRACTOR_VERSION = 'snapback.inline-handler-extractor.v1';
export const HANDLER_RUNTIME_GUIDE = '/_snapback/guide/backend/handler-runtime.md';
export const FAMILIAR_HANDLER_DIALECT_GUIDE = '/_snapback/guide/backend/familiar-profile.md';

const rule = (id, code, phase, alternative, anchor, guide = HANDLER_RUNTIME_GUIDE) => Object.freeze({
  id,
  code,
  phase,
  alternative,
  guideAnchor: `${guide}#${anchor}`,
});

export const INLINE_HANDLER_RULES = Object.freeze({
  builders: Object.freeze([
    'defineJsQuery',
    'defineJsLiveQuery',
    'defineJsMutation',
    'defineAction',
    'defineAssetUpload',
    'query',
    'mutation',
    'action',
  ]),
  globals: Object.freeze([
    'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Infinity', 'JSON', 'Map',
    'Math', 'NaN', 'Number', 'Object', 'Promise', 'RangeError',
    'ReferenceError', 'RegExp', 'Set', 'String', 'SyntaxError', 'TypeError',
    'URIError', 'Uint8Array', 'decodeURI', 'decodeURIComponent', 'encodeURI',
    'encodeURIComponent', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
    'undefined',
  ]),
  reflectionPropertyNames: Object.freeze(['__proto__', 'constructor', 'prototype']),
  objectReflectionMethods: Object.freeze([
    'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors',
    'getOwnPropertyNames', 'getOwnPropertySymbols', 'getPrototypeOf',
    'setPrototypeOf',
  ]),
  queryBuilderVerbs: Object.freeze([
    'withIndex', 'withSearchIndex', 'eq', 'in', 'lt', 'lte', 'gt', 'gte',
    'order', 'take', 'collect', 'first',
  ]),
  // @ref LLP 0248#d1-exact-id-batch-reads — batch reads are finite
  // first-class ctx.db members, not query-builder verbs.
  ctxDbMembers: Object.freeze([
    'get',
    'getMany',
    'uniqueMany',
    'query',
    'elevated',
    'insert',
    'patch',
    'delete',
  ]),
  // @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated
  // — escalation is a finite nested read surface, never an alternate writer.
  elevatedDbMembers: Object.freeze([
    'get',
    'getMany',
    'uniqueMany',
    'query',
  ]),
  syntax: Object.freeze({
    admitted: Object.freeze([
      'direct function and arrow-function expressions',
      'statically named ordinary property access',
      'same-file top-level function declarations reached from a handler',
    ]),
    forbidden: Object.freeze([
      'class syntax', 'ambient this or super', 'dynamic import', 'eval',
      'Function construction', 'dynamic computed member access',
      'prototype and descriptor reflection', 'helper cycles',
    ]),
  }),
});

export const CLOSED_SCRIPT_HANDLER_RULES = Object.freeze({
  functionConstructors: Object.freeze([
    'Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction',
  ]),
  timerFunctions: Object.freeze([
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'requestAnimationFrame',
  ]),
  rules: Object.freeze({
    import: rule('module.import.forbidden', 'BUNDLE_UNSUPPORTED_IMPORT', 'static-admission', 'Move the helper into the same authored file; imported helpers are not admitted yet.', 'can-i-import-a-helper'),
    export: rule('module.export.forbidden', 'BUNDLE_UNSUPPORTED_EXPORT', 'static-admission', 'Register closed-script handlers on globalThis.__snapbackHandlers.', 'closed-script-handler-files'),
    with: rule('syntax.dynamic-scope.forbidden', 'BUNDLE_UNSUPPORTED_WITH', 'static-admission', 'Use ordinary lexical bindings.', 'forbidden-syntax-and-computed-access'),
    process: rule('global.process.forbidden', 'BUNDLE_UNSUPPORTED_PROCESS', 'static-admission', 'Pass declared data through arguments, ctx, or configured action secrets.', 'can-i-use-node-crypto'),
    webAssembly: rule('global.webassembly.forbidden', 'BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'static-admission', 'Use admitted JavaScript or a host-mediated capability.', 'forbidden-syntax-and-computed-access'),
    eval: rule('syntax.eval.forbidden', 'BUNDLE_UNSUPPORTED_EVAL', 'static-admission', 'Treat fetched or stored text as data; do not evaluate it.', 'forbidden-syntax-and-computed-access'),
    functionConstructor: rule('syntax.function-constructor.forbidden', 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'static-admission', 'Use authored functions in the closed handler source.', 'forbidden-syntax-and-computed-access'),
    require: rule('module.require.forbidden', 'BUNDLE_UNSUPPORTED_REQUIRE', 'static-admission', 'Move the helper into the same authored file; CommonJS loading is unavailable.', 'can-i-import-a-helper'),
    fetch: rule('global.fetch.opt-in', 'BUNDLE_UNSUPPORTED_FETCH', 'static-admission', 'Use an Action and enable SNAPBACK_OUTBOUND_ACTIONS, or use a host-mediated declared capability.', 'globals-and-operation-kinds'),
    timer: rule('global.timer.opt-in', 'BUNDLE_UNSUPPORTED_TIMER', 'static-admission', 'Use durable jobs for delayed work and ctx.runtime.now() for trusted timestamps.', 'globals-and-operation-kinds'),
    random: rule('global.random.forbidden', 'BUNDLE_UNSUPPORTED_RANDOM', 'static-admission', 'Use ctx.runtime.id() for identifiers or pass deterministic input.', 'globals-and-operation-kinds'),
    time: rule('global.time.forbidden', 'BUNDLE_UNSUPPORTED_TIME', 'static-admission', 'Use ctx.runtime.now() for a trusted integer timestamp.', 'globals-and-operation-kinds'),
  }),
});

export const HANDLER_PROFILE_DIAGNOSTICS = Object.freeze([
  ...Object.values(CLOSED_SCRIPT_HANDLER_RULES.rules),
  rule('closed-script.source.parse', 'BUNDLE_HANDLER_PARSE_FAILED', 'static-admission', 'Fix the named JavaScript or TypeScript source span.', 'closed-script-handler-files'),
  rule('inline.form.invalid', 'SNAPBACK_FUNCTION_HANDLER_FORM_INVALID', 'static-admission', 'Use one direct handler function or the documented closed-script source form.', 'inline-handlers-and-same-file-helpers'),
  rule('inline.source.parse', 'SNAPBACK_INLINE_HANDLER_SOURCE_INVALID', 'static-admission', 'Fix the named JavaScript or TypeScript source span.', 'diagnostic-attribution'),
  rule('inline.literal.direct', 'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED', 'static-admission', 'Write one direct non-computed handler property containing a function expression.', 'inline-handlers-and-same-file-helpers'),
  rule('inline.syntax.forbidden', 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN', 'static-admission', 'Use the admitted inline syntax or a declarative plan.', 'forbidden-syntax-and-computed-access'),
  rule('inline.global.allowlist', 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER', 'static-admission', 'Pass data through args or ctx, or use a same-file function declaration.', 'globals-and-operation-kinds'),
  rule('inline.helper.syntax', 'SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN', 'static-admission', 'Rewrite the helper using the admitted inline syntax.', 'inline-handlers-and-same-file-helpers'),
  rule('inline.helper.free-identifier', 'SNAPBACK_INLINE_HELPER_FREE_IDENTIFIER', 'static-admission', 'Pass the value as an argument or make the helper self-contained.', 'inline-handlers-and-same-file-helpers'),
  rule('inline.helper.inadmissible', 'SNAPBACK_INLINE_HELPER_INADMISSIBLE', 'static-admission', 'Use a top-level function declaration; imports and top-level values cannot be spliced.', 'can-i-import-a-helper'),
  rule('inline.helper.cycle', 'SNAPBACK_INLINE_HELPER_CYCLE', 'static-admission', 'Break the same-file helper cycle.', 'inline-handlers-and-same-file-helpers'),
  rule('inline.marker.invalid', 'SNAPBACK_INLINE_HANDLER_MARKER_INVALID', 'static-admission', 'Keep the direct authored handler expression bound to its generated definition marker.', 'inline-handlers-and-same-file-helpers'),
  rule('inline.marker.unbound', 'SNAPBACK_INLINE_HANDLER_NOT_BOUND', 'static-admission', 'Export the direct inline definition so codegen can bind its authored handler.', 'inline-handlers-and-same-file-helpers'),
  rule('definition.strict-json', 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE', 'definition-evaluation', 'Replace the named value with strict JSON data.', 'diagnostic-attribution'),
  rule('definition.export.required', 'SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED', 'definition-discovery', 'Add export to the named top-level builder binding.', 'diagnostic-attribution'),
  // @ref LLP 0253#s43-returns-lowering-kind-partitioned-refusing — Familiar
  // mutation/action document composites refuse with the first-read dialect
  // rewrite at the point of generation, before activation output exists.
  Object.freeze({
    ...rule('familiar.result.unlowerable', 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE', 'definition-evaluation', 'See the diagnostic message and the Familiar handler dialect table.', 'translate-the-familiar-handler-dialect', FAMILIAR_HANDLER_DIALECT_GUIDE),
    // @ref LLP 0253#s91-contract-rulings — R6 permits profile-switch
    // suggestions only for disposition-4 refusals. This result shape is one
    // such refusal; supported Familiar result shapes never carry the field.
    profileSwitchSuggestion: Object.freeze({
      from: 'snapback-familiar-ts-v1',
      to: 'snapback-explicit-js-v1',
      route: 'result:',
    }),
  }),
  rule('runtime.ambient-capability', 'SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED', 'runtime-check', 'Use the operation kind and ctx capability named by the diagnostic.', 'static-and-runtime-refusals'),
  rule('runtime.export.required', 'SNAPBACK_HANDLER_EXPORT_MISSING', 'runtime-check', 'Register the closed-script export on globalThis.__snapbackHandlers.', 'closed-script-handler-files'),
]);

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export function handlerRuleForCode(code) {
  return HANDLER_PROFILE_DIAGNOSTICS.find((candidate) => candidate.code === code) ?? null;
}

export function handlerDiagnosticDetails(code) {
  const selected = handlerRuleForCode(code);
  return selected === null ? {} : {
    rule: selected.id,
    alternative: selected.alternative,
    guideAnchor: selected.guideAnchor,
    ...(selected.profileSwitchSuggestion
      ? { profileSwitchSuggestion: selected.profileSwitchSuggestion }
      : {}),
  };
}

export function buildHandlerRuntimeProfile({
  appId,
  inputsHash,
  authoredSourceHash,
  targetProfile,
  functions,
  sourceFunctions = [],
  graphRecords = [],
  outboundActions = false,
}) {
  // @ref LLP 0237#d6-the-runtime-profile-is-a-generated-product-surface —
  // project the executable admission tables into one versioned generated
  // surface; do not maintain a second prose-only restriction inventory.
  const sourceByName = new Map(sourceFunctions.map((fn) => [fn.name, fn]));
  const commonGlobals = [...INLINE_HANDLER_RULES.globals];
  const operationKinds = ['Query', 'LiveQuery', 'Mutation', 'Action'];
  const availableGlobalsByOperationKind = Object.fromEntries(operationKinds.map((kind) => [
    kind,
    {
      basis: 'current-codegen-admission',
      identifiers: [...commonGlobals],
      handlerForms: {
        inline: {
          positiveAllowlist: [...commonGlobals],
          fetch: kind === 'Action' && outboundActions
            ? 'available-with-generation-and-runtime-opt-in'
            : 'unavailable',
          timers: 'unavailable',
          nodeCrypto: 'unavailable',
          process: 'unavailable',
        },
        closedScript: {
          admissionModel: 'scanner-denylist-plus-runtime-boundary',
          fetch: kind === 'Action' && outboundActions
            ? 'available-with-generation-and-runtime-opt-in'
            : 'unavailable',
          timers: kind === 'Action' && outboundActions
            ? 'available-with-generation-and-runtime-opt-in'
            : 'unavailable',
          nodeCrypto: 'unavailable',
          process: 'unavailable',
        },
      },
    },
  ]));
  const operations = [...functions]
    .sort((left, right) => compare(left.id, right.id))
    .map((fn) => {
      const authored = sourceByName.get(fn.name);
      const selectedProfile = fn.handlerForm === 'inline'
        ? (Array.isArray(authored?.inlineHelpers) && authored.inlineHelpers.length > 0
            ? 'inline-handler-same-file-helpers-v2'
            : 'inline-handler-v1')
        : fn.handlerForm === 'module'
          ? 'closed-script-handler-v1'
          : 'host-plan-v1';
      return {
        operationId: fn.id,
        operation: fn.name,
        operationKind: fn.kind,
        selectedProfile,
        selectionReason: 'legacy-profile',
      };
    });
  const sameFileGraphRecords = [...graphRecords]
    .sort((left, right) => compare(left.root.name, right.root.name));
  return {
    artifactKind: 'handlerRuntimeProfile',
    schemaVersion: HANDLER_RUNTIME_PROFILE_VERSION,
    profileVersion: HANDLER_RUNTIME_PROFILE_VERSION,
    admissionVersion: HANDLER_ADMISSION_VERSION,
    appId,
    inputsHash,
    authoredSourceHash,
    targetProfile,
    moduleGraph: {
      admittedSpecifiers: [],
      sameFileFunctionDeclarations: true,
      maximumFiles: 1,
      maximumImportDepth: 0,
      cycles: 'forbidden',
      reExports: 'forbidden',
      importedHelpers: 'not-admitted',
      integerIndexGrammar: 'not-applicable-to-legacy-profiles',
      // @ref LLP 0237#d2-closed-graph-and-frozen-bounds — Rollout 2 projects
      // the same-file closure through the future graph-shaped carrier while
      // retaining the existing one-file/zero-import admission envelope.
      graphRecordSchema: {
        schemaVersion: HANDLER_GRAPH_RECORD_VERSION,
        extractorVersion: HANDLER_GRAPH_EXTRACTOR_VERSION,
        admissionVersion: HANDLER_ADMISSION_VERSION,
        moduleFormat: 'esm',
        normalizedTarget: 'root-relative-posix-path',
        sameFileTargetResolution: 'self',
        topology: 'directed-node-and-edge-list',
        sourceSnapshot: {
          protocol: 'single-captured-source-buffer-v1',
          attestedReread: 'not-applicable-while-relative-imports-are-not-admitted',
        },
        // @ref LLP 0237#d4-runtime-and-implementation-identity — never
        // overload raw authored bytes into the canonical executable digest.
        digestFields: {
          canonicalExecutableAstDigest: 'canonical-executable',
          rawSourceEvidenceDigest: 'raw-source-evidence',
        },
      },
      identityEvidence: {
        canonicalExecutableDigestField: 'implementationHash',
        rawEvidenceDigestField: 'authoredSourceHash',
      },
      records: sameFileGraphRecords,
    },
    syntax: INLINE_HANDLER_RULES.syntax,
    globals: availableGlobalsByOperationKind,
    computedAccess: {
      staticStringProperties: 'admitted',
      staticNumericIndexes: 'admitted-where-the-current-scanner-resolves-a-literal',
      dynamicProperties: 'forbidden',
      forbiddenReflectionProperties: [...INLINE_HANDLER_RULES.reflectionPropertyNames],
      objectReflectionMethods: [...INLINE_HANDLER_RULES.objectReflectionMethods],
    },
    runtimeCapabilities: {
      nodeBuiltins: false,
      nodeCrypto: false,
      filesystem: false,
      dynamicCodeGeneration: false,
      wasm: false,
      outboundFetch: outboundActions ? 'actions-only-with-runtime-opt-in' : false,
      trustedTime: 'ctx.runtime.now',
      freshIdentifiers: 'ctx.runtime.id',
    },
    targetDifferences: {
      'local-dev-sqlite-ibex': { engine: 'Hermes through Ibex', handlerAdmission: 'legacy-v1' },
      'remote-service-sqlite-ibex': { engine: 'Hermes through Ibex', handlerAdmission: 'legacy-v1' },
      'workerd-v8': { status: 'not-admitted-in-rollout-1' },
    },
    diagnostics: HANDLER_PROFILE_DIAGNOSTICS,
    selectionReasonVocabulary: {
      current: ['legacy-profile'],
      reservedForBoundedModules: ['explicit', 'required-by-import'],
    },
    operations,
  };
}
