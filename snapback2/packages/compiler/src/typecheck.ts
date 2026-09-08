import ts from "typescript";
import { sourceFiles, sourcePath } from "./source-path";

export function createSourceProgram(source: string, fileName: string, libText: string) {
  const sourceName = sourcePath(fileName.endsWith(".ts") ? fileName : `${fileName}.ts`);
  const libraryName = sourceName === "bounded-lib.d.ts" ? "_bounded-lib.d.ts" : "bounded-lib.d.ts";
  const files = sourceFiles([[sourceName, source], [libraryName, libText]], sourcePath);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host: ts.CompilerHost = {
    fileExists: (name) => files.has(sourcePath(name)),
    getCanonicalFileName: sourcePath,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => libraryName,
    getNewLine: () => "\n",
    getSourceFile: (name, languageVersion) => {
      const text = files.get(sourcePath(name));
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true);
    },
    readFile: (name) => files.get(sourcePath(name)),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  const program = ts.createProgram([sourceName, libraryName], options, host);
  return { program, sourceFile: program.getSourceFile(sourceName)!, library: program.getSourceFile(libraryName)! };
}

export function typecheckSource(source: string, fileName: string, libText: string): ts.Diagnostic[] {
  const { program, library } = createSourceProgram(source, fileName, libText);
  return ts.getPreEmitDiagnostics(program).filter(item => item.file !== library);
}

export function formatTypeDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
