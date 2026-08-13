import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  decodeUtf8Source,
  resolveFileReadCapability,
  resolveHandlerSourceCapability,
} from './file-read-capability.mjs';
import {
  HANDLER_TYPESCRIPT_COMPILER_INTEGRITY,
  HANDLER_TYPESCRIPT_COMPILER_VERSION,
  HANDLER_TYPESCRIPT_EFFECTIVE_OPTIONS,
  handlerTypeScriptCompilerOptions,
} from './typescript-profile.mjs';

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const SCHEMA_PATH = join(PACKAGE_ROOT, 'declaration-suggestion.schema.json');
const PROTOCOL_SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const REASON_CODE_LIST = Object.freeze([...PROTOCOL_SCHEMA.$defs.reasonCode.enum]);
const REASON_CODE_SET = new Set(REASON_CODE_LIST);
const STALE_SUGGESTION_CODE = 'SNAPBACK_DECLARATION_SUGGESTION_STALE';
const DIAGNOSTIC_CODE_SET = new Set([...REASON_CODE_LIST, STALE_SUGGESTION_CODE]);
const ANALYZER_ID = 'snapback-declaration-suggestion';
const ANALYZER_VERSION = 1;
const SUGGESTION_SCHEMA_VERSION = 'snapback.declaration-suggestion.v1';
const SUGGEST_RESULT_SCHEMA_VERSION = 'snapback.declaration-suggestion-result.v1';
const APPLY_RESULT_SCHEMA_VERSION = 'snapback.declaration-suggestion-apply.v1';
const ANALYSIS_DOMAIN = 'snapback-codegen/declaration-suggestion-analysis-input/v1';
const APPLY_LOCK_FILE = '.declaration-suggestion.apply.lock';
const RESULT_BUILDERS = new Map([
  ['defineJsQuery', { kind: 'Query', familiar: false }],
  ['defineJsLiveQuery', { kind: 'LiveQuery', familiar: false }],
  ['defineJsMutation', { kind: 'Mutation', familiar: false }],
  ['defineAction', { kind: 'Action', familiar: false }],
  // @ref LLP 0253#s43-returns-lowering-kind-partitioned-refusing — familiar
  // suggestions share the canonical inverse type analysis but render the
  // accepted declaration in returns: v.* source grammar.
  ['query', { kind: 'LiveQuery', familiar: true }],
  ['mutation', { kind: 'Mutation', familiar: true }],
  ['action', { kind: 'Action', familiar: true }],
]);

export const DECLARATION_SUGGESTION_REASON_CODES = REASON_CODE_LIST;

const suggestionCompilerIdentity = Object.freeze({
  schemaVersion: 'snapback.declaration-suggestion-compiler.v1',
  package: 'typescript',
  version: HANDLER_TYPESCRIPT_COMPILER_VERSION,
  integrity: HANDLER_TYPESCRIPT_COMPILER_INTEGRITY,
  effectiveOptions: Object.freeze({
    ...HANDLER_TYPESCRIPT_EFFECTIVE_OPTIONS,
    allowJs: true,
    checkJs: true,
    isolatedModules: false,
    lib: Object.freeze(['lib.es2022.d.ts']),
    noEmit: true,
    purpose: 'declaration-suggestion-return-analysis-v1',
  }),
});

const reasonTableDigest = digest(Buffer.from(stableJson(REASON_CODE_LIST), 'utf8'));
const analyzerIdentity = Object.freeze({
  schemaVersion: 'snapback.declaration-suggestion-analyzer.v1',
  id: ANALYZER_ID,
  version: ANALYZER_VERSION,
  reasonTableDigest,
});

function stableJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function framedDigest(domain, items) {
  const hash = createHash('sha256');
  const append = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    hash.update(`${bytes.length}:`, 'ascii');
    hash.update(bytes);
  };
  append('snapback-codegen-framed-sha256/v1');
  append(domain);
  append(String(items.length));
  for (const item of items) append(item);
  return `sha256:${hash.digest('hex')}`;
}

function portablePath(path, backendRoot) {
  const appRelative = relative(backendRoot, path);
  if (inside(appRelative)) return `app:${slash(appRelative)}`;
  const repoRelative = relative(REPO_ROOT, path);
  if (inside(repoRelative)) return `repo:${slash(repoRelative)}`;
  const normalized = slash(path);
  const marker = '/node_modules/';
  const dependency = normalized.lastIndexOf(marker);
  if (dependency !== -1) return `package:${normalized.slice(dependency + marker.length)}`;
  return `external:${digest(Buffer.from(normalized, 'utf8')).slice('sha256:'.length, 'sha256:'.length + 16)}/${normalized.split('/').at(-1)}`;
}

function slash(path) {
  return path.split(sep).join('/');
}

function inside(path) {
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function diagnostic(code, message, details = {}, severity = 'error') {
  if (!DIAGNOSTIC_CODE_SET.has(code)) throw new TypeError(`unknown declaration-suggestion diagnostic code ${code}`);
  return {
    schemaVersion: 'snapback.declaration-suggestion-diagnostic.v1',
    code,
    severity,
    subsystem: 'codegen',
    message,
    details,
  };
}

function commandFailure(code, message, details = {}) {
  return {
    schemaVersion: SUGGEST_RESULT_SCHEMA_VERSION,
    artifactKind: 'declarationSuggestionResult',
    ok: false,
    suggestions: [],
    diagnostics: [diagnostic(code, message, details)],
  };
}

function applyFailure(code, message, suggestion = null, details = {}) {
  return {
    schemaVersion: APPLY_RESULT_SCHEMA_VERSION,
    artifactKind: 'declarationSuggestionApplyResult',
    ok: false,
    operationId: suggestion?.operation?.id ?? null,
    analysisInputId: suggestion?.analysisInputId ?? null,
    path: suggestion?.patch?.file ?? null,
    sourceDigest: null,
    diagnostics: [diagnostic(code, message, details)],
  };
}

function snapshot(path, allowedRoots, codePrefix, kind, backendRoot, inputs, {
  allowSymlink = false,
} = {}) {
  const capability = resolveFileReadCapability(path, {
    allowedRoots,
    allowSymlink,
    codePrefix,
  });
  const bytes = capability.read();
  const label = portablePath(capability.realPath, backendRoot);
  if (inputs && !inputs.has(label)) inputs.set(label, { label, bytes, kind, path: capability.realPath });
  return { path: capability.realPath, bytes, label };
}

function scriptKind(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return ts.ScriptKind.TS;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
}

function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) current = current.expression;
  return current;
}

function memberName(member) {
  if (!member?.name) return null;
  if (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name) || ts.isNumericLiteral(member.name)) {
    return member.name.text;
  }
  if (ts.isComputedPropertyName(member.name) && ts.isStringLiteralLike(member.name.expression)) {
    return member.name.expression.text;
  }
  return null;
}

function objectMember(object, name) {
  return object?.properties?.find((property) => memberName(property) === name) ?? null;
}

function literalString(member) {
  if (!member || !ts.isPropertyAssignment(member)) return null;
  const value = unwrap(member.initializer);
  return ts.isStringLiteralLike(value) ? value.text : null;
}

function parseOperations(source, definitionPath) {
  const file = ts.createSourceFile(
    definitionPath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind(definitionPath),
  );
  const operations = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const call = unwrap(declaration.initializer);
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      const builder = RESULT_BUILDERS.get(call.expression.text);
      if (!builder) continue;
      const spec = unwrap(call.arguments[0]);
      if (!spec || !ts.isObjectLiteralExpression(spec)) continue;
      const jsMember = objectMember(spec, 'js');
      const jsSpec = jsMember && ts.isPropertyAssignment(jsMember)
        ? unwrap(jsMember.initializer)
        : null;
      operations.push({
        name: declaration.name.text,
        kind: builder.familiar && call.expression.text === 'query'
          && literalString(objectMember(spec, 'delivery')) === 'read'
          ? 'Query'
          : builder.kind,
        familiar: builder.familiar,
        builder: call.expression.text,
        declaration,
        spec,
        result: objectMember(spec, builder.familiar ? 'returns' : 'result'),
        handler: objectMember(spec, 'handler'),
        source: literalString(objectMember(spec, 'source'))
          ?? (jsSpec && ts.isObjectLiteralExpression(jsSpec) ? literalString(objectMember(jsSpec, 'source')) : null),
        exportName: literalString(objectMember(spec, 'exportName'))
          ?? (jsSpec && ts.isObjectLiteralExpression(jsSpec) ? literalString(objectMember(jsSpec, 'exportName')) : null),
        file,
      });
    }
  }
  return { file, operations };
}

function localModuleSpecifiers(file) {
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) specifiers.push(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

function nearestPackageJson(path) {
  let directory = dirname(path);
  for (;;) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function extensionModuleFormat(path, packageType = null) {
  const extension = extname(path).toLowerCase();
  if (extension === '.mjs' || extension === '.mts') return 'module';
  if (extension === '.cjs' || extension === '.cts') return 'commonjs';
  return packageType === 'module' ? 'module' : 'commonjs';
}

function resolveRelativeSource(importer, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('file:')) return null;
  let candidate;
  try {
    candidate = specifier.startsWith('file:')
      ? fileURLToPath(specifier)
      : resolve(dirname(importer), specifier);
  } catch {
    return null;
  }
  if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
  for (const extension of ['.ts', '.mts', '.js', '.mjs', '.json']) {
    if (existsSync(`${candidate}${extension}`) && lstatSync(`${candidate}${extension}`).isFile()) return `${candidate}${extension}`;
  }
  return null;
}

function collectSourceGraph(entries, backendRoot, inputs, moduleFacts) {
  const pending = [...entries];
  const seen = new Set();
  const roots = [backendRoot, REPO_ROOT];
  while (pending.length > 0) {
    const candidate = pending.pop();
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    let loaded;
    try {
      loaded = snapshot(real, roots, 'SUGGESTION_SOURCE', 'source', backendRoot, inputs);
    } catch {
      continue;
    }
    if (extname(real).toLowerCase() === '.json') continue;
    const text = decodeUtf8Source(loaded.bytes, real, 'SUGGESTION_SOURCE');
    const file = ts.createSourceFile(real, text, ts.ScriptTarget.ES2022, true, scriptKind(real));
    const packageJson = nearestPackageJson(real);
    let packageType = null;
    if (packageJson) {
      try {
        const pkg = snapshot(packageJson, roots, 'SUGGESTION_MODULE_FORMAT', 'module-format', backendRoot, inputs);
        const parsed = JSON.parse(decodeUtf8Source(pkg.bytes, packageJson, 'SUGGESTION_MODULE_FORMAT'));
        packageType = parsed?.type ?? null;
      } catch {
        packageType = null;
      }
    }
    const moduleFormat = extensionModuleFormat(real, packageType);
    moduleFacts.set(portablePath(real, backendRoot), {
      extension: extname(real).toLowerCase(),
      moduleFormat,
    });
    for (const specifier of localModuleSpecifiers(file)) {
      const resolved = resolveRelativeSource(real, specifier);
      if (resolved) pending.push(resolved);
      else if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        moduleFacts.set(`specifier:${portablePath(real, backendRoot)}:${specifier}`, { specifier });
      }
    }
  }
}

function registryHandlerExpression(source, sourcePath, name) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true, scriptKind(sourcePath));
  let registry = null;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === '__snapbackHandlers'
    ) {
      const right = unwrap(node.right);
      if (ts.isObjectLiteralExpression(right)) registry = right;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const member = registry ? objectMember(registry, name) : null;
  if (!member) return null;
  if (ts.isMethodDeclaration(member)) {
    const asyncPrefix = member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
    const generator = member.asteriskToken ? '*' : '';
    const typeParameters = member.typeParameters?.length
      ? source.slice(member.typeParameters.pos, member.typeParameters.end)
      : '';
    const params = member.parameters.map((parameter) => source.slice(parameter.getStart(file), parameter.end)).join(', ');
    const returnType = member.type ? `: ${source.slice(member.type.getStart(file), member.type.end)}` : '';
    const body = member.body ? source.slice(member.body.getStart(file), member.body.end) : null;
    return body ? `${asyncPrefix}function${generator} ${name}${typeParameters}(${params})${returnType} ${body}` : null;
  }
  if (ts.isPropertyAssignment(member)) {
    const initializer = unwrap(member.initializer);
    if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
      return source.slice(initializer.getStart(file), initializer.end);
    }
  }
  if (ts.isShorthandPropertyAssignment(member)) {
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return source.slice(statement.getStart(file), statement.end).replace(
          /^(export\s+)?(default\s+)?/u,
          '',
        );
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
            const initializer = unwrap(declaration.initializer);
            if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
              return source.slice(initializer.getStart(file), initializer.end);
            }
          }
        }
      }
    }
  }
  return null;
}

function exportedHandlerExpression(source, sourcePath, name) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true, scriptKind(sourcePath));
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      const text = source.slice(statement.getStart(file), statement.end)
        .replace(/^(export\s+)?(default\s+)?/u, '');
      return text;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
      const initializer = unwrap(declaration.initializer);
      if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
        return source.slice(initializer.getStart(file), initializer.end);
      }
    }
  }
  return registryHandlerExpression(source, sourcePath, name);
}

function handlerExpression(operation, definitionSource, backendRoot, inputs) {
  if (operation.handler && ts.isPropertyAssignment(operation.handler)) {
    const expression = unwrap(operation.handler.initializer);
    if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
      return {
        expression: definitionSource.slice(expression.getStart(operation.file), expression.end),
        sourcePath: operation.file.fileName,
      };
    }
  }
  if (!operation.source || !operation.exportName) return null;
  const capability = resolveHandlerSourceCapability(backendRoot, operation.source);
  const bytes = capability.read();
  const source = decodeUtf8Source(bytes, capability.realPath, 'SUGGESTION_HANDLER_SOURCE');
  const label = portablePath(capability.realPath, backendRoot);
  if (!inputs.has(label)) inputs.set(label, { label, bytes, kind: 'source', path: capability.realPath });
  const expression = exportedHandlerExpression(source, capability.realPath, operation.exportName);
  return expression ? { expression, sourcePath: capability.realPath, source } : null;
}

function checkerOptions() {
  return {
    ...handlerTypeScriptCompilerOptions({ emit: false }),
    allowJs: true,
    checkJs: true,
    isolatedModules: false,
    noEmit: true,
  };
}

function createAnalysisProgram({
  backendRoot,
  definitionSource,
  definitionPath,
  operation,
  handler,
  apiPath,
  inputs,
}) {
  const options = checkerOptions();
  const virtualPath = join(backendRoot, `.snapback-declaration-suggestion-${operation.name}.mts`);
  const relativeApi = `./${slash(relative(backendRoot, apiPath))}`;
  const baseSource = handler.sourcePath === definitionPath
    ? definitionSource
    : (handler.source ?? decodeUtf8Source(
      snapshot(handler.sourcePath, [backendRoot, REPO_ROOT], 'SUGGESTION_HANDLER_SOURCE', 'source', backendRoot, inputs).bytes,
      handler.sourcePath,
      'SUGGESTION_HANDLER_SOURCE',
    ));
  const appendedStart = baseSource.length;
  const virtualSource = `${baseSource}\n`
    + `import type { GeneratedHandler as __SnapbackGeneratedHandler } from ${JSON.stringify(relativeApi)};\n`
    + `type __SnapbackSuggestionHandler = __SnapbackGeneratedHandler<${JSON.stringify(operation.name)}>;\n`
    + 'declare function __snapbackCaptureReturn<C, A>(): <R>(handler: (ctx: C, args: A) => R) => R;\n'
    + `export const __snapbackSuggestionReturn = __snapbackCaptureReturn<Parameters<__SnapbackSuggestionHandler>[0], Parameters<__SnapbackSuggestionHandler>[1]>()((${handler.expression}));\n`;
  const defaultHost = ts.createCompilerHost(options, true);
  const roots = [backendRoot, REPO_ROOT];
  const canonicalVirtual = slash(virtualPath);
  const safeCache = new Map();
  const readSafe = (fileName) => {
    const normalized = slash(fileName);
    if (normalized === canonicalVirtual) return virtualSource;
    if (safeCache.has(normalized)) return safeCache.get(normalized);
    try {
      const loaded = snapshot(fileName, roots, 'SUGGESTION_TYPE_SOURCE', 'generated-type', backendRoot, null, { allowSymlink: true });
      const text = decodeUtf8Source(loaded.bytes, loaded.path, 'SUGGESTION_TYPE_SOURCE');
      safeCache.set(normalized, text);
      const label = portablePath(loaded.path, backendRoot);
      const lib = /(?:^|\/)typescript\/lib\/lib\.[^/]+\.d\.ts$/u.test(slash(loaded.path));
      const generated = loaded.path === apiPath || slash(loaded.path).includes('/generated/');
      if (!inputs.has(label)) inputs.set(label, {
        label,
        bytes: loaded.bytes,
        kind: lib ? 'compiler-lib' : generated ? 'generated-type' : 'source',
        path: loaded.path,
      });
      return text;
    } catch {
      return undefined;
    }
  };
  const host = {
    ...defaultHost,
    fileExists(fileName) {
      return slash(fileName) === canonicalVirtual || defaultHost.fileExists(fileName);
    },
    readFile: readSafe,
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const source = readSafe(fileName);
      if (source === undefined) return undefined;
      return ts.createSourceFile(fileName, source, languageVersion, true, scriptKind(fileName));
    },
  };
  const resolveModule = (name, containingFile) => {
    if (name === '@expo/snapback-codegen/ctx') {
      return {
        resolvedFileName: join(PACKAGE_ROOT, 'ctx.d.mts'),
        extension: ts.Extension.Dmts,
        isExternalLibraryImport: true,
      };
    }
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
  };
  host.resolveModuleNames = (moduleNames, containingFile) => (
    moduleNames.map((name) => resolveModule(name, containingFile))
  );
  host.resolveModuleNameLiterals = (moduleLiterals, containingFile) => (
    moduleLiterals.map((literal) => ({ resolvedModule: resolveModule(literal.text, containingFile) }))
  );
  const program = ts.createProgram([virtualPath], options, host);
  const sourceFile = program.getSourceFile(virtualPath);
  if (!sourceFile) return null;
  let returnDeclaration = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    returnDeclaration = statement.declarationList.declarations.find(
      (entry) => ts.isIdentifier(entry.name) && entry.name.text === '__snapbackSuggestionReturn',
    ) ?? returnDeclaration;
  }
  if (!returnDeclaration) return null;
  const checker = program.getTypeChecker();
  const type = checker.getTypeAtLocation(returnDeclaration.name);
  const apiFile = program.getSourceFiles().find((entry) => {
    try { return realpathSync(entry.fileName) === apiPath; } catch { return false; }
  }) ?? program.getSourceFile(apiPath);
  const captureDiagnostics = program.getSemanticDiagnostics(sourceFile).filter(
    (entry) => (entry.start ?? 0) >= appendedStart,
  );
  return { program, checker, type, apiFile, captureDiagnostics };
}

function exportedType(checker, sourceFile, name) {
  if (!sourceFile) return null;
  const module = checker.getSymbolAtLocation(sourceFile);
  if (!module) return null;
  const symbol = checker.getExportsOfModule(module).find((entry) => entry.name === name);
  return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : null;
}

function tableTypes(checker, apiFile) {
  const model = exportedType(checker, apiFile, 'GeneratedDataModel');
  if (!model) return new Map();
  const tables = new Map();
  for (const property of checker.getPropertiesOfType(model)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? apiFile;
    tables.set(property.name, checker.getTypeOfSymbolAtLocation(property, declaration));
  }
  return tables;
}

function unwrapPromise(checker, type) {
  let current = type;
  for (let depth = 0; depth < 8; depth += 1) {
    const promised = checker.getPromisedTypeOfPromise?.(current);
    if (!promised || promised === current) break;
    current = promised;
  }
  return current;
}

function renderedType(checker, type) {
  return checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
}

function exactTable(type, tables, checker) {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
  const rendered = renderedType(checker, type);
  for (const [table, candidate] of tables) {
    if (type === candidate) return table;
    // TypeScript expands indexed-access aliases as values flow through ctx.db.
    // Bidirectional assignability preserves the full generated document shape,
    // including the table-branded Id, without inferring identity from fields.
    if (checker.isTypeAssignableTo(type, candidate) && checker.isTypeAssignableTo(candidate, type)) return table;
    if (
      rendered === `GeneratedDataModel[${JSON.stringify(table)}]`
      || rendered === `GeneratedDataModel['${table}']`
    ) return table;
  }
  return null;
}

function evidence(path, sourceExpression, contractExpression, confidence, basis) {
  return {
    schemaVersion: 'snapback.declaration-suggestion-evidence.v1',
    path,
    sourceExpression,
    contractExpression,
    confidence,
    basis,
  };
}

function hole(code, path, sourceExpression, availableChoices) {
  return {
    schemaVersion: 'snapback.declaration-suggestion-hole.v1',
    code,
    path,
    sourceExpression,
    availableChoices,
  };
}

function refusal(code, message, path, sourceExpression, availableChoices = []) {
  return {
    expression: null,
    evidence: [evidence(path, sourceExpression, null, 'unresolved', 'typescript')],
    holes: availableChoices.length > 0 ? [hole(code, path, sourceExpression, availableChoices)] : [],
    refusal: diagnostic(code, message, { path, sourceExpression }),
  };
}

function unresolved(code, path, sourceExpression, availableChoices) {
  return {
    expression: null,
    evidence: [evidence(path, sourceExpression, null, 'unresolved', 'typescript')],
    holes: [hole(code, path, sourceExpression, availableChoices)],
    refusal: null,
  };
}

function arrayElement(checker, type) {
  if (checker.isArrayType(type)) return checker.getElementTypeOfArrayType(type);
  const targetName = type.target?.symbol?.name ?? type.symbol?.name;
  if (targetName === 'ReadonlyArray' || targetName === 'Array') {
    return checker.getTypeArguments(type)[0] ?? null;
  }
  return null;
}

function unionAdmitted(types, checker) {
  const primitiveGroups = types.map((type) => {
    if (type.flags & ts.TypeFlags.Null) return 'null';
    if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return 'string';
    if (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return 'number';
    if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return 'boolean';
    if (type.flags & ts.TypeFlags.Object) return 'object';
    return 'unsupported';
  });
  if (primitiveGroups.includes('unsupported')) return false;
  const duplicates = primitiveGroups.some((kind, index) => primitiveGroups.indexOf(kind) !== index);
  if (!duplicates) return true;
  if (types.every((type) => type.isLiteral?.())) return true;
  if (!types.every((type) => type.flags & ts.TypeFlags.Object)) return false;
  const properties = checker.getPropertiesOfType(types[0]);
  return properties.some((property) => {
    if (property.flags & ts.SymbolFlags.Optional) return false;
    const values = [];
    for (const variant of types) {
      const candidate = checker.getPropertyOfType(variant, property.name);
      if (!candidate || candidate.flags & ts.SymbolFlags.Optional) return false;
      const declaration = candidate.valueDeclaration ?? candidate.declarations?.[0];
      const value = checker.getTypeOfSymbolAtLocation(candidate, declaration);
      if (!(value.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral))) return false;
      values.push(renderedType(checker, value));
    }
    return new Set(values).size === values.length;
  });
}

// @ref LLP 0245#d2-result-contracts-are-the-first-authoritative-candidate-class —
// this inverse projection is a closed, fail-closed table: a TypeScript type
// either maps to LLP 0108's authored vocabulary, produces an explicit hole,
// or refuses with a code drawn from declaration-suggestion.schema.json.
// @ref LLP 0108#result-contract-vocabulary — emitted spellings are exactly the
// existing results.* / v.* source vocabulary; no inferred node becomes a new
// runtime contract kind.
function invertType(type, context, path = '$', stack = new Set()) {
  const { checker, tables } = context;
  const sourceExpression = renderedType(checker, type);
  if (type.flags & ts.TypeFlags.Any) {
    return unresolved(
      'SNAPBACK_AUTHORING_RETURN_ANY_UNRESOLVED',
      path,
      sourceExpression,
      ['v.object({...})', 'v.array(<validator>, { maxItems: <author-bound> })', 'v.json({ maxDepth: <author-bound>, maxBytes: <author-bound> })'],
    );
  }
  if (type.flags & ts.TypeFlags.Unknown) {
    return unresolved(
      'SNAPBACK_AUTHORING_RETURN_UNKNOWN_UNRESOLVED',
      path,
      sourceExpression,
      ['v.object({...})', 'v.json({ maxDepth: <author-bound>, maxBytes: <author-bound> })'],
    );
  }
  if (type.flags & ts.TypeFlags.Null) {
    return { expression: 'v.null()', evidence: [evidence(path, sourceExpression, 'v.null()', 'exact', 'typescript')], holes: [], refusal: null };
  }
  if (type.flags & ts.TypeFlags.StringLiteral) {
    const expression = `v.literal(${JSON.stringify(type.value)})`;
    return { expression, evidence: [evidence(path, sourceExpression, expression, 'exact', 'typescript')], holes: [], refusal: null };
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    const value = Object.is(type.value, -0) ? 0 : type.value;
    const expression = `v.literal(${JSON.stringify(value)})`;
    return { expression, evidence: [evidence(path, sourceExpression, expression, 'exact', 'typescript')], holes: [], refusal: null };
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    const value = type.intrinsicName === 'true';
    const expression = `v.literal(${value})`;
    return { expression, evidence: [evidence(path, sourceExpression, expression, 'exact', 'typescript')], holes: [], refusal: null };
  }

  const table = exactTable(type, tables, checker);
  if (table) {
    const expression = `v.doc(${JSON.stringify(table)})`;
    return { expression, evidence: [evidence(path, sourceExpression, expression, 'schema-derived', 'schema-reference')], holes: [], refusal: null, table };
  }

  const idMatch = sourceExpression.match(/^Id<["']([^"']+)["']>$/u);
  if (idMatch) {
    const expression = `v.id(${JSON.stringify(idMatch[1])})`;
    return { expression, evidence: [evidence(path, sourceExpression, expression, 'schema-derived', 'schema-reference')], holes: [], refusal: null };
  }
  if (sourceExpression === 'Principal') {
    return { expression: 'v.principal()', evidence: [evidence(path, sourceExpression, 'v.principal()', 'schema-derived', 'schema-reference')], holes: [], refusal: null };
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return { expression: 'v.boolean()', evidence: [evidence(path, sourceExpression, 'v.boolean()', 'exact', 'typescript')], holes: [], refusal: null };
  }
  if (type.flags & ts.TypeFlags.String) {
    return unresolved(
      'SNAPBACK_AUTHORING_STRING_BOUND_UNRESOLVED',
      path,
      sourceExpression,
      ['v.string({ maxBytes: <author-bound> })'],
    );
  }
  if (type.flags & ts.TypeFlags.Number) {
    return unresolved(
      'SNAPBACK_AUTHORING_NUMBER_REFINEMENT_UNRESOLVED',
      path,
      sourceExpression,
      ['v.integer({ min: <author-bound>, max: <author-bound> })', 'v.finiteReal({ min: <author-bound>, max: <author-bound> })'],
    );
  }
  if (type.flags & ts.TypeFlags.Union) {
    const variants = type.types;
    if (variants.some((variant) => variant.flags & ts.TypeFlags.Undefined)) {
      return refusal(
        'SNAPBACK_AUTHORING_NON_JSON_RETURN',
        `return field ${path} includes undefined outside an optional object field`,
        path,
        sourceExpression,
      );
    }
    if (!unionAdmitted(variants, checker)) {
      return refusal(
        'SNAPBACK_AUTHORING_UNION_UNSUPPORTED',
        `return field ${path} is not a distinguishable closed union`,
        path,
        sourceExpression,
      );
    }
    const children = variants.map((variant) => invertType(variant, context, `${path}|${renderedType(checker, variant)}`, stack));
    const refusalEntry = children.find((entry) => entry.refusal)?.refusal ?? null;
    const holes = children.flatMap((entry) => entry.holes);
    const evidenceEntries = children.flatMap((entry) => entry.evidence);
    if (refusalEntry || holes.length > 0) return { expression: null, evidence: evidenceEntries, holes, refusal: refusalEntry };
    const expression = `v.union([${children.map((entry) => entry.expression).join(', ')}])`;
    return { expression, evidence: evidenceEntries, holes: [], refusal: null };
  }

  const tuple = checker.isTupleType(type);
  if (tuple) {
    const elements = checker.getTypeArguments(type);
    const children = elements.map((element, index) => invertType(element, context, `${path}[${index}]`, stack));
    const refusalEntry = children.find((entry) => entry.refusal)?.refusal ?? null;
    const holes = children.flatMap((entry) => entry.holes);
    const evidenceEntries = children.flatMap((entry) => entry.evidence);
    if (refusalEntry || holes.length > 0) return { expression: null, evidence: evidenceEntries, holes, refusal: refusalEntry };
    const expression = `v.tuple([${children.map((entry) => entry.expression).join(', ')}])`;
    return { expression, evidence: evidenceEntries, holes: [], refusal: null, tupleLength: elements.length };
  }
  const element = arrayElement(checker, type);
  if (element) {
    const child = invertType(element, context, `${path}[]`, stack);
    const boundHole = hole(
      'SNAPBACK_AUTHORING_ARRAY_BOUND_UNRESOLVED',
      path,
      sourceExpression,
      ['v.array(<validator>, { maxItems: <author-bound> })'],
    );
    return {
      expression: null,
      evidence: [...child.evidence, evidence(path, sourceExpression, null, 'unresolved', 'typescript')],
      holes: [...child.holes, boundHole],
      refusal: child.refusal,
      arrayElement: child,
    };
  }

  if (type.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never)) {
    return refusal(
      'SNAPBACK_AUTHORING_NON_JSON_RETURN',
      `return field ${path} has non-JSON type ${sourceExpression}`,
      path,
      sourceExpression,
    );
  }
  if (!(type.flags & ts.TypeFlags.Object)) {
    return refusal(
      'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED',
      `return field ${path} has unsupported TypeScript type ${sourceExpression}`,
      path,
      sourceExpression,
    );
  }
  if (stack.has(type.id)) {
    return refusal(
      'SNAPBACK_AUTHORING_RECURSIVE_RETURN_UNSUPPORTED',
      `return field ${path} is recursive`,
      path,
      sourceExpression,
    );
  }
  if (
    type.symbol?.flags & ts.SymbolFlags.Class
    || type.aliasSymbol?.flags & ts.SymbolFlags.Class
    || ['Date', 'Map', 'Set', 'Promise', 'RegExp', 'Uint8Array'].includes(type.symbol?.name)
  ) {
    return refusal(
      'SNAPBACK_AUTHORING_CLASS_INSTANCE_UNSUPPORTED',
      `return field ${path} is an unsupported class instance ${sourceExpression}`,
      path,
      sourceExpression,
    );
  }
  if (
    checker.getIndexInfoOfType(type, ts.IndexKind.String)
    || checker.getIndexInfoOfType(type, ts.IndexKind.Number)
  ) {
    return refusal(
      'SNAPBACK_AUTHORING_INDEX_SIGNATURE_UNSUPPORTED',
      `return field ${path} has an unbounded index signature`,
      path,
      sourceExpression,
    );
  }

  stack.add(type.id);
  const children = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    let propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    const optional = Boolean(property.flags & ts.SymbolFlags.Optional);
    if (optional && propertyType.flags & ts.TypeFlags.Union) {
      const presentTypes = propertyType.types.filter((entry) => !(entry.flags & ts.TypeFlags.Undefined));
      propertyType = presentTypes.length === 1
        ? presentTypes[0]
        : checker.getUnionType(presentTypes, ts.UnionReduction.Literal);
    }
    const child = invertType(propertyType, context, `${path}.${property.name}`, stack);
    children.push({ name: property.name, optional, child });
  }
  stack.delete(type.id);
  const refusalEntry = children.find((entry) => entry.child.refusal)?.child.refusal ?? null;
  const holes = children.flatMap((entry) => entry.child.holes);
  let evidenceEntries = children.flatMap((entry) => entry.child.evidence);
  if (children.length === 0) evidenceEntries = [evidence(path, sourceExpression, 'v.object({})', 'exact', 'typescript')];
  if (refusalEntry || holes.length > 0) return { expression: null, evidence: evidenceEntries, holes, refusal: refusalEntry };
  const fields = children.map(({ name, optional, child }) => (
    `${JSON.stringify(name)}: ${optional ? `v.optional(${child.expression})` : child.expression}`
  ));
  const expression = `v.object({ ${fields.join(', ')} })`;
  return { expression, evidence: evidenceEntries, holes: [], refusal: null };
}

function topLevelContract(returnType, operation, context) {
  const { checker, tables } = context;
  const type = unwrapPromise(checker, returnType);
  const sourceExpression = renderedType(checker, type);
  if (operation.kind === 'Query' || operation.kind === 'LiveQuery') {
    if (checker.isTupleType(type)) {
      const elements = checker.getTypeArguments(type);
      if (elements.length !== 1) {
        return refusal(
          'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED',
          'query result tuples must contain exactly one closed record to derive a records contract',
          '$',
          sourceExpression,
        );
      }
      const row = invertType(elements[0], context, '$[]');
      if (!row.expression) return row;
      if (!row.expression.startsWith('v.object(') && !row.expression.startsWith('v.doc(')) {
        return refusal(
          'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED',
          'query result tuple elements must be closed records or intact stored documents',
          '$[]',
          renderedType(checker, elements[0]),
        );
      }
      return {
        ...row,
        expression: operation.familiar
          ? `v.tuple([${row.expression}])`
          : `results.records(${row.expression}, { minItems: 1, maxItems: 1 })`,
      };
    }
    const element = arrayElement(checker, type);
    if (!element) {
      return refusal(
        'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED',
        'query and live-query handlers must return an array before a result contract can be suggested',
        '$',
        sourceExpression,
      );
    }
    const table = exactTable(element, tables, checker);
    if (table) {
      const expression = operation.familiar
        ? `v.array(v.doc(${JSON.stringify(table)}))`
        : `results.documents(${JSON.stringify(table)})`;
      return {
        expression,
        evidence: [evidence('$[]', renderedType(checker, element), expression, 'schema-derived', 'schema-reference')],
        holes: [],
        refusal: null,
      };
    }
    const row = invertType(element, context, '$[]');
    if (!row.expression) return row;
    if (!row.expression.startsWith('v.object(')) {
      return refusal(
        'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED',
        'query result elements must be closed records or intact stored documents',
        '$[]',
        renderedType(checker, element),
      );
    }
    return {
      ...row,
      expression: operation.familiar
        ? `v.array(${row.expression})`
        : `results.records(${row.expression})`,
    };
  }
  const table = exactTable(type, tables, checker);
  if (table) {
    const expression = operation.familiar
      ? `v.doc(${JSON.stringify(table)})`
      : `results.document(${JSON.stringify(table)})`;
    return {
      expression,
      evidence: [evidence('$', sourceExpression, expression, 'schema-derived', 'schema-reference')],
      holes: [],
      refusal: null,
    };
  }
  const value = invertType(type, context);
  return value.expression
    ? { ...value, expression: operation.familiar ? value.expression : `results.value(${value.expression})` }
    : value;
}

function confidenceSummary(evidenceEntries) {
  const counts = { exact: 0, schemaDerived: 0, widened: 0, unresolved: 0 };
  for (const entry of evidenceEntries) {
    const key = entry.confidence === 'schema-derived' ? 'schemaDerived' : entry.confidence;
    counts[key] += 1;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const proportions = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, total === 0 ? 0 : value / total]));
  return {
    schemaVersion: 'snapback.declaration-suggestion-confidence.v1',
    counts,
    proportions,
    total,
  };
}

function overallStatus(candidate) {
  if (candidate.refusal) return 'refused';
  if (candidate.holes.length > 0) return 'holed';
  if (candidate.evidence.some((entry) => entry.confidence === 'unresolved')) return 'holed';
  if (candidate.evidence.some((entry) => entry.confidence === 'widened')) return 'widened';
  if (candidate.evidence.some((entry) => entry.confidence === 'schema-derived')) return 'schema-derived';
  return 'exact';
}

function resultDeclarationSource(expression, operation) {
  return `${operation.familiar ? 'returns' : 'result'}: ${expression}`;
}

function ensureResultContractImports(source, operation, expression) {
  const required = operation.familiar
    ? ['v']
    : ['results', ...(expression.includes('v.') ? ['v'] : [])];
  const sourceFile = ts.createSourceFile(
    operation.file.fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind(operation.file.fileName),
  );
  const localImports = new Set();
  let builderImport = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const specifier of named.elements) {
      localImports.add(specifier.name.text);
      if ((specifier.propertyName?.text ?? specifier.name.text) === operation.builder) builderImport = named;
    }
  }
  const missing = required.filter((name) => !localImports.has(name));
  if (missing.length === 0) return source;
  if (!builderImport) {
    return `import { ${missing.join(', ')} } from ${JSON.stringify(operation.familiar ? '@expo/snapback-codegen/familiar' : '@expo/snapback-codegen/define')};\n${source}`;
  }
  const closeBrace = builderImport.end - 1;
  const prefix = builderImport.elements.length === 0 ? '' : ', ';
  return source.slice(0, closeBrace) + prefix + missing.join(', ') + source.slice(closeBrace);
}

function patchTarget(source, operation, expression, file) {
  const afterDeclaration = resultDeclarationSource(expression, operation);
  let startOffset;
  let endOffset;
  let beforeText;
  let afterText;
  if (operation.result) {
    startOffset = operation.result.getStart(operation.file);
    endOffset = operation.result.end;
    beforeText = source.slice(startOffset, endOffset);
    afterText = afterDeclaration;
  } else {
    const open = operation.spec.getStart(operation.file) + 1;
    const next = source[open] ?? '';
    const statementStart = source.lastIndexOf('\n', operation.declaration.getStart(operation.file)) + 1;
    const statementIndent = source.slice(statementStart, operation.declaration.getStart(operation.file)).match(/^\s*/u)?.[0] ?? '';
    const indent = `${statementIndent}  `;
    startOffset = next === '\n' ? open + 1 : open;
    endOffset = startOffset;
    beforeText = '';
    afterText = next === '\n'
      ? `${indent}${afterDeclaration},\n`
      : ` ${afterDeclaration},`;
  }
  let changed = source.slice(0, startOffset) + afterText + source.slice(endOffset);
  changed = ensureResultContractImports(changed, operation, expression);
  if (changed.slice(0, startOffset) !== source.slice(0, startOffset)) {
    startOffset = 0;
    endOffset = source.length;
    beforeText = source;
    afterText = changed;
  }
  return {
    schemaVersion: 'snapback.declaration-source-patch.v1',
    file,
    startOffset,
    endOffset,
    beforeText,
    afterText,
    unifiedDiff: unifiedDiff(source, changed, file),
  };
}

function unifiedDiff(before, after, file) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;
  const contextStart = Math.max(0, prefix - 3);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + 3);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + 3);
  const oldCount = beforeEnd - contextStart;
  const newCount = afterEnd - contextStart;
  const lines = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`,
  ];
  for (let index = contextStart; index < prefix; index += 1) lines.push(` ${beforeLines[index]}`);
  for (let index = prefix; index < beforeLines.length - suffix; index += 1) lines.push(`-${beforeLines[index]}`);
  for (let index = prefix; index < afterLines.length - suffix; index += 1) lines.push(`+${afterLines[index]}`);
  const sharedTailStart = Math.max(prefix, beforeLines.length - suffix);
  for (let index = sharedTailStart; index < beforeEnd; index += 1) lines.push(` ${beforeLines[index]}`);
  return `${lines.join('\n')}\n`;
}

function inputRecord(label, bytes, kind) {
  return {
    schemaVersion: 'snapback.declaration-suggestion-input.v1',
    label,
    digest: digest(bytes),
    kind,
  };
}

function addSyntheticInput(inputs, label, value, kind) {
  const bytes = Buffer.from(typeof value === 'string' ? value : stableJson(value), 'utf8');
  inputs.set(label, { label, bytes, kind, path: null });
}

function analysisIdentity(operationId, inputs) {
  const ordered = [...inputs.values()].sort((left, right) => left.label.localeCompare(right.label));
  const framed = [operationId, String(ordered.length)];
  for (const entry of ordered) framed.push(entry.label, entry.bytes);
  return {
    id: framedDigest(ANALYSIS_DOMAIN, framed),
    records: ordered.map((entry) => inputRecord(entry.label, entry.bytes, entry.kind)),
  };
}

function semanticSummary(operation, expression, holes) {
  const resultType = expression ?? 'an explicit author-selected validator after resolving the reported holes';
  return {
    schemaVersion: 'snapback.declaration-semantic-summary.v1',
    runtimeValidation: `${operation.kind} egress will be validated by the frozen ${resultType} contract after normal generation.`,
    generatedClientTypes: 'Generated clients will project the same frozen result contract; the suggestion receipt is not consulted.',
    unresolvedHoles: holes.length,
    checksAfterAcceptance: [
      'snapback generate --check',
      'resultContractHash comparison through normal codegen',
      'the backend acceptance test selected by the app',
    ],
  };
}

function refusedCandidate(code, message, operation, base) {
  const sourceExpression = '<unavailable>';
  const candidate = refusal(code, message, '$', sourceExpression);
  return finishSuggestion(operation, candidate, base);
}

function finishSuggestion(operation, candidate, base) {
  const status = overallStatus(candidate);
  const expression = status === 'refused' || status === 'holed' ? null : candidate.expression;
  const after = expression ? resultDeclarationSource(expression, operation) : null;
  const before = operation.result
    ? base.definitionSource.slice(operation.result.getStart(operation.file), operation.result.end)
    : null;
  const patch = expression && before !== after
    ? patchTarget(base.definitionSource, operation, expression, base.definitionFile)
    : null;
  const identity = analysisIdentity(base.operationId, base.inputs);
  return {
    schemaVersion: SUGGESTION_SCHEMA_VERSION,
    artifactKind: 'declarationSuggestion',
    ok: true,
    status,
    operation: {
      schemaVersion: 'snapback.declaration-suggestion-operation.v1',
      id: base.operationId,
      name: operation.name,
      kind: operation.kind,
    },
    source: {
      schemaVersion: 'snapback.declaration-suggestion-source.v1',
      backend: base.backendRoot,
      definitionFile: base.definitionFile,
      definitionDigest: base.definitionDigest,
      schemaDigest: base.schemaDigest,
      generatedTypeDigest: base.generatedTypeDigest,
      moduleFormat: base.moduleFormat,
    },
    compiler: suggestionCompilerIdentity,
    analyzer: analyzerIdentity,
    analysisInputId: identity.id,
    analysisInputs: identity.records,
    runtimeEvidenceReceipts: [],
    declaration: {
      schemaVersion: 'snapback.declaration-freeze.v1',
      before,
      after,
    },
    evidence: candidate.evidence,
    confidence: confidenceSummary(candidate.evidence),
    holes: candidate.holes,
    diagnostics: candidate.refusal ? [candidate.refusal] : [],
    patch,
    semanticSummary: semanticSummary(operation, expression, candidate.holes),
  };
}

function moduleFormatFor(path, backendRoot, inputs) {
  const packageJson = nearestPackageJson(path);
  if (!packageJson) return extensionModuleFormat(path);
  try {
    const loaded = snapshot(packageJson, [backendRoot, REPO_ROOT], 'SUGGESTION_MODULE_FORMAT', 'module-format', backendRoot, inputs);
    const packageType = JSON.parse(decodeUtf8Source(loaded.bytes, packageJson, 'SUGGESTION_MODULE_FORMAT'))?.type ?? null;
    return extensionModuleFormat(path, packageType);
  } catch {
    return extensionModuleFormat(path);
  }
}

function selectBackendAndOperation(target, cwd) {
  let operand = target;
  let operation = null;
  const hash = operand.lastIndexOf('#');
  if (hash !== -1) {
    operation = operand.slice(hash + 1) || null;
    operand = operand.slice(0, hash);
  }
  if (operand && existsSync(resolve(cwd, operand))) {
    const path = resolve(cwd, operand);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return { backendDir: path, definitionFile: 'functions.mjs', operation };
    if (stat.isFile()) return { backendDir: dirname(path), definitionFile: path.split(sep).at(-1), operation };
  }
  const cwdBackend = existsSync(join(cwd, 'functions.mjs'))
    ? cwd
    : existsSync(join(cwd, 'snapback', 'functions.mjs'))
      ? join(cwd, 'snapback')
      : null;
  if (!cwdBackend) return null;
  const name = operation ?? operand;
  return {
    backendDir: cwdBackend,
    definitionFile: 'functions.mjs',
    operation: name?.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name,
  };
}

/** Resolve the CLI's flexible `<operation-or-file>` operand without reading source. */
export function resolveDeclarationSuggestionTarget(target, { cwd = process.cwd() } = {}) {
  if (typeof target !== 'string' || target.length === 0) return null;
  return selectBackendAndOperation(target, resolve(cwd));
}

/**
 * Derive result-only DeclarationSuggestionV1 records from a backend's stable
 * definition/schema/generated-type snapshot. This function is read-only.
 */
export function suggestDeclarations({
  backendDir,
  definitionFile = 'functions.mjs',
  operation = null,
} = {}) {
  let backendRoot;
  try {
    backendRoot = realpathSync(backendDir);
  } catch (cause) {
    return commandFailure(
      'SNAPBACK_AUTHORING_DEFINITION_INVALID',
      `backend directory ${String(backendDir)} could not be resolved`,
      { cause: cause.message },
    );
  }
  if (
    typeof definitionFile !== 'string'
    || definitionFile.length === 0
    || definitionFile.includes('\\')
    || isAbsolute(definitionFile)
    || definitionFile.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return commandFailure(
      'SNAPBACK_AUTHORING_DEFINITION_INVALID',
      'definition file must be a portable backend-relative path',
      { definitionFile },
    );
  }
  const definitionPath = join(backendRoot, ...definitionFile.split('/'));
  const familiarProfile = existsSync(join(backendRoot, 'schema.ts'));
  const outputDirectory = familiarProfile ? '_generated' : 'generated';
  const schemaPath = join(backendRoot, familiarProfile ? 'schema.ts' : 'schema.mjs');
  const apiPath = join(backendRoot, outputDirectory, 'api.d.ts');
  const schemaManifestPath = join(backendRoot, outputDirectory, 'schema.manifest.json');
  const functionsManifestPath = join(backendRoot, outputDirectory, 'functions.manifest.json');
  const inputs = new Map();
  let definitionSnapshot;
  let schemaSnapshot;
  let apiSnapshot;
  let schemaManifestSnapshot;
  let functionsManifestSnapshot;
  try {
    definitionSnapshot = snapshot(definitionPath, [backendRoot], 'SUGGESTION_DEFINITION', 'source', backendRoot, inputs);
    schemaSnapshot = snapshot(schemaPath, [backendRoot], 'SUGGESTION_SCHEMA', 'schema', backendRoot, inputs);
    apiSnapshot = snapshot(apiPath, [backendRoot], 'SUGGESTION_GENERATED_TYPES', 'generated-type', backendRoot, inputs);
    schemaManifestSnapshot = snapshot(schemaManifestPath, [backendRoot], 'SUGGESTION_GENERATED_SCHEMA', 'generated-fact', backendRoot, inputs);
    functionsManifestSnapshot = snapshot(functionsManifestPath, [backendRoot], 'SUGGESTION_GENERATED_FUNCTIONS', 'generated-fact', backendRoot, inputs);
  } catch (cause) {
    return commandFailure(
      'SNAPBACK_AUTHORING_COMPILER_CONTEXT_MISSING',
      'declaration suggestions require functions.mjs, schema.mjs, and a current generated api.d.ts/schema/function context; run snapback generate first',
      { cause: cause.message },
    );
  }
  let definitionSource;
  let functionsManifest;
  try {
    definitionSource = decodeUtf8Source(definitionSnapshot.bytes, definitionPath, 'SUGGESTION_DEFINITION');
    functionsManifest = JSON.parse(decodeUtf8Source(functionsManifestSnapshot.bytes, functionsManifestPath, 'SUGGESTION_GENERATED_FUNCTIONS'));
    JSON.parse(decodeUtf8Source(schemaManifestSnapshot.bytes, schemaManifestPath, 'SUGGESTION_GENERATED_SCHEMA'));
  } catch (cause) {
    return commandFailure(
      'SNAPBACK_AUTHORING_DEFINITION_INVALID',
      'definition or generated context is not valid UTF-8/JSON',
      { cause: cause.message },
    );
  }
  const parsed = parseOperations(definitionSource, definitionPath);
  if (familiarProfile) {
    const moduleName = definitionFile.split('/').at(-1).replace(/\.(?:ts|mts)$/u, '');
    for (const entry of parsed.operations) entry.name = `${moduleName}.${entry.name}`;
  }
  let selected = parsed.operations;
  if (operation !== null) selected = selected.filter((entry) => (
    entry.name === operation || entry.name.split('.').at(-1) === operation
  ));
  if (selected.length === 0) {
    return commandFailure(
      'SNAPBACK_AUTHORING_OPERATION_NOT_FOUND',
      operation === null
        ? `${definitionFile} contains no result-suggestible JavaScript operations`
        : `operation ${operation} was not found in ${definitionFile}`,
      { operation, definitionFile, available: parsed.operations.map((entry) => entry.name) },
    );
  }

  const moduleFacts = new Map();
  collectSourceGraph([definitionPath, schemaPath], backendRoot, inputs, moduleFacts);
  const moduleFormat = moduleFormatFor(definitionPath, backendRoot, inputs);
  addSyntheticInput(inputs, 'compiler:effective-config', suggestionCompilerIdentity, 'compiler-config');
  addSyntheticInput(inputs, 'analyzer:identity', analyzerIdentity, 'analyzer');
  addSyntheticInput(inputs, 'runtime-evidence:empty-set', [], 'runtime-evidence');
  addSyntheticInput(inputs, 'module-format:facts', [...moduleFacts.entries()].sort(), 'module-format');
  const schemaInputs = [...inputs.values()].filter((entry) => entry.kind === 'schema' || entry.label.includes('schema.mjs'));
  const schemaDigest = framedDigest(
    'snapback-codegen/declaration-suggestion-schema-closure/v1',
    schemaInputs.sort((left, right) => left.label.localeCompare(right.label)).flatMap((entry) => [entry.label, entry.bytes]),
  );
  const manifestByName = new Map((functionsManifest.functions ?? []).map((entry) => [entry.name, entry]));
  const suggestions = [];
  for (const entry of selected) {
    const perOperationInputs = new Map(inputs);
    const perOperationModuleFacts = new Map(moduleFacts);
    const manifest = manifestByName.get(entry.name);
    const operationId = manifest?.id ?? `${functionsManifest.appId ?? 'app'}:${entry.name}`;
    let handler;
    try {
      handler = handlerExpression(entry, definitionSource, backendRoot, perOperationInputs);
    } catch (cause) {
      handler = null;
    }
    const base = {
      backendRoot,
      definitionFile,
      definitionSource,
      definitionDigest: digest(definitionSnapshot.bytes),
      schemaDigest,
      generatedTypeDigest: digest(apiSnapshot.bytes),
      moduleFormat,
      operationId,
      inputs: perOperationInputs,
    };
    if (!handler) {
      suggestions.push(refusedCandidate(
        'SNAPBACK_AUTHORING_HANDLER_NOT_FOUND',
        `handler source for ${entry.name} could not be resolved from the frozen definition`,
        entry,
        base,
      ));
      continue;
    }
    collectSourceGraph([handler.sourcePath], backendRoot, perOperationInputs, perOperationModuleFacts);
    addSyntheticInput(perOperationInputs, 'module-format:facts', [...perOperationModuleFacts.entries()].sort(), 'module-format');
    const analysis = createAnalysisProgram({
      backendRoot,
      definitionSource,
      definitionPath,
      operation: entry,
      handler,
      apiPath: apiSnapshot.path,
      inputs: perOperationInputs,
    });
    if (!analysis || !analysis.apiFile) {
      suggestions.push(refusedCandidate(
        'SNAPBACK_AUTHORING_ANALYSIS_FAILED',
        `TypeScript could not build the lib-bearing analysis program for ${entry.name}`,
        entry,
        base,
      ));
      continue;
    }
    const generatedContexts = exportedType(analysis.checker, analysis.apiFile, 'GeneratedFunctionContexts');
    if (
      !generatedContexts
      || !analysis.checker.getPropertyOfType(generatedContexts, entry.name)
      || analysis.captureDiagnostics.some((problem) => [2304, 2344, 2307].includes(problem.code))
    ) {
      suggestions.push(refusedCandidate(
        'SNAPBACK_AUTHORING_COMPILER_CONTEXT_MISSING',
        `generated api.d.ts does not provide the exact handler context for ${entry.name}; run snapback generate and retry`,
        entry,
        base,
      ));
      continue;
    }
    const tables = tableTypes(analysis.checker, analysis.apiFile);
    const candidate = topLevelContract(analysis.type, entry, { checker: analysis.checker, tables });
    suggestions.push(finishSuggestion(entry, candidate, base));
  }
  return {
    schemaVersion: SUGGEST_RESULT_SCHEMA_VERSION,
    artifactKind: 'declarationSuggestionResult',
    ok: true,
    suggestions,
    diagnostics: [],
  };
}

export function formatDeclarationSuggestionPatch(result) {
  if (!result?.ok) {
    return `${result?.diagnostics?.map((entry) => `${entry.code}: ${entry.message}`).join('\n') ?? 'declaration suggestion failed'}\n`;
  }
  const blocks = [];
  for (const suggestion of result.suggestions ?? []) {
    blocks.push([
      `# ${suggestion.operation.id}: ${suggestion.status}`,
      `# Runtime validation: ${suggestion.semanticSummary.runtimeValidation}`,
      `# Generated-client types: ${suggestion.semanticSummary.generatedClientTypes}`,
      `# Unresolved holes: ${suggestion.semanticSummary.unresolvedHoles}`,
      `# Checks after acceptance: ${suggestion.semanticSummary.checksAfterAcceptance.join('; ')}`,
      ...(suggestion.holes ?? []).map((entry) => `# HOLE ${entry.code} ${entry.path}: ${entry.sourceExpression} -> ${entry.availableChoices.join(' | ')}`),
      ...(suggestion.diagnostics ?? []).map((entry) => `# REFUSED ${entry.code}: ${entry.message}`),
      ...(suggestion.patch ? [suggestion.patch.unifiedDiff.trimEnd()] : ['# No source patch is available.']),
    ].join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
}

function suggestionFromInput(input) {
  if (input?.schemaVersion === SUGGESTION_SCHEMA_VERSION && input?.artifactKind === 'declarationSuggestion') return input;
  if (
    input?.schemaVersion === SUGGEST_RESULT_SCHEMA_VERSION
    && input?.artifactKind === 'declarationSuggestionResult'
    && input?.ok === true
    && Array.isArray(input.suggestions)
    && input.suggestions.length === 1
  ) return input.suggestions[0];
  return null;
}

function sameFrozenSuggestion(left, right) {
  return left.analysisInputId === right.analysisInputId
    && stableJson(left.compiler) === stableJson(right.compiler)
    && stableJson(left.analyzer) === stableJson(right.analyzer)
    && stableJson(left.declaration) === stableJson(right.declaration)
    && stableJson(left.patch) === stableJson(right.patch);
}

function acquireApplyLock(backendRoot) {
  const path = join(backendRoot, APPLY_LOCK_FILE);
  const token = `${process.pid}:${randomUUID()}`;
  try {
    writeFileSync(path, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (cause) {
    return { ok: false, cause };
  }
  return { ok: true, path, token };
}

function releaseApplyLock(lock) {
  if (!lock?.ok) return;
  try {
    if (readFileSync(lock.path, 'utf8').trim() === lock.token) rmSync(lock.path, { force: true });
  } catch {
    // A failed cleanup does not weaken the completed atomic source write.
  }
}

// @ref LLP 0245#d1-one-read-only-suggestion-command — apply is the one
// Snapback-owned compare-and-write seam. It re-runs the complete analysis,
// compares the exact frozen declaration and target, then uses a sibling temp
// plus atomic rename; every stale/refused path changes no source byte.
export function applyDeclarationSuggestion(input, { testHooks = undefined } = {}) {
  const suggestion = suggestionFromInput(input);
  if (!suggestion || suggestion.ok !== true || !suggestion.patch || suggestion.declaration?.after === null) {
    return applyFailure(
      'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID',
      'apply requires exactly one patch-bearing DeclarationSuggestionV1 record',
      suggestion,
    );
  }
  if (
    !DIAGNOSTIC_CODE_SET.has(STALE_SUGGESTION_CODE)
    || suggestion.source?.definitionFile !== suggestion.patch.file
    || typeof suggestion.source?.backend !== 'string'
    || suggestion.source.backend.length === 0
    || stableJson(suggestion.compiler) !== stableJson(suggestionCompilerIdentity)
    || stableJson(suggestion.analyzer) !== stableJson(analyzerIdentity)
  ) {
    return applyFailure(
      STALE_SUGGESTION_CODE,
      'suggestion compiler/analyzer identity or patch target does not match this tool',
      suggestion,
    );
  }
  let backendRoot;
  try {
    backendRoot = realpathSync(suggestion.source.backend);
  } catch (cause) {
    return applyFailure(STALE_SUGGESTION_CODE, 'suggestion backend is no longer available', suggestion, { cause: cause.message });
  }
  const lock = acquireApplyLock(backendRoot);
  if (!lock.ok) {
    return applyFailure(
      STALE_SUGGESTION_CODE,
      'another declaration apply owns the backend; regenerate after it completes',
      suggestion,
      { cause: lock.cause?.message ?? String(lock.cause) },
    );
  }
  let temporary = null;
  try {
    const freshResult = suggestDeclarations({
      backendDir: backendRoot,
      definitionFile: suggestion.source.definitionFile,
      operation: suggestion.operation.name,
    });
    const fresh = freshResult.ok ? freshResult.suggestions[0] : null;
    if (!fresh || !sameFrozenSuggestion(suggestion, fresh)) {
      return applyFailure(
        STALE_SUGGESTION_CODE,
        'definition, helper/type closure, schema/generated facts, compiler configuration, analyzer, or runtime evidence changed',
        suggestion,
      );
    }
    const sourcePath = join(backendRoot, ...suggestion.patch.file.split('/'));
    const beforeStat = lstatSync(sourcePath);
    if (!beforeStat.isFile() || beforeStat.isSymbolicLink()) {
      return applyFailure(STALE_SUGGESTION_CODE, 'patch target is no longer a regular non-symlink file', suggestion);
    }
    const capability = resolveFileReadCapability(sourcePath, {
      allowedRoots: [backendRoot],
      allowSymlink: false,
      codePrefix: 'SUGGESTION_APPLY_SOURCE',
    });
    const bytes = capability.read();
    const source = decodeUtf8Source(bytes, sourcePath, 'SUGGESTION_APPLY_SOURCE');
    if (
      digest(bytes) !== suggestion.source.definitionDigest
      || source.slice(suggestion.patch.startOffset, suggestion.patch.endOffset) !== suggestion.patch.beforeText
    ) {
      return applyFailure(STALE_SUGGESTION_CODE, 'source bytes or exact patch target changed before write', suggestion);
    }
    const changed = source.slice(0, suggestion.patch.startOffset)
      + suggestion.patch.afterText
      + source.slice(suggestion.patch.endOffset);
    temporary = join(dirname(sourcePath), `.${sourcePath.split(sep).at(-1)}.suggestion-${process.pid}-${randomUUID()}.tmp`);
    const fd = openSync(temporary, 'wx', beforeStat.mode & 0o777);
    try {
      writeFileSync(fd, changed, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temporary, beforeStat.mode & 0o777);
    const immediatelyBeforeRename = statSync(sourcePath);
    if (
      immediatelyBeforeRename.dev !== beforeStat.dev
      || immediatelyBeforeRename.ino !== beforeStat.ino
      || immediatelyBeforeRename.size !== beforeStat.size
      || immediatelyBeforeRename.mtimeMs !== beforeStat.mtimeMs
    ) {
      rmSync(temporary, { force: true });
      temporary = null;
      return applyFailure(STALE_SUGGESTION_CODE, 'source changed during the compare-and-write window', suggestion);
    }
    testHooks?.beforeFinalAnalysis?.();
    // @ref LLP 0245#d1-one-read-only-suggestion-command — the target stat is
    // only a fast pre-check. Bind the atomic rename to a fresh identity over
    // the complete source/schema/generated/compiler/analyzer/evidence closure.
    const boundaryResult = suggestDeclarations({
      backendDir: backendRoot,
      definitionFile: suggestion.source.definitionFile,
      operation: suggestion.operation.name,
    });
    const boundary = boundaryResult.ok ? boundaryResult.suggestions[0] : null;
    if (!boundary || boundary.analysisInputId !== suggestion.analysisInputId) {
      rmSync(temporary, { force: true });
      temporary = null;
      return applyFailure(
        STALE_SUGGESTION_CODE,
        'analysis inputs changed during the compare-and-write window',
        suggestion,
      );
    }
    renameSync(temporary, sourcePath);
    temporary = null;
    const output = Buffer.from(changed, 'utf8');
    return {
      schemaVersion: APPLY_RESULT_SCHEMA_VERSION,
      artifactKind: 'declarationSuggestionApplyResult',
      ok: true,
      operationId: suggestion.operation.id,
      analysisInputId: suggestion.analysisInputId,
      path: suggestion.patch.file,
      sourceDigest: digest(output),
      diagnostics: [],
    };
  } catch (cause) {
    return applyFailure(
      STALE_SUGGESTION_CODE,
      'the compare-and-write seam could not prove an unchanged target; no source write was accepted',
      suggestion,
      { cause: cause.message },
    );
  } finally {
    if (temporary) rmSync(temporary, { force: true });
    releaseApplyLock(lock);
  }
}

export function readDeclarationSuggestionFile(path, { cwd = process.cwd() } = {}) {
  const absolute = resolve(cwd, path);
  try {
    const capability = resolveFileReadCapability(absolute, {
      allowedRoots: [dirname(absolute)],
      allowSymlink: false,
      codePrefix: 'SUGGESTION_INPUT',
    });
    return JSON.parse(decodeUtf8Source(capability.read(), absolute, 'SUGGESTION_INPUT'));
  } catch (cause) {
    const error = new Error(`could not read declaration suggestion ${path}: ${cause.message}`);
    error.code = 'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID';
    throw error;
  }
}
