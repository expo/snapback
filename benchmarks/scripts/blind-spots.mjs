#!/usr/bin/env node
// The two things the holistic scorer excludes by design, counted from the same
// run records it reads.
//
// LLP 3000.010 §8.5: the calibration has produced one event in twelve runs and
// its Snapback-attributed charge list is empty, while two costs remain invisible
// to it —
//
//   1. AGENT-ERROR LOOPS. The scorer charges the backend for defects, missing
//      capabilities and documentation that misled, and never for agent or
//      environment loops. A builder erring twenty-six times is erring at
//      something; the score cannot say whether that something is Snapback.
//
//   2. ANTICIPATORY COST. LLP 3000.007 §20.22 probed the published binary and
//      found "no bound was hit at runtime in any of the last four lanes" — no
//      `complete: false`, no `E_BOUND`, no cap refusal. What was scored was
//      builders reading about ceilings, redesigning in advance, and writing the
//      limits into their reports. The engine's own warnings become the scorer's
//      input.
//
// This reports both per run. It is a counter, not a verdict: it says where the
// builder spent effort the score did not see, and nothing about whose fault it
// is. Usage: node benchmarks/scripts/blind-spots.mjs [--json]

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const runsDir = join(root, "benchmarks/runs");

/** What an agent-error loop was actually about. First match wins, so order matters. */
const SUBJECTS = [
  ["app framework", /\b(expo|router|metro|hermes|react|tsx|navigation|stack|slot|tabs|babel|bundler|native-?build)\b/i],
  ["harness / fixture", /\b(harness|fixture|acceptance|replay|probe|seed|checkpoint|instrument|packet)\b/i],
  ["environment / tooling", /\b(path|node|npm|bun|install|port|permission|sandbox|disk|toolchain)\b/i],
  // Only after the above: words that name Snapback's own authoring surface.
  ["snapback surface", /\b(schema|quarry|index|sync|horizon|rule|maintain|cursor|predict|mutation|query|effect|asset|persona|residency|feed|merge|meter|chunk|job)\b/i],
];

/** Vocabulary a builder uses when it is talking about a limit. */
const BOUND_WORDS = /\b(N_WIDE_MERGE|N_NEVER_COMPLETE|N_NO_CURSOR|N_NO_HORIZON|E_BOUND|E_STRUCTURAL_FANOUT|complete:\s*false|capped_at|examined ceiling|meter cut|cut\b|ceiling|bounded|cap\b|caps\b|limit)\b/gi;
/** Vocabulary that would mean a limit was actually REACHED, not anticipated. */
const MET_WORDS = /\b(E_BOUND|complete:\s*false|capped_at|was cut|were cut|aborted at|hit the (ceiling|cap|meter)|refused with)\b/gi;

function classify(text) {
  for (const [name, re] of SUBJECTS) if (re.test(text)) return name;
  return "unclassified";
}

function readRun(dir) {
  const full = join(runsDir, dir);
  const family = readdirSync(full, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)[0];
  if (!family) return null;
  const at = n => join(full, family, n);
  const log = [at("lane-run-log.md"), at("run-log.md")].find(existsSync);
  if (!log) return null;

  const loops = { "agent-error": [], environment: [], ambiguous: [], "snapback4-defect": [] };
  for (const line of readFileSync(log, "utf8").split("\n")) {
    const m = /attribution=([a-z0-9-]+)/.exec(line);
    if (!m) continue;
    const bucket = /snapback4-defect/.test(line) ? "snapback4-defect" : m[1];
    (loops[bucket] ??= []).push(line);
  }

  const subjects = {};
  for (const line of loops["agent-error"] ?? []) {
    const s = classify(line);
    subjects[s] = (subjects[s] ?? 0) + 1;
  }

  // Anticipatory cost: what the builder wrote about limits, in the two documents
  // the scorer reads, against what reads as a limit actually reached.
  const prose = [at("lane-final-report.md"), at("final-report.md"), at("lane-essay.md"), at("essay.md")]
    .filter(existsSync).map(f => readFileSync(f, "utf8")).join("\n");
  const narrated = (prose.match(BOUND_WORDS) ?? []).length;
  const met = (prose.match(MET_WORDS) ?? []).length;

  const meta = /^(\d{4}-\d{2}-\d{2})-snapback4-clique-astra-(.+)$/.exec(dir);
  return {
    run: dir, date: meta?.[1] ?? null, version: meta?.[2] ?? null,
    loops: Object.fromEntries(Object.entries(loops).map(([k, v]) => [k, v.length])),
    total: Object.values(loops).reduce((a, v) => a + v.length, 0),
    subjects, narratedBounds: narrated, metBounds: met,
  };
}

function chronological(a, b) {
  const key = d => {
    const m = /^(\d{4}-\d{2}-\d{2})-snapback4-clique-astra-(.+)$/.exec(d);
    return [m?.[1] ?? d, (m?.[2] ?? "").split(".").map(Number)];
  };
  const [da, va] = key(a), [db, vb] = key(b);
  if (da !== db) return da < db ? -1 : 1;
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const x = va[i] ?? 0, y = vb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const runs = readdirSync(runsDir)
  .filter(d => /^\d{4}-\d{2}-\d{2}-snapback4-clique-astra-/.test(d))
  .sort(chronological).map(readRun).filter(Boolean);

const lines = [];
const say = t => { lines.push(t); console.log(t); };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ generated: new Date().toISOString().slice(0, 10), runs }, null, 2));
} else {
  const allSubjects = [...new Set(runs.flatMap(r => Object.keys(r.subjects)))];
  const w = 18;
  say("Loops the holistic score does not see\n");
  say(["version".padEnd(9), "sb4".padStart(4), "agent".padStart(6), "env".padStart(4), "amb".padStart(4), "  ", ...allSubjects.map(s => s.slice(0, w).padStart(w))].join(""));
  say("-".repeat(30 + allSubjects.length * w));
  for (const r of runs) {
    say([
      (r.version ?? "?").padEnd(9),
      String(r.loops["snapback4-defect"] ?? 0).padStart(4),
      String(r.loops["agent-error"] ?? 0).padStart(6),
      String(r.loops.environment ?? 0).padStart(4),
      String(r.loops.ambiguous ?? 0).padStart(4), "  ",
      ...allSubjects.map(s => String(r.subjects[s] ?? 0).padStart(w)),
    ].join(""));
  }
  say("\nBound vocabulary in the documents the scorer reads\n");
  say(["version".padEnd(9), "narrated".padStart(10), "reads as met".padStart(14), "  ratio".padStart(9)].join(""));
  say("-".repeat(44));
  for (const r of runs) {
    const ratio = r.metBounds ? (r.narratedBounds / r.metBounds).toFixed(1) + "×" : "—";
    say([(r.version ?? "?").padEnd(9), String(r.narratedBounds).padStart(10), String(r.metBounds).padStart(14), ratio.padStart(9)].join(""));
  }
  say("\nA limit named in a final report is the scorer's input whether or not the");
  say("builder ever reached it. LLP 3000.007 §20.22 found none were reached in the");
  say("last four lanes. Evidence directories are not retained, so 'reads as met' is");
  say("counted from the same prose and is an upper bound on what was actually hit.");
  const missing = readdirSync(runsDir).filter(d => /^\d{4}-\d{2}-\d{2}-snapback4-clique-astra-/.test(d)).length - runs.length;
  if (missing > 0) say(`\n${missing} of ${runs.length + missing} calibrations retain no run-log, so the loop ledger\ncovers only part of the series. Retaining it is a protocol change, not a tool change.`);
  writeFileSync(join(root, "benchmarks/BLIND-SPOTS.md"),
    "# What the holistic score does not see\n\nGenerated by `benchmarks/scripts/blind-spots.mjs`. See LLP 3000.010 §8.5.\n\n```\n" + lines.join("\n") + "\n```\n");
}
