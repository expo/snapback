import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import type { FrontendDiagnostic, Program } from "./ir";
import { compileQuarry, type QuarryInput } from "./quarry/index";

export type Test = (name: string, run: () => void | Promise<void>) => void;

export function compileFixture(fixtures: string, name: string, stems: string[]) {
  const directory = resolve(fixtures, name, "snapback");
  const inputs: QuarryInput[] = stems.map((stem) => {
    const path = resolve(directory, `${stem}.q`);
    return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
  });
  return compileQuarry(inputs);
}

export function compileInline(inputs: Array<{ fileName: string; source: string }>) {
  return compileQuarry(inputs.map((input) => ({
    ...input,
    path: resolve("/virtual", input.fileName),
  })));
}

export async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-quarry-check-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Check emitted declarations and an importing consumer against declarations
 * emitted from the client's actual Api/Op module. No package
 * bundle (or unrelated runtime implementation graph) is needed for this check. */
export function apiConsumerDiagnostics(apiDts: string, consumer: string): string[] {
  const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
  const clientPath = resolve(frontend, "__client_api.d.ts");
  const client = ts.transpileDeclaration(readFileSync(resolve(frontend, "../snapback2/src/api.ts"), "utf8"), {
    fileName: "api.ts", reportDiagnostics: true,
  });
  if (client.diagnostics?.length) return client.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  const files = new Map([
    [resolve(frontend, "__api_consumer.ts"), consumer],
    [resolve(frontend, "__api_generated.d.ts"), apiDts],
    [clientPath, client.outputText],
  ]);
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: false, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "snapback2/client": [clientPath] },
  };
  const host = ts.createCompilerHost(options);
  const exists = host.fileExists.bind(host);
  host.fileExists = name => files.has(name) || exists(name);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, fresh) => files.has(name)
    ? ts.createSourceFile(name, files.get(name)!, languageVersion, true)
    : getSourceFile(name, languageVersion, onError, fresh);
  const program = ts.createProgram([...files.keys(), resolve(frontend, "lib.d.ts")], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return `${diagnostic.file?.fileName ?? "<options>"}:${position ? position.line + 1 : 0} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}

export function operation(programs: Program[], name: string): Program {
  const program = programs.find((item) => item.name === name);
  assert(program, `missing operation ${name}`);
  return program;
}

export function generatedOperation(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  assert(start >= 0, `missing generated operation ${name}`);
  const end = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

export function writeKeyNames(source: string): [string, string] | undefined {
  const first = source.match(/const (__q_writeKey1_[A-Za-z0-9_]+) = args\.owner;/)?.[1];
  const second = source.match(/const (__q_writeKey2_[A-Za-z0-9_]+) = args\.label;/)?.[1];
  return first && second ? [first, second] : undefined;
}

export function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

export function deepKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => deepKey(item, key));
  if (!value || typeof value !== "object") return false;
  return key in value || Object.values(value).some((item) => deepKey(item, key));
}

export function diagnosticsText(diagnostics: FrontendDiagnostic[]): string {
  return diagnostics.map((item) => `${item.code}@${item.site}: ${item.message}`).join("; ");
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
