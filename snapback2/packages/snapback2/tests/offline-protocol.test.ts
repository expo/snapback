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
  encodeDeliveryEnvelope,
  expandRows,
  toClosureReceipt,
} from "../dist/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "../../../corpus/offline");
const packageRoot = resolve(here, "..");

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

test("offline envelope goldens round-trip byte-identically and rebuild ClosureReceipt", async () => {
  const files = (await readdir(corpus)).filter((name) => name.startsWith("envelope-")).sort();
  assert.deepEqual(files, [
    "envelope-capped-page-next.json",
    "envelope-denied-query.json",
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
    assert.equal(canonical(toClosureReceipt(envelope, companion.schema)), canonical(companion.receipt), file);
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
      declare const input: unknown;
      const envelope: DeliveryEnvelopeV1 = decodeDeliveryEnvelope(input);
      const protocol: 1 = envelope.protocol;
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
        paths: { snapback2: [resolve(packageRoot, "dist/index.d.ts")] },
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
