import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectJson } from "./ir";
import { lowerProject } from "./project";
import ts from "typescript";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);

type RegisterTest = (name: string, run: () => void | Promise<void>) => void;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function registerFinalGateChecks(test: RegisterTest): void {
  test("the React template typechecks against the built snapback2/react package", () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const app = resolve(packageRoot, "templates/react/src/App.tsx");
    const program = ts.createProgram({
      rootNames: [app],
      options: {
        baseUrl: packageRoot,
        jsx: ts.JsxEmit.ReactJSX,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        paths: {
          "snapback2/react": [resolve(packageRoot, "dist/react.d.ts")],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: ["react"],
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.file?.fileName === app);
    assert(
      diagnostics.length === 0,
      `React template did not typecheck against dist/react.d.ts:\n${diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`,
    );
  });

  test("the chat template's React and Expo apps typecheck against the built package and generated API", async () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const template = resolve(packageRoot, "templates/chat");
    const lowered = await lowerProject(template);
    assert(lowered.ok, "the chat template did not compile for the React screen typecheck");
    const buildDir = resolve(template, ".snapback/build");
    await mkdir(buildDir, { recursive: true });
    const apiDts = resolve(buildDir, "api.d.ts");
    await Bun.write(apiDts, lowered.apiDts);
    const files = async (path: string): Promise<string[]> => {
      const entries = await readdir(path, { withFileTypes: true });
      return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(resolve(path, entry.name))
        : entry.isFile() && /\.tsx?$/.test(entry.name) ? [resolve(path, entry.name)] : []))).flat();
    };
    const screens = (await Promise.all(["react", "expo", "shared"].map((arm) => files(resolve(template, arm))))).flat();
    const program = ts.createProgram({
      rootNames: [...screens, apiDts],
      options: {
        baseUrl: packageRoot,
        jsx: ts.JsxEmit.ReactJSX,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        paths: {
          snapback2: [resolve(packageRoot, "dist/index.d.ts")],
          "snapback2/client": [resolve(packageRoot, "dist/client.d.ts")],
          "snapback2/react": [resolve(packageRoot, "dist/react.d.ts")],
          "snapback2/react-native": [resolve(packageRoot, "dist/react-native.d.ts")],
          "snapback2/expo": [resolve(packageRoot, "dist/expo.d.ts")],
          "snapback2/expo/witness": [resolve(packageRoot, "dist/expo/witness.d.ts")],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        typeRoots: [resolve(packageRoot, "node_modules/@types")],
        types: ["react", "node"],
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program)
      .filter((item) => !item.file || item.file.fileName.startsWith(template));
    assert(
      diagnostics.length === 0,
      `chat apps did not typecheck:\n${diagnostics.map((item) => `${item.file?.fileName}:${item.start}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`).join("\n")}`,
    );
  });

  test("guide validation reports every family and page failure before it fails", () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const checked = Bun.spawnSync({
      cmd: ["node", "build.mjs", "--self-test"],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${new TextDecoder().decode(checked.stdout)}${new TextDecoder().decode(checked.stderr)}`;
    assert(checked.exitCode === 0, `guide validation self-test failed: ${output}`);
    assert(
      output.includes("families.source.json[1]") && output.includes("duplicate code E_ONE")
        && output.includes("guide/oversized.md") && output.includes("guide/stale.md"),
      `guide validator failed fast: ${output}`,
    );
  });

  test("the Node compiler worker rejects TypeScript data exports and serves later direct requests", async () => {
    const packageRoot = resolve(crate, "packages/snapback2");
    const built = Bun.spawnSync({
      cmd: ["node", "build.mjs"], cwd: packageRoot, stdout: "pipe", stderr: "pipe",
    });
    assert(built.exitCode === 0,
      `package build failed: ${new TextDecoder().decode(built.stderr)}`);
    const rootModule = await import(`${pathToFileURL(resolve(packageRoot, "dist/index.mjs")).href}?surface=${Date.now()}`);
    const rootDeclarations = await Bun.file(resolve(packageRoot, "dist/index.d.ts")).text();
    const removedDataNames = ["schema", "table", "t", "rule", "channel", "query", "mutation", "emit", "range",
      "mentionTokens", "words", "deterministicShare", "concat", "max", "min", "divmod", "mergeByIndex", "recurse"];
    assert(removedDataNames.every((name) => !(name in rootModule)),
      `root runtime still exports TypeScript data helpers: ${removedDataNames.filter((name) => name in rootModule)}`);
    assert(removedDataNames.every((name) => !new RegExp(`export (?:function|const|type) ${name}\\b`).test(rootDeclarations)),
      "root declarations still expose the deleted TypeScript data language");
    assert(["effect", "seed", "decimal"].every((name) => typeof rootModule[name] === "function")
      && ["effect", "seed", "decimal"].every((name) => new RegExp(`export function ${name}\\b`).test(rootDeclarations)),
    "root package lost a retained effect, seed, or client decimal helper");
    const bundle = resolve(packageRoot, "dist/compiler.mjs");
    const shipped = await Bun.file(bundle).text();
    const shippedCore = await Bun.file(resolve(packageRoot, "dist/compiler-core.mjs")).text();
    assert(!shipped.includes("Bun."), "shipped compiler contains Bun.*");
    assert(!shippedCore.includes("Bun."), "shipped compiler core contains Bun.*");

    const temporary = await mkdtemp(join(tmpdir(), "snapback2-worker-"));
    try {
      const files: Record<string, string> = {
        "legacy/snapback/schema.ts": `import { schema } from "snapback2"; export default schema({ tables: {} });`,
        "legacy/snapback/legacy.ts": `import { effect, mutation, query, t } from "snapback2";
          export const recordNotified = mutation({ outboxId: t.id(), effect: t.text(100), result: t.json(1000) }, () => null);
          export const allowedEffect = effect({ grants: ["https://api.example.com"], run: async () => null });
          export const lookup = query({}, () => null);
          const removeLegacy = mutation({ id: t.id() }, () => null);
          export { removeLegacy };`,
        "effect/snapback/schema.q": "table records:\n  value: int\n  public\n",
        "effect/snapback/ops.q": "query ping():\n  return null\n",
        "effect/snapback/delivery.ts": `import { effect } from "snapback2";
          export const notify = effect({ grants: ["https://api.example.com"], run: async () => null });`,
      };
      for (const [path, source] of Object.entries(files)) {
        const target = resolve(temporary, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, source);
      }
      const legacyRoot = resolve(temporary, "legacy");
      const effectRoot = resolve(temporary, "effect");
      const quarryRoot = resolve(frontend, "fixtures/quarry-todos");
      const worker = Bun.spawn({
        cmd: ["node", bundle, "--worker"], stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      for (const request of [
        { id: 1, op: "probe", root: legacyRoot },
        { id: 2, op: "compile", root: legacyRoot },
        { id: 3, op: "compile", root: effectRoot },
        { id: 4, op: "compile", root: quarryRoot },
        { id: 5, op: "seed", root: quarryRoot },
        { id: 6, op: "journeys", root: quarryRoot },
        { id: 7, op: "compile", root: "fixtures/quarry-todos" },
      ]) worker.stdin.write(`${JSON.stringify(request)}\n`);
      worker.stdin.end();
      const output = await new Response(worker.stdout).text();
      const stderr = await new Response(worker.stderr).text();
      const status = await worker.exited;
      assert(status === 0, `worker exited nonzero: ${stderr}`);
      const responses = output.trim().split("\n").map((line) => JSON.parse(line));
      assert(responses[0]?.id === 1 && responses[0]?.ok === true
        && responses[0]?.protocol === "snapback2/compiler-worker/v1"
        && JSON.stringify(responses[0]?.operations) === JSON.stringify(["compile", "seed", "journeys"]),
      "worker probe did not prove protocol custody");
      const authored = responses[1]?.diagnostics ?? [];
      assert(responses[1]?.id === 2 && responses[1]?.ok === false && authored.length === 4
        && authored.every((item: any) => item.code === "E_QUARRY_ONLY"),
      `worker did not report the schema and every TypeScript data export: ${JSON.stringify(authored)}`);
      assert(authored.some((item: any) => item.site === "snapback/schema.ts:1:1"
        && item.message === "backends are authored in Quarry; the schema is snapback/schema.q"),
      "worker lost the schema.ts Quarry-only refusal");
      for (const [kind, name] of [["mutation", "recordNotified"], ["query", "lookup"], ["mutation", "removeLegacy"]]) {
        assert(authored.some((item: any) => item.rewrite === `-- move ${kind} ${name} to snapback/legacy.q and preserve every argument type and bound`),
          `worker lost the ${name} migration guidance: ${JSON.stringify(authored)}`);
      }
      assert(!authored.some((item: any) => item.message.includes("allowedEffect")),
        `worker treated the effect export as data authoring: ${JSON.stringify(authored)}`);
      assert(responses[2]?.id === 3 && responses[2]?.ok === true,
        `worker did not admit the effect-only TypeScript module: ${JSON.stringify(responses[2])}`);
      assert(responses[3]?.id === 4 && responses[3]?.ok === true, "worker did not survive for the next direct compile");
      assert(responses[4]?.id === 5 && responses[4]?.ok === true, "worker did not serve seed under Node");
      assert(responses[5]?.id === 6 && responses[5]?.ok === true, "worker did not serve journeys under Node");
      assert(responses[6]?.id === 7 && responses[6]?.ok === false
        && responses[6]?.diagnostics?.[0]?.code === "E_OP_INVALID", "worker admitted a relative project root");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("binary check certifies every compiler program and reads IR only from stdin or --ir", async () => {
    const built = Bun.spawnSync({ cmd: ["cargo", "build", "-p", "snapback2"], cwd: crate, stdout: "pipe", stderr: "pipe" });
    assert(built.exitCode === 0, `cargo build failed: ${new TextDecoder().decode(built.stderr)}`);
    const quarryChat = await lowerProject(`${frontend}fixtures/quarry-chat`);
    assert(quarryChat.ok, "Quarry chat did not compile for binary check");
    const buildDir = `${frontend}fixtures/quarry-chat/.snapback/build`;
    await mkdir(buildDir, { recursive: true });
    const projectPath = `${buildDir}/project.json`;
    await Bun.write(projectPath, JSON.stringify(quarryChat.project));
    const checked = runBinaryCheck(["--json", "--ir", projectPath]);
    const checkedRefusals = checked.results.filter((item: any) => item.error);
    assert(checked.exitCode === 0 && checkedRefusals.length === 0, `Quarry chat compiler output was refused: ${checked.stderr}`);
    assert(checked.results.length === quarryChat.project.programs.length, "project check omitted programs");
    assert(checked.results.every((item: any) => (item.certificate === null) !== (item.error === null)), "project check omitted a certificate/refusal outcome");
    assert(checkedRefusals.every((item: any) => fullCheckEnvelope(item.error)), "checker refusal envelope is incomplete");
    for (const page of ["feeds.q", "messages.q"]) {
      const fixture = await Bun.file(`${frontend}fixtures/quarry-chat/snapback/${page}`).text();
      const template = await Bun.file(`${crate}packages/snapback2/templates/chat/snapback/${page}`).text();
      assert(fixture === template, `Quarry chat ${page} diverged from the shipped template`);
    }
    const quarryChecked = runBinaryCheck(["--json", "--ir"], quarryChat.project);
    const pagePins: Record<string, [number, number]> = {
      "feeds.followingFeed": [55_572, 626_336],
      "feeds.globalFeed": [55_572, 54_260],
      // LLP 1006/1012: media records, including the optional oncePhoto column;
      // LLP 1016 D5: the optional expiresAt deadline (45 bytes a row).
      "messages.thread": [869_462, 869_400],
    };
    for (const [name, [output, closure]] of Object.entries(pagePins)) {
      const result = quarryChecked.results.find((item: any) => item.program === name);
      assert(result?.error === null && result.certificate?.max_output_bytes === output
        && result.certificate.max_closure_bytes === closure,
      `${name} shipped page did not certify at its pinned default bounds: ${JSON.stringify(result)}`);
    }
    const wrongPrincipalAxis = structuredClone(quarryChat.project) as any;
    wrongPrincipalAxis.schema.tables.memberships.columns.principal = "Id";
    const wrongPrincipalCheck = runBinaryCheck(["--json", "--ir"], wrongPrincipalAxis);
    const nominalRefusal = wrongPrincipalCheck.results.find((item: any) =>
      item.error?.code === "E_RULE_INVALID" && item.error.site.includes("schema.tables.memberships"))?.error;
    assert(wrongPrincipalCheck.exitCode === 1, "raw ProjectJson erased the nominal Principal boundary");
    assert(wrongPrincipalCheck.results.every((item: any) => item.certificate === null), "invalid raw ProjectJson still received a certificate");
    assert(nominalRefusal?.family === "rule" && nominalRefusal?.guide === "schema/rules", "raw nominal refusal used the wrong diagnostic family");
    assert(nominalRefusal?.site.includes("schema.tables.memberships"), "raw nominal refusal omitted its precise schema site");
    for (const fixture of ["quarry-todos", "quarry-clique"]) {
      const lowered = await lowerProject(`${frontend}fixtures/${fixture}`);
      assert(lowered.ok, `${fixture} did not compile for binary compatibility`);
      const result = runBinaryCheck(["--json", "--ir"], lowered.project);
      const refusals = result.results.filter((item: any) => item.error);
      assert(result.exitCode === 0 && refusals.length === 0, `${fixture} compiler output had ${refusals.length} binary refusals: ${result.stderr}`);
      assert(result.results.length === lowered.project.programs.length, `${fixture} binary check omitted programs`);
    }
    const collided = runBinaryCheck(["--project", projectPath]);
    assert(collided.exitCode === 2 && collided.stderr.includes("--ir"), "--project still selects the IR-file checker form");

    const unsupportedProgram = runBinaryCheck(["--json", "--ir"], {
      schemaMode: "synthetic",
      programs: [{ name: "future", kind: "Query", args: {}, read_time_granularity_ms: null, body: [{ Future: {} }] }],
    });
    assert(unsupportedProgram.exitCode === 1 && unsupportedProgram.results[0]?.error?.code === "E_CHECK_IR_UNSUPPORTED", "unknown program IR was not a typed refusal with exit 1");
    assert(unsupportedProgram.results[0]?.error?.message.includes("Future") && fullCheckEnvelope(unsupportedProgram.results[0]?.error), "unknown program refusal omitted its variant/envelope");

    const explicit = runBinaryCheck(["--json", "--ir"], {
      schema: {
        tables: { rows: { columns: { id: "Id", values: { Optional: { List: { of: "Int", max: 2 } } } }, indexes: {}, rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" }, constraints: [], retain: "until-revoked" } },
        maintains: [],
        channels: {},
        auth: { password: false, guests: false },
        effects: [],
      },
      programs: [],
      effects: [],
    } as ProjectJson);
    assert([0, 1].includes(explicit.exitCode), `explicit-schema check panicked/exited as usage: ${explicit.exitCode}`);
    if (explicit.exitCode === 1) {
      assert(explicit.results[0]?.error?.code === "E_CHECK_IR_UNSUPPORTED" && fullCheckEnvelope(explicit.results[0]?.error), "unsupported Optional/List schema was not a typed refusal");
      assert(/Optional|List/.test(explicit.results[0]?.error?.message ?? ""), "schema refusal did not name Optional/List");
    }
  });


}

function fullCheckEnvelope(error: any): boolean {
  return typeof error?.code === "string" && typeof error?.family === "string"
    && typeof error?.message === "string" && typeof error?.site === "string"
    && typeof error?.rewrite === "string" && typeof error?.guide === "string";
}

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
