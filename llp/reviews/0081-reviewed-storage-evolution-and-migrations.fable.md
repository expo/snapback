**Reviewer family:** Claude
**Provider / runtime:** Claude Code CLI (Fable)
**Date:** 2026-07-20
**Redacted:** no
**Method:** cli-runner

I've read LLP 0081 in full and inspected the governing context in LLP 0007 (portable storage contract, conservative applier, commit-version graduation), LLP 0072 (control plane, backup/restore, rollback postures), LLP 0080 (projection rebuild invariants), plus the relevant sections of LLP 0063 (Workstream 6 / Step 5–6 gates), LLP 0036 (secrets/backup posture), LLP 0041 (packaged CLI), and LLP 0014 (Durable-Object resolution and phase ladder). Here is the review.

---

# Review: LLP 0081 — Reviewed storage evolution and migrations

## Overall assessment

This is a good proposal with the right architecture. The core commitments — a closed typed step vocabulary instead of raw SQL, a digest-bound approved plan as the only executable authority, predecessor-authoritative-until-one-publication-transaction, and an honest refusal to claim online migration or generic down migrations — are all correct for this system and consistent with the corpus it plugs into. The non-goals section is genuinely honest rather than decorative, and the acceptance list is unusually concrete (injected crashes at every batch boundary, both deployment orderings tested in both directions).

However, the RFC has three spec-level gaps that sit exactly where its strongest claims live: the plan-determinism story contradicts itself, the "data proof" never defines what its digests are compared against, and the commit-version/change-journal semantics across publication are undefined despite LLP 0007 making those invariants load-bearing for every retained client. As written, an implementer could build something that passes a plausible reading of the acceptance suite while the approval digest, the proof, and the sync contract are each quietly weaker than the document implies. These are fixable in a revision without changing the architecture, and they should be fixed before this moves past Draft.

## Strengths

- **Closed steps, no raw SQL on the portable path (§3).** This is the correct continuation of LLP 0007's "portable by default / explicit escape hatches" principle and of the Valet lesson that engine-specific behavior silently becomes the contract. Representing rename/type-change as add/copy/validate/publish/retire rather than in-place `ALTER` is exactly LLP 0007 §Schema Evolution's sanctioned idiom, made executable.
- **Digest-bound approval with no "approve latest" (§2).** Fencing approval to exact plan bytes, exact target, and expiration — and invalidating on any source/target/capability edit — is the right agent-first posture and matches LLP 0072's "exact ids, fresh identity read, no cached alias" discipline.
- **Predecessor-authoritative single-publication crash model (§4).** One final transaction publishing schema, generations, function identities, and the commit boundary together, with fail-closed handling of ambiguity and a ban on guessing from physical tables, is the right shape and dovetails cleanly with LLP 0080 §6's projection rebuild invariants (which explicitly delegates approval/rollback here — the division of labor between the two documents is clean).
- **Deployment-ordering declarations proven, not inferred (§6).** `successor-only` as the default and compatibility "proven from generated function/schema facts, never inferred because a field appears optional" directly implements LLP 0063 Workstream 6's inference-soundness posture.
- **Honest rollback boundary (§6, Non-goals).** Refusing generic down migrations, requiring explicit acknowledgment of irreversibility at approval, and refusing to treat a backup's existence as restore proof align with LLP 0072's `codeOnly`/`forwardFix`/`restoreRequired`/`blocked` honesty and avoid the industry-standard lie of a symmetrical `down()` function.
- **Preflight fencing of destructive targets (§7).** Refusing globs, unresolved substitutions, and implicit "current" deployments matches LLP 0072's target-descriptor discipline.

## Concerns

**C1 (High) — Plan determinism contradicts recorded migration constants.** §2 requires canonical serialization "byte-identical across clean checkouts," and the acceptance list requires "preview is byte-identical." But §3 says "a migration timestamp or ID namespace is generated once, recorded in the plan, and replayed as data." A plan containing a generated timestamp cannot be byte-identical across two preview runs, so either the acceptance criterion is unsatisfiable or the constants silently fall outside the digest — and the digest is the entire approval story. *Resolution:* split the plan into a deterministic core (digested, approved) and a sealed constants section bound at approval or first apply, each with its own digest recorded in the receipt; or make preview accept an explicit seed input recorded in the invocation. State which digest approval binds.

**C2 (High) — The data proof has no defined oracle.** §5 requires "canonical content digests over migrated tables," but never says what the digest is compared *against*. A digest of the successor table alone proves only that the successor equals itself. For `CopyField`/`BackfillField`/`CopyTable`, the expected digest is computable: run the closed backfill expression over the predecessor through an independent evaluator (the pure portable evaluator LLP 0080's acceptance already requires) and compare. Without that, "verification" degrades to row counts plus constraint checks, and the acceptance bullet "exact content-digest oracles" has no defined semantics. *Resolution:* define the proof as dual evaluation — expected digest computed from predecessor state plus the plan's expressions by an evaluator independent of the executor, compared to the actual successor digest. Also clarify "bounded reject counts" (§5): §3 says unconvertible rows fail before publication, so a successful receipt's reject count should be provably zero — say which steps, if any, admit nonzero rejects.

**C3 (High) — Commit-version, change-journal, and stream-identity semantics across publication are undefined.** LLP 0007 pins per-app gap-free version streams, fail-closed decoding of every durable ordering fact, and an exact retained-journal-high-water-equals-head invariant at open. LLP 0072 gives deployments a `streamIncarnation`. LLP 0081 publishes a "commit-version boundary" but never states: whether backfill/copy writes advance the version stream and emit change-journal rows (which retained clients would then try to consume); whether copied rows keep their `_version`s; whether publication bumps the stream incarnation or raises the retention floor to force resnapshot; and how the successor satisfies LLP 0007's head/journal-cut proof at first reopen. §5's "retained/live clients … resnapshotting under their existing handshake" asserts the outcome without the mechanism. *Resolution:* pin it — the cleanest contract is that migration writes are never application changesets, publication either bumps the stream incarnation or sets the retention floor to the boundary version, and the successor must pass LLP 0007's head/journal-cut proof before reopen. Add a retained-offline-client-across-migration test to acceptance; the current list never exercises a real client.

**C4 (Medium-high) — The preview→approve→apply race on a live target.** §2 binds the "predecessor-commit" identity into the plan, and staleness invalidates approval. On any live app, ordinary traffic advances the commit version between preview and apply, so a strict reading makes every approval instantly stale (`SNAPBACK_MIGRATION_PLAN_STALE` always fires), while a loose reading leaves undefined which drift invalidates. Meanwhile preview cannot acquire the barrier (it's read-only by design). *Resolution:* define staleness precisely — schema hashes and declarations pin strictly; the previewed commit version is advisory, and all data-dependent preconditions (`ValidateRequired`, `ValidateUnique`, conversion totality) are re-proven under the barrier before any physical step, which §4 already gestures at. Alternatively (or additionally) add an explicit `snapback migrate quiesce` verb so an operator can preview against frozen state. Note also that re-proving full-table uniqueness under the barrier *is* the downtime; the receipt should record measured barrier duration.

**C5 (Medium-high) — Approval has no authenticity model.** §2 records approver identity, timestamp, and expiration, but `snapback migrate approve migration.json` appears to be a local file operation. In an agent-first system, the same agent that generated the plan can execute `approve` — making approval a ritual, not a control. Open question 3 acknowledges the signature question but the RFC should pin the floor now: for production/hosted targets, approval must be registered with the control plane as an LLP 0072 `operationId` with actor audit, and the approving authority must be distinct from (or at least explicitly the same as, and recorded as such) the plan-generating authority. A bare local-file approval should satisfy only the local development profile.

**C6 (Medium-high) — Backup secret handling contradicts the plane separation.** §7 binds the backup "encryption/key reference under LLP 0036," but LLP 0036 is the *application* secrets contract, and LLP 0072 explicitly keeps control-plane material out of app-level secret APIs and requires backup manifests to record "secret names and generations, never values," with encryption keys living outside the protected deployment. Separately, LLP 0036 documents that instance-dir byte-level backups include `config.json` and therefore carry live keys. A pre-migration checkpoint that is a byte snapshot would embed secret values while §7 only promises log redaction. *Resolution:* state which backup contract migration checkpoints follow (it should be LLP 0072's manifest contract for the hosted profile), move the key reference to control-plane custody, and explicitly declare the `config.json` posture for local byte-level checkpoints.

**C7 (Medium) — Post-publication rollback condition is ill-defined.** "Proof that no successor-only writes have occurred" (§6) implies classifying post-publication writes by predecessor-expressibility, which is a rabbit hole (any write touching an added-required field? a row inserted under a new uniqueness constraint?). *Resolution:* pin it to zero successor commits — provable as "commit version unchanged since the publication boundary" — and observe that since predecessor generations are retained through the rollback window anyway (§3 retirement fencing), the zero-write rollback primitive can be a journaled *republish of the predecessor generation* rather than a "generated reverse plan," which is simpler, cheaper, and more obviously truthful. Reserve reverse plans for the cases that genuinely need them, and state whether a reverse plan is itself a plan requiring its own preview/approval — the CLI's `migrate rollback migration.json` (which takes the *forward* plan file) leaves this ambiguous.

**C8 (Medium) — Journal locus and the meaning of "ambiguous publication" are unstated.** §4 never says where the journal lives. If the journal lives in the target database and the publication journal entry commits inside the publication transaction, post-crash publication state is never ambiguous on SQLite — and `SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS` covers only genuinely corrupt states. If the journal is external (control plane), ambiguity is an expected crash outcome and needs a defined reconciliation. These are different systems. *Resolution:* pin the journal to the target's durability domain, require the publication journal write to be atomic with publication, and define `PUBLICATION_AMBIGUOUS` as a corruption code, not a crash-recovery code. Also state that resume after crash re-acquires the lease and re-establishes the barrier before touching any shadow generation, and whether approval expiry blocks resume of an in-flight plan.

**C9 (Medium) — Hosted acceptance is circular with LLP 0072 and silent about Durable Object realities.** Acceptance requires the corpus on "every currently claimed hosted storage evaluator," but LLP 0072 has not chosen its first adapter, and LLP 0014's resolution puts all hosted data on Durable Object SQLite — where the executor faces eviction at any time, request duration limits, and statement/parameter caps, and where the exclusive barrier must be durable DO state, not process state. The journal/batch design handles this in principle, but nothing says who runs the executor for a hosted target (operator CLI over the network? a control-plane-driven DO-resident loop?) or requires the hosted evaluator to support the fault-injection hooks the acceptance suite depends on. *Resolution:* name the intended first hosted evaluator (or explicitly gate the hosted acceptance row on LLP 0072 OQ1's answer and allow a SQLite-only "local profile complete" milestone), require injection-hook parity as part of the hosted evaluator's capability claim, and drop or fence the Postgres mention in OQ2 — Postgres is not currently a claimed target and LLP 0046 owns that path.

**C10 (Medium) — Verification queries collide with LLP 0007's query bounds.** Every portable query is capped at 1,024 rows and 500 bind values. Full-table uniqueness validation, conversion-totality preflight, and content digesting cannot run through that surface. The migration engine needs its own privileged streaming keyset-scan primitive, explicitly carved out from the app-level bounds and named in the capability model — otherwise "executable verification" (§5) is unimplementable as specified, or implementers will quietly reach for raw SQL, which §3 forbids.

**C11 (Low) — Vocabulary drift with LLP 0072.** 0075's `successor-only`/`dual-compatible`/`predeploy-compatible` (deployment ordering) and 0072's `codeOnly`/`forwardFix`/`restoreRequired`/`blocked` (rollback posture) are complementary but overlapping compatibility facts consumed by the same deploy tooling. Add the mapping table (e.g., `dual-compatible` is what makes `codeOnly` rollback provable) so the two documents cannot drift. Also low: `PublishTableGeneration` as a step name is misleading given §4 says nothing publishes before the single final transaction — rename to `StageTableGeneration`; and "recoverability preflight" (§7) needs a freshness definition (is a restore drill from last month sufficient evidence for today's apply?).

## Suggestions

1. **Compose the restore drill with production apply (rehearsal migrations).** LLP 0072 already requires backup → restore-to-isolated-target drills. For the trusted single-tenant scale this profile targets, production apply could optionally first execute the identical approved plan against a restored copy of the latest backup, verify the full proof there, then apply to production. This converts the mandated drill into a migration preflight nearly for free, catches data-population surprises before the barrier, and produces the strongest possible receipt. Worth naming as the recommended production posture even if optional.
2. **Make the journal the receipt's source of truth.** Rather than assembling `MigrationReceiptV1` as a parallel artifact, define the receipt as a digest-sealed projection of the journal plus the approval and plan bytes. One fewer thing that can disagree with reality.
3. **Adopt predecessor-republish as the named zero-write rollback primitive** (per C7) — it falls out of machinery the RFC already requires.
4. **Assess LLP 0051's expressive sufficiency before acceptance.** The whole rename/type-change story routes through closed backfill expressions. If the LLP 0051 vocabulary can't express common total conversions (string formatting/parsing, conditional defaults), real applications fall off the paved path at their first schema change, and the pressure lands as demand for the raw-SQL opt-out. Run two or three real Partitime-class schema changes through the vocabulary on paper and record the result in this RFC.
5. **Add a measured-downtime field to the receipt** (barrier acquire → publication), mirroring LLP 0072's bounded-downtime honesty and feeding its OQ3.

## Open questions the document must answer (beyond its own four)

1. Where does the journal live, and is publication's journal write atomic with publication? (C8)
2. Do migration writes advance the commit-version stream or emit change-journal rows, and does publication bump `streamIncarnation` or move the retention floor? (C3)
3. Which digest is approved when plans contain recorded constants, and how do byte-identical previews coexist with once-generated values? (C1)
4. What is the expected-value oracle for content digests? (C2)
5. Who executes the migration for a hosted target, and how does the barrier survive Durable Object eviction? (C9)
6. Must the approving authority be distinct from the plan-generating authority for production, and where is the approval registered? (C5)
7. Which staleness dimensions invalidate approval on a live target — schema only, or commit version too? (C4)

## Recommended next step

Revise before widening review: fix the three high-severity gaps (C1 constants/digest scheme, C2 proof oracle, C3 version-stream semantics) and pin the approval authenticity floor (C5) and backup secret posture (C6) — all are contract clarifications, not architecture changes. Then run the LLP 0005 cross-family review loop on the revision. In parallel, the SQLite-only corpus and the deterministic fault-injection harness (keyed to journal appends) can be built now without waiting on LLP 0072's adapter choice, provided the acceptance list is amended to make the hosted-evaluator row explicitly contingent on that choice rather than implicitly satisfied by whatever exists at gate time. The RFC is close: its instincts about honesty (irreversibility acknowledged, sampling declared, backups not proof of restore) are exactly right, and the fixes above are about making the strongest claims — the digest, the proof, and the sync contract — as truthful as the document's posture already intends them to be.

## Re-review — 2026-07-20

### Overall assessment

The revision genuinely absorbed all ten substantive concerns from the first
review: deterministic constants, an independent proof oracle, explicit
commit-version/retention-floor publication, commit-drift re-proof, authenticated
hosted approval, control-plane backup custody, zero-successor-commit rollback,
target-local atomic journaling, durable hosted execution, privileged verification
scans, vocabulary mapping, and the staged-generation rename are all present.

One direct contradiction remained: a production plan bound to an exact target
could not legally execute unchanged against the isolated restore target required
by the production rehearsal. The other findings were smaller symmetry,
determinism, and evidence-boundary gaps rather than architectural objections.

### Concerns

**H1 (High) — The rehearsal preflight contradicted exact-target fencing (§7
against §2 and Summary).** A restored rehearsal has a different deployment and
restore epoch, so the "identical approved plan" must fail target matching; a
target-rebound plan is no longer identical. Define an explicit rehearsal
admission whose receipt is marked rehearsal, binds the production plan digest,
and can never satisfy production apply.

**M1 (Medium) — Migrated system fields and therefore the digest oracle were
undefined (§4–5).** Pin `_id`, `_version`, `_createdAt`, and `_updatedAt` per
step category and include them in the canonical content proof.

**M2 (Medium) — Fast rollback lacked publication-symmetric mechanics (§6
against §4).** Predecessor republish must allocate a version, append its own
resync event, raise the retention floor atomically, define replay behavior, and
require fresh preview/approval before a later migration.

**M3 (Medium) — The preview-observed version was digested despite being neither
an explicit input nor an apply precondition; `planId` derivation was unpinned
(§2).** Put changing observations in a separate report and derive `planId`
purely from the canonical plan digest.

**M4 (Medium) — Per-migration proof demanded an actual retained client (§5
against §8).** A clientless migration cannot summon one. Keep real client
behavior in corpus acceptance and retain only the generated compatibility,
resync-event, and floor facts in each operation receipt.

**M5 (Medium) — Retained durable work was outside every compatibility posture
(§1, §6).** Scheduled jobs, outbox entries, webhook/payment work, and replay
payloads survive the barrier. The plan must prove them empty, dual-compatible,
or transformed rather than treating runnable-work drain as sufficient.

**M6 (Medium-low) — Two acceptance cases could not prove their wording.** A
sample can detect corruption only inside its sample, and
`predeploy-compatible` had no positive or negative ordering witness.

### Suggestions

- Bind the rehearsal proof and duration into production admission facts.
- Define content digests over canonical rows including system fields.
- Give rollback republish a distinct event/code for inspection.
- Add a stable rehearsal-required diagnostic.

### Recommended next step

Apply H1 and M1–M3 before widening review; correct M4–M6 in the same pass. The
reviewer considered the architecture settled and consistent with LLP 0007,
0072, and 0074, but recommended keeping the document Draft until those pins
landed.

## Final targeted review — 2026-07-20

**READY.** No HIGH or MEDIUM blockers remain.

The reviewer verified all seven ratification-gate dimensions against both prior
rounds:

1. `MigrationRehearsalPlanV1` is separately target-bound, can never substitute
   for production apply, and has a required-rehearsal diagnostic plus acceptance
   fencing.
2. All four system fields are deterministic by row category and the independent
   expected-value digest covers user and system fields with zero rejects on
   success.
3. Fast rollback is zero-successor-commit-only and publication-symmetric, with a
   distinct resync version/floor and replay/fresh-preview rules.
4. `planId` derives from the canonical plan body while changing target
   observations live in a separately digested, non-authorizing report.
5. Empty, dual-compatible, transformed, and incompatible retained-work
   postures cover scheduled and queued payloads rather than pretending drain
   removes future work.
6. Sampled proof claims only its preregistered covered set and explicitly
   demonstrates the outside-sample limit; `predeploy-compatible` has positive
   and negative ordering witnesses.
7. Hosted execution is resident, journaled, wake-resumable, and eviction-safe;
   process-local barriers are disqualified and hosted profiles independently
   run the fault corpus.

Residual observations were LOW only: predecessor-work release after fast
rollback is implicit, and the fast-rollback acceptance bullet could name its
content-digest oracle more explicitly. Neither was judged to weaken a
load-bearing claim. The reviewer recommended author acceptance; this review
does not perform that status transition.

## Re-review — 2026-07-24 (post GPT-round reconciliation)

**Provider / runtime:** claude-code sub-agent (Fable, fresh session — not the authoring or reconciling session)
**Method:** sub-agent

**READY.** The document was substantially revised on 2026-07-24 to reconcile the GPT family's round 1 (see the .codex.md artifact). This fresh-session re-review verified all seven prior READY-gate areas HOLD — several strictly strengthened (canonical artifact encoding with golden vectors, `ContentDigestV1` with a resumable accumulator, sampling demoted to a face-labeled `sampled-audit` class, the LLP 0014 shared-alarm registration, the LLP 0072 lock order) — and adversarially cross-checked the new material against LLP 0007/0072/0080/0053/0070/0014/0063/0062:

- The maintenance-window fast-rollback restriction coheres with the fence lifecycle; `_version = R` restamping is consistent with LLP 0007's version rule and computable from checkpoint + plan + constants; commit-version budget reservation is a decidable admission precondition under the frozen head.
- The same-landing LLP 0007 journal-grammar amendment closes the previously implicit dialect with no acceptance-ordering hazard; the retained-work narrowing to `empty`/`dual-compatible` is a claim reduction, not a coverage loss, and matches LLP 0070's successor-job contract.
- The typed `MigrationApprovalV1`/`MigrationAdmissionV1` records bind identity fields that all exist in LLP 0072.

Five LOW precision residues were reported (the `published-held` state was implicit; projection-output IDs needed an explicit carve-out to LLP 0080 §5's rule; rollback-timestamp monotonicity was witnessed but not normative; the UUIDv7 bit layout could be misread; the rollback command's invoking authority was implicit). All five were fixed after this review with sentence-level edits. The reviewer recommended the document as READY for author acceptance; this review performs no status transition.

## Delta verification — 2026-07-24 (final text)

**READY.** The GPT round-2/3/4 edits that postdate the Claude re-review verdict were delta-verified in the same fresh-session reviewer context: the single-preimage plan digest with pinned planner order, `operationId`-keyed idempotence, the authority-bearing-table refusal, the capability-derived fence lane registry, the schema-enumerated state machine with fencing-token validation and pre-publication-only cancellation, the fixed LLP 0007 amendment content, the enforced downtime ceiling lapsing at `published-held`, the framed `ContentDigestV1`, and the `generationRepublish`/`storageGeneration`/LLP 0053-obligations rollback semantics all compose with the previously verified gate areas — areas 3, 4, and 7 strictly strengthened. Three LOW residues (Related header, a loose crash-after-publication sentence, implicit intra-intent ordering) were fixed after the review. Final state: both families READY on the same text; status transition remains the author's.
