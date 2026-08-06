**Reviewer family:** GPT-5
**Provider / runtime:** codex exec cli-runner
**Date:** 2026-08-05
**Redacted:** no
**Method:** cli-runner
**Bound to revision:** sha256 d247470d3069f507a420356be4e2c11eea1671c918cd57872663b5961df65c61

## Verdict: NOT READY

## Round-1 concern resolution

| Prior finding | Resolution | Justification |
| --- | --- | --- |
| MATERIAL 1 — product recovery absent | **RESOLVED** | The baseline now distinguishes the unit-tested `recover()` primitive from an operable surface, and Phase 1 item 2 explicitly wires a recovery verb/host operation before relevant exits. |
| MATERIAL 2 — consumers precede safety/diff gates | **PARTIALLY RESOLVED** | Phase 2a is now constrained to single-fork/single-owner dogfood and Phase 2b is explicitly Phase-3-gated, but the Summary still orders all worktree integration after isolation/diff, and Sequencing says both that Phase 4 does and does not gate Phase 2b. |
| MATERIAL 3 — exact-diff prerequisites absent | **RESOLVED** | Phase 4 item 0 now requires the LLP 0164 base/preimage substrate, LLP 0165 writer-authority/SQLite-authorizer choke point, and bounded retention/base availability; its exit is expressly bound to them. |
| MATERIAL 4 — governing-document and acceptance gates absent | **PARTIALLY RESOLVED** | Phase 6 now gates on accepted LLP 0158, accepted LLP 0164/0165, and every applicable LLP 0162 row including row 13, but it omits Draft LLP 0163 even though the acceptance-tail ticket requires all three extracted Specs to complete review/acceptance before publication. |
| MATERIAL 5 — no valid publication authority selected | **PARTIALLY RESOLVED** | Phase 0 item 6 correctly defers the carrier decision, but it does not name the owner/acceptance path for a new local/package carrier, and Phase 6 item 1 still assumes every selected mechanism produces a "publication manifest," which is not true of a Guide-only capability-index claim. |
| MATERIAL 6 — Phase 5 reopens asset decision | **RESOLVED** | Phase 5 now accurately follows LLP 0158 OQ5: local fork-private same-cut copying or continued refusal, with shared/content-addressed custody deferred to hosted/F2 under an owner-controlled amendment. |
| MATERIAL 7 — LLP 0099 given fork authority | **RESOLVED** | Phase 8 now treats LLP 0099 only as reusable migration-executor infrastructure and assigns fork/containment semantics to LLP 0158 F2 through LLP 0072. |
| DETAIL 1 — ambiguous vendored LLP references | **RESOLVED** | The operative reference now names `vendor/llp/llp/0005-rfc-process.guide.md`, and LLP 0010 is identified as vendored in `Related`. |
| DETAIL 2 — cold/live copy wording | **RESOLVED** | The baseline explicitly says both cold- and live-parent paths materialize through SQLite backup, not clonefile/reflink. |
| DETAIL 3 — resource diagnostics precede limits | **RESOLVED** | Phase 1 now reserves the diagnostic surface while deferring final resource-limit wording until Phase 3 defines the limits. |
| DETAIL 4 — effectively answered open questions | **RESOLVED** | OQ1 now asks the residual renewal-maximum question, and OQ3 explicitly identifies the remaining worktree-versus-owner/run unification choice. |
| DETAIL 5 — Phase 7 implied all four projections | **RESOLVED** | Item 5 now applies parity only to surfaces that exist and expressly preserves LLP 0184's `cliOnly`/`mcpOnly`/`apiOnly` classifications. |
| DETAIL 6 — incomplete `Related` set | **RESOLVED** | `Related` now includes LLP 0163, LLP 0099, LLP 0044, LLP 0072, LLP 0134, and the other directly consumed authorities. |

## New MATERIAL findings

1. **The new LLP 0024 ownership bullet is materially inaccurate.** LLP 0024 owns host-operation identities, DTOs, and the shared result envelope, but it expressly points the out-of-band ready-file handshake and `schemas/host-ready.schema.json` to LLP 0030. LLP 0184, not LLP 0024 alone, owns the control-catalog completeness and projection-parity rules Phase 7 invokes. The current bullet would send Phase 0's ready-descriptor freeze and Phase 7's parity work to the wrong owners; it should split LLP 0024, LLP 0030, and LLP 0184's responsibilities explicitly.

2. **Phase 7 drops the newly required recovery operation from the agent-control lifecycle.** Phase 1 makes `recover` necessary for repairing product-created quarantined states, but Phase 7 item 1 projects only create, inspect/list, diff, renew, drop, and reap. LLP 0184's completeness rules require every real CLI control to receive a catalog disposition. The Plan must either expose recovery as a typed operation or explicitly classify it as `cliOnly`/operator-only with its authority and deferral reason; otherwise Phase 7's exit is incomplete.

## New DETAIL findings

1. Phase 2b item 3 conflates two different state transitions: automatic reap cleans expired published forks, while the recovery verb repairs incomplete/quarantined publication states. The interruption corpus should state which crash states are expected to recover, reap, or drop.

2. Phase 4 item 0 should bind the bounded-availability rule to whichever exact substrate LLP 0164 selects, including retained first-write preimages; "finite history-retention" is otherwise slightly too generic to prove that the selected preimage substrate remains available.

## Discussion

The digest matched before review and again at the final check. I read the target and my own round-1 artifact in full. I did not read the forbidden Claude-family review or run journal, and no broad search included `llp/reviews/`; no forbidden content entered the review context.

The Phase 2 split is real progress. Phase 2a can reasonably precede Phase 3 as explicitly experimental, single-owner dogfood, especially because publication remains gated later. Phase 2b is unambiguously barred from starting before Phase 3. What remains defective is the contradictory treatment of Phase 4: the phase heading and critical-path sentence allow Phase 2b alongside Phase 4, while the later sequencing bullet says Phase 4 also gates Phase 2b. The Summary likewise still describes all worktree integration as following isolation and diff closure. Implementers cannot derive one dependency graph from the document as written.

Phase 4 item 0 does more than relocate the old problem: it assigns the needed owner requests, requires adoption of their resulting substrate and completeness choke point, and makes the exit depend on them. Phase 5 is now internally consistent, and LLP 0158 OQ5 directly supports its "already decided" framing.

Phase 6's main gates are substantially stronger, but the handoff remains incomplete. The acceptance-tail ticket explicitly keeps LLP 0163, LLP 0164, and LLP 0165 in Draft and requires the extracted Specs' real review/acceptance loop before publication. Phase 6 names only the latter two. Separately, Phase 0 may choose an LLP 0113 capability, an LLP 0061 Guide claim, or a new source/package carrier, but Phase 6 assumes a manifest-shaped result and does not require acceptance of a newly designed carrier authority. Those are defective publication decisions, not implementation-level detail.

The corrected LLP 0164/0165 and LLP 0099/0072 ownership boundaries are accurate. The remaining authority problem is the new LLP 0024 bullet: ready-file custody belongs with LLP 0030, while LLP 0184 owns the catalog/parity layer that consumes operation facts from LLP 0024 and CLI-side declarations. Because unresolved MATERIAL concerns remain, the revision is **NOT READY**.
