import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const packageManifest = JSON.parse(
  readFileSync(resolve(packageDirectory, 'package.json'), 'utf8'),
);

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function exportedBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      exportedBindingNames(element.name, names);
    }
  }
}

function unsupportedExport(subpath, typesTarget, sourceFile, statement, shape) {
  const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
  assert.fail(
    `${subpath}: ${typesTarget}:${position.line + 1} uses unsupported ${shape}; `
      + 'extend the export-parity collector before adding this export shape',
  );
}

function collectDeclaredValueExports(subpath, typesTarget, sourceText) {
  const sourceFile = ts.createSourceFile(
    typesTarget,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      unsupportedExport(
        subpath,
        typesTarget,
        sourceFile,
        statement,
        statement.isExportEquals ? '`export =`' : '`export default`',
      );
    }

    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      unsupportedExport(subpath, typesTarget, sourceFile, statement, '`export default`');
    }

    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        unsupportedExport(subpath, typesTarget, sourceFile, statement, '`export * from`');
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        unsupportedExport(
          subpath,
          typesTarget,
          sourceFile,
          statement,
          'namespace re-export (`export * as namespace from`)',
        );
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        unsupportedExport(subpath, typesTarget, sourceFile, statement, 'export declaration');
      }
      if (!statement.isTypeOnly) {
        for (const specifier of statement.exportClause.elements) {
          if (!specifier.isTypeOnly) {
            names.add(specifier.name.text);
          }
        }
      }
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (!statement.name) {
        unsupportedExport(subpath, typesTarget, sourceFile, statement, 'unnamed export');
      }
      names.add(statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        exportedBindingNames(declaration.name, names);
      }
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.ConstKeyword)) {
        names.add(statement.name.text);
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      continue;
    }

    unsupportedExport(subpath, typesTarget, sourceFile, statement, 'exported declaration');
  }

  return names;
}

let verifiedSymbolCount = 0;
let verifiedEntryCount = 0;

for (const [subpath, target] of Object.entries(packageManifest.exports)) {
  if (
    subpath === './package.json'
    || typeof target !== 'object'
    || target === null
    || typeof target.types !== 'string'
    || typeof target.import !== 'string'
  ) {
    continue;
  }

  const typesTarget = target.types.replace(/^\.\//u, '');
  const importTarget = target.import.replace(/^\.\//u, '');
  const declaredNames = collectDeclaredValueExports(
    subpath,
    typesTarget,
    readFileSync(resolve(packageDirectory, typesTarget), 'utf8'),
  );
  const runtimeModule = await import(pathToFileURL(resolve(packageDirectory, importTarget)).href);

  for (const symbolName of declaredNames) {
    const assertionContext = `${subpath} export ${symbolName} `
      + `(types: ${typesTarget}, runtime: ${importTarget})`;
    assert.ok(
      Object.hasOwn(runtimeModule, symbolName),
      `${assertionContext} must be an own property of the runtime module namespace`,
    );
    assert.notEqual(
      runtimeModule[symbolName],
      undefined,
      `${assertionContext} must not be undefined at runtime`,
    );
    verifiedSymbolCount += 1;
  }
  verifiedEntryCount += 1;
}

console.log(
  `export-parity.test.mjs: ${verifiedSymbolCount} declared symbols verified `
    + `across ${verifiedEntryCount} export entries.`,
);
