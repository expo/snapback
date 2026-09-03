import ts from "typescript";
import { diagnostic, type DiagnosticModule } from "./diagnostics";
import { IR_CONTRACT, type FrontendDiagnostic } from "./ir";
import { booleanValue, stringValue } from "./lower/static";
import { propertyName, unwrapExpression } from "./syntax";

class AuthoredSeedNumber {
  constructor(readonly text: string) {}
}

export function staticSeedJson(node: ts.Expression, constants: Map<string, unknown> = new Map()): unknown | undefined {
  const value = unwrapExpression(node);
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  const bool = booleanValue(value);
  if (bool !== undefined) return bool;
  if (ts.isNumericLiteral(value)) return new AuthoredSeedNumber(value.getText());
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) {
    return new AuthoredSeedNumber(`-${value.operand.getText()}`);
  }
  const string = stringValue(value);
  if (string !== undefined) return string;
  if (ts.isIdentifier(value)) return constants.get(value.text);
  if (ts.isArrayLiteralExpression(value)) {
    const output: unknown[] = [];
    for (const item of value.elements) {
      if (ts.isSpreadElement(item)) return undefined;
      const lowered = staticSeedJson(item, constants);
      if (lowered === undefined) return undefined;
      output.push(lowered);
    }
    return output;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const output: Record<string, unknown> = Object.create(null);
    for (const item of value.properties) {
      if (ts.isSpreadAssignment(item)) {
        const spread = staticSeedJson(item.expression, constants);
        if (!spread || typeof spread !== "object" || Array.isArray(spread)) return undefined;
        Object.assign(output, spread);
        continue;
      }
      const entry = ts.isPropertyAssignment(item)
        ? { name: propertyName(item.name), value: item.initializer }
        : ts.isShorthandPropertyAssignment(item) ? { name: item.name.text, value: item.name } : undefined;
      if (!entry?.name) return undefined;
      const lowered = staticSeedJson(entry.value, constants);
      if (lowered === undefined) return undefined;
      output[entry.name] = lowered;
    }
    return output;
  }
  return undefined;
}

export function moduleSeedJsonConstants(sourceFile: ts.SourceFile): Map<string, unknown> {
  const constants = new Map<string, unknown>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = staticSeedJson(declaration.initializer, constants);
      if (value !== undefined) constants.set(declaration.name.text, value);
    }
  }
  return constants;
}

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
    const normalized = normalizeSeedValue(row[field], type, `${table}[${index}].${field}`);
    if (normalized.message) diagnostics.push(diagnostic(module, "E_SEED_VALUE", node, normalized.message, module.source));
    else row[field] = normalized.value;
  }
}

type NormalizedSeed = { value?: unknown; message?: string };

function normalizeSeedValue(value: unknown, type: unknown, path: string): NormalizedSeed {
  if (type && typeof type === "object" && !Array.isArray(type)) {
    const descriptor = type as Record<string, any>;
    if (descriptor.Decimal || descriptor.Money) return normalizeWholeUnits(value, descriptor, path);
    if ("Optional" in descriptor) return value === null ? { value: null } : normalizeSeedValue(value, descriptor.Optional, path);
    if (descriptor.List) {
      if (!Array.isArray(value)) return { message: `${path} must be a list` };
      if (value.length > descriptor.List.max) return { message: `${path} exceeds list max ${descriptor.List.max}` };
      const items: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const normalized = normalizeSeedValue(value[index], descriptor.List.of, `${path}[${index}]`);
        if (normalized.message) return normalized;
        items.push(normalized.value);
      }
      return { value: items };
    }
  }
  const plain = plainSeedValue(value);
  const mismatch = seedValueMismatch(plain, type, path);
  return mismatch ? { message: mismatch } : { value: plain };
}

// @ref LLP 1011#b5-whole-unit-seeds — retain the authored character path so
// scaling never passes through a rounded host number.
function normalizeWholeUnits(value: unknown, descriptor: Record<string, any>, path: string): NormalizedSeed {
  const text = value instanceof AuthoredSeedNumber ? value.text
    : typeof value === "number" ? String(value)
      : typeof value === "string" ? value : undefined;
  const named = descriptor.Decimal
    ? `Decimal<${descriptor.Decimal.scale}>`
    : `Money<${JSON.stringify(descriptor.Money.currency)}, ${descriptor.Money.scale}>`;
  const scale = Number((descriptor.Decimal ?? descriptor.Money).scale);
  if (text === undefined) return { message: `${path} must be a JSON number or decimal string in whole units` };
  if (/[eE]/.test(text)) return { message: `${path} refuses exponent notation; spell the whole-unit decimal directly` };
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return { message: `${path} must be a JSON number or decimal string in whole units` };
  const fractional = match[3] ?? "";
  if (fractional.length > scale) {
    return { message: `${fractional.length} fractional digits, scale ${scale}; ${named} cannot represent ${text}` };
  }
  const digits = `${match[2]}${fractional.padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  const minor = BigInt(`${match[1]}${digits}`);
  const maximum = 9_007_199_254_740_991n;
  if (minor < -maximum || minor > maximum) {
    return { message: `${text} at scale ${scale} is outside the safe integer wire range` };
  }
  return { value: Number(minor) };
}

function plainSeedValue(value: unknown): unknown {
  if (value instanceof AuthoredSeedNumber) return Number(value.text);
  if (Array.isArray(value)) return value.map(plainSeedValue);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = plainSeedValue(item);
    return output;
  }
  return value;
}

function seedValueMismatch(value: unknown, type: unknown, path: string): string | undefined {
  if (type === "Id" || type === "Principal" || (type && typeof type === "object" && "Ref" in type)) {
    if (value === IR_CONTRACT.systemPrincipalId) return `${path} cannot carry the reserved system principal`;
    return typeof value === "string" && value.length > 0 ? undefined : `${path} must be a non-empty string`;
  }
  if (type === "Int" || type === "Time") {
    return typeof value === "number" && Number.isSafeInteger(value) ? undefined : `${path} must be an integer`;
  }
  if (type === "Bool") return typeof value === "boolean" ? undefined : `${path} must be boolean`;
  if (!type || typeof type !== "object" || Array.isArray(type)) return `${path} has an unsupported schema type`;
  const descriptor = type as Record<string, any>;
  if (descriptor.Text) {
    return typeof value === "string" && [...value].length <= descriptor.Text.max ? undefined : `${path} must be text of at most ${descriptor.Text.max} characters`;
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
      : `${path} must be canonical lowercase base16 of at most ${descriptor.Bytes.max} bytes`;
  }
  if (descriptor.Json) {
    const mismatch = jsonWireMismatch(value, path);
    if (mismatch) return mismatch;
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    return bytes <= descriptor.Json.max_bytes ? undefined : `${path} JSON exceeds ${descriptor.Json.max_bytes} bytes`;
  }
  if (descriptor.Enum) {
    const variants = descriptor.Enum.variants as unknown[];
    return typeof value === "string" && variants.includes(value)
      ? undefined
      : `${path} must be one of ${variants.map(String).join(", ")}`;
  }
  if (descriptor.Decimal || descriptor.Money) return `${path} was not normalized from whole units`;
  if ("Optional" in descriptor) {
    return value === null ? undefined : seedValueMismatch(value, descriptor.Optional, path);
  }
  if (descriptor.List) {
    if (!Array.isArray(value)) return `${path} must be a list`;
    if (value.length > descriptor.List.max) return `${path} exceeds list max ${descriptor.List.max}`;
    for (let index = 0; index < value.length; index += 1) {
      const mismatch = seedValueMismatch(value[index], descriptor.List.of, `${path}[${index}]`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  return `${path} has an unsupported schema type`;
}

function isOptionalColumn(type: unknown): boolean {
  return !!type && typeof type === "object" && !Array.isArray(type) && "Optional" in type;
}

function jsonWireMismatch(value: unknown, path: string): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? undefined : `${path} JSON numbers must be integers`;
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
