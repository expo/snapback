import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @ref LLP 0317.000#wave-1--diagnosis-reproductions-parallel-no-product-change
// — L3 must retain a runnable published-0.1.29 harness even when the proposed
// declaration repair is already present.
const root = fileURLToPath(new URL(".", import.meta.url));
const codegenPackage = JSON.parse(readFileSync(join(
  root,
  "node_modules/@expo/snapback-codegen/package.json",
), "utf8"));
assert.equal(codegenPackage.version, "0.1.29");
assert.equal(codegenPackage.dependencies.typescript, "5.9.3");

function run(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8" });
}

const generate = run(process.execPath, [
  "node_modules/@expo/snapback-codegen/index.mjs",
  "snapback",
]);
assert.equal(generate.status, 0, `${generate.stdout}\n${generate.stderr}`);

const tsc = join(root, "node_modules/.bin/tsc");
const trace = run(tsc, [
  "--project",
  "tsconfig.clean.json",
  "--traceResolution",
]);
assert.equal(trace.status, 0, `${trace.stdout}\n${trace.stderr}`);
assert.match(
  `${trace.stdout}\n${trace.stderr}`,
  /node_modules\/@expo\/snapback-codegen\/ctx\.d\.mts/u,
  "generated API must resolve ctx through the published 0.1.29 declaration",
);

const expectedFailures = [
  ["tsconfig.control-flow-bad.json", /control-flow-bad\.ts.*TS18047/u, 2],
  ["tsconfig.helper-wrapper-bad.json", /helper-wrapper-bad\.ts.*TS18047/u, 1],
  [
    "tsconfig.helper-wrapper-inferred-expression.json",
    /helper-wrapper-inferred-expression\.ts.*TS18047/u,
    1,
  ],
];

for (let runNumber = 1; runNumber <= 10; runNumber += 1) {
  const clean = run(tsc, ["--project", "tsconfig.clean.json"]);
  assert.equal(
    clean.status,
    0,
    `clean candidate matrix failed on run ${runNumber}\n${clean.stdout}\n${clean.stderr}`,
  );
  for (const [project, diagnostic, expectedCount] of expectedFailures) {
    const failed = run(tsc, ["--project", project, "--pretty", "false"]);
    assert.notEqual(failed.status, 0, `${project} unexpectedly narrowed on run ${runNumber}`);
    const output = `${failed.stdout}\n${failed.stderr}`;
    assert.match(output, diagnostic);
    const errorLines = output.split("\n").filter((line) => line.includes(": error TS"));
    assert.equal(errorLines.length, expectedCount, `${project}: ${output}`);
    assert(errorLines.every((line) => line.includes("error TS18047")), output);
  }
}

console.log("published package: @expo/snapback-codegen@0.1.29");
console.log("generated ctx resolution: node_modules/@expo/snapback-codegen/ctx.d.mts");
console.log("explicit-context / explicit-return / value-position / annotated-wrapper matrix: 10/10 clean");
console.log("contextually typed direct ctx.refuse call: TS18047 reproduced 10/10");
console.log("unannotated declaration and inferred-expression wrappers: TS18047 reproduced 10/10");
