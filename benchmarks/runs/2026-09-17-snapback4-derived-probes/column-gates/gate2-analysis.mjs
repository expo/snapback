// Gate 2 of LLP 3000.007.001 §7: rows a device gains beyond its horizon because likes fall on old posts.
// Mechanics taken as verified (partition.rs; derived-probes): the stream applies no horizon and a device stores every put;
// a maintained column (like the hand-kept score it replaces) puts the whole parent row on every like.
import { readFileSync } from "node:fs";
const FIX = process.env.FIXTURE; if (!FIX) throw new Error("FIXTURE=/path/to/built/scale (node snapback4/fixtures/clique.mjs build --log scale --out <dir>)");
const rows = name => readFileSync(`${FIX}/${name}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
const Tc = Date.parse("2026-01-02T00:27:36Z");           // the "# checkpoint 50%" marker's instant (scale.log line 88059)
const DAY = 86400000;
const likes = rows("likes"), reposts = rows("reposts");
for (const [label, table] of [["posts+replies as one table", [...rows("posts"), ...rows("replies")]], ["top-level posts only", rows("posts")]]) {
  const byId = new Map(table.map(p => [p.id, p]));
  const held = table.filter(p => p.at <= Tc).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).slice(0, 2000);
  const heldIds = new Set(held.map(p => p.id));
  const horizon = held.at(-1).at;
  const end = Math.max(...likes.map(l => l.at));
  const windowLikes = likes.filter(l => l.at > Tc && byId.has(l.postId));
  const spanDays = (end - Tc) / DAY;
  const beyond = new Set(), within = new Set(), fresh = new Set();
  for (const l of windowLikes) {
    const p = byId.get(l.postId);
    if (p.at > Tc) fresh.add(p.id);                        // created after acquisition: the device has it anyway
    else if (heldIds.has(p.id)) within.add(p.id);          // inside the acquired window
    else beyond.add(p.id);                                 // older than the horizon: gained only because it was liked
  }
  // a simulated day of the recorded stream: the log's like rate after the checkpoint, scaled to 24 h
  const likeSpan = (end - Math.min(...windowLikes.map(l => l.at))) / DAY;
  console.log(`\n== ${label}`);
  console.log(`held at acquisition: ${held.length}; horizon = ${new Date(horizon).toISOString()} (${((Tc - horizon) / 3600000).toFixed(2)} h before the checkpoint)`);
  console.log(`likes after the checkpoint: ${windowLikes.length} over ${(likeSpan * 24).toFixed(2)} h of log time (the whole remaining replay is ${(spanDays * 24).toFixed(2)} h)`);
  console.log(`distinct liked posts: beyond the horizon ${beyond.size}, inside the acquired window ${within.size}, created after acquisition ${fresh.size}`);
  console.log(`rows gained beyond the horizon: ${beyond.size} = ${(100 * beyond.size / held.length).toFixed(1)}% of the ${held.length} held at acquisition (gate: 10%)`);
  const ages = windowLikes.map(l => (l.at - byId.get(l.postId).at) / 3600000).sort((a, b) => a - b);
  console.log(`age of the liked post at like time, hours: p10 ${ages[Math.floor(.1 * ages.length)].toFixed(1)}, p50 ${ages[Math.floor(.5 * ages.length)].toFixed(1)}, p90 ${ages[Math.floor(.9 * ages.length)].toFixed(1)}`);
  // the window the device's horizon covers, in time, at the fixture's posting rate
  const after = table.filter(p => p.at > Tc).length;
  console.log(`new rows of this table after acquisition (gained under any form): ${after}`);
}
