import ts from "typescript";
import { diagnostic, type DiagnosticModule } from "./diagnostics";
import { IR_CONTRACT, type FrontendDiagnostic } from "./ir";

export function validateSeedRow(
  module: DiagnosticModule,
  node: ts.Node,
  table: string,
  index: number,
  value: unknown,
  columns: Record<string, unknown>,
  diagnostics: FrontendDiagnostic[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(diagnostic(module, "E_SEED_ROW", node, `seed ${table}[${index}] must be an object with a string id`, module.source));
    return;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) {
    diagnostics.push(diagnostic(module, "E_SEED_ROW", node, `seed ${table}[${index}].id must be a non-empty string`, module.source));
  }
  for (const field of Object.keys(row)) {
    if (!Object.hasOwn(columns, field)) {
      diagnostics.push(diagnostic(module, "E_SEED_VALUE", node, `seed ${table}[${index}] has unknown column ${field}`, module.source));
    }
  }
  for (const [field, type] of Object.entries(columns)) {
    if (!Object.hasOwn(row, field)) {
      if (!isOptionalColumn(type)) {
        diagnostics.push(diagnostic(module, "E_SEED_VALUE", node, `seed ${table}[${index}] is missing required column ${field}`, module.source));
      }
      continue;
    }
    const mismatch = seedValueMismatch(row[field], type, `${table}[${index}].${field}`);
    if (mismatch) diagnostics.push(diagnostic(module, mismatch.code, node, mismatch.message, mismatch.rewrite ?? module.source));
  }
}

type SeedMismatch = {
  code: "E_SEED_VALUE" | "E_SCHEMA_ASSET_SEED";
  message: string;
  rewrite?: string;
};

function seedMismatch(message: string): SeedMismatch {
  return { code: "E_SEED_VALUE", message };
}

function seedValueMismatch(value: unknown, type: unknown, path: string): SeedMismatch | undefined {
  if (type === "Id" || type === "Principal" || (type && typeof type === "object" && "Ref" in type)) {
    if (value === IR_CONTRACT.systemPrincipalId) return seedMismatch(`${path} cannot carry the reserved system principal`);
    return typeof value === "string" && value.length > 0 ? undefined : seedMismatch(`${path} must be a non-empty string`);
  }
  if (type === "Int" || type === "Time") {
    return typeof value === "number" && Number.isSafeInteger(value) ? undefined : seedMismatch(`${path} must be an integer`);
  }
  if (type === "Bool") return typeof value === "boolean" ? undefined : seedMismatch(`${path} must be boolean`);
  if (!type || typeof type !== "object" || Array.isArray(type)) return seedMismatch(`${path} has an unsupported schema type`);
  const descriptor = type as Record<string, any>;
  if (descriptor.Text) {
    if (typeof value !== "string" || [...value].length > descriptor.Text.max) {
      return seedMismatch(`${path} must be text of at most ${descriptor.Text.max} characters`);
    }
    const codePoint = disallowedTextControlCodePoint(value);
    return codePoint === undefined
      ? undefined
      : seedMismatch(`${path} contains disallowed control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  if (descriptor.Bytes) {
    const encodedObject = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
    const encoded = encodedObject?.Bytes;
    return encodedObject && Object.keys(encodedObject).length === 1
      && typeof encoded === "string" && /^(?:[0-9a-f]{2})*$/.test(encoded)
      && encoded.length / 2 <= descriptor.Bytes.max
      ? undefined
      : seedMismatch(`${path} must be canonical lowercase base16 of at most ${descriptor.Bytes.max} bytes`);
  }
  if (descriptor.Json) {
    const mismatch = jsonWireMismatch(value, path);
    if (mismatch) return mismatch;
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    return bytes <= descriptor.Json.max_bytes ? undefined : seedMismatch(`${path} JSON exceeds ${descriptor.Json.max_bytes} bytes`);
  }
  if (descriptor.Enum) {
    const variants = descriptor.Enum.variants as unknown[];
    return typeof value === "string" && variants.includes(value)
      ? undefined
      : seedMismatch(`${path} must be one of ${variants.map(String).join(", ")}`);
  }
  if (descriptor.Decimal || descriptor.Money) {
    return typeof value === "number" && Number.isSafeInteger(value) ? undefined : seedMismatch(`${path} must be integer minor units`);
  }
  if (descriptor.Image || descriptor.Video) {
    const kind = descriptor.Image ? "image" : "video";
    // @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — seeds
    // cannot fabricate the engine-owned ledger row required by an asset value.
    return {
      code: "E_SCHEMA_ASSET_SEED",
      message: `${path} cannot seed a ${kind} asset because seeds cannot mint ledger rows`,
      rewrite: "upload through the app; seeds cannot mint ledger rows",
    };
  }
  if ("Optional" in descriptor) {
    return value === null ? undefined : seedValueMismatch(value, descriptor.Optional, path);
  }
  if (descriptor.List) {
    if (!Array.isArray(value)) return seedMismatch(`${path} must be a list`);
    if (value.length > descriptor.List.max) return seedMismatch(`${path} exceeds list max ${descriptor.List.max}`);
    for (let index = 0; index < value.length; index += 1) {
      const mismatch = seedValueMismatch(value[index], descriptor.List.of, `${path}[${index}]`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  return seedMismatch(`${path} has an unsupported schema type`);
}

function disallowedTextControlCodePoint(text: string): number | undefined {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) return codePoint;
  }
  return undefined;
}

function isOptionalColumn(type: unknown): boolean {
  return !!type && typeof type === "object" && !Array.isArray(type) && "Optional" in type;
}

function jsonWireMismatch(value: unknown, path: string): SeedMismatch | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? undefined : seedMismatch(`${path} JSON numbers must be integers`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const mismatch = jsonWireMismatch(value[index], `${path}[${index}]`);
      if (mismatch) return mismatch;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const mismatch = jsonWireMismatch(item, `${path}.${key}`);
      if (mismatch) return mismatch;
    }
  }
  return undefined;
}
