# S4a (the backend image), measured and stopped — 2026-09-17

Kept evidence for LLP 3000.002, "S4a, measured and stopped". Not part of any build.

- `candidate.patch`, `candidate-files/` — the lane's Rust image-path PROBE on base `9aaa9d922f`: the web device opening and adopting from a compact backend image, with the JSON path for `Backend` compiled out on web and provisional server work. It measured 1,365,249 B raw / 416,502 B gzip against 1,531,216 / 451,283 — 34,781 B recovered, under the plan's 36,000 B stop rule — so it was removed from the tree and preserved here. It is not a finished or reviewed change: no TypeScript host integration, no image-upgrade scenarios.
- `report.md` — the lane's full handoff: commands, summaries, measurements, and the brief's premises it found wrong.
- `s4a-before-families.log`, `s4a-candidate-families.log` — `attribute-wasm.mjs --families` before and on the probe.
- `chat.probe.sb4b` — the probe's image of the `apps/chat` backend (8,484 B; 1,968 gzip; the JSON `/schema` body is 23,923 / 3,096).
- `measure-transfer.py`, `measure-sdk.mjs` — the scripts behind the transfer and SDK numbers.

The branch this directory lives on (`sb4/diet-s4a`) carries boundary (a) of the lane: the bounded `compact` serde format in the core, the format-aware impls it needs, and their tests. The web device on this branch still reads and writes backend JSON.
