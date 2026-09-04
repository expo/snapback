// Schema identity must match Rust serde's struct-field order and BTreeMap key
// order. This small copy keeps the public decoder browser-safe and synchronous.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — closure reconstruction is admitted only under the envelope's exact generation schema.

export function schemaDigest(schema: any): string {
  return sha256(canonicalSchemaJson(schema));
}

function canonicalSchemaJson(schema: any): string {
  const canonical: Record<string, any> = {
    tables: sortedMap(schema.tables ?? {}, normalizeTable),
    maintains: (schema.maintains ?? []).map(normalizeMaintain),
  };
  if (schema.channels !== undefined && Object.keys(schema.channels).length > 0) {
    canonical.channels = sortedMap(schema.channels, normalizeChannel);
  }
  if (schema.auth !== undefined && (schema.auth.password || schema.auth.guests)) {
    canonical.auth = { password: schema.auth.password, guests: schema.auth.guests };
  }
  if (schema.effects !== undefined && schema.effects.length > 0) canonical.effects = schema.effects;
  return JSON.stringify(canonical);
}

function normalizeMaintain(maintain: any): any {
  return {
    kind: normalizeMaintainKind(maintain.kind),
    source: maintain.source,
    by: maintain.by,
    target: maintain.target,
    readable: maintain.readable === null ? null : normalizeRule(maintain.readable),
  };
}

function normalizeMaintainKind(kind: any): any {
  if (typeof kind === "string") return kind;
  const [tag, data] = tagged(kind);
  return tag === "Sum" ? { Sum: { of: data.of } } : kind;
}

function normalizeTable(table: any): any {
  return {
    columns: sortedMap(table.columns ?? {}, normalizeColumnType),
    indexes: sortedMap(table.indexes ?? {}, normalizeIndex),
    rules: normalizeRules(table.rules),
    constraints: (table.constraints ?? []).map(normalizeConstraint),
    retain: table.retain ?? "until-revoked",
  };
}

function normalizeIndex(index: any): any {
  return { columns: index.columns, unique: index.unique };
}

function normalizeChannel(channel: any): any {
  return {
    args: sortedMap(channel.args ?? {}, normalizeArgType),
    publish: normalizeRule(channel.publish),
    subscribe: normalizeRule(channel.subscribe),
    ttl_ms: channel.ttl_ms,
  };
}

function normalizeRules(rules: any): any {
  return {
    read: normalizeRule(rules.read),
    insert: normalizeRule(rules.insert),
    update: normalizeRule(rules.update),
    delete: normalizeRule(rules.delete),
  };
}

function normalizeRule(rule: any): any {
  if (typeof rule === "string") return rule;
  const [kind, data] = tagged(rule);
  switch (kind) {
    case "Eq":
    case "Ne":
      return { [kind]: data.map(normalizeRuleTerm) };
    case "And":
    case "Or":
      return { [kind]: data.map(normalizeRule) };
    case "Not":
      return { [kind]: normalizeRule(data) };
    case "Exists":
    case "Created":
      return { [kind]: {
        table: data.table,
        index: data.index,
        key: data.key.map(normalizeRuleTerm),
        provenance: data.provenance,
      } };
    case "Public":
      return { Public: { reason: data.reason } };
    default:
      return rule;
  }
}

function normalizeRuleTerm(term: any): any {
  if (typeof term === "string") return term;
  const [kind, data] = tagged(term);
  return kind === "Literal" ? { Literal: normalizeValue(data) } : term;
}

function normalizeColumnType(column: any): any {
  if (typeof column === "string") return column;
  const [kind, data] = tagged(column);
  if (kind === "Optional") return { Optional: normalizeColumnType(data) };
  if (kind === "List") return { List: { of: normalizeColumnType(data.of), max: data.max } };
  if (["Text", "Bytes", "Image", "Video"].includes(kind)) return { [kind]: { max: data.max } };
  if (kind === "Enum") return { Enum: { variants: data.variants } };
  if (kind === "Decimal") return { Decimal: { scale: data.scale } };
  if (kind === "Money") return { Money: { currency: data.currency, scale: data.scale } };
  if (kind === "Ref") return { Ref: { table: data.table } };
  if (kind === "Json") return { Json: { max_bytes: data.max_bytes } };
  return { [kind]: data };
}

function normalizeArgType(arg: any): any {
  if (typeof arg === "string") return arg;
  const [kind, data] = tagged(arg);
  if (kind === "Optional") return { Optional: normalizeArgType(data) };
  if (kind === "List") {
    return { List: {
      ...(data.of === null || data.of === undefined ? {} : { of: normalizeArgType(data.of) }),
      max: data.max,
    } };
  }
  return normalizeColumnType(arg);
}

function normalizeConstraint(constraint: any): any {
  if (typeof constraint === "string") return constraint;
  const [kind, data] = tagged(constraint);
  switch (kind) {
    case "Unique": return { Unique: { index: data.index } };
    case "Cap": return { Cap: { by: data.by, max: data.max } };
    case "Immutable": return { Immutable: { fields: data.fields } };
    case "Text": return { Text: {
      field: data.field,
      min: data.min ?? 0,
      ...(data.format === undefined || data.format === null ? {} : { format: data.format }),
    } };
    case "FinalExistsOnInsert": return { FinalExistsOnInsert: {
      table: data.table,
      index: data.index,
      key: data.key.map(normalizeRuleTerm),
    } };
    default: return constraint;
  }
}

function normalizeValue(value: any): any {
  if (typeof value === "string") return value;
  const [kind, data] = tagged(value);
  if (kind === "Array") return { Array: data.map(normalizeValue) };
  if (kind === "Row" || kind === "Map") return { [kind]: sortedMap(data, normalizeValue) };
  return value;
}

function sortedMap(value: Record<string, any>, normalize: (item: any) => any): Record<string, any> {
  const result: Record<string, any> = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodepoints)) result[key] = normalize(value[key]);
  return result;
}

function tagged(value: any): [string, any] {
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new TypeError("schema contains malformed externally tagged data");
  return [keys[0]!, value[keys[0]!]];
}

function compareCodepoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

function sha256(text: string): string {
  const bytes = utf8(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = ((bytes[start] << 24) | (bytes[start + 1] << 16)
        | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff) bytes.push(
      0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f),
    );
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f),
      0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
  }
  return bytes;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
