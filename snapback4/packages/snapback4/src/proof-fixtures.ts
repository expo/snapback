// @ref LLP 3000.000.000.000.000#3-proof-fixture-loading — only schema-typed time leaves resolve relative strings.
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

export interface FixtureRow { table: string; row: Record<string, unknown> }
export interface LoadFixturesOptions {
  /** A running dev host, used for its public field types and current clock. */
  url: string;
  cwd?: string;
  /** Authenticate catalog and clock reads when needed. */
  persona?: string;
  headers?: Record<string, string>;
  /** Override the captured dev clock for a deterministic proof. */
  now?: number;
  timeoutMs?: number;
}
/** Read <table>.jsonl files, excluding cases; return one reset/seed-ready batch.
 * Schema and clock requests are bounded. Nothing is written to the server.
 */
export async function loadFixtures(directory: string, options: LoadFixturesOptions): Promise<FixtureRow[]> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error("E_PROOF_USAGE: loadFixtures timeoutMs must be a positive integer");
  const headers = new Headers(options.headers);
  if (options.persona !== undefined) headers.set("x-snapback-persona", options.persona);
  const read = async (path: string) => {
    const response = await fetch(new URL(path, options.url), { headers, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json() as Record<string, unknown>;
    if (response.status === 401 || response.status === 403 || (body.denied as { code?: string } | undefined)?.code === "E_AUTH")
      throw Error("E_AUTH: loadFixtures could not read the catalog; pass { persona } or { headers }");
    if (!response.ok || body.denied) throw Error(`E_INPUT: ${path}: ${JSON.stringify(body)}`);
    return body;
  };
  const [catalog, status] = await Promise.all([read(options.persona !== undefined || options.headers !== undefined ? "/" : "/dev/catalog"), options.now === undefined ? read("/dev/status") : Promise.resolve({ now: options.now })]);
  const now = status.now;
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) throw Error("E_FIXTURE_TIME: dev did not report a valid clock");
  const tables = catalog.tables as Array<{ name: string; fields: Record<string, unknown> }>;
  if (!Array.isArray(tables)) throw Error("E_INPUT: host did not report table field types");
  const dir = resolve(options.cwd ?? ".", directory), rows: FixtureRow[] = [];
  for (const name of (await readdir(dir)).filter(name => name.endsWith(".jsonl") && name !== "test.cases.jsonl").sort()) {
    const table = name.slice(0, -6), definition = tables.find(item => item.name === table);
    if (!definition) throw Error(`E_INPUT: ${name}: unknown table ${table}`);
    const lines = (await readFile(join(dir, name), "utf8")).split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
      if (!lines[n]!.trim()) continue;
      const at = `${name}:${n + 1}`;
      let row: unknown;
      try { row = JSON.parse(lines[n]!); } catch (error) { throw Error(`E_INPUT: ${at}: ${error}`); }
      if (!row || typeof row !== "object" || Array.isArray(row)) throw Error(`E_INPUT: ${at}: expected a row object`);
      const fields = row as Record<string, unknown>;
      for (const [field, kind] of Object.entries(definition.fields)) {
        if (field in fields) fields[field] = timeValue(kind, fields[field], now, `${at}.${field}`);
      }
      rows.push({ table, row: fields });
    }
  }
  return rows;
}
function timeValue(kind: unknown, value: unknown, now: number, at: string): unknown {
  if (kind && typeof kind === "object") {
    const type = kind as Record<string, unknown>;
    if ("Optional" in type) return value === null ? null : timeValue(type.Optional, value, now, at);
    const list = (type.List ?? type.ListRange) as { of?: unknown } | undefined;
    if (list && Array.isArray(value)) return value.map((item, i) => timeValue(list.of, item, now, `${at}[${i}]`));
  }
  if (kind !== "Time" || typeof value !== "string" || !value.startsWith("now")) return value;
  const match = /^(?:now|now([+-])([0-9]+)(ms|s|m|h|d|w))$/.exec(value);
  if (!match) throw Error(`E_FIXTURE_TIME: ${at}: ${JSON.stringify(value)}: expected now or now±positive integer ms/s/m/h/d/w`);
  const units: Record<string, bigint> = { ms: 1n, s: 1000n, m: 60000n, h: 3600000n, d: 86400000n, w: 604800000n };
  const delta = match[2] === undefined ? 0n : BigInt(match[2]) * units[match[3]!]!;
  const resolved = BigInt(now) + (match[1] === "-" ? -delta : delta);
  if ((match[2] !== undefined && delta === 0n) || resolved < 0n || resolved > BigInt(Number.MAX_SAFE_INTEGER)) throw Error(`E_FIXTURE_TIME: ${at}: ${JSON.stringify(value)} is outside the supported duration/time range`);
  return Number(resolved);
}
