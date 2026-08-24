import path from 'node:path';

const compilerOptions = (ts) => ({
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
});

export function declarationValueExportNames(ts, checker, sourceFile) {
  const names = new Set();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(`could not load ${sourceFile.fileName} as a module`);
  }

  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    // TypeScript projects a module-private unique symbol through
    // `getExportsOfModule` when an exported interface uses it as a computed
    // phantom key. Consumers still cannot import that symbol, so it is not a
    // runtime export and must not participate in declaration/runtime parity.
    const isAliasedExport = Boolean(symbol.flags & ts.SymbolFlags.Alias);
    const isUnexportedLocal = !isAliasedExport
      && (symbol.declarations?.length ?? 0) > 0
      && symbol.declarations.every((declaration) => declaration.getSourceFile() === sourceFile)
      && !symbol.declarations.some((declaration) => {
        let node = declaration;
        while (node !== sourceFile) {
          if (ts.canHaveModifiers(node)) {
            const modifiers = ts.getModifiers(node) ?? [];
            if (modifiers.some((modifier) => (
              modifier.kind === ts.SyntaxKind.ExportKeyword
              || modifier.kind === ts.SyntaxKind.DefaultKeyword
            ))) return true;
          }
          node = node.parent;
        }
        return false;
      });
    if (isUnexportedLocal) continue;

    const resolved = symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
    const isRuntimeValue = Boolean(resolved.flags & ts.SymbolFlags.Value)
      && !Boolean(resolved.flags & ts.SymbolFlags.ConstEnum);
    if (isRuntimeValue) names.add(symbol.name);
  }

  // Export assignments are rejected explicitly rather than relying on how a
  // particular TypeScript release projects them through getExportsOfModule.
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    names.add(statement.isExportEquals ? 'export =' : 'default');
  }

  return [...names].sort();
}

export function inspectDeclarationValueExports(ts, typesFile) {
  const program = ts.createProgram([typesFile], compilerOptions(ts));
  const sourceFile = program.getSourceFile(typesFile)
    ?? program.getSourceFile(path.resolve(typesFile));
  if (sourceFile === undefined) {
    throw new Error(`could not load ${typesFile} as a TypeScript source file`);
  }
  return declarationValueExportNames(ts, program.getTypeChecker(), sourceFile);
}

export function declarationCompilerOptions(ts) {
  return compilerOptions(ts);
}
