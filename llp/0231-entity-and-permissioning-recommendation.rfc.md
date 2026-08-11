# LLP 0231: Entity and permissioning — recommendation

**Type:** RFC
**Status:** Review
**Systems:** Auth, Security/authorization, Storage, Live queries, Code generation, Client integration, Testing
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-10
**Related:** LLP 0011, LLP 0039, LLP 0043, LLP 0046, LLP 0053, LLP 0056, LLP 0082, LLP 0100, LLP 0170, LLP 0172, LLP 0173, LLP 0187, LLP 0230

## Summary

**Recommendation: visibility becomes a declaration, not a filter.**

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
game is on screen. **Nothing in the manifest distinguishes them.** Delete the
first and the demo still runs, still passes every test that does not
specifically probe cross-player visibility, and leaks every hand at the table.

That is [LLP 0170](./0170-authorization-obligation-feasibility.research.md)'s
conclusion made concrete — "the handler must still enforce the caller filter" —
and it is Ent's thesis demonstrated in our own flagship authorization demo.

The proposal is small: give the security predicate its own declared position,
make declaring it mandatory, compile it into the query, and project it for
review. Three of those four use machinery that already exists.

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
- **An authorization review projection** ([LLP 0173](./0173-authorization-review-projection.rfc.md)).
- **An explicitness precedent** ([LLP 0172](./0172-explicit-function-authorization.rfc.md)):
  function-level auth moved from implicit default to explicit-or-fail across two
  published phases — warn with the exact edit, then fail generation.

**The policy language is built and analyzable. Applying it is voluntary.** That
is the whole gap.

## Evidence

**The demo that exists to prove visibility leaks if you delete one line.**
`demos/card-game/snapback/functions.mjs:42-45`, above.

**We recorded the shape of the right answer, from InstantDB.** LLP 0011 §462:

> InstantDB evaluates CEL `view` rules **post-query on every object, including
> during live invalidation**; it flagged CEL-to-`where` [pushdown]

**And the shape of the wrong one, from Firebase.** Diary 0031:296:

> Rules are authorization, not filters. Query structure must be designed
> alongside policy and indexes; **a natural client query can fail even when each
> returned row would be authorized.**

Reject-style rules make legitimate queries fail; filter-style rules make
illegitimate rows disappear. We want the second.

**We already wrote down the target.** Diary 0031:565:

> InstantDB's linked-data permissions and `asUser` testing are **excellent
> end-state targets**: authorization should **compose across relationships**, and
> tests should switch identities without bespoke token plumbing.

**And real demos need per-viewer visibility, not just per-caller.** Card-game
hidden hands; pointing-room, where votes are concealed until the round reveals
(diary 0074:10). Both were hand-built.

### The card-game case is the pattern, not an outlier

Counted across `demos/*/snapback/functions.mjs` at `5373238eb`:

| | count |
| --- | ---: |
| Query definitions | ~90 |
| Carrying a declared `membership:` | **9** |
| Uses of `authUserId()` inside a `filter` | **31**, across 12 demos |

So caller scoping happens roughly **3–4× more often through the undeclared path
than the declared one**. Authors are not ignoring authorization; they are
reaching for the mechanism that is natural to type, and that mechanism is the
one the manifest cannot see as a security boundary.

Two honest caveats: not every `authUserId()` is a security boundary — some
legitimately scope "my items" over data that is public anyway — and one query
may use it more than once, so these are uses rather than queries. Neither
changes the direction. The declared, analyzable path exists and is the minority
path.

This is what makes D2 (mandatory declaration) the load-bearing clause rather
than D1 (a new slot). The slot without the obligation would just be a third
option that authors also skip.

## Recommendation: declared row scope

### D1 — visibility gets its own position

A query declares `visibility:` separately from `filter:`. Same expression
vocabulary (`authUserId()`, `memberOf()`, `hasRole()`, and field comparisons);
different slot, different meaning, different review treatment.

The point is not new syntax. It is that a security predicate stops being
textually indistinguishable from a convenience predicate — for the compiler, for
LLP 0173's review projection, for a diff, and for an agent reading the manifest.

### D2 — declaring it is mandatory, via LLP 0172's exact precedent

Every query declares visibility or fails generation. `visibility: public()` is
valid, explicit, greppable, and reviewable — the same move 0172 made with
`optional-user`.

Two phases, as 0172 ran them: a per-query warning naming the exact edit, then a
generation failure. This is the single highest-value clause in this document,
and it is process we have already executed once.

### D3 — the predicate is composed into the query, never applied after

Per LLP 0011 §462 and diary 0031:296. Composition preserves the matcher's skip
path, keeps LLP 0035's per-subscription costs, and avoids Firebase's
natural-query-fails failure mode.

A visibility expression that cannot be composed is a **generate-time refusal**,
not a runtime fallback. That cap on expressiveness is deliberate and is the
central tradeoff of this proposal (see §Costs).

### D4 — visibility change is an invalidation event

Memberships are already wired into LLP 0053. D1's declaration makes the
dependency explicit per query, so a membership change invalidates exactly the
subscriptions whose visibility depends on it — the revocation correctness 0056
already argues is the reason to own this rather than bolt it on.

### D5 — project it, and test it by identity

Extend LLP 0173 so every query's visibility declaration appears in one reviewable
surface: an auditor reads one page rather than N handlers. And adopt diary
0031's second target — `asUser`-style identity switching in acceptance, so
"Bob cannot see Alice's hand" is a test rather than a hope.

### Why this and not an entity framework

Ent's transferable insight is **unbypassable**, not **per-row policy objects**.
The object model is how Ent achieves it in a request/response system; in a system
with durable subscriptions, per-row evaluation is precisely the InstantDB failure
we already documented. We can take the insight without the mechanism, because we
already own the query compiler and the sync layer.

### Counter-evidence: how much of this is no-op typing?

The case above is one-sided unless we ask how many queries have no scoping story
at all, because those gain a declaration that says nothing.

Five demos carry no authorization concept whatsoever — `all-aboard` (8 queries),
`public-dashboard` (4), `chat-matrix` (3), `latency-kanban` (3), and
`pulse-monitor` (2). That is **20 of ~90 queries, roughly one in five**, that
would acquire `visibility: public()` and be no better off for it.

That is the honest cost of D2, and it is worth stating in the direction that
weakens the proposal. It is also a *favourable* ratio: if 80% of queries were
legitimately public, mandatory declaration would be mostly noise. At ~20%, four
in five queries have a real scoping story that today is either undeclared or
invisible.

And an explicit `public()` is not worthless — LLP 0172 made the same trade for
`optional-user`, on the reasoning that an intentional anonymous surface should be
distinguishable from a forgotten one. A public dashboard *should* say it is
public.

*Method note: this is my own count at `5373238eb`, not a diary sweep. A
delegated pass over all 85 diaries was attempted and produced no report, so the
qualitative counter-evidence — authors reporting the current model as sufficient
— remains ungathered. Open question 6.*

## Costs, stated plainly

- **Expressiveness is capped** by what the matcher can compose. Policies needing
  arbitrary joins or computed values will be refused at generate time. Some
  apps will find this genuinely limiting.
- **Every existing query must be touched** during the D2 migration.
- **`visibility: public()` can be cargo-culted.** Explicitness makes a wrong
  choice *visible*, not impossible — LLP 0187's confident-and-wrong failure mode
  applies, which is what D5's projection is for.
- **This does not close the write side.** Mutation authorization is a sibling
  problem this RFC does not address.

## Alternatives worth considering

### A1 — table-level default visibility (the RLS shape)

Attach the predicate to the **table** rather than the query. Every read of
`hands` gets `ownerId = caller` unless a query explicitly opts out.

**Genuinely may be better than the recommendation.** It is strictly safer: a
forgotten declaration fails closed rather than open, so a new query is safe by
default instead of merely refused. It also lowers cleanly to Postgres RLS
(LLP 0046) — one model, two backends.

Against it: cross-cutting reads (admin views, aggregates, moderation) need an
escape hatch, and escape hatches are where leaks live. Per-query declaration
also makes the *review* surface better, because the policy sits where the query
sits. **If the author prefers fail-closed over reviewable, take A1.**

### A2 — full entity objects (the expo/entity shape)

Entities with policy classes, loaders, mutators; authorization inside the data
accessor. Maximum expressiveness and a proven model.

Against: it is the post-query per-row evaluation LLP 0011 §462 recorded failing
on Instant's live path, and it introduces a second data-access layer beside the
query compiler we already own. Right answer for a request/response backend;
wrong shape for this one.

### A3 — Zanzibar-style relationship tuples

Authorization as a separate relation graph with userset rewrites. Buys exactly
what diary 0031 asked for — composition across relationships — plus
inheritance, and our commit version is structurally a zookie (LLP 0230).

Against: a second data plane with its own consistency problem, and LLP 0056
deliberately chose "roles are app data, in a system-recognized shape" instead.
Worth revisiting only if relationship composition becomes the binding
constraint; the tuple store is the expensive half and 0056 already avoids it.

### A4 — verify instead of declare (Blockaid shape)

Leave handlers as they are and prove non-leakage at generate time with a solver.
Zero authoring burden if it works.

Against: LLP 0170 already concluded the manifest cannot support the discharge,
and a JS handler's `reads` list is a dependency declaration rather than result
provenance. LLP 0230 open question 1 asks whether Blockaid changes that
assessment — worth answering before dismissing, but not a plan today.

## Sirens — attractive and wrong

### S1 — a general policy language (Rego, CEL, arbitrary predicates)

**Why it looks right:** principled, expressive, industry-standard, and it
future-proofs against policies nobody has thought of.

**Why it is a trap:** it is exactly what LLP 0011 §462 watched fail. Arbitrary
predicates cannot be composed into a query, so they run post-query per object,
including during live invalidation. You would trade the analyzability that makes
matcher skip, invalidation, and generate-time review possible — the substrate
this whole system rests on — for expressiveness most apps never use. Cap
expressiveness deliberately (LLP 0230 on Cedar) rather than discovering the cap
after it is load-bearing.

### S2 — treat sync partitioning as authorization

**Why it looks right:** local-first framing makes it natural — "don't sync what
they can't see" — and PowerSync-style buckets make it look blessed. It seems to
solve authorization and bandwidth in one move.

**Why it is a trap:** it conflates *what we chose to send* with *what they are
allowed to see*. Any bug in partition assignment becomes a data breach rather
than a display bug. Worse, LLP 0043's offline retention means revocation cannot
reach data already on the device — the card-game work already had to reason
about lease-authorized retention for exactly this. Authorization must be a
property of the read, with partitioning as an optimization *underneath* it.

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

**Why it is a trap for us:** revocation and live queries both become very hard —
you re-key on every membership change, and the server can no longer evaluate the
predicate it needs for matcher skip, so live fan-out degrades toward broadcast.
Jazz pays for this in a currency it can afford because its whole architecture is
built around it. Retrofitting it here would fight both the matcher and LLP 0053.

## Open questions

1. **D1 or A1 — per-query declaration or table-level default?** The real
   decision in this document. Reviewability against fail-closed.
2. **What exactly can a composable visibility expression contain?** The
   expressiveness cap is the central tradeoff and this RFC does not pin it.
3. **Does `visibility` subsume `authScopeField`,** or do both persist with
   different jobs? Two overlapping concepts would be worse than either.
4. **What is the migration shape** for existing queries whose caller filter is
   already in `filter:` — mechanical lift, or author review each one?
5. **The write side.** Mutation authorization is unaddressed here and needs its
   own treatment.
6. **Qualitative counter-evidence is ungathered.** §Counter-evidence measures
   how many queries would gain a no-op declaration, but nobody has read the 85
   diaries for authors reporting the function-level model as *sufficient*, or
   for authorization incidents caught by review rather than by the system. A
   delegated sweep produced no report. If that reading turns up authors
   routing around memberships deliberately rather than by default, D2's scope
   should narrow before it is ratified.

## Acceptance

- Every query declares visibility or fails generation, per D2's second phase.
- A query whose visibility expression cannot be composed into the query is
  refused at generate time with a stable `SNAPBACK_*` code, not silently
  post-filtered.
- Deleting the visibility declaration from the card-game hidden-hand query fails
  a test, rather than passing and leaking.
- A membership change invalidates exactly the subscriptions whose visibility
  depends on it, and no others.
- LLP 0173's projection lists every query's visibility declaration on one
  surface.
- Acceptance can switch identity (`asUser`) without bespoke token plumbing, per
  diary 0031:565.

## Status

Draft. No implementation and no capability claim. The card-game observation and
the codegen/manifest findings are reproducible at `5373238eb`; the diary
citations are quoted exactly.
