import ts from "typescript";
import { diagnostic } from "../diagnostics";
import type { EffectJson, FrontendDiagnostic } from "../ir";
import { hasExport, unwrapCall, unwrapExpression, walk } from "../syntax";
import { callLeaf, moduleJsonConstants, objectOf, property, propertyEntries, staticJson, stringArray } from "./static";

// @ref LLP 1003#1-authoring — effects carry validated grants, closed ES2020 source, and an optional typed then mutation.

export type SourceModule = {
  moduleName: string;
  fileName: string;
  source: string;
  sourceFile: ts.SourceFile;
};

export type OperationDecl = {
  name: string;
  moduleName: string;
  exportName: string;
  kind: "query" | "mutation";
  call: ts.CallExpression;
};

export type EffectCatalog = Map<string, { module: SourceModule; exportName: string; call: ts.CallExpression }>;

export function collectEffectCatalog(modules: SourceModule[]): EffectCatalog {
  const catalog: EffectCatalog = new Map();
  for (const module of modules) {
    for (const statement of module.sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const call = unwrapCall(declaration.initializer);
        if (call && callLeaf(call) === "effect") {
          const name = `${module.moduleName}.${declaration.name.text}`;
          catalog.set(name, { module, exportName: declaration.name.text, call });
        }
      }
    }
  }
  return catalog;
}

export function effectBindings(module: SourceModule, catalog: EffectCatalog): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const [name, item] of catalog) {
    if (item.module.moduleName === module.moduleName) bindings.set(item.exportName, name);
  }
  for (const statement of module.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith(".")) continue;
    const targetModule = moduleNameFromSpecifier(statement.moduleSpecifier.text);
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const item of imports.elements) {
      const imported = item.propertyName?.text ?? item.name.text;
      const qualified = `${targetModule}.${imported}`;
      if (catalog.has(qualified)) bindings.set(item.name.text, qualified);
    }
  }
  return bindings;
}

export function lowerEffects(
  catalog: EffectCatalog,
  operations: Map<string, OperationDecl>,
): { effects: EffectJson[]; diagnostics: FrontendDiagnostic[] } {
  const effects: EffectJson[] = [];
  const diagnostics: FrontendDiagnostic[] = [];
  for (const [name, item] of [...catalog].sort(([left], [right]) => left.localeCompare(right))) {
    const lowered = lowerEffect(name, item.module, item.call, operations, diagnostics);
    if (lowered) effects.push(lowered);
  }
  return { effects, diagnostics };
}

function lowerEffect(
  name: string,
  module: SourceModule,
  call: ts.CallExpression,
  operations: Map<string, OperationDecl>,
  diagnostics: FrontendDiagnostic[],
): EffectJson | undefined {
  const config = objectOf(call.arguments[0]);
  const grants = config && stringArray(property(config, "grants"));
  if (!config || !grants || grants.length === 0 || grants.some((grant) => !validGrant(grant))) {
    diagnostics.push(effectDiagnostic(module, "E_EFFECT_GRANT", call, "grants must be a non-empty list of https:// or http://127.0.0.1 origins"));
    return undefined;
  }
  const runNode = property(config, "run");
  const run = runNode && unwrapExpression(runNode);
  if (!run || (!ts.isArrowFunction(run) && !ts.isFunctionExpression(run))) {
    diagnostics.push(effectDiagnostic(module, "E_EFFECT_CLOSURE", config, "effect run must be an arrow or function expression"));
    return undefined;
  }
  const closure = validateClosure(module, run);
  if (closure) diagnostics.push(closure);

  let then: string | null = null;
  const thenNode = property(config, "then");
  if (thenNode) {
    const resolved = resolveOperation(module, thenNode, operations);
    if (!resolved || resolved.kind !== "mutation" || !validThenArgs(resolved.call)) {
      diagnostics.push(effectDiagnostic(
        module,
        "E_EFFECT_THEN_ARGS",
        thenNode,
        "then must name a mutation with outboxId, effect, and result arguments matching run's result",
      ));
    } else {
      then = resolved.name;
    }
  }
  if (closure || (thenNode && then === null)) return undefined;

  const transpiled = ts.transpileModule(`(${run.getText(module.sourceFile)})`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      removeComments: true,
    },
  }).outputText.trim().replace(/;$/, "");
  const constants = [...moduleJsonConstants(module.sourceFile)]
    .map(([constant, value]) => `const ${constant} = ${JSON.stringify(value)};`)
    .join(" ");
  const source = constants ? `(() => { ${constants} return ${transpiled}; })()` : transpiled;
  return { name, grants, source, then };
}

function validateClosure(module: SourceModule, run: ts.ArrowFunction | ts.FunctionExpression): FrontendDiagnostic | undefined {
  let imported: ts.Node | undefined;
  walk(run.body, (node) => {
    if (imported) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") imported = node;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imported = node;
  });
  if (imported) return effectDiagnostic(module, "E_EFFECT_IMPORT", imported, "effect run cannot import or require modules");

  const bindings: Array<{ name: string; owner: ts.Node }> = [];
  for (const parameter of run.parameters) collectScopedBindings(parameter.name, run, bindings);
  walk(run.body, (node) => {
    if (ts.isVariableDeclaration(node)) collectScopedBindings(node.name, bindingOwner(node, run), bindings);
    if (isScopedFunction(node)) {
      for (const parameter of node.parameters) collectScopedBindings(parameter.name, node, bindings);
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
        bindings.push({ name: node.name.text, owner: ts.isFunctionDeclaration(node) ? bindingOwner(node, run) : node });
      }
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) collectScopedBindings(node.variableDeclaration.name, node, bindings);
  });
  const constants = moduleJsonConstants(module.sourceFile);
  const allowed = new Set([
    ...constants.keys(),
    "fetch", "meta", "console", "JSON", "Math", "Date", "URL", "TextEncoder", "TextDecoder",
    "btoa", "atob", "setTimeout", "Promise", "Error", "crypto", "undefined", "NaN", "Infinity",
  ]);
  let escaped: ts.Identifier | undefined;
  walk(run.body, (node) => {
    if (escaped || !ts.isIdentifier(node) || !isReferenceIdentifier(node)) return;
    if (!allowed.has(node.text) && !bindings.some((binding) => binding.name === node.text && isWithin(node, binding.owner))) escaped = node;
  });
  if (!escaped) return undefined;
  const spread = invalidConstantSpread(module.sourceFile, escaped.text, constants);
  return spread
    ? effectDiagnostic(module, "E_EFFECT_CLOSURE", spread, `effect JSON constant spread ${spread.expression.getText(module.sourceFile)} is not statically JSON`)
    : effectDiagnostic(module, "E_EFFECT_CLOSURE", escaped, `effect run closes over non-JSON value ${escaped.text}`);
}

function isScopedFunction(node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

function invalidConstantSpread(
  sourceFile: ts.SourceFile,
  name: string,
  constants: Map<string, unknown>,
): ts.SpreadAssignment | undefined {
  let invalid: ts.SpreadAssignment | undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    const declaration = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === name);
    if (!declaration?.initializer) continue;
    walk(declaration.initializer, (node) => {
      if (invalid || !ts.isSpreadAssignment(node)) return;
      const value = staticJson(node.expression, constants);
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid = node;
    });
  }
  return invalid;
}

function collectScopedBindings(name: ts.BindingName, owner: ts.Node, output: Array<{ name: string; owner: ts.Node }>): void {
  if (ts.isIdentifier(name)) output.push({ name: name.text, owner });
  else for (const item of name.elements) if (ts.isBindingElement(item)) collectScopedBindings(item.name, owner, output);
}

function bindingOwner(node: ts.Node, fallback: ts.Node): ts.Node {
  let current = node.parent;
  while (current && current !== fallback) {
    if (ts.isBlock(current) || isScopedFunction(current) || ts.isCatchClause(current)) return current;
    current = current.parent;
  }
  return fallback;
}

function isWithin(node: ts.Node, owner: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === owner) return true;
    current = current.parent;
  }
  return false;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node && parent.initializer !== node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) || ts.isTypeReferenceNode(parent) || ts.isTypeParameterDeclaration(parent)) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  return !isInsideType(node);
}

function isInsideType(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isExpression(current) || ts.isStatement(current)) return false;
    current = current.parent;
  }
  return false;
}

function resolveOperation(module: SourceModule, node: ts.Expression, operations: Map<string, OperationDecl>): OperationDecl | undefined {
  const value = unwrapExpression(node);
  if (!ts.isIdentifier(value)) return undefined;
  const local = operations.get(`${module.moduleName}.${value.text}`);
  if (local) return local;
  for (const statement of module.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith(".")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const item = bindings.elements.find((entry) => entry.name.text === value.text);
    if (!item) continue;
    const exported = item.propertyName?.text ?? item.name.text;
    return operations.get(`${moduleNameFromSpecifier(statement.moduleSpecifier.text)}.${exported}`);
  }
  return undefined;
}

function validThenArgs(call: ts.CallExpression): boolean {
  const args = objectOf(call.arguments[0]);
  if (!args) return false;
  const entries = propertyEntries(args);
  if (entries.map((item) => item.name).sort().join(",") !== "effect,outboxId,result") return false;
  const descriptors = new Map(entries.map((item) => [item.name, callLeaf(item.value)]));
  return ["id", "text"].includes(descriptors.get("outboxId") ?? "")
    && descriptors.get("effect") === "text"
    && descriptors.has("result");
}

function validGrant(grant: string): boolean {
  try {
    const url = new URL(grant);
    if (url.origin !== grant || url.username || url.password) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function moduleNameFromSpecifier(specifier: string): string {
  const part = specifier.split("/").filter(Boolean).at(-1) ?? specifier;
  return part.replace(/\.[cm]?[jt]s$/, "");
}

function effectDiagnostic(
  module: SourceModule,
  code: "E_EFFECT_CLOSURE" | "E_EFFECT_IMPORT" | "E_EFFECT_GRANT" | "E_EFFECT_THEN_ARGS",
  node: ts.Node,
  message: string,
): FrontendDiagnostic {
  let current: ts.Node | undefined = node;
  while (current && !ts.isVariableDeclaration(current)) current = current.parent;
  const name = current && ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)
    ? current.name.text
    : "effectName";
  const call = current && ts.isVariableDeclaration(current) && current.initializer
    ? unwrapCall(current.initializer)
    : undefined;
  const callee = call?.expression.getText(module.sourceFile) ?? "effect";
  const rewrite = `export const ${name} = ${callee}({ grants: ["https://api.example.com"], run: async (_payload: null) => null });`;
  return diagnostic(module, code, node, message, rewrite);
}
