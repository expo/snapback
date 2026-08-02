# LLP 0146 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-01: "commit it and push it and
then do an /llp-super-refine." The target had been authored and pushed
earlier in the same session (`7c509eb6`) in response to Charlie's request to
"write up an RFC listing all these and deciding which ones we should actually
build," following a cross-family critique of a candidate list of agentic
affordances.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as
> much as, not the same as, "there are no flaws in this."

The target is a Draft RFC, so it may leave decisions open — but every open
item must be named as open rather than smuggled past the reader as settled,
and every factual claim about the codebase or the corpus must be true.

Loop mechanics as in the 0116–0141 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli `codex exec`,
read-only sandbox), mutually blind on 0146 artifacts, SHA-pinned targets and
instruction capsules, verify-then-fix passes between rounds, delta-scoped
later rounds in which each family sees only its own prior artifact. The loop
cannot advance the target beyond Draft; adjudication is the author's.

**Author self-verification** runs alongside each round: reviewer findings are
checked against the tree before they are applied, and the author's own
pre-verification pass runs concurrently with the reviews.

## Round 1 — 2026-08-01

Instruction capsule SHA-256 (shared by both families):
`0b009ed73a1f87f1fd0512a66435e1be1f57bf1ef21f74761a913cfe331333ce`

Target SHA-256 (v0.1, as pushed at `7c509eb6`):
`eeecc46c923d4f4248c2eb2cae26a4c81b9bf2ca0e80ee2c9a477fd53e7d36ca`

Repo revision at review start: origin/main `7c509eb6`.

Verdicts and dispositions are appended as reviews are actually received; no
review is recorded by intent.

**Blindness note.** The Fable artifact was written to `llp/reviews/` while the
Codex run was still in flight. The capsule instructed both families not to
read `llp/reviews/` artifacts concerning LLP 0146, and the Codex transcript
(17,820 lines) was searched afterwards for any reference to that path: none
appears. Blindness held.

### Round 1 results

**Both families NOT READY.** Codex returned one BLOCKING, eight MATERIAL,
and two DETAIL; Fable returned four MATERIAL and four DETAIL. Both
independently verified the document's `file:line` anchors and the three
corpus pins the capsule flagged (`acceptance.run` pinned-but-unbuilt, CV-14
open and claimed by no move, `function_run_secret_scopes` as the sole
out-of-file `captured_reads` consumer) and found all three exact.

**Convergent findings.** Both families independently found:

- **The baseline table's false "shipped" rows.** `function.explain` serves
  only `mutationDryRun`; the other pinned kinds refuse with
  `SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED` (`src/host_ops.rs:1717-1721`). And
  `checkpoint` does not appear in `src/host_ops.rs` at all — verified: zero
  occurrences. The v0.1 Summary sentence "Mutation dry-run, query explain,
  and checkpoint are implemented in `src/host_ops.rs`" was two-thirds false,
  written off a cross-file grep whose hits were never attributed to files.
- **D1's three-state per-invocation verdict is unsound.** Fable: a
  conditionally-read table is unwitnessed on every invocation that skips its
  branch, so per-invocation `overDeclared` is noise by construction. Codex
  added the sharper case — one invocation can be under- *and* over-declared
  simultaneously — plus the evidence-completeness problem (actions carry
  empty captured sets, `src/local.rs:1705-1740`).
- **The candidate count.** Five stated, six adjudicated.

**The material divergence, and the reason the loop was worth running.**

Codex returned **BLOCKING-1: the correction is false for the Cloudflare
arm.** Fable had recorded the opposite as a *strength*, writing that "the
type system makes declared-name flow into invalidation structurally
impossible" and that it "found no declared-reads consumer in any
invalidation path (Cloudflare arm included — no independent
`read_dependencies` handling exists under `cloudflare/`)."

Fable's observation was literally true and its inference was backwards. The
absence of captured-read consumption on that arm is precisely the problem:
`fanOut` selects affected subscriptions with `functionTables(fn)`
(`cloudflare/src/coordinator.js:5163-5167`), and `functionTables` returns the
function's **declared** `fn.tables` (`:5539-5542`). The coordinator's own
header says captured read sets are "recorded but not yet validated"
(`:22-23`). Verified directly. Codex is right: a handler declaring table A
and dynamically reading B is not woken when B changes, on Cloudflare, today.

This is the same asymmetry the 0141 loop produced — one family checked for
the presence of a hazard and stopped; the other checked what the code uses
*instead*. Adjudicated in Codex's favour on verification, not authority.

**The author's own pre-verification pass found what both families missed.**
Reading `src/live_matcher.rs` end-to-end rather than tracing
`read_dependencies` call sites showed the local claim is also too strong.
`live_subscription_may_be_affected` (`:129`) prefers captured dependencies,
but `live_subscription_may_be_affected_by_dependencies` (`:195`) returns
`None` when no `Query` dependency was captured — its comment says "the
captured reads do not summarize the handler's full read set (e.g. a handler
that never ran, or captured nothing); fall back to the conservative
read-set-summary arm" (`:229-233`) — and the inline-JS fallback arm decides
delivery from `definition.read_set_summary.tables`, the **declared** set,
returning `false` when no change touches it.

So the declared set reaches the local delivery decision too, on a named
path. Fable's "structurally impossible" is wrong; Codex's "the local-runtime
analysis is substantially correct" is too generous; and v0.1's flat
rejection of the original critique was wrong in both directions at once.
The v0.2 correction is target-scoped and names the local fallback
explicitly.

**Findings unique to one family, all adjudicated as correct and applied:**

- Codex MATERIAL-3 — D2 did not close `acceptance.run` as claimed. LLP 0042
  deferred the server-side runner with a named reason (`llp/0042:192-202`)
  and LLP 0024 specifies the operation's result contract. D2 is a CLI
  composition; the claim is withdrawn and the relationship becomes OQ9. Codex
  additionally required the receipt to bind the acceptance profile, test
  bytes, target/data identity, authority context, and seed — not the artifact
  generation alone. Applied.
- Codex MATERIAL-4 — D3 duplicated LLP 0062's existing
  `introspect --changed-since <envelopeHash>` (`llp/0062:1521`). Verified.
  D3 now extends that spelling instead of minting a rival command, and hash
  custody becomes OQ10. Fable's DETAIL-4 found the same custody hole from the
  other direction.
- Codex MATERIAL-5 — D4 cannot derive live blast radius from two artifact
  generations, since local delivery is captured-dependency-driven; and a
  deterministic schema-diff derivation already exists
  (`src/migration.rs:896-923`, `src/cli.rs:779-813`). Verified. D4 now splits
  declared from observed radius and extends the existing derivation.
- Codex MATERIAL-6 — D5's protected-last-member class already ships:
  `src/storage.rs:13192-13203` guards demotion of the final protected holder
  and `plan_membership_remove` (`:13220-13263`) refuses removing it.
  Verified. Two of the four proposed invariant classes are withdrawn.
- Codex MATERIAL-7 — D6's replay acceptance criterion exceeded its stated
  control over nondeterminism. Applied as a `deterministic` / `observed`
  reproduction class, plus an explicit statement of what D6 ratifies from
  LLP 0054 (which is itself unratified research).
- Codex MATERIAL-8 — D7's example carried no `riskClass` and marked
  `useDifferentPrincipal` as `requiresApproval: false`, contradicting the
  decision's own safety rule. Rebuilt with four independent axes and a
  positive `machineApplicable` discriminator.
- Fable MATERIAL-3 — D1's two refusal codes were assigned to LLP 0144's
  registry, which scopes itself to application-declared codes and explicitly
  calls platform-code registry gaps a different thing (`llp/0144:135-137`).
  Verified. Reassigned to the LLP 0010 platform discipline.
- Fable MATERIAL-4 — D5 never engaged the LLP 0110/0134/0135 bounded-relation
  family, which declines exactly this ground: `hide-orphans.v1` is its only
  parent-deletion policy and it excludes "referential constraints, cascade
  deletion, or orphan cleanup" (`llp/0110:917`). Verified. D5 now applies
  only to ad-hoc relations, must refuse promoted incarnations at codegen, and
  the convergence question becomes OQ13.
- Fable DETAIL-2 — the recent-invocation ring is implemented, not merely
  specified, but records host operations only (`src/host_ops.rs:63-64`), so
  D1's "without instrumenting anything" needed a scoping caveat. Applied.

**Author-verified before application.** Every finding applied was checked
against the tree first. No applied finding was refuted. One reviewer *claim*
was refuted — Fable's Cloudflare strength — and one was found too generous —
Codex's local assessment.

**Reviewer-artifact defect worth recording.** Codex's source anchors were
accurate throughout, including the BLOCKING, but its **LLP filenames are
confabulated**: it wrote `llp/0024-host-operation-contracts.rfc.md`,
`llp/0042-acceptance-runtime-control-plane.spec.md`,
`llp/0054-deterministic-simulation-testing-for-snapback.research.md`,
`llp/0062-agentic-authoring-control-plane-plan.plan.md`,
`llp/0097-branch-effect-isolation.rfc.md`,
`llp/0108-app-codegen-contracts-and-type-generation.rfc.md`, and
`llp/0144-host-operation-semantics-analysis.rfc.md` for documents whose real
slugs are entirely different. The line numbers and quoted content in those
files were checked and are correct, so the findings stand — but a future
round should treat Codex LLP filenames as unreliable and re-resolve by
number.

### v0.2 fix pass

Applied all round-1 findings. The substantive changes beyond factual
correction:

- **The correction is rebuilt as three target-scoped sections** (local,
  Cloudflare, other arms) plus a common section, replacing v0.1's flat
  claim. The Cloudflare subsection states a live product defect in the
  document's own voice.
- **D1's priority rationale changes.** It was first because it was cheap;
  it is now first because a shipped target can lose live updates without it.
  The Summary states this up front, and Sequencing carries an explicit
  "one item jumps the waves" note for the fan-out disposition.
- **D1's evidence model is replaced**: independent `missing`/`extra` deltas
  plus a `complete | incomplete | unsupported` provenance state, with
  over-declaration decidable only at aggregate coverage scope.
- **Three claims are withdrawn rather than repaired**: D2 closing
  `acceptance.run`, D5's two already-shipped invariant classes, and D7's
  `requiresApproval: false` on a principal-changing remedy.
- **Open questions grew from 7 to 14**, the additions being the honest
  residue of the findings rather than new speculation.

`./ref-check --verbose` passes (148 LLP docs, 0 errors). Document grew
605 → 901 lines.

**Ticketed independently of this RFC's adjudication.** The Cloudflare
fan-out defect is a live product bug, not a missing affordance, so it is
filed at `issues/20260801-cloudflare-live-fanout-uses-declared-tables.md`
with the three candidate fixes and an acceptance case. Writing that ticket
surfaced a second smell not caught in review: `functionTables` falls back to
`[schema.tables[0].name]` for a function with no declared tables
(`cloudflare/src/coordinator.js:5539-5542`), attaching it to whichever table
happens to be first in the schema rather than to all of them. Recorded in
the ticket.

## Round 2 — 2026-08-01 (delta-scoped)

Instruction capsule SHA-256 (shared by both families):
`430e8c16522abd3ad5d8b96ed22166e6756ae503d9f3d0d30336e1761149f103`

Target SHA-256 (v0.2):
`111b7b364b219e516d1667f9dd0a7efbec46346291cb4eaa58cc7fff3bcd9e29`

Delta-scoped per the standing loop mechanics: each family sees only its own
round-1 artifact, is told what changed, and is asked to disposition its own
prior findings (FIXED / PARTIALLY FIXED / NOT FIXED) before looking for new
ones. The Codex prompt additionally carries a correction notice about its
confabulated LLP filenames, instructing it to resolve paths by listing
`llp/` and matching the number prefix.

### Round 2 results

**Fable READY. Codex NOT READY** (1 BLOCKING, 6 MATERIAL, 2 DETAIL).

Dispositions of round-1 findings: Fable marked all eight of its own FIXED,
each re-verified against code rather than taken from the Revised block.
Codex marked five FIXED and six PARTIALLY FIXED.

**Both families independently found the same thing neither found in round
1, and which the author had found while writing the ticket:**
`functionTables` falls back to `[schema.tables[0].name]` when `fn.tables` is
absent or empty (`cloudflare/src/coordinator.js:5539-5542`). Fable drew the
sharper inference — a live query with *no* declared tables fans out on
whichever table happens to be first in the schema, "exactly the state a
code-first agent leaves a handler in," which is arguably a worse miss than
the declares-A-reads-B case the RFC leads with. Recorded in the Cloudflare
subsection and in the ticket.

**Fable's DETAIL-1 corrected v0.2's own new text.** v0.2 wrote that "an
empty or wrong `read_set_summary.tables` decides delivery on its own."
Verified: `tables.is_empty()` passes *every* change through the filter
(`src/live_matcher.rs:151`), so an empty declared set is the conservative
direction locally; only a **non-empty wrong** set can suppress delivery.
Fable also sharpened reachability — the fallback fires for any capture
holding only `Row`/`MissingRow` facts and no `Query` fact, so a
*successful* point-read-only handler lands on the declared arm, not just
one that "never ran."

**Codex's BLOCKING-1 was a demand to close an open question, not to fix a
design.** v0.2 deferred the offline/RQS disposition to OQ12 as "out of
scope." Codex showed the source settles it: retention eligibility requires
a `HostPlan(Query)` with a complete plan-consistent single-table summary,
and an opaque JavaScript handler is refused with
`undeclarable_retention(function, "opaqueJavaScript")`
(`src/manifest.rs:2981`, eligibility at `:2299-2353`; the Cloudflare arm
applies the same rule at `cloudflare/src/rqs-host.mjs:194-223`). Verified.
Since opaque JS is the only shape where hand-authored drift can occur, and
retention excludes exactly that shape, drift has no retention effect today.
v0.3 records the disposition and narrows OQ12 to the conditional case.

**Two round-2 findings are defects v0.2 introduced by applying round-1
findings**, which is the loop working as intended:

- **D3's hash space.** Round-1 Codex MATERIAL-4 said D3 duplicated
  LLP 0062's `introspect --changed-since <envelopeHash>`. v0.2 adopted that
  spelling — but 0062's envelope is "content-addressed and immutable"
  (`llp/0062:246-260`), while the digest also carries row counts, recent
  refusals, and conformance verdicts, which change while the hash stands
  still. Verified. v0.3 splits the digest into a static section keyed by
  `envelopeHash` and a dynamic section keyed by a `digestCursor` bound to
  `(envelopeHash, observation state)`.
- **D7's carrier.** v0.2 asserted LLP 0144 owns the refusal wire envelope.
  0144 says the opposite: it keeps the application refusal inside
  diagnostic details and assigns first-class envelope-shape changes to
  LLP 0094 — "a wire-shape change owned by LLP 0094 (the wire-envelope
  contract), not this document" (`llp/0144:323-326`). Verified. Ownership
  reassigned to the 0094/0095 family.

**Codex's sharpest genuinely-new finding** is MATERIAL-1: D1's two-delta
model collapses the read/write class. `FunctionRunResult` carries four
collections (`src/local.rs:1449-1458`), and an untagged union lets a
read/write swap cancel — declared-read A plus declared-write B against
observed-read B plus observed-write A has identical unions on both sides
despite two violations. v0.3 moves to four class-tagged deltas with
per-class provenance.

**Other round-2 findings applied, all verified:** D5's promoted-relation
overlap test named the wrong side (a `RelationIncarnation` is a protected
field on the *child/source* row paired with a foreign-key field —
`src/manifest.rs:829-840`), and `onTargetDelete: restrict` needs a
source-side reverse index that `targetIndex` does not supply; D4's observed
radius needs *paired* comparable bundles or it is a current radius, not a
diff; D6's `deterministic` class must be transitive, since a controlled
top-level step can still run through SQLite, sockets, threads, or an
action; D7's example omitted the preconditions its own text required;
search is a one-shot `FunctionKind::Query` (`src/local.rs:22591`), not the
live plan-table arm v0.2 grouped it with; and Fable's residue and
sequencing-tension details (the "leverage" framing after D2's withdrawal,
and OQ8's third shape being Wave 3 machinery inside a Wave 1 commitment).

**No round-2 finding was refuted.** One reviewer characterisation was
narrowed: Codex's MATERIAL-2 also asserted the baseline "falsely says both
sets exist for every handler" — the baseline sentence did overreach and is
now qualified to the supported successful query and mutation paths.

### v0.3 fix pass

Applied every round-2 finding from both families. `./ref-check --verbose`
passes (148 LLP docs, 0 errors). Document grew 901 → 1043 lines.

v0.3 SHA-256:
`9d3658ad85ed9c9402d5373e069c3469ed1acfe377b81accd678c168f00393c4`

## Round 3 — 2026-08-01 (delta-scoped)

Instruction capsule SHA-256:
`c8a064f831bc222d507473f1ba5c319c45327954ac2b4e385c94455738736af0`

Target SHA-256 (v0.3): as above. Repo revision: `f946e69a`.

The capsule explicitly named the cross-fix propagation failure mode — "check
whether applying one family's finding introduced a defect elsewhere; that
happened twice between v0.1 and v0.2 and is the failure mode most likely to
recur" — and asked each family to verify v0.3's new factual claims
independently.

### Round 3 results

**Fable READY** (1 MATERIAL, 5 DETAIL). **Codex NOT READY** (2 MATERIAL,
2 DETAIL); it dispositioned eight of its nine round-2 findings FIXED, with
D5 PARTIALLY FIXED.

**The notable result is convergence.** Two families, blind to each other,
independently found the *same four residues*:

| Residue | Fable | Codex |
| --- | --- | --- |
| D5 acceptance still encodes the withdrawn target-side test | MATERIAL-1 | MATERIAL-1 (part) |
| D1 report/acceptance keep collapsed `missing`/`extra`/`provenance` | DETAIL-1 | DETAIL-2 |
| Retention paragraph conflates two gates, omits the relational arm | DETAIL-2 | DETAIL-1 |
| D3 exposes only `envelopeHash` after deciding two delta keys | DETAIL-3 | MATERIAL-2 |

Every one is **propagation lag**: v0.3 corrected the body of a decision and
did not carry the correction into that decision's example, normative prose,
acceptance clause, or open question. No round-3 finding disputed a design
choice, and none inverted a claim. That is the signature of a document
approaching convergence rather than one still being argued with.

**One genuinely new defect, from Codex.** v0.3's replacement overlap
predicate for D5 was ill-typed: it asked whether `sourceFields` "coincides
with" the incarnation's `foreign_key_field`/`parent_table` pair, but
`parent_table` is a *table identity*, not a member of a field list. v0.4
restates it as three correctly typed terms (source table equality,
foreign-key-field membership, target-vs-`parent_table` equality). Codex also
observed that the declaration exposed only `targetIndex` while the prose
demanded both indexes be nameable; v0.4 adds `sourceIndex`.

**One genuinely new defect, from Fable.** D6 offered provenance-following
and a conservative fallback as alternatives, but SQLite is named among the
uncontrolled subsystems and every durable step touches it — so the blanket
fallback would leave `deterministic` unpopulated and make D6's own
acceptance clause unsatisfiable. v0.4 marks the fallback a degraded mode
rather than a co-equal route.

**Author-verified before application.** Fable's DETAIL-2 was checked in full
and is correct: `validate_retainable_query` is the erroring gate and *also*
admits a qualifying `HostPlan(RelationalQuery)` with a two-table relational
summary (`src/manifest.rs:2911-2971`), while `rqs_eligible_digest_kind` is
the non-erroring predicate whose doc comment says a failing query "is simply
not eligible, never a load error" (`:2304-2307`). v0.3 had merged the two
into one sentence. The conclusion survived; the description did not.

No round-3 finding was refuted.

### v0.4 fix pass

Applied every round-3 finding from both families. `./ref-check --verbose`
passes (148 LLP docs, 0 errors). Document grew 1043 → 1123 lines.

v0.4 SHA-256:
`985790cf195f40b315059768c0e4878b9be28aca1da9ed21ae67158bdb4d930f`

## Round 4 — 2026-08-01 (delta-scoped, confirmation)

Instruction capsule SHA-256:
`7ba422d8fed2018abe909ffc713c8626db636101da57f76555c442c832ed2d23`

Target SHA-256 (v0.4): as above.

Scoped as a confirmation round: disposition round-3 findings, re-check the
propagation failure mode across examples/prose/acceptance/open questions,
and verify the two new constructs (the retyped `overlaps` predicate and the
cursor-embeds-hash carrier). Both families are explicitly told not to hunt
for new material in text stable since v0.1 that already passed their review,
and to say so plainly if the document has reached the bar.

Results are appended when the reviews are actually received.
