import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export function quarryFiles(directory) {
  const files = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (["node_modules", ".git", ".snapback4", "generated"].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".q")) files.push(child);
    }
  }
  visit(directory);
  return files.sort();
}

export function correctionLoops(log) {
  const loops = new Map(), malformed = [];
  for (const line of log.split("\n")) {
    const id = line.match(/\bloop=(\d+)\b/)?.[1];
    if (!id) continue;
    if (/\bretracted\b/i.test(line)) { loops.delete(id); continue; }
    let category = line.match(/\battribution=([a-z0-9-]+)/)?.[1];
    if (category === "docs-gap") category = "docs";
    if (!["snapback4-defect", "docs", "agent-error", "environment", "ambiguous"].includes(category)) {
      malformed.push(line); continue;
    }
    loops.set(id, { id: Number(id), attribution: category, line });
  }
  const byAttribution = Object.fromEntries(["snapback4-defect", "docs", "agent-error", "environment", "ambiguous"].map((name) => [name, 0]));
  for (const loop of loops.values()) byAttribution[loop.attribution]++;
  return { byAttribution, snapbackAttributed: byAttribution["snapback4-defect"] + byAttribution.docs,
    total: loops.size, loops: [...loops.values()], malformed };
}

// Strip comments and string contents so a reason string is not a declaration.
function structural(line) {
  return line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|--.*$/g, (match) => match.startsWith("--") ? "" : "''");
}

// @ref LLP 3000.007#10-3 — measure the authored ceremony, retaining names and both classifications.
export function measureSchema(sources, log) {
  const tables = [], maintains = [], operations = [];
  let quarryLines = 0, quarryCodeLines = 0;
  for (const { path, source } of sources) {
    const lines = source.replace(/\n$/, "").split("\n");
    quarryLines += source ? lines.length : 0;
    let owner = null;
    for (let i = 0; i < lines.length; i++) {
      const line = structural(lines[i]);
      if (line.trim()) quarryCodeLines++;
      if (/^\S/.test(line)) owner = null;
      const table = line.match(/^table\s+(\w+)\s*:/);
      const maintain = line.match(/^maintain\s+(\w+)\s*:/);
      if (table || maintain) {
        owner = { name: (table || maintain)[1], path, line: i + 1, lines: [], publicReadLines: [] };
        (table ? tables : maintains).push(owner);
      }
      if (owner) {
        owner.lines.push(line);
        if (/^\s+(?:read\s*<-\s*(?:allow|public)\b|public\b)/.test(line)) owner.publicReadLines.push({ path, line: i + 1, text: lines[i].trim() });
      }
      const op = line.match(/^(query|mutation|job)\s+(\w+)\s*\(/);
      if (op) operations.push({ kind: op[1], name: path.endsWith("/schema.q") || path === "schema.q" ? op[2] : `${path.split("/").at(-1).replace(/\.q$/, "")}.${op[2]}`, path, line: i + 1 });
    }
  }
  const counterName = /count|counter|total|stat|unread|digest|activity/i;
  const workHeuristic = tables.filter((t) => /work|accumulator|scratch|temporary|(?:^|_)tmp|(?:^|_)temp/i.test(t.name) || /(?:^|[a-z])Acc(?:$|[A-Z_])/.test(t.name)).map((t) => t.name);
  const counterHeuristic = [...tables, ...maintains].filter((t) => counterName.test(t.name) &&
    /principal|userId|ownerId|targetUserId/i.test(t.lines.join("\n"))).map((t) => t.name);
  const raw = log.match(/^schema-shape=(.+)$/m)?.[1];
  let reported = null, reportingError = null;
  try {
    if (!raw) throw new Error("missing schema-shape record");
    reported = JSON.parse(raw);
    for (const field of ["workTables", "perPrincipalCounterTables", "auxiliaryOperations"]) {
      if (!Array.isArray(reported[field]) || reported[field].some((name) => typeof name !== "string")) throw new Error(`invalid ${field}`);
      reported[field] = [...new Set(reported[field])];
    }
    const names = new Set([...tables, ...maintains].map((t) => t.name));
    const opNames = new Set(operations.map((op) => op.name));
    for (const field of ["workTables", "perPrincipalCounterTables"]) {
      for (const name of reported[field]) if (!names.has(name)) throw new Error(`reported ${field} table does not exist: ${name}`);
    }
    for (const name of reported.auxiliaryOperations) if (!opNames.has(name)) throw new Error(`reported auxiliary operation does not exist: ${name}`);
  } catch (error) { reportingError = error.message; }
  const counterUnion = new Set([...counterHeuristic, ...(reported?.perPrincipalCounterTables ?? [])]);
  const publicCounterLines = [...tables, ...maintains].filter((t) => counterUnion.has(t.name)).flatMap((t) => t.publicReadLines.map((line) => ({ table: t.name, ...line })));
  return { tables: tables.length, tableNames: tables.map((t) => t.name), maintains: maintains.length,
    maintainNames: maintains.map((t) => t.name), tablesIncludingMaintains: tables.length + maintains.length,
    workTablesHeuristic: { count: workHeuristic.length, names: workHeuristic },
    workTablesReported: { count: reported?.workTables?.length ?? null, names: reported?.workTables ?? null },
    perPrincipalCountersHeuristic: counterHeuristic, perPrincipalCountersReported: reported?.perPrincipalCounterTables ?? null,
    publicPerPrincipalCounterLines: { count: publicCounterLines.length, lines: publicCounterLines },
    quarryLines, quarryCodeLines, operations: operations.length,
    operationsByKind: Object.fromEntries(["query", "mutation", "job"].map((kind) => [kind, operations.filter((op) => op.kind === kind).length])),
    operationNames: operations, auxiliaryOperationsReported: reported?.auxiliaryOperations ?? null, reportingError };
}

export function measureLane(lane, log) {
  return measureSchema(quarryFiles(join(lane, "snapback")).map((file) => ({ path: relative(lane, file), source: readFileSync(file, "utf8") })), log);
}
