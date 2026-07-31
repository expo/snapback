# LLP 0044 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-07-31: "Do an /llp-super-refine
on LLP 0044," noting the target had been further edited with Codex since
the v2 draft. The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as
> much as "there are no flaws in this."

The target is an RFC, so the capsule applies the RFC bar: design soundness
under concurrency/failure/adversarial clients, corpus consistency for
load-bearing citations, capability honesty, acceptance adequacy,
open-question honesty, external fidelity (TUS), and internal consistency.

Loop mechanics as in the 0116–0128 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli `codex exec`,
read-only sandbox), mutually blind on 0044 review artifacts, SHA-pinned
targets and instructions, verify-then-fix passes between rounds,
delta-scoped later rounds. Lineage note: this Claude Code session authored
the v2 revision and therefore does not count itself as a reviewer; the
review target is v3, an author-directed Codex-family rewrite of v2, and
both round reviewers are fresh contexts that authored neither. The loop
does not change `**Status:**`; adjudication is the author's.

## Round 1 — 2026-07-31

Instruction capsule SHA-256 (0044 RFC-bar variant of the series round-1
capsule):
`a679739ab3802616567aacc0ba1702ce262c9c7aad72968a31f295414ae296f1`

Target SHA-256 (v3, working tree, uncommitted on top of a1a96df5):
`e2ce07941a4e9202e81b1713fb5f7284bb1098eb923e24c97d15df6d18746511`

Verdicts and dispositions are appended as reviews are actually received;
no review is recorded by intent.

### Round 1 results

Both families NOT READY, with the corpus fact base verified strong by
both (both independently confirmed the 0124 manifest claims, the 0070
amendment anticipation, and the TUS 1.0.0 extension set against
tus.io). Codex: ten BLOCKING (no asset read-authorization policy or
0053 invalidation integration; typed references forgeable by ordinary
handler writes with no commit-time hook; incomplete/inconsistent
lifecycle state machines; cross-substrate "atomic" publication with no
crash-recovery protocol; gameable/underdefined quota accounting;
upload-reference identity resting on the ExpectedOperationV1 carrier
LLP 0108's reconciliation removed; neither runner generation supporting
the claimed processing semantics as specified; no URL identity model
for deduplicated blobs across delivery profiles; capability claims
conflating target, composition, and client-distribution evidence;
image processing without adversarial resource bounds) plus four
MATERIAL (TUS deferred-length/checksum gaps; binary seed fixtures
contradicting LLP 0109's closed artifact; backup/restore/export
neither designed nor capability-excluded; acceptance not covering
several normative commitments). Fable: two BLOCKING (the
image-finalization capability unnamed, leaving the flagship
photo-upload case undecidable across the slice boundary; video
location metadata silently retained while image location metadata is
mandatory-policy) plus seven MATERIAL (blob dedup reuse racing blob GC
unfenced; the single-current-attempt invariant unstated; acceptance
unconditionally commissioning Kotlin/Python SDKs 0064 does not commit
to; the strict-delivery-versus-lifecycle-v1 contradiction; the
revive-versus-supersede adjudication misattributed to LLP 0127; TUS
deferred-length implied but no lane admitting it; `pending → deleted`
unreachable in the stated transition set), seven DETAIL. The two
families independently converged on the TUS deferred-length gap, the
seed-fixture problem, the state-machine incompleteness, and the
acceptance-coverage gaps.

The v4 fix pass first verified the load-bearing reviewer claims against
the corpus (LLP 0108 §B's ExpectedOperationV1 removal, 0070's
host-plan-only first profile and its anticipated asset amendment,
0070's Draft-time capability bar, 0109's closed `SeedArtifactV1`,
0064's Swift-only commitment, 0039's gate scope, 0011's
no-permission-language record, 0127's cron-ledger-evidence bar — none
refuted), then applied all thirty concerns and the suggestions: the
read-authorization model (`owner-only`/`via-references` with LLP 0053
projection), commit-time `v.assetRef` enforcement on every write path,
the consolidated lifecycle transition tables with the
single-current-attempt invariant and `pending → deleted`, the
write-ahead publication/crash-recovery protocol with the transactional
blob condemned fence, the exact quota accounting vector (renditions
counted, count ceilings, store-fenced release linearization), the
0037-DTO reference identity replacing the removed 0108 carrier with
policy-generation freeze semantics, the durable asset-work ledger with
per-item receipts under 0127's bar, the delivery URL identity model
(per-`(asset, rendition)` aliases, no blob keys, no-store strict
posture, no-inline active content), adversarial image resource
ceilings with a hostile corpus, the named `asset-image-finalization`
fact with the location-policy rule extended to video (strip requires
the rewriting fact; retain is explicit; lifecycle-only targets refuse
default media intents), SDK claims staged per 0064, TUS 1.0.0 with
deferred-length refused and per-PATCH checksums for generated clients,
seed binary fixtures dropped to a 0109-amended later capability with
seeded assets through trusted finalization, backup/export as declared
Missing nonclaims, the threat-model summary, the acceptance section
rebuilt with traceability and fault-injection rows, and the Status
reattribution of the revive adjudication to the author. Target v4:
1431 lines, ref-check clean.

## Round 2 — 2026-07-31 (delta)

Delta capsule SHA-256:
`d9d975e56e17a3e3774e2cfbd4dcb8dc705aa30c16d0108cac90e929118db0f4`

Target v4:
`e0ed81a4eec436a552fa5dd2c8aca87eec611163000146a322dde2ef12b77065`

Each family's round-2 reviewer reads only its own round-1 artifact;
mutual blindness on the other family's artifacts and this journal is
maintained. Verdicts appended as received.

### Round 2 results

**Fable NOT READY (near-miss)** — all sixteen round-1 concerns verified
resolved with citations, both round-1 suggestions plus the SVG rule
adopted; one new MATERIAL (the `via-references` per-row read-decision
procedure is undefined for rows whose visibility only arbitrary handler
code decides — LLP 0011 separates pushdown-compilable row-visibility
filters from function-level arbitrary-code authorization) and four
DETAIL (mandatory-vs-default location-policy wording; rendition quota
exhaustion behavior unstated; the LLP 0053 companion classification
unclaimed; a transition-table cause conflating tombstone policy).
**Codex NOT READY** — three round-1 concerns fully resolved (URL
identity, seed fixtures, resource bounds; backup nonclaims also
accepted), most others partially resolved (mechanism present, machine
not fully closed), one unresolved (the exact upload-reference DTO
remains deferred to companion work); two new BLOCKING (the same
`via-references` row-authorization gap the Fable reviewer found
independently — the round's strongest convergence signal — and
policy-generation invalidation asserted without a scalable/atomic
mechanism, needing witness/version validation instead of per-asset
fanout) and four new MATERIAL (no deletion cascade retiring renditions,
blob references, and quota atomically; the checksum-less-client
integrity claim overstated — a freshly computed digest names bytes, it
does not verify them; durable-metadata classes without ceilings;
capability composition still mixing client rendering into a target
composite and leaving an S3-only lifecycle target unexpressible).

The v5 fix pass applied all round-2 items (re-verifying LLP 0011's
row-visibility-filter versus function-authorization distinction before
building on it — not refuted): the `via-references` decision procedure
pinned to declared analyzable row-visibility policies with the
owner-only fallback and deployment warning for function-authorized
tables; per-intent policy generations plus admission-time authorization
witnesses validated at finalization (no per-asset fanout); the
one-transaction deletion cascade with the `retired` rendition state and
generation-fenced in-flight work; the honest two-grade integrity
vocabulary (end-to-end verified versus received-bytes canonical);
ceilings on every durable record class plus the minimum accounting
unit; the closed publication-record and ledger state machines with the
uniqueness-loser convergence rule and transactional enqueue; the
store-parameterized lifecycle composite with client rendering moved to
distribution claims; the transaction-scoped admission-record custody
model with the import-refusal consequence stated; the companion
0007/0037/0012 amendment (plus 0053 classification) made a gating
implementation prerequisite; and the four Fable DETAILs, both
suggestions (Related trimmed to body-cited documents, the v3 header
parenthetical), and twelve new acceptance rows. Target v5: 1592 lines,
ref-check clean.

## Round 3 — 2026-07-31 (delta)

Delta capsule SHA-256:
`de2b4f358f82b46556e95c31b6328e194b057405fe9e5783f85d61eda75f6a57`

Target v5:
`081ab8c6919245ee54e31124f091e381e8bde8eafe10e673ba4ea744edcf4919`

Each family's round-3 reviewer reads its own round-1 and round-2
artifacts only; mutual blindness continues. Verdicts appended as
received.

### Round 3 results

**Fable NOT READY** — all five carried round-2 concerns verified
resolved; two new MATERIAL on v5's new mechanisms (witness validation
by raw version equality turns benign churn during a long upload into
terminal refusal with byte re-transfer as the only recovery, while the
acceptance row shows the narrower refuse-on-revocation intent; the
host-plan write path is enumerated under commit-time enforcement but
has no stated admission mechanism, leaving the flagship
ordinary-mutation attachment undecidable) and four DETAIL (`planned`
has no terminal path when work never re-drives; the policy-generation
"revoked" trigger is undefined; the closed transition table omits
reference-GC's own `ready → deleted` cause; the Related-trim header
claim misses 0107/0000). **Codex NOT READY** — six more items fully
resolved (admission custody, runner ledger, integrity grades,
capability composition, acceptance coverage, reference-identity-by-
explicit-gate); three new BLOCKING (via-references composes only the
row-visibility layer, so a broad analyzable policy could bypass a
narrower function-level gate on a mixed table — 0011's composition
model verified; the witness omits LLP 0007's negative/range/predicate
dependencies, so phantom insertion cannot invalidate an
absence-conditioned admission; the crash cut after object write but
before the `staged` commit leaves a `planned` record the sweep never
resolves — the same planned-state gap Fable found independently) and
one MATERIAL (the primary-as-rendition model against two enumerations
that read as charging and decrementing the primary twice). Both
families again independently converged, this round on the
publication `planned` gap and on the witness needing repair.

The v6 fix pass verified both new corpus claims before building on
them (LLP 0011 §Permission Composition's visibility+function
composition; LLP 0007's read-set contents — row ids, ranges, index
cursors, predicates, auth facts; neither refuted) and applied all ten
items plus the three suggestions: `via-references` tightened to
explicit asset-sharing declarations on analyzable row policies (a
broad filter can never bypass a narrower function gate; mixed tables
fall back to owner-only); the witness redefined as 0007's complete
read-set witness with absence first-class, and validation changed to
re-validate-then-refuse-on-denial under the frozen policy generation
(benign churn finalizes; revocation refuses; no re-transfer livelock);
the commit-boundary admission derived from schema-declared intent
restrictions for host plans and other non-handler paths (unrestricted
fields stay handler-attach-only); `planned → condemned` with recovery
probing planned records at the acknowledged-put crash cut and
receipted publication-record retirement; the primary rendition's blob
reference and quota charge counted exactly once (no second
asset-to-blob edge); the policy-generation revocation triggers
enumerated; reference-GC's `ready → deleted` cause added to the closed
table; lane-neutral integrity grades; the explicit `claimed →
enqueued` lease-expiry transition; 0000/0107 cited so the Related-trim
claim holds; and seven acceptance rows added or extended (mixed-policy
bypass, phantom insertion/empty-query/reparenting, benign churn,
host-plan admission both shapes, planned-recovery crash cut,
primary-accounting exactness, strip-declared wording). Target v6:
1695 lines, ref-check clean.

## Round 4 — 2026-07-31 (delta)

Delta capsule SHA-256:
`7d42de7db45150b5d34ef410d7969039c31298dd84527c73ec19c7b393638b3c`

Target v6:
`680a9980763c162c17b1cca08a6a204091c4ce7191a1634d2d7bdc68e59de179`

Each family's round-4 reviewer reads its own rounds 1–3 artifact only;
mutual blindness continues. Verdicts appended as received.

### Round 4 results

**Fable READY** — both round-3 MATERIALs verified resolved (the
complete-read-set witness with re-validate-then-refuse-on-denial,
checked against 0007's actual enumeration; the schema-derived
commit-boundary admission for host plans, checked against 0007's
Option A transaction model), all four DETAILs resolved, both
suggestions adopted, the delta's riskiest surfaces stress-tested; two
new non-gating DETAILs (the re-validation code substrate after a
redeploy; a missing revocation-trigger acceptance row).
**Codex READY** — all three round-3 BLOCKINGs and the MATERIAL
verified resolved with citations; no new BLOCKING or MATERIAL; two
non-gating DETAILs (the sweep summary omitting `planned`; "raw
string" overloading admitted host-plan operands). **LLP 0044
CONVERGED dual-family READY on the v6 hash
(`680a9980763c162c17b1cca08a6a204091c4ce7191a1634d2d7bdc68e59de179`),
four rounds.**

## Acceptance under LLP 0130 SD-4

The four reviewer DETAILs (all explicitly non-gating) were folded at
acceptance time as v6.1
(`0ddcec8b49c3e763e7aedabf03d36910b02928d423e147b62efe43a2ac622b06`,
1728 lines, ref-check clean): the frozen-generation re-validation
substrate with its bounded artifact-retention obligation, "materially
identical" pinned to validated-output-DTO equality, the sweep summary
covering `planned`, the untyped-write disambiguation, the
revocation-trigger acceptance row, and the warning-enumeration note.

**Accepted under LLP 0130 SD-4**, the author's standing acceptance
rule for documents commissioned by the accepted programs. LLP 0044 is
the file-storage owner LLP 0127 (Accepted) commissions in §Sequencing
4 and routes for parallel start; the concurrent fleet session that
authored LLP 0130 recorded this loop as SD-4-eligible. The three
conditions, explicitly checked:

1. **Dual-family READY with zero unresolved MATERIAL concerns** — ✓.
   Fable READY (R4) and Codex READY (R4) on the same pinned v6 hash;
   every BLOCKING and MATERIAL concern across all four rounds is
   dispositioned resolved in the family artifacts; the only remaining
   items are the four DETAILs both reviewers marked non-gating, folded
   as v6.1.
2. **Within its decided scope** — ✓. The loop narrowed rather than
   widened: SDK claims restaged under LLP 0064 (no new SDK program
   commissioned), seed binary fixtures deferred to an 0109 amendment,
   backup/export/video-finalization declared Missing nonclaims, the
   companion 0007/0037/0012 amendment made a gating prerequisite, and
   the 0070 boundary honored (no durable-work claim while 0070 is
   Draft). The document remains the v1 asset-subsystem design 0127
   commissioned.
3. **Weakening no evidence boundary** — ✓. Every change raised the
   evidence bar: integrity claims split into honest grades,
   capability composites separated from client-distribution evidence,
   per-item ledger receipts satisfying 0127's cron-ledger bar,
   acceptance rebuilt with a traceability meta-requirement and
   fault-injection rows.

Status applied: Draft → Accepted (the document entered the formal
loop at the author's direction; SD-4 authorizes the acceptance).
Implementation remains gated on the companion LLP 0007/0037/0012
amendment freezing the reference/admission/sharing-declaration
encodings and the LLP 0053 classification.

## Program conclusion

| Doc | Final version | Fable | Codex | Rounds |
| --- | --- | --- | --- | --- |
| 0044 | v6.1 | READY (R4) | READY (R4) | 4 |

No reviewer finding was refuted by verification in any round; all
thirty round-1 concerns, ten round-2 concerns, six round-3 concerns,
and four round-4 DETAILs were applied. Both families independently
converged on the same defect three times (the `via-references`
row-authorization gap in round 2, the publication `planned` gap and
witness repair in round 3) — the mutual-blindness design doing its
job. The revive-versus-supersede adjudication (LLP 0127 open question
8, file-storage arm) is recorded in the document's §Status as the
author's 2026-07-31 direction; 0127's own queue entry remains as
routed.
