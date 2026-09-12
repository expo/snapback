import { CertifiedTestStore as ClientStore } from "./quarry-check-helpers";
import { deepStrictEqual } from "node:assert";
import { type Context, type Value } from "../../evaluator/src/evaluator";
import type { ArgType } from "./ir";
import { rustCheck } from "./rust-check";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { bindQuarryProgram } from "./quarry/bound";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry } from "./quarry/index";
import { assert, type Test } from "./quarry-check-helpers";

export function registerQuarryDirectArgumentChecks(test: Test): void {
  test("direct Quarry preserves recursive text refinements and refuses them before the body", () => {
    const prepared = prepareQuarry([
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: "table rows:\n  public\n" },
      { path: "/virtual/snapback/formats.q", fileName: "snapback/formats.q", source: `mutation formats(
  handle: text 1..20 format handle,
  link: text <=2048 format url ?,
  items: [text <=20 format handle] <=2,
  optionalItems: [text 0..20 format handle] <=2 ?,
  nested: [[text 8..2048 format url] <=3] <=2 ?
):
  require false else BODY_EXECUTED
  return null
` },
    ]);
    assert(prepared.ok, `direct recursive argument fixture did not prepare: ${JSON.stringify(
      prepared.ok ? [] : prepared.diagnostics)}`);
    const document = prepared.prepared.documents.find((item) => item.file === "snapback/formats.q")!;
    const bound = bindQuarryProgram(document.programs[0]!, prepared.prepared.catalog, prepared.prepared.documents);
    const direct = lowerBoundQuarryProgram(bound);
    const expected: Record<string, ArgType> = {
      handle: { Text: { max: 20, min: 1, format: "handle" } },
      link: { Optional: { Text: { max: 2048, format: "url" } } },
      items: { List: { of: { Text: { max: 20, format: "handle" } }, max: 2 } },
      optionalItems: { Optional: { List: { of: { Text: { max: 20, format: "handle" } }, max: 2 } } },
      nested: { Optional: { List: { of: { List: {
        of: { Text: { max: 2048, min: 8, format: "url" } }, max: 3,
      } }, max: 2 } } },
    };
    deepStrictEqual(direct.args, expected);
    const schema = bindQuarrySchema(prepared.prepared.documents, prepared.prepared.catalog);
    const checked = rustCheck([direct], "synthetic", schema)[0]!;
    assert(!checked.error && checked.certificate,
      `direct recursive argument program did not certify: ${JSON.stringify(checked)}`);
    const context = (args: Record<string, Value>): Context => ({
      viewer: "viewer", principal_kind: "user", auth_epoch: 1,
      args, now: 1, read_time: 1, new_ids: [],
    });
    const valid: Record<string, Value> = {
      handle: { String: "valid_09" }, link: "Null",
      items: { Array: [{ String: "ok" }, { String: "" }] }, optionalItems: "Null",
      nested: { Array: [{ Array: [{ String: "https://example.com" }] }] },
    };
    const run = (args: Record<string, Value>) => new ClientStore(schema)
      .applyMutation(direct, context(args));
    const refusal = (args: Record<string, Value>) => {
      try { run(args); } catch (error) {
        const failure = error as { code?: string; authoredCode?: string };
        return failure.authoredCode ?? failure.code;
      }
      return undefined;
    };
    assert(refusal(valid) === "BODY_EXECUTED", "valid recursive refinements did not reach the mutation body");
    const invalid: Array<[string, Record<string, Value>, string]> = [
      ["handle minimum", { ...valid, handle: { String: "" } }, "E_INPUT"],
      ["handle format", { ...valid, handle: { String: "BAD" } }, "E_INPUT"],
      ["nested format", { ...valid, nested: { Array: [{ Array: [{ String: "not-a-url" }] }] } }, "E_INPUT"],
      ["nested maximum", { ...valid, nested: { Array: [{ Array: [
        { String: "https://a" }, { String: "https://b" }, { String: "https://c" }, { String: "https://d" },
      ] }] } }, "E_FANOUT"],
    ];
    for (const [label, args, code] of invalid) assert(refusal(args) === code,
      `${label} did not refuse before the body with ${code}`);
  });
}
