import ts from "typescript";
import { resolve } from "node:path";
import { createProjectProgram, loadCompilerLib } from "../project-program";
import { propertyName, unwrapExpression } from "../syntax";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — inert descriptors require binding custody; a factory's name or annotated return type proves no native constructor.
const native = Symbol("snapback2.t");
const namespace = Symbol("snapback2");
type Owner = typeof native | typeof namespace | ts.ObjectLiteralExpression;
type Resolved = Owner | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.StringLiteralLike;
const legacyNames = ["scalar", "id", "text", "optional", "list"] as const;
const bindings = new WeakMap<ts.SourceFile, DescriptorBindings>();

/** Only the method of a proven native owner can interpret descriptor operands.
 * Callee aliases/computed callees remain outside the supported descriptor grammar. */
export function nativeDescriptorName(call: ts.CallExpression): string | undefined {
  const scope = descriptorBindings(call);
  const bound = scope.node(call);
  if (!ts.isCallExpression(bound) || !ts.isPropertyAccessExpression(bound.expression)) return undefined;
  const owner = scope.value(bound.expression.expression);
  return owner === native && scope.safe(owner) ? bound.expression.name.text : undefined;
}

export function legacyDescriptorName(call: ts.CallExpression): string | undefined {
  const scope = descriptorBindings(call);
  const bound = scope.node(call);
  if (!ts.isCallExpression(bound) || !ts.isIdentifier(bound.expression) || bound.questionDotToken) return undefined;
  const symbol = scope.checker.getSymbolAtLocation(bound.expression);
  const declarations = symbol?.declarations;
  // Resolve the identifier first. Import-equals, parameters, variables, merged
  // namespaces and implementation overloads cannot become ambient functions.
  if (!symbol || !declarations?.length || !declarations.every(declaration => ts.isFunctionDeclaration(declaration)
    && scope.safe(declaration) && !declaration.body && (declaration.getSourceFile().isDeclarationFile
      || declaration.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)
      || ts.isModuleBlock(declaration.parent) && ts.isModuleDeclaration(declaration.parent.parent)
        && !!(declaration.parent.parent.flags & ts.NodeFlags.GlobalAugmentation)))) return undefined;
  return legacyNames.find(name => name === symbol.name);
}

/** Attach the actual checked graph once, before schema, operations, or API lowering. */
export function bindDescriptorProgram(program: ts.Program, library: ts.SourceFile): void {
  const scope = new DescriptorBindings(program, library);
  for (const source of program.getSourceFiles()) bindings.set(source, scope);
}

/** Compare lexical bindings in the same checked graph; a shared spelling alone
 * cannot transfer a presence proof across a shadow or helper boundary. */
export function sameSourceBinding(left: ts.Identifier, right: ts.Identifier): boolean {
  const scope = descriptorBindings(left);
  if (scope !== descriptorBindings(right)) return false;
  const symbol = scope.checker.getSymbolAtLocation(scope.node(left));
  return symbol !== undefined && symbol === scope.checker.getSymbolAtLocation(scope.node(right));
}

function descriptorBindings(node: ts.Node): DescriptorBindings {
  const source = node.getSourceFile();
  let scope = bindings.get(source);
  if (!scope) {
    // Standalone unchecked entry points still bind the real module declarations
    // and any resolvable imports. Never manufacture legacy globals to fill a miss.
    const path = resolve(source.fileName);
    const checked = createProjectProgram(path, source.text, [], loadCompilerLib());
    bindDescriptorProgram(checked.program, checked.library);
    scope = bindings.get(checked.program.getSourceFile(path)!)!;
    scope.attach(source, checked.program.getSourceFile(path)!);
    bindings.set(source, scope);
  }
  return scope;
}

class DescriptorBindings {
  readonly checker: ts.TypeChecker;
  private readonly nodes = new WeakMap<ts.SourceFile, Map<string, ts.Node>>();
  private readonly unsafe = new Set<ts.Node | symbol>();
  private readonly nativeBinding: ts.Symbol | undefined;
  private readonly namespaceBinding: ts.Symbol | undefined;
  private readonly globalBinding: ts.Symbol | undefined;
  private readonly legacyFunctions: ts.FunctionDeclaration[] = [];
  private incomplete = false;
  private flowSteps = 0;

  constructor(program: ts.Program, library: ts.SourceFile) {
    this.checker = program.getTypeChecker();
    const module = this.checker.getAmbientModules().find(symbol => symbol.name === '"snapback2"');
    // An authored augmentation/type-shaped impostor is never the library's t.
    const binding = module && this.checker.getExportsOfModule(module).find(symbol => symbol.name === "t");
    if (binding?.declarations?.length && binding.declarations.every(d => d.getSourceFile() === library)) {
      this.nativeBinding = binding;
      this.namespaceBinding = module;
    }
    this.globalBinding = this.checker.resolveName("globalThis", undefined, ts.SymbolFlags.Value, false);
    for (const source of program.getSourceFiles()) {
      const collect = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && !node.body && node.name && legacyNames.some(name => name === node.name!.text))
          this.legacyFunctions.push(node);
        ts.forEachChild(node, collect);
      };
      collect(source);
    }
    const unsafe = new Set<ts.Node | symbol>();
    for (const source of program.getSourceFiles()) if (!source.isDeclarationFile) this.findUnsafe(source, unsafe);
    // An ambient local declaration emits no runtime binding that could isolate
    // it from a global factory write. Shared spelling never grants authority;
    // here it conservatively propagates a witnessed legacy invalidation.
    const invalidLegacy = new Set(this.legacyFunctions.filter(fn => unsafe.has(fn)).map(fn => fn.name!.text));
    for (const fn of this.legacyFunctions) if (invalidLegacy.has(fn.name!.text)) unsafe.add(fn);
    // Flow discovery must not consult partially applied invalidations: every alias
    // and every source in the checked graph participates in the same owner truth.
    for (const owner of unsafe) this.unsafe.add(owner);
  }

  attach(source: ts.SourceFile, checked: ts.SourceFile): void {
    const nodes = new Map<string, ts.Node>();
    const visit = (node: ts.Node) => { nodes.set(this.key(node), node); ts.forEachChild(node, visit); };
    visit(checked);
    this.nodes.set(source, nodes);
  }
  node(node: ts.Node): ts.Node { return this.nodes.get(node.getSourceFile())?.get(this.key(node)) ?? node; }
  private key(node: ts.Node): string { return `${node.pos}:${node.end}:${node.kind}`; }
  safe(owner: ts.Node | symbol): boolean { return !this.incomplete && !this.unsafe.has(owner); }

  private symbol(node: ts.Node): ts.Symbol | undefined {
    const symbol = ts.isShorthandPropertyAssignment(node)
      ? this.checker.getShorthandAssignmentValueSymbol(node) : this.checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
  }

  private valueSymbol(symbol: ts.Symbol | undefined, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
    if (!symbol || seen.has(symbol) || seen.size >= 64) return undefined;
    if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol;
    const next = new Set(seen).add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(declaration) && (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly)
        || ts.isExportSpecifier(declaration) && (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly)
        || ts.isImportClause(declaration) && declaration.isTypeOnly
        || ts.isNamespaceImport(declaration) && declaration.parent.isTypeOnly
        || ts.isNamespaceExport(declaration) && declaration.parent.isTypeOnly
        || ts.isImportEqualsDeclaration(declaration) && declaration.isTypeOnly) return undefined;
      const module = ts.isImportSpecifier(declaration) ? declaration.parent.parent.parent.moduleSpecifier
        : ts.isImportClause(declaration) ? declaration.parent.moduleSpecifier
        : ts.isExportSpecifier(declaration) ? declaration.parent.parent.moduleSpecifier : undefined;
      if (module) {
        const namespace = this.checker.getSymbolAtLocation(module);
        const name = ts.isImportClause(declaration) ? "default"
          : ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : undefined;
        if (namespace && name) return this.exportedValue(namespace, name, next);
      }
      if (ts.isExportSpecifier(declaration))
        return this.valueSymbol(this.checker.getExportSpecifierLocalTargetSymbol(declaration), next);
      if (ts.isExportAssignment(declaration)) {
        const value = unwrapExpression(declaration.expression);
        return ts.isIdentifier(value) ? this.valueSymbol(this.checker.getSymbolAtLocation(value), next) : undefined;
      }
    }
    return this.valueSymbol(this.checker.getAliasedSymbol(symbol), next);
  }

  private exportedValue(module: ts.Symbol, name: string, seen: Set<ts.Symbol>): ts.Symbol | undefined {
    if (seen.has(module) || seen.size >= 64) return undefined;
    const next = new Set(seen).add(module);
    const direct = module.exports?.get(ts.escapeLeadingUnderscores(name));
    if (direct) return this.valueSymbol(direct, next);
    // getExportsOfModule flattens export-star chains, including type-only
    // stars. Require a real value path before trusting that flattened symbol.
    const resolved = this.checker.getExportsOfModule(module).find(item => item.name === name);
    if (!resolved) return undefined;
    for (const declaration of module.exports?.get(ts.InternalSymbolName.ExportStar)?.declarations ?? []) {
      if (!ts.isExportDeclaration(declaration) || declaration.isTypeOnly || !declaration.moduleSpecifier) continue;
      const target = this.checker.getSymbolAtLocation(declaration.moduleSpecifier);
      const value = target && this.exportedValue(target, name, next);
      if (value && value === this.valueSymbol(resolved, next)) return value;
    }
    return undefined;
  }

  value(node: ts.Expression, seen = new Set<ts.Node>()): Resolved | undefined {
    const value = unwrapExpression(node);
    if (seen.size >= 64 || seen.has(value)) return undefined;
    const next = new Set(seen).add(value);
    const resolve = (expression: ts.Expression) => this.value(expression, next);
    if (ts.isIdentifier(value)) {
      const symbol = this.valueSymbol(this.checker.getSymbolAtLocation(value));
      if (symbol && symbol === this.nativeBinding) return native;
      if (symbol && symbol === this.namespaceBinding) return namespace;
      const declarations = symbol?.declarations;
      if (declarations?.length !== 1) return undefined;
      const declaration = declarations[0];
      if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
        && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const
        && declaration.initializer) return resolve(declaration.initializer);
      if (ts.isBindingElement(declaration) && !declaration.initializer && !declaration.dotDotDotToken
        && ts.isObjectBindingPattern(declaration.parent) && ts.isVariableDeclaration(declaration.parent.parent)) {
        const variable = declaration.parent.parent;
        const name = ts.isIdentifier(declaration.name) ? propertyName(declaration.propertyName ?? declaration.name) : undefined;
        if (variable.initializer && ts.isVariableDeclarationList(variable.parent)
          && variable.parent.flags & ts.NodeFlags.Const && name !== undefined)
          return this.member(resolve(variable.initializer), name, next);
      }
      if (ts.isFunctionDeclaration(declaration)) return declaration;
      return undefined;
    }
    if (ts.isObjectLiteralExpression(value) || ts.isFunctionExpression(value) || ts.isArrowFunction(value)
      || ts.isStringLiteralLike(value)) return value;
    if (ts.isConditionalExpression(value)) {
      // Conditions must themselves be static: no discarded call, throw or write.
      if (value.condition.kind !== ts.SyntaxKind.TrueKeyword && value.condition.kind !== ts.SyntaxKind.FalseKeyword) return undefined;
      return resolve(value.condition.kind === ts.SyntaxKind.TrueKeyword ? value.whenTrue : value.whenFalse);
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const owner = resolve(value.expression);
      const key = ts.isPropertyAccessExpression(value) ? value.name.text : value.argumentExpression && resolve(value.argumentExpression);
      const name = typeof key === "string" ? key : key && typeof key !== "symbol" && ts.isStringLiteralLike(key) ? key.text : undefined;
      return name === undefined ? undefined : this.member(owner, name, next);
    }
    if (ts.isCallExpression(value) && value.arguments.length === 0 && !value.questionDotToken) {
      const fn = resolve(value.expression);
      if (!fn || !this.safe(fn) || typeof fn === "symbol" || !(ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))
        || fn.parameters.length !== 0 || !fn.body || fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
        || !ts.isArrowFunction(fn) && fn.asteriskToken) return undefined;
      // A transparent owner accessor is proven from its body, independently of
      // its name and annotations. Descriptor-returning factories never enter here.
      if (!ts.isBlock(fn.body)) return resolve(fn.body);
      const statement = fn.body.statements.length === 1 && fn.body.statements[0];
      return statement && ts.isReturnStatement(statement) && statement.expression ? resolve(statement.expression) : undefined;
    }
    return undefined;
  }

  private member(owner: Resolved | undefined, name: string, seen: Set<ts.Node>): Resolved | undefined {
    if (!owner || !this.safe(owner)) return undefined;
    if (owner === namespace) return name === "t" ? native : undefined;
    if (typeof owner === "symbol" || !ts.isObjectLiteralExpression(owner)) return undefined;
    // Unsupported spreads/computed members/accessors cannot be silently skipped.
    if (owner.properties.some(property => !ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)
      || propertyName(property.name!) === undefined)) return undefined;
    const property = [...owner.properties].reverse().find(property => propertyName(property.name!) === name);
    return property && (ts.isPropertyAssignment(property) ? this.value(property.initializer, seen)
      : ts.isShorthandPropertyAssignment(property) ? this.shorthand(property, seen) : undefined);
  }

  private shorthand(property: ts.ShorthandPropertyAssignment, seen: Set<ts.Node>): Resolved | undefined {
    const declaration = this.valueSymbol(this.checker.getShorthandAssignmentValueSymbol(property))?.valueDeclaration;
    // Resolve the value binding, never the object's newly created property symbol.
    return declaration && (ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration)
      || ts.isBindingElement(declaration)) && declaration.name && ts.isIdentifier(declaration.name)
      ? this.value(declaration.name, seen) : undefined;
  }

  /** Conservative carrier flow is deliberately wider than positive resolution.
   * Uninterpreted setup is not executed: alternatives, containers, mutable
   * bindings and function returns only accumulate possible owner identities. */
  private carried(node: ts.Node, found: Set<ts.Node | symbol>, seen = new Set<ts.Node>()): void {
    if (seen.has(node) || ts.isTypeNode(node)) return;
    if (seen.size >= 128 || ++this.flowSteps > 100_000) { this.incomplete = true; return; }
    const next = new Set(seen).add(node);
    const visit = (child: ts.Node | undefined) => { if (child) this.carried(child, found, next); };
    const declaration = (item: ts.Declaration) => {
      if (ts.isVariableDeclaration(item) || ts.isParameter(item) || ts.isPropertyDeclaration(item)) {
        visit(item.initializer);
        if (ts.isVariableDeclaration(item) && ts.isVariableDeclarationList(item.parent)) {
          const loop = item.parent.parent;
          if (ts.isForOfStatement(loop) || ts.isForInStatement(loop)) visit(loop.expression);
        }
      } else if (ts.isBindingElement(item)) {
        visit(item.initializer);
        // Include the whole container when selection/default/rest cannot be
        // proved. Refusing this binding positively cannot erase its native flow.
        let parent: ts.Node = item.parent;
        while (ts.isObjectBindingPattern(parent) || ts.isArrayBindingPattern(parent) || ts.isBindingElement(parent)) parent = parent.parent;
        if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) declaration(parent);
      } else if (ts.isPropertyAssignment(item)) visit(item.initializer);
      else if (ts.isShorthandPropertyAssignment(item)) visit(item);
      else if (ts.isFunctionDeclaration(item) || ts.isFunctionExpression(item) || ts.isArrowFunction(item)
        || ts.isMethodDeclaration(item) || ts.isGetAccessorDeclaration(item)) visit(item);
      else if (ts.isModuleDeclaration(item)) visit(item.body);
    };
    if (ts.isIdentifier(node)) {
      const symbol = this.symbol(node);
      if (symbol && symbol === this.nativeBinding) { found.add(native); return; }
      if (symbol && symbol === this.namespaceBinding) { found.add(namespace); found.add(native); return; }
      if (symbol && symbol === this.globalBinding) { this.legacyFunctions.forEach(fn => found.add(fn)); return; }
      if (symbol && symbol.flags & ts.SymbolFlags.Module) {
        for (const exported of this.checker.getExportsOfModule(symbol)) {
          const value = exported.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(exported) : exported;
          if (value === this.nativeBinding) found.add(native);
          else value.declarations?.forEach(declaration);
        }
      }
      symbol?.declarations?.forEach(declaration);
      return;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = this.value(node.expression);
      // A constructor function is not a reference back to its native owner;
      // passing a descriptor result must not taint every normal query declaration.
      if (owner === native) return;
      if (owner === namespace) {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text
          : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (key === "t" || key === undefined) found.add(native);
        return;
      }
      // Checked symbols also follow named module exports and global members.
      this.symbol(node)?.declarations?.forEach(declaration);
      visit(node.expression);
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      // Unknown calls receive their arguments at the escape scan below. For a
      // locally visible accessor, its possible returns can carry an owner too.
      const callees = new Set<ts.Node | symbol>();
      this.carried(node.expression, callees, next);
      for (const callee of callees) {
        if (typeof callee !== "symbol" && (ts.isFunctionDeclaration(callee) || ts.isFunctionExpression(callee)
          || ts.isArrowFunction(callee) || ts.isMethodDeclaration(callee) || ts.isGetAccessorDeclaration(callee)))
          this.returned(callee, visit);
        else found.add(callee);
      }
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) {
      found.add(node);
      this.returned(node, visit);
      return;
    }
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) found.add(node);
    if (ts.isShorthandPropertyAssignment(node)) {
      this.symbol(node)?.declarations?.forEach(declaration);
      visit(node.objectAssignmentInitializer);
      return;
    }
    if (ts.isPropertyAssignment(node)) { visit(node.initializer); return; }
    // Type annotations, property names and declaration names are not value flow.
    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) { visit(node.initializer); return; }
    ts.forEachChild(node, visit);
  }

  private returned(node: ts.FunctionLikeDeclaration, visit: (node: ts.Node | undefined) => void): void {
    if (!node.body) return;
    if (!ts.isBlock(node.body)) { visit(node.body); return; }
    const returns = (child: ts.Node) => {
      if (ts.isReturnStatement(child)) visit(child.expression);
      else if (!ts.isFunctionLike(child)) ts.forEachChild(child, returns);
    };
    ts.forEachChild(node.body, returns);
  }

  private findUnsafe(node: ts.Node, unsafe: Set<ts.Node | symbol>): void {
    const mark = (expression: ts.Node) => this.carried(expression, unsafe);
    const write = (expression: ts.Expression) => {
      const value = unwrapExpression(expression);
      if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
        mark(value.expression);
        // globalThis.scalar and scalar share the actual project declaration.
        this.symbol(value)?.declarations?.forEach(d => unsafe.add(d));
      } else if (ts.isArrayLiteralExpression(value)) value.elements.forEach(element => write(ts.isSpreadElement(element) ? element.expression : element));
      else if (ts.isObjectLiteralExpression(value)) value.properties.forEach(property => {
        if (ts.isPropertyAssignment(property)) write(property.initializer);
        else if (ts.isSpreadAssignment(property)) write(property.expression);
        else if (ts.isShorthandPropertyAssignment(property)) mark(property);
      });
      else mark(value);
    };
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      write(node.left);
      // Assignment can hand an owner to storage/aliases whose later behavior
      // is outside the supported positive grammar. Preserve that escape now.
      mark(node.right);
    }
    if (ts.isDeleteExpression(node)) write(node.expression);
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) write(node.initializer);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) write(node.operand);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      node.arguments?.forEach(argument => mark(argument));
      const callee = unwrapExpression(node.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const owner = this.value(callee.expression);
        // Method receivers are also inputs to unknown code (for example an
        // array handing its stored owner to map's callback). Proven native
        // constructors and transparent owner accessors remain inert.
        if (owner !== native && owner !== namespace && !(ts.isCallExpression(node) && this.value(node) !== undefined))
          mark(callee.expression);
      }
    }
    if (ts.isTaggedTemplateExpression(node)) {
      if (ts.isTemplateExpression(node.template)) node.template.templateSpans.forEach(span => mark(span.expression));
      const tag = unwrapExpression(node.tag);
      if (ts.isPropertyAccessExpression(tag) || ts.isElementAccessExpression(tag)) mark(tag.expression);
    }
    if ((ts.isYieldExpression(node) || ts.isThrowStatement(node)) && node.expression) mark(node.expression);
    if (ts.isPropertyDeclaration(node) && node.initializer) mark(node.initializer);
    ts.forEachChild(node, child => this.findUnsafe(child, unsafe));
  }
}
