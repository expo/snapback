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
