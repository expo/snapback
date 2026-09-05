import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
export const twinSource = /evaluator\/src\/|src\/twin(?:-hydrate)?\.ts$/;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(text) {
  const output = []; let value = 0, shift = 0;
  for (const character of text) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("invalid source-map VLQ");
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else { output.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
  }
  return output;
}
export function segments(map) {
  let source = 0, line = 0, column = 0;
  return map.mappings.split(";").map((row) => {
    let generated = 0;
    return row ? row.split(",").map((encoded) => {
      const data = vlq(encoded); generated += data[0];
      if (data.length < 4) return { generated };
      source += data[1]; line += data[2]; column += data[3];
      return { generated, source, line, column };
    }) : [];
  });
}
function lookup(rows, line, column) {
  const row = rows[line]; if (!row?.length) return;
  let lo = 0, hi = row.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (row[mid].generated <= column) lo = mid + 1; else hi = mid; }
  return row[lo - 1];
}
/** Attribute generated JS spans through Metro's map and the package's emitted input maps. */
export async function attributeBundle(js, map, dist) {
  const rows = segments(map), lines = js.split("\n"), inputMaps = new Map();
  let client = 0, twin = 0, mapped = 0;
  const bySource = new Map();
  for (let line = 0; line < rows.length; line++) {
    const row = rows[line], text = lines[line] ?? "";
    for (let i = 0; i < row.length; i++) {
      const point = row[i]; if (point.source === undefined) continue;
      const bytes = Buffer.byteLength(text.slice(point.generated, row[i + 1]?.generated ?? text.length));
      const name = map.sources[point.source]; mapped += bytes;
      if (!/\/packages\/snapback2\/dist\//.test(name)) continue;
      client += bytes;
      bySource.set(name, (bySource.get(name) ?? 0) + bytes);
      const leaf = name.endsWith("/expo/witness.mjs") ? "expo/witness.mjs" : basename(name);
      if (!inputMaps.has(leaf)) {
        try { const inner = JSON.parse(await readFile(resolve(dist, leaf + ".map"), "utf8")); inputMaps.set(leaf, { map: inner, rows: segments(inner) }); }
        catch { inputMaps.set(leaf, undefined); }
      }
      const inner = inputMaps.get(leaf);
      if (!inner) continue;
      const original = lookup(inner.rows, point.line, point.column);
      const path = original?.source === undefined ? "" : inner.map.sources[original.source];
      if (twinSource.test(path)) twin += bytes;
    }
  }
  return { generatedJsBytes: Buffer.byteLength(js), mappedJsBytes: mapped, clientIncludingTwinJsBytes: client,
    twinSubsetJsBytes: twin, byPackageModule: Object.fromEntries(bySource),
    method: "Generated JS UTF-8 spans between Metro mappings; compose original positions in dist/*.mjs with emitted esbuild maps. Twin subset = evaluator/src plus twin.ts and twin-hydrate.ts. Estimates, not additive Hermes or gzip shares." };
}
