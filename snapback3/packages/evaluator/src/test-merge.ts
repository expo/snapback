import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const manifest = JSON.parse(readFileSync(process.env.SNAPBACK3_CORPUS ? resolve(process.env.SNAPBACK3_CORPUS, "manifest.json") : new URL("../../../corpus/manifest.json", import.meta.url), "utf8"));
import { ClientStore } from './store';
import { Runner, queryState } from "./runner";
import { EvalError } from "./errors";
import { mergeRemainder } from "./merge";
import type { Value } from "./types";
import { decodeCursor } from "./cursor";

const fixture = (): any => structuredClone(manifest.find((c) => c.name === "merge-runtime-overlap-deduped"));

function recertify(c: any): any {
  const checked = spawnSync(process.env.SNAPBACK3_BIN ?? fileURLToPath(new URL("../../../target/debug/snapback3", import.meta.url)),
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
  c.certificate = recertify(c);
  // Equal prefixes, different values of the very same bound expression.
  for (const record of c.receipt.rows.filter((r: any) => r.table === "follows")) record.row.Row.followed = { Id: "u2" };
  const result = new Runner(new ClientStore(c.schema, c.receipt), c.schema, c.context, c.certificate).execute(c.program);
  assert.equal(result.trace.ranges.filter((r) => r.table === "posts").length, 2, `${bound} belongs to the dedup key`);
}

{
  const c: any = manifest.find((c) => c.name === "local-pagination-partial-clears-next");
  const store = new ClientStore(c.schema, c.receipt);
  assert.notEqual(store.reexecute(c.program, c.context, c.certificate).execution.next, null);
  for (const step of c.prelude) assert.equal(store.applyMutation(step.program, step.context, false, step.certificate).state, "predicted");
  assert.notEqual(new Runner(store, c.schema, c.context, c.certificate).execute(c.program).next, null,
    "the raw replay still has a cursor; local coverage must clear it");
  const replay = store.reexecute(c.program, c.context, c.certificate);
  assert.equal(replay.state, "partial");
  assert.equal(replay.execution.next, null);
}

for (const read of ["Get", "Exists"]) {
  const c = fixture();
  c.schema.tables.posts.indexes.byUniqueAt = { components: [{ Column: "at" }], unique: true };
  const scan = {
    site: "page", table: "posts", index: "byAuthorAt", prefix: [{ Scalar: { Variable: "who" } }],
    order: "Asc", take: { Literal: 2 }, after: { Variable: "c" }, before: null, range: null,
    opaque_cursor: true, merge_site: null, provenance: "Shape",
  };
  const nested = structuredClone(scan);
  c.program = {
    name: "nested-auxiliary", kind: "Query", read_time_granularity_ms: null,
    args: { a: "Principal", b: "Principal", c: { Optional: "Cursor" } },
    body: [
      { Let: { name: "who", value: { Variable: "a" } } },
      { Const: { name: "returned", value: { Scan: scan } } },
      { Assign: { name: "who", value: { Variable: "b" } } },
      { Const: { name: "auxiliary", value: { [read]: {
        site: "point", table: "posts", index: "byUniqueAt", provenance: "Computed",
        key: [{ Builtin: { builtin: "Len", args: [{ Scan: nested }] } }],
      } } } },
      { Return: { Variable: "returned" } },
    ],
  };
  c.context.args = { a: { Id: "A" }, b: { Id: "B" }, c: "Null" };
  c.receipt.rows = ["A", "B"].flatMap((author) => [1, 2, 3].map((n) => ({
    table: "posts", id: `${author}${n}`, row: { Row: {
      id: { Id: `${author}${n}` }, author: { Id: author }, at: { Int: n + (author === "A" ? 0 : 99) },
    } },
  })));
  c.receipt.ranges = []; // These replacement rows are fixture custody, not the predecessor page's membership proof.
  const checked = spawnSync(process.env.SNAPBACK3_BIN ?? fileURLToPath(new URL("../../../target/debug/snapback3", import.meta.url)),
    ["check", "--ir", "--json"], {
      input: JSON.stringify({ schema: c.schema, programs: [c.program] }), encoding: "utf8",
    });
  const diagnostics = JSON.parse(checked.stdout).results;
  // On the broken certifier, show the actual twin continuation selected by the duplicate.
  if (checked.status === 0) {
    const result = new Runner(new ClientStore(c.schema, c.receipt), c.schema, c.context,
      diagnostics[0].certificate).execute(c.program);
    assert.fail(`${read}: duplicate site certified; returned ${JSON.stringify(result.result)}, cursor ${JSON.stringify(decodeCursor(result.next!).values)}`);
  }
  assert.ok(diagnostics.some((result: any) => result.error?.code === "E_TRACE_SUBSET"
    && result.error.message.includes("result-page site page")), checked.stdout);

  // Distinct nested reads retain the actual page, including across another operation/site.
  nested.site = "nested";
  c.certificate = recertify(c);
  const store = new ClientStore(c.schema, c.receipt);
  const first = new Runner(store, c.schema, c.context, c.certificate).execute(c.program);
  assert.deepEqual((first.result as any).Array.map((row: any) => row.Row.id.Id), ["A1", "A2"]);
  assert.deepEqual(decodeCursor(first.next!).values, [{ Int: 2 }, { Id: "A2" }]);
  c.program.name = "other-operation";
  scan.site = "other-page";
  c.context.args.c = { String: first.next };
  c.certificate = recertify(c);
  const second = new Runner(store, c.schema, c.context, c.certificate).execute(c.program);
  assert.deepEqual((second.result as any).Array.map((row: any) => row.Row.id.Id), ["A3"]);
  assert.deepEqual(decodeCursor(second.next!).values, [{ Int: 3 }, { Id: "A3" }]);
  c.context.args.c = { String: second.next };
  const terminal = new Runner(store, c.schema, c.context, c.certificate).execute(c.program);
  assert.deepEqual(terminal.result, { Array: [] });
  assert.equal(terminal.next, null);
}
