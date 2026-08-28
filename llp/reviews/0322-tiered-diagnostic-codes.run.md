# Snapback simplification batch — super-refine run journal (Cluster B)

Primary run journal for **Cluster B** (shipped-artifact size and corpus
hygiene): LLP 0322, LLP 0314.001, LLP 0324.

Orchestrator, author authorization, reviewer roster, topology rationale,
round-1 target hashes, capsule and blindness posture, and instruction
brief hashes are recorded once in the batch journal:
[`0318-one-authoring-profile.run.md`](./0318-one-authoring-profile.run.md).
This file records Cluster B's rounds and verdicts.

Blindness note specific to this cluster: LLP 0314.001 is a new sub-LLP
of the existing LLP 0314, whose own review artifacts
(`0314-shipped-runtime-binary-size.{codex,grok}.md`) predate this loop
and are present in the tree. They review the parent research document,
not this target. Reviewers were instructed to read the parent and
sibling as context and to check 0314.001 for contradiction and
duplication against them, and were separately banned from reading
`llp/reviews/`. That ban is self-attested.

## Round 1

Launched concurrently with Cluster A. Target hashes:

| Target | sha256 |
|---|---|
| 0322 | `85779b29c2ef87d539e8aec5622dd70ce349c2ef7cbd5cb084b0fdd0baa71333` |
| 0314.001 | `ca39b0bf5e0fec8a5045e4ef4776935b1f2048a8a8114759ebac88bde6c94c2d` |
| 0324 | `64a12a6cad6a9419ab759f8f97bf17c4d0ea24571fea8213c7f1524fae57c252` |

### Verdicts

| Target | codex `gpt-5.6-sol` @ ultra | `grok-4.6` @ xhigh |
|---|---|---|
| 0322 | NOT READY (3 MATERIAL) | NOT READY (3 MATERIAL) |
| 0314.001 | NOT READY (4 MATERIAL) | NOT READY (2 MATERIAL) |
| 0324 | NOT READY (3 MATERIAL) | NOT READY (1 MATERIAL) |
| **SET** | **NOT READY** | **NOT READY** |

Cross-family convergence on all three documents' central defects:

- **0322** — both families: `httpClassified` is derived from a reviewed
  Rust test table in `crates/snapback-server/src/server/tests.rs`, not
  from wire reachability, so "the rest never cross a wire boundary" and
  the 1,702 upper bound are false. Both also found that LLP 0193
  mechanically refuses reclassifying an agent-triggerable code to
  internal, so the RFC's "does not weaken LLP 0193" is wrong — it is an
  amendment. Codex added that production consumers branch on exact codes
  (JS client retry set, Swift `StateMachine`, app-CLI frozen exit
  taxonomy, security-sensitive issuer tuples), so the demotion breaks
  machine behavior, not just tests.
- **0314.001** — both families: `contentHash` covers the regenerated
  whole flat plus the two JSON registries, not the packed set, so the
  RFC's OQ3 is backwards; grok noted this is the same error LLP 0314.000
  r5 already spent a round correcting. Grok additionally found the
  whole-corpus flat is **not** a concatenation of the section flats but
  a separate nav-order projection, which is the document's headline
  claim. Codex additionally measured that `gzip -9` on the container
  achieves a 92.9% reduction on the two registries, making the RFC's
  "compression of the encoding is a marginal fix" quantitatively false
  and offering a capability-preserving alternative to deletion.
- **0324** — both families: LLP 0259 is misattributed. Codex went
  further: 0259 scopes its budget to cold *app-building* agents and
  AGENTS.md routes those agents away from the LLP corpus entirely, so
  root compaction serves Snapback-engineering orientation, not the 0259
  packet. Codex also showed the arithmetic does not close — the ledger
  is 363 of 1,102 lines (~32%), and removing it plus every `Revised:`
  and `Related:` line still leaves 724 lines — while the proposed
  under-150-line root silently drops ratified material that existing
  documents already deep-link.

Verification of these claims is recorded in the Cluster A journal's
orchestrator-verification section; all spot-checks confirmed.

## Terminal — round 1, escalation to the author

Same terminal as Cluster A: the loop stops after round 1 for author
authorization rather than exhausting its budget. See
[`0318-one-authoring-profile.run.md`](./0318-one-authoring-profile.run.md).

For this cluster specifically, 0322 and 0314.001 both need an author
decision before a revision is meaningful: 0322 on whether to amend
LLP 0193's reclassification refusal, and 0314.001 on whether the
reduction mechanism is derived-record deletion or container compression
— codex's gzip measurement makes that a live choice the RFC never
considered. 0324 is the one document in the batch whose MATERIAL items
are all citation/arithmetic corrections with no design decision behind
them; it is revisable as-is on author authorization.

Targets stay `Review`. No revision applied.
