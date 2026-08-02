# LLP 0156 super-refine loop — convergence record

**Document:** `llp/0156-minimal-error-tracking.rfc.md` (Minimal built-in
error tracking)
**Loop:** LLP 0005 review loop at super-refine intensity, run 2026-08-02
in **design-partner mode** at the author's explicit direction — both
families invited to propose significant design changes, including
whether to go a different direction entirely, not just find defects.
**Coordinator:** the authoring Claude (Fable 5) session — per LLP 0005
it did not count itself as a reviewer; all reviews came from fresh
non-author contexts.
**Families:** Claude (Fable 5) via fresh Claude Code subagent sessions;
OpenAI Codex via `codex exec` (`codex-cli` 0.146.0, `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, read-only sandbox). All rounds mutually
blind (no reviewer read `llp/reviews/` for 0156); every round
SHA-pinned its target and instruction capsule (hashes in the per-family
artifacts).
**Final version:** v0.7, SHA-256
`fc4f3d332861e6cbe8fbd916199617845a73087c173154e5f0fc5c7ee4a8ecda`
(1422 lines, Draft).

## Round ledger

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 1 | v0.2 | NOT READY (2 MAJOR, 7 MATERIAL, 2 MINOR; 5 proposals; direction endorsed) | NOT READY (5 BLOCKING, 4 MAJOR, 2 MATERIAL; 5 proposals; direction endorsed) | v0.3 — restructure (Phase E0 born) |
| 2 | v0.3 | NOT READY (3 MAJOR, 5 MATERIAL, 5 MINOR) | NOT READY (3 BLOCKING, 5 MAJOR, 2 MATERIAL, 1 MINOR) | v0.4 — restructure of the repairs |
| 3 | v0.4 | NOT READY (1 MAJOR, 2 MATERIAL, 6 MINOR) | NOT READY (2 BLOCKING, 3 MAJOR, 2 MATERIAL, 1 MINOR) | v0.5 — focused; convergent barrier fix |
| 4 | v0.5 | **READY** (5 MINOR editorial residues; re-review declined) | NOT READY (2 MAJOR, 3 MATERIAL, 1 MINOR) | v0.6 — all 11 residuals |
| 5 | v0.6 | (not re-run; READY standing) | NOT READY (0 BLOCKING/MAJOR; 4 MATERIAL, 1 MINOR) | v0.7 — spot fixes, loop closed |

Loop closed under the corpus's asymmetric stopping rule (LLP 0154/0150
precedent): Fable READY with only editorial residues and an explicit
no-re-review recommendation; Codex NOT READY in rounds 3–5 with
monotonically shrinking, fix-of-the-fix findings (2B+3M → 2M+3Mat →
4Mat+1Min). The v0.7 repairs follow Codex's round-5 prescribed
resolutions but are themselves unreviewed. **The author decides the
status transition.**

## Directional verdict (the design-partner mandate)

Both families, independently, in round 1: **build it, in exactly this
shape** — a separate document (not folded into 0154), a consumer of the
0154 substrate (not a new pipeline), agent-first typed operations, an
issue index rather than a miniature Sentry. Both weighed and rejected
the same alternatives (Sentry-envelope ingestion for the server side;
fold-into-0154; agent-native-no-console; issues-as-app-data). Both
independently proposed the same inversion — **Sentry-envelope
*egress*** — which survives in v0.7 as the honestly-renamed
Sentry-formatted alert bridge plus a named future eligible-event
forwarder. Neither family reopened the architecture after round 1.

## Design changes adopted from the partners

- **Phase E0 exists because of the loop.** Round-1 Codex (BLOCKING):
  "every failed observation" conflated LLP 0108 declared refusals with
  actionable faults — now a versioned per-event classifier with an
  exhaustive precedence table, manifest opt-ins keyed by `appCode`,
  and (round 4) a coupling rule binding disposition changes to
  fingerprint-scheme bumps.
- **The settle-path carrier.** Round-1 both families: the draft's
  stack-capture claim covered only the async-failure seam; ordinary
  handler throws settle through a JS envelope carrying only
  code/message. E0.2 now specifies the envelope extension with
  poisoned-getter extraction, a grammar-validated `errorClass` with a
  reserved `unclassified` sentinel (round 2 Fable), and a
  deterministic whole-record byte allocator inside 0154's 8 KiB cap
  with a total occupant order (rounds 3–4).
- **The three-table split.** Round-1 both: retained message/stack
  snapshots violated the aggregates-outlive-raw-retention argument —
  classification-only `error_groups` (grammar-constrained by
  construction), raw-tier `error_exemplars` under the raw retention
  floor, bounded `error_transitions` history (explicitly not an audit
  authority — round 2 Codex).
- **The restart-safe resolved-seq barrier.** Round-1 Codex: buffered
  pre-resolve failures could falsely regress. Round-2 both: the fix
  wasn't restart-safe. Round-3 both, identical crash schedule: the
  live counter runs ahead of the flush-persisted high-water. v0.5:
  the resolve transaction advances `enqueue_high_water` itself, with
  a defensive boot seed. Round-4 Fable verified the closure.
- **Enqueue sequences as the universal acceptance order** (round 3
  Codex): 0154's per-batch clock stamps cannot order within a flush;
  sequences now back the barrier, first/last-seen, regression
  ordering, release activations, and the since-release preset.
- **Fingerprint versioning + rollout suppression** (rounds 1–4): a
  normalizer change would have orphaned every issue; scheme versions
  are stamped, and version bumps open a persisted suppression window
  with dual-stamped predecessor hashes so maintenance cannot fire an
  alert storm.
- **The alert outbox as a delivery protocol** (rounds 2–5): immutable
  per-destination payload snapshots, boot/flush recovery fenced to
  the current generation with a dispatch-time claim check,
  at-least-once with `delivery_id` as the receiver dedup key,
  destination-generic resolve-validate-and-pin transport rules
  covering the Sentry DSN.
- **Honesty renames:** Sentry egress is an *alert bridge*, not event
  forwarding (round 2 Codex); the regression guarantee is scoped to
  the group horizon; issue counts inherit the telemetry loss model
  (CE5).
- **Adopted Fable proposals:** deploy-integrated bulk resolve
  (first-in-deploy economics), the canned since-release preset,
  the `subsystem` facet, transition markers on the Health timeline.
- **Identity resolution:** minted TimeOrdered `iss_` ids with
  determinism in the `(generation, fp_version, fp_hash)` unique key —
  reconciling round-1 Fable (0148 derived-body precedent exists) with
  rounds 1–2 Codex (`src/ids.rs` has no Derived body; Random is
  `usr_`-exclusive).

## Open author decisions (review cannot resolve)

- **Status transition** — the loop's verdict pattern supports leaving
  Draft for Review at the author's discretion; v0.7's five spot
  repairs are unreviewed.
- **OQ-B** — accept the three triage-state loss classes for v1
  (leaning yes, both families endorse with conditions now met).
- **OQ-C/OQ-G jointly at E3 kickoff** — symbolication custody and the
  client-ingest protocol (Sentry-envelope leaning, unanimous market
  signal).
- **OQ-D hosted arms** (Cloudflare `unsupported` in the first
  capability matrix — both families endorse), **OQ-E alert kit at
  E2**, **OQ-F 0072 linkage**.
- **Cross-document amendments** — the LLP 0154 amendments (registry
  vocabulary + `failure_disposition`, D2 allowlist keys + allocator,
  D3/`telemetry_meta` additions, optional lifecycle marker) and the
  LLP 0108 envelope extension need coordination with those documents'
  own loops before implementation.
