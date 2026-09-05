import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assessGauntlet } from "./gauntlet";
import type { ProjectJson } from "./ir";
import { lowerProject as lowerAuthoredProject } from "./project";
import ts from "typescript";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
const repo = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);

type RegisterTest = (name: string, run: () => void | Promise<void>) => void;
const lowerProject = (root: string) => lowerAuthoredProject(root, { authoring: "any" });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function registerFinalGateChecks(test: RegisterTest, legacyLib: string): void {
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

  test("binary check certifies every compiler program and reads IR only from stdin or --ir", async () => {
    const built = Bun.spawnSync({ cmd: ["cargo", "build", "-p", "snapback2"], cwd: crate, stdout: "pipe", stderr: "pipe" });
    assert(built.exitCode === 0, `cargo build failed: ${new TextDecoder().decode(built.stderr)}`);
    const chat = await lowerProject(`${frontend}fixtures/chat`);
    assert(chat.ok, "chat did not compile for binary check");
    const buildDir = `${frontend}fixtures/chat/.snapback/build`;
    await mkdir(buildDir, { recursive: true });
    const projectPath = `${buildDir}/project.json`;
    await Bun.write(projectPath, JSON.stringify(chat.project));
    const checked = runBinaryCheck(["--json", "--ir", projectPath]);
    const checkedRefusals = checked.results.filter((item: any) => item.error);
    assert(checked.exitCode === 0 && checkedRefusals.length === 0, `chat compiler output was refused: ${checked.stderr}`);
    assert(checked.results.length === chat.project.programs.length, "project check omitted programs");
    assert(checked.results.every((item: any) => (item.certificate === null) !== (item.error === null)), "project check omitted a certificate/refusal outcome");
    assert(checkedRefusals.every((item: any) => fullCheckEnvelope(item.error)), "checker refusal envelope is incomplete");
    const quarryChat = await lowerProject(`${frontend}fixtures/quarry-chat`);
    assert(quarryChat.ok, "Quarry chat did not compile for binary check");
    for (const page of ["feeds.q", "messages.q"]) {
      const fixture = await Bun.file(`${frontend}fixtures/quarry-chat/snapback/${page}`).text();
      const template = await Bun.file(`${crate}packages/snapback2/templates/chat/snapback/${page}`).text();
      assert(fixture === template, `Quarry chat ${page} diverged from the shipped template`);
    }
    const quarryChecked = runBinaryCheck(["--json", "--ir"], quarryChat.project);
    const pagePins: Record<string, [number, number]> = {
      "feeds.followingFeed": [55_072, 2_715_380],
      "feeds.globalFeed": [55_072, 54_260],
      // LLP 1006/1012: media records plus the optional viewOnce policy bit;
      // LLP 1016 D5: the optional expiresAt deadline (45 bytes a row).
      "messages.thread": [858_062, 858_000],
    };
    for (const [name, [output, closure]] of Object.entries(pagePins)) {
      const result = quarryChecked.results.find((item: any) => item.program === name);
      assert(result?.error === null && result.certificate?.max_output_bytes === output
        && result.certificate.max_closure_bytes === closure,
      `${name} shipped page did not certify at its pinned default bounds: ${JSON.stringify(result)}`);
    }
    const wrongPrincipalAxis = structuredClone(chat.project) as any;
    wrongPrincipalAxis.schema.tables.memberships.columns.principal = "Id";
    const wrongPrincipalCheck = runBinaryCheck(["--json", "--ir"], wrongPrincipalAxis);
    const nominalRefusal = wrongPrincipalCheck.results.find((item: any) =>
      item.error?.code === "E_RULE_INVALID" && item.error.site.includes("schema.tables.memberships"))?.error;
    assert(wrongPrincipalCheck.exitCode === 1, "raw ProjectJson erased the nominal Principal boundary");
    assert(wrongPrincipalCheck.results.every((item: any) => item.certificate === null), "invalid raw ProjectJson still received a certificate");
    assert(nominalRefusal?.family === "rule" && nominalRefusal?.guide === "schema/rules", "raw nominal refusal used the wrong diagnostic family");
    assert(nominalRefusal?.site.includes("schema.tables.memberships"), "raw nominal refusal omitted its precise schema site");
    for (const fixture of ["todos", "s1"]) {
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
