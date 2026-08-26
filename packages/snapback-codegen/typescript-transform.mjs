import ts from 'typescript';
import { basename, extname } from 'node:path';

import {
  HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES as RULES,
  handlerTypeScriptCompilerOptions,
  handlerTypeScriptIdentity,
} from './typescript-profile.mjs';

const ADMITTED_SOURCE_EXTENSIONS = new Set(['.ts', '.mts']);
const ADMITTED_EDGE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.mts']);
const BASE64_VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const EMIT_HELPERS = /\b__(?:addDisposableResource|assign|asyncDelegator|asyncGenerator|asyncValues|awaiter|classPrivateFieldGet|classPrivateFieldIn|classPrivateFieldSet|createBinding|decorate|disposeResources|esDecorate|exportStar|extends|generator|importDefault|importStar|makeTemplateObject|metadata|param|propKey|read|rest|rewriteRelativeImportExtension|runInitializers|setFunctionName|setModuleDefault|spreadArray|values)\b/gu;

function point(sourceFile, node) {
  const offset = node?.getStart?.(sourceFile) ?? 0;
  const location = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: location.line + 1, column: location.character + 1, offset };
}

function diagnostic(code, message, sourceFile, node, extra = {}) {
  return {
    code,
    severity: 'error',
    subsystem: 'codegen',
    message,
    path: sourceFile.fileName,
    ...point(sourceFile, node),
    details: extra,
  };
}

function moduleSpecifierRule(specifier) {
  if (specifier.startsWith('node:')) {
    return { code: RULES.nodeImport, message: `Node builtin import ${JSON.stringify(specifier)} is outside ${handlerTypeScriptIdentity().sourceProfile}` };
  }
  if (/^(?:@\/|~\/|#)/u.test(specifier)) {
    return { code: RULES.pathAlias, message: `path-alias import ${JSON.stringify(specifier)} is not resolved by Snapback` };
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return { code: RULES.bareImport, message: `bare/package import ${JSON.stringify(specifier)} is outside the package-free handler profile` };
  }
  const clean = specifier.split(/[?#]/u, 1)[0];
  if (!ADMITTED_EDGE_EXTENSIONS.has(extname(clean).toLowerCase())) {
    return { code: RULES.extensionInference, message: `relative TypeScript import ${JSON.stringify(specifier)} must include an explicit .js, .mjs, .ts, or .mts extension` };
  }
  return null;
}

function hasDecorators(node) {
  return Boolean(ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0);
}

function parameterPropertyModifier(node) {
  if (!ts.isParameter(node) || !ts.canHaveModifiers(node)) return null;
  return ts.getModifiers(node)?.find((modifier) => [
    ts.SyntaxKind.PublicKeyword,
    ts.SyntaxKind.PrivateKeyword,
    ts.SyntaxKind.ProtectedKeyword,
    ts.SyntaxKind.ReadonlyKeyword,
    ts.SyntaxKind.OverrideKeyword,
  ].includes(modifier.kind)) ?? null;
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier : null;
  }
  return null;
}

export function inspectTypeScriptHandlerSource(source, sourcePath) {
  const lowerPath = sourcePath.toLowerCase();
  const extension = extname(lowerPath);
  const scriptKind = lowerPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
  const diagnostics = [];
  const seen = new Set();
  const add = (code, message, node, extra = {}) => {
    const location = point(sourceFile, node);
    const key = `${code}\0${location.offset}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(diagnostic(code, message, sourceFile, node, extra));
  };

  if (/\.d\.(?:ts|mts|cts)$/u.test(lowerPath)) {
    add(RULES.declarationFile, 'TypeScript declaration files cannot be executable handlers', sourceFile);
  } else if (extension === '.tsx') {
    add(RULES.tsx, 'JSX/TSX is outside bounded-handler-typescript-v1', sourceFile);
  } else if (extension === '.cts') {
    add(RULES.commonJs, 'CommonJS .cts handlers are outside bounded-handler-typescript-v1', sourceFile);
  } else if (!ADMITTED_SOURCE_EXTENSIONS.has(extension)) {
    add(RULES.unsupportedExtension, `handler source ${sourcePath} must end in .ts or .mts`, sourceFile);
  }

  for (const parseDiagnostic of sourceFile.parseDiagnostics ?? []) {
    const start = Number.isInteger(parseDiagnostic.start) ? parseDiagnostic.start : 0;
    const node = { getStart: () => start };
    add(
      RULES.transformFailed,
      `handler source is not valid TypeScript: ${ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, '\n')}`,
      node,
      { typescriptCode: parseDiagnostic.code },
    );
  }

  function visit(node) {
    if (ts.isEnumDeclaration(node)) {
      const isConst = ts.canHaveModifiers(node)
        && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword);
      if (isConst) {
        add(RULES.constEnum, 'const enum emits runtime JavaScript and is outside the syntax-erasure profile', node);
      } else {
        add(RULES.enum, 'enum emits runtime JavaScript and is outside the syntax-erasure profile', node);
      }
    } else if (ts.isModuleDeclaration(node)) {
      add(RULES.namespace, 'TypeScript namespaces/modules emit runtime JavaScript and are outside the syntax-erasure profile', node);
    } else if (ts.isImportEqualsDeclaration(node) || ts.isExportAssignment(node) && node.isExportEquals) {
      add(RULES.commonJs, 'TypeScript CommonJS import/export syntax is outside the ESM handler profile', node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(RULES.dynamicImport, 'dynamic import() is outside the closed handler graph', node.expression);
    } else if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
    ) {
      add(RULES.commonJs, 'CommonJS require() is outside the ESM handler profile', node.expression);
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && ts.isIdentifier(node.left.expression)
      && node.left.expression.text === 'module'
      && node.left.name.text === 'exports'
    ) {
      add(RULES.commonJs, 'CommonJS module.exports is outside the ESM handler profile', node.left);
    }

    const propertyModifier = parameterPropertyModifier(node);
    if (propertyModifier) {
      add(
        RULES.parameterProperty,
        'constructor parameter properties emit class-field assignments and are outside the syntax-erasure profile',
        propertyModifier,
      );
    }
    if (hasDecorators(node)) {
      add(RULES.decorator, 'decorators and decorator metadata are outside the syntax-erasure profile', ts.getDecorators(node)[0]);
    }
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Using) !== 0) {
      add(RULES.nonErasableSyntax, 'using/await using requires TypeScript emit helpers and is outside the syntax-erasure profile', node);
    }

    const specifierNode = moduleSpecifier(node);
    if (specifierNode) {
      const refusal = moduleSpecifierRule(specifierNode.text);
      if (refusal) add(refusal.code, refusal.message, specifierNode, { specifier: specifierNode.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return diagnostics
    .sort((left, right) => left.offset - right.offset || left.code.localeCompare(right.code))
    .map(({ offset: _offset, ...entry }) => entry);
}

export function emittedTypeScriptPaths(sourcePath) {
  if (/\.mts$/iu.test(sourcePath)) {
    return {
      javascriptPath: sourcePath.replace(/\.mts$/iu, '.mjs'),
      sourceMapPath: sourcePath.replace(/\.mts$/iu, '.mjs.map'),
    };
  }
  return {
    javascriptPath: sourcePath.replace(/\.ts$/iu, '.js'),
    sourceMapPath: sourcePath.replace(/\.ts$/iu, '.js.map'),
  };
}

function sourceMapDiagnostic(sourcePath, message, details = {}) {
  return {
    code: RULES.sourceMapFailed,
    severity: 'error',
    subsystem: 'codegen',
    message,
    path: sourcePath,
    line: 1,
    column: 1,
    details,
  };
}

export function transformTypeScriptHandler({ source, sourcePath }) {
  const diagnostics = inspectTypeScriptHandlerSource(source, sourcePath);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  let transformed;
  try {
    transformed = ts.transpileModule(source, {
      compilerOptions: handlerTypeScriptCompilerOptions({ emit: true }),
      fileName: sourcePath,
      reportDiagnostics: true,
    });
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: RULES.transformFailed,
        severity: 'error',
        subsystem: 'codegen',
        message: `TypeScript syntax erasure failed: ${error.message}`,
        path: sourcePath,
        line: 1,
        column: 1,
        details: {},
      }],
    };
  }
  const compilerDiagnostics = (transformed.diagnostics ?? []).filter(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
  if (compilerDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: compilerDiagnostics.map((entry) => {
        const start = Number.isInteger(entry.start) ? entry.start : 0;
        const file = entry.file ?? ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
        const location = file.getLineAndCharacterOfPosition(start);
        return {
          code: RULES.transformFailed,
          severity: 'error',
          subsystem: 'codegen',
          message: `TypeScript syntax erasure failed: ${ts.flattenDiagnosticMessageText(entry.messageText, '\n')}`,
          path: sourcePath,
          line: location.line + 1,
          column: location.character + 1,
          details: { typescriptCode: entry.code },
        };
      }),
    };
  }

  const paths = emittedTypeScriptPaths(sourcePath);
  let javascript = transformed.outputText.replace(/\/\/# sourceMappingURL=.*?(?:\r?\n)?$/u, '');
  // TypeScript marks every `.mts` as a module by appending an unmapped
  // `export {}`. Handler modules execute as closed scripts, and all authored
  // import/export forms are independently refused, so this compiler-only
  // marker is not a runtime edge.
  if (/\.mts$/iu.test(sourcePath)) javascript = javascript.replace(/export \{\};\r?\n$/u, '');
  if (!javascript.endsWith('\n')) javascript += '\n';

  const helper = [...javascript.matchAll(EMIT_HELPERS)][0];
  if (helper) {
    return {
      ok: false,
      diagnostics: [{
        code: RULES.emitHelper,
        severity: 'error',
        subsystem: 'codegen',
        message: `TypeScript emitted helper ${helper[0]}; bounded-handler-typescript-v1 permits syntax erasure only`,
        path: sourcePath,
        line: 1,
        column: 1,
        details: { helper: helper[0] },
      }],
    };
  }

  if (typeof transformed.sourceMapText !== 'string' || transformed.sourceMapText.length === 0) {
    return { ok: false, diagnostics: [sourceMapDiagnostic(sourcePath, 'TypeScript did not produce the required source map')] };
  }
  let sourceMap;
  try {
    sourceMap = JSON.parse(transformed.sourceMapText);
  } catch (error) {
    return { ok: false, diagnostics: [sourceMapDiagnostic(sourcePath, `TypeScript produced an invalid source map: ${error.message}`)] };
  }
  sourceMap.file = basename(paths.javascriptPath);
  sourceMap.sourceRoot = '';
  sourceMap.sources = [basename(sourcePath)];
  sourceMap.sourcesContent = [source];
  if (
    sourceMap.version !== 3
    || typeof sourceMap.mappings !== 'string'
    || sourceMap.sources.some((entry) => entry.includes('/') || entry.includes('\\'))
  ) {
    return { ok: false, diagnostics: [sourceMapDiagnostic(sourcePath, 'TypeScript source map failed the bounded custody checks')] };
  }

  return {
    ok: true,
    diagnostics: [],
    javascript,
    javascriptBytes: Buffer.from(javascript, 'utf8'),
    javascriptPath: paths.javascriptPath,
    sourceMap,
    sourceMapText: `${JSON.stringify(sourceMap)}\n`,
    sourceMapPath: paths.sourceMapPath,
    identity: handlerTypeScriptIdentity(),
  };
}

function decodeVlq(segment, start) {
  let value = 0;
  let shift = 0;
  let index = start;
  for (; index < segment.length; index += 1) {
    const digit = BASE64_VLQ.indexOf(segment[index]);
    if (digit < 0) throw new Error('invalid base64 VLQ digit');
    value += (digit & 31) << shift;
    if ((digit & 32) === 0) {
      const negative = (value & 1) === 1;
      return { value: negative ? -(value >> 1) : value >> 1, next: index + 1 };
    }
    shift += 5;
  }
  throw new Error('unterminated base64 VLQ value');
}

export function mapGeneratedTypeScriptPosition(sourceMap, line, column) {
  try {
    const lines = sourceMap.mappings.split(';');
    let sourceIndex = 0;
    let originalLine = 0;
    let originalColumn = 0;
    for (let generatedLine = 0; generatedLine < lines.length; generatedLine += 1) {
      let generatedColumn = 0;
      let best = null;
      for (const rawSegment of lines[generatedLine].split(',')) {
        if (rawSegment === '') continue;
        const values = [];
        let cursor = 0;
        while (cursor < rawSegment.length) {
          const decoded = decodeVlq(rawSegment, cursor);
          values.push(decoded.value);
          cursor = decoded.next;
        }
        generatedColumn += values[0];
        if (values.length >= 4) {
          sourceIndex += values[1];
          originalLine += values[2];
          originalColumn += values[3];
          if (generatedLine === line - 1 && generatedColumn <= column - 1) {
            best = { generatedColumn, sourceIndex, originalLine, originalColumn };
          }
        }
      }
      if (generatedLine === line - 1 && best) {
        return {
          file: sourceMap.sources[best.sourceIndex] ?? sourceMap.sources[0],
          line: best.originalLine + 1,
          column: best.originalColumn + 1 + Math.max(0, column - 1 - best.generatedColumn),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function typecheckTypeScriptHandler({ source, sourcePath, declarations = {} }) {
  const options = handlerTypeScriptCompilerOptions({ emit: false });
  const ambientPath = '/__snapback_handler_runtime.d.ts';
  const ambientSource = [
    'declare global {',
    '  var __snapbackHandlers: Record<string, (...args: any[]) => unknown>;',
    '}',
    'export {};',
    '',
  ].join('\n');
  const virtualFiles = new Map([
    [sourcePath, source],
    [ambientPath, ambientSource],
    ...Object.entries(declarations),
  ]);
  const defaultHost = ts.createCompilerHost(options, true);
  const canonical = (fileName) => fileName.replaceAll('\\', '/');
  const lookup = (fileName) => virtualFiles.get(canonical(fileName));
  const host = {
    ...defaultHost,
    fileExists(fileName) {
      return lookup(fileName) !== undefined || defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      return lookup(fileName) ?? defaultHost.readFile(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const text = lookup(fileName);
      if (text !== undefined) {
        return ts.createSourceFile(fileName, text, languageVersion, true, fileName.endsWith('.mts') ? ts.ScriptKind.TS : undefined);
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
  };
  const rootNames = [sourcePath, ambientPath, ...Object.keys(declarations)];
  const program = ts.createProgram(rootNames, options, host);
  const sourceFile = program.getSourceFile(sourcePath);
  if (!sourceFile) {
    return [{
      code: RULES.typecheckFailed,
      severity: 'error',
      subsystem: 'codegen',
      message: 'TypeScript checker could not load the authored handler source',
      path: sourcePath,
      line: 1,
      column: 1,
      details: {},
    }];
  }
  return [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ].filter((entry) => entry.category === ts.DiagnosticCategory.Error).map((entry) => {
    const start = Number.isInteger(entry.start) ? entry.start : 0;
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      code: RULES.typecheckFailed,
      severity: 'error',
      subsystem: 'codegen',
      message: `TypeScript ${entry.code}: ${ts.flattenDiagnosticMessageText(entry.messageText, '\n')}`,
      path: sourcePath,
      line: location.line + 1,
      column: location.character + 1,
      details: { typescriptCode: entry.code },
    };
  });
}
