import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import manifest from "../../../corpus/manifest.json";
import { ClientStore } from "./store";
import { Runner, queryState } from "./runner";
import { EvalError } from "./errors";
import { mergeRemainder } from "./merge";
import type { Value } from "./types";

const fixture = (): any => structuredClone(manifest.find((c) => c.name === "merge-runtime-overlap-deduped"));

function recertify(c: any): any {
  const checked = spawnSync(fileURLToPath(new URL("../../../target/debug/snapback2", import.meta.url)),
    ["check", "--ir", "--json"], {
      input: JSON.stringify({ schema: c.schema, programs: [c.program] }), encoding: "utf8",
    });
  assert.equal(checked.status, 0, `${checked.error ?? ""}${checked.stderr}${checked.stdout}`);
  const result = JSON.parse(checked.stdout).results[0];
  assert.equal(result.error, null);
  return result.certificate;
}

{
  // The same forced overlapping lanes as the Rust receipt regression.
  const rows: Value[] = ["a", "b", "c"].map((id) => ({ Row: { id: { Id: id } } }));
  assert.deepEqual(mergeRemainder(rows, [rows[0]!, rows[2]!]), []);
  assert.deepEqual(mergeRemainder(rows, [rows[1]!]), [rows[2]!]);
  assert.deepEqual(mergeRemainder(rows, []), rows);
}

{
  const c = fixture();
  const store = new ClientStore(c.schema, c.receipt);
  assert.throws(() => store.reexecute(c.program, c.context),
    (error: unknown) => error instanceof EvalError && error.code === "E_TRACE_SUBSET"
      && (error.trace?.examined ?? 0) === 0 && error.trace?.ranges.length === 0,
    "a merge needs its certificate before opening any streams");
  c.certificate.read_sites = [];
  assert.throws(() => store.reexecute(c.program, c.context, c.certificate),
    (error: unknown) => error instanceof EvalError && error.code === "E_TRACE_SUBSET",
    "every merge lane must be declared by the certificate");
}
for (const read of ["Deny", { Eq: [{ Field: "at" }, { Literal: { Int: 1 } }] }]) {
  const c = fixture();
  c.schema.tables.posts.rules.read = read;
  for (const lane of c.program.body[0].Return.Merge.lanes) {
    lane.scan.opaque_cursor = true;
    lane.scan.after = { Variable: "c" };
  }
  c.program.args.c = { Optional: "Cursor" };
  c.context.args.c = "Null";
  c.certificate = recertify(c);
  const uniform = read === "Deny";
  // Deny is hoisted even after recertification; the row-dependent rule exposes the bypass gap.
  assert.equal(c.certificate.completeness, uniform ? "Page" : "Capped");
  assert.ok(c.certificate.read_sites.every((site: any) => site.hoist === uniform));
  const context = { ...c.context, viewer: "system", principal_kind: "system" };
  const store = new ClientStore(c.schema, c.receipt);
  const result = new Runner(store, c.schema, context, c.certificate)
    .execute(c.program);
  assert.deepEqual(result.result, c.expected.localResult, "system merge bypasses the table read rule");
  assert.equal(result.trace.rule_probes ?? 0, 0);
  assert.equal(queryState(c.certificate, result.trace, context.viewer), "complete");
  assert.equal(result.next, null);
  assert.equal(queryState(c.certificate, result.trace, c.context.viewer), uniform ? "complete" : "capped",
    "the system completeness bypass does not apply to ordinary viewers");
  const limited = structuredClone(result.trace);
  limited.ranges[0]!.stop = "limit";
  assert.equal(queryState(c.certificate, limited, context.viewer), "capped");
  const truncated = structuredClone(result.trace);
  truncated.merges[0]!.deduplicated_union_len = c.certificate.merge_sites[0].take + 1;
  assert.equal(queryState(c.certificate, truncated, context.viewer), "capped");
}

for (const take of [{ Literal: 20 }, { Arg: { name: "n", max: 20 } }]) {
  const c: any = structuredClone(manifest.find((c) => c.name === "merge-for-lane-domain-limit"));
  c.program.body[0].Return.Merge.lanes[0].scan.take = take;
  if ("Arg" in take) { c.program.args.n = "Int"; c.context.args.n = { Int: 2 }; }
  c.certificate = recertify(c);
  // No discovery rows means no evaluated lane take, even with posts held locally.
  c.receipt.rows = c.receipt.rows.filter((row: any) => row.table !== "follows");
  c.receipt.ranges = [];
  const result = new Runner(new ClientStore(c.schema, c.receipt), c.schema, c.context, c.certificate)
    .execute(c.program);
  assert.deepEqual(result.result, { Array: [] });
  assert.equal(queryState(c.certificate, result.trace, c.context.viewer), "complete");
  assert.equal(result.next, null);
  assert.equal(result.trace.merges[0]!.deduplicated_union_len, 0);
  assert.deepEqual(result.trace.ranges.map((range) => [range.table, range.stop]), [["follows", "exhausted"]]);
  assert.equal(result.trace.examined ?? 0, 0);
}

for (const bound of ["after", "before", "range"]) {
  const c: any = structuredClone(manifest.find((c) => c.name === "merge-for-lane-domain-limit"));
  const lane = c.program.body[0].Return.Merge.lanes[0];
  lane.source.take = { Literal: 2 };
  const at = { Field: { base: { Variable: lane.binding }, name: "at" } };
  const cursor = { Array: [at, { Literal: { Id: "boundary" } }] };
  lane.scan.after = null;
  lane.scan.opaque_cursor = false;
  if (bound === "range") lane.scan.range = { gt: at, gte: null, lt: null, lte: null };
  else lane.scan[bound] = cursor;
  // Equal prefixes, different values of the very same bound expression.
  for (const record of c.receipt.rows.filter((r: any) => r.table === "follows")) record.row.Row.followed = { Id: "u2" };
  const result = new Runner(new ClientStore(c.schema, c.receipt), c.schema, c.context, c.certificate).execute(c.program);
  assert.equal(result.trace.ranges.filter((r) => r.table === "posts").length, 2, `${bound} belongs to the dedup key`);
}

{
  const c: any = manifest.find((c) => c.name === "local-pagination-partial-clears-next");
  const store = new ClientStore(c.schema, c.receipt);
  assert.notEqual(store.reexecute(c.program, c.context, c.certificate).execution.next, null);
  for (const step of c.prelude) assert.equal(store.applyMutation(step.program, step.context).state, "predicted");
  assert.notEqual(new Runner(store, c.schema, c.context, c.certificate).execute(c.program).next, null,
    "the raw replay still has a cursor; local coverage must clear it");
  const replay = store.reexecute(c.program, c.context, c.certificate);
  assert.equal(replay.state, "partial");
  assert.equal(replay.execution.next, null);
}
