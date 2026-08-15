# LLP 0160: The ideal migration experience

**Type:** RFC
**Status:** Accepted
**Systems:** Migrations, Developer experience, Agent experience, CLI, Diagnostics, Client integration, Documentation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-03
**Revised:** 2026-08-15 (G6 closed by `2e0e5e03a`: the Guide now joins the
reviewed migration command loop to a sessions deployment-identity narrative,
capability rows, generated diagnostic links, and retrieval evidence)
**Revised:** 2026-08-15 (Moment 2/2b concrete route: a direct installed
`Json`→`Structured` refusal names the closed `ConvertJsonToStructured` intent;
preview expands it through LLP 0081's reviewed shadow-generation program.
The general candidate-intent file scaffold in G3' remains open.)
**Revised:** 2026-08-03 (Accepted by the author after the five-round
dual-family super-refine loop closed on the asymmetric stopping rule —
Fable READY rounds 3–5 recommending accept-track, Codex NOT READY×5
with monotonically narrowing new-surface findings, all absorbed
through v0.6. Acceptance adopts §5's gap ledger as the experience
program's actionable output and changes no LLP 0081 semantics; the two
conform-or-amend rulings stay open and gating — OQ6 (cross-artifact
settlement: G4′b blocked) and OQ7 (rollback input: G9b blocked) — and
per §Related governance, D-class rows conform code to LLP 0081 while
A-class rows require their own dated amendments to the owning
documents before any semantics move); 2026-08-03 (v0.6, super-refine round 5 close-out — Fable
READY for the third consecutive round; Codex NOT READY with further
narrowing; both families converged on the redaction/approval tension,
now ruled in the document: the **secure review faces (preview/approve)
reveal constants by default** — an approver never binds a digest over
values they could not see — while apply/verify narration and
CI-context rendering redact, with LLP 0081 §7's *log* rule cited as
the floor it actually is rather than a blanket constant-redaction
mandate. Round-5 additions: Moment 4 now specifies
**render-before-mint** (today's approve writes the artifact before
emitting — the render-first gate plus an exact-digest acknowledgement
for non-interactive callers is part of the approve surface's scope);
the rehearsal journey's missing first half (select backup → isolated
restore → derive the sealed `MigrationRehearsalPlanV1`) is rendered in
Moment 5 and owned by new row G16, which also owns the unimplemented
backup-preflight seam (`SNAPBACK_MIGRATION_BACKUP_REQUIRED` appears
nowhere in the tree; preview hardcodes `required: false`);
preflight *status* is classified as apply-time observation context —
never approval authority — with the requirement/max-age sourced from
plan and profile respectively; G8 and G15 reclassified as
part-drift (0081's acceptance already requires batch-boundary fault
injection and same-identity admin inspection), G9 split into drift
(G9a) and the OQ7 conform-or-amend ruling (G9b); G14 rescoped to the
mechanically enumerated shipped `SNAPBACK_MIGRATION_*` family with §8
as the normative floor; PlanetScale's over-dated provenance dropped;
the same-principal approval case renders as a disclosed exception;
example-ceilings footnote added) — prior: v0.5 (round 4:
staged-publication fix, published-held restated, redaction contract
born, G15), v0.4 (round 3: OQ6, G12–G14, Moments 9/10), v0.3
(round 2: custody copy, R/D/A lanes, G10/G11), v0.2 (round 1: stale
G3 removed, Moment 5 rebuilt, intent authoring), v0.1 same day
**Related:** LLP 0005, LLP 0007, LLP 0037, LLP 0058, LLP 0061, LLP 0072, LLP 0074, LLP 0081, LLP 0093, LLP 0099, LLP 0126, LLP 0137, LLP 0158, LLP 0159, LLP 0161

> **North-star document.** LLP 0081 owns migration *semantics* and this
> RFC deliberately changes none of them. What this RFC owns is the
> *experience*: what a human or agent sees, in what order, with what
> words, when a schema needs to evolve. Where an ideal moment exceeds
> what exists, the ledger classifies the residue honestly: a rendering
> gap (**R**), an **implementation drift** (**D**) from the owning
> contract's normative text, or a named, dated **amendment** (**A**) to
> the owning contract document — three different governance lanes,
> never conflated, and where the corpus itself is ambiguous about which
> lane applies, that is an author ruling recorded as an open question
> (OQ6, OQ7), not a classification invented here. The gap ledger in §5
> is the actionable output.

## Summary

The seven-backend bakeoff (diary 0029) produced a clear result:
migration experience is a differentiator nobody in the field fully owns.
Firebase's observed arm had no first-class migration workflow (an
Admin-SDK backfill was "operational code"); Convex's real-world path was
application-authored with no reviewed plan or rollback evidence;
Supabase has maximal SQL power but leaves the operator to orchestrate
their own invariants; PocketBase makes the migration the widest, least
statically safe file in the app. The high point was SpacetimeDB — not
because its semantics are strong (they are weaker than LLP 0081's), but
because its CLI **printed the consequences before doing anything**.

Snapback already has the strongest migration *contract* of that group:
sealed deterministic plans, authenticated approval, a journaled
crash-recoverable executor, independent data proofs, receipts, honest
rollback boundaries. What it lacks is the SpacetimeDB moment: the paved
experience that renders that machinery legible at the instant a schema
change is refused, previewed, applied, or rolled back. The thesis:
**the ideal migration experience is SpacetimeDB's legibility wrapped
around LLP 0081's rigor, surfaced at every point where today the
operator gets a refusal code and a search through the docs.**

## 1. Prior art

### SpacetimeDB — the legibility bar `[observed — diary 0029, 2026-07-28 deep round]`

The bakeoff's additive-migration scenario against SpacetimeDB 2.7.0, in
the diary's own words: "The CLI printed a concrete plan, added a
defaulted indexed column in place, retained all 500 issues, and made the
client-disconnect consequence explicit." Publishing with data deletion
disabled retained and defaulted all 500 rows, then accepted an
authoritative post-migration update. The lesson line the diary drew:
provide an "inspectable migration preflight that names fields, indexes,
data preservation, and client impact."

Papercuts recorded for balance: a migration default was still required
by generated insert types, and unstable *SQL* syntax cost iterations.
The trust-model contrast, stated precisely: an ordinary interactive
confirmation exists — bypassed in the run with `--yes`
`[observed — retained evidence log,
demos/backend-bakeoff/arms/linear/spacetimedb/evidence/migration-publish.log]`
— but the observed arm surfaced **no authenticated, digest-bound
approval artifact, no provider-issued receipt, and no independent data
proof**. (The evidence directory's `migration-receipt.json` is a
bakeoff-authored evidence file, not a provider-issued receipt.) The UX
is the part to take; the trust model is the part LLP 0081 already
exceeds.

### The rest of the field, compressed

- **Convex** `[observed — diary 0029]`: workable but
  application-authored; "not a first-class reviewed migration plan with
  built-in rollback evidence." Its online-with-connected-clients
  posture is its genuine strength `[inferred — architecture reading;
  LLP 0159 F1, not observed in the bakeoff arm]`.
- **Supabase** `[observed — diary 0029]`: Postgres migrations are fully
  expressive and inspectable; "the burden is orchestration." The
  diary's recommendation — "make index/query-plan inspection and
  before/after migration invariants one command" — is adopted here in
  its before/after-invariants half (Moment 7); the query-plan half is
  broader than migrations and deliberately not claimed by this RFC.
- **PocketBase** `[observed — diary 0050]`: schema/rules/indexes/seeds/
  rollback all in one verbose migration — 41% more authored words than
  the Snapback arm and four runtime-only failures. Its rollback behavior
  was judged excellent, with caveats in the same breath (interactive
  down-migration confirmation stumbled automation twice; the down
  migration initially left seeded users behind).
- **Firebase** `[observed — diary 0029]`: `BulkWriter` backfill plus a
  manually declared index; "operational code rather than a first-class
  migration workflow" (an observed-arm conclusion; the arm made no
  hosted-tooling claim).
- **Appwrite** `[observed — diary 0029]`: attribute and index changes
  are asynchronous and polled; the successful backfill and compound
  index were "not one atomic migration" — the legibility anti-pattern
  Moment 6's journaled-state narration is designed against.
- **InstantDB** `[observed — diaries 0029/0030]`: indexed schema
  evolution passed, and `instant-cli push` made schema and permission
  diffs visible at deploy time (with `--yes`, display and apply were
  one uninterrupted command — the diff was shown, not gated on) — the
  closest prior art for Moment 2b/3's diff-first authoring; the diary's
  lesson asks Snapback to match "compact typed links/indexes and schema
  diffs."
- **Triplit** `[confirmed — LLP 0084; absorbed in LLP 0037 CC-8.7]`:
  schema pushes classified backwards-compatible-or-not, with clients
  refusing to connect on incompatible schemas. LLP 0037 recorded the
  gap "for whichever document owns deployed-client schema evolution";
  Moment 8 renders it and OQ3 proposes where the protocol fact lives.
- **PlanetScale** `[observed — LLP 0001; that section carries a
  medium-high, verify-before-reuse confidence note]`: schema changes as
  reviewable deploy requests — evidence that review-object-first
  migration UX is a proven product shape.

## 2. The ideal experience, moment by moment

"Operator" throughout means human or agent — every rendering must be
simultaneously human-readable and machine-parseable. The stream
discipline is decided (formerly OQ1): the human rendering is
**default-on**, written to stderr, with the structured envelope on
stdout; `--json` silences the rendering. Machine consumers stay safe,
and the SpacetimeDB lesson (consequences shown unless you opt out)
holds.

**Redaction is part of the rendering contract, and it is
face-specific.** LLP 0081 §7's rule — migration *logs* redact row
values and secret material while retaining stable IDs and reason codes
— is the floor, and this RFC does not stretch it into a blanket
constant-redaction mandate. The ruling: the **secure review faces**
(preview and approve, on an interactive surface) render plan constants
**revealed by default** — an approver must never bind a digest over
values they could not inspect, which is the SpacetimeDB failure mode
(consequence hidden at the decision point) inverted; where a review
surface cannot reveal (piped, CI), approve requires an explicit
acknowledgement instead. The **narration and log faces** (apply/verify
progress, anything CI-context) redact literal constants and
row-derived values by default, with an explicit reveal flag (never
default). The G1 fixture set includes both faces.

For additive changes, the schema edit is the only authoring act. For
reviewed changes, one more authoring act exists today and the ideal
keeps it honest rather than hiding it: declaring intent (Moment 2b).

**Moment 1 — the safe change is invisible (mode-aware).** Additive
changes keep today's behavior: the LLP 0007 applier applies them
without ceremony — at startup in the plain dev loop, via watch-reload
under `snapback dev` for sessions-mode apps (where a cold
stop/regenerate/restart instead refuses with the documented
startup-artifact mismatch; the guide's authoring-loop page owns that
path). The ideal for the common case is *no experience*.

**Moment 2 — the refusal teaches.** When the applier refuses a
non-additive change, the refusal must carry the next step, not just a
code. Today the applier's refusal family mostly names no
migration-workflow next step — the required-backfill message reads as
outright denial ("explicit drop/backfill migrations are not
supported", `src/storage.rs`), while others suggest schema
workarounds ("add a new field instead") without ever mentioning the
shipped reviewed workflow. G2's slice enumerates and fixes the family.
Ideal: the refusal prints a one-paragraph summary of *why* this change
needs review, an intent-level summary of what the change appears to be
(explicitly labeled a **pre-plan estimate, not a plan** — the
principle 1 carve-out), the scaffold for Moment 2b when intents are
needed, and the exact next command.

**Moment 2b — declaring intent is paved, not hidden.** LLP 0081 makes
declared migration intents a canonical planning input. Today preview
derives unambiguous, semantics-free intents from the schema diff, but
renames, conversions, and required-field backfills must be hand-declared
(plus an explicit publication timestamp) — the largest ceremony in the
current flow, and correctly so where the ambiguity is real. The ideal:
the refusal emits a candidate intents file with the ambiguous choices
marked `TODO` and a proposed publication timestamp — noting that the
proposed timestamp is admission-checked against 0081 §4's
row-timestamp monotonicity rule, so a scaffold that ages past new
writes refuses at admission and that refusal renders per G14. Intent
declaration stays; intent *authoring from scratch* goes.

The shipped named case is JSON→structured evolution. A direct schema
activation refuses with `SNAPBACK_SCHEMA_FIELD_RETYPED`, explains that every
stored value must validate and be canonically rewritten, names
`ConvertJsonToStructured`, and routes to `snapback migrate preview --help`.
The intent preserves the field name by staging and publishing a whole successor
table generation; it does not weaken the conservative applier. G3′ still owns
generation of a candidate intents file for ambiguous cases generally.

**Moment 3 — preview renders consequences on the plan's face.**
`snapback migrate preview` keeps emitting the sealed
`MigrationPlanArtifactV1` unchanged, and *additionally* renders it.
Illustrative rendering (shape-accurate to the shipped
`AddRequiredField` expansion; shown on the review face, so the
constant is revealed; the ceilings are authored values for this
example, not preview's shipped defaults; a committed golden fixture
set, including narration-face redacted variants, lands with G1):

```text
Migration plan migration-v1:9f2c… (4 steps, exclusive single-writer)

  1. AddField         models.provider  (nullable install)
  2. BackfillField    models.provider  constant "openai"
                                       preflight: ~1,204 rows
                                       (estimate — review context, not plan authority)
  3. ValidateRequired models.provider
  4. MakeRequired     models.provider

  Ceilings:  ≤10,000 affected rows, ≤30s barrier downtime (approved facts;
             exceeding either refuses or aborts safely)
  Barrier:   exclusive single-writer — reads and writes unavailable or
             maintenance-mode while fenced. LLP 0081 requires the fence to
             close every lane in the target's capability-derived registry
             (queries, mutations, subscriptions, jobs, workers, actions,
             cron wakeups, external-effect egress); the rendered list
             derives from the plan-bound capability, per target (see G12)
  Clients:   posture successor-only — old artifacts get upgrade-required;
             offline mutations quarantine (see Moment 8)
  Rollback:  fast republish — only while published-held; every apply
             passes through that state, and on the local profile it is
             operator-actionable only during crash-resume (see Moment 9);
             after release — separately approved reverse plan or restore;
             declared irreversible only if neither exists
  Proof:     full ContentDigestV1 over models (no sampling)
```

The traceability rule is normative for whatever implements this: every
rendered phrase maps to a named source — a JSON pointer into the
digested `body` (steps, ceilings, posture, proof method, strategy), the
separately-digested preview observation (row estimates — labeled, on
every line they touch, as **review context that approval binds by
digest but that carries no plan authority**, per LLP 0081 §2's exact
split), or a fixed LLP 0081 rule (the rollback and barrier lines render
§4/§6 semantics, parameterized only by digested fields). The rule also
specifies **omission behavior** (a fact whose source is absent is
omitted or rendered explicitly unavailable, never defaulted) and the
face-specific **redaction behavior** above. Facts in none of the
admitted sources are **not rendered**; if the ideal wants them
canonical (e.g. a "rows re-stamped" impact summary), that is a named,
dated LLP 0081 §2 amendment — ledger row G7′. A re-preview after drift
(`SNAPBACK_MIGRATION_PLAN_STALE`) additionally renders *what changed*
against the previously reviewed plan — two sealed bodies, one diff, no
new semantics.

**Moment 4 — approval shows what it binds, before it binds it.** The
ideal `approve` is **render-first**: it shows Moment 3's rendering plus
the approval block below, then takes an affirmative authorization tied
to the displayed plan and observation digests, and only then mints and
persists `MigrationApprovalV1`. (Non-interactive callers pass an
exact-digest acknowledgement argument; nothing here weakens 0081's
authenticated-principal rules.) Today's handler constructs and writes
the approved artifact before emitting — a description of an action
already taken — so the render-first gate is in G1's approve-surface
scope. The approval block shows every approval-bound fact of LLP 0081
§2 — directly, or via the bound plan digest — each with its JSON
pointer: plan digest; observation digest (review context);
approval-policy digest; the complete resolved target audience; approver
principal; issue and expiration timestamps; the fresh `operationId`
(present on the local profile too); the plan's backup/checkpoint
*requirement* and rehearsal-requirement flags (plan fields), with the
profile-defined preflight maximum age beside them — while preflight
*status* is an apply-time observation and renders here as "not yet
executed; proven at admission" per the omission rule, never as
approval authority; and whether generator and approver are distinct —
with the same-principal case 0081 §2 admits rendered as a **disclosed
exception** ("generator and approver are the same principal, permitted
by this target's policy"), never a silent fact. The
declared-irreversible boundary, when present, is acknowledged here —
at approval — not discovered at rollback time. Local and hosted
profiles render the same vocabulary; the hosted profile adds its
control-plane operation identity.

**Moment 5 — rehearsal gets cheaper without changing meaning — and its
journey starts before the verb.** LLP 0081 §7's rehearsal semantics are
untouched: rehearsal executes the **approved** production plan under a
sealed `MigrationRehearsalPlanV1`, and only that receipt satisfies
`apply --rehearsal-receipt`. The ideal renders the *whole* journey,
including the half that has no paved path today: select the source
backup → restore it into an isolated target → derive and seal the
rehearsal binding (source backup identity, isolated target, restore
epoch) → `rehearse` → receipt. Today the CLI consumes a sealed binding
via `--rehearsal-plan` but nothing creates one — that missing first
half, and which parts of it are existing §7 obligations versus drift,
is G16. Two acceleration paths layer on:

- *Accelerator (amendment-blocked):* if LLP 0158's instance fork
  ships, `rehearse --fork` **could** satisfy the sealed binding faster
  — but only after 0158's program proves two things and a dated 0081
  §7 amendment lands: that a fork image can carry the binding's backup
  identity/restore epoch, and that a scrubbed fork preserves rehearsal
  fidelity for §6's retained-work proofs (0158's custody manifest
  sweeps exactly the job/cron/stream state those proofs read). Until
  both, fork output never satisfies §7.
- *Informational what-if:* independent of approval, an operator can
  fork and try anything (0158's general capability) — O(1) `clonefile`
  for a cold parent; a live parent is a full copy via the backup
  primitive (0158's own scoping). Its output is explicitly **not** a
  rehearsal receipt, and its measured facts carry the custody-manifest
  fidelity caveat, per fact.

**Moment 6 — apply narrates observed facts.** Admission narrates its
own preflights first — including, where the profile requires it, the
§7 backup/recoverability preflight and its refusal. (Today that seam is
unimplemented: `SNAPBACK_MIGRATION_BACKUP_REQUIRED` exists only in
0081's text, and preview hardcodes the backup requirement to
`required: false` — G16 owns this, and the narration's scope tracks
the tree honestly, as Moment 7's does.) Then progress by journaled
state, rendered exactly as the journal records it: `barriered`,
`executing (step 2, batch 3)`, `verifying`, `published-held`,
`released`. No invented totals — the journal holds the current step and
batch cursor, not a batch count; if an estimate is shown it is labeled
as one. Local apply is synchronous today, so narration needs a
progress-transport seam whose two options are *not* equivalent on the
single-writer profile: an in-process observer rendering to the same
stderr is safe by construction, while a cross-process `migrate status`
polling the journal needs a named read-lane story against the
exclusive writer — G5's implementer must pick with eyes open. Stall
and abort messages name the journaled state and its LLP 0081 recovery
posture in state-specific language: before publication, "the
predecessor remains authoritative"; while `published-held`, "the
successor is published but fenced"; and the reserved
ambiguous-publication corruption case keeps its inspection-required
posture verbatim. `apply --dry-run` is rendered for what it is: a
**non-authoritative pre-admission estimate** — real admission
re-proves everything under the closed fence, and today's
implementation checks even less (plan-vs-schema validity and approval
shape only, yet answers `"wouldApply": true` — the envelope key itself
is G13's exhibit), so the rendering must not say "admission would
succeed."

**Moment 7 — the receipt answers questions.** The ideal `snapback
migrate verify` renders LLP 0081 §8's *normative* receipt — plan
identity, journaled steps, the verification proof with expected vs.
actual digests, postures, rollback-window status — and says plainly
that it re-proves the receipt against the journal projection without
re-digesting a live post-release database. Today's implementation is
short of the normative receipt (G10's field-by-field audit is the
scoping instrument), so Moment 7's rendering scope tracks the tree,
honestly labeled — and the receipt *rendering* work should co-land
with or trail G10's conformance work. The before/after-invariants half
of diary 0029's Supabase lesson lands here: invariants, one command.

**Moment 8 — the client story is part of the migration, not an
aftermath.** The Triplit absorption comes due, on the shipped typed
vocabulary (`resync-required` / `upgrade-required` via
`surface.migrationBoundary()`, landed 2026-07-26 with guide coverage).
The two kinds render differently because they *are* different:
resync-required settles automatically through resync-before-replay.
For upgrade-required, shipped behavior preserves the quarantined
outbox until the upgrade, then hands the successor surface redacted
`SNAPBACK_CLIENT_ARTIFACT_STALE` entries — **identity preserved,
arguments discarded** — for the application to re-enter. Whether that
is the contract or a drift is genuinely open: LLP 0081's acceptance
text says the quarantined offline mutation "settles through
resync-before-replay," which the shipped tombstone-and-re-entry path
arguably does not do for the mutation's *content* — though the same
RFC's §4 asks only that quarantined mutations not be "silently
replayed or dropped," which the explicit redacted tombstone satisfies;
the two passages may be in tension with each other, which is itself
decision input. That ruling is OQ6 — an author decision between
conforming the code (class D) and a dated LLP 0081 amendment blessing
tombstone-and-re-entry (class A). Either way the honest end-user copy
discloses the discard: "update required — 3 offline changes couldn't
be carried across the upgrade; after updating, the app will ask you to
redo them." The remaining work splits (G4′a/G4′b): first-party
presentation over the shipped state, and the OQ6 ruling plus non-JS
carriers.

**Moment 9 — rollback is a first-class experience, not a receipt
footnote.** Each §6 branch gets its own rendered path: pre-publication
cancel/abort ("unpublished work remains unobservable and is discarded
or parked according to the journal; the predecessor is authoritative —
here is the terminal receipt," rendering the journal's actual recorded
disposition); `published-held` fast republish — with the local-profile
reality stated precisely: **every successful apply passes through
`published-held`**, and on the local profile release is apply's
journaled tail (no operator hold point), so the state is
*operator-actionable* only when crash recovery resumes from it — the
resume surface is where the release-or-rollback choice renders;
interactive hold-then-open belongs to hosted profiles that define a
release operation. Post-release, the honest fork in the road rendered
as choices — "requires a separately approved reverse plan (`migrate
preview` against the successor) or restore from the pre-migration
backup" — with the declared-irreversible case surfaced at *approval*
time (Moment 4). G9's CLI-surface matrix is the first slice of this
moment.

**Moment 10 — the activation-ordering handoff is rendered, not
inherited.** LLP 0081 §4 is precise about what publication does: it
publishes the **staged** successor artifact/schema identity set with
the storage, and control-plane traffic activation remains LLP 0072's
separate step, which consumes the migration receipt. So the handoff
this moment renders is not a new state after release — it is the
posture-governed ordering *around* publication and release: the
successor artifacts are staged before apply; §6's compatibility
declaration governs which deploy/activation orderings tooling admits;
and the ordering *refusal* an operator hits renders with the approved
posture on its face. This RFC owns the rendering of the posture and
the refusal; LLP 0072 owns activation semantics; and the G6 guide page
must walk the seam explicitly so the operator journey has no
unnarrated gap.

## 3. Design principles

1. **Render, never re-derive — with one labeled carve-out.** Every
   post-preview rendering derives from the digested plan body, the
   digested observation (estimate-labeled), the journal, or a fixed
   LLP 0081 rule parameterized by those — with explicit omission rules
   when a source is absent, and the face-specific redaction rules on
   what may be shown by default. The single exception is refusal time
   (Moment 2), when no plan exists yet: that output is an intent-level
   summary, visibly labeled pre-plan, and never shows a digest, step
   IDs, or anything an approval could be mistaken to cover.
2. **The refusal is the front door.** Any refusal in the
   schema-evolution path names its next step — a command when one is
   safe, and an explicit "inspection required" or "operator decision
   required" posture when LLP 0081 says so (ambiguous-publication is
   the archetype). G14's matrix makes this total over the shipped
   diagnostic family, with §8's list as the normative floor; the
   applier's own refusal family (schema-apply codes, not §8 codes) is
   in scope via G2 and explicitly so.
3. **Same words everywhere.** CLI rendering, structured envelope, admin
   inspection (its own surface: G15, whose identity floor 0081's
   acceptance already sets), and guide use one vocabulary — LLP 0081's
   state and posture names, not synonyms.
4. **No new semantics — three governance lanes.** This RFC adds
   renderings, surfacings, and one flag. Residues are classified:
   rendering gaps (build them), implementation drift from the owning
   contract (conform the code), and ideal-exceeds-contract items that
   require named, dated amendments **to the owning contract document**
   (LLP 0081 for G7′; LLP 0093 for G4′b's protocol half per OQ3) —
   never smuggled in as copy or rendering. Where the corpus is
   ambiguous about the lane (OQ6, OQ7), the ambiguity is surfaced to
   the author, not resolved by fiat.

## 4. What we already have that the field lacks

For calibration, the experience assets already shipped: deterministic
preview (byte-identical plans), the sealed-plan approve/apply split,
rehearsal with receipts, the downtime ceiling as an *approved* fact,
independent full-table proof at publication time, honest
irreversibility declarations, receipts as journal projections, and the
typed client migration boundary. In the observed bakeoff arms, no
system demonstrated more than one of these (an evidence-bounded claim:
the bakeoff did not systematically probe every property on every
provider). The experience work is leverage on rigor already paid for.

## 5. Gap ledger (verified against the tree 2026-08-03; class: R = rendering/experience, D = implementation drift, A = amendment required)

| # | Class | Gap | Moment | Size |
|---|-------|-----|--------|------|
| ~~G1~~ | ~~R~~ | ~~No human rendering of plan/receipt; all migrate verbs emit the JSON envelope only, and approve writes its artifact before emitting (the render-first gate and non-interactive digest acknowledgement are in scope). Ships with the committed traceability table and a golden fixture set — review-face (revealed) and narration-face (redacted) variants, estimate-absent, narrow-terminal — plus a deterministic presentation contract (ordering, width, color, exit codes).~~ **Closed by `e933babc`: every migrate verb now emits deterministic human presentation on stderr by default, with terminal-review and redacted narration faces, committed golden fixtures and traceability contract, `--json` silence, and render-first exact-digest approval authorization.** | ~~3, 4, 7~~ | ~~M~~ |
| ~~G2~~ | ~~R~~ | ~~The applier's non-additive refusal family mostly names no migration-workflow next step; the message-text fix is an S-sized slice needing zero rendering infrastructure, enumerated across the family.~~ **Closed by `eff005a7`: every field-retype and required-field/backfill refusal, including physical-schema backstops, names `snapback migrate preview --help` as the reviewed-workflow next step. The 2026-08-15 JSON→structured route additionally names its exact `ConvertJsonToStructured` intent.** | ~~2~~ | ~~S–M~~ |
| G3′ | R | No scaffold for the ambiguous intent classes or the publication timestamp (whose monotonicity admission-check the scaffold must anticipate); unambiguous intents already derive | 2b | M |
| G4′a | R | First-party presentation/copy over shipped `migrationBoundary()` state | 8 | S–M |
| G4′b | D-audit (OQ6 ruled 2026-08-03: tombstone-and-re-entry blessed; dated 0081 amendment landed) | Cross-artifact settlement: audit the shipped tombstone-and-re-entry path against the amended 0081 text; plus non-JS carriers (protocol half restated in LLP 0093 per the OQ3 blessing) | 8 | S–M audit |
| G5 | R | No `snapback migrate status`; recovery experience (operation discovery — including the second-operator collision case under 0081's one-migration-per-app rule — resume, cancellation surfaces) rides with it; the transport choice is load-bearing on the single-writer profile | 6, 9 | M |
| ~~G6~~ | ~~R~~ | ~~No guide page joins preview→approve→rehearse→apply→verify→rollback to sessions deployment activation, capability routing, and retrieval evidence.~~ **Closed by `2e0e5e03a`: `guide/backend/migrations.md` owns the reviewed command loop; new `guide/backend/schema-evolution.md` owns identity rotation, the sessions pin, managed successor activation, hash interpretation, and exact-carrier recovery; the capability index, generated diagnostic registry, and retrieval case 56 route into those pages.** | ~~all~~ | ~~S~~ |
| G7 | R (informational) / A-blocked (receipt-qualifying) | Fork-accelerated rehearsal: informational what-if is pure experience work once 0158 ships; receipt qualification is blocked on 0158's custody/fidelity proofs plus a dated 0081 §7 amendment | 5 | blocked on LLP 0158 |
| G7′ | A | Canonical impact-summary fields (rows retained/re-stamped) — a dated LLP 0081 §2 amendment | 3 | S spec / M with proof plumbing |
| G8 | D + R | Migration-scale evidence. **D:** 0081's acceptance requires fault injection at every batch boundary, and no test seeds past 512 rows, so the second-batch boundary is provably unexercised — conformance drift, not preference. **R:** the real-process-kill rung and the ≥1M-row soak are additional strengthening beyond the acceptance floor | trust in 6, 7 | M |
| G9a | D | CLI-surface conformance vs. 0081 §2, scoped as a verb-by-verb matrix over all seven commands (required inputs, output artifact, dry-run support, divergence). Known already: `preview`'s input shape; `verify --operation-id` vs. `verify migration.json`; only `apply` has `--dry-run` where §2 says every command; stale doc comments on rollback and verify | 7, 9 | M audit, then conform |
| G9b | D or A (OQ7) | The rollback input divergence specifically: shipped `rollback` deserializes the approved-plan file from an arg named `receipt`, and its in-code comment defends this as deliberate, while §2 specifies `rollback migration-receipt.json` — conform-or-amend author ruling | 9 | ruling first |
| G10 | D | Receipt conformance: field-by-field §8 audit as the first step — known-missing already include plan bytes, backup/checkpoint, both postures, source revision, package/runtime identities, the approval record, and cleanup state (the seal excludes the cleanup tail); the stored proof retains only post-comparison actual digests | 7 | M–L |
| ~~G11~~ | ~~D~~ | ~~Preview emits `preconditionRows` empty — the observation carrier exists but is never populated (rendering omits the estimate line until fixed).~~ **Closed by `120a2a7d`: preview now reads the target head and ceiling-bounded per-step row summaries from one pinned snapshot, populates the separately digested `preconditionRows` carrier, and renders its explicitly non-authoritative estimate line.** | ~~3~~ | ~~S–M~~ |
| G12 | D | Capability binding: 0081 §2 binds the target's static capability digest into the plan and derives the fence registry from it; `MigrationPlanBody` carries no capability digest and preview emits empty capability health — until conformed, the barrier rendering states the normative rule, never a plan-bound validation claim | 3 | M |
| G13 | D | `apply --dry-run` semantics: today it checks plan-vs-schema validity and approval shape only, yet answers `"wouldApply": true`; define and implement the non-authoritative pre-admission estimate, renaming the envelope key in scope | 6 | S–M |
| G14 | R | Diagnostic→recovery matrix over the **mechanically enumerated** shipped `SNAPBACK_MIGRATION_*` family (the tree ships codes beyond §8's non-exhaustive list — fence-closed, journal-corrupt, cancelled, executor-stale, rehearsal-invalid among them) plus the applier refusal family, with §8 as the normative floor; generation from the diagnostic registry keeps new codes from landing without a recovery row | 2, 6, 9 | S–M |
| G15 | D + R | Admin-inspection surface. **D:** 0081's acceptance already requires admin inspection to show the same plan/step/result identities and stable diagnostics as CLI/Agent surfaces — that floor is unmet/unverified. **R:** what a good inspection surface shows beyond the identity floor (states, receipts, fence status) is experience design | 6, 7, 9 | S–M |
| G16 | R + D-audit | The rehearsal journey's missing first half and the backup-preflight seam: no command derives a sealed `MigrationRehearsalPlanV1` from a chosen backup + isolated restore (the CLI only consumes one), `SNAPBACK_MIGRATION_BACKUP_REQUIRED` is unimplemented anywhere in the tree, and preview hardcodes the backup requirement to `required: false` — the audit decides which parts are unbuilt §7 obligations (D) vs. deliberately deferred production-profile work | 5, 6 | M |

### Implementation record

- **2026-08-15 — G6 complete.** `2e0e5e03a` authored the sessions schema-
  evolution narrative, joined it to the existing reviewed-migration loop,
  added capability and retrieval routing, and regenerated diagnostic links
  for the startup-artifact and storage-evolution refusals. This was a
  documentation/discoverability closure; it changed no LLP 0058 or LLP 0081
  deployment or migration semantics.
- **2026-08-03 — tranche 1 complete.** G2 landed in `eff005a7`, G1 in
  `e933babc`, and G11 in `120a2a7d`. The tranche changed refusal and human
  presentation text plus the separately digested preview observation; it did
  not change LLP 0081's plan, approval, execution, or receipt semantics.

Resolved and removed from the ledger, kept as a lesson: v0.1's G3 (the
`0137-a3-f5` live-subscriber wedge) was fixed with regression tests and
an acceptance witness on 2026-08-01 — evidence that live-client schema
evolution is exactly where migration-experience defects concentrate,
which is why Moment 8 exists.

Suggested order: G1+G2 first (the SpacetimeDB moment; G2's
message-text slice needs zero rendering infrastructure and ships
immediately), then G11 (the example's own data source), G3′, G6, G5,
the drift audit block G9a+G10+G12+G13+G16 (one conformance pass over
the CLI, receipt, capability, dry-run, and rehearsal/backup seams,
with G9b routed to the author alongside OQ6), G14, G15, G8, G4′a —
with G7/G7′ blocked on their dependencies and G4′b blocked on the OQ6
ruling.

## Open questions

1. ~~Default-on vs. `--explain`~~ — **closed in v0.4**: default-on,
   human rendering to stderr, envelope on stdout, `--json` silences.
   (~~The redaction/exhaustiveness tension~~ — **closed in v0.6**:
   face-specific redaction; review faces reveal.)
2. For Moment 2b: should candidate-intent scaffolding live in the
   refusal path, an interactive `preview` mode, or schema-diff-driven
   codegen with declared annotations?
3. Where does the Triplit-style runtime compatibility verdict live?
   Proposed: this RFC's acceptance claims the presentation half
   (G4′a), and the protocol fact — including G4′b's non-JS carriers —
   is restated in LLP 0093's client-protocol spec, closing LLP 0037
   CC-8.7's unnamed-owner gap. The author decides. **ANSWERED 2026-08-03
   (Charlie Cheever): the proposed split is blessed as stated** — the
   presentation half lands here (G4′a); the protocol restatement lands in
   LLP 0093 when G4′b's work reaches it.
4. Is G8's stress fixture part of
   `RELATIONAL_MIGRATION_COUPLED_SUITE_V1` or a separately named soak
   corpus? (G8's D-half arguably belongs in the coupled suite by
   definition; the soak rung may not.)
5. Which measured facts from a fork survive the custody manifest
   (Moment 5's fidelity caveat) — is there a principled admissible-set,
   or is per-fact labeling the permanent answer?
6. **The Moment 8 ruling:** is LLP 0081's "quarantined offline mutation
   settles through resync-before-replay" still normative for
   incompatible clients — making the shipped tombstone-and-re-entry
   path a drift to conform — or is tombstone-and-re-entry the intended
   semantics, blessed by a dated LLP 0081 amendment? Decision input:
   0081 §4's own "rather than silently replayed or dropped" is
   arguably satisfied by the explicit redacted tombstone, so the two
   0081 passages may already be in tension. Author decision; G4′b is
   blocked on it. **ANSWERED 2026-08-03 (Charlie Cheever): tombstone-and-
   re-entry is blessed as normative.** The dated LLP 0081 amendment landed
   with this ruling (same commit); G4′b's ruling gate is cleared — its
   remaining scope is the conformance audit of the shipped path against the
   amended text plus the OQ3 protocol half.
7. **The G9b rollback-input ruling:** conform the CLI to §2's
   `rollback migration-receipt.json`, or amend §2 to bless the shipped
   approved-plan input (which the code defends as deliberate)? Author
   decision inside the drift audit.
