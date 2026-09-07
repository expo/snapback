# LLP 1018 panel review — claude

**Change:** `llp/1018-structural-moves-to-surpass-convex.research.md`, the 2026-09-06 draft (uncommitted at review time; its revised form landed with this record).
**Reviewer:** Claude Fable 5.1 — the orchestrator's own round-one position, written before reading any other panelist.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`, 2026-09-06/07.
**Provenance:** every review below was actually received from the named model; verbatim text per round. Round one was blind; round two showed each panelist all five round-one positions and the orchestrator's provisional decisions on the browser-tab policy and cap metering. Reviews are input to the orchestrator's decision (LLP 1018 §9), not verdicts on a code change.

| Round | Reviewed | Received |
|---|---|---|
| 1 | the draft, blind | yes |
| 2 | all five round-one positions plus the provisional decisions | not asked (the orchestrator does not review its own decision) |

## Round 1 (verbatim)

## Verdict on the thesis

The thesis is supported and the measure is right but incomplete. Across all
three scorers the categories Snapback already wins are the primitive-shaped
ones (authorization, media, writes, offline, background), and the ones it
loses are the composition-shaped ones. Astra 0.0.8: queries-and-live 65 vs 87,
client integration 63 vs 83, diagnostics/dev loop 65 vs 87, setup/docs 68 vs
83, scale 58 vs 80. Muse (landed after the draft, `98f4e2e35`): Snapback 78 /
Convex 82 / Supabase 62 overall, with Snapback's *weakest* categories
setup-and-docs 38, background 45, diagnostics 50, queries-and-live 55, and the
note "a third of build time derived undocumented contracts from behavior."

So "application-owned infrastructure removed" captures the client-integration
and queries-and-live gap, but it does not capture the second gap that both
scorers independently found: **contracts the builder had to discover by
probing** (grants, outbox readiness, drain admissibility, leases, cursor
shapes, `reset` semantics, no `--help`). That gap is cheaper to close than any
runtime move and it is scored twice (setup/docs and diagnostics). I would make
the measure a pair, both countable from diaries: infrastructure the app had
to own, and contracts the app had to derive from behavior.

## The four moves (keep / change / drop / add)

**Move one, client coherence — keep, and narrow it.** The store side is
already one ownership boundary: `OfflineRuntime.commitMany` in
`snapback2/packages/snapback2/src/offline.ts` serializes every delivery,
watermark, settlement, tombstone and facts change into one `store.commit`
swap. The document should not read as "build a transactional boundary"; that
exists. What fights itself is *above* the store: `client.ts` `query()` has
four answer paths (held while hydrating, held before startup, forced offline,
online with validator then commit, plus a retry fallback to held),
`subscribeRegular()` re-implements the same decision with its own
`onError`/`onLoss` fallbacks, `drain()` wraps both, and `react-core.tsx`
`useQuery` runs a *fifth* copy (its own reducer plus its own retry loop for
one-shot reads). Every hook instance opens its own SSE logical stream, so ten
components reading `inbox` are ten subscriptions and ten decisions. The
consolidation I would name is a **per-`(op,args)` query session**: one
refcounted object that owns held → predicted → live → refused for that key,
emits one `QueryView` stream, and is what `query`, `subscribe`, `useQuery`
and the drain all read from. That gives subscription sharing as a side effect
rather than as a separate dedup layer, and it is where "explicit completeness,
authority, freshness, and refusal states" would be computed once.

**Move two, certified execution — keep.** The cap-metering ticket is the
right first witness: charge N once per distinct `(table, key)` touched by a
mutation, not per inserted row. It is contained to the compiler's certificate
and its regression is one fixture (49 inserts under `cap 1000 by principal`
must certify).

**Move three, Quarry owns semantics — change.** Keep the collision repair
(generated bindings get distinct identities; public names unchanged) and the
"explain at Quarry source locations" criterion. Drop the typed-IR evaluation
from this round entirely: the document's own confidence is low-to-medium, the
rules say only implemented specs bind, and nothing in the three scorers'
narratives attributes points to the lowering path except the collision. Keep
`fn` deferred per LLP 1011 §0.

**Move four, evolution — keep at lowest priority.** M7 evidence is thin in
every run; the survivor-uniqueness finding is a real bug to fix but it is a
bug, not a structural move. LLP 1016 already gives rehearsal and jobs.

**Add a move zero: the contract is discoverable.** Every seam a builder hit
by probing gets a code, a `why`/`status` reason, and a recipe line: outbox
readiness reasons already exist (`OutboxStatus.reason`), so this is mostly
about the guide page and `check` output. Concretely from the Muse narrative:
`dev`/`reset` need `--help`; `check` truncates miss lines at 120 chars and
caused four misdiagnosed loops; grant minting is "an uncited ritual"; the
view-once guard lives only in `.d.ts` prose. This is one to two days, hits the
two categories where Snapback is furthest behind, and needs no design.

## Ordering and the first slice

Ordering: zero (discoverability), one (client), two (certified cost), three
(compiler hygiene only), four. Move zero first because it is cheap and its
score effect is the least speculative.

The single highest-leverage code slice for one to three days is the **query
session** above, with two concrete visible effects: identical `useQuery`
calls share one subscription and one state, and every read surface reports
the same `QueryView` for the same key. It removes from the builder's plate the
inbox cache (they built one because two readers of the same log disagreed)
and half the "which state am I in" reasoning. A second, smaller slice sits
beside it: the **browser tab policy**. Today `acquireStoreLock` in
`store/locks.ts` requests the Web Lock with `ifAvailable: true` and refuses
`E_OFFLINE_LOCK` immediately. Change the follower to *wait* on the lock while
running as an online-only client, and take over the partition when the leader
closes. That is the "durable recovery after the active writer closes" the
document asks for, with no BroadcastChannel protocol and no shared outbox
merge: queued writes live in the partition, the partition has one writer at a
time, and the next writer inherits them. The document should say this
explicitly instead of leaving leader election as "a candidate".

## Move one: decomposition

Right primitive set, wrong emphasis. Delivery identity for clock reevaluation
is already repaired on main (the `readTime` stamp; ticket closed 2026-09-07,
unpublished), so it is a publication task, not a design item. The
"transactional ownership boundary" exists in `commitMany`. Subscription
sharing and the tab policy are the two pieces that do not exist. I would
decompose as: (a) the session object per key, refcounted, owning the
held/predicted/live/refused merge and the SSE child; (b) the hook becomes a
thin subscriber to the session (delete the hook-side reducer copy); (c) the
drain becomes a session that follows `next` and owns the watermark; (d) the
lock waits. The current code already has the right shape at the store
(`PersistentRangeStore.commit`, one swap) and at the wire (`SharedSse` is one
physical stream with fenced children); it fights itself only in the layer
between them.

## Biggest risk and what to cut

The plan burns effort if "one transactional ownership boundary" is read as
re-architecting the range store or the twin, or if the typed Quarry IR is
started. Neither is attributed a point by any scorer. Cut the IR evaluation;
cut any range-store rework; keep the byte ceiling (66,000 gzip) as a hard
constraint on the session work, since a session layer that copies state
would push the entry over it. Also cut the implicit expectation that a
holistic rescore will move: N=1 narratives from three families disagree by
twenty points on the same package; ship the slices, run the next cold build,
and let the diaries count workarounds.

## Corrections

- §3 says the clock-query reproduction "and its unlanded candidate
  verification are concrete starting points." The repair landed on main on
  2026-09-07 (`issues/closed/20260906-snapback2-clock-query-delivery-identity.md`);
  it is unpublished, not unlanded.
- §2 lists only Astra and Grok narrative scores for the 3×3 run. Muse's
  scores landed in `98f4e2e35` (Snapback 78, Convex 82, Supabase 62; mean of
  three scorers 66 / 81 / 62). The document should cite them; they change
  which categories look weakest.
- §3 "One transactional ownership boundary … must agree on when state becomes
  visible" describes what `OfflineRuntime.commitMany` already does; the
  finding is above the store, not in it.
- §3 multi-tab: the current refusal is immediate because the lock request is
  `ifAvailable: true` (`store/locks.ts`); "durable recovery after the active
  writer closes" is a one-flag change plus a follower mode, not a leader
  election protocol.

## Summary for the author

The four moves point the right way and the ordering is defensible, but the
document under-states how much of move one already exists (the store's one
swap, the shared SSE stream, the clock repair on main) and over-states the
remaining design: what is actually missing is a per-key query session that
`query`, `subscribe`, the drain and `useQuery` all read from, and a follower
tab that waits for the partition lock instead of refusing. Build those two,
fix cap metering per distinct key, fix the name collision and the truncated
`check` lines, and add the missing seams to the guide, before touching the
compiler's lowering or the range store. Add discoverability as a move in its
own right and count it in the measure; both Astra and Muse scored it, and it
is the cheapest points on the board.
