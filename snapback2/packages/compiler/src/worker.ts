#!/usr/bin/env node
import { createInterface } from "node:readline";
import { lowerProject, lowerSeed, listJourneys } from "./project";

type Request = { id?: string | number; op: "compile" | "seed" | "journeys"; root: string };

async function respond(request: Request): Promise<Record<string, unknown>> {
  if (!request || typeof request.root !== "string") {
    return refusal(request?.id, "E_OP_INVALID", "compiler request requires an absolute project root");
  }
  if (request.op === "compile") return { id: request.id, ...await lowerProject(request.root) };
  if (request.op === "seed") return { id: request.id, ...await lowerSeed(request.root) };
  if (request.op === "journeys") return { id: request.id, ok: true, files: await listJourneys(request.root) };
  return refusal(request.id, "E_OP_INVALID", `unknown compiler operation ${(request as { op?: unknown }).op ?? "<missing>"}`);
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
      rewrite: "send { id, op: 'compile' | 'seed' | 'journeys', root: '/absolute/project' }",
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
  const response = await safeRespond({ op: "compile", root: process.argv[projectAt + 1] });
  delete response.id;
  console.log(JSON.stringify(response, null, 2));
  if (!response.ok) process.exitCode = 1;
}

await main();
