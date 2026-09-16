import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
