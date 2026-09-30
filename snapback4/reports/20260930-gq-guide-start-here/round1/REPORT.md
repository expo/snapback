# GQ round 1 — qualified repairs and child-record rules

Date: 2026-10-01. Branch: `sb4-intent/gq-guide-start-here`.
Starting revision: `515fd5b5f9e89c24ad821315beb88cabb1618404`.

Read the complete round-0 prompt, report and failure record, and Astra's complete
`~/sb4-intent/reviews/gq-r0.astra.md` review. All three requested changes are addressed.
No compiler, engine or client behavior changes; this round changes guide text,
its test context/runtime witness, the owning LLP and evidence.

## Integration

Before editing, ran `git fetch origin`, then
`git merge --no-ff --no-commit origin/main`. Git returned **Already up to date**.
`git ls-remote origin refs/heads/main` independently confirmed
`096a1b78ef9ebceedf936b2293e253e0870c9e03`, already round 0's parent.
QX's main merge, `6e03a7e7c990989f0f07d28a8327643dbacefa95`, is an ancestor of
this branch. Its membership-path implementation and both histories remain intact;
no additional merge commit or conflict resolution was necessary.

## Review dispositions

1. **Sync repairs:** `N_SYNC_ORDER` says to keep the intended selection, explicitly
   mentions cursorless `first 1`, and requires restarting pagination if order
   changes. `N_NO_HORIZON` says to read the diagnostic's prediction warning before
   adding a horizon or intended cap. The opening remains 15 lines.
2. **Maintained aggregates:** `N_MAINTAIN_SYNCED` says the aggregate does not inherit
   its source's horizon. `online only` requires accepting the loss of both offline
   reads and prediction for the dependent mutations named by the note; `predicts`
   then fails with `E_NOT_PREDICTABLE`. The opening remains 13 lines.
3. **Child-record rules:** the duplicate owner-only `todos` table is replaced by
   reactions on messages in conversations, using
   `read <- exists members[.message.conversation, viewer]` and
   `sync to members[.message.conversation] last 500 by .id`.
   A single constraint line requires the whole parent rule, a required immutable
   reference without a default, and immutable parent rule/expiry fields.
   The introduction states the inherited lifetime and insert authority as well
   as the equivalence to `read through` and inferred `sync`.

The rules excerpt occurs verbatim in the existing complete receipts/reactions
recipe. That recipe now calls its chat field `conversation`; its parents and
receipts remain online, and the text explicitly states that reaction pages use
the server. The child horizon bounds acquisition without promising local parent
reads. The existing principal-ordered reaction query is preserved. Its ordinary
write rules and unread aggregate remain demonstrated.

The shared test context resolver now includes rules. The new runtime witness
compiles the exact excerpt in its full recipe, compares its schema with explicit
`read through`/`sync`, and checks a member's insert, another member's read,
outsider read/write denial, membership-scoped sync delivery, and parent-bound
expiry. The reference also corrects two stale pre-QX claims: dotted membership
paths were called unsupported, and child upserts were said always to queue.
The replacement states their required child-group and changed-constraint coverage.
The self-equality repair remains in the opening, which still fits 15 lines.

## Reading distance and budgets

[MEASUREMENTS.md](MEASUREMENTS.md) and [measurements.json](measurements.json)
record every card and retain round 0's measurements unchanged. All eight opening
sizes are unchanged: **112 lines total**, each at most 15. Rules shrinks from
**374 to 372 lines**; every other whole-card count is unchanged. No line or word
ceiling, historical snippet hash or fact inventory was raised or relaxed.
`guide start` and `guide index` still print identical **125-line** CLI output,
including the final blank line; [the page is retained](guide-start.txt).

The reaction authorization/sync form now appears in the opening's first fence,
ending at line 11. Round 0's opening did not teach that form; its complete
reaction recipe ended at line 128, versus line 127 now. The short excerpt still
needs the displayed parent schema. This is an orientation improvement, not a
claim that a complete reaction feature now takes 11 lines of reading. Round 0's
full-task table and the review's limits on its interpretation still apply.
No new calibration, builder timing or data-modeling score is claimed.

## Verification

**485 affected tests passed**, with four existing aggregate tests ignored and
zero final failures. Count each test once, using the final guide run:

| Scope | Passed | Evidence |
| --- | ---: | --- |
| Whole guide, including diagnostic registry and historical fact/snippet checks | 110 | [guide-preservation-final.log](guide-preservation-final.log) |
| Language aggregate copies, audience bounds, effect reads, maintains, membership paths, read-through sync, residency, server opt-in, sync windows | 193 | [lang-affected.log](lang-affected.log) |
| Core lane-source corpus | 10 | [core-lane-source.log](core-lane-source.log) |
| Device guide and effect-read witnesses | 2 + 4 | [device-guide.log](device-guide.log), [device-effect-reads.log](device-effect-reads.log) |
| Device read-authorization census | 81 | [device-census.log](device-census.log) |
| Simulation search witness | 1 | [sim-search.log](sim-search.log) |
| CLI check, guide discovery and aliases | 84 | [cli-check.log](cli-check.log) |

Whole guide: `cargo test -p snapback4-lang --test guide`.
Other affected commands and exit statuses: [commands.json](commands.json).
The final guide run follows a prose-only preservation edit restoring the old
self-equality tip and explicit current-partition wording. Example bytes and the
test witness were unchanged from the passing affected run. The final CLI was
rebuilt before rendering the retained cards and comparing aliases.
`./ref-check --verbose` and source/documentation whitespace checks pass.

The full suite was **not run**, as instructed for this docs/tests round.
Round 0's full run remains recorded as `== 1 failure(s) in 1441 s`; the affected
passes here do not turn that historical run into a full-suite pass.

`node scripts/generate-diagnostics-registry.mjs --check` exits 1 with the same
**baseline** stale Snapback 1 projections recorded in round 0:
`guide/reference/diagnostics-registry.json`, `guide/reference/diagnostics.md`,
and `packages/snapback-client/diagnostic-codes.d.mts`.
[The complete output is retained](root-registry.log). Its indexed production
sources and these generated authorities are unchanged by GQ; no unrelated
projection was regenerated. This is separate from the passing Snapback 4
emitted-code registry/definition/recovery census in the guide suite.

No root guide-manifest or inventory input changed: no new test file, demo or
publication leaf, and no Snapback 1 emitting site moved. The root manifest and
inventory checks were therefore not rerun or regenerated. The Snapback 4 guide
registry and discovery inventories pass in the whole-guide/CLI tests.

## Governing context and scoped audit

Used read-only `llp-orient` for these cards and their shared compilation context.
[LLP 3000 §4](../../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
and Snapback 4's AGENTS/NOT-DOING fence bound the scope.
[LLP 3000.007 §20.19](../../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#2019-wave-10-one-way-in-and-a-diagnostic-that-carries-its-own-explanation)
(current) governs short, reachable explanations;
[LLP 3000.011.000.000 §§2–3, 8](../../../../llp/3000.011.000.000-contextual-compiler-guidance.rfc.md#8-start-here-card-structure)
(implemented, archived) governs verified examples and repairs that disclose
semantic costs. [LLP 3000.014 §2](../../../../llp/3000.014-a-child-reads-through-its-parent.rfc.md#2-the-form)
(implemented, archived) governs QX's whole-parent-rule equivalence and immutable
captures. Sync's existing LLP 3000.021 §3.1 annotation remains applicable.

The scoped audit corrected the stale QX statements and extended the existing
card-structure record; no new design decision, LLP, gate, registry or script.
No unresolved task-scoped documentation drift was found. The remaining limitation
is explicit: the opening is contextual, and offline reads also need parent
coverage. Hand-off: none. Journal: one append-only round-1 entry.

All development failures and their classifications are retained in
[FAILURES.md](FAILURES.md). No subagents, push or publication.
