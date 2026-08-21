import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const runtimeRootUrl = new URL('./index.mjs', import.meta.url).href;
const typesRootUrl = new URL('./index.d.mts', import.meta.url).href;
const appClientRuntimeUrl = new URL('./app-client.mjs', import.meta.url).href;
const defaultsRuntimeUrl = new URL('./app-client-defaults.mjs', import.meta.url).href;
const defaultsTypesUrl = new URL('./app-client-defaults.d.mts', import.meta.url).href;

const rootSource = readFileSync(new URL(runtimeRootUrl), 'utf8');
const appClientSource = readFileSync(new URL(appClientRuntimeUrl), 'utf8');
const defaultsSource = readFileSync(new URL(defaultsRuntimeUrl), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function graphUrl(specifier, importerUrl, flavor) {
  if (!specifier.startsWith('.')) return null;
  const resolved = new URL(specifier, importerUrl);
  if (flavor === 'types' && resolved.pathname.endsWith('.mjs')) {
    resolved.pathname = resolved.pathname.replace(/\.mjs$/u, '.d.mts');
  }
  return resolved.href;
}

function moduleInfo(moduleUrl, flavor, readSource) {
  const source = readSource(moduleUrl);
  const sourceFile = ts.createSourceFile(
    fileURLToPath(moduleUrl),
    source,
    ts.ScriptTarget.Latest,
    true,
    moduleUrl.endsWith('.d.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const imports = new Map();
  const declarations = new Map();
  const exports = new Map();
  const dependencies = new Set();
  const exportStars = [];
  const staticEdges = [];

  const hasExportModifier = (node) => node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  ) ?? false;
  const dependencyFor = (specifier) => graphUrl(specifier, moduleUrl, flavor);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier.text;
      staticEdges.push(specifier);
      const dependency = dependencyFor(specifier);
      const clause = statement.importClause;
      const hasValueImport = !clause
        || (!clause.isTypeOnly && (
          clause.name
          || !clause.namedBindings
          || ts.isNamespaceImport(clause.namedBindings)
          || clause.namedBindings.elements.some((element) => !element.isTypeOnly)
        ));
      if (dependency !== null && hasValueImport) dependencies.add(dependency);
      if (!clause || dependency === null) continue;
      if (clause.name) {
        imports.set(clause.name.text, { moduleUrl: dependency, importedName: 'default' });
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, {
            moduleUrl: dependency,
            importedName: element.propertyName?.text ?? element.name.text,
          });
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier?.text ?? null;
      if (specifier !== null) staticEdges.push(specifier);
      const dependency = specifier === null ? null : dependencyFor(specifier);
      const hasValueExport = !statement.isTypeOnly && (
        !statement.exportClause
        || !ts.isNamedExports(statement.exportClause)
        || statement.exportClause.elements.some((element) => !element.isTypeOnly)
      );
      if (dependency !== null && hasValueExport) dependencies.add(dependency);
      if (!statement.exportClause) {
        if (dependency !== null) exportStars.push(dependency);
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (statement.isTypeOnly || element.isTypeOnly) continue;
        const importedName = element.propertyName?.text ?? element.name.text;
        exports.set(element.name.text, dependency === null
          ? { kind: 'local', localName: importedName }
          : { kind: 'external', moduleUrl: dependency, importedName });
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, 'function');
      if (hasExportModifier(statement)) {
        exports.set(statement.name.text, { kind: 'local', localName: statement.name.text });
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.set(declaration.name.text, 'live');
        if (hasExportModifier(statement)) {
          exports.set(declaration.name.text, { kind: 'local', localName: declaration.name.text });
        }
      }
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, 'live');
      if (hasExportModifier(statement)) {
        exports.set(statement.name.text, { kind: 'local', localName: statement.name.text });
      }
      continue;
    }

    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name) {
      declarations.set(statement.name.text, 'type');
      if (hasExportModifier(statement)) {
        exports.set(statement.name.text, { kind: 'local', localName: statement.name.text });
      }
    }
  }

  return { declarations, dependencies, exports, exportStars, imports, staticEdges };
}

function assertNoTdzBackEdge({ flavor, rootUrl, readSource }) {
  const cache = new Map();
  const infoFor = (moduleUrl) => {
    if (!cache.has(moduleUrl)) cache.set(moduleUrl, moduleInfo(moduleUrl, flavor, readSource));
    return cache.get(moduleUrl);
  };
  const rootInfo = infoFor(rootUrl);
  const appClientUrl = graphUrl('./app-client.mjs', rootUrl, flavor);

  assert.equal(
    rootInfo.exportStars.includes(appClientUrl),
    false,
    `${fileURLToPath(rootUrl)} must not export * from app-client`,
  );

  function resolveBinding(moduleUrl, exportedName, seen = new Set()) {
    const identity = `${moduleUrl}#${exportedName}`;
    if (seen.has(identity)) return { bindingKind: 'unknown', path: [moduleUrl] };
    const nextSeen = new Set(seen).add(identity);
    const info = infoFor(moduleUrl);
    const exported = info.exports.get(exportedName);
    if (!exported) {
      const declaration = info.declarations.get(exportedName);
      return { bindingKind: declaration ?? 'unknown', path: [moduleUrl] };
    }
    if (exported.kind === 'external') {
      const resolved = resolveBinding(exported.moduleUrl, exported.importedName, nextSeen);
      return { ...resolved, path: [moduleUrl, ...resolved.path] };
    }
    const imported = info.imports.get(exported.localName);
    if (imported) {
      const resolved = resolveBinding(imported.moduleUrl, imported.importedName, nextSeen);
      return { ...resolved, path: [moduleUrl, ...resolved.path] };
    }
    return {
      bindingKind: info.declarations.get(exported.localName) ?? 'unknown',
      path: [moduleUrl],
    };
  }

  for (const [exportedName, exported] of rootInfo.exports) {
    const leavesRoot = exported.kind === 'external' || rootInfo.imports.has(exported.localName);
    if (!leavesRoot) continue;
    const resolved = resolveBinding(rootUrl, exportedName);
    if (resolved.bindingKind === 'function' || resolved.bindingKind === 'type') continue;
    const path = resolved.path.slice(1);
    const backEdgeModule = path.find((moduleUrl) => infoFor(moduleUrl).dependencies.has(rootUrl));
    assert.equal(
      backEdgeModule,
      undefined,
      `${exportedName} is a non-function live binding resolved through ${fileURLToPath(backEdgeModule ?? rootUrl)}, which statically imports the root`,
    );
  }
}

function assertImportFreeLeaf(moduleUrl, flavor, readSource) {
  const info = moduleInfo(moduleUrl, flavor, readSource);
  assert.equal(
    info.staticEdges.length,
    0,
    `${fileURLToPath(moduleUrl)} is an initialization-time leaf and must have no static imports or re-exports`,
  );
}

function assertCycleClassGuard(overrides = new Map()) {
  const readSource = (moduleUrl) => overrides.get(moduleUrl)
    ?? readFileSync(new URL(moduleUrl), 'utf8');
  assertNoTdzBackEdge({ flavor: 'runtime', rootUrl: runtimeRootUrl, readSource });
  assertNoTdzBackEdge({ flavor: 'types', rootUrl: typesRootUrl, readSource });
  assertImportFreeLeaf(defaultsRuntimeUrl, 'runtime', readSource);
  assertImportFreeLeaf(defaultsTypesUrl, 'types', readSource);
}

function assertFixtureFails(label, replacements, expected) {
  const scratchSources = new Map(replacements);
  assert.throws(
    () => assertCycleClassGuard(scratchSources),
    expected,
    `${label} must be rejected by the TDZ cycle-class guard`,
  );
}

test('root named exports contain no non-function binding through a root-importing module', () => {
  assertCycleClassGuard();
});

test('guard rejects a different const re-exported through app-client', () => {
  assertFixtureFails('different const re-export', [
    [runtimeRootUrl, `${rootSource}\nexport { TDZ_ESCAPE_CONST } from './app-client.mjs';\n`],
    [appClientRuntimeUrl, `${appClientSource}\nexport const TDZ_ESCAPE_CONST = 'escape';\n`],
  ], /TDZ_ESCAPE_CONST is a non-function live binding resolved through .*app-client\.mjs/u);
});

test('guard rejects export star from app-client', () => {
  assertFixtureFails('export star', [
    [runtimeRootUrl, `${rootSource}\nexport * from './app-client.mjs';\n`],
  ], /must not export \* from app-client/u);
});

test('guard rejects a side-effect import in the initialization leaf', () => {
  assertFixtureFails('side-effect leaf import', [
    [defaultsRuntimeUrl, `${defaultsSource}\nimport './index.mjs';\n`],
  ], /DEFAULT_AUTH_STORAGE_PARTITION is a non-function live binding resolved through .*app-client-defaults\.mjs/u);
});

test('guard rejects import-then-export through app-client', () => {
  const importThenExport = rootSource.replace(
    "export { DEFAULT_AUTH_STORAGE_PARTITION } from './app-client-defaults.mjs';",
    "import { DEFAULT_AUTH_STORAGE_PARTITION } from './app-client.mjs';\nexport { DEFAULT_AUTH_STORAGE_PARTITION };",
  );
  assert.notEqual(importThenExport, rootSource, 'fixture must replace the production re-export');
  assertFixtureFails('import then export', [
    [runtimeRootUrl, importThenExport],
  ], /DEFAULT_AUTH_STORAGE_PARTITION is a non-function live binding resolved through .*app-client\.mjs/u);
});

test('packed entrypoints expose one cycle-free storage-partition value', async () => {
  for (const path of ['app-client-defaults.mjs', 'app-client-defaults.d.mts']) {
    assert.ok(packageManifest.files.includes(path), `packed client must include ${path}`);
  }
  assert.deepEqual(packageManifest.exports['.'], {
    types: './index.d.mts',
    import: './index.mjs',
  });

  const [rootModule, appClientModule] = await Promise.all([
    import('./index.mjs'),
    import('./app-client.mjs'),
  ]);
  assert.equal(rootModule.DEFAULT_AUTH_STORAGE_PARTITION, 'default');
  assert.equal(appClientModule.DEFAULT_AUTH_STORAGE_PARTITION, 'default');
  assert.equal(
    rootModule.DEFAULT_AUTH_STORAGE_PARTITION,
    appClientModule.DEFAULT_AUTH_STORAGE_PARTITION,
    'the root and direct app-client entries expose the same leaf binding',
  );
});
