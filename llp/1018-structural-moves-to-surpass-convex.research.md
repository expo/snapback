# LLP 1018: Structural moves to surpass Convex in Clique

**Type:** Research
**Status:** Active
**Systems:** Snapback 2 client and offline runtime, live queries, query engine,
certification, Quarry compiler, schema evolution, agent authoring experience,
Clique benchmark
**Author:** Codex gpt-6-astra (initial draft, commissioned by Charlie Cheever,
2026-09-06); revised by Claude Fable 5.1 after the five-model panel of
2026-09-06/07 (§9), which the author convened
**Date:** 2026-09-06
**Revised:** 2026-09-07 (focused panel: witness-first sequence and finite compiler closeout, §13); 2026-09-07 (two focused draft RFCs and three bounded architecture investigations, §12); 2026-09-07 (pending-client schema conflict exercise and formal M7 handoff); 2026-09-07 (surviving-row uniqueness checked against each actual rebuild); 2026-09-07 (panel revision: a second measure, move one rewritten
around what already exists, the browser-tab policy decided, count-backed cap
probes decided, the typed IR cut, move four evidence-led, move zero added, the
Muse scores cited, the clock repair marked landed; implementation record §10);
2026-09-06 (initial evidence-backed assessment)
**Related:** LLP 1000, LLP 1001, LLP 1002, LLP 1004, LLP 1010, LLP 1011,
LLP 1012, LLP 1013, LLP 1015, LLP 1016, LLP 1017, LLP 1018.001, LLP 1018.002, LLP 0329.014.007;
`benchmarks/briefs/social-messenger.md`,
`benchmarks/runs/2026-09-06-clique-improvement/README.md`,
`benchmarks/runs/2026-09-05-clique-full-3x3/holistic-scores.md`;
`llp/reviews/1018-panel.*.md`

## 1. Thesis and scope

Snapback's best primitives are increasingly competitive. Its remaining
disadvantage is how much application code connects those primitives into a
working product, and how much of the platform's contract a builder has to
discover by probing it. The structural investment should make authorization,
live queries, persistence, prediction, search, and evolution compose through
the ordinary application surface, and make every seam a builder meets explain
itself.

The architectural measure is a pair, both countable from a build diary:

- **Application-owned infrastructure removed**: corrective caches, custom
  indexers, subscription coordinators, resume anchors, per-tab database
  forks, and recovery scripts. A smaller backend declaration is insufficient
  if its client needs a second synchronization implementation.
- **Contracts derived from behavior**: every readiness rule, cursor shape,
  grant ritual, lease, or refusal a builder learned by experiment instead of
  from a diagnostic, a `status` reason, or a guide line. Muse's 0.0.4 scorer
  put a third of its build time here; Astra's setup and diagnostics rows say
  the same in fewer words (§2).

The first measure without the second lets a platform remove code by moving
friction into opaque refusals; the second without the first lets it document
its way around plumbing it should own. Both are Snapback-attributed
correction loops in the loop bar's terms (`rules/NOT-DOING.md`).

This Research LLP records findings, decisions, priorities, and success
criteria. The panel of §9 converted the draft's proposals into the decisions
of §3–§7; §10 records which slices were built under those decisions, by whom,
and on what date. Concrete amendments to a mechanism still extend the
relevant existing LLP (1012 for the client, 1017 for caps, 1004 for lowering).

The covering-document search found mechanisms in LLPs 1001/1002,
1011/1012, and 1015/1016/1017, and an earlier competitive assessment in
[LLP 0329.014.007](./0329.014.007-competitive-and-local-first-assessment.research.md).
This is a separate Snapback 2 assessment because it draws on published
Clique builds across those mechanisms, rather than specifying one parent
proposal.

## 2. Evidence and what the scores establish

The [original narrative assessment](../benchmarks/runs/2026-09-05-clique-full-3x3/holistic-scores.md)
scored Snapback 0.0.4 / Convex / Supabase at 64 / 84 / 77 for Astra,
57 / 78 / 47 for Grok, and, added on 2026-09-07 once its three lanes finished,
78 / 82 / 62 for Muse Spark 1.3 (mean of three scorers 66 / 81 / 62). The
[later Astra diagnostic assessment](../benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-008-interim-holistic/score.md)
scored Snapback 0.0.8 / Convex / Supabase at 72 / 83 / 74, reusing historical
competitor narratives.

| Category | Astra: Snapback 0.0.8 | Astra: Convex | Muse: Snapback 0.0.4 |
|---|---:|---:|---:|
| Authorization | 92 | 82 | 80 |
| Media assets | 94 | 76 | 80 |
| Offline sync | 68 | 48 | 92 |
| Writes and transactions | 89 | 93 | 85 |
| Background work | 89 | 88 | 45 |
| Queries and live updates | 65 | 87 | 55 |
| Client integration | 63 | 83 | 65 |
| Diagnostics and dev loop | 65 | 87 | 50 |
| Setup and docs | 68 | 83 | 38 |
| Scale and limits | 58 | 80 | — |

Two scorers, two packages, one shape: Snapback wins or ties where the work is
a primitive (authorization, media, offline persistence, writes) and loses
where the work is composition or discovery (queries and live, client
integration, diagnostics, setup). Muse's notes name the discovery half
directly: "dev/reset have no --help", "grants/outbox/drain/lease semantics
came only from probes", "truncated 120-char miss lines caused four
misdiagnosed loops", "the viewed-guard lives only in .d.ts prose". Astra's
0.0.8 notes name the composition half: "a separate inbox client/cache, fresh
time-dependent queries and a root resume anchor around confirmed SDK
defects", "the second page boots memory-only".

These are individual narrative observations, not statistical estimates or
independent acceptance grades. The changed competitor rescore does not lower
the original fixed comparison bar of 84. Nor is 64 to 72 a controlled causal
estimate of improvement. Later package fixes receive no retrospective credit.
Muse's ultra-effort scoring remains unavailable; its xhigh scores are what
exist.

The [retained checkpoint](../benchmarks/runs/2026-09-06-clique-improvement/README.md)
at 2026-09-07 00:33Z records publication of 0.0.13, an incomplete cold run,
and no new holistic score or three-family win. Nothing here claims that
0.0.13 has the same defects or scores as 0.0.8.

Two features of the [canonical rubric](../benchmarks/briefs/social-messenger.md#scoring)
matter to prioritization. Offline behavior O4 and offline authoring B4
together carry 16 weighted points; day-2 evolution B8 and operations B11
carry 11. One failed degradation predicate keeps O5 at its floor, so the feed
alone cannot lift that band. Holistic scoring is separate and non-formulaic.
Unexercised dimensions can prevent a weighted total, so component
improvements alone cannot establish a comparative win.

## 3. Move one: one coherent reactive client

**Finding.** The 0.0.8 assessment records a separate inbox client/cache,
fresh time-dependent queries, and a root resume anchor around confirmed SDK
defects. The [multi-tab finding](../issues/20260906-snapback2-second-browser-tab-cannot-share-the-offline-carrier.md)
records a builder allocating a database per browser tab to work around
one-writer ownership, with the second tab's queue never merging. These are
application architecture changes, not verbose hook setup.

**What already exists (panel correction).** The draft asked for "one
transactional ownership boundary for row versions, coverage, answers, outbox
settlement, and invalidation". That boundary exists: `OfflineRuntime.commitMany`
serializes every delivery, watermark, settlement, tombstone, and fact change
into one `PersistentRangeStore.commit` swap, and `OutboxLedger.enqueue`
commits grant consumption, intent, and prediction together. The wire is
already one physical SSE stream with fenced logical children (`SharedSse`).
The clock-dependent delivery identity the draft listed as unlanded was
repaired on main on 2026-09-07 (`issues/closed/20260906-snapback2-clock-query-delivery-identity.md`:
the owner stamps `readTime`, the client orders same-sequence deliveries);
it awaits publication, not design. None of this is rebuilt.

**What was missing, and is now decided.** The client fought itself in the
layer between the swap and the screen:

- Every `subscribe` opened its own logical stream and kept its own state;
  two components reading one query were two subscriptions with two current
  answers, and the `mounted` set was last-writer-wins, so closing either
  duplicate evicted the query from resume for the survivor. **Decision:** one
  shared, reference-counted entry per `(authority generation, kind, op,
  args)`; later consumers attach to the first consumer's stream and see its
  current delivery first; the entry closes with its last consumer; each
  subscription removes only its own mounted record. `useQuery` is unchanged:
  it already had the right shape and now reads a shared entry.
- The browser carrier refused a second tab outright (`E_OFFLINE_LOCK` from a
  Web Lock requested `ifAvailable`), which killed the tab's client at
  startup. **Decision, the tab policy:** a second tab of the same account is a
  **follower**: it reads live through the ordinary wire, its `outbox.status()`
  reports `reason: "follower"` with `ready: false`, every write refuses
  `E_OFFLINE_FOLLOWER` before any bytes leave, and it waits on the writer lock
  outside the startup path; when the writer tab closes, the follower acquires
  the lock, opens the partition, resumes, and replays the queue the writer
  left. The wait is withdrawn on close, sign-out, and account change, so a
  discarded follower can never steal a lock later. Followers never send
  plain writes: a plain write landing ahead of the writer's queued intents
  would invert their order when that queue is inherited (Gemini and Grok,
  §9). SQLite carriers keep refusing at once: a second client of one native
  process is a programming error, not a tab. Forwarding follower writes to
  the writer (BroadcastChannel command forwarding) is deferred and filed; the
  ticket's "two tabs, one offline write each, both settle" witness therefore
  stays open and is stated as such in the guide. A frozen or throttled
  background writer keeps its lock; that is the one-writer contract, not a
  regression.
- Distinct per-row queries are not solved by sharing. The recipe remains the
  enriched page (`return page { *, message: messages[.messageId] }`, LLP 1012
  §3); no public plan algebra is introduced (`rules/NOT-DOING.md`).

Resource behavior is a constraint, not a preference. The
[full R8 review](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review/astra/REPORT.md)
records a 72,555-byte gzip search candidate against the 66,000-byte ceiling;
the client work here adds no retained copy (the shared entry holds one
delivery per key, which the stream held anyway) and measured +203 gzip bytes
on the boundary roots of LLP 1012 (§10).

**Success criterion (rewritten).** A fresh builder uses the packaged client on
React web and Expo for cold offline reads/search, predicted writes, restart,
revocation, and reconnect, without inventing an inbox cache, permanent resume
anchor, corrective polling loop, or per-tab database. Two components reading
one query cost one stream and never disagree. A second browser tab reads live,
refuses writes with a named reason, and inherits the single durable queue
when the writer closes. Current resource budgets and guarantees survive.

**Confidence:** high that client coherence is the largest structural
opportunity; high on the decomposition above, which is what the panel
converged on; the remaining open half is forwarding.

**Real-browser diagnostic (2026-09-07).** A source-built React chat in
Chromium shares one logical live child between two consumers. A follower
renders live data, refuses writes before transport, and inherits two queued
intents in FIFO order when the writer page closes; each produces one owner
row, then the new writer commits. Actual IndexedDB/Web Locks are exercised.
[Raw attempts and limits](../benchmarks/runs/2026-09-07-snapback2-1018-browser/README.md)
retain setup/readiness races and the successful witness. This is source
engineering evidence, not a published cold-builder result or forwarding.

## 4. Move two: efficient execution and certification that agree

**Finding.** The [cap-metering ticket](../issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md)
records 49 membership inserts being priced against a cap of 1,000 per
principal. The resulting examined-row bound forced a 50-person group into
multiple mutations. Patch-sensitive accounting partly improved this; the
per-insert charge remained open. A declared bound on one relationship was
constraining atomic work on another relationship.

**Decision (panel).** Charging once per distinct cap key does not fix the
recorded case: 49 invitees under `cap 1000 by principal` are 49 distinct keys
and still 49,000 examined rows (Gemini, Grok, and Muse each caught the
orchestrator's round-one arithmetic). The honest fix is the one LLP 1017 §2.4
already named as its follow-up: when the schema declares
`maintain <t> = count <table> by <exactly the cap's by columns>`, the engine's
cap probe reads that maintained row (one examined row, exact) instead of
scanning up to N, and the certificate reserves one examined row per call
instead of N. In-transaction exactness holds because `check_constraints` runs
before the row lands and `maintain` runs after each write in the same
transaction, so a 49-row loop sees its own earlier inserts. The `check`
refusal for an over-budget cap reserve pastes the exact `maintain` line the
builder needs, so the remaining cost of the decision is one declaration and
zero correction loops. The twin uses a held count row the same way and keeps
today's scan-or-partial behavior when the row is not held: a missing count is
never zero (Grok, Astra). Successor admission keeps scanning base rows; a
count row is never trusted during a rebuild. An engine-owned hidden count is
rejected: it would tax every capped write, add twin coverage and rebuild
obligations, and hide the cost the declaration makes visible.

Treat the execution strategy and its certificate as one design obligation.
Each saving must follow from the actual implementation, including writes that
maintain the optimization's own state. A smaller certificate over unchanged
expensive execution is not a repair.

The feed work demonstrates the approach. The [lazy merge repair](../issues/closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md)
admitted the 500-follow, 20-row feed at 1,025 examined rows, or 1,185 with
card reads. The [later retained-memory candidate](../benchmarks/runs/2026-09-06-clique-improvement/evidence/feed-final/final-report.md)
passed the original ratio checks at all three checkpoints, with ratios
approximately 2.00, 2.13, and 2.24. That is candidate evidence under its
recorded conditions, not a new published-package score. It also weakens the
argument that the earlier miss requires replacing SQLite.

**Success criterion.** A mutation inserting 49 rows under `cap 1000 by
principal` certifies under default ceilings once the matching count is
declared, executes atomically, and refuses at the cap exactly as the scan
did; without the declaration it refuses `E_BOUND` with the declaration in its
rewrite. The 500-follow feed and enriched message pages keep certifying and
satisfy the existing scale predicates. Work that genuinely exceeds a
transaction's budget keeps the explicit continuation model of
[LLP 1016](./1016-administrative-plane.rfc.md).

**Confidence:** high.

**Public-acquisition diagnostic (2026-09-07).** Ordinary count queries let
an offline client predict a two-principal allocation from held nonzero counts;
leaving one count unheld suppresses prediction. Cap overflow rolls the whole
owner mutation back. A public zero count currently carries no row or absence
in its receipt and therefore does not enable prediction; the conservative
[coverage gap is filed](../issues/20260907-snapback2-public-zero-count-does-not-enable-offline-cap-prediction.md).
[Raw evidence](../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md#public-count-acquisition-and-offline-prediction)
uses real owner/auth/query paths, not injected count rows. It does not qualify
49 actual inserts, scale, native clients, or a published cold-builder run.

## 5. Move three: Quarry owns semantics and earns its learning cost

**Finding.** A valid table and query both named `reactions` collided in
generated TypeScript and surfaced an opaque error at the module's first
line. The builder renamed the operation. This [published 0.0.8 finding](../issues/20260906-snapback2-quarry-operation-table-name-collision.md)
is evidence that an internal representation can impose an unintended public
language constraint; it is not evidence that the lowering path is broken.

**Decision (panel, unanimous).** Repair binding hygiene now: generated table
bindings get identities that cannot collide with operation, argument, local,
effect, or helper names, and every table reference prints through one
helper; public names are unchanged and `api.d.ts` exposes both. Collisions the
lowering cannot alias refuse at the Quarry declaration site with a family, a
site, and a rewrite. Diagnostics point at authored Quarry locations, never at
the generated module's first line.

**Cut from this round: the typed intermediate representation.** No scorer
attributed a point to the lowering path beyond the collision, and a compiler
replacement that must preserve effects, once-only evaluation, refusal
behavior, the generated client types, native/twin agreement, and the
subsecond check budget is weeks of risk for a Clique outcome the client and
the certificate decide. It may be reopened only on several demonstrated
failure classes or a census showing substantial machinery it would delete.
Reusable helpers (`fn`) stay deferred under [LLP 1011 §0](./1011-quarry-ergonomics.rfc.md#0-not-proposed--the-price-of-the-thesis-and-what-the-panel-deferred).

The larger authoring payoff is one declaration supplying several guarantees.
The already authorized indexed Unicode search work is the example: maintained
server indexing and the same search semantics over held local data, with
explicit partial results when coverage is insufficient. That work is not
paused for anything here.

**Success criterion.** Routine combinations of supported constructs compile
predictably, preserve their semantics on both evaluators, and explain real
constraints at Quarry source locations. A cold builder authors search once
and owns no corrective postings-maintenance implementation.

**Confidence (original round):** high on hygiene and diagnostics; the typed
path was not proposed in that round. The subsequent candidate and focused
proposal are accounted for in §12.

## 6. Move four: evolution of the whole application

**Finding.** The [operator guide](../snapback2/packages/snapback2/guide/operator.md)
already teaches expand, fill, contract, refusal of invalid narrowing, and
upload recovery. [LLP 1016](./1016-administrative-plane.rfc.md#d6--the-operator-seat-ad-hoc-programs-and-rehearsal)
provides jobs and rehearsal. M7 was not run in any lane of any scored run, so
the present score impact of evolution friction is unknown.

The [survivor-uniqueness issue](../issues/closed/20260906-snapback2-rebuilt-survivor-uniqueness.md)
was reproduced and repaired on 2026-09-07: ordinary surviving rows could escape
a new unique index during a maintained-table transition. Each rebuild now
checks survivors plus its actual replacement projection; native regression
tests cover atomic refusal during installation, migration, and reopening.
This closes that correctness finding, not the M7 evidence requirement.

**Decision (panel).** Evolution stays a direction, not a staffed program: run
M7 with the existing operator tools on a populated app before commissioning
migration machinery. The survivor-uniqueness repair is a correctness obligation;
Astra's round-two point stands that once
maintained rows back cap probes (§4), rebuild correctness is a dependency of
that slice and cannot wait for an evolution tranche. Preserve settled-intent
replay guarantees across operation/schema changes; never silently rewrite an
admitted queued intent to fit a new generation. Restoring a snapshot must not
be presented as code-only rollback if it loses later writes; the control-plane
contract remains [LLP 1015](./1015-control-plane.rfc.md).

**Success criterion.** A fresh M7 agent evolves a populated app, verifies its
prior data and behavior, and exercises the relevant pending-client transition
without reconstructing undocumented operational knowledge or writing bespoke
data surgery. The official M7 acceptance remains unchanged.

**Pending-client diagnostic (2026-09-07).** Rule verdicts bind the complete
schema (`Schema::rule_hash`, LLP 1001 §7), so even an optional-column addition
can make an unsettled predicted intent conflict. Preserving its replay bytes
and exposing `E_OFFLINE_CONFLICT` is the current contract; a user retries
with a new intent after reading current data. An already stored terminal
remains replayable after an operation is removed. The
[engineering exercise and M7 handoff](../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md)
record this boundary separately from the fresh M7 result.

**Confidence:** medium on the direction; low on present score impact.

## 7. Move zero: the contract is discoverable

**Finding.** Both scorers that saw Snapback lose put the loss partly on
discovery, and it is the cheapest gap on the board: no `--help` on `dev` and
`reset`, `check` miss lines truncated to 120 characters that cost four
misdiagnosed loops, grant minting as "an uncited ritual", the view-once guard
living only in `.d.ts` prose, missing worked examples for paginated history,
inbox restoration, and multiple tabs (Muse and Astra narratives, §2).

**Decision.** Every seam a builder met by probing gets a code, a `status`
reason, or a guide line, in that order of preference, and nothing else:
no documentation platform, no new page beyond the twelve, no calendar
freshness dates (`rules/NOT-DOING.md`). This round pays for the tab policy
(`E_OFFLINE_FOLLOWER`, the `follower` readiness reason, and the guide's
one-writer line), and the cap rewrite that pastes the `maintain` line (§4).
Checked against main on 2026-09-07 before filing the rest: `dev --help` and
`reset --help` exist, and `E_ASSET_VIEWED` is a coded refusal on the quarry and
offline pages, so those Muse observations describe 0.0.4 and are closed by
later publications; the 120-character miss-line truncation was not found in
the current `test` verb and is not filed without a reproduction. What remains
open from the narratives is the grant ritual, which the offline page states
and the auth page does not cross-reference. Each such item is an afternoon,
none is a design.

**Success criterion.** A fresh builder's diary attributes no correction loop
to a contract the platform knew and did not say.

**Confidence:** high; the evidence is two independent narratives naming the
same seams.

## 8. Priority, constraints, and the next decision

Investment order after the panel: move zero (cheapest, least speculative),
move one (largest), move two (most legible single defect), move three
(hygiene only), move four (evidence-led). The order expresses confidence and
score opportunity; it does not require stopping already authorized work in
another area. Lazy merge, indexed search, and the landed clock repair are
already structural moves within this direction, and publication of the
clock repair is the first action.

For each move, the concrete change names the application workaround it
removes, the existing component that assumes responsibility, the invariant it
preserves, and the smallest published-path witness that would establish the
result (§10 does this for the slices built). Use the existing benchmark
narratives and affected checks to record this; no new registry or gate is
proposed.

[The repository rules](../rules/RULES.md) and
[scope tradeoffs](../rules/NOT-DOING.md) still apply. This document does not
increase runtime budgets, authorize a second authoring language or JavaScript
data plane, introduce a public plan algebra, add a hidden engine-maintained
count, or add the deferred offline features. Ordinary affected checks and
publication policy remain separate from the full benchmark; a complete run
is evidence of the comparative outcome, not a new ambient landing gate.

The principal open questions are now narrower: whether follower-write
forwarding earns its protocol; how often Clique holds the count rows the
twin needs to predict multi-principal writes; whether the collision aliasing
leaves any generated identifier the builder can still see; and how much M7
friction remains after the existing recovery tools are used correctly.

No numerical score gain is forecast. A new cold builder experience and the
canonical independent grading, including native and M7 evidence, must settle
whether the changes actually surpass the retained Convex baseline.

## 9. Panel record (2026-09-06/07)

The author convened five models on the draft: Astra (gpt-6-astra, xhigh,
the drafter), Claude Fable 5.1 (orchestrator), Grok 4.6 (xhigh), Muse Spark
1.3 (xhigh; ultra is closed on this account), and Gemini 3.8 Flash (high).
Round one was blind and independent; round two showed every position to
every panelist and asked for fire on the two designs being implemented. The
verbatim reviews are sealed under `llp/reviews/1018-panel.<model>.md` with
the run record in `llp/reviews/1018-panel.run.md`. The orchestrator decided;
the panel's findings that changed the document:

- All five: keep the thesis; the store's swap and the clock repair already
  exist; cut the typed IR; keep `fn` deferred; add discoverability.
- Muse, Gemini, Astra, Grok: add a second measure (correction loops or
  contracts derived from behavior).
- Astra, Grok, Claude: the first slice is a shared, refcounted query entry
  above the store; the `mounted` set was last-writer-wins.
- Gemini, then Grok and Astra in round two: a follower tab that sends plain
  writes inverts the writer's queue order; followers must be read-only, the
  wait must sit outside startup and be abortable, sign-out semantics must be
  settled, and the ticket's two-offline-writes witness stays open.
- Gemini, Grok, Muse: per-distinct-key cap metering does not fix the
  recorded case; the maintained count does, provided an unheld count is never
  read as zero and the `check` rewrite pastes the declaration.
- Gemini, Grok, Muse: hold the 1,500-line file cap and the 66,000-byte
  runtime ceiling as constraints on the client work.
- Astra: rebuild correctness becomes a dependency of count-backed probes.
- Astra, Gemini, Grok, Muse, Claude: the clock ticket is closed and repaired
  on main, unpublished.

Dissent recorded and overruled: Grok's round-one advice to build no tab
policy now (the builder hit it; the read-only follower costs no bytes and one
lock mode); Gemini's round-one leader-plus-BroadcastChannel followers (a
second protocol and retained copy against the byte ceiling, deferred).

## 10. Implementation record

Slices built under the decisions above, in the session that revised this
document; each names its lane, implementer, and verification. Landing
follows `rules/RULES.md` (optimistic landing after `snapback2/scripts/test.sh`
and `caps`); capability claims stay gated on a published cold run.

- **Shared query entries and the browser-tab policy** (§3). Lane
  `s2/clique-client-sessions`, implemented by Claude Fable 5.1, 2026-09-07;
  landed on main as `6b9a31278..e980f3450` (the slice plus five review-fix
  rounds; the review records cite the lane's pre-rebase commits).
  `packages/snapback2/src/client-sessions.ts` (the refcounted entries),
  `client.ts` (`subscribe` attaches to an entry; `openOffline` turns a held
  lock into a follower; takeover resumes and drains), `client-channels.ts`
  (the channel handle, extracted so `client.ts` stays under the cap),
  `store/locks.ts` and `store/indexeddb.ts` (waiting, abortable lock requests;
  the release is awaited so a reopen cannot race it), `store/range-store.ts`
  (`acquire`; the partition counts as open only after the carrier opened),
  `offline.ts` (`follow`, `following`, `canFollow`; a follower's live
  deliveries are shown, not held), `client-outbox.ts` (`E_OFFLINE_FOLLOWER`;
  `reason: "follower"`), `types.ts`, the offline guide and families. Tests:
  `tests/client-sessions.test.ts` (two consumers share one stream, a late
  consumer sees the current delivery, the last close releases; two drains
  share one page walk and one tail; a follower reads live, refuses writes,
  and inherits the writer's queued intent on close; a closed follower never
  takes the lock). The one-writer test in `offline-store.test.ts` now asserts
  the follower. Boundary roots measured 40,006 → 40,209 gzip bytes
  (esbuild 0.25 minified ESM, gzip 9, the LLP 1012 roots) on this machine.
  Review: blind codex gpt-5.6-sol and Grok 4.6 at xhigh, three fix rounds
  (`llp/reviews/1018-client-sessions.*.md`). Round one found nine material
  defects between them (a stale replay after a reset, refcounting by callback
  identity, regular and drain mounted records overwriting each other, the write
  fence sitting after uploads and missing upload, discard and channel publish,
  a restored bearer second tab refusing its own session, the runtime keeping
  the old principal across an account switch, follower drains reading the
  unopened ledger, restart and session expiry leaving the wait alive, the
  marker clearing before the takeover finished); rounds two and three found
  the superseded-wait unfence and its same-principal ABA. All are fixed; the
  marker is owned by its wait object. One finding is refuted and recorded: a
  takeover whose resume fails retryably does not keep the write fence, because
  after acquisition the tab is the writer and its writes queue FIFO behind the
  inherited intents exactly as a cold-start writer's do. The blocking script
  also caught a template typecheck the new readiness reason broke, fixed in
  the same lane.
- **Count-backed cap probes** (§4). Lane `s2/clique-cap-count`, codex
  gpt-5.6-sol at xhigh, 2026-09-07; landed on main as `45acedecb`,
  `ba6f316d4`, `cbf764717`: the engine's cap probe reads a same-`by`
  maintained count (one examined row, exact within the transaction), the
  certificate reserves 1 / 1 / 5 per write instead of N / N / 5N (chat
  `groupCreate` 2,500 → 50 examined rows; the 49-row fixture under `cap 1000
  by principal` 49,000 → 49), the `E_BOUND` rewrite pastes a complete
  `maintain … = count … by …:` declaration with its `read <- deny` rule, an
  unproven absence is never read as zero on either evaluator, successor
  admission keeps counting base rows, three frozen corpus cases, LLP 1017
  §2.4 and LLP 1001 amended, the cap-metering ticket closed. Review: blind
  codex and Grok (`llp/reviews/1018-cap-count.*.md`); one material finding
  (the twin ignored a proven absence) fixed with a same-program
  refuse-and-roll-back test, and confirmed.
- **Quarry binding hygiene** (§5). Lane `s2/clique-quarry-collision`, codex
  gpt-5.6-sol at xhigh, 2026-09-07; landed on main as `37731e373` and
  `c392dd5a6`: generated modules import each table as `<name>$table` and
  print every table, reference, and index operand through one helper, so a
  table and an operation may share a public name; an operation or effect
  named like a generated helper is refused at its Quarry declaration with a
  rename rewrite; chat and todos certificates byte-identical; failing-before
  regression; the collision ticket closed. Review: blind codex and Grok
  (`llp/reviews/1018-quarry-collision.*.md`); one material finding (effect
  names met the same collision) fixed and confirmed.
- **Filed, not built:** follower-write forwarding
  (`issues/20260907-snapback2-follower-tab-write-forwarding.md`); the
  second-tab ticket records what the follower closes and what it leaves open.
  Of the move-zero seams in §7, only the auth page's missing pointer to the
  grant ritual survives a check against main; it is a one-line guide edit,
  not a ticket.

## 11. Working-set disposition

This document entered `llp/current/` in place of the link to implemented
LLP 1016, keeping the working set at 59. LLP 1016 stays at its original path,
its implementation constraints still apply, and this document links it
directly. Its outstanding hosted admission and MCP work remain owned by
LLP 1015. That archive operation removed only the current link; it does not
close residual issues or change either document's status. This document
leaves the working set when §10's slices have landed and the next cold run's
diaries have been counted against §1's two measures, and §12's follow-ups have
an explicit disposition or another active owner. New architecture work does
not replace the cold-run requirement.

The two focused draft RFCs added on 2026-09-07 replace the current links to
LLP 0329.017 and LLP 0329.018, keeping the working set at 59. Those prototype
research documents retain their paths and statuses; LLP 0329.022 still links
them as panel history. Current Quarry and client contracts are governed by
LLP 1000, LLP 1004 and LLP 1012. This is working-set curation, not a new ruling
on the older proposals. The concurrent architecture lane separately replaces
LLP 1014's current link; this change does not consume that slot.

## 12. Further unification: two drafts and three investigations

Charlie commissioned this follow-up structure on 2026-09-07: retain this
umbrella, write focused proposals where a semantic contract needs review, and
keep bounded investigations here. The following are proposed directions, not
five newly accepted implementations. Codex owns the draft and investigation
dispositions; existing implementation lanes retain their work.

| Direction | Record and next deliverable | Completion criterion |
|---|---|---|
| One checked Quarry representation | [LLP 1018.001](./1018.001-quarry-checked-representation.rfc.md), Draft. Map the existing typed compiler candidate to one owner for each semantic fact and count actual deletions. | Reconcile the candidate and independently check semantic parity, diagnostics, and the final maintenance/loop cost; do not build a competing compiler. |
| Dependency-scoped invalidation | [LLP 1018.002](./1018.002-dependency-scoped-invalidation.rfc.md), Draft. Audit identity producers/consumers and a conservative transitive policy closure. | Review a bounded authorization-preserving proposal with an explicit implementation owner/date, or retain broad invalidation with the reason recorded. |
| Read evidence | Start with the [public zero-count ticket](../issues/20260907-snapback2-public-zero-count-does-not-enable-offline-cap-prediction.md). Trace the same count from native execution through receipt/store/twin to prediction. | Account for positive count, proved absence, and unheld count; identify the smallest missing evidence or close against an actual witness in the architecture candidate. |
| Query lifecycle ownership | Map mounted queries, shared entries, drains, resume, principal/epoch changes, projection refresh and disposal against the existing client candidate. | Name one owner for each transition, expose duplicated state, and justify each remaining distinct lifetime with a concrete race or behavior. |
| Public extension points | Inventory actual consumers of public client/runtime/compiler seams in package exports, templates, demos and tests, including effect/carrier needs. | Classify each seam as required, internal, or unsupported; propose deletion with its caller change where justified, without adding a new extension framework. |

The existing architecture integration branch is
`llp-ship/20260907-1018-architecture/integration`; the inspected snapshot
`2cae5d9a2` includes `llp/1018.000-composable-architecture-next-moves.research.md`,
typed direct lowering, persistent query work, a coherent observation API,
sparse aggregate work and follower forwarding. That branch's commissioning,
qualification and landing record are separate. These drafts do not restart its
work or claim it has landed. In particular, §5's typed-IR deferral and §10's
filed forwarding describe the original round, not a veto of later commissioned
work. Reconcile against the candidate that actually lands before assigning gaps.

For read evidence, complete `0` is not by itself proof that a particular
maintained-count key is absent. A candidate must carry sufficient authorized
evidence to distinguish known absence from an unheld count, survive a cold
reopen, and keep cap overflow atomic on both evaluators. Compare any candidate's
sparse aggregate representation and receipt changes before proposing another
representation. Record findings in the existing ticket and count report; a
passing synthetic zero result alone does not close the issue.

For lifecycle ownership, start from the shared-session implementation in §10
and account for the candidate's observation API. A stable snapshot for one named
query does not make independent query deliveries atomic. Preserve drain cursor
ownership, last-consumer disposal, same-principal epoch changes, stale async
completion fencing, follower takeover, and committed/predicted state separation.
Record a transition table here before proposing another controller or store.

For extension points, distinguish a supported external consumer from a test
that imports an implementation detail. Count repository consumers and state
the limits of that census; absence in the repository is not proof of no external
use. Keep justified effect and carrier boundaries. Record a compact consumer
table here, then make only explicitly scoped deletion proposals.

These three investigations add no sub-LLPs, tests, registries or gates merely
for tracking. Runtime changes discovered by them need their concrete scope
resolved against the existing architecture work and governing implemented
contracts. Their outcome may be a deletion, a bounded fix, or no change. Judge
the result by §1's application corrective infrastructure and probe-discovered
contract measures, alongside maintenance cost, rather than abstraction count.

## 13. Focused panel disposition — 2026-09-07

Charlie requested Muse Spark 1.3 at xhigh, Grok 4.6 at xhigh, Antigravity
Gemini 3.8 Flash at high, and this author, explicitly delegating the plan
decisions to the author. Actual initial responses and one shared discussion
round are preserved in the [Muse](./reviews/1018-focused-plan-panel.muse.md),
[Grok](./reviews/1018-focused-plan-panel.grok.md) and
[Gemini](./reviews/1018-focused-plan-panel.gemini.md) artifacts. The
[author assessment](./reviews/1018-focused-plan-panel.codex.md) is not an
independent review. These are advisory plan discussions, not approvals of code
or the final revised document bytes. The children remain Draft.

**Decision: make the follow-up a finite sequence driven by witnessed behavior.**
Consume facts where they were established instead of reconstructing their
meaning downstream. Checked Quarry facts, authorized absence, static policy
dependencies and actual dynamic reads are different kinds of evidence; this
principle does not call for a universal IR, dependency key or evidence framework.

| Priority | Revised work and stopping point |
|---|---|
| First: existing client failures and read evidence | The architecture lane owns its actual browser settlement failure. Alongside that repair, check public zero-count acquisition → justified held evidence → prediction → cold reopen → reconnect on its candidate. Close an already satisfied gap; otherwise propose the smallest missing producer/consumer repair. Keep denial, unheld counts and cap rollback controls. |
| Parallel, finite: compiler closeout | LLP 1018.001 consumes the existing net census and all 32 repair dispositions; inspect only residual differences. Preserve the real packaged-consumer negative type witness. Fold settled constraints into LLP 1002/1004 and archive the child current link after disposition; its acceptance cannot hold the existing lane. |
| Bounded research: invalidation | LLP 1018.002 gets one focused audit day to identify a useful safe subset with all other checks retained. The recorded conflict is already at a rule hash; no repeated open-ended autopsy. No new hash or wire domain is assigned in this round. |
| Within those slices: lifecycle and exports | Trace ownership at the actual zero-count/unsend/recovery failures and census the exports those compiler/client changes touch. Limit the export pass to half a day; record residual questions here. No independent lifecycle rewrite, global consumer survey or extension framework. |

The browser record updated at `8bea2c347` reports an unsend count reaching 2
then regressing to capped sequence 7/count 3 on `301e59bb6`. This is lane
evidence, not a new panel test or a settled root-cause diagnosis. It warrants
settlement/authority-transition work ahead of speculative simplification.
`client.observe`'s stable snapshot does not prove that recovery, drains and
account transitions already have correct ownership.

I accept the panel's concern about duplicate governance, and address it with
delta-only closeout and an archive condition in LLP 1018.001. I do not rename
or retire the newly commissioned document merely to convert its checklist to a
different format. The existing compiler census is net −7,663 production lines;
27 CLOSED, 4 OUTSIDE-Q and 1 RETAIN are 32 dispositions, not five missing fixes.

I decline blanket cancellation of separately commissioned forwarding and
incremental-query work. Their actual correctness, complexity and scoped
measurements remain the architecture lane's obligations. The panel supplied
no isolated measurement supporting an 11 KB forwarding increase, and the Web
Lock preserves a single admission authority; forwarding is not general
multi-writer consensus. Neither sunk implementation cost nor a longer list of
states settles the value judgment.

I also decline one giant test combining compiler type safety, zero-count
prediction and browser unsend. Reuse relevant fixtures and named operations,
but retain focused witnesses at their failure boundaries so a declaration
failure cannot be concealed by a runtime pass, and each failure is diagnosable.
The shared goal is less application correction and fewer independently owned
interpretations, not fewer test names. Publication and cold-builder outcomes
retain their existing qualification requirements.

### Execution disposition — 2026-09-07

The finite compiler reconciliation and touched-export census are recorded in
LLP 1018.001 §6. They reuse all 32 repair dispositions and correct the final
integrated source census to net **−7,533** after the 130-line diagnostics port.
The direct compiler's own integration and qualification remain its lane's work;
this follow-up neither duplicates it nor marks the Draft child Implemented.
The real built-worker/copied-package negative typing witness is retained in
`tests/typing.test.ts`. It verifies the landed generator import repair from
`87def8b02` and qualifies the ambient-copy build correction from preparation
candidate `367d263b8`: five typing checks pass, including both declaration
settings with complete diagnostics.

The zero-count investigation found a concrete two-proof boundary, recorded in
[the still-open ticket](../issues/20260907-snapback2-public-zero-count-does-not-enable-offline-cap-prediction.md).
Ordinary maintained-target survivors make group addresses and canonical IDs
inequivalent. A tested additional primary probe supplied the missing primary
absence, but the actual cold public client still correctly refused the target
insert without unique-group absence/coverage. The incomplete optimization was
removed; public receipt/eviction policy and uniqueness remain intact. The
existing public witness now covers cold reopen for held, unheld, zero and
overflow scenarios. Runtime replacement needs both proofs, not a scalar-zero
shortcut. No store-persistence defect was found at this boundary.

LLP 1018.002 §6 records the bounded invalidation audit: **defer new runtime
hashes**. A conservative whole-table dependency subset can exclude disconnected
tables but cannot exclude the changed messages descriptor in the original
conflict. Stable terminal intents, unsettled replay, held coverage and verdicts
have different existing identities/fences; no common hash is introduced.

The architecture lane at `c9803c828` retains the browser settlement regression
and its affected Expo/browser qualification. This follow-up makes no browser
repair or lane-wide completion claim. Lifecycle work remains tied to those
actual transitions; the count investigation adds no lifecycle framework.
