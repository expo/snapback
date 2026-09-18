#!/usr/bin/env node
// Fit the calibration series, rather than comparing a run to the one before it.
//
// The 2026-09-17 trend correction (benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.27)
// found that twelve waves had been read as "flat at ~89.6" because each run was
// compared with its neighbour. Fitted across the series it was declining, and
// setup_and_docs — reported repeatedly as the programme's success on an 85-89-92
// recovery — was a local recovery inside a line falling 96 to 88. That fit was
// done once, by hand, in prose. This does it every time, from the run records.
//
// Reads every calibration run's FINAL.md, writes TREND.json and TREND.md.
// Usage: node benchmarks/scripts/score-trend.mjs [--check]

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { page } from "./trend-page.mjs";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const runsDir = join(root, "benchmarks/runs");

/** Least squares over equally spaced points. Returns slope per run and the fitted endpoints. */
function fit(values) {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (values[i] - meanY); den += (i - meanX) ** 2; }
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - meanY) ** 2, 0) / n);
  return {
    slope,
    mean: meanY,
    sd,
    first: intercept,
    last: intercept + slope * (n - 1),
    drift: slope * (n - 1),
    // A drift bigger than one standard deviation is the correction's own bar for
    // "this is the series moving, not the noise".
    beyondNoise: Math.abs(slope * (n - 1)) > sd,
  };
}

/** A run record's scores live in a fenced JSON block in <run>/<family>/FINAL.md. */
function readRun(dir) {
  const full = join(runsDir, dir);
  for (const family of readdirSync(full, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    const file = join(full, family, "FINAL.md");
    if (!existsSync(file)) continue;
    const block = /```json\s*(\{[\s\S]*?\})\s*```/.exec(readFileSync(file, "utf8"));
    if (!block) continue;
    let parsed;
    try { parsed = JSON.parse(block[1]); } catch { continue; }
    const backend = Object.entries(parsed.backends ?? {}).find(([name]) => name.includes("snapback4"));
    if (!backend) continue;
    const scores = {};
    for (const [category, value] of Object.entries(backend[1])) {
      if (value && typeof value === "object" && typeof value.score === "number") scores[category] = value.score;
    }
    if (typeof scores.overall !== "number") continue;
    const meta = /^(\d{4}-\d{2}-\d{2})-snapback4-clique-astra-(.+)$/.exec(dir);
    return { run: dir, date: meta?.[1] ?? null, version: meta?.[2] ?? null, family, scores };
  }
  return null;
}

const runs = readdirSync(runsDir)
  .filter(d => /^\d{4}-\d{2}-\d{2}-snapback4-clique-astra-/.test(d))
  .sort()
  .map(readRun)
  .filter(Boolean);

if (runs.length < 2) { console.error(`score-trend: found ${runs.length} runs; need at least 2`); process.exit(1); }

const categories = [...new Set(runs.flatMap(r => Object.keys(r.scores)))]
  .filter(c => runs.every(r => typeof r.scores[c] === "number"));

/** The verdict a series earns: its direction, or "flat" when the drift is inside its own noise. */
function verdict(t) { return !t || !t.beyondNoise ? "flat" : t.slope < 0 ? "falling" : "rising"; }

// A page about not being fooled by one run must not itself be fooled by one run.
// Leave each run out in turn: if the verdict flips without it, the verdict rests
// on that run and says so. This is general, not a patch for any particular run.
function robustness(series, versions) {
  const full = verdict(fit(series));
  const rests = [];
  for (let i = 0; i < series.length; i++) {
    const without = series.filter((_, j) => j !== i);
    if (verdict(fit(without)) !== full) rests.push(versions[i]);
  }
  return { robust: rests.length === 0, restsOn: rests };
}

const versions = runs.map(r => r.version);
const trends = {};
for (const c of categories) {
  const series = runs.map(r => r.scores[c]);
  trends[c] = { series, ...fit(series), ...robustness(series, versions) };
}

const falling = categories
  .filter(c => c !== "overall" && trends[c].slope < 0 && trends[c].beyondNoise && trends[c].robust)
  .sort((a, b) => trends[a].drift - trends[b].drift);
const fragile = categories
  .filter(c => trends[c].beyondNoise && !trends[c].robust)
  .sort((a, b) => trends[a].drift - trends[b].drift);

const report = {
  generated: new Date().toISOString().slice(0, 10),
  generator: "benchmarks/scripts/score-trend.mjs",
  note: "Fitted across the whole series. A single run against its neighbour is noise; see the 2026-09-17 trend correction.",
  runs: runs.map(({ run, date, version, family, scores }) => ({ run, date, version, family, scores })),
  categories: trends,
  falling,
  fragile,
};

writeFileSync(join(root, "benchmarks/TREND.json"), JSON.stringify(report, null, 2) + "\n");

const n = runs.length;
const o = trends.overall;
const sign = v => (v >= 0 ? "+" : "") + v.toFixed(1);
const arrow = t => (!t.beyondNoise ? "flat" : !t.robust ? "rests on one run" : t.slope < 0 ? "falling" : "rising");

const lines = [];
lines.push("# Calibration trend");
lines.push("");
lines.push(`Generated by \`benchmarks/scripts/score-trend.mjs\` from ${n} Astra-medium Clique calibration runs, ${runs[0].version} to ${runs[n - 1].version}. Regenerate after every calibration.`);
lines.push("");
lines.push(`**Overall: ${o.first.toFixed(1)} → ${o.last.toFixed(1)} fitted, ${sign(o.slope)}/run, drift ${sign(o.drift)} (sd ${o.sd.toFixed(2)}) — ${arrow(o)}.**`);
lines.push("");
lines.push(`\`${trends.overall.series.join(", ")}\``);
lines.push("");
lines.push("Read the fit, not the last pair. Adjacent runs move ±3 on this instrument with no surface change; that is why a decline was read as flat for twelve waves.");
lines.push("");
lines.push("| category | series | fitted | /run | drift | |");
lines.push("|---|---|---|---:|---:|---|");
for (const c of ["overall", ...categories.filter(x => x !== "overall").sort((a, b) => trends[a].drift - trends[b].drift)]) {
  const t = trends[c];
  const name = c === "overall" ? "**overall**" : c;
  lines.push(`| ${name} | ${t.series.join(" ")} | ${t.first.toFixed(0)} → ${t.last.toFixed(0)} | ${sign(t.slope)} | ${sign(t.drift)} | ${arrow(t)} |`);
}
lines.push("");
if (fragile.length) {
  lines.push("## Verdicts that rest on a single run");
  lines.push("");
  for (const c of fragile) lines.push(`- **${c}** reads ${trends[c].slope < 0 ? "falling" : "rising"} at ${sign(trends[c].drift)}, but the verdict flips without ${trends[c].restsOn.join(" or ")}. Treat it as unproven until another run lands.`);
  lines.push("");
}
if (falling.length) {
  lines.push(`## Falling beyond the noise, and robust to any single run: ${falling.length}`);
  lines.push("");
  for (const c of falling) lines.push(`- **${c}** ${trends[c].first.toFixed(0)} → ${trends[c].last.toFixed(0)} (${sign(trends[c].drift)} over ${n} runs, sd ${trends[c].sd.toFixed(2)})`);
  lines.push("");
  lines.push("Each of these is a category whose drift exceeds one standard deviation of its own series. Nothing here says *why*; it says where to look.");
} else {
  lines.push("No category is falling beyond the noise of its own series.");
}
lines.push("");
lines.push("N = 1 per version. These are calibration runs read for shape, not a ranking and not a magnitude claim about any backend.");
lines.push("");
writeFileSync(join(root, "benchmarks/TREND.md"), lines.join("\n"));
writeFileSync(join(root, "benchmarks/TREND.html"), page(report));

if (process.argv.includes("--check")) {
  console.log(`score-trend: ${n} runs, overall ${arrow(o)} (${sign(o.slope)}/run), ${falling.length} categor${falling.length === 1 ? "y" : "ies"} falling beyond noise`);
  if (falling.length) console.log(`  ${falling.map(c => `${c} ${sign(trends[c].drift)}`).join(", ")}`);
} else {
  console.log(`score-trend: wrote benchmarks/TREND.json, TREND.md and TREND.html from ${n} runs`);
}
