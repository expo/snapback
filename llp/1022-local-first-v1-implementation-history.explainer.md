# LLP 1022: Local-first v1 implementation history

**Type:** Explainer
**Status:** Draft
**Systems:** `snapback2/packages/snapback2`, `snapback2/packages/compiler`, `snapback2/crates/snapback2`, `snapback2/crates/snapback2-core`, LLP 1012 review and landing history
**Author:** Codex GPT-5.6 Sol (structural curator; original authorship and review provenance remain attributed below)
**Date:** 2026-09-11
**Revised:** 2026-09-11
**Related:** [LLP 1012](./1012-local-first-v1.spec.md), [LLP 1019](./1019-derived-delivery-custody.rfc.md), [LLP 1018.000](./1018.000-client-runtime-integration.plan.md), [LLP 1018.003](./1018.003-client-item-surface.plan.md), `llp/reviews/1012-local-first-v1.*`

## Purpose and provenance

This companion preserves implementation, measurement, and review history
extracted from LLP 1012 on 2026-09-11 so the implemented specification stays
below the repository's 1,500-line document cap. It does not amend LLP 1012,
ratify a proposal, or claim author or reviewer acceptance. LLP 1012 remains the
normative contract and retains all of its existing section and subsection
anchors. The original author and reviewer attributions below are carried from
LLP 1012 and its provenance-addressed review artifacts.

The curation moved only dated baseline observations, superseded implementation
records and allocations, landing chronology, review synthesis, and a scheduling
question made historical by the recorded landings. Current rules remain in LLP
1012. When this explainer and LLP 1012 differ, LLP 1012 controls.

## Revision and status chronology

LLP 1012 reached `Implemented` in revision (j), 2026-09-05. Its recorded
landings were 4–6 (`9f4f4953a`, `e992c391e`, `4f5eef21f`), the fence
(`2dded8335`), overlay retirement (`3b483d652`), supersession (`d4de10457`),
the owner split (`ba8e6309e`), the loop index and ruler (`685b883b5`,
`1e39b0d9d`), and Expo E1/E2 (`aa2ec8d33`, `926d62ad7`; LLP 1013).

The design record began with a 2026-09-04 panel and author rulings. Revision
(c) applied the author's principle to go straight to the ideal design: no
staging, the twin is the client, trace-validated OCC ships in v1, and retention
ruling 8 stands. Revisions (d) through (h) recorded implementation and review
repairs across the wire, validator, replay, twin, carriers, asset cache, and
overlay lifecycle. Later amendments recorded the engine schedule, auth and
startup recovery, indexed held search, follower ownership, item presentation,
runtime allocation, clock reads, coverage reset, and derived delivery custody.

This is chronology, not a new status decision. The current status and contract
are stated only by LLP 1012 and its related accepted/implemented LLPs.

## Pre-implementation baseline (2026-09-04)

Revision (a) checked `origin/main` at `9ffdf6dd0`; six panelists rechecked it.
The shipped client was in-memory, had no outbox or local evaluation, and ignored
`Last-Event-ID` on subscribe. The conformant TypeScript evaluator existed but
was not wired into the public client. Receipts distinguished absent from hidden
for primary point reads, while range receipts were limited to certified-uniform
sites and non-uniform ranges carried no range fact.

The owner was one thread over an `mpsc` channel with SQLite in exclusive
locking mode. One sequence was an owner-action property rather than a
transaction property. The invoked mutation path had no OCC comparison;
`new_ids` came from the store reservation. Sessions had a hard thirty-day
lifetime without renewal. Quarry refused schedules and had no retention
spelling. Governance had deferred offline work despite the messenger brief's
M5/M6 obligations. These observations motivated the author rulings retained in
LLP 1012 §2; they are not descriptions of the current implementation.

## Superseded recipe implementation

Lane O1c initially delivered tombstone and edit rows only to a conversation's
current members. Two attempted original-recipient spellings failed the language
available on 2026-09-04: an `or`-based sender/member index failed uniformity
certification, and Quarry could not construct a recipient list from a range.
The certified private log therefore used current-member fan-out, a maintained
member count, and a `GROUP_FULL` check at 51 members. Departed-member eviction
then depended on a primary point absence.

That authored-log design and its `messages.send` / `deliveries.post`
coexistence were superseded first by LLP 1002's template consolidation and then
on 2026-09-10 by LLP 1019's schema-derived `deliver` custody. LLP 1012 §3 now
states the current template, schedule, delivery, and drain rules.

## Read-store and witness implementation record

Lane O2b split the TypeScript evaluator into store, runner, and entry; hydrated
it from held schema and `coverage()`; mirrored Rust schema hashing; rejected
unknown fields on known wire shapes; and derived coverage from held-answer
receipts. The drained-prefix implementation linked pages from `after: null` to
`Exhausted`, rejected broken links, and distinguished `evicted`, `computed-key`,
and `never-held` partial reasons. Retained answers remained fallbacks for local
reruns denied, partial, or unavailable.

The 2026-09-06 browser witness corrected tail selection: an offline drain opens
at the held page chain's last cursor, while the stored watermark is reserved for
resume. Expo E2 then found that offline remounts must not overwrite that
watermark with a locally reconstructed cursor. The fix adopted the stored
watermark for offline views and made offline `mark` a no-op. It also established
that a reopened database is inspected before constructing a writing client.

These implementation details remain test and commit history. The current
offline-read, drain, search, and custody rules are in LLP 1012 §6.

## Indexed-search allocation history

The indexed held-search work was delegated on 2026-09-07 and implemented under
LLP 1018. The initial 34,000/30,000 allocation was speculative. A pinned
Node 22.23.2 / esbuild 0.25.9 / gzip-9 checkpoint found incomplete 44,290 and
46,838-byte candidates; they omitted required projection, receipt, or carrier
bodies and were explicitly retained as non-passing evidence.

A boundary audit replaced that with a 66,000-byte ceiling and 64,000 target for
the complete five-root local runtime. Same-toolchain measurements then showed
62,624 bytes in the work in progress and 63,023 bytes in an exhaustive export
cross-check. LLP 1018.000 later moved the canonical toolchain to Node 24.18.0
and adopted an 82,000 ceiling / 80,000 target after exact integrated values of
77,571, 79,272, and 79,207 bytes. Separate complete `client.ts` measurements
were 103,794, 110,485, and 110,520 bytes and were not app-download estimates.

Subsequent superseded allocations were:

- 82,500 bytes on 2026-09-07 for merged-schema reconciliation; the measured
  candidate was 82,085 bytes.
- 84,000 bytes on 2026-09-07 for the item surface, retaining the 80,000 target.
- 84,000 bytes frozen again on 2026-09-08 under the elegance program.
- 85,000 bytes explicitly approved by Charlie on 2026-09-09 after an
  84,580-byte integrated candidate.

The 2026-09-08 measured consolidation reduced a paired 82,085-byte baseline to
81,907 bytes and later reduced the item-integrated pair from 83,413 to 83,227
bytes. These are historical observations, not current ceilings. LLP 1012
§"Bytes — frozen allocation" retains the current 90,000-byte ceiling, 80,000
target, five-root method, pinned toolchain, and comparable-growth checks.

## Write-path implementation record

Lane O1b established principal-bound replay grants, server-side remaining-ID
and operation-demand pricing, trace-conflict precedence, canonical row and
verdict digests, ledger-before-grant deduplication, stored partial terminals,
and live-session checks. A byte-identical retry consults the ledger before
current operation lookup, allowing settled work to survive program evolution.

Lane O2c made intents, grants, FIFO order, traces, and overlays durable on both
carriers. Enqueue consumed the certified ID slice; replay sent one identical
envelope at a time; transport loss kept the intent queued; settlement and its
log tail landed atomically. A serial ledger tail prevented duplicate grant-slice
consumption. The 2026-09-04 afternoon ruling removed client-clock expiry: after
successful resume, the server alone judges old queued work.

The cancellation follow-up raced every resume-owned transport await against its
captured signal. Offline, close, auth transition, or terminal expiry leaves the
durable envelope queued and fences late results; fresh same-principal recovery
retries the identical envelope through the server ledger.

Lane F bound replay trust to intent and partition and required a successful
post-fence resume. Lane O2b ran prediction in the ledger critical section,
persisting overlay, trace, and `predicted` atomically. It recorded the accepted
range-read deviation, maintained-target omission, authoritative retirement,
bounded miss rule, and strict authority/supersession behavior. Later T1/T2
landings refined retirement and coverage reset. LLP 1012 §7 and §8 retain those
current normative rules; this section preserves only their landing chronology.

## Lane and landing chronology

The original implementation plan named O1 (wire, server, compiler), O2 (range
store, twin, outbox, web witness), and O4 (asset bytes and Expo carrier). The
external `purgeExpired` dependency was replaced on 2026-09-05 by LLP 1016 D5's
owner-fired `expireMessage` schedule.

O1c landed at `7438b6a4b`; O1a landed in `7438b6a4b` and `f24ad7d6d`; O2a
landed at `f24ad7d6d`; O1b landed at `37281c059`. Later 2026-09-04 landings
carried O1b fix rounds, O2c, O4-web, the close/drain integration seams, O2b,
and fourteen scaffolded-template journeys. The Expo carrier and simulator
witness followed under the Expo arm. LLP 1012's `Implemented` status records
the completed result; this chronology does not independently certify it.

## Panel and review record

Six blind round-one reviews and five round-two design contributions occurred on
2026-09-04. The original artifacts remain under
`llp/reviews/1012-local-first-v1.*`, with synthesis in
`llp/reviews/1012-local-first-v1.panel.synthesis.md`. Round one was six of six
NOT READY. Round two, at the author's instruction, contributed designs that
converged on the eventual range, retention, outbox, resume, and witness model.

The record attributes the range-absence gap, unbounded resume, and missing
replay envelope to all six round-one reviewers; the page-200 refusal, hard
session wipe, and receipt oracle to Fable; missing OCC and the client-clock
problem to Codex; unrelated digests and exclusive locking to Grok; missing
drain rotation to Codex and Muse; view-once timing to Gemini; purge-with-proof
independently to Fable, Grok, and Codex; the strong-validator analogy to Codex;
and the journey primitive to all five round-two contributors.

No review artifact was created or altered by this curation, and this explainer
does not convert any review verdict into author acceptance.

## Historical scheduling question

Revision (b) left a schedule question: whether O1 should begin before the loop
bar because its server/compiler work did not compete with client-facing lanes.
The document recommended starting O1 immediately while keeping O2/O4 relative
to `T`. The recorded landings make that recommendation historical. The three
substantive revision-(b) questions were already recorded as closed by the
author's principle: retention ruling 8 stands, trace-validated OCC ships, and
the twin is the client.
