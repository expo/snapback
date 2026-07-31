import ts from 'typescript';
import { createHash } from 'node:crypto';

// @ref LLP 0108#final-author-reconciliation-after-round-3 — inline v1 is one
// self-contained function expression. This extractor never obtains executable
// authority from Function.prototype.toString() and never follows a source graph.
//
// @ref LLP 0118#1a-same-file-lexical-helper-closure-a-staged-slice-of-option-1 —
// the one admitted widening (LLP 0115 CV-7, 0127 decision 6): a handler may
// reference statically reachable top-level sibling *function declarations* in
// the same authored file. Each operation's runtime module splices in exactly
// its own reachable-helper subset, so the executable graph stays closed,
// content-addressed, and defined by this file's bytes alone — no resolver, no
// filesystem path enters identity, and context-reader helpers are admitted
// with declared reads/writes remaining evidence (basis: 'declared'), never an
// enforced ceiling.

const INLINE_BUILDERS = new Set([
  'defineJsQuery',
  'defineJsLiveQuery',
  'defineJsMutation',
  'defineAction',
  'defineAssetUpload',
]);

// The extracted property per builder: upload intents spell their handler
// `authorize` (LLP 0044 §Generated upload intents); every other builder
// spells it `handler`. Same marker pipeline either way.
const inlineHandlerPropertyFor = (builderName) => (
  builderName === 'defineAssetUpload' ? 'authorize' : 'handler'
);

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

function authoredPropertyName(member) {
  if (!member?.name) return null;
  if (ts.isComputedPropertyName(member.name)) {
    const expression = member.name.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    return null;
  }
  return propertyName(member.name);
}

const REFLECTION_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const OBJECT_REFLECTION_METHODS = new Set([
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getOwnPropertyNames',
  'getOwnPropertySymbols',
  'getPrototypeOf',
  'setPrototypeOf',
]);

function staticString(node, checker = null, boundary = null, seen = new Set()) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isIdentifier(node) && checker) {
    const symbol = checker.getSymbolAtLocation(node);
    const declaration = symbol?.declarations?.find((candidate) => (
      ts.isVariableDeclaration(candidate)
      && ts.isIdentifier(candidate.name)
      && candidate.initializer
      && ts.isVariableDeclarationList(candidate.parent)
      && (candidate.parent.flags & ts.NodeFlags.Const) !== 0
      && (!boundary || (
        candidate.getStart() >= boundary.getStart()
        && candidate.end <= boundary.end
      ))
    ));
    if (!declaration || seen.has(declaration)) return null;
    return staticString(
      declaration.initializer,
      checker,
      boundary,
      new Set([...seen, declaration]),
    );
  }
  if (ts.isParenthesizedExpression(node)) {
    return staticString(node.expression, checker, boundary, seen);
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(node.left, checker, boundary, seen);
    const right = staticString(node.right, checker, boundary, seen);
    return left === null || right === null ? null : left + right;
  }
  if (
    ts.isTemplateExpression(node)
    && node.templateSpans.every(
      (span) => staticString(span.expression, checker, boundary, seen) !== null,
    )
  ) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      value += staticString(span.expression, checker, boundary, seen);
      value += span.literal.text;
    }
    return value;
  }
  return null;
}

function staticMemberName(node, checker, boundary) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    return staticString(node.argumentExpression, checker, boundary);
  }
  return null;
}

function reflectionProblem(node, checker, boundary) {
  const member = staticMemberName(node, checker, boundary);
  if (ts.isElementAccessExpression(node) && member === null) {
    return 'dynamic computed member access is outside inline_handler_v1';
  }
  if (member && REFLECTION_PROPERTY_NAMES.has(member)) {
    return `${member} reflection is outside inline_handler_v1`;
  }
  if (
    member
    && OBJECT_REFLECTION_METHODS.has(member)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'Object'
  ) {
    return `Object.${member} reflection is outside inline_handler_v1`;
  }
  return null;
}

function bindingElementPropertyName(node, checker, boundary) {
  if (!ts.isBindingElement(node)) return null;
  if (node.propertyName) {
    if (ts.isComputedPropertyName(node.propertyName)) {
      return staticString(node.propertyName.expression, checker, boundary);
    }
    return propertyName(node.propertyName);
  }
  return ts.isIdentifier(node.name) ? node.name.text : null;
}

function destructuringAssignmentProblem(node, checker, boundary) {
  if (
    !ts.isBinaryExpression(node)
    || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) return null;
  const unwrap = (value) => {
    let current = value;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
  };
  const inspectPattern = (value) => {
    const pattern = unwrap(value);
    if (ts.isArrayLiteralExpression(pattern)) {
      for (const element of pattern.elements) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) continue;
        const problem = inspectPattern(element);
        if (problem) return problem;
      }
      return null;
    }
    if (!ts.isObjectLiteralExpression(pattern)) return null;
    for (const property of pattern.properties) {
      if (ts.isSpreadAssignment(property)) continue;
      const name = property.name;
      let resolved = propertyName(name);
      if (ts.isComputedPropertyName(name)) {
        resolved = staticString(name.expression, checker, boundary);
        if (resolved === null) {
          return 'dynamic computed destructuring assignment is outside inline_handler_v1';
        }
      }
      if (resolved && REFLECTION_PROPERTY_NAMES.has(resolved)) {
        return `${resolved} destructuring assignment reflection is outside inline_handler_v1`;
      }
      if (ts.isPropertyAssignment(property)) {
        const problem = inspectPattern(property.initializer);
        if (problem) return problem;
      }
    }
    return null;
  };
  return inspectPattern(node.left);
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

// Classify what a non-local identifier's symbol resolves to at module top
// level. Only a single-declaration, bodied top-level function declaration is
// an admissible helper; every other top-level binding is reported precisely
// (a const/let/var/class/import cannot be spliced — under splice emission it
// would be a temporal-dead-zone edge or a laundering channel such as
// `const c = obj.constructor` at top level).
function topLevelClassification(symbol, sourceFile) {
  const declarations = symbol?.declarations ?? [];
  if (declarations.length === 0) return null;
  const functionDeclarations = declarations.filter((candidate) => (
    ts.isFunctionDeclaration(candidate) && candidate.parent === sourceFile
  ));
  if (functionDeclarations.length > 0) {
    const name = ts.isIdentifier(functionDeclarations[0].name ?? undefined)
      ? functionDeclarations[0].name.text
      : null;
    if (declarations.length > 1) {
      return { kind: 'inadmissible', name, reason: 'is declared more than once at module top level' };
    }
    const declaration = functionDeclarations[0];
    if (!declaration.body) {
      return { kind: 'inadmissible', name, reason: 'has no body' };
    }
    if (name === null) {
      return { kind: 'inadmissible', name, reason: 'has no name' };
    }
    return { kind: 'helper', name, declaration };
  }
  for (const declaration of declarations) {
    if (
      ts.isVariableDeclaration(declaration)
      && ts.isVariableDeclarationList(declaration.parent)
      && ts.isVariableStatement(declaration.parent.parent)
      && declaration.parent.parent.parent === sourceFile
    ) {
      const flags = declaration.parent.flags;
      const flavor = (flags & ts.NodeFlags.Const) !== 0
        ? 'const'
        : (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
      return { kind: 'top-level-binding', declarationKind: flavor };
    }
    if (ts.isClassDeclaration(declaration) && declaration.parent === sourceFile) {
      return { kind: 'top-level-binding', declarationKind: 'class' };
    }
    if (
      ts.isImportSpecifier(declaration)
      || ts.isImportClause(declaration)
      || ts.isNamespaceImport(declaration)
      || ts.isImportEqualsDeclaration(declaration)
    ) {
      return { kind: 'top-level-binding', declarationKind: 'import' };
    }
  }
  return null;
}

function selfContainedProblems(expression, checker, sourceFile) {
  const referenced = new Set();
  const freeTopLevel = new Map();
  const helperRefs = new Map();
  const inadmissibleRefs = [];
  const inadmissibleSeen = new Set();
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
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const reason = reflectionProblem(node, checker, expression);
      if (reason) {
        forbidden.push({ node, reason });
      }
    }
    const assignmentReason = destructuringAssignmentProblem(node, checker, expression);
    if (assignmentReason) {
      forbidden.push({ node, reason: assignmentReason });
    }
    const destructured = bindingElementPropertyName(node, checker, expression);
    const dynamicComputedDestructuring = ts.isBindingElement(node)
      && node.propertyName
      && ts.isComputedPropertyName(node.propertyName)
      && destructured === null;
    if (dynamicComputedDestructuring) {
      forbidden.push({
        node,
        reason: 'dynamic computed destructuring is outside inline_handler_v1',
      });
    } else if (destructured && REFLECTION_PROPERTY_NAMES.has(destructured)) {
      forbidden.push({
        node,
        reason: `${destructured} destructuring reflection is outside inline_handler_v1`,
      });
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
      if (!local) {
        // Resolve the symbol before the globals allowlist so a top-level
        // sibling function declaration keeps its authored lexical meaning
        // even when it shadows an admitted global name.
        const classification = topLevelClassification(symbol, sourceFile);
        if (classification?.kind === 'helper') {
          helperRefs.set(classification.name, classification.declaration);
        } else if (classification?.kind === 'inadmissible') {
          if (!inadmissibleSeen.has(node.text)) {
            inadmissibleSeen.add(node.text);
            inadmissibleRefs.push({ node, name: node.text, reason: classification.reason });
          }
        } else if (!ALLOWED_GLOBALS.has(node.text)) {
          referenced.add(node.text);
          if (classification?.kind === 'top-level-binding') {
            freeTopLevel.set(node.text, classification.declarationKind);
          }
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(expression);
  const free = [...referenced].sort();
  return { forbidden, free, freeTopLevel, helperRefs, inadmissibleRefs };
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

// A helper's canonical AST is taken over its emitted form (export/default
// modifiers stripped), so toggling `export` on the authored declaration does
// not change the helper's content identity or the spliced bytes.
function canonicalHelperAst(emittedSource) {
  const mini = ts.createSourceFile(
    'helper.mjs',
    emittedSource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  return canonicalAst(mini.statements[0], mini);
}

function helperContentHash(ast) {
  return `sha256:${createHash('sha256')
    .update(`snapback:inline-helper-content:v1\n${ast}`)
    .digest('hex')}`;
}

function freeIdentifierHints(free, freeTopLevel) {
  const hints = free
    .filter((identifier) => freeTopLevel.has(identifier))
    .map((identifier) => {
      const declarationKind = freeTopLevel.get(identifier);
      if (declarationKind === 'import') {
        return `${identifier} is an imported binding; imports cannot be spliced into a runtime module`;
      }
      return `${identifier} is a top-level ${declarationKind}; only top-level function declarations are `
        + `spliceable helpers — a ${declarationKind} would be a temporal-dead-zone or laundering edge`;
    });
  return hints.length > 0 ? ` (${hints.join('; ')})` : '';
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

  // Same-file helper admission (LLP 0118 option 1a). Helpers are analyzed
  // lazily — only top-level function declarations actually reached from a
  // handler expression are validated under the handler rules, so top-level
  // functions used purely at definition time stay untouched. Analysis is
  // memoized file-wide: a broken helper is reported once, not once per
  // consuming operation.
  const helperAnalyses = new Map();
  const helperStack = [];
  const reportedCycles = new Set();

  const helperEmitSlice = (declaration) => {
    let start = declaration.getStart(sourceFile);
    for (const modifier of declaration.modifiers ?? []) {
      if (
        modifier.kind === ts.SyntaxKind.ExportKeyword
        || modifier.kind === ts.SyntaxKind.DefaultKeyword
      ) {
        start = Math.max(start, modifier.end);
      }
    }
    while (start < declaration.end && /\s/u.test(source[start])) start += 1;
    return start;
  };

  const analyzeHelper = (name, declaration) => {
    if (helperAnalyses.has(name)) return helperAnalyses.get(name);
    const emitStart = helperEmitSlice(declaration);
    const emittedSource = source.slice(emitStart, declaration.end);
    const startPosition = sourceFile.getLineAndCharacterOfPosition(emitStart);
    const ast = canonicalHelperAst(emittedSource);
    const analysis = {
      name,
      source: emittedSource,
      ast,
      contentHash: helperContentHash(ast),
      sourceSpan: {
        file: path,
        line: startPosition.line + 1,
        column: startPosition.character + 1,
      },
      refs: [],
    };
    helperAnalyses.set(name, analysis);
    helperStack.push(name);
    const {
      forbidden,
      free,
      freeTopLevel,
      helperRefs,
      inadmissibleRefs,
    } = selfContainedProblems(declaration, checker, sourceFile);
    // The 2026-07-28 adversarial refusals hold across the helper boundary: a
    // sibling helper body is scanned under exactly the handler-expression
    // rules, so alias/destructuring/computed-access reflection cannot be
    // laundered through a spliced helper.
    for (const problem of forbidden) {
      diagnostics.push(diagnostic(
        'SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN',
        `helper ${name}: ${problem.reason}`,
        path,
        problem.node,
        sourceFile,
        { helper: name },
      ));
    }
    if (free.length > 0) {
      diagnostics.push(diagnostic(
        'SNAPBACK_INLINE_HELPER_FREE_IDENTIFIER',
        `helper ${name} references identifiers outside the admitted helper graph: `
          + `${free.join(', ')}${freeIdentifierHints(free, freeTopLevel)}`,
        path,
        declaration,
        sourceFile,
        { helper: name, identifiers: free },
      ));
    }
    for (const reference of inadmissibleRefs) {
      diagnostics.push(diagnostic(
        'SNAPBACK_INLINE_HELPER_INADMISSIBLE',
        `helper ${name} references ${reference.name}, which ${reference.reason}`,
        path,
        reference.node,
        sourceFile,
        { helper: name, reference: reference.name },
      ));
    }
    for (const [referencedName, referencedDeclaration] of helperRefs) {
      analysis.refs.push(referencedName);
      if (helperStack.includes(referencedName)) {
        const cyclePath = [
          ...helperStack.slice(helperStack.indexOf(referencedName)),
          referencedName,
        ];
        const cycleKey = [...new Set(cyclePath)].sort().join(' ');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          diagnostics.push(diagnostic(
            'SNAPBACK_INLINE_HELPER_CYCLE',
            `helper cycle is outside inline handler admission: ${cyclePath.join(' -> ')}`,
            path,
            referencedDeclaration,
            sourceFile,
            { helpers: [...new Set(cyclePath)].sort() },
          ));
        }
        continue;
      }
      analyzeHelper(referencedName, referencedDeclaration);
    }
    helperStack.pop();
    return analysis;
  };

  const reachableHelpers = (directRefs) => {
    const reachable = new Set();
    const queue = [...directRefs.keys()];
    while (queue.length > 0) {
      const current = queue.pop();
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const reference of helperAnalyses.get(current)?.refs ?? []) {
        if (!reachable.has(reference)) queue.push(reference);
      }
    }
    return [...reachable].sort().map((helperName) => {
      const { name, source: helperSource, ast, contentHash, sourceSpan } = helperAnalyses.get(helperName);
      return { name, source: helperSource, ast, contentHash, sourceSpan };
    });
  };

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
      const handlerProperty = inlineHandlerPropertyFor(call.expression.text);
      const fields = new Map();
      const directHandlerMembers = [];
      const invalidHandlerMembers = [];
      for (const member of spec.properties) {
        const authoredName = authoredPropertyName(member);
        if (authoredName === handlerProperty) {
          if (
            ts.isPropertyAssignment(member)
            && !ts.isComputedPropertyName(member.name)
          ) {
            directHandlerMembers.push(member);
          } else {
            invalidHandlerMembers.push(member);
          }
        }
        if (
          !ts.isPropertyAssignment(member)
          || ts.isComputedPropertyName(member.name)
        ) continue;
        const key = propertyName(member.name);
        if (key) fields.set(key, member);
      }
      if (invalidHandlerMembers.length > 0 || directHandlerMembers.length > 1) {
        const problem = invalidHandlerMembers[0] ?? directHandlerMembers[1];
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED',
          `${name} handler must be one direct, non-computed data property`,
          path,
          problem,
          sourceFile,
          { function: name },
        ));
        continue;
      }
      const handler = fields.get(handlerProperty);
      if (!handler) continue;
      const structurallyAmbiguous = spec.properties.find((member) => (
        ts.isSpreadAssignment(member)
        || (
          'name' in member
          && member.name
          && ts.isComputedPropertyName(member.name)
        )
        || ts.isGetAccessorDeclaration(member)
        || ts.isSetAccessorDeclaration(member)
      ));
      if (structurallyAmbiguous) {
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED',
          `${name} inline declaration cannot contain spreads, computed properties, or accessors`,
          path,
          structurallyAmbiguous,
          sourceFile,
          { function: name },
        ));
        continue;
      }
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
      const {
        forbidden,
        free,
        freeTopLevel,
        helperRefs,
        inadmissibleRefs,
      } = selfContainedProblems(expression, checker, sourceFile);
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
          `${name} references identifiers outside its handler expression: `
            + `${free.join(', ')}${freeIdentifierHints(free, freeTopLevel)}`,
          path,
          expression,
          sourceFile,
          { function: name, identifiers: free },
        ));
      }
      for (const reference of inadmissibleRefs) {
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HELPER_INADMISSIBLE',
          `${name} references ${reference.name}, which ${reference.reason}`,
          path,
          reference.node,
          sourceFile,
          { function: name, reference: reference.name },
        ));
      }
      if (forbidden.length > 0 || free.length > 0 || inadmissibleRefs.length > 0) continue;
      for (const [helperName, helperDeclaration] of helperRefs) {
        analyzeHelper(helperName, helperDeclaration);
      }
      const helpers = reachableHelpers(helperRefs);

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
        helpers,
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

// Splice emission (LLP 0118 option 1a / finding 7): each operation's runtime
// module carries its own reachable-helper subset as hoisted function
// declarations after the registration statement, so per-invocation evaluation
// is bounded by the operation's own closure under the fresh-per-invocation
// lifecycle. Helpers are emitted in sorted-name order for deterministic
// regeneration; an operation with no helpers emits bytes identical to v1.
// The returned segments map rendered lines back to authored source spans so
// capability rescans over the spliced bytes keep precise refusal positions.
export function renderInlineOperationModule(name, extracted) {
  const registration = renderInlineHandlerModule(name, extracted.expressionSource);
  const lineCount = (text) => text.split('\n').length - 1;
  const segments = [{
    kind: 'handler',
    name,
    startLine: 1,
    endLine: lineCount(registration),
    sourceSpan: extracted.sourceSpan,
  }];
  let source = registration;
  let nextLine = lineCount(registration) + 1;
  for (const helper of extracted.helpers ?? []) {
    const text = `${helper.source}\n`;
    const lines = lineCount(text);
    segments.push({
      kind: 'helper',
      name: helper.name,
      startLine: nextLine,
      endLine: nextLine + lines - 1,
      sourceSpan: helper.sourceSpan,
    });
    source += text;
    nextLine += lines;
  }
  return { source, segments };
}
