#!/usr/bin/env node
import { createInterface } from "node:readline";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";

type Request = { id?: string | number; op: "probe" | "compile" | "seed" | "journeys"; root: string };

const protocol = "snapback2/compiler-worker/v1";
const operations = ["compile", "seed", "journeys"] as const;
// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — doctor proves the fixed worker closure without eagerly parsing the heavy lowering graph.
const compilerCore = new URL("./compiler-core.mjs", import.meta.url);
let compilerPromise: Promise<typeof import("./project")> | undefined;
const loadCompiler = () => compilerPromise ??= import("./project");

const apiDeclarations = new Map<string, string>();

async function respond(request: Request): Promise<Record<string, unknown>> {
  if (!request || typeof request.root !== "string" || !isAbsolute(request.root)) {
    return refusal(request?.id, "E_OP_INVALID", "compiler request requires an absolute project root");
  }
  if (request.op === "probe") {
    try {
      await access(compilerCore);
    } catch {
      return dependencyRefusal(request.id, "compiler-core.mjs");
    }
    try {
      createRequire(import.meta.url).resolve("typescript");
    } catch {
      return dependencyRefusal(request.id, "typescript");
    }
    return { id: request.id, ok: true, protocol, operations };
  }
  const { compileJourneys, lowerProject, lowerSeed } = await loadCompiler();
  if (request.op === "compile") {
    const result = await lowerProject(request.root);
    if (result.ok) apiDeclarations.set(request.root, result.apiDts);
    return { id: request.id, ...result };
  }
  if (request.op === "seed") return { id: request.id, ...await lowerSeed(request.root) };
  if (request.op === "journeys") {
    let apiDts = apiDeclarations.get(request.root);
    if (apiDts === undefined) {
      const compiled = await lowerProject(request.root);
      if (!compiled.ok) return { id: request.id, ...compiled };
      apiDts = compiled.apiDts;
      apiDeclarations.set(request.root, apiDts);
    }
    return { id: request.id, ...await compileJourneys(request.root, apiDts) };
  }
  return refusal(request.id, "E_OP_INVALID", `unknown compiler operation ${(request as { op?: unknown }).op ?? "<missing>"}`);
}

function dependencyRefusal(id: unknown, dependency: string): Record<string, unknown> {
  return { id, ok: false, protocol, operations, dependency };
}

function refusal(id: unknown, code: string, message: string): Record<string, unknown> {
  return {
    id,
    ok: false,
    diagnostics: [{
      code,
      family: "op",
      message,
      site: "<worker>:1:1",
      rewrite: "send { id, op: 'probe' | 'compile' | 'seed' | 'journeys', root: '/absolute/project' }",
      guide: "programs/operations",
    }],
  };
}

async function safeRespond(value: unknown): Promise<Record<string, unknown>> {
  try {
    return await respond(value as Request);
  } catch (error) {
    return refusal((value as { id?: unknown } | null)?.id, "E_OP_INVALID", error instanceof Error ? error.message : String(error));
  }
}

async function runWorker(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refusal(undefined, "E_OP_INVALID", `invalid JSON: ${String(error)}`))}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify(await safeRespond(value))}\n`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--worker")) {
    await runWorker();
    return;
  }
  const projectAt = process.argv.indexOf("--project");
  if (projectAt < 0 || !process.argv[projectAt + 1]) {
    console.error("usage: node compiler.mjs --worker | --project <root>");
    process.exitCode = 2;
    return;
  }
  const response = await safeRespond({ op: "compile", root: resolve(process.argv[projectAt + 1]) });
  delete response.id;
  console.log(JSON.stringify(response, null, 2));
  if (!response.ok) process.exitCode = 1;
}

await main();
