# LLP 0155 Stage 0, evidence half — freeze baselines and stand up standards-real browser automation

**Status:** Open
**Opened:** 2026-08-02, on LLP 0155's acceptance (fc19d8ed). The acceptance
change carried Stage 0's reconciliation half (the dated LLP 0129
cross-reference and companion records); this ticket owns the other half.
**Systems:** Testing, Client integration, Sync
**Related:** LLP 0155 §Stage 0; LLP 0138 (immutable receipts); the open
browser-carrier guide-gap ticket
(20260801-guide-gap-js-arm-browser-indexeddb-proof.md — same prerequisite,
coordinate rather than duplicate)

## Task

Per LLP 0155 §Sequencing Stage 0:

1. **Retain LLP 0138's receipts immutable** — verify nothing has mutated the
   bakeoff evidence trees; record the verification.
2. **Record current identities** — client/store bundle, carrier, and target
   identities as of the freeze date, so successor evidence has a pinned
   baseline.
3. **Freeze the six application manifests** — Triage Graph, Latency Kanban,
   Contention Calendar, Private Incident Room, Field Notebook, Fleet
   Observatory — as the successor-evidence fixtures for every later stage's
   exit gates.
4. **Standards-real browser automation** — a harness that can terminate and
   relaunch a real browser process over real IndexedDB (not fake-indexeddb,
   not same-process reload), plus the two-tab contention case. This is the
   lead-time item: Move 2's acceptance gate and Move 5's Field Notebook
   discriminator both require it, and the existing browser-proof guide-gap
   ticket has been waiting on exactly this harness.

No new product claims ride this ticket; it is evidence infrastructure. Per
LLP 0155 P6, the harness must let capability facts name carrier and evidence
class honestly.

## Exit

- The freeze artifacts landed (manifests + identity record, immutably
  referenced the way 0138's receipts are).
- The browser harness runs one real terminate/relaunch IndexedDB round-trip
  in CI or a documented locally-reproducible lane.
- The guide-gap ticket updated to point here (or closed onto this harness if
  it fully satisfies it).

## Running log

- **2026-08-02 — baseline freeze complete.**
  `demos/zero-bakeoff/stage0/baseline.v1.json` pins the six application
  manifests, the 38-file published `@expo/snapback-client` closure, the RQS
  IndexedDB/Web-Locks store closure, and the local Ibex/SQLite target identity
  at source commit `3c79fe69`. The verifier re-hashes every artifact and checks
  the target capability manifest, Cargo lockfile, and Ibex gitlink. Triage and
  Fleet are labeled LLP 0155 read-lane successor fixtures; Incident Room is
  its authority safety control; the three LLP 0129 write-lane workloads are
  explicitly source fixtures only, not lab approval or replacement manifests.
- **2026-08-02 — LLP 0138 immutability verified.** All fourteen retained app
  receipts plus the Zero runtime qualification (15 JSON receipts total) match
  their SHA-256 digests and Git blob identities at original evidence commit
  `8b2f07bf`; none has mutated. The same historical-byte check covers all six
  source acceptance manifests.
- **2026-08-02 — standards-real browser lane green.** The nine-check local
  lane passed on Google Chrome 150.0.7871.187: browser-native IndexedDB and Web
  Locks present; verified store commit; entire owned process group terminated
  by `SIGKILL`; same-profile relaunch recovered the exact entry; two tabs
  admitted one writer, reader adoption and `not_writer` refusal; writer-tab
  death transferred the lock; successor commit verified. Final cleanup proved
  both browser process groups gone, the static server closed, and the owned
  temporary profile removed. The ignored machine-readable receipt lives at
  `demos/zero-bakeoff/.runtime/stage0-browser/browser-harness.latest.json`.
  The coordinated guide-gap ticket stays open because this store-substrate
  lane intentionally does not run React/server/auth/replay behavior.
- **2026-08-02 — integration gates recorded on rebased main.** The final
  Stage-0 verifier/demo suite passed 4/4; the complete
  `packages/snapback-client` test and TypeScript chain passed; the real-browser
  lane passed 9/9 with no owned process groups or `profile-*` directories
  remaining; `scripts/check-guide.mjs` passed 46 pages/140 snippets/89 routes
  plus 29 host ops (15 inherited freshness warnings); and
  `./ref-check --verbose` passed 157 LLPs/3,221 refs with zero errors or
  unchecked references. The `llp-maintain` pre-PR audit found no co-evolution,
  stale-gloss, provenance, or status proposal for this evidence-only change.
  The full Rust library run reached 1,640 passing/1 ignored and inherited the
  same three deterministic `src/local.rs` live-query failures already recorded
  by closed settlement tickets 0133-02 and 0133-04; this branch changes no Rust
  or matcher code.
