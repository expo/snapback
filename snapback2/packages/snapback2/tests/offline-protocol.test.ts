import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkPublishedDeclarations } from "./published-declaration-consumer.ts";
import {
  DeliveryEnvelopeDecodeError,
  decodeDeliveryEnvelope,
  decodeDeliveryMessage,
  deliveryRangeExtent,
  encodeDeliveryEnvelope,
  expandRows,
  toClosureReceipt,
} from "../dist/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = process.env.SNAPBACK2_CORPUS ? resolve(process.env.SNAPBACK2_CORPUS, 'offline') : resolve(here, "../../../corpus/offline");

test("offline envelope goldens round-trip byte-identically and rebuild ClosureReceipt", async () => {
  const files = (await readdir(corpus)).filter((name) => name.startsWith("envelope-")).sort();
  assert.deepEqual(files, [
    "envelope-application-row-reference-json.json",
    "envelope-capped-page-next.json",
    "envelope-denied-query.json",
    "envelope-engine-hidden-point-alternate-key.json",
    "envelope-engine-non-uniform-range.json",
    "envelope-engine-point-miss-alternate-key.json",
    "envelope-engine-point-miss-by-id.json",
    "envelope-engine-uniform-range-exhausted.json",
    "envelope-engine-uniform-range-halo.json",
    "envelope-every-column-kind.json",
    "envelope-hidden-point-alternate-key.json",
    "envelope-non-uniform-range.json",
    "envelope-point-hit.json",
    "envelope-point-miss-by-id.json",
    "envelope-uniform-range-halo.json",
  ]);
  for (const file of files) {
    const raw = await readFile(resolve(corpus, file), "utf8");
    const parsed = JSON.parse(raw);
    const envelope = decodeDeliveryEnvelope(parsed);
    assert.equal(`${encodeDeliveryEnvelope(envelope)}\n`, raw, file);
    const reordered = structuredClone(parsed);
    reordered.rows.reverse();
    assert.equal(
      `${encodeDeliveryEnvelope(Object.fromEntries(Object.entries(reordered).reverse()) as typeof envelope)}\n`,
      raw,
      `${file} canonical property order`,
    );
    const companion = JSON.parse(await readFile(resolve(corpus, file.replace("envelope-", "closure-")), "utf8"));
    assert.equal(
      JSON.stringify(toClosureReceipt(envelope, companion.schema)),
      companion.receiptBytes,
      `${file} ClosureReceipt bytes`,
    );
  }
});

test("offline envelope decoder refuses unknown protocols and malformed shapes", async () => {
  const fixture = JSON.parse(await readFile(resolve(corpus, "envelope-point-hit.json"), "utf8"));
  assert.throws(
    () => decodeDeliveryEnvelope({ ...fixture, protocol: 2 }),
    (error: unknown) => error instanceof DeliveryEnvelopeDecodeError && error.path === "$.protocol",
  );
  assert.throws(
    () => decodeDeliveryEnvelope({ ...fixture, surprise: true }),
    (error: unknown) => error instanceof DeliveryEnvelopeDecodeError && error.path === "$.surprise",
  );
  assert.throws(
    () => decodeDeliveryEnvelope({ ...fixture, data: { $row: { table: "messages" } } }),
    (error: unknown) => error instanceof DeliveryEnvelopeDecodeError && error.path === "$.data",
  );
  const decodeError = new DeliveryEnvelopeDecodeError("$", "bad envelope");
  assert.equal("code" in decodeError, false, "decode TypeErrors are not runtime diagnostics");
});

test("all-column-kind golden tags closed asset records by their declared field types", async () => {
  const fixture = JSON.parse(await readFile(resolve(corpus, "envelope-every-column-kind.json"), "utf8"));
  const companion = JSON.parse(await readFile(resolve(corpus, "closure-every-column-kind.json"), "utf8"));
  const wrongWidth = structuredClone(fixture);
  wrongWidth.rows[0].row.image.width = "wide";
  assert.throws(
    () => toClosureReceipt(decodeDeliveryEnvelope(wrongWidth), companion.schema),
    (error: unknown) => error instanceof DeliveryEnvelopeDecodeError
      && error.path === "rows.allTypes.image.width",
  );
  const undeclared = structuredClone(fixture);
  undeclared.rows[0].row.video.caption = "clip";
  assert.throws(
    () => toClosureReceipt(decodeDeliveryEnvelope(undeclared), companion.schema),
    (error: unknown) => error instanceof DeliveryEnvelopeDecodeError
      && error.path === "rows.allTypes.video",
  );
});

test("offline delivery decoder accepts the conditional unchanged marker", () => {
  const validator = "a".repeat(64);
  assert.deepEqual(decodeDeliveryMessage({ state: "unchanged", seq: 19, validator }), {
    state: "unchanged", seq: 19, validator,
  });
});

test("offline decoder enforces range, authority, and schema coherence", async () => {
  const ranged = JSON.parse(await readFile(resolve(corpus, "envelope-capped-page-next.json"), "utf8"));
  ranged.receipt.ranges[0].rowIds.push(ranged.receipt.ranges[0].rowIds[0]);
  assert.throws(() => decodeDeliveryEnvelope(ranged), (error: unknown) =>
    error instanceof DeliveryEnvelopeDecodeError && error.path.endsWith("rowIds[1]"));

  const wrongTable = JSON.parse(await readFile(resolve(corpus, "envelope-capped-page-next.json"), "utf8"));
  const id = wrongTable.receipt.ranges[0].rowIds[0];
  wrongTable.rows = wrongTable.rows.map((row: any) => row.id === id ? { ...row, table: "elsewhere" } : row);
  assert.throws(() => decodeDeliveryEnvelope(wrongTable), (error: unknown) =>
    error instanceof DeliveryEnvelopeDecodeError && error.path.endsWith("rowIds[0]"));

  const denied = JSON.parse(await readFile(resolve(corpus, "envelope-denied-query.json"), "utf8"));
  denied.receipt.verdicts[0].principal = "someone-else";
  assert.throws(() => decodeDeliveryEnvelope(denied), (error: unknown) =>
    error instanceof DeliveryEnvelopeDecodeError && error.path.endsWith("principal"));
  const deniedEpoch = JSON.parse(await readFile(resolve(corpus, "envelope-denied-query.json"), "utf8"));
  deniedEpoch.receipt.verdicts[0].authEpoch += 1;
  assert.throws(() => decodeDeliveryEnvelope(deniedEpoch), (error: unknown) =>
    error instanceof DeliveryEnvelopeDecodeError && error.path.endsWith("authEpoch"));

  const envelope = decodeDeliveryEnvelope(JSON.parse(
    await readFile(resolve(corpus, "envelope-point-hit.json"), "utf8"),
  ));
  const companion = JSON.parse(await readFile(resolve(corpus, "closure-point-hit.json"), "utf8"));
  companion.schema.tables.messages.columns.extra = "Int";
  assert.throws(() => toClosureReceipt(envelope, companion.schema), (error: unknown) =>
    error instanceof DeliveryEnvelopeDecodeError && error.path === "schema");
});

test("Limit range extent is derived from pooled rows and the generation schema", async () => {
  const envelope = decodeDeliveryEnvelope(JSON.parse(
    await readFile(resolve(corpus, "envelope-capped-page-next.json"), "utf8"),
  ));
  const companion = JSON.parse(await readFile(resolve(corpus, "closure-capped-page-next.json"), "utf8"));
  const extent = deliveryRangeExtent(envelope, companion.schema, envelope.receipt.ranges[0]!);
  assert.equal(extent.stop, "Limit");
  if (extent.stop !== "Limit") throw new Error("expected Limit extent");
  const returned = envelope.rows.find((row) => row.id === envelope.receipt.ranges[0]!.rowIds[0])!;
  assert.deepEqual(extent.firstKey, [returned.row.conversationId, returned.row.at, returned.row.id]);
  assert.deepEqual(extent.lastKey, extent.firstKey);
  assert.deepEqual(extent.presentIds, [
    ...envelope.receipt.ranges[0]!.rowIds,
    envelope.receipt.ranges[0]!.haloId,
  ]);
});

test("application JSON shaped like a row reference round-trips unchanged", async () => {
  const envelope = decodeDeliveryEnvelope(JSON.parse(
    await readFile(resolve(corpus, "envelope-application-row-reference-json.json"), "utf8"),
  ));
  assert.deepEqual(expandRows(envelope), { $row: { id: "literal", table: "application" } });
});

test("expandRows restores pooled wire rows", async () => {
  const fixture = decodeDeliveryEnvelope(JSON.parse(
    await readFile(resolve(corpus, "envelope-point-hit.json"), "utf8"),
  ));
  assert.deepEqual(expandRows(fixture), fixture.rows[0]!.row);
});

test("offline protocol values and types are exported from the package index", async () => {
  await checkPublishedDeclarations("public");
});

test("standalone offline protocol declarations preserve exported classes and functions", async () => {
  await checkPublishedDeclarations("standalone");
});

/** Sorted-key, whitespace-free JSON: the canonical form the Rust digest hashes. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("verdict inputs digest is sha256(canonical([table, index, key])) over wire values and matches the Rust goldens", async () => {
  const files = (await readdir(corpus)).filter((name) => name.startsWith("envelope-")).sort();
  let checked = 0;
  for (const file of files) {
    const envelope = decodeDeliveryEnvelope(JSON.parse(await readFile(resolve(corpus, file), "utf8")));
    const companion = JSON.parse(await readFile(resolve(corpus, file.replace("envelope-", "closure-")), "utf8"));
    const inputs: Array<{ ruleHash: string; table: string; index: string; key: unknown[] }> = companion.verdictInputs ?? [];
    assert.equal(inputs.length, envelope.receipt.verdicts.length, `${file} carries the inputs of every verdict`);
    for (const [index, verdict] of envelope.receipt.verdicts.entries()) {
      const input = inputs[index]!;
      assert.equal(verdict.ruleHash, input.ruleHash, `${file} verdict ${index} rule`);
      const digest = createHash("sha256")
        .update(canonical([input.table, input.index, input.key]))
        .digest("hex");
      assert.equal(verdict.pinnedInputsDigest, digest, `${file} verdict ${index} inputs digest`);
      assert.match(digest, /^[0-9a-f]{64}$/);
      checked += 1;
    }
  }
  assert.ok(checked >= 1, "at least one golden carries a verdict");
});
