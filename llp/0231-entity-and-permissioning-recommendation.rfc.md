# LLP 0231: Entity and permissioning — recommendation

**Type:** RFC
**Status:** Accepted
**Systems:** Auth, Security/authorization, Storage, Live queries, Code generation, Client integration, Testing
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-10
**Revised:** 2026-08-15 (D3 all-read-surface composition closure; D7 explicit handler-read authority; membership self-resource visibility; D5 elevated-read runtime observation)
**Related:** LLP 0011, LLP 0035, LLP 0043, LLP 0046, LLP 0053, LLP 0056, LLP 0070, LLP 0073, LLP 0080, LLP 0085, LLP 0170, LLP 0172, LLP 0173, LLP 0187, LLP 0230, LLP 0234, LLP 0235

## Summary

**Recommendation: visibility becomes a declared policy, not an undifferentiated
filter — a mandatory table-level default, refined per query, composed into the
plan.**

Snapback does not need an entity framework. It needs to make the authorization
vocabulary it *already built* impossible to omit.

The finding that drives this is in `demos/card-game/snapback/functions.mjs:42`.
That demo exists to prove per-viewer visibility — hidden hands, two real
sessions, disjoint live results. Its entire security boundary is:

```js
filter: [
  eq('ownerId', authUserId()),   // the security boundary
  eq('gameId', arg('gameId')),   // a UI convenience
],
```

Two entries in one list. One decides who may see a card; the other decides which
game is on screen. The generated manifest records their *mechanism* — one
predicate is `AuthUserId`, the other `Arg: gameId` — but nothing records their
*obligation*: nothing marks the first as a security boundary that generation
must refuse to lose. Delete the first and the demo still runs, still passes
every test that does not specifically probe cross-player visibility, and leaks
every hand at the table.

That is [LLP 0170](./0170-authorization-obligation-feasibility.research.md)'s
conclusion made concrete — "the handler must still enforce the caller filter" —
and it is Ent's thesis demonstrated in our own flagship authorization demo.

The proposal: give visibility a declared position with the table as the
mandatory locus, compile it into the query, and project it for review. This is
a *generalization*, not an invention: Snapback's search, relational,
bounded-children, and owned-CRUD surfaces already ship a declared visibility
union, mandatory-or-fail on search (§What already exists). This RFC extends
that obligation to the table locus and to every read surface. One honest
exception (§D3): the shipped grammar cannot express a common class of
field-level boundaries, and this document carries the counter-example that
sizes the missing piece.

## What already exists

This is the part that makes the recommendation small rather than large.

- **Memberships** ([LLP 0056](./0056-scoped-roles-and-memberships.rfc.md), built):
  `(principal, resource, role)` as system-recognized app data, with
  `memberOf()` / `hasRole()` as **declaration-bound** predicates — vocabulary
  validated at generate time, expiry sweeps, last-holder protection, and
  LLP 0053 invalidation wiring.
- **Caller identity in predicates**: `authUserId()` composes into a query
  filter today.
- **An optional membership slot on queries**: `queryDef` in
  `packages/snapback-codegen/define.mjs` accepts `spec.membership`, an array of
  those declaration-bound predicates.
- **A shipped declared-visibility union — the strongest item in this
  inventory, missed by this document's first two revisions.** Search indexes,
  relational queries, bounded-children queries, and the owned-CRUD/keyset kits
  already accept a `visibility` declaration:
  `{ kind: 'public-read' } | { kind: 'owner', field } | { kind: 'membership', … }`,
  plus `owner()` / `throughParent()` / `throughScope()` forms and per-side
  `root/joined/output` visibility on relational queries (LLP 0073, LLP 0080).
  On the search surface it is **mandatory-or-fail today**: `define.mjs`
  refuses to generate a search index without an explicit declaration
  (`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`, with the instruction to "use
  `{ kind: 'public-read' }` only for intentionally public data"). Ten of the
  96 direct query call sites in the demo corpus carry it. So the
  explicit-`public`-or-fail move D2 wants is not an unshipped aspiration — it
  is already executed, at generate time, on one read surface; D2 extends it to
  the rest.
- **An authorization review projection**
  ([LLP 0173](./0173-authorization-review-projection.rfc.md)) — **specified,
  not built**. D5 extends its design, not existing machinery.
- **An explicitness precedent** ([LLP 0172](./0172-explicit-function-authorization.rfc.md)):
  function-level auth moving from implicit default to explicit-or-fail.
  0172 *proposes* two phases — a warning naming the exact edit, then a
  generation failure — and the warning phase is what is implemented today
  (`packages/snapback-codegen/index.mjs` emits the diagnostic with
  reviewer-gated remediations (each marked `machineApplicable: false`); generation does not yet fail). The precedent
  is a proposed and partially executed trajectory, not a completed one.

**The policy language is built and analyzable, and one surface already refuses
to generate without it. Everywhere else, applying it is voluntary.** That is
the *authoring* gap this RFC closes. It is not the whole implementation: the
vocabulary, the composition machinery, and the mandatory-or-fail precedent
exist, but universal policy composition at `ctx.db`, class-M masking, and
their invalidation semantics are new machinery with real feasibility work —
and the shipped language speaks only row predicates, not field masking.

## Evidence

**The demo that exists to prove visibility leaks if you delete one line.**
`demos/card-game/snapback/functions.mjs:42-45`, above. Reproducible: the
acceptance fixture installs both players' hands and asserts disjoint results;
remove the owner predicate and both principals receive both hands.

**We recorded the shape of the wrong implementation, from InstantDB.**
LLP 0011 §462 records that InstantDB evaluates CEL `view` rules post-query on
every object, including during live invalidation, and that Instant itself
flagged CEL-to-`where` pushdown as needed in 2024 without verifiably shipping
it by mid-2026. Read precisely, that is a vendor's own report of an
implementation shape it considered inadequate — per-object post-evaluation on
the live path — not an observed production failure, and this document leans on
it only in that weaker sense. Note also that LLP 0011's recorded fallback for
inexpressible rules was *online-only, non-syncable execution*; D3 deliberately
departs from that recorded choice (see D3).

**And the shape of the wrong authoring model, from Firebase.** Diary 0031:296:

> Rules are authorization, not filters. Query structure must be designed
> alongside policy and indexes; **a natural client query can fail even when each
> returned row would be authorized.**

Reject-style rules make legitimate queries fail; filter-style rules make
illegitimate rows disappear. We want the second.

**We already wrote down the target.** Diary 0031:565:

> InstantDB's linked-data permissions and `asUser` testing are **excellent
> end-state targets**: authorization should **compose across relationships**, and
> tests should switch identities without bespoke token plumbing.

**And real demos need per-viewer visibility that row predicates cannot express.**
Card-game's hidden hands are a row predicate. Pointing-room's concealed votes
(diary 0074:10) are not — the boundary is field-level and disjunctive, and §D3
treats it as the worked counter-example that sizes the grammar.

### The census: three scoping paths, and a silent majority

Counted across `demos/*/snapback/functions.mjs` at `5373238eb`. This section's
numbers have been overturned by review twice — first the raw counts, then the
taxonomy, which had missed the shipped visibility union entirely. Current
figures, cross-checked between the orchestrator and two independent review
recounts:

| | count |
| --- | ---: |
| `define*Query` call sites | 96 (102 generated query operations after `*KeysetPages` expansion) |
| Queries gated by a declared `membership:` | **10** generated (9 textual declarations) |
| Source-level `authUserId()` uses in query `filter:` lists | **12**, across 8 demos (16 generated uses after owned-page expansion) |
| Call sites carrying a declared `visibility` union | **10**, across 5 demos (plus three `authScopeField` sites, two of them the only scoping token on their query; the four generated owned pages also carry `visibility: { kind: 'owner' }` but are counted once, under the `authUserId()` row above) |

An earlier revision reported "31 uses vs 9 declarations, 3–4×"; that conflated
write-side owner stamping with read-side scoping and is withdrawn. The
next revision's "two scoping paths, ~75 of 102 carry neither" was also wrong:
there are **three** declared mechanisms, and the exact "neither of the first
two" figure is 76 of 102, dropping to **roughly 65 of 102 that carry none of
the three** (65 counts effective generated policy: signal-desk's search query
inherits its index's mandatory visibility declaration). The denominator is itself conservative: kit-generated queries
(owned-CRUD `list`/`get`, unique lookups) are invisible to a `define*Query`
count and all carry declared visibility.

What survives, stated carefully:

1. Caller scoping is spread across three mechanisms — membership slots,
   `authUserId()` filters, and the visibility union — of which only the first
   and third are visible to the manifest as declared security boundaries, and
   only one surface (search) makes any of them mandatory.
2. Roughly two-thirds of queries carry *no* scoping mechanism, and no row- or
   table-level visibility declaration distinguishes "public by design" from
   "scoping forgotten" among them (a few declare function-level
   `auth: 'public'` intent — the right idea, one level up).
   A demo having `authUserId()` somewhere is no assurance: partiful-matrix's
   four read queries are all unscoped; its `authUserId()` uses are write-side
   owner stamps.

Point 2 is the load-bearing observation for D2. The danger is not chiefly that
authors typed the less-analyzable mechanism; it is that the *absence* of any
mechanism is silent. Point 1 now cuts the other way as well: the declared,
composed, generate-time-refused shape is not speculative — it ships and demos
use it — which strengthens feasibility and turns the design question into
unification (open question 2) rather than invention.

One honest caveat stands: not every `authUserId()` filter is a security
boundary — some legitimately scope "my items" over data that is public anyway.
That is an argument for making intent declarable, not against it.

## Recommendation: declared visibility policy

A correction from review shapes this section: the first revision framed
"fail-closed versus reviewable" as the central tradeoff between table-level and
per-query declaration. That was a false tradeoff. A missing per-query
declaration that fails generation and a missing table policy that denies reads
are *both* fail-closed, and codegen can project the effective policy beside
every query, so reviewability does not depend on where the declaration lives.
With the tradeoff dissolved, the fail-closed-at-runtime locus wins: the table.

### D1 — the table is the policy locus; queries refine

Every table declares a visibility policy in the existing declaration-bound
vocabulary (`authUserId()`, `memberOf()`, `hasRole()`, field comparisons), or
an explicit `public()`. Every read of that table composes the policy in. A
query may declare a **refinement** — composed by conjunction with the table
policy, hence structurally narrowing with nothing to verify; anything
non-conjunctive is by definition an **override**, the explicitly marked escape
for cross-cutting reads (admin views, moderation, aggregates, and the
no-principal paths below).

**The policy composes at the data layer, for every caller-scoped access path.**
Ordinary `ctx.db` and the declarative plan compiler apply the table policy to
all reads. A trusted named JS query or mutation may instead select the explicit
call-local `ctx.db.elevated` read authority specified by D7; it is not silently
inherited by the handler and is not available to actions or direct/generated
plans. The only invocation-wide alternate table policy remains an override,
and this revision makes overrides **fail closed until governed**: the
declaration shape is
specified here — schema-level (never inline in a query), naming scope and
justification, projected as its own section of D5's surface, each carrying an
acceptance test demonstrating intended breadth — but *no override is
generatable under this RFC alone*, because waiver authority, protection
against a widening change approving itself, expiry, and ratchet are not yet
designed. That is LLP 0170's waiver-authority prerequisite honored fail-closed
rather than deferred open. The governance sibling is urgent, not optional:
the largest override population will likely be **no-principal access paths** —
scheduled functions (LLP 0070 `runAfter`), seeds, maintenance sweeps — which
see nothing under a caller-keyed table policy.

The point is not new syntax. It is that a security predicate stops being
textually indistinguishable from a convenience predicate — and that a *new*
query over `hands` is owner-scoped before its author has thought about
authorization at all, rather than merely refused.

### D2 — a table without a policy fails generation

Every table declares visibility or generation fails. `visibility: public()` is
valid, explicit, greppable, and reviewable. The end state is already shipped
on one surface: search indexes fail generation today without an explicit
visibility declaration (`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`), which is
the exact explicit-`public`-or-fail obligation D2 wants, executed. The rollout
to the remaining surfaces follows the trajectory LLP 0172 proposed for
`optional-user` — a per-table warning naming the exact edit, then a generation
failure — noting honestly that 0172's own second phase has not shipped yet:
0172 supplies the *migration process* precedent, and the search surface
supplies the *end-state* precedent.

Per-query declarations stay optional in steady state (the table default covers
them). Codegen projects the **effective policy** for every query — the
enforced table policy composed with declared refinements and overrides, with
any handler-local narrowing labeled *opaque* rather than rendered, since JS
filtering is not statically derivable (LLP 0170) — per LLP 0011's rule that
effective permission is a composition, so review reads what is actually
enforced rather than what is locally written.

### D3 — composed into the plan, sized by a plan-class model

Composition, never post-evaluation: the policy predicate is compiled into the
query plan, preserving the matcher's skip path and LLP 0035's per-subscription
costs, and avoiding both Firebase's natural-query-fails mode and InstantDB's
per-object live-path evaluation.

**But a recommendation that speaks only row predicates fails on a demo this
repository already ships.** Pointing-room's disclosure boundary
(`demos/pointing-room/snapback/functions.mjs:70`) is:

```js
value: round.revealed || vote.userId === ctx.auth.userId ? vote.value : null
```

Field-level (every voter's row is returned; only `value` is masked),
disjunctive, and cross-table (the reveal bit lives on `rounds`, ownership on
`votes`). No row predicate expresses it. Under this RFC's first revision that
query's only options were `visibility: public()` — leaving the handler as the
real boundary, the exact situation this RFC exists to end — or refusal. Hidden
votes, hidden hands, and redacted columns are ordinary workloads, so that was a
hole in the mechanism, not an acceptable expressiveness cap.

The shape is a **plan-class model**, per LLP 0170's conclusion that future
enforcement must be plan-class-specific — but with only two policy classes,
both enforced at the data layer:

- **Class R — row scoping.** Visibility is a row predicate composed into the
  plan's filters or applied to ordinary `ctx.db` reads inside JS query and
  mutation handlers. Card-game's hidden hands. D7 defines the explicit trusted
  handler-read authority that may bypass this class at one call site. The
  composition machinery — and the declaration vocabulary, via the shipped
  visibility union — exists.
- **Class M — field masking.** Visibility may additionally include per-field
  masking rules: a field is disclosed only when a declared condition over the
  row and declared related rows holds — pointing-room's `revealed || owner`
  reveal pattern, with the dependency on `rounds.revealed` becoming an
  explicit D4 invalidation edge. This RFC commits to the class and to its
  **safety envelope**, and defers the grammar to a sibling spec (see below).

**There is no handler policy class.** An earlier revision of this document
proposed "class J": JS handlers declaring `visibility: handler(...)` and
enforcing their own boundary, checked only by tests. That contradicted D1 — a
self-declared waiver of an unbypassable policy is not unbypassable, and a
finite acceptance test is evidence, not enforcement. It is withdrawn. JS
handlers read policy-composed, mask-applied data through ordinary `ctx.db` like
every other consumer. D7's elevated read is a host-recognized call-site
authority for trusted authorization logic, not a new policy class; what a
handler does *with* data is still the egress problem (D6).

**The class-M safety envelope, pinned now because masking that only nulls the
final projection is not a boundary:**

- **Noninterference.** A masked field may not participate in the filter,
  ordering, join, or aggregate positions of any plan unless the plan's
  composed predicate entails the field's disclosure condition; otherwise
  generate-time refusal. Inside JS handlers, masked values are withheld from
  handler view entirely (the handler receives the masked form), so a hidden
  value cannot influence row presence, ordering, or any computed output.
- **Field addition fails closed — on every table.** A newly added field fails
  generation until its treatment is declared: disclosed-with-row or a masking
  rule. Restricting the fence to already-masked tables would let an explicitly
  public table silently expose a newly sensitive field through existing
  queries — recreating at field granularity the omission hazard D2 exists to
  remove. The price is one declaration per new field (§Costs). The fence activates
  with D2's second phase — a new field is declarable as disclosed-with-row or
  as a `fieldBoundary:` residual from day one, so it does not wait for the
  class-M sibling.
- **Re-masking is security-negative and rides the conservative path.** A
  disclosed→masked transition is treated like a revocation: it takes the
  obligation-backed conservative delivery route (LLP 0053's `live_replace`
  semantics), never best-effort update delivery. Pointing-room's reveal only
  exercises the benign masked→disclosed direction; the reverse direction is
  the one that must not be best-effort.

The class-M *grammar* is deliberately not pinned here: review established that
the prior-art survey (LLP 0230) contained no field-level enforcement literature
— column privileges, dynamic data masking, masking side channels — so the
grammar goes to a sibling spec grounded in that reading, with pointing-room as
its acceptance-gated worked case. **That reading was done on 2026-08-12 and
lands as LLP 0230 Tier 5; the sibling is
[LLP 0235](./0235-field-masking-class-m.spec.md), Draft.** The reading changed
one thing this section should record: masking applied at projection time is not
a boundary as a matter of empirical record rather than argument — SurrealDB
shipped a correct conditional per-field rule and had it bypassed six documented
ways, several of them through channels the *optimizer* introduced rather than
the author. That is why 0235 binds its noninterference check to the physical
plan and not only to the authored query. Until that spec ships, a field-level
boundary lives in handler code over row-authorized data and **must be
declared** — a `fieldBoundary:` declaration naming the concealed fields and
condition — so it appears on D5's projection as handler-enforced (not proven)
and carries a mandatory identity-switching test. That is a declared residual,
not a policy waiver: row scoping still applies underneath it. And it is
weaker than the envelope in one way that must be said plainly: a
`fieldBoundary:` carries **no noninterference guarantee** — the handler sees
raw values, so a concealed value can still influence ordering or computed
output until the sibling spec ships. That is exactly why the declaration is
mandatory and projected rather than optional. And during the interim the
declaration obligation is a norm, not a fence: an author who writes a masking
ternary *without* declaring `fieldBoundary:` passes generation undetected,
because JS is opaque (LLP 0170) — undeclared field boundaries stay invisible
until the class-M sibling ships, and nothing cheaper can detect them.

A class R/M visibility expression that cannot be composed remains a
**generate-time refusal** — not a silent post-filter, and not LLP 0011's
recorded fallback of online-only execution, which this RFC explicitly
supersedes for visibility expressions: a policy that silently changes a query's
sync semantics is a worse failure than one that refuses with an edit to make.

### D4 — visibility change is an invalidation event, conservatively

Memberships are already wired into LLP 0053, and D1's declaration makes each
query's visibility dependencies explicit. But the existing substrate provides
revocation *correctness*, not exact blast radius: LLP 0056's membership queries
re-check via conservative re-query/`live_replace`, and LLP 0053 v1 still rides
the global epoch, with subject-scoped suppression computed but unused. So the
safety property this RFC requires is **no false-negative invalidation** — a
membership or reveal change never leaves a subscription reflecting visibility
its viewer no longer has — while conservative extra wakes are permitted. Exact
per-subscription suppression is an optimization to be separately specified and
proved, not assumed here.

Two kinds of change must not be conflated. A **policy-fact** change — a
membership row, a reveal bit — is a data-plane event: the fact is an input row
and the composed plan reacts through the ordinary invalidation machinery
above. A **policy-program** change — editing a table's visibility expression
itself — changes the compiled plans and is *not* an input delta: it is an
authorization-metadata **activation** event, which LLP 0053 already models as
distinct and fail-closed. Activating a changed policy replaces affected plans
and re-delivers fresh results; it is never applied as an incremental diff
against results computed under the old policy.

### D5 — project it, and test it by identity

Extend LLP 0173's proposed projection so every table policy, refinement,
override, and declared `fieldBoundary:` residual appears on one reviewable
surface: an auditor reads one page rather than N handlers. Adopt diary 0031's
second target — `asUser`-style identity switching in acceptance, so "Bob
cannot see Alice's hand" is a test rather than a hope. For overrides and
declared field boundaries the identity-switching test is mandatory: those are
the two places where enforcement is weaker than composition, so the test is
load-bearing there rather than advisory.

The projection's shipped implementation (LLP 0173, Implemented) also captures
every statically visible D7 `ctx.db.elevated` call site per operation, so
elevated authority is reviewable on the same page as the policies it bypasses.
Execution is observable too: the runtime records each successful non-empty
elevated read as system telemetry named counts by function and by member
(LLP 0154 registry v3), and an explicitly enabled
`SNAPBACK_ELEVATED_READ_TRACE` path receives JSONL facts naming function,
member, table, invocation mode, and correlation. Neither surface renders an
authorization verdict; both state facts for review.

### D6 — reads and writes share the locus and the IR

This RFC specifies read visibility only, but decides one architectural point
now so a sibling write RFC cannot fork the model: **the table-level policy
declaration is the shared locus for read visibility and write checks, over one
policy IR.** LLP 0011 requires two-sided enforcement; LLP 0056 places the full
two-sided contract with declarative rules; Postgres RLS demonstrates the
single-locus shape working in production. Mutations, actions, and JS handlers
evaluate the same read policy whenever they read (D1). What remains for the
sibling RFC (open question 4) is the write and egress side: insert checks,
old-row update/delete checks, post-update checks, and what a function may
*return or copy outward* — the residual that used to hide inside "class J" is
exactly this egress question, since a handler computing over visible data can
still send it somewhere broader. What the sibling may *not* do is introduce a
second policy system.

**Dated note (2026-08-15):** the write-policy sibling reserved here is [LLP 0264](./0264-table-write-policy.spec.md), a Draft owner-policy Spec with no current-enforcement claim.

### D7 — handler reads are scoped unless the call site is explicitly elevated

Named JavaScript queries and mutations are trusted server-authoritative code,
but their ordinary reads remain caller-scoped. The default `ctx.db` surface
applies Class R visibility so an accidentally omitted authorization check fails
closed. When a handler must inspect rows in order to perform its own
authorization logic, it uses **`ctx.db.elevated` at that exact read call**.
Elevated reads bypass only Class R table visibility. They remain bounded,
snapshot-captured, OCC-validated, media-deprojected host reads, and they expose
the same point, batch, and bounded query-builder shapes as ordinary reads.

This explicit escalation resolves the authority cycle that owner visibility
created for quoted-message and joined-conversation lookups: a handler can first
prove the caller's membership through the host-owned `ctx.permissions` surface,
then inspect the protected row without making its backing table public. The
call site visibly says which authority applies; reviewer search does not have
to infer it from a function declaration or ambient execution mode.

The threat model has two failures to prevent. First, an ordinary handler that
forgets its membership/owner check must not gain broad reads merely because it
runs on the server. Second, a correct handler must not be forced to widen
storage visibility to `public-read` just to obtain facts needed by its own
authorization decision. Scoped-by-default plus explicit call-local elevation
prevents both. An elevated read is application authority: callers cannot select
it, forge it in arguments, or receive it in an action. Generated/direct plans
cannot select it either, and an authored query plan cannot encode it.

Elevation deliberately does **not** bypass field masking, write checks,
membership writer rules, result/egress validation, asset authorization, query
bounds, or capture/OCC. It is refused in actions, whose remote-I/O capability
would make broad database reads an unsafe exfiltration primitive. It also does
not expose the private membership roster: authorization questions still use
the declaration-bound, host-owned `ctx.permissions` methods. Invocation-wide
scheduled/no-principal authority remains LLP 0234's governed override problem;
`ctx.db.elevated` is only the call-local authority of trusted named handler
code already executing for one request.

**Dated note (2026-08-15):** the action/scheduled/no-principal fence is
transitive over trusted root invocation provenance. A nested mutation retains
the root's fence even though its currently executing function kind is
`Mutation`; it cannot regain `ctx.db.elevated` by crossing
`action.runMutation` (resolved ticket
[`issues/closed/20260815-elevated-read-nested-mutation-provenance.md`](../issues/closed/20260815-elevated-read-nested-mutation-provenance.md)).

Membership visibility gains one bounded declarative case alongside this
authority decision: the membership declaration may gate its resource table by
declaring `resourceField: '_id'`. For a child table, the resource field must
remain a required id of the declaration's resource table. Storage lowers both
shapes through the same membership predicate and
pending roles remain excluded. This supports a private membership table whose
rows are visible only to members of their resource without a public roster.
It does not add arbitrary joins or multi-hop predicates; those remain explicit
handler authorization checks followed by elevated reads.

### Why this and not an entity framework

Ent's transferable insight is **unbypassable**, not **per-row policy objects**.
The object model is how Ent achieves it in a request/response system; in a
system with durable subscriptions, per-row evaluation is precisely the
InstantDB shape we already documented as vendor-flagged. We can take the
insight without the mechanism, because we already own the query compiler and
the sync layer.

### Counter-evidence: how much of this is no-op typing?

The case above is one-sided unless we ask how many queries have no scoping
story at all, because those gain a declaration that says nothing.

Seven demos carry no *row-scoping* concept — `all-aboard` (6 queries),
`campfire` (4), `public-dashboard` (3), `chirp` (3), `chat-matrix` (2),
`latency-kanban` (2), and `pulse-monitor` (1): **21 of 102 generated
queries.** (This list has been corrected three times by review: the raw counts
first, then the taxonomy, then the roster — the last round added campfire,
whose public-by-design intent lives only in a schema comment, and chirp, whose
only scoping is a client-asserted handle argument. Both are gifts to D2:
intent recorded in comments and argument conventions is invisible to any
census. Not all seven are equally silent — public-dashboard and latency-kanban
declare `auth: 'public'` on every query, the declared public-by-design intent
D2 wants, one level up.) The seven-demo count is not the honest denominator
either: per the
corrected census, roughly 65 of 102 queries carry no scoping mechanism, and
demos outside these seven contribute most of them. What fraction of those are
public-by-design versus scoping-forgotten is exactly what nobody can currently
say — which is the strongest form of the argument for D2, and also the reason
the original "four in five queries have a real scoping story" conclusion is
withdrawn: it did not follow from the count.

An explicit `public()` is still not worthless — LLP 0172 made the same trade
for `optional-user`, on the reasoning that an intentional anonymous surface
should be distinguishable from a forgotten one. And under D1's table locus the
no-op cost shrinks: a public table declares `public()` once, not once per
query.

*Method note: counts derived at `5373238eb`, cross-checked across the
orchestrator and two independent review recounts (which twice corrected this
section). The qualitative counter-evidence — authors reporting the current
model as sufficient — remains ungathered (open question 5).*

## Costs, stated plainly

- **Expressiveness is capped** by what the plan can compose. Class M sets the
  floor at reveal-style field masking; until its sibling spec ships, declared
  `fieldBoundary:` residuals are handler-enforced and must stay visibly so.
- **Migration touches every table** (one policy each), every query whose
  caller filter should become a refinement (open question 3), **every new
  field thereafter** (one treatment declaration, per the field-addition
  fence), and **every no-principal access path** — scheduled functions, seeds,
  maintenance sweeps cannot read caller-keyed tables until override governance
  lands, which makes that sibling a migration prerequisite, not a nicety.
- **`visibility: public()`, overrides, and `fieldBoundary:` declarations can
  be cargo-culted.** Explicitness makes a wrong choice *visible*, not
  impossible — LLP 0187's confident-and-wrong failure mode applies, which is
  what D5's projection is for.
- **The write side is located, not specified.** D6 fixes the locus and IR;
  write-check semantics and egress control need their own RFC.

## Alternatives worth considering

### A1 — per-query declaration only (this RFC's first-revision shape)

Visibility declared on each query, no table default — the original
recommendation. Against it: a forgotten declaration on a new query is merely
refused rather than safe; N declarations where one table policy suffices; and
the "reviewable beats fail-closed" argument that justified it dissolves once
codegen projects effective policy per query. Superseded by D1 during review.

### A2 — full entity objects (the expo/entity shape)

Entities with policy classes, loaders, mutators; authorization inside the data
accessor. Maximum expressiveness and a proven model.

Against: it is per-row post-query evaluation — the shape LLP 0011 §462 records
InstantDB's own vendor flagging as inadequate on the live path — and it
introduces a second data-access layer beside the query compiler we already own.
Right answer for a request/response backend; wrong shape for this one.

### A3 — Zanzibar-style relationship tuples

Authorization as a separate relation graph with userset rewrites. Buys exactly
what diary 0031 asked for — composition across relationships — plus
inheritance; LLP 0230 records the (unverified) hypothesis that our commit
version could serve as the zookie.

Against: a second data plane with its own consistency problem, and LLP 0056
deliberately chose "roles are app data, in a system-recognized shape" instead.
Worth revisiting only if relationship composition becomes the binding
constraint; the tuple store is the expensive half and 0056 already avoids it.

### A4 — verify instead of declare (the Blockaid direction)

Leave handlers as they are and prove non-leakage against declared policy views.
Note what Blockaid actually is (LLP 0230): *runtime* SQL interception verified
in request-trace context with cached generalized decisions, assuming the
application keeps its own access checks — an amortized runtime verifier, not a
generate-time proof with zero authoring burden. The zero-burden version is a
hypothetical stronger cousin, not the shipped system.

Against: LLP 0170 already concluded the manifest cannot support the discharge
(a JS handler's `reads` list is a dependency declaration, not result
provenance), and the runtime shape re-introduces per-evaluation work on the
live path. LLP 0230 open question 1 asks whether Blockaid changes 0170's
assessment — worth answering before final dismissal, but not a plan today.

## Sirens — attractive and wrong

### S1 — unrestricted runtime policy evaluation

**Why it looks right:** principled, expressive, industry-standard, and it
future-proofs against policies nobody has thought of.

**Why it is a trap:** a predicate that can only be evaluated at runtime, per
object, runs post-query on the live path — the shape LLP 0011 §462 records
InstantDB's own vendor flagging as needing pushdown it never verifiably
shipped. You would trade the analyzability that makes matcher skip,
invalidation, and generate-time review possible for expressiveness most apps
never use.

**Stated precisely, because the first framing of this siren was wrong:** the
trap is *unrestricted runtime evaluation*, not the policy languages
themselves. OPA ships a Compile API and a defined data-filtering fragment that
partially evaluates Rego into SQL predicates and refuses unsupported
constructs; CEL exposes checked ASTs and partial evaluation. Those are
closed, statically admissible pushdown fragments — structurally the same move
D3 makes — and they are candidate inputs to open question 1's grammar design,
not sirens. The siren is adopting an open language *without* committing to
such a fragment, and discovering the cap after it is load-bearing. Cap
expressiveness deliberately (LLP 0230 on Cedar) either way.

### S2 — treat sync partitioning as authorization

**Why it looks right:** local-first framing makes it natural — "don't sync what
they can't see" — and PowerSync-style buckets make it look blessed. It seems to
solve authorization and bandwidth in one move.

**Why it is a trap:** it conflates *what we chose to send* with *what they are
allowed to see*. Any bug in partition assignment becomes a data breach rather
than a display bug, and LLP 0043's offline retention means revocation cannot
reach data already on the device (a limitation shared by all plaintext sync,
but partitioning-as-authorization makes it the *only* line of defense).
Authorization must be a property of the read; partitioning derived *from* the
policy is a legitimate enforcement and bandwidth optimization underneath it.

### S3 — infer visibility from the schema

**Why it looks right:** maximally DRY and apparently magical. `hands.ownerId`
references users, so scope it automatically. No authoring burden at all.

**Why it is a trap:** we already tried it and rejected it, with reasons.
LLP 0170:

> `authScopeField` **does not authorize a read** … Treating it as a discharge
> witness would let a leaking JavaScript query pass generation.

A reference is not a policy. `hands.ownerId` scopes to the owner; `messages.
authorId` must *not* scope to the author, or nobody sees anyone else's messages.
The two are indistinguishable in the schema. Rebuilding this with more
sophistication repeats a documented mistake — and inference failures fail
**open**.

### S4 — per-row encryption or capability tokens

**Why it looks right:** makes leakage cryptographically impossible rather than
merely enforced, and Jazz demonstrates it working (LLP 0085).

**Why the encryption half is a trap for us:** revocation and live queries both
become very hard — you re-key on every membership change, and the server can no
longer evaluate the predicate it needs for matcher skip, so live fan-out
degrades toward broadcast. Jazz pays for this in a currency it can afford
because its whole architecture is built around it. Capability tokens are a
separable idea that does not require ciphertext or re-keying; the objection to
them here is narrower — they authorize outside the declared policy surface D5
projects — and they should be evaluated on that ground, not bundled into the
encryption dismissal.

## Open questions

1. **The visibility grammar — partially resolved 2026-08-11.** Class R now
   includes one bounded top-level `anyOf` of 2–8 distinct owner/membership
   leaves. Arms preserve authored order; nesting and `public-read` arms are
   refused. The exact schema predicate is plan data, storage evaluates grouped
   OR before ANDed query refinements, membership leaves contribute live
   dependencies and force conservative replacement, and every restricted
   policy is RQS-ineligible. The same predicates now apply to ordinary
   `ctx.db`; a trusted named handler can bypass Class R only through the
   explicit D7 `ctx.db.elevated` call site. This resolves the Clique Following-feed shape:
   a dedicated Following membership projection plus the owner arm includes
   self-authored posts without a self-follow edge. The shipped scope is only
   generated direct query/live-query plans and ordinary handler reads. Search,
   relational, class-M masking, writes, and egress remain open; in particular the original
   question about what a class-M condition may reference is not answered by
   this class-R connective.
2. **Unify the vocabularies.** The proposed table-level grammar and the
   *shipped* `visibility` union (search/relational/bounded-children/kits) use
   the same keyword and overlapping shapes; `authScopeField` overlaps both.
   Three coexisting visibility concepts would be worse than any one of them —
   the grammar must reconcile with (ideally: grow out of) the shipped union,
   and decide `authScopeField`'s fate.
3. **What is the migration shape** for existing queries whose caller filter is
   already in `filter:` — mechanical lift into refinements, or author review of
   each one?
4. **Write-check semantics and egress.** D6 fixes the locus and single IR;
   insert/update/delete checks, post-update checks, and what a mutation or
   action may return or copy outward remain for the sibling RFC.
5. **Qualitative counter-evidence is ungathered.** Nobody has read the 85
   diaries for authors reporting the function-level model as *sufficient*, or
   for authorization incidents caught by review rather than by the system. If
   that reading turns up authors routing around memberships deliberately
   rather than by default, D2's scope should narrow before it is ratified.
6. **Override governance — a blocking sibling, not a refinement.** D1 pins the
   declaration shape and fails all overrides closed until governance is
   decided: waiver authority, separation so a widening change cannot approve
   itself, expiry, ratchet. The no-principal population (scheduled functions,
   seeds, sweeps) makes this a prerequisite for D2's second phase — and
   overrides are where the leaks will live. The sibling must also distinguish
   LLP 0070's scheduled-authority modes — `system`, `revalidatePrincipal`,
   `capturedGrant` — rather than treating every scheduled execution as one
   waiver class; only `system` is intrinsically principal-free.

## Acceptance

- Every table declares visibility or generation fails, per D2's second phase.
- A class R/M visibility expression that cannot be composed into the plan is
  refused at generate time with a stable `SNAPBACK_*` code, not silently
  post-filtered and not executed online-only.
- Removing the visibility policy that hides card-game hands is a **generation
  failure** (a table without a policy does not generate, per D2 — the
  data-layer refusal, not merely a test); edits that keep a policy but widen
  disclosure are caught by the identity-switching acceptance tests.
- **The pointing-room reveal boundary is expressible as class M** — vote value
  masked unless the round is revealed or the caller owns the vote — under the
  full safety envelope (noninterference, fail-closed field addition,
  obligation-backed re-masking). This gates the class-M sibling spec; until it
  ships, pointing-room carries a declared `fieldBoundary:` with an
  identity-switching test, and this RFC does not claim class M is enforced.
- Every declared `fieldBoundary:` appears on the projection and carries an
  identity-switching acceptance test; the same holds for every override once
  the governance sibling makes overrides generatable (post-governance).
- A membership or reveal change never leaves a subscription reflecting
  visibility its viewer no longer has (no false negatives); conservative extra
  invalidation is permitted; any exact-suppression claim ships with its own
  proof.
- A policy-*program* change (editing a table's visibility expression)
  activates via LLP 0053's fail-closed authorization-metadata activation with
  fresh results — never as an incremental diff over results computed under the
  old policy.
- The projection lists every table policy, refinement, override, and
  `fieldBoundary:` declaration on one surface.
- Acceptance can switch identity (`asUser`) without bespoke token plumbing, per
  diary 0031:565.
- An owner-hidden row stays absent through ordinary `ctx.db` in a named
  handler, while the same handler can read it only through the visibly elevated
  call site; the elevated surface is absent/refused in actions and direct plans.
- Resource-table `_id` membership visibility admits a member and hides the same row
  from a non-member, including the negative stranger case.

## Status

Accepted — author ruling 2026-08-11, implementation directed in-session and
recorded by the orchestrator. Ship run `llp0231-visibility-20260811` landed at
`908f52350`; the scoped local `auth.table-visibility` capability claim is
`shipped` in `guide/capabilities.md`, witnessed by
`tests/acceptance/table-visibility-any-of-live.mjs` (LLP 0189). The census
figures are reproducible at `5373238eb`; they were corrected three times by
review (raw counts, taxonomy, then the no-scoping roster), so treat them as
re-derived per round rather than settled — re-derive before citing them outside
this document. Diary citations are quoted exactly.

The 2026-08-15 amendment implements D7 and membership self-resource
visibility. Its unit witnesses assert both newly admitted reads and the
negative default-scope, stranger, and action cases.

The 2026-08-15 D3 closure also composes the exact schema-derived table policy
into relational root/joined sources, bounded parent/child sources, and every
snapshot-batch node. Surface-local policy remains an additional conjunct;
hidden joined rows retain LLP 0080 absent semantics. Policy-composed
multi-table live surfaces take the conservative whole-result replacement path,
and the uncomposed-surface diagnostic is now a generation refusal.

## Revision history

- 2026-08-10 — first revision (Draft).
- 2026-08-11 — set to Review at super-refine loop start. Round-1 revision:
  census and counter-evidence counts corrected and their conclusions narrowed;
  recommendation restructured to the table-locus hybrid (absorbing A1; the old
  per-query-only shape moved to alternatives); D3 rebuilt around a plan-class
  model with pointing-room as the worked counter-example; D4 weakened to
  no-false-negative with conservative wakes; D6 added (shared read/write locus
  and IR); authority claims corrected (0172 phase status, 0011 §462 context and
  fallback supersession, manifest mechanism-vs-obligation distinction, 0173
  proposed-not-built).
- 2026-08-11 — round-2 revision. Census taxonomy corrected again: the shipped
  `visibility` union (search/relational/bounded-children/kits) added as the
  third declared mechanism and the strongest existing precedent
  (`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED` is explicit-or-fail today);
  "class J" withdrawn as self-contradictory — `ctx.db` is policy-composed for
  every access path, with declared `fieldBoundary:` residuals until the
  class-M sibling spec ships; class-M safety envelope pinned
  (noninterference, fail-closed field addition, obligation-backed re-masking);
  D4 split policy-fact vs policy-program changes and bound the latter to
  LLP 0053 activation; override governance minimums moved into D1; S1
  restated to target unrestricted runtime evaluation rather than the
  Rego/CEL languages (OPA/CEL compiled fragments are grammar candidates).
- 2026-08-11 — round-3 revision (delta-round fixes; no pre-existing MATERIAL
  found by either family). Overrides now **fail generation until the
  governance sibling lands** (waiver authority, self-approval separation,
  expiry, ratchet), with no-principal paths named as the driving population;
  the field-addition fence extended to **every** table, not only masked ones;
  the no-scoping roster corrected to seven demos / 21 of 102 (campfire, chirp
  added); refinements defined as conjunction-composed hence structurally
  narrowing; effective-policy projection scoped honestly (handler-local
  narrowing labeled opaque); the `fieldBoundary:` interim's missing
  noninterference stated plainly; the card-game acceptance gate restated as a
  generation failure; "the whole gap" wording narrowed to the authoring gap.
- 2026-08-11 — post-convergence editorial revision (unreviewed): the seven
  round-4 DETAIL punch-list items applied (authScopeField count, 65-of-102
  effective figure, reviewer-gated remediation adjective, interim
  norm-not-fence candor, fence activation timing, post-governance acceptance
  qualifier, Related-header hygiene, LLP 0070 authority modes in OQ6). Status
  Review → Accepted per author ruling. The dual-READY verdicts bind to
  `sha256 09c2a342…`, which precedes these edits.
- 2026-08-11 — OQ1 partially resolved by the bounded class-R disjunction:
  top-level 2–8 owner/membership arms, exact plan composition, grouped storage
  lowering, conservative membership live replacement, RQS demotion, and the
  real-session Following projection witness. Class M and the other explicitly
  named read/write/egress surfaces remain open.
- 2026-08-12 — D3's deferral condition discharged. The field-enforcement
  reading it gated the class-M sibling on was done and lands as LLP 0230
  Tier 5; the sibling is LLP 0235 (Draft). D3 now records the reading's
  load-bearing result — projection-time masking fails as a matter of
  empirical record, through channels the optimizer introduces — and names why
  0235 binds noninterference to the physical plan. OQ6's override-governance
  sibling is LLP 0234 (Draft); D2's second phase stays blocked until it is
  accepted and implemented. No decision in this document changed.
- 2026-08-12 — status reconciled with the completed ship run: recorded landing
  `908f52350` and the scoped shipped `auth.table-visibility` capability claim
  and acceptance witness.
- 2026-08-15 — added D7: ordinary handler reads stay policy-composed, while
  trusted named queries and mutations may select explicit call-local
  `ctx.db.elevated` Class-R read authority. Actions, direct/generated plans,
  masking, writes, egress, assets, bounds, and OCC remain unbypassed. Extended
  resource-table membership visibility with the bounded `_id` case and pinned
  negative default-scope, stranger, and action tests.
- 2026-08-15 — closed D3's remaining shipped read-surface gap: relational
  root/joined, bounded parent/child, and `snapshot-batch.v1`/`.v2` nodes now
  carry and execute the exact schema-derived table policy as an intersection
  with their surface-local visibility. Hidden joined rows remain absent
  (`inner` excludes, `left` nulls joined leaves); policy-composed multi-table
  live results conservatively replace on any commit. Flipped
  `SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE` from advisory to
  fail-closed codegen refusal for future unsupported classes.
- 2026-08-15 — made D7's action/scheduled/no-principal fence transitive over
  root invocation provenance, so an action cannot regain call-local elevation
  by entering a nested mutation; recorded LLP 0173's landed per-operation
  `elevatedDatabase` projection in D5.
- 2026-08-16 — discharged D2 phase 2 through LLP 0234 G1/G2: all 34 registered
  codegen jobs now declare ordinary table visibility with governed policy
  roots and zero implicit tables, and
  `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` now refuses generation. The
  card-game completion matrix removes the real hand policy in a temporary
  fixture and proves the direct, relational, bounded, and snapshot paths fail;
  card-game has no search index.
