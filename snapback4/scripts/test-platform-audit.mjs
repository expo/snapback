// A conservative source check, not a proof of arbitrary JavaScript control flow.
// @ref LLP 3000.011.003.000.000#8 — Linux listener evidence must never become an implicit Darwin requirement.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../packages/snapback4/package.json', import.meta.url));
const ts = require('typescript');
const commands = new Set(['strace', 'ss', 'taskset', 'nsenter', 'unshare', 'ip', 'iptables', 'prlimit']);
const linux = node => node && /^(?:process\.platform|os\.platform\(\)|platform)\s*===?\s*['"]linux['"]$/.test(node.getText());
const nonLinux = node => node && /^(?:process\.platform|os\.platform\(\)|platform)\s*!==?\s*['"]linux['"]$/.test(node.getText());
const exits = node => ts.isReturnStatement(node) || (ts.isBlock(node) && node.statements.some(ts.isReturnStatement));
const functionValue = node => ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** Follow local .mjs imports and named functions, including helper aliases. */
export function auditTestPlatforms(files, { read = file => readFileSync(file, 'utf8'), exists = existsSync } = {}) {
  const modules = new Map();
  function load(file) {
    file = resolve(file);
    if (modules.has(file)) return modules.get(file);
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const module = { file, source, functions: new Map(), locals: new Map(), functionNodes: new Set(), imports: new Map(), dependencies: new Map(), unsafe: new Map() };
    modules.set(file, module);
    function bind(scope, name, fn) {
      if (!module.locals.has(scope)) module.locals.set(scope, new Map());
      module.locals.get(scope).set(name, fn);module.functionNodes.add(fn);
      if (scope === source) module.functions.set(name, fn);
    }
    function collect(node) {
      if (ts.isFunctionDeclaration(node) && node.name) bind(node.parent, node.name.text, node);
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer && functionValue(declaration.initializer)) bind(node.parent, declaration.name.text, declaration.initializer);
      ts.forEachChild(node, collect);
    }
    collect(source);
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text?.startsWith('.')) {
        const target = resolve(dirname(file), statement.moduleSpecifier.text);
        if (!target.endsWith('.mjs') || !exists(target)) continue;
        const imported = load(target), bindings = statement.importClause?.namedBindings;
        module.dependencies.set(statement, imported);
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements)
          module.imports.set(element.name.text, { module: imported, name: element.propertyName?.text ?? element.name.text });
        if (bindings && ts.isNamespaceImport(bindings)) module.imports.set(bindings.name.text, { module: imported });
      }
    }
    return module;
  }
  const roots = files.map(load);
  const gateForTest = node => {
    if (!ts.isCallExpression(node) || !/^(?:test|it)(?:\.(?:only|skip))?$/.test(node.expression.getText())) return false;
    return node.arguments.some(arg => ts.isObjectLiteralExpression(arg) && arg.properties.some(property =>
      ts.isPropertyAssignment(property) && property.name.getText() === 'skip' &&
      (nonLinux(property.initializer) || (ts.isBinaryExpression(property.initializer) &&
        property.initializer.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && nonLinux(property.initializer.left)))));
  };
  function inspect(module, start) {
    const hazards = [];
    const add = (node, why) => hazards.push({ file: module.file, line: module.source.getLineAndCharacterOfPosition(node.getStart()).line + 1, why });
    const callee = expression => {
      if (ts.isIdentifier(expression)) {
        for (let scope = expression.parent; scope; scope = scope.parent) {
          const fn = module.locals.get(scope)?.get(expression.text);
          if (fn) return module.unsafe.get(fn);
        }
        const binding = module.imports.get(expression.text);
        return binding?.module.unsafe.get(binding.module.functions.get(binding.name));
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const binding = module.imports.get(expression.expression.getText());
        return binding && !binding.name && binding.module.unsafe.get(binding.module.functions.get(expression.name.text));
      }
    };
    function walk(node, gated = false) {
      if (node !== start && module.functionNodes.has(node)) return;
      // Function declarations are summarized separately; callbacks inherit the
      // test's skip gate. A gate in a sibling test never protects this call.
      if (ts.isImportDeclaration(node)) {
        const imported = module.dependencies.get(node);
        if (!gated && imported?.initialization) add(node, `import initializes ${imported.initialization.why} (${imported.file}:${imported.initialization.line})`);
        return;
      }
      if (ts.isIfStatement(node)) {
        walk(node.expression, gated);
        walk(node.thenStatement, gated || linux(node.expression));
        if (node.elseStatement) walk(node.elseStatement, gated || nonLinux(node.expression));
        return;
      }
      if (ts.isBlock(node) || ts.isSourceFile(node)) {
        let afterGate = gated;
        for (const statement of node.statements) {
          walk(statement, afterGate);
          if (ts.isIfStatement(statement) && nonLinux(statement.expression) && exits(statement.thenStatement)) afterGate = true;
        }
        return;
      }
      if (ts.isConditionalExpression(node)) {
        walk(node.condition, gated);walk(node.whenTrue, gated || linux(node.condition));walk(node.whenFalse, gated || nonLinux(node.condition));return;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        walk(node.left,gated);walk(node.right,gated || linux(node.left));return;
      }
      if (ts.isCallExpression(node)) {
        if (!gated) {
          const dependency = callee(node.expression);
          if (dependency) add(node, `${node.expression.getText()} reaches ${dependency.why} (${dependency.file}:${dependency.line})`);
          // Inspect actual command invocation arguments, not mocked trace/version
          // strings. /proc paths below are intentionally more conservative.
          if (/^(?:(?:\w+)\.)?(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)$/.test(node.expression.getText())) {
            const command = node.arguments[0];
            if (command && ts.isStringLiteralLike(command) && commands.has(command.text.split(/\s/)[0])) add(node, `Linux command ${command.text}`);
          }
        }
        const testCall = /^(?:test|it)(?:\.(?:only|skip))?$/.test(node.expression.getText());
        const testGate = gateForTest(node);
        for (const child of node.arguments) {
          if (testCall && !gated && !testGate) {
            const callback = callee(child);
            if (callback) add(child, `test callback ${child.getText()} reaches ${callback.why} (${callback.file}:${callback.line})`);
          }
          walk(child, gated || (functionValue(child) && testGate));
        }
        return;
      }
      if (!gated && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /^\/proc(?:\/|$)/.test(node.text)) add(node, 'Linux /proc path');
      ts.forEachChild(node, child => walk(child, gated));
    }
    walk(start);
    return hazards;
  }
  // Propagate through local helpers and imported named/namespace helpers until
  // stable. No execution, environment probes or platform-dependent skips here.
  for (let changed = true; changed;) {
    changed = false;
    for (const module of modules.values()) {
      for (const fn of module.functionNodes) if (!module.unsafe.has(fn)) {
        const hazard = inspect(module, fn)[0];
        if (hazard) { module.unsafe.set(fn, hazard); changed = true; }
      }
      if (!module.initialization) {
        const hazard = inspect(module, module.source)[0];
        if (hazard) { module.initialization = hazard; changed = true; }
      }
    }
  }
  return roots.flatMap(module => inspect(module, module.source));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hazards = auditTestPlatforms(process.argv.slice(2));
  for (const hazard of hazards) console.error(`${hazard.file}:${hazard.line}: TEST_PLATFORM_GATE: ${hazard.why}; gate the call/test on Linux or provide a portable implementation`);
  process.exitCode = hazards.length ? 1 : 0;
}
