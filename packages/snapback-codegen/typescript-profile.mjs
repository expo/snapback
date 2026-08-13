import ts from 'typescript';

// @ref LLP 0246#d2-snapback-owns-the-effective-compiler-configuration — one
// codegen-owned record freezes the compiler, erasure options, and refusal
// vocabulary used for every bounded TypeScript handler.
export const HANDLER_TYPESCRIPT_SOURCE_PROFILE = 'bounded-handler-typescript-v1';
export const HANDLER_TYPESCRIPT_TRANSFORM_VERSION = 'snapback-typescript-syntax-erasure-v1';
export const HANDLER_TYPESCRIPT_COMPILER_VERSION = '5.9.3';
export const HANDLER_TYPESCRIPT_COMPILER_INTEGRITY =
  'sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==';
export const HANDLER_TYPESCRIPT_PROFILE_ARTIFACT_FILE = 'handler-typescript-profile.v1.json';

export const HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES = Object.freeze({
  bareImport: 'SNAPBACK_CODEGEN_TYPESCRIPT_BARE_IMPORT',
  commonJs: 'SNAPBACK_CODEGEN_TYPESCRIPT_COMMONJS',
  compilerMismatch: 'SNAPBACK_CODEGEN_TYPESCRIPT_COMPILER_MISMATCH',
  constEnum: 'SNAPBACK_CODEGEN_TYPESCRIPT_CONST_ENUM',
  declarationFile: 'SNAPBACK_CODEGEN_TYPESCRIPT_DECLARATION_FILE',
  decorator: 'SNAPBACK_CODEGEN_TYPESCRIPT_DECORATOR',
  dynamicImport: 'SNAPBACK_CODEGEN_TYPESCRIPT_DYNAMIC_IMPORT',
  emitHelper: 'SNAPBACK_CODEGEN_TYPESCRIPT_EMIT_HELPER',
  enum: 'SNAPBACK_CODEGEN_TYPESCRIPT_ENUM',
  extensionInference: 'SNAPBACK_CODEGEN_TYPESCRIPT_EXTENSION_INFERENCE',
  namespace: 'SNAPBACK_CODEGEN_TYPESCRIPT_NAMESPACE',
  nodeImport: 'SNAPBACK_CODEGEN_TYPESCRIPT_NODE_IMPORT',
  nonErasableSyntax: 'SNAPBACK_CODEGEN_TYPESCRIPT_NON_ERASABLE_SYNTAX',
  parameterProperty: 'SNAPBACK_CODEGEN_TYPESCRIPT_PARAMETER_PROPERTY',
  pathAlias: 'SNAPBACK_CODEGEN_TYPESCRIPT_PATH_ALIAS',
  sourceMapFailed: 'SNAPBACK_CODEGEN_TYPESCRIPT_SOURCE_MAP_FAILED',
  transformFailed: 'SNAPBACK_CODEGEN_TYPESCRIPT_TRANSFORM_FAILED',
  tsx: 'SNAPBACK_CODEGEN_TYPESCRIPT_TSX',
  typecheckFailed: 'SNAPBACK_CODEGEN_TYPESCRIPT_TYPECHECK_FAILED',
  unsupportedExtension: 'SNAPBACK_CODEGEN_TYPESCRIPT_UNSUPPORTED_EXTENSION',
});

export const HANDLER_TYPESCRIPT_EFFECTIVE_OPTIONS = Object.freeze({
  allowJs: false,
  allowSyntheticDefaultImports: false,
  alwaysStrict: false,
  checkJs: false,
  customTransformers: false,
  emitDecoratorMetadata: false,
  erasableSyntaxOnly: true,
  experimentalDecorators: false,
  importHelpers: false,
  inlineSourceMap: false,
  inlineSources: true,
  isolatedModules: true,
  jsx: false,
  module: 'ESNext',
  moduleDetection: 'auto',
  moduleResolution: 'Bundler',
  noEmitHelpers: true,
  noImplicitAny: false,
  plugins: false,
  preserveConstEnums: true,
  rewriteRelativeImportExtensions: true,
  sourceMap: true,
  strict: true,
  target: 'ES2022',
  useDefineForClassFields: true,
  verbatimModuleSyntax: true,
});

export const HANDLER_TYPESCRIPT_PROFILE = Object.freeze({
  artifactKind: 'handlerTypeScriptProfile',
  schemaVersion: 1,
  sourceProfile: HANDLER_TYPESCRIPT_SOURCE_PROFILE,
  transformVersion: HANDLER_TYPESCRIPT_TRANSFORM_VERSION,
  compiler: Object.freeze({
    package: 'typescript',
    version: HANDLER_TYPESCRIPT_COMPILER_VERSION,
    integrity: HANDLER_TYPESCRIPT_COMPILER_INTEGRITY,
  }),
  effectiveOptions: HANDLER_TYPESCRIPT_EFFECTIVE_OPTIONS,
  moduleExtensions: Object.freeze({
    '.ts': '.js',
    '.mts': '.mjs',
  }),
  diagnosticRules: HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES,
});

if (ts.version !== HANDLER_TYPESCRIPT_COMPILER_VERSION) {
  throw new Error(
    `${HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.compilerMismatch}: expected TypeScript ${HANDLER_TYPESCRIPT_COMPILER_VERSION}, loaded ${ts.version}`,
  );
}

export function handlerTypeScriptCompilerOptions({ emit = true } = {}) {
  return {
    allowJs: false,
    allowSyntheticDefaultImports: false,
    alwaysStrict: false,
    checkJs: false,
    emitDecoratorMetadata: false,
    erasableSyntaxOnly: true,
    experimentalDecorators: false,
    importHelpers: false,
    inlineSourceMap: false,
    inlineSources: emit,
    isolatedModules: true,
    lib: ['lib.es2022.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Auto,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: !emit,
    noEmitHelpers: true,
    noImplicitAny: false,
    preserveConstEnums: true,
    rewriteRelativeImportExtensions: true,
    skipLibCheck: true,
    sourceMap: emit,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    useDefineForClassFields: true,
    verbatimModuleSyntax: true,
  };
}

export function handlerTypeScriptIdentity() {
  return Object.freeze({
    sourceProfile: HANDLER_TYPESCRIPT_SOURCE_PROFILE,
    transformVersion: HANDLER_TYPESCRIPT_TRANSFORM_VERSION,
    compilerVersion: HANDLER_TYPESCRIPT_COMPILER_VERSION,
    compilerIntegrity: HANDLER_TYPESCRIPT_COMPILER_INTEGRITY,
  });
}
