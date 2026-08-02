# LLP 0154 super-refine loop — convergence record

**Document:** `llp/0154-minimal-observability.rfc.md` (Minimal built-in
observability and analytics)
**Loop:** LLP 0005 review loop at super-refine intensity, run 2026-08-02
in **design-partner mode** at the author's explicit direction — both
families invited to propose significant design changes, not just find
defects.
**Coordinator:** the authoring Claude (Fable 5) session — per LLP 0005 it
did not count itself as a reviewer; all reviews came from fresh
non-author contexts.
**Families:** Claude (Fable 5) via fresh Claude Code subagent sessions;
OpenAI Codex via `codex exec` (`codex-cli` 0.146.0, `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, read-only sandbox). All rounds mutually
blind (no reviewer read `llp/reviews/` for 0154); every round SHA-pinned
its target and instruction capsule (hashes in the per-family artifacts).
**Final version:** v0.9, SHA-256
`369c8737d5d8a64f507f19d38f0a7be1a1f777426c2c50c7a42de2c0260b293c`
(1134 lines, Draft).

## Round ledger

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 1 | v0.2 | NOT READY (6 MATERIAL, 8 proposals) | NOT READY (2 BLOCKING, 7 MATERIAL, 7 proposals) | v0.3 — restructure |
| 2 | v0.3 | NOT READY (3 MATERIAL) | NOT READY (1 BLOCKING, 4 MATERIAL) | v0.4 — restructure |
| 3 | v0.4 | NOT READY (2 MATERIAL) | NOT READY (5 MATERIAL) | v0.5 — focused delta |
| 4 | v0.5 | NOT READY (1 MATERIAL: stale 0148 fact; repairs verified sound) | NOT READY (2 BLOCKING algebra, 2 MATERIAL) | v0.6 — focused delta |
| 5 | v0.6 | **READY** (3 MINOR residues) | NOT READY (2 BLOCKING mechanism catches) | v0.7 — spot fixes |
| 6 | v0.7 | **READY** (2 MINOR wording) | NOT READY (1 BLOCKING edge, 2 MAJOR) | v0.8 — spot fixes |
| 7 | v0.8 | (not re-run; READY×2 standing) | NOT READY (1 MAJOR, 1 unit site, 1 MINOR) | v0.9 — spot fixes, loop closed |

## Design changes adopted from the partners (the design-partner mandate)

The loop materially reshaped the RFC; the converged architecture is
jointly authored:

- **Network SQL endpoint deleted** (round 1, both families independently:
  `PRAGMA query_only` is not an authorization boundary and `ATTACH` could
  reach the sibling app DB). Survives as a local-only CLI hatch under a
  new deny-by-default authorizer, stricter than the Ibex
  allow-default-except precedent.
- **Cron rejected for maintenance** (round 1, Fable): LLP 0028 cron state
  persists inside the app database; retention/rollups ride the
  event-armed flush path instead.
- **Two-stage observation span + projection matrix** (round 2, Codex
  BLOCKING): LLP 0104 bills at admission, before outcome exists; the
  observation id is the correlation root, per-metric `eventId`s are
  derived, and an operation-instance rule prevents job/action and
  carrier/logical double-counting.
- **Typed operations as the cross-target contract** (round 2, Codex;
  LLP 0024 pattern): routes, CLI, control-MCP, console, and the hosted
  control-plane gateway are projections; resolves the Cloudflare
  credential locus (worker writes, control plane answers).
- **Subject-free Phase 1** (round 2, Codex; no IP capture either): the
  deferral of distinct-user metrics had removed its purpose; identity,
  deletion, and linking policy gate Phase 3.
- **Three-phase split** (round 2, both): kernel (Health/Logs) → hosted
  arms → declared product analytics + Usage over deletion-compatible
  aggregates; declared typed events (`defineTelemetry`) replace
  arbitrary `track()`.
- **Generation protocol bound to the reset-incarnation authority**
  (round 2 Codex, round 3 Fable): durable pair in `telemetry_meta`,
  crash matrix, all reads through visibility views (SQL hatch included).
- **Dual timestamps + persisted observation clock** (rounds 3–7, both):
  `ts_ms` admission-bound attribution (LLP 0104), `recorded_ts_ms` from
  a strictly-increasing per-flush-batch clock driving visibility,
  ordering, freshness, and bucketing.
- **Durable retention boundary protocol** (rounds 5–7, Codex): monotone
  floor advanced at boot/flush/config transitions, strict predicate,
  `max_days = 0` as the whole-subsystem off switch, day→ms conversions.
- **Watermarked rollup state machine** (rounds 3–6, both):
  `AUTOINCREMENT` ids (rowid reuse would break the partition),
  open/finalized hourly buckets with coverage intervals, exact coverage
  partition for `stats`, bounded tiers (90d hourly → 730d daily) with
  whole-interval eviction and durable aggregate floors, per-field
  exactness in the variance envelope.
- **C5 reclassification** (round 2, Codex BLOCKING): telemetry is
  identity-derived application data; `stats` = closed OperatorMetadata,
  `events`/`export` = `AdminSecretRead` + `no-store`; Cloudflare arm
  classification-only by default with raw surfaces `unsupported`.
- **Boot-settle idle semantics** (round 3, both): the LLP 0035
  zero-writes gate measures after the bounded settle write.

## Real repository defects found by the loop

- The `stats`/floor algebra defects were caught in *this document's own
  text*, but the loop also surfaced repo-level facts now recorded in the
  RFC: `guide/capabilities.md` lacks even a GAP row for observability in
  violation of its own policy (deliverable 4); `src/guide_mcp.rs` is
  resources-only, so the MCP seam is the control MCP's host-ops
  projection; rusqlite's `hooks` feature is active only transitively via
  `ibex-runtime` feature unification.

## Fleet-concurrency incident

LLP 0148 landed into the shared worktree mid-loop; v0.5 restated the
rounds-1–3 observation "0148 is absent" as a current fact, which Fable's
round-4 pass caught as verifiably false. Fixed in v0.6. Lesson recorded:
in a live shared worktree, re-verify repository facts at write time, not
at observation time. A mid-loop commit by another session (`cbbb58ec`)
also swept up in-progress loop files; content was verified intact.

## Stopping rule and honest residue

Loop closed after round 7 under the corpus's asymmetric stopping rule
(LLP 0150 precedent): **Fable READY×2** (rounds 5–6, architecture
explicitly endorsed both times), **Codex NOT READY×3** (rounds 5–7) with
monotonically shrinking, fix-of-the-fix findings (round 5: 2 BLOCKING
mechanisms; round 6: 1 edge + 2 consistency; round 7: 1 load-drift
design point + 1 missed unit site + 1 wording scope). The v0.9 repairs
implement Codex's own prescribed resolutions but are themselves
**unreviewed** — the standard residue of an asymmetric stop, disclosed
in the v0.9 header.

Open questions left for the author (OQ1–OQ4): the LLP 0104
span-ratification fixture gate (hard pre-implementation gate), Phase-3
identity/settlement policy, hosted retention ceilings, and Cloudflare
long-window history. None block a Draft→Review transition; OQ1 blocks
implementation of the seams.

## Proposed next step (author decides; this artifact changes no status)

The coordinator proposes **Draft → Review**: the architecture is
dual-family endorsed, every BLOCKING/MATERIAL finding through round 7
has an applied repair, and the remaining residue is one unreviewed
spot-fix revision plus author-owned OQs. The alternative — one more
Codex spot-check of the three v0.9 hunks before the transition — costs
one round and would convert the asymmetric stop into a possible
dual-READY; reasonable if the author prefers zero unreviewed text.
