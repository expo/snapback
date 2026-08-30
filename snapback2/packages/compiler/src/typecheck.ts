import ts from "typescript";

export function typecheckSource(source: string, fileName: string, libText: string): ts.Diagnostic[] {
  const sourceName = fileName.endsWith(".ts") ? fileName : `${fileName}.ts`;
  const files = new Map([[sourceName, source], ["bounded-lib.d.ts", libText]]);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host: ts.CompilerHost = {
    fileExists: (name) => files.has(name),
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "bounded-lib.d.ts",
    getNewLine: () => "\n",
    getSourceFile: (name, languageVersion) => {
      const text = files.get(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true);
    },
    readFile: (name) => files.get(name),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  const program = ts.createProgram([sourceName, "bounded-lib.d.ts"], options, host);
  return ts.getPreEmitDiagnostics(program).filter((item) => item.file?.fileName !== "bounded-lib.d.ts");
}

export function formatTypeDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
