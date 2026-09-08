import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export type ConsumerKind = "public" | "standalone";
export const consumerConfig = {
  compilerOptions: {
    lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler",
    noEmit: true, skipLibCheck: false, strict: true, target: "ES2022", types: [],
  },
  files: ["consumer.ts"],
};

// The standalone leaf is internal to the package, not an exported subpath.
// Public imports use package.json exports; the preservation check uses its real file.
export function consumerSource(kind: ConsumerKind): string {
  const module = kind === "public" ? "snapback2" : "./node_modules/snapback2/dist/offline-protocol.js";
  return `
import * as offline from ${JSON.stringify(module)};
const envelope = offline.decodeDeliveryEnvelope({});
const protocol: 1 = envelope.protocol;
const sequence = envelope.seq;
const sequenceNumber: number = sequence;
const verdict = envelope.receipt.verdicts[0]!.result;
const verdictBoolean: boolean = verdict;
const encoded = offline.encodeDeliveryEnvelope(envelope);
const encodedString: string = encoded;
const error = new offline.DeliveryEnvelopeDecodeError("$", "invalid");
const typeError: TypeError = error;
const path = error.path;
const pathString: string = path;
const message: offline.DeliveryMessage = offline.decodeDeliveryMessage({});
const data: offline.WireValue = offline.expandRows(envelope);
const closure: offline.EvaluatorClosureReceipt = offline.toClosureReceipt(envelope, {});
const extent: offline.DeliveryRangeExtent = offline.deliveryRangeExtent(envelope, {}, envelope.receipt.ranges[0]!);
// @ts-expect-error a decoded verdict is boolean, not number (also rejects error-any)
const wrongVerdict: number = verdict;
// @ts-expect-error a decoded sequence is number, not boolean
const wrongSequence: boolean = sequence;
// @ts-expect-error an encoded envelope is string, not number
const wrongEncoding: number = encoded;
// @ts-expect-error the generated class path is string, not number
const wrongPath: number = path;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const envelopeNotAny: IsAny<typeof envelope> = false;
const verdictNotAny: IsAny<typeof verdict> = false;
const pathNotAny: IsAny<typeof path> = false;
// @ts-expect-error IsAny must itself resolve precisely, not become error-any
const wrongIsAny: IsAny<typeof verdict> = true;
${kind === "public" ? `
import type * as standalone from "./node_modules/snapback2/dist/offline-protocol.js";
type ProtocolExports = Pick<typeof standalone,
  "DeliveryEnvelopeDecodeError" | "decodeDeliveryEnvelope" | "decodeDeliveryMessage" |
  "encodeDeliveryEnvelope" | "expandRows" | "toClosureReceipt" | "deliveryRangeExtent">;
const rootAsStandalone: ProtocolExports = offline;
const standaloneAsRoot: Pick<typeof offline, keyof ProtocolExports> = rootAsStandalone;
const standaloneEnvelope: standalone.DeliveryEnvelopeV1 = envelope;
const rootEnvelope: offline.DeliveryEnvelopeV1 = standaloneEnvelope;
import type { QueryReceiptRequest, SubscribeReceiptRequest } from "snapback2/client";
import { journey } from "snapback2/test";
const query: QueryReceiptRequest = { receipt: true };
const subscribe: SubscribeReceiptRequest = { receipt: true, validator: "opaque" };
journey("image custody", ({ as }) => {
  as("alice", { store: "file" });
  // @ts-expect-error schema custody replaced the client option
  as("alice", { viewOnce: () => true });
});
` : ""}`;
}

// The optional observer lets a focused run retain the same Program's evidence.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — check the actual built declarations, including libraries.
export async function checkPublishedDeclarations(
  kind: ConsumerKind,
  options: {
    packageRoot?: string;
    observe?: (program: ts.Program, diagnostics: readonly ts.Diagnostic[]) => void;
  } = {},
): Promise<void> {
  const builtPackage = options.packageRoot ?? packageRoot;
  const root = await mkdtemp(join(tmpdir(), `snapback2-offline-${kind}-types-`));
  try {
    await mkdir(join(root, "node_modules"));
    await symlink(builtPackage, join(root, "node_modules/snapback2"), "dir");
    const sample = join(root, "consumer.ts");
    const configPath = join(root, "tsconfig.json");
    await writeFile(sample, consumerSource(kind));
    await writeFile(configPath, JSON.stringify(consumerConfig, null, 2) + "\n");
    const parsed = ts.parseJsonConfigFileContent(consumerConfig, ts.sys, root, undefined, configPath);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.fileNames, [sample]);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    options.observe?.(program, diagnostics);
    assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => "\n",
    }));
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(sample)!;
    const expected = new Map([
      ["protocol", "1"], ["sequence", "number"], ["verdict", "boolean"],
      ["encoded", "string"], ["path", "string"],
      ["envelopeNotAny", "false"], ["verdictNotAny", "false"], ["pathNotAny", "false"],
    ]);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(source);
        if (!expected.has(name)) continue;
        const type = checker.getTypeAtLocation(declaration.name);
        assert.equal(type.flags & ts.TypeFlags.Any, 0, `${name} must not be any or error-any`);
        assert.equal(checker.typeToString(type), expected.get(name), name);
        expected.delete(name);
      }
    }
    assert.equal(expected.size, 0, "every precise-type control was inspected");
    if (kind === "standalone") {
      const file = resolve(builtPackage, "dist/offline-protocol.d.ts");
      const standalone = program.getSourceFiles().find((source) =>
        (ts.sys.realpath?.(source.fileName) ?? resolve(source.fileName)) === file)!;
      assert.ok(standalone, "the real standalone declaration must be resolved");
      assert.equal(standalone.text, await readFile(file, "utf8"));
      let declarations = 0;
      for (const statement of standalone.statements) {
        if (!ts.isClassDeclaration(statement) && !ts.isFunctionDeclaration(statement)) continue;
        const modifiers = ts.getModifiers(statement) ?? [];
        assert.ok(modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
        assert.ok(modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword));
        declarations++;
      }
      assert.ok(declarations > 1, "the emitted standalone class and functions remain declarations");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
