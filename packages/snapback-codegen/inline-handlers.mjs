import ts from 'typescript';
import { createHash } from 'node:crypto';
import {
  HANDLER_ADMISSION_VERSION,
  HANDLER_GRAPH_EXTRACTOR_VERSION,
  HANDLER_GRAPH_RECORD_VERSION,
  handlerDiagnosticDetails,
  INLINE_HANDLER_RULES,
} from './handler-runtime-profile.mjs';

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

const INLINE_BUILDERS = new Set(INLINE_HANDLER_RULES.builders);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// The extracted property per builder: upload intents spell their handler
// `authorize` (LLP 0044 §Generated upload intents); every other builder
// spells it `handler`. Same marker pipeline either way.
const inlineHandlerPropertyFor = (builderName) => (
  builderName === 'defineAssetUpload' ? 'authorize' : 'handler'
);

// Outbound action egress is the same opt-in DX relaxation the module-form
// scanner applies (`egressAllowedAtCodegen` in index.mjs): with
// SNAPBACK_OUTBOUND_ACTIONS set at generation, `fetch` is an admitted global
// here exactly as it is in `scanUnsupportedHandlerSource`, and the runtime —
// not codegen — remains the security boundary that still denies fetch by
// handler kind (LLP 0027 / LLP 0009). Without the opt-in the inline form
// refuses `fetch` at extraction, mirroring BUNDLE_UNSUPPORTED_FETCH.
// @ref LLP 0108#admission-rules — dated 2026-08-01 note: the egress seam
// applies to inline extraction, not only the final bundled-bytes rescan.
function inlineEgressAllowedAtCodegen() {
  return /^(1|true)$/i.test(process.env.SNAPBACK_OUTBOUND_ACTIONS || '');
}

const ALLOWED_GLOBALS = new Set(INLINE_HANDLER_RULES.globals);

const sourceSpanForNode = (path, node, sourceFile) => {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: path,
    line: start.line + 1,
    column: start.character + 1,
  };
};

const diagnostic = (code, message, path, node, sourceFile, details = {}) => {
  const sourceSpan = sourceSpanForNode(path, node, sourceFile);
  return {
    code,
    severity: 'error',
    subsystem: 'function',
    message,
    path,
    line: sourceSpan.line,
    column: sourceSpan.column,
    sourceSpan,
    ...handlerDiagnosticDetails(code),
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

const REFLECTION_PROPERTY_NAMES = new Set(INLINE_HANDLER_RULES.reflectionPropertyNames);

const OBJECT_REFLECTION_METHODS = new Set(INLINE_HANDLER_RULES.objectReflectionMethods);

// The query builder the handler runtime actually implements
// (packages/snapback-harness/ctx-bootstrap.js). A verb outside this set is a
// generation-time refusal with a named site rather than a runtime
// "undefined is not a function" (0137 A2-f5).
const QUERY_BUILDER_VERBS = new Set(INLINE_HANDLER_RULES.queryBuilderVerbs);

// @ref LLP 0004#ctxdb-contract — keep generation-time member admission in
// lockstep with the handler runtime's finite ctx.db object. This catches a
// familiar-API typo such as Convex's `update` before it becomes an opaque
// runtime "undefined is not a function" failure.
const CTX_DB_MEMBERS = new Set(INLINE_HANDLER_RULES.ctxDbMembers);
// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated
// — make the call-site authority visible while rejecting nested write aliases.
const ELEVATED_DB_MEMBERS = new Set(INLINE_HANDLER_RULES.elevatedDbMembers);

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

function elevatedDbMember(node, checker, boundary) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return null;
  }
  const receiver = node.expression;
  const rootedAtElevatedCtxDb = ts.isPropertyAccessExpression(receiver)
    && receiver.name.text === 'elevated'
    && ts.isPropertyAccessExpression(receiver.expression)
    && receiver.expression.name.text === 'db'
    && ts.isIdentifier(receiver.expression.expression)
    && receiver.expression.expression.text === 'ctx';
  if (!rootedAtElevatedCtxDb) return null;
  const member = staticMemberName(node, checker, boundary);
  return member !== null && ELEVATED_DB_MEMBERS.has(member) ? member : null;
}

function elevatedDbUsesIn(node, checker, boundary, sourceFile, path, capture) {
  const uses = [];
  const visit = (current) => {
    const member = elevatedDbMember(current, checker, boundary);
    if (member) {
      const call = current.parent;
      uses.push({
        member,
        table: ts.isCallExpression(call) && call.expression === current
          ? staticString(call.arguments[0], checker, boundary)
          : null,
        source: sourceSpanForNode(path, current, sourceFile),
        capture,
      });
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return uses.sort((left, right) => (
    left.source.line - right.source.line
    || left.source.column - right.source.column
    || compareText(left.member, right.member)
    || compareText(left.table ?? '', right.table ?? '')
  ));
}

// Walk back from a call's callee to the chain root; a chain rooted at
// `ctx.db.query(...)` may use only QUERY_BUILDER_VERBS.
function queryChainProblem(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const verb = node.expression.name.text;
  if (QUERY_BUILDER_VERBS.has(verb)) return null;
  let current = node.expression.expression;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const link = current.expression.name.text;
    if (link === 'query') {
      const receiver = current.expression.expression;
      const rootedAtCtxDb = ts.isPropertyAccessExpression(receiver)
        && receiver.name.text === 'db'
        && ts.isIdentifier(receiver.expression)
        && receiver.expression.text === 'ctx';
      const rootedAtElevatedCtxDb = ts.isPropertyAccessExpression(receiver)
        && receiver.name.text === 'elevated'
        && ts.isPropertyAccessExpression(receiver.expression)
        && receiver.expression.name.text === 'db'
        && ts.isIdentifier(receiver.expression.expression)
        && receiver.expression.expression.text === 'ctx';
      if (rootedAtCtxDb || rootedAtElevatedCtxDb) {
        return `${verb} is not a query-builder verb in inline_handler_v1 `
          + `(use eq, in, lt, lte, gt, gte, order, take, collect, or first)`;
      }
      return null;
    }
    if (!QUERY_BUILDER_VERBS.has(link)) return null;
    current = current.expression.expression;
  }
  return null;
}

function ctxDbMemberProblem(node, checker, boundary) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return null;
  }
  const receiver = node.expression;
  const rootedAtCtxDb = ts.isPropertyAccessExpression(receiver)
    && receiver.name.text === 'db'
    && ts.isIdentifier(receiver.expression)
    && receiver.expression.text === 'ctx';
  const rootedAtElevatedCtxDb = ts.isPropertyAccessExpression(receiver)
    && receiver.name.text === 'elevated'
    && ts.isPropertyAccessExpression(receiver.expression)
    && receiver.expression.name.text === 'db'
    && ts.isIdentifier(receiver.expression.expression)
    && receiver.expression.expression.text === 'ctx';
  if (!rootedAtCtxDb && !rootedAtElevatedCtxDb) return null;
  const member = staticMemberName(node, checker, boundary);
  const allowed = rootedAtElevatedCtxDb ? ELEVATED_DB_MEMBERS : CTX_DB_MEMBERS;
  if (member === null || allowed.has(member)) return null;
  if (rootedAtElevatedCtxDb) {
    return `${member} is not a ctx.db.elevated member in inline_handler_v1 `
      + '(use query, get, getMany, or uniqueMany; elevated writes are never available)';
  }
  return `${member} is not a ctx.db member in inline_handler_v1 `
    + '(use query, get, getMany, uniqueMany, elevated, insert, patch, or delete; use patch for partial updates)';
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
  const selfHelperRefs = new Map();
  const inadmissibleRefs = [];
  const inadmissibleSeen = new Set();
  const forbidden = [];
  const elevatedDbUses = [];
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
      const dbMemberReason = ctxDbMemberProblem(node, checker, expression);
      if (dbMemberReason) {
        forbidden.push({ node, reason: dbMemberReason });
      }
      const elevatedMember = elevatedDbMember(node, checker, expression);
      if (elevatedMember) {
        const call = node.parent;
        elevatedDbUses.push({
          member: elevatedMember,
          table: ts.isCallExpression(call) && call.expression === node
            ? staticString(call.arguments[0], checker, expression)
            : null,
          source: sourceSpanForNode(sourceFile.fileName, node, sourceFile),
        });
      }
    }
    const chainReason = queryChainProblem(node);
    if (chainReason) {
      forbidden.push({ node, reason: chainReason });
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
          if (!helperRefs.has(classification.name)) {
            helperRefs.set(classification.name, {
              declaration: classification.declaration,
              reference: node,
            });
          }
        } else if (classification?.kind === 'inadmissible') {
          if (!inadmissibleSeen.has(node.text)) {
            inadmissibleSeen.add(node.text);
            inadmissibleRefs.push({ node, name: node.text, reason: classification.reason });
          }
        } else if (
          !ALLOWED_GLOBALS.has(node.text)
          && !(node.text === 'fetch' && inlineEgressAllowedAtCodegen())
        ) {
          referenced.add(node.text);
          if (classification?.kind === 'top-level-binding') {
            freeTopLevel.set(node.text, classification.declarationKind);
          }
        }
      } else {
        // A top-level function's reference to its own declaration is local
        // for admission (self-recursion remains valid) but is still a real
        // topology edge in the graph record.
        const classification = topLevelClassification(symbol, sourceFile);
        if (
          classification?.kind === 'helper'
          && classification.declaration === expression
          && !selfHelperRefs.has(classification.name)
        ) {
          selfHelperRefs.set(classification.name, node);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(expression);
  const free = [...referenced].sort();
  return {
    forbidden,
    free,
    freeTopLevel,
    helperRefs,
    selfHelperRefs,
    inadmissibleRefs,
    elevatedDbUses,
  };
}

// @ref LLP 0173#3-operation-facts — module handlers remain opaque, but the
// direct static `ctx.db.elevated` syntax inside the selected export is still a
// useful per-handler review fact. This scan does not claim data-flow coverage.
export function captureElevatedDbUseSites(source, {
  path = 'handler.mjs',
  exportName,
} = {}) {
  const scriptKind = /\.(?:ts|mts|tsx|cts)$/iu.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) return [];
  const compilerOptions = { allowJs: true, checkJs: true, noLib: true, target: ts.ScriptTarget.ES2022 };
  const compilerHost = ts.createCompilerHost(compilerOptions);
  compilerHost.fileExists = (fileName) => fileName === path;
  compilerHost.readFile = (fileName) => (fileName === path ? source : undefined);
  compilerHost.getSourceFile = (fileName) => (fileName === path ? sourceFile : undefined);
  const checker = ts.createProgram([path], compilerOptions, compilerHost).getTypeChecker();
  const localTargets = new Map();
  const aliases = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localTargets.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          localTargets.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier
      || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const specifier of statement.exportClause.elements) {
      aliases.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
    }
  }
  const localName = aliases.get(exportName) ?? exportName;
  const targets = [];
  if (localTargets.has(localName)) targets.push(localTargets.get(localName));
  const findRegistryHandler = (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === '__snapbackHandlers'
      && ts.isIdentifier(node.left.expression)
      && node.left.expression.text === 'globalThis'
      && ts.isObjectLiteralExpression(node.right)
    ) {
      for (const member of node.right.properties) {
        if (authoredPropertyName(member) !== exportName) continue;
        if (ts.isMethodDeclaration(member)) targets.push(member);
        else if (ts.isPropertyAssignment(member)) targets.push(member.initializer);
        else if (ts.isShorthandPropertyAssignment(member) && localTargets.has(member.name.text)) {
          targets.push(localTargets.get(member.name.text));
        }
      }
    }
    ts.forEachChild(node, findRegistryHandler);
  };
  findRegistryHandler(sourceFile);
  return [...new Set(targets)].flatMap((target) => (
    elevatedDbUsesIn(target, checker, target, sourceFile, path, 'module-export')
  ));
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

function graphDigest(domain, value) {
  return `sha256:${createHash('sha256')
    .update(`${domain}\n${value}`)
    .digest('hex')}`;
}

function normalizedRootRelativeTarget(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '');
  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.');
  if (normalized.startsWith('/') || parts.includes('..')) {
    throw new Error(`same-file handler graph target must be root-relative: ${path}`);
  }
  return parts.join('/');
}

// @ref LLP 0237#d2-closed-graph-and-frozen-bounds — the Rollout-2 carrier
// models the already-admitted same-file closure as explicit nodes and edges;
// every target resolves to the one normalized authored file (`self`).
// @ref LLP 0237#d4-runtime-and-implementation-identity — canonical executable
// AST and raw source evidence use distinct named digests. This record remains
// outside the legacy implementationHash preimage during the parity rollout.
function buildSameFileGraphRecord({
  name,
  path,
  expressionSource,
  ast,
  sourceSpan,
  directHelperRefs,
  helpers,
  helperAnalyses,
}) {
  const target = normalizedRootRelativeTarget(path);
  const rootNodeId = `handler:${name}`;
  const nodes = [
    {
      nodeId: rootNodeId,
      kind: 'handler',
      name,
      normalizedTarget: target,
      moduleFormat: 'esm',
      canonicalExecutableAstDigest: graphDigest(
        'snapback:handler-graph-canonical-ast:v1',
        ast,
      ),
      rawSourceEvidenceDigest: graphDigest(
        'snapback:handler-graph-raw-source-evidence:v1',
        expressionSource,
      ),
      sourceSpan,
    },
    ...helpers.map((helper) => ({
      nodeId: `helper:${helper.name}`,
      kind: 'helper',
      name: helper.name,
      normalizedTarget: target,
      moduleFormat: 'esm',
      canonicalExecutableAstDigest: graphDigest(
        'snapback:handler-graph-canonical-ast:v1',
        helper.ast,
      ),
      rawSourceEvidenceDigest: graphDigest(
        'snapback:handler-graph-raw-source-evidence:v1',
        helper.rawSourceEvidence,
      ),
      sourceSpan: helper.sourceSpan,
    })),
  ];
  const edges = [];
  for (const [helperName, { reference }] of directHelperRefs) {
    edges.push({
      importerNodeId: rootNodeId,
      importerSpan: sourceSpanForNode(path, reference, reference.getSourceFile()),
      targetNodeId: `helper:${helperName}`,
      normalizedTarget: target,
      resolution: 'self',
    });
  }
  for (const helper of helpers) {
    const analysis = helperAnalyses.get(helper.name);
    for (const referencedName of analysis.refs) {
      edges.push({
        importerNodeId: `helper:${helper.name}`,
        importerSpan: analysis.referenceSpans.get(referencedName),
        targetNodeId: `helper:${referencedName}`,
        normalizedTarget: target,
        resolution: 'self',
      });
    }
    if (analysis.selfReferenceSpan) {
      edges.push({
        importerNodeId: `helper:${helper.name}`,
        importerSpan: analysis.selfReferenceSpan,
        targetNodeId: `helper:${helper.name}`,
        normalizedTarget: target,
        resolution: 'self',
      });
    }
  }
  edges.sort((left, right) => (
    compareText(left.importerNodeId, right.importerNodeId)
    || compareText(left.targetNodeId, right.targetNodeId)
  ));
  const topology = {
    nodes: nodes.map(({ nodeId, kind, normalizedTarget: nodeTarget }) => ({
      nodeId,
      kind,
      normalizedTarget: nodeTarget,
    })),
    edges: edges.map(({
      importerNodeId,
      targetNodeId,
      normalizedTarget: edgeTarget,
      resolution,
    }) => ({
      importerNodeId,
      targetNodeId,
      normalizedTarget: edgeTarget,
      resolution,
    })),
  };
  return {
    schemaVersion: HANDLER_GRAPH_RECORD_VERSION,
    extractorVersion: HANDLER_GRAPH_EXTRACTOR_VERSION,
    admissionVersion: HANDLER_ADMISSION_VERSION,
    moduleFormat: 'esm',
    root: {
      nodeId: rootNodeId,
      name,
      normalizedTarget: target,
      importerSpan: sourceSpan,
    },
    nodes,
    edges,
    graphTopologyDigest: graphDigest(
      'snapback:handler-graph-topology:v1',
      JSON.stringify(topology),
    ),
  };
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

const PLAIN_JOIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function unwrapParentheses(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function directMethodCall(node, method, argumentCount) {
  const current = unwrapParentheses(node);
  if (
    !ts.isCallExpression(current)
    || !ts.isPropertyAccessExpression(current.expression)
    || current.expression.questionDotToken
    || current.expression.name.text !== method
    || current.arguments.length !== argumentCount
  ) return null;
  return {
    receiver: unwrapParentheses(current.expression.expression),
    arguments: [...current.arguments],
  };
}

function directStringLiteral(node) {
  const current = unwrapParentheses(node);
  return ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)
    ? current.text
    : null;
}

function directJsonScalar(node) {
  const current = unwrapParentheses(node);
  if (current.kind === ts.SyntaxKind.NullKeyword) return { matched: true, value: null };
  if (current.kind === ts.SyntaxKind.TrueKeyword) return { matched: true, value: true };
  if (current.kind === ts.SyntaxKind.FalseKeyword) return { matched: true, value: false };
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return { matched: true, value: current.text };
  }
  if (ts.isNumericLiteral(current)) {
    const value = Number(current.text.replaceAll('_', ''));
    if (Number.isFinite(value)) return { matched: true, value };
  }
  return { matched: false, value: null };
}

function directIdentifier(node, expected = null) {
  const current = unwrapParentheses(node);
  if (!ts.isIdentifier(current)) return null;
  return expected === null || current.text === expected ? current.text : null;
}

function directMember(node, receiver) {
  const current = unwrapParentheses(node);
  if (
    !ts.isPropertyAccessExpression(current)
    || current.questionDotToken
    || !ts.isIdentifier(current.expression)
    || current.expression.text !== receiver
  ) return null;
  return current.name.text;
}

function directCtxQuery(node, ctxName) {
  const query = directMethodCall(node, 'query', 1);
  if (!query) return null;
  const db = query.receiver;
  if (
    !ts.isPropertyAccessExpression(db)
    || db.questionDotToken
    || db.name.text !== 'db'
    || !ts.isIdentifier(db.expression)
    || db.expression.text !== ctxName
  ) return null;
  const table = directStringLiteral(query.arguments[0]);
  return table === null ? null : table;
}

function plainJoinRootRead(initializer, ctxName) {
  const awaited = unwrapParentheses(initializer);
  if (!ts.isAwaitExpression(awaited)) return null;
  const collect = directMethodCall(awaited.expression, 'collect', 0);
  const take = collect && directMethodCall(collect.receiver, 'take', 1);
  const withIndex = take && directMethodCall(take.receiver, 'withIndex', 1);
  if (!collect || !take || !withIndex) return null;
  const table = directCtxQuery(withIndex.receiver, ctxName);
  const index = directStringLiteral(withIndex.arguments[0]);
  const takeNode = unwrapParentheses(take.arguments[0]);
  if (table === null || index === null || !ts.isNumericLiteral(takeNode)) return null;
  const takeValue = Number(takeNode.text.replaceAll('_', ''));
  if (!Number.isSafeInteger(takeValue) || takeValue < 0 || takeValue > 1_024) return null;
  return { table, index, take: takeValue };
}

function plainJoinJoinedRead(initializer, ctxName, rootName) {
  const awaited = unwrapParentheses(initializer);
  if (!ts.isAwaitExpression(awaited)) return null;
  const first = directMethodCall(awaited.expression, 'first', 0);
  if (!first) return null;
  let cursor = first.receiver;
  const reversedJoin = [];
  let withIndex = null;
  for (;;) {
    withIndex = directMethodCall(cursor, 'withIndex', 1);
    if (withIndex) break;
    const equality = directMethodCall(cursor, 'eq', 2);
    if (!equality) return null;
    const joinedField = directStringLiteral(equality.arguments[0]);
    const rootField = directMember(equality.arguments[1], rootName);
    if (joinedField === null || rootField === null) return null;
    reversedJoin.push({ rootField, joinedField });
    cursor = equality.receiver;
  }
  if (reversedJoin.length < 1 || reversedJoin.length > 4) return null;
  const table = directCtxQuery(withIndex.receiver, ctxName);
  const index = directStringLiteral(withIndex.arguments[0]);
  if (table === null || index === null) return null;
  return { table, index, joinOn: reversedJoin.reverse() };
}

function plainJoinProjection(node, rootName, joinedName) {
  const object = unwrapParentheses(node);
  if (!ts.isObjectLiteralExpression(object) || object.properties.length === 0) return null;
  const projection = [];
  const names = new Set();
  let joinedLeaves = 0;
  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property)
      || ts.isComputedPropertyName(property.name)
    ) return null;
    const name = propertyName(property.name);
    if (name === null || !PLAIN_JOIN_IDENT.test(name) || names.has(name)) return null;
    names.add(name);
    const rootField = directMember(property.initializer, rootName);
    if (rootField !== null) {
      projection.push({ name, source: { kind: 'root', field: rootField } });
      continue;
    }
    const value = unwrapParentheses(property.initializer);
    if (
      ts.isBinaryExpression(value)
      && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      && unwrapParentheses(value.right).kind === ts.SyntaxKind.NullKeyword
    ) {
      const left = unwrapParentheses(value.left);
      if (
        ts.isPropertyAccessExpression(left)
        && left.questionDotToken
        && ts.isIdentifier(left.expression)
        && left.expression.text === joinedName
      ) {
        projection.push({ name, source: { kind: 'joined', field: left.name.text } });
        joinedLeaves += 1;
        continue;
      }
    }
    const literal = directJsonScalar(value);
    if (!literal.matched) return null;
    projection.push({ name, source: { kind: 'literal', value: literal.value } });
  }
  return joinedLeaves > 0 ? projection : null;
}

function plainJoinCandidate(expression) {
  if (
    !expression.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    || expression.parameters.length !== 1
    || !ts.isIdentifier(expression.parameters[0].name)
    || expression.parameters[0].dotDotDotToken
    || expression.parameters[0].initializer
    || !ts.isBlock(expression.body)
    || expression.body.statements.length !== 4
  ) return null;
  const ctxName = expression.parameters[0].name.text;
  const [rootStatement, outputStatement, loop, returned] = expression.body.statements;
  if (
    !ts.isVariableStatement(rootStatement)
    || (rootStatement.declarationList.flags & ts.NodeFlags.Const) === 0
    || rootStatement.declarationList.declarations.length !== 1
  ) return null;
  const rootDeclaration = rootStatement.declarationList.declarations[0];
  if (!ts.isIdentifier(rootDeclaration.name) || !rootDeclaration.initializer) return null;
  const rootRead = plainJoinRootRead(rootDeclaration.initializer, ctxName);
  if (!rootRead) return null;
  const rootsName = rootDeclaration.name.text;

  if (
    !ts.isVariableStatement(outputStatement)
    || (outputStatement.declarationList.flags & ts.NodeFlags.Const) === 0
    || outputStatement.declarationList.declarations.length !== 1
  ) return null;
  const outputDeclaration = outputStatement.declarationList.declarations[0];
  if (
    !ts.isIdentifier(outputDeclaration.name)
    || !outputDeclaration.initializer
    || !ts.isArrayLiteralExpression(unwrapParentheses(outputDeclaration.initializer))
    || unwrapParentheses(outputDeclaration.initializer).elements.length !== 0
  ) return null;
  const outputName = outputDeclaration.name.text;

  if (
    !ts.isForOfStatement(loop)
    || loop.awaitModifier
    || !ts.isVariableDeclarationList(loop.initializer)
    || (loop.initializer.flags & ts.NodeFlags.Const) === 0
    || loop.initializer.declarations.length !== 1
    || directIdentifier(loop.expression, rootsName) === null
    || !ts.isBlock(loop.statement)
    || loop.statement.statements.length !== 2
  ) return null;
  const loopDeclaration = loop.initializer.declarations[0];
  if (!ts.isIdentifier(loopDeclaration.name) || loopDeclaration.initializer) return null;
  const rootName = loopDeclaration.name.text;
  const [joinedStatement, pushStatement] = loop.statement.statements;
  if (
    !ts.isVariableStatement(joinedStatement)
    || (joinedStatement.declarationList.flags & ts.NodeFlags.Const) === 0
    || joinedStatement.declarationList.declarations.length !== 1
  ) return null;
  const joinedDeclaration = joinedStatement.declarationList.declarations[0];
  if (!ts.isIdentifier(joinedDeclaration.name) || !joinedDeclaration.initializer) return null;
  const joinedName = joinedDeclaration.name.text;
  const joinedRead = plainJoinJoinedRead(
    joinedDeclaration.initializer,
    ctxName,
    rootName,
  );
  if (!joinedRead) return null;

  if (!ts.isExpressionStatement(pushStatement)) return null;
  const push = directMethodCall(pushStatement.expression, 'push', 1);
  if (!push || directIdentifier(push.receiver, outputName) === null) return null;
  const projection = plainJoinProjection(push.arguments[0], rootName, joinedName);
  if (!projection) return null;
  if (
    !ts.isReturnStatement(returned)
    || !returned.expression
    || directIdentifier(returned.expression, outputName) === null
  ) return null;
  return {
    root: rootRead.table,
    rootIndex: rootRead.index,
    take: rootRead.take,
    joined: joinedRead.table,
    joinedIndex: joinedRead.index,
    joinOn: joinedRead.joinOn,
    joinKind: 'Left',
    projection,
  };
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
      ...handlerDiagnosticDetails('SNAPBACK_INLINE_HANDLER_SOURCE_INVALID'),
    };
  });
  const handlers = new Map();
  const replacements = [];
  const stringExportAliases = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)
      || statement.moduleSpecifier
      || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)) continue;
    for (const specifier of statement.exportClause.elements) {
      const local = specifier.propertyName?.text ?? specifier.name.text;
      const exported = specifier.name.text;
      const aliases = stringExportAliases.get(local) ?? [];
      aliases.push(exported);
      stringExportAliases.set(local, aliases);
    }
  }

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
      rawSourceEvidence: source.slice(declaration.getFullStart(), declaration.end),
      ast,
      contentHash: helperContentHash(ast),
      sourceSpan: {
        file: path,
        line: startPosition.line + 1,
        column: startPosition.character + 1,
      },
      refs: [],
      referenceSpans: new Map(),
      selfReferenceSpan: null,
    };
    helperAnalyses.set(name, analysis);
    helperStack.push(name);
    const {
      forbidden,
      free,
      freeTopLevel,
      helperRefs,
      selfHelperRefs,
      inadmissibleRefs,
      elevatedDbUses,
    } = selfContainedProblems(declaration, checker, sourceFile);
    analysis.elevatedDbUses = elevatedDbUses.map((use) => ({
      ...use,
      capture: `helper:${name}`,
    }));
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
    for (const [referencedName, { declaration: referencedDeclaration, reference }] of helperRefs) {
      analysis.refs.push(referencedName);
      analysis.referenceSpans.set(
        referencedName,
        sourceSpanForNode(path, reference, sourceFile),
      );
      if (helperStack.includes(referencedName)) {
        const cyclePath = [
          ...helperStack.slice(helperStack.indexOf(referencedName)),
          referencedName,
        ];
        const cycleKey = [...new Set(cyclePath)].sort().join('\0');
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
    const selfReference = selfHelperRefs.get(name);
    if (selfReference) {
      analysis.selfReferenceSpan = sourceSpanForNode(path, selfReference, sourceFile);
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
      const {
        name,
        source: helperSource,
        rawSourceEvidence,
        ast,
        contentHash,
        sourceSpan,
        elevatedDbUses,
      } = helperAnalyses.get(helperName);
      return {
        name,
        source: helperSource,
        rawSourceEvidence,
        ast,
        contentHash,
        sourceSpan,
        elevatedDbUses,
      };
    });
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const localName = declaration.name.text;
      const aliases = stringExportAliases.get(localName) ?? [];
      if (!exported && aliases.length === 0) continue;
      if (!exported && aliases.length !== 1) {
        diagnostics.push(diagnostic(
          'SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED',
          `${localName} inline handler must have exactly one exported operation name`,
          path,
          declaration.name,
          sourceFile,
          { function: localName, exports: aliases },
        ));
        continue;
      }
      // @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1
      // — ES2022 string export aliases, not their safe authored locals, own
      // inline handler identity and diagnostics.
      const name = exported ? localName : aliases[0];
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
        elevatedDbUses,
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
      for (const [helperName, { declaration: helperDeclaration }] of helperRefs) {
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
      const sourceSpan = {
        file: path,
        line: start.line + 1,
        column: start.character + 1,
      };
      const graphRecord = buildSameFileGraphRecord({
        name,
        path,
        expressionSource,
        ast,
        sourceSpan,
        directHelperRefs: helperRefs,
        helpers,
        helperAnalyses,
      });
      handlers.set(name, {
        name,
        token,
        expressionSource,
        ast,
        helpers,
        graphRecord,
        elevatedDbUses: [
          ...elevatedDbUses.map((use) => ({ ...use, capture: 'handler' })),
          ...helpers.flatMap((helper) => helper.elevatedDbUses ?? []),
        ].sort((left, right) => (
          left.source.line - right.source.line
          || left.source.column - right.source.column
          || compareText(left.capture, right.capture)
        )),
        ...(call.expression.text === 'defineJsLiveQuery'
          ? { plainJoinCandidate: plainJoinCandidate(expression) }
          : {}),
        sourceSpan,
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

// A familiar top-level module export receives its canonical `module.export`
// name only after discovery. Rename the already-extracted graph root without
// changing authored AST/helper custody, and recompute the topology digest so
// no local binding name survives as a nominal operation identity.
// @ref LLP 0253#s2-familiar-source-layout-and-discovery — module namespace
// lowering happens after per-file inline extraction but before decoration.
export function renameExtractedInlineHandler(extracted, name) {
  const priorRoot = extracted.graphRecord?.root?.nodeId;
  const nextRoot = `handler:${name}`;
  const nodes = (extracted.graphRecord?.nodes ?? []).map((node) => (
    node.nodeId === priorRoot ? { ...node, nodeId: nextRoot, name } : { ...node }
  ));
  const edges = (extracted.graphRecord?.edges ?? []).map((edge) => ({
    ...edge,
    importerNodeId: edge.importerNodeId === priorRoot ? nextRoot : edge.importerNodeId,
    targetNodeId: edge.targetNodeId === priorRoot ? nextRoot : edge.targetNodeId,
  }));
  const topology = {
    nodes: nodes.map(({ nodeId, kind, normalizedTarget }) => ({
      nodeId, kind, normalizedTarget,
    })),
    edges: edges.map(({ importerNodeId, targetNodeId, normalizedTarget, resolution }) => ({
      importerNodeId, targetNodeId, normalizedTarget, resolution,
    })),
  };
  return {
    ...extracted,
    name,
    graphRecord: {
      ...extracted.graphRecord,
      root: { ...extracted.graphRecord.root, nodeId: nextRoot, name },
      nodes,
      edges,
      graphTopologyDigest: graphDigest(
        'snapback:handler-graph-topology:v1',
        JSON.stringify(topology),
      ),
    },
  };
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

// Render the same bytes through the explicit graph carrier. Reachability is
// derived from graph edges rather than from the legacy flat helper array;
// node source is still held by the extractor and never copied into the public
// graph record. Rollout 2 keeps the legacy renderer exported as the byte
// oracle used by the parity corpus.
// @ref LLP 0237#d2-closed-graph-and-frozen-bounds — representation parity
// precedes any relative-import admission.
export function renderInlineOperationGraphModule(name, extracted) {
  const record = extracted.graphRecord;
  if (
    record?.schemaVersion !== HANDLER_GRAPH_RECORD_VERSION
    || record.root?.name !== name
  ) {
    throw new Error(`invalid same-file handler graph record for ${name}`);
  }
  const nodesById = new Map(record.nodes.map((node) => [node.nodeId, node]));
  const edgesByImporter = new Map();
  for (const edge of record.edges) {
    if (!nodesById.has(edge.importerNodeId) || !nodesById.has(edge.targetNodeId)) {
      throw new Error(`handler graph ${name} contains an edge with an unknown node`);
    }
    const outgoing = edgesByImporter.get(edge.importerNodeId) ?? [];
    outgoing.push(edge.targetNodeId);
    edgesByImporter.set(edge.importerNodeId, outgoing);
  }
  const reachable = new Set();
  const queue = [record.root.nodeId];
  while (queue.length > 0) {
    const nodeId = queue.pop();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const targetNodeId of edgesByImporter.get(nodeId) ?? []) {
      if (!reachable.has(targetNodeId)) queue.push(targetNodeId);
    }
  }
  const helperSourceByName = new Map(
    (extracted.helpers ?? []).map((helper) => [helper.name, helper]),
  );
  const helperNodes = record.nodes
    .filter((node) => node.kind === 'helper' && reachable.has(node.nodeId))
    .sort((left, right) => compareText(left.name, right.name));
  const graphExtracted = {
    ...extracted,
    helpers: helperNodes.map((node) => {
      const helper = helperSourceByName.get(node.name);
      if (!helper) {
        throw new Error(`handler graph ${name} has no extracted source for ${node.nodeId}`);
      }
      return helper;
    }),
  };
  return renderInlineOperationModule(name, graphExtracted);
}
