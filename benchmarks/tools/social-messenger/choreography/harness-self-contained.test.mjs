import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// A lane copies this directory out of the packet, so its validator dependency
// must travel with it. Four builders across the agent-ergonomics programme each
// resolved the former `../../lib/json-schema.mjs` differently and a fifth attempt
// aborted with no score; see issues/20260916-clique-harness-not-self-contained.md.
// This file deliberately imports nothing but Node built-ins, so it runs inside a
// copied harness that has installed no dependencies.
test("the copied harness carries its own validator", async () => {
  const { validateJsonSchema } = await import("./lib/json-schema.mjs");
  assert.equal(typeof validateJsonSchema, "function");
  const schema = { $id: "https://snapback.test/harness-self-contained.json", type: "object", required: ["a"], properties: { a: { type: "integer" } } };
  assert.deepEqual(validateJsonSchema(schema, { a: 1 }), []);
  assert.ok(validateJsonSchema(schema, { a: "no" }).length > 0);
});

test("that validator is byte-identical to the tools-wide original", async () => {
  const here = new URL("./lib/json-schema.mjs", import.meta.url);
  const original = new URL("../../lib/json-schema.mjs", import.meta.url);
  assert.equal(await readFile(here, "utf8"), await readFile(original, "utf8"));
});

// The 0.2.28 calibration found two more sibling dependencies of the same class as
// the validator: the harness imported `../metering/observations.mjs`, and its
// default fixtures directory resolved three levels above the copied directory.
// A copied harness must carry what it imports, so assert every relative import in
// this directory stays inside it.
test("no file in the copied harness imports above its own directory", async () => {
  const dir = new URL("./", import.meta.url);
  const names = (await readdir(dir)).filter(n => n.endsWith(".mjs"));
  const escaping = [];
  for (const name of names) {
    const text = await readFile(new URL(name, dir), "utf8");
    for (const m of text.matchAll(/from\s+"(\.\.\/[^"]+)"/g)) escaping.push(`${name}: ${m[1]}`);
  }
  assert.deepEqual(escaping, [], `a copied harness cannot resolve these:\n${escaping.join("\n")}`);
});

test("the copied harness carries its metering module", async () => {
  const { ObservationWriter } = await import("./metering/observations.mjs");
  assert.equal(typeof ObservationWriter, "function");
  assert.equal(
    await readFile(new URL("./metering/observations.mjs", import.meta.url), "utf8"),
    await readFile(new URL("../metering/observations.mjs", import.meta.url), "utf8"),
  );
});
