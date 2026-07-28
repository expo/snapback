import ts from 'typescript';
import { createHash } from 'node:crypto';

// @ref LLP 0101#final-author-reconciliation-after-round-3 — inline v1 is one
// self-contained function expression. This extractor never obtains executable
// authority from Function.prototype.toString() and never follows a source graph.

const INLINE_BUILDERS = new Set([
  'defineJsQuery',
  'defineJsLiveQuery',
  'defineJsMutation',
  'defineAction',
]);

const ALLOWED_GLOBALS = new Set([
  'Array',
  'BigInt',
  'Boolean',
  'Date',
  'Error',
  'Infinity',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Set',
  'String',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint8Array',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'undefined',
]);

const diagnostic = (code, message, path, node, sourceFile, details = {}) => {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    code,
    severity: 'error',
    subsystem: 'function',
    message,
    path,
    line: start.line + 1,
    column: start.character + 1,
    sourceSpan: {
      file: path,
      line: start.line + 1,
      column: start.character + 1,
    },
    ...details,
  };
};

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function isDeclarationIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    (ts.isVariableDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)
      || ts.isCatchClause(parent)
      || ts.isBindingElement(parent))
    && parent.name === node
  ) return true;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isShorthandPropertyAssignment(parent))
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isLabeledStatement(parent) && parent.label === node)
    || (ts.isBreakOrContinueStatement(parent) && parent.label === node)
  ) return true;
  return false;
}

function selfContainedProblems(expression, checker) {
  const referenced = new Set();
  const forbidden = [];
  const collect = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      forbidden.push({ node, reason: 'class syntax is outside inline_handler_v1' });
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      forbidden.push({ node, reason: 'ambient this/super is outside inline_handler_v1' });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      forbidden.push({ node, reason: 'dynamic import is outside inline_handler_v1' });
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'eval' || node.expression.text === 'Function')
    ) {
      forbidden.push({ node, reason: `${node.expression.text} is forbidden` });
    }
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Function'
    ) {
      forbidden.push({ node, reason: 'Function construction is forbidden' });
    }
    ts.forEachChild(node, collect);
  };
  collect(expression);
  const inspect = (node) => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && !isDeclarationIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const local = symbol?.declarations?.some(
        (declaration) => (
          declaration.getStart() >= expression.getStart()
          && declaration.end <= expression.end
        ),
      );
      if (!local && !ALLOWED_GLOBALS.has(node.text)) referenced.add(node.text);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(expression);
  const free = [...referenced].sort();
  return { forbidden, free };
}

function canonicalAst(node, sourceFile) {
  const visit = (current) => {
    const children = current.getChildren(sourceFile);
    if (children.length === 0) {
      return [current.kind, current.getText(sourceFile)];
    }
    return [current.kind, children.map(visit)];
  };
  return JSON.stringify(visit(node));
}

export function extractInlineHandlers(source, {
  path = 'functions.mjs',
} = {}) {
  const scriptKind = /\.tsx?$/iu.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
  const compilerOptions = {
    allowJs: true,
    checkJs: true,
    noLib: true,
    target: ts.ScriptTarget.ES2022,
  };
  const compilerHost = ts.createCompilerHost(compilerOptions);
  compilerHost.fileExists = (fileName) => fileName === path;
  compilerHost.readFile = (fileName) => (fileName === path ? source : undefined);
  compilerHost.getSourceFile = (fileName) => (fileName === path ? sourceFile : undefined);
  const checker = ts.createProgram([path], compilerOptions, compilerHost).getTypeChecker();
  const diagnostics = sourceFile.parseDiagnostics.map((problem) => {
    const start = Number.isInteger(problem.start) ? problem.start : 0;
    const point = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      code: 'SNAPBACK_INLINE_HANDLER_SOURCE_INVALID',
      severity: 'error',
      subsystem: 'function',
      message: ts.flattenDiagnosticMessageText(problem.messageText, '\n'),
      path,
      line: point.line + 1,
      column: point.character + 1,
    };
  });
  const handlers = new Map();
  const replacements = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      const call = declaration.initializer;
      if (
        !ts.isCallExpression(call)
        || !ts.isIdentifier(call.expression)
        || !INLINE_BUILDERS.has(call.expression.text)
        || call.arguments.length !== 1
        || !ts.isObjectLiteralExpression(call.arguments[0])
      ) continue;
      const spec = call.arguments[0];
      const fields = new Map();
      for (const member of spec.properties) {
        if (!ts.isPropertyAssignment(member)) continue;
        const key = propertyName(member.name);
        if (key) fields.set(key, member);
      }
      const handler = fields.get('handler');
      if (!handler) continue;
      if (fields.has('source') || fields.has('exportName') || fields.has('js')) {
        diagnostics.push(diagnostic(
          'SNAPBACK_FUNCTION_HANDLER_FORM_INVALID',
          `${name} mixes handler with legacy source/exportName/js wiring`,
          path,
          handler,
          sourceFile,
          { function: name },
        ));
        continue;
      }
      const expression = handler.initializer;
      if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED',
          `${name} handler must be a direct function or arrow-function expression`,
          path,
          expression,
          sourceFile,
          { function: name },
        ));
        continue;
      }
      const { forbidden, free } = selfContainedProblems(expression, checker);
      for (const problem of forbidden) {
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
          `${name}: ${problem.reason}`,
          path,
          problem.node,
          sourceFile,
          { function: name },
        ));
      }
      if (free.length > 0) {
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER',
          `${name} references identifiers outside its handler expression: ${free.join(', ')}`,
          path,
          expression,
          sourceFile,
          { function: name, identifiers: free },
        ));
      }
      if (forbidden.length > 0 || free.length > 0) continue;

      const expressionSource = source.slice(
        expression.getStart(sourceFile),
        expression.end,
      );
      const ast = canonicalAst(expression, sourceFile);
      const token = createHash('sha256')
        .update(`snapback:inline-handler-marker:v1\n${name}\n${ast}`)
        .digest('hex');
      const start = sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile));
      handlers.set(name, {
        name,
        token,
        expressionSource,
        ast,
        sourceSpan: {
          file: path,
          line: start.line + 1,
          column: start.character + 1,
        },
      });
      replacements.push({
        start: expression.getStart(sourceFile),
        end: expression.end,
        value: `({__snapbackInlineHandlerMarker:${JSON.stringify(token)}})`,
      });
    }
  }

  let transformedSource = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    transformedSource = transformedSource.slice(0, replacement.start)
      + replacement.value
      + transformedSource.slice(replacement.end);
  }
  return { transformedSource, handlers, diagnostics };
}

export function renderInlineHandlerModule(name, expressionSource) {
  // Ibex's closed module ABI resolves handlers from this one registry. Each
  // generated runtime module owns exactly one operation.
  return `globalThis.__snapbackHandlers = { ${JSON.stringify(name)}: (${expressionSource}) };\n`;
}
