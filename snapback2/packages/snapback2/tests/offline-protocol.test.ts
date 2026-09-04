import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
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
const corpus = resolve(here, "../../../corpus/offline");
const packageRoot = resolve(here, "..");

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
  const root = await mkdtemp(join(tmpdir(), "snapback2-offline-types-"));
  try {
    const sample = join(root, "sample.ts");
    await writeFile(sample, `
      import { decodeDeliveryEnvelope, type DeliveryEnvelopeV1 } from "snapback2";
      import type { QueryReceiptRequest, SubscribeReceiptRequest } from "snapback2/client";
      declare const input: unknown;
      const envelope: DeliveryEnvelopeV1 = decodeDeliveryEnvelope(input);
      const protocol: 1 = envelope.protocol;
      const query: QueryReceiptRequest = { receipt: true };
      const subscribe: SubscribeReceiptRequest = { receipt: true, validator: "opaque" };
      void query;
      void subscribe;
      void protocol;
    `);
    const program = ts.createProgram({
      rootNames: [sample],
      options: {
        baseUrl: root,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        paths: {
          snapback2: [resolve(packageRoot, "dist/index.d.ts")],
          "snapback2/client": [resolve(packageRoot, "dist/client.d.ts")],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.file?.fileName === sample);
    assert.deepEqual(
      diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
