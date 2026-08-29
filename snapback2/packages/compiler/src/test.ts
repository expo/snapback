import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lowerSource, typecheckSource } from "./compiler";
import { assessGauntlet } from "./gauntlet";
import type { Program, ProjectJson } from "./ir";
import { listJourneys, lowerProject, lowerSeed } from "./project";
import { rustCheck } from "./rust-check";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
const repo = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
const libText = `${await Bun.file(`${frontend}subset-lib.d.ts`).text()}\n${await Bun.file(`${frontend}lib.d.ts`).text()}`;
const legacyLib = `${libText}\n${await Bun.file(`${frontend}gauntlet.d.ts`).text()}`;

type Check = { name: string; run: () => void | Promise<void> };
const checks: Check[] = [];
const test = (name: string, run: Check["run"]) => checks.push({ name, run });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}

function dequalify(value: unknown): any {
  if (Array.isArray(value)) return value.map(dequalify);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dequalify(item)]));
  }
  return typeof value === "string" && value.startsWith("programs.") ? value.slice("programs.".length) : value;
}

const corpusFiles = [
  "named-thread",
  "named-send",
  "named-send-maintained-unread",
  "named-mark-read",
  "named-inbox-count-capped",
  "named-inbox-maintained",
  "named-start-dm",
  "named-board-view",
  "named-board-summary",
  "named-ledger",
  "named-add-expense",
  "named-ancestors",
  "named-mention-scan",
  "named-helper-wrapped-scan",
  "named-maintained-waitlist",
  "named-hidden-rule",
  "named-delete-message",
];

test("S1 project preserves all 17 IR programs and certificates", async () => {
  const lowered = await lowerProject(`${frontend}fixtures/s1`);
  assert(lowered.ok, `S1 project refused: ${lowered.ok ? "" : lowered.diagnostics.map((item) => item.message).join("; ")}`);
  assert(lowered.project.programs.length === 17, `expected 17 S1 programs, got ${lowered.project.programs.length}`);
  const candidatePrograms = lowered.project.programs.map((program) => dequalify(program) as Program);

  const referencePrograms: Program[] = [];
  for (const file of corpusFiles) {
    const fixture = await Bun.file(`${crate}corpus/${file}.json`).json();
    referencePrograms.push(fixture.program as Program);
  }
  const references = new Map(referencePrograms.map((program) => [program.name, program]));
  for (const program of candidatePrograms) {
    assert(JSON.stringify(program) === JSON.stringify(references.get(program.name)), `${program.name} IR differs byte-for-byte from S1`);
  }
  const candidateCertificates = rustCheck(candidatePrograms, "spike");
  const referenceCertificates = new Map(rustCheck(referencePrograms, "spike").map((item) => [item.program, item]));
  for (const candidate of candidateCertificates) {
    assert(candidate.error === null, `${candidate.program} candidate did not certify`);
    const reference = referenceCertificates.get(candidate.program);
    assert(reference?.error === null, `${candidate.program} reference did not certify`);
    assert(JSON.stringify(candidate.certificate) === JSON.stringify(reference.certificate), `${candidate.program} certificate differs byte-for-byte from S1`);
  }
});

test("the authored module requires imports and keeps the deterministic subset", () => {
  const oldGlobal = typecheckSource("const users = table({ columns: {} });", "old-global.ts", libText);
  assert(oldGlobal.length > 0, "old global table() unexpectedly compiled");
  for (const forbidden of ["Date.now()", "Math.random()", "fetch('x')", "setTimeout(() => 0, 1)", "eval('1')"]) {
    const source = `import { query } from 'snapback2'; export const bad = query({}, () => ${forbidden});`;
    const lowered = lowerSource(source, "forbidden.ts", libText);
    assert(!lowered.ok, `${forbidden} was admitted into a data program`);
  }
});

test("all first-attempt refusals carry complete envelopes and mechanical rewrites", async () => {
  const firstAttempts: Record<string, string> = {
    "unbound-scan.ts": "E_UNBOUND_SCAN",
    "unbound-count.ts": "E_UNBOUND_COUNT",
    "structural-loop-tally.ts": "E_STRUCTURAL_COUNT",
    "ambient-time.ts": "E_AMBIENT_TIME",
    "while-loop.ts": "E_OPAQUE",
    "structural-rank.ts": "E_STRUCTURAL_COUNT",
    "helper-scan.ts": "E_UNBOUND_SCAN",
    "split-loop.ts": "E_UNBOUND_LOOP",
  };
  for (const [file, expected] of Object.entries(firstAttempts)) {
    const source = await Bun.file(`${frontend}fixtures/first-attempts/${file}`).text();
    const refused = lowerSource(source, file, legacyLib);
    assert(!refused.ok, `${file} unexpectedly lowered`);
    const item = refused.diagnostics[0]!;
    assert(item.code === expected, `${file}: expected ${expected}, got ${item.code}`);
    assert(/:\d+:\d+$/.test(item.site), `${file}: invalid site`);
    assert(item.family.length > 0 && item.guide.length > 0 && item.rewrite.length > 0, `${file}: incomplete refusal envelope`);
    assert(item.rewrite !== source || expected === "E_OPAQUE", `${file}: rewrite did not change source`);
    if (item.rewrite !== source) {
      const fixed = lowerSource(item.rewrite, `fixed-${file}`, legacyLib);
      assert(fixed.ok, `${file}: verbatim rewrite did not lower`);
      assert(rustCheck(fixed.programs, "synthetic").every((result) => result.error === null), `${file}: rewrite did not certify`);
    }
  }
});

test("bound and collection callback fixtures still certify", async () => {
  const boundSource = await Bun.file(`${frontend}fixtures/bound.ts`).text();
  const bound = lowerSource(boundSource, "bound.ts", legacyLib);
  assert(!bound.ok && bound.diagnostics[0]?.code === "E_BOUND", "bound fixture did not emit E_BOUND");
  const boundFixed = lowerSource(bound.diagnostics[0]!.rewrite, "fixed-bound.ts", legacyLib);
  assert(boundFixed.ok, "E_BOUND rewrite did not lower");
  assert(rustCheck(boundFixed.programs, "synthetic").every((result) => result.error === null), "E_BOUND rewrite did not certify");

  const subsetSource = await Bun.file(`${frontend}fixtures/subset-surface.ts`).text();
  const subset = lowerSource(subsetSource, "fixtures/subset-surface.ts", legacyLib);
  assert(subset.ok, `collection/write-callback surface refused: ${subset.ok ? "" : subset.diagnostics[0]?.message}`);
  assert(subset.programs.length === 3, `expected three subset-surface programs, got ${subset.programs.length}`);
  assert(rustCheck(subset.programs, "synthetic").every((result) => result.error === null), "collection/write-callback surface did not certify");
});

test("chat and todos lower schema, channels, effects, emit, API types, seed, and journeys", async () => {
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, `chat refused: ${chat.ok ? "" : chat.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
  assert(chat.project.programs.length === 3, "chat operation count differs");
  assert(chat.project.effects[0]?.name === "notifications.notify", "chat effect was not qualified");
  assert(chat.project.schema.effects[0] === "notifications.notify", "schema effect list differs");
  assert("typing" in chat.project.schema.channels, "typing channel missing");
  const send = chat.project.programs.find((program) => program.name === "messages.send")!;
  assert(canonical(send).includes('"Emit"'), "emit did not lower into the mutation IR");
  assert(chat.apiDts.includes("messages") && chat.apiDts.includes("Op<{ conversationId: string"), "chat API declaration missing inferred types");

  const todos = await lowerProject(`${frontend}fixtures/todos`);
  assert(todos.ok, `todos refused: ${todos.ok ? "" : todos.diagnostics.map((item) => item.message).join("; ")}`);
  assert(todos.apiDts.startsWith("import type { Op } from 'snapback2/client'"), "API declaration is not a module augmentation");
  assert(todos.apiDts.includes("note?: string") && todos.apiDts.includes("labels: string[]"), "optional/list API inference differs");
  assert(canonical(todos.project.schema.tables).includes('"Optional":{"List"'), "optional/list schema columns did not lower");
  const seed = await lowerSeed(`${frontend}fixtures/chat`);
  assert(seed.ok && seed.seed.personas.length === 2 && seed.seed.rows.profiles?.length === 2, "chat seed did not lower");
  const journeys = await listJourneys(`${frontend}fixtures/chat`);
  assert(canonical(journeys) === canonical(["snapback/tests/chat.test.ts"]), "chat journey list differs");
});

test("project compilation aggregates refusals across every failing module", async () => {
  const invalid = await lowerProject(`${frontend}fixtures/invalid`);
  assert(!invalid.ok, "invalid multi-module project compiled");
  const codes = new Set(invalid.diagnostics.map((item) => item.code));
  for (const code of ["E_UNBOUND_SCAN", "E_OPAQUE", "E_SCHEMA_RESERVED", "E_SCHEMA_INDEX_COLUMN"]) {
    assert(codes.has(code as any), `aggregate diagnostics omitted ${code}`);
  }
  assert(invalid.diagnostics.some((item) => item.site.startsWith("snapback/a.ts")), "module a refusal missing");
  assert(invalid.diagnostics.some((item) => item.site.startsWith("snapback/b.ts")), "module b refusal missing");
});

test("effect authoring reports grants, closure, imports, and then arguments together", async () => {
  const invalid = await lowerProject(`${frontend}fixtures/effects-invalid`);
  assert(!invalid.ok, "invalid effects project compiled");
  const codes = new Set(invalid.diagnostics.map((item) => item.code));
  for (const code of ["E_EFFECT_GRANT", "E_EFFECT_CLOSURE", "E_EFFECT_IMPORT", "E_EFFECT_THEN_ARGS", "E_EFFECT_UNKNOWN", "E_EMIT_IN_QUERY"]) {
    assert(codes.has(code as any), `effect diagnostics omitted ${code}`);
  }
});

test("worker survives a refused compile and serves the next request under Node", async () => {
  const built = Bun.spawnSync({ cmd: ["node", "build.mjs"], cwd: `${crate}packages/snapback2`, stdout: "pipe", stderr: "pipe" });
  assert(built.exitCode === 0, `package build failed: ${new TextDecoder().decode(built.stderr)}`);
  const bundle = `${crate}packages/snapback2/dist/compiler.mjs`;
  const shipped = await Bun.file(bundle).text();
  assert(!shipped.includes("Bun."), "shipped compiler contains Bun.*");
  const worker = Bun.spawn({ cmd: ["node", bundle, "--worker"], stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  worker.stdin.write(`${JSON.stringify({ id: 1, op: "compile", root: resolve(frontend, "fixtures/invalid") })}\n`);
  worker.stdin.write(`${JSON.stringify({ id: 2, op: "compile", root: resolve(frontend, "fixtures/todos") })}\n`);
  worker.stdin.end();
  const output = await new Response(worker.stdout).text();
  const stderr = await new Response(worker.stderr).text();
  const status = await worker.exited;
  assert(status === 0, `worker exited nonzero: ${stderr}`);
  const responses = output.trim().split("\n").map((line) => JSON.parse(line));
  assert(responses[0]?.id === 1 && responses[0]?.ok === false, "worker did not return the refused compile");
  assert(responses[1]?.id === 2 && responses[1]?.ok === true, "worker did not survive for the next compile");
});

test("binary check accepts explicit schema requests and ProjectJson files", async () => {
  const built = Bun.spawnSync({ cmd: ["cargo", "build", "-p", "snapback2"], cwd: crate, stdout: "pipe", stderr: "pipe" });
  assert(built.exitCode === 0, `cargo build failed: ${new TextDecoder().decode(built.stderr)}`);
  const chat = await lowerProject(`${frontend}fixtures/chat`);
  assert(chat.ok, "chat did not compile for binary check");
  const buildDir = `${frontend}fixtures/chat/.snapback/build`;
  await mkdir(buildDir, { recursive: true });
  const projectPath = `${buildDir}/project.json`;
  await Bun.write(projectPath, JSON.stringify(chat.project));
  const checked = runBinaryCheck(["--project", projectPath]);
  assert(checked.exitCode === 0, `project check failed: ${checked.stderr}`);
  assert(checked.results.length === chat.project.programs.length, "project check omitted programs");
  assert(checked.results.every((item: any) => (item.certificate === null) !== (item.error === null)), "project check omitted a certificate/refusal outcome");
  const unsupported = checked.results.filter((item: any) => item.error?.message.includes("matching project IR"));
  assert(unsupported.length <= 1 && unsupported.every((item: any) => item.program === "messages.send"), "project check returned an unexpected refusal");

  const explicit = runBinaryCheck([], { schema: chat.project.schema, programs: chat.project.programs } as ProjectJson);
  assert(explicit.exitCode === 0 && explicit.results.length === chat.project.programs.length, "explicit schema request failed");
});

test("the 30-shape gauntlet remains measured", async () => {
  const codexReview = await Bun.file(`${repo}llp/reviews/0329.014-bounded-data-programs.codex.r3.md`).text();
  const fableReview = await Bun.file(`${repo}llp/reviews/0329.014-bounded-data-programs.fable.r3.md`).text();
  const gauntlet = [
    ...assessGauntlet("codex", codexReview, legacyLib),
    ...assessGauntlet("fable", fableReview, legacyLib),
  ];
  assert(gauntlet.length === 30, `expected 30 numbered gauntlet shapes, got ${gauntlet.length}`);
  const coded = gauntlet.filter((item) => item.source.trim());
  assert(coded.length === 27, `expected 27 shapes with code, got ${coded.length}`);
});

function runBinaryCheck(args: string[], input?: unknown): { exitCode: number; stderr: string; results: any[] } {
  const process = Bun.spawnSync({
    cmd: [`${crate}target/debug/snapback2`, "check", ...args],
    cwd: crate,
    stdin: input === undefined ? undefined : new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(process.stdout);
  return {
    exitCode: process.exitCode,
    stderr: new TextDecoder().decode(process.stderr),
    results: stdout.trim() ? JSON.parse(stdout).results : [],
  };
}

const failures: Array<{ name: string; error: unknown }> = [];
const passes: string[] = [];
for (const check of checks) {
  try {
    await check.run();
    passes.push(check.name);
  } catch (error) {
    failures.push({ name: check.name, error });
  }
}

console.log(JSON.stringify({ checks: checks.length, passed: passes.length, failed: failures.length, names: passes }));
for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.error instanceof Error ? failure.error.stack ?? failure.error.message : String(failure.error)}`);
}
if (failures.length > 0) process.exitCode = 1;
