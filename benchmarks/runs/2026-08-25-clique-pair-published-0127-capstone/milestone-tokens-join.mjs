// Post-hoc per-milestone token join for the manual-shape capstone
// (charter amendment 2026-08-25): joins codex session token_count events
// (cumulative totals, ISO timestamps) to the lane run-log's agent-stamped
// milestone windows. Read-only over its inputs.
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean),
);
if (!args["run-log"] || !args.session) {
  console.error("usage: milestone-tokens-join.mjs --run-log <run-log.md> --session <rollout.jsonl>");
  process.exit(2);
}

const runLog = readFileSync(args["run-log"], "utf8").split("\n");
const milestones = new Map();
for (const line of runLog) {
  const epoch = Number(line.split(" ", 1)[0]);
  if (!Number.isFinite(epoch)) continue;
  const kv = Object.fromEntries([...line.matchAll(/([A-Za-z]+)=([^\s"]+)/g)].map((m) => [m[1], m[2]]));
  if (line.includes("milestone-start") && kv.milestone) {
    const m = milestones.get(kv.milestone) ?? {};
    m.startEpoch = epoch;
    milestones.set(kv.milestone, m);
  } else if (line.includes("milestone-green") && kv.milestone) {
    const m = milestones.get(kv.milestone) ?? {};
    m.greenEpoch = Number(kv.firstGreen ?? epoch);
    m.wallSeconds = Number(kv.wallSeconds ?? NaN);
    m.correctionLoops = Number(kv.correctionLoops ?? NaN);
    milestones.set(kv.milestone, m);
  }
}

const events = [];
for (const line of readFileSync(args.session, "utf8").split("\n")) {
  if (!line.includes('"token_count"')) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  const info = row?.payload?.info;
  if (row?.payload?.type !== "token_count" || !info?.total_token_usage) continue;
  events.push({ tMs: Date.parse(row.timestamp), totals: info.total_token_usage });
}
events.sort((a, b) => a.tMs - b.tMs);
if (events.length === 0) { console.error("no token_count events"); process.exit(3); }

const usageAt = (epochSeconds) => {
  const tMs = epochSeconds * 1000;
  let last = null;
  for (const e of events) { if (e.tMs <= tMs) last = e; else break; }
  return last?.totals ?? null;
};
const delta = (a, b) => a && b
  ? Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]))
  : null;

const rows = [];
for (const [name, m] of [...milestones.entries()].sort()) {
  if (!m.startEpoch) continue;
  const start = usageAt(m.startEpoch);
  const end = m.greenEpoch ? usageAt(m.greenEpoch) : events.at(-1).totals;
  const d = delta(start, end);
  rows.push({
    milestone: name,
    complete: Boolean(m.greenEpoch),
    wallSeconds: m.wallSeconds ?? (m.greenEpoch ? m.greenEpoch - m.startEpoch : null),
    correctionLoops: m.correctionLoops ?? null,
    tokens: d && {
      input: d.input_tokens, cachedInput: d.cached_input_tokens,
      output: d.output_tokens, reasoningOutput: d.reasoning_output_tokens,
    },
    // Interpolation honesty: the boundary usage is the last token_count at or
    // before the mark; sub-turn drift is bounded by one turn's usage.
    boundaryResolutionNote: "nearest-preceding token_count event",
  });
}
const summary = {
  sessionEvents: events.length,
  sessionTotals: events.at(-1).totals,
  milestones: rows,
};
console.log(JSON.stringify(summary, null, 2));
