# Snapback 4: Sync can materialize a join larger than its response ceiling

Status: Open
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Reproduced by the lead after independent lead/Sol code traces. `stream` keeps a whole commit beyond its event limit, then `expand_joins` loads an entire historical group before horizon selection. A legitimate newly joined group can expand beyond the 16 MiB response cap. Encoding then refuses and the device cannot advance past that watermark. A standalone Rust probe seeded 45 messages with 400000-byte bodies in nine five-row commits, captured alice's empty snapshot at watermark 9, then granted one membership. `stream(alice, 9, 1)` returned 45 events, watermark 10, more:false; serialized page size was 18006410 bytes versus the HTTP ceiling 16777216. The core result alone exceeds the full response ceiling. This used 18 MB of row data, not an exhaustion experiment.

## Implementation locations

Paths are relative to `snapback4/`: `crates/snapback4-core/src/partition.rs:stream` and `expand_joins`; `store` historical group acquisition; HTTP JsonBuffer ceiling. Page count does not bound expanded bytes or memory.

## Acceptance

Demonstrate a join whose bytes exceed one response, then guarantee forward progress with bounded staged acquisition and atomic visibility, or reject oversize holdings before accepting membership. Preserve group fanout and conservative horizons. Design alternatives in LLP 3000.002; do not merely raise the response ceiling.
