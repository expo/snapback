import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

