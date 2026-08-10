# Diary 0066 — EAS Payments, engine-first slice

**Demo:** `demos/eas-payments`
**Brief:** `demos/eas-payments/BRIEF.md`
**Agent:** Claude Opus 5 (Claude Code)

## 2026-08-06 — building the slice

### What the slice is

A vertical slice of the EAS Payments Engine: five tables, a live query, a
declarative query, two mutations, two actions, one cron job. The shape that
mattered was `notification -> action -> mutation -> derived read model -> live
query`, with the store stubbed.

### What felt good

**The authoring surface matched the architecture without translation.** The
Payments Engine design says three things: the notification is a trigger, not a
source of truth; entitlements are derived from transactions; products carry
per-platform ids. Snapback's function classes encode the first one directly —
actions do not get `ctx.db`, so "never mutate from the payload" is not a
convention I had to remember, it is the only thing the runtime lets you write.
`ctx.runMutation` is the single door back to durable state. On Convex this is
the same split and reads the same way; the difference here is that the action's
write authority is *declared* (`writes: [...]`) and the config grant is
declared (`uses: [...]`), so the blast radius of the egress path is visible in
the definition rather than inferred from the handler body.

**Codegen passed on the first run.** Five tables, six operations, a cron job,
a config declaration — no iteration. That is unusual for a first pass at a
non-trivial schema and it is worth naming. The paved inline `handler:` form is
a real improvement over the `handlers.mjs` split that `demos/todo` still uses:
args, result contract, declared reads/writes, and logic sit in one expression,
so reviewing "can this function do what it claims" is one screen, not two files.

**The result-contract vocabulary is the right amount of ceremony.**
`results.documents('entitlementGrants')` for the live query and
`results.value(v.object({...}))` for the mutations took no thought and produced
typed generated references. Convex infers return types from the handler;
Snapback makes you declare them. Declaring cost me about ninety seconds total
and means the generated `api.d.ts` is not a guess.

**`cronDisabled: true` is the right default for a suite.** The guide is
emphatic that an `everyMs` job fires a catch-up run promptly after arming, and
that an acceptance suite should drive its own ticks. Taking that advice meant
the expiry check is deterministic on the first try — no flake, no sleep.

### What felt bad, or needed thought

**The live matcher forced a design decision I did not expect to make.** The
brief says `getEntitlements` returns the user's *active* grants. The obvious
spelling is `.eq('active', true)` in the builder chain, which lets the matcher
capture the predicate and skip irrelevant mutations. But the expiry path flips
a grant `true -> false`, and whether the subscription refreshes then depends on
the matcher considering the row's pre-image. `demos/todo`'s acceptance covers
the *entering* direction (a `completed=false` row becoming `true` refreshes a
`completed=true` subscription) and not the *leaving* direction, so I could not
tell from the corpus whether the narrower predicate was safe.

I chose the conservative spelling: scope on `by_user` in the builder, filter
`active` in JavaScript. The captured read set stays "this user's grants", so
any change refreshes. The partition is one user's grants, so the collect is
bounded and the cost is nothing. But I want to flag that I made this choice
from *absence of evidence*, not from documentation. The
[live-queries](../guide/realtime/live-queries.md) page should say plainly
whether a captured equality predicate refreshes a subscription when a matching
row stops matching. Filed as a guide gap below.

**A full-table scan needs an index you have to invent.** The expiry sweep runs
under system authority, so it cannot scope by user. The builder chain wants
`.withIndex(...)`, so I added `by_active` on a boolean column purely to give
the sweep a partition. It works, and codegen accepted it without comment, but a
boolean index is a two-value partition — it is an index in name only. The
alternative (a bare `.query(table).collect()`) is not clearly sanctioned by
[queries](../guide/backend/queries.md), which documents the verbs as valid
"in any order after `.withIndex(name)`". A sentence on what a legitimately
unscoped maintenance scan should look like would have saved the guesswork.

**The cron page's worked example does not work.** I copied all-aboard's
`inspectJob()` helper, which reads `state.cron?.jobs` from the public
`/inspect`. That projection carries aggregate posture only — `jobCount`,
`failedJobCount`, `inFlightJobCount` — and no `jobs` array. The `?? []` in the
helper swallows the absence, so my job-declaration check failed against a
`null` job rather than against a real fact. The page *does* say elsewhere that
per-job facts live on `snapback cron list` / `GET /_snapback/api/cron`; the
transcluded example contradicts the prose.

Switching to the AdminRead route fixed it immediately and gave me a better
check than I had planned: `lastOutcome: "Succeeded"` and `lastRunAtMs` let the
expiry test assert the scheduler *ran*, so a tick that silently no-ops cannot
pass on the strength of the entitlement reads alone.

I then ran all-aboard's own cron suite to see whether this was my mistake. It
fails 5 of 7 checks — precisely the five that read per-job facts. The two
product-behavior checks pass, so the scheduler is fine and only the observation
path is stale. That suite is not registered in `scripts/verify-local-proof`,
and the guide's `source=` check verifies snippet *text*, not that the source
file still passes. Filed as a ticket.

**Optional fields at insert time are undocumented by example.** I needed to
insert `expiresAt` as absent for a perpetual grant. Nothing in the guide shows
this; I found `lastUpstreamPollAt: null` in `demos/all-aboard/snapback/handlers.mjs`
and inferred that `null` clears an optional field. It does. But inferring a
write-path semantic from another demo's handler is exactly the kind of thing
the guide exists to prevent.

### The toolchain, which was most of the wall clock

Authoring the slice took well under an hour. Getting a server binary to run it
against took considerably longer, and none of it was Snapback's fault in a
narrow sense — but it is worth recording because "run the acceptance" is the
required surface, and the required surface was unreachable from a clean
machine.

This machine had no Homebrew, no Rust toolchain, no `bun`, no `gh`, and only
Xcode Command Line Tools. In order:

1. **`bun` was needed before codegen would run at all** — `packages/snapback-codegen`
   imports `acorn` and the repo pins `bun` as its package manager. The failure
   mode is a raw `ERR_MODULE_NOT_FOUND` from Node, which does not point at
   `bun install`.
2. **`bun install` rewrote `bun.lock`**, and `bun install --frozen-lockfile`
   against the committed lock fails on this checkout. I kept the lock change out
   of my commits, but a contributor following the obvious path would land 900
   lines of unrelated lockfile churn in their first PR.
3. **The Hermes bootstrap is the real gate.** `scripts/bootstrap-ibex-runtime`
   has two paths: an attested prebuilt bundle (needs authenticated `gh`) or a
   source build (needs full Xcode — the script builds `iphoneos`,
   `iphonesimulator`, and `macosx`, then runs `xcodebuild -create-xcframework`).
   With only Command Line Tools, the source path fails at the `iphoneos`
   configure step.
4. **Once authenticated, the prebuilt bundle downloaded and verified — and was
   then deleted.** `vendor/ibex/scripts/build-hermes.sh` treats a cache entry
   without `macos-static/` as stale ("predates the static-stub archive set"),
   `rm -rf`s the verified bundle, and falls through to the source build. The
   published asset for the pinned Hermes identity does not carry
   `macos-static/`. Snapback links the dynamic `hermesvm.framework` and its own
   `has_darwin_artifacts` check never looks at `macos-static`, so the bundle is
   complete for *this* repo — the gate that rejects it belongs to a different
   consumer.

   I worked around it through the bootstrap's own supported
   `SNAPBACK_IBEX_CHECKOUT` path: stage the attested bundle into a
   peer-checkout layout and let the bootstrap install it. Every check the
   vendored downloader performs is performed on the staged copy — `gh
   attestation verify` with the same signer workflow, source ref, and
   `--deny-self-hosted-runners`; the release checksum sidecar; the
   `ex_hermes_vm_current_package_id` patched-engine export; a runnable
   `hermesc`; and the profile receipt binding the reviewed source cache key.
   Nothing was committed and no fence was lowered, but this is a workaround and
   it should not be one.

The honest summary: the diagnostics were excellent — every failure had a stable
`SNAPBACK_*` code and named both causes — and the fence design is right
(attestation required, fail loud, install nothing on a miss). The problem is
that a macOS contributor without full Xcode has no supported path to a running
server, because the one path that does not need Xcode is invalidated by a
requirement Snapback does not have.

### Compared to Convex / Supabase

The closest analogue is Convex: schema + functions in one directory, codegen to
typed references, actions for I/O, mutations for commits, live queries by
default. Three differences showed up in this slice.

- **Declared authority.** `writes:`, `reads:`, `uses:` are enforced, not
  documentation. For a payments engine — where "what can this function touch"
  is a real question — this is the single most valuable difference.
- **Cron targets an action, not a mutation.** Convex lets you schedule either.
  Snapback's restriction pushed me to a three-function expiry path
  (cron -> `expireGrantsSweep` -> `applyGrantExpiry`) that felt like ceremony
  when I wrote it and felt correct when I tested it: the tick, the orchestration,
  and the commit are separately observable.
- **Setup cost.** Convex is `npx convex dev` and you have a backend. Snapback
  from a clean machine was a multi-hour toolchain excavation. That gap is not
  about the authoring surface, which is competitive; it is entirely about
  getting the runtime.

### Result

15/15 green. One check needed a fix after the first run (the cron projection
above); everything else passed first time. Verified stable across 17
consecutive runs at the landed commit, including 3 on the `cargo run` fallback
rung.

One caveat recorded honestly: an earlier run — the first after committing,
while the harness rejected the stale-stamped prebuilt binary and fell back to
`cargo run` — reported 14/15. I did not capture which check failed, and it has
not recurred in the 17 runs since, including runs deliberately forced onto the
same fallback rung. I could not reproduce it and cannot name it, so I am not
claiming it was benign.

### Guide gaps filed

- `issues/20260806-guide-gap-cron-per-job-inspect-projection.md` — the cron
  page's transcluded example reads per-job facts from a projection that does
  not carry them, and its source suite is red and unregistered.
- `issues/20260806-guide-gap-live-matcher-leaving-predicate.md` — does a
  captured equality predicate refresh a subscription when a matching row stops
  matching?
- `issues/20260806-guide-gap-unscoped-maintenance-scan.md` — what does a
  legitimate non-user-scoped sweep look like, and is a bare `.collect()` without
  `.withIndex` sanctioned?
- `issues/20260806-guide-gap-optional-field-writes.md` — writing and clearing
  optional fields from a handler.
- `issues/20260806-hermes-prebuilt-bundle-rejected-by-static-stub-gate.md` —
  the bootstrap gate above.

## 2026-08-10 — backfill for slices 2–6

### Provenance of this entry

**This is a backfill, and its evidentiary basis is narrower than the entry
above.** Slices 2–5 were built and committed on 2026-08-06; slice 6 was written
then and committed on 2026-08-10. No diary landed with any of them, which is a
process miss against CLAUDE.md's "land the diary update with the demo change
that produced the observations" — the observations below are reconstructed from
the committed record (diffs, check names, `demo.snapback.json`, the in-code gap
notes), not written down while the friction was happening. Where a slice's
build experience is not recoverable from that record, this entry says nothing
rather than inventing it.

What *was* directly observed this session: one cumulative **41/41** run of
`demos/eas-payments/tests/acceptance/headless.mjs` at the slice-6 commit
`17dab8ad3`. The suite is cumulative, so that single run exercises slices 1–6.
**No slice was re-run in isolation, and no per-slice count below was
re-observed** — the counts come from `expectedChecks` as recorded at each
commit.

| Slice | Commit | `expectedChecks` | Δ |
| --- | --- | --- | --- |
| 1 | `cf5b3e167` | 15 | — |
| 2 | `3331f7d0d` | 19 | +4 |
| 3 | `a4a97062f` | 25 | +6 |
| 4 | `eaba52736` | 31 | +6 |
| 5 | `ea82740f2` | 36 | +5 |
| 6 | `17dab8ad3` | 41 | +5 |

(The 15 → 19 step is worth naming because it is easy to miss: slice 2's count
is 19, not 25. 25 is slice 3.)

### Slice 2 — the store becomes a real outbound fetch

Slice 1 stubbed the store. Slice 2 replaced the stub with
`tests/acceptance/fake-store.mjs`, a real HTTP fixture, and pointed
`validateReceipt` at it through `ctx.fetch`. The distinction the code is
careful about — and it is the right one — is that the *call* is real while the
*counterparty* is fake. It is not a simulated fetch against Apple; it is a
genuine outbound request to something that is not Apple.

The load-bearing design point survives in the check names: **the store, not the
caller, decides the environment.** A client that says `sandbox` does not get to
say so — the fixture's answer wins, and `recordPurchase` rejects an environment
it does not recognize. For a payments path this is the whole ballgame, and
declared `uses: ['storeValidation']` plus `writes:` made the egress path's
blast radius visible in the definition.

Friction recoverable from the record: two checks exist only to prove the
credential boundary (`a bad store credential fails the action and writes
nothing`, then `the restored credential works again`). The second one is there
because the first leaves global config mutated — a credential test has to put
the world back, and nothing in the surface does that for you.

### Slice 3 — reconcile by re-fetching, not by trusting the payload

`applyStoreState` is the slice that makes the architecture's central claim
mechanical: a notification is a *trigger*, not a source of truth. The action
re-fetches authoritative state and only then commits. `applyStoreState
re-fetches instead of trusting its trigger` asserts the fetch actually happens
(details record `calls: 1`), which is the only way to keep that claim from
decaying into a comment.

The schema change is the interesting part. `productEntitlements` gained a
reverse index, `by_entitlement`, with the comment explaining exactly why:
*given an entitlement, which products can currently justify it.* That is what
makes `a second product for the same entitlement keeps it alive` correct —
`pro_monthly` expiring must not revoke `pro` if `pro_annual` still justifies
it. Derivation is only sound if you can enumerate the justifications, and that
needs the index in the non-obvious direction. This is the slice where
"entitlements are derived from transactions" stopped being a slogan.

Two negative checks landed here and both are the kind that catch real bugs:
`applyStoreState twice over the same state is a no-op`, and `a reconcile leaves
another user's unrelated entitlement alone`.

### Slice 4 — a feed that deliberately carries no state

`entitlementChanges` is three columns — `userId`, `seq`, `changedAt` — and the
schema comment is emphatic that carrying entitlement state would be a mistake:
the poller learns only that *something moved*, then re-reads our authoritative
answer. `pollChanges carries no entitlement state` is asserted, not assumed.

That design buys real properties. A ping may be delayed, duplicated, or
delivered out of order and remain harmless, because it is not the answer — it
is a prompt to go ask. Slice 5 leaned on this directly.

**The friction here is the one honest scar in the backend, and it is recorded
in the code rather than smoothed over.** `readMaxChangeSeq` mints `seq` as
read-max-plus-one inside the mutation, and carries a `PROTOTYPE CONCURRENCY
GAP` note: two mutations committing concurrently can read the same max and mint
the same `seq`, which would let a poller miss one. The comment also explains
why it was not hand-rolled further — `ctx.sequence.allocate` exists but permits
one allocation per mutation, and the expiry sweep appends a row per user in a
single commit. So the paved primitive does not fit the shape the design needs,
and the gap is declared in `demo.snapback.json`
(`atomic_sequence_allocation_for_multi_row_commits`) instead of being papered
over. A second reason the buffered-write semantics matter: the helper's comment
notes a mutation's writes are buffered, so re-reading the max mid-handler will
not observe rows the same handler just inserted. That is a genuine surprise
about the write model and worth knowing before you design anything
sequence-shaped.

### Slice 5 — durable retry, and the gap that cannot be worked around

Slice 4's `deliveries` table was an explicit stub ("records that a delivery
*would* have been attempted"). Slice 5 replaced it with a real POST to
`tests/acceptance/fake-developer.mjs`, plus `webhookEndpoints` registered at
runtime rather than seeded — correct, since a real endpoint is per-deployment
config, not catalog data.

The ledger design is the good decision: **one row per *attempt*, not per
change**, so the retry ladder is inspectable after the fact instead of living
only inside the job's private state. That is what lets `a failing endpoint is
retried until it succeeds` (3 attempts) and `a permanently failing endpoint
stops after maxAttempts` (5 attempts) be assertions about observable history
rather than about timing.

The strongest check in the slice is `a change enqueues a delivery
transactionally with the feed row` — the enqueue and the append land in the
same commit, so a rolled-back reconcile provably schedules nothing. Its mirror,
`a no-op reconcile schedules no delivery`, closes the other direction. Getting
transactional job-enqueue for free from the mutation boundary is a genuine
Snapback advantage; on a queue-plus-database stack this is the exact seam where
you write an outbox by hand.

**And then the wall.** `notifyDeveloper` authenticates with a shared-secret
bearer, which proves the sender but does not bind the body. A real webhook
wants an HMAC over the payload, and the handler surface has no digest primitive
to build one with — the `ctx` surface is db/jobs/runtime/fetch/sequence/push,
with no crypto anywhere. This is not a shortcut that could have been avoided
with more effort; it is an engine capability that does not exist. It is
recorded as a `SIGNING GAP` note in `functions.mjs`, in the README, and as both
`webhook_body_signing` in `capabilityGaps` and a `notClaiming` line. LLP 0069
specifies the *inbound* direction (verifying provider webhooks); the outbound
mirror is unfiled. Two other gaps were declared honestly rather than fixed:
SSRF fencing on endpoint registration checks only the URL scheme, and the
reconcile path's `PROTOTYPE AUTHORITY GAP` — `reconcileTransaction` takes
`userId` as an argument because a store notification carries no session, and
the auth vocabulary (`public | optional-user | authenticated`) has no
system-only level to fence it with.

### Slice 6 — consumables, and proving a silence

Slice 6 is the one slice this session actually verified from a
written-but-unrun state, and it is the cheapest of the six: one new product
with **no `productEntitlements` row**, one new query, five checks. The whole
design is an absence — because `coins_100` maps to no entitlement,
`deriveGrant` finds nothing to justify, so the purchase writes a `transactions`
row and stops.

What makes it a good slice is that it proves *silence*, which is harder than
proving an effect. Three checks assert nothing happened: entitlements unchanged
(and deliberately tested on the user who already holds `pro` **and** `plus`, so
"granted nothing" is a claim about an unchanged non-empty set, not a vacuous
one); nothing appended to the change feed; and — this is the neat part —
because the outbound ping is enqueued *inside* `appendChange`, an empty feed
page is also the proof that no delivery was scheduled. One append site means
one thing to check.

The fourth check is the guard that keeps the other three meaningful: `a
subscription still ticks the feed after the consumable path`. Silence is only
evidence if the feed still speaks when an entitlement really moves. That check
existing is the difference between a proof and a suppressed feed.

`consumables are repeatable` is the subtle one. Re-purchase is normal for a
consumable, so the dedupe that protects a *re-delivered* subscription must not
collapse two genuine coin packs into one. It works because dedupe is keyed on
the store's identity (`storeTxnId`), not on the product — so a distinct receipt
is a distinct row, while a replayed receipt is still deduped. The check asserts
both halves.

The deliberate non-decision: **an audit, not a wallet.** `listPurchases` is a
user-scoped projected read of store facts only, with nothing derived in it. No
balance is held. The reasoning in the code is that holding the number would
make us the authority on a value no store could reconcile us against — which is
the same instinct as the feed carrying no state. Worth recording that the demo
also notes an inert fixture artifact rather than hiding it: the fake store
stamps every receipt with `expiresAt = now + 30d`, so these consumable rows
carry an expiry a real coin pack would not have. It is harmless because nothing
derives a grant from them, and saying so is better than a reader discovering
it.

### Three toolchain findings from verifying slice 6

All three cost real time this session and none is in the guide.

**1. `demo.snapback.json`'s bytes feed `inputsHash`.** Codegen walks up from
the backend directory to the nearest `demo.snapback.json`
(`nearestDemoManifest`) and its *source bytes* participate in artifact
identity. A purely cosmetic edit to the manifest — re-encoding seven literal
em-dash characters as their `\u2014` JSON escapes, semantically identical,
`JSON.parse` output unchanged — moved `inputsHash` from `be8386b29ca2…` to
`9b231209a7a6…` and rewrote 21 lines of `artifacts.json`, while `bundleHash`,
`schemaHash`, `functions`, table count, and operation count all stayed
identical. Only the identity moved. I made exactly this edit, and it briefly
produced a commit pairing a normalized manifest with artifacts generated from
the un-normalized one — a real stale-artifact mismatch created by a change that
looked like whitespace. Lesson: any manifest edit, however cosmetic, is a
codegen input. Regenerate after touching it, or don't touch it.

**2. `SNAPBACK_OUTBOUND_ACTIONS=1` must be set for codegen *and* the suite.**
The flag does not appear anywhere in `artifacts.json`, so there is nothing to
grep for, but it changes `inputsHash` (`be8386b29ca2…` with, `58c3063b1124…`
without). Run codegen without it and the artifacts silently stop matching the
ones the suite loads. The failure is not a clear "flag missing" error.

**3. Advancing HEAD invalidates the prebuilt binary.** Committing slice 6 moved
the checkout to `17dab8ad3` while `target/debug/snapback` was still stamped
`ea82740f2`, so the harness refused it as `stamp-mismatch` and fell back to the
`cargo run` rung — which then failed with `spawn cargo ENOENT` because `cargo`
was not on this shell's PATH, producing a `0/0` run caught by the vacuous-pass
guard (ENG-22486). The diagnostics were excellent: a stable
`SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED` code, a full recovery block naming
both a repair command and a `SNAPBACK_SERVER_BINARY` override. Worth recording
that the honest fix was *not* the override: slice 6 changed no Rust, Cargo
manifest, `build.rs`, or vendored file (verified by diffing
`ea82740f2..17dab8ad3` over those paths), so the engine was provably identical
— but putting `cargo` on PATH and letting the ladder rebuild gives a green run
whose binary stamp matches the commit, which is better evidence than an
override plus an argument. The gate firing on a JS-only commit is correct
behavior, not a false positive; it cannot know the diff was JS-only.

### Result

**41/41 green**, observed once this session at `17dab8ad3` via the `cargo run`
rung with no binary override:

```
PASS eas-payments / headless — 41/41
```

`./ref-check` clean at the same commit (189 LLP docs, 3579 refs in 8655 files,
0 errors, 0 unchecked). Codegen reproduces the committed `artifacts.json`
byte-identically with `SNAPBACK_OUTBOUND_ACTIONS=1`, verified stable across
three consecutive runs.

No new `@ref` was added for slice 6. `listPurchases` is a plain projected query
already covered by the file-level `@ref LLP 0108#source-authoring`, no other
demo annotates `authScopeField`, and CLAUDE.md warns against annotating
mechanically.

### What slices 2–6 did not close

Unchanged from slice 5 and still declared in `demo.snapback.json`: real store
adapters, sessions auth, per-project isolation, offerings/merchandising,
metering, SSRF fencing, atomic sequence allocation, and webhook body signing.
Three of these are engine gaps an app cannot work around — system-only function
authority, an outbound digest/HMAC primitive, and multi-app isolation — and the
first two are, as far as the corpus shows, unfiled rather than merely unbuilt.
Unfiled is the more actionable problem.

### Guide gap worth filing

The two `inputsHash` findings above have no page. Nothing in `guide/` says that
`demo.snapback.json` is a codegen input, or that `SNAPBACK_OUTBOUND_ACTIONS`
participates in artifact identity while being invisible in the artifact. Both
produce silent mismatches rather than errors. This session was scoped to
`demos/eas-payments/` plus this diary, so no ticket was filed under `issues/`;
per CLAUDE.md and LLP 0061 §5 one should be, with `guide-gap` in the title.

## 2026-08-10 — slice 7: the normalized lifecycle state model

### What the slice is

Slices 1–6 treated a transaction as active or not. This one replaces that
boolean with a seven-state vocabulary — `active`, `grace`, `retry_hold`,
`paused`, `pending`, `expired`, `revoked` — where access is granted by exactly
two of them, `{active, grace}`. The old `refunded` spelling migrated to
`revoked`.

The whole slice turns on the three middle states. `retry_hold`, `paused`, and
`pending` are each "no access" for a materially different reason, and none of
them may ever be expired by a clock: a `retry_hold` subscription has an
`expiresAt` in the past and is very much alive, and `paused` carries a
`resumesAt` that is a future *resume*, not a deadline. A date-only sweep
destroys both.

51/51 green, stable across five consecutive runs.

### What felt good

**Three horizon columns beat one, and the schema could say why.** `expiresAt`
bounds `active`, `graceUntil` bounds `grace`, `resumesAt` is when a pause ends.
Collapsing them into one `endsAt` would lose which clock is running, and the
sweep needs exactly that. Being able to write that reasoning next to the
columns, in a file codegen actually reads, is the part of Snapback's authoring
model I keep finding valuable — the constraint and its justification do not
drift apart because they are the same artifact.

**The derived read model absorbed the change almost for free.** `deriveGrant`
went from "any active transaction" to "any transaction in an access-granting
state, with its horizon read from the column that state owns", and every caller
was already funnelling through it. Slice 3's insistence on a single derivation
paid off here in a way I did not have to think about: there was exactly one
place to teach the new rule, and the purchase path and the notification path
could not diverge.

**`_id` continuity is a better retention proof than an inactive-row read.**
`getEntitlements` filters to active grants, so a `retry_hold` row is invisible
to the product surface — and there is no "all grants" read. Rather than add one
just for the test, the checks capture the grant's `_id` while active and assert
the *same* row comes back after recovery. If the sweep had deleted it, recovery
would insert a new row with a new id. That kept the assertion inside the
product surface instead of widening the API for the benefit of a test.

**Scripted store transitions were the right fixture shape.** Every claim here
is about a subscription *moving*, and one-off `setState` calls cannot express
"recovers" versus "lapses". Named scripts (`active->grace->active`,
`active->retry_hold->active`, `pending->canceled`, …) with an explicit
`advance()` made the suite read like the state machine it is testing. Advancing
explicitly rather than on read matters: `applyStoreState` fetches once per
call, so a self-advancing fixture would have coupled the transition to the
number of fetches.

### What felt bad, or needed thought

**`v.optional()` means absent, not nullable — and the diagnostic does not say
so.** This cost the most time in the slice. Passing `expiresAt: null` to an
optional arg through `ctx.runMutation` fails with
`SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION: the function was invoked with
arguments outside its served contract`, wrapped in a generic
`SNAPBACK_HANDLER_FAILED`. It names neither the field nor the reason, and 22 of
41 existing checks went red at once, which reads like a much deeper breakage
than "one nested call passes null instead of omitting a key".

The sharp edge is that **`ctx.db.insert` and `ctx.db.patch` accept `null` for
an optional field** — that is how you clear one, as diary slice 1 recorded — so
the same value is fine on the write path and a contract violation on the
argument path. Both are "optional field, no value", and they disagree. The fix
is to build the payload conditionally, which is fine once you know; knowing
cost an hour. This is a guide gap, filed below.

**The sweep and the derivation disagreed, and finding out was the most valuable
thing in the slice.** My first pass added an idempotency check asserting that
re-running `applyStoreState` over an unchanged state is a no-op for every
lifecycle state. It failed on exactly one user: the one whose grace window the
sweep had just expired. Re-reconciling re-granted the access.

The cause is a genuine design tension, not a bug in the new code. `deriveGrant`
is deliberately **time-agnostic** — it reads states and horizons but never
compares them to the clock — and the sweep is the single horizon enforcer. That
split is what makes the sweep *testable at all*: a purchase can be written with
a past horizon and still grant access until something sweeps, which is
precisely how the pre-existing `ivy holds pro before the sweep` check works.
Make derivation time-aware and that check becomes untestable, because the suite
cannot advance the clock, so nothing would ever be left for a sweep to do.

The price is that a store still reporting `grace` with an elapsed `graceUntil`
— a self-contradictory document a real store would have moved to `expired` —
lets a redundant reconcile resurrect access until the next sweep.

I considered three fixes and took none of them:

- **Normalize at the store boundary** (treat a granting state past its own
  horizon as `expired`): clean, but it makes the *reconcile* drop access, so
  the sweep is no longer what expires a lapsed grace window — which is the
  behavior this slice was asked to demonstrate.
- **Make derivation time-aware:** kills the sweep's testability, as above.
- **Record the horizon the sweep retired** on the grant, and let only a
  strictly later horizon re-grant: this actually satisfies everything, and is
  what I would build next. It needs one more column than the slice's specified
  schema, so it was out of scope.

What I did instead was assert the real behavior in both directions — the
re-grant happens, and the next sweep undoes it, bounding the window at one cron
interval — so the suite documents the wrinkle rather than hiding it by
omission, and a future change to time-aware derivation will fail loudly instead
of quietly changing what the demo claims. It is also recorded in the README and
in `demo.snapback.json`'s `notClaiming` and `capabilityGaps`.

Recording this honestly felt more useful than a green check would have. The
temptation to quietly drop the failing user from the loop was real, and it
would have left a demo that claims idempotency it does not have.

**Same-file helpers must be function declarations, and the reason is easy to
trip over.** The natural spelling of a closed vocabulary is `const TXN_STATES =
[...]`. Codegen splices statically reachable same-file *declarations* into each
handler but does not capture outer consts, so the vocabulary had to become
`isKnownTxnState()` / `grantsAccess()` / `accessHorizonOf()`. The existing
`@ref LLP 0108#same-file-helper-sharing` already said this; I extended its
gloss to say it is *why* these are functions, because the next person will
reach for the array first.

The upside is real, though: `grantsAccess` ends up being the single predicate
that decides the access boundary, callable from derivation and from the sweep,
and that is a better outcome than a shared constant would have been.

**Cron cadence forced the sweep tests through the mutation.** `expireGrants` is
an `everyMs: 60_000` job, so it is due exactly once per minute of wall clock,
and the existing cron checks already consume that tick. Slice 7 needs several
sweeps in sequence, so the new checks call `applyGrantExpiry` directly. That is
a fair test of what they assert — the state logic lives in the mutation, and
the tick → action → mutation wiring is proven separately by two existing checks
— but it is worth naming that the cron seam does not scale to "several sweeps
in one suite" without either a shorter cadence or a virtual clock, and the jobs
subsystem's `drainJobs({ nowMs })` has an injected clock that cron's tick seam
does not.

### Compared to Convex / Supabase

The lifecycle model itself would look much the same on Convex: a status string,
a derived table, a scheduled function. Two differences showed up.

- **Declared reads/writes caught the blast radius change immediately.** Adding
  `graceUntil`/`resumesAt` to the reconcile path meant the affected functions'
  `reads:`/`writes:` were already the review checklist. On Convex I would have
  had to reason about which functions touch `transactions` by grepping.
- **The result contract caught the shape change at generation, not at
  runtime.** Widening `validateReceipt`'s result to make `expiresAt` optional
  was a declared edit; forgetting it would have failed validation rather than
  returning `undefined` to a client. Convex infers the return type, so a
  `pending` transaction returning no `expiresAt` would have been a client-side
  surprise.

Against both, the `v.optional()`-is-not-nullable asymmetry is the kind of
papercut neither Convex nor Supabase has, because neither validates nested call
arguments against a served contract at all. It is a real safety feature with a
bad error message.

### Guide gaps worth filing

Neither is filed as a ticket: this session was scoped to `demos/eas-payments/`
plus this diary. Per CLAUDE.md and LLP 0061 §5 both want one, with `guide-gap`
in the title.

- **`v.optional()` on arguments means absent, not nullable — and it differs
  from the write path.** `ctx.db.insert`/`patch` accept `null` to clear an
  optional field; passing `null` for an optional *argument* is
  `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`, reported without naming the
  field. `guide/backend/mutations.md` and the actions page should state the
  rule and the asymmetry, and the diagnostic should name the offending
  argument.
- **Cron's tick seam has no injected clock, unlike jobs' drain seam.** A suite
  that needs several runs of an `everyMs` job in one session has no supported
  way to get them; `guide/backend/cron.md` says not to sleep in tests but does
  not say what to do when one forced tick per interval is not enough.

## 2026-08-10 — slice 8: acknowledgement as a store obligation

### What the slice is

Acknowledgement is the first thing in this demo that is not our own invention.
Google auto-refunds the user and revokes the purchase if it is not acknowledged
within three days, and a consumable must be CONSUMED before it can be bought
again. Apple's acknowledgement is client-side (StoreKit `finish`) and Stripe
has no such concept, so only one adapter of the three carries a server
obligation.

`transactions` gained `ackState` ('pending' -> 'acknowledged' | 'consumed') and
`serverAckRequired`. `recordPurchase` enqueues `acknowledgePurchase` in the
same commit that writes the transaction and the grant, with `idempotencyKey:
'ack:' + storeTxnId` and `maxAttempts: 5` — slice 5's outbox shape, reused
verbatim.

56/56 green, stable across four consecutive runs.

### What felt good

**Reusing slice 5's outbox was genuinely a copy.** Enqueue transactionally,
idempotency key on the store's own identity, finite ladder, throw to ask for
another attempt, commit the outcome through a mutation. Nothing about the
webhook pattern turned out to be webhook-specific, which is the best evidence
that slice 5 found the right shape rather than a shape that happened to work
once.

**Transactional enqueue is the whole reason this is safe to owe.** A
rolled-back purchase provably schedules no ack; a committed one provably
schedules exactly one. There is no window where the row exists and the
obligation does not — and over a three-day deadline that window is the
difference between "retried" and "the user got auto-refunded". On a
queue-plus-database stack this is the exact seam where you hand-roll an outbox
and get it subtly wrong; here it was one call inside the mutation that already
existed.

**The negative assertion was the easiest one to write and the most valuable.**
"A refused ack must not be recorded as sent" is the failure mode that would
hurt most in production — believing we were safe while the refund landed — and
the fixture's `suppressAck` switch made it three lines: suppress, drain past
the ladder, assert `ackState` is still 'pending' on both sides. The engine's
own structure did the work, because the only thing that writes `ackState` is a
mutation the action calls *after* a successful response.

**Two fields beat a fourth enum value.** `serverAckRequired` next to `ackState`
rather than an `ackState: 'not_required'`. "Nobody owes an acknowledgement" and
"we owe one and have not sent it" are different facts, and collapsing them
would make every pending Apple row look permanently overdue. The slice-7 lesson
about `state` being non-null exactly when `active` is true was the same shape
of argument, and having made it once made this one obvious.

**Asserting on the store's received requests, not on the job queue.** For
"Apple sends nothing", the queue tells you about intent and the store tells you
about effect. Checking `store.requests` for `/acknowledge/` and `/consume/`
paths is the stronger claim and it cannot be satisfied by a job that was
enqueued and silently skipped.

### What felt bad, or needed thought

**An action cannot read, and the workaround is refused at generation.** This
was the design pivot of the slice. Choosing consume vs acknowledge needs
`products.kind`. Actions have no `ctx.db`. There is no `ctx.runQuery` — I
grepped the host-op surface and the ctx bootstrap to be sure. So the paved
answer is "call a mutation", and I wrote a read-only `resolveAcknowledgement`
mutation with `writes: []`.

Codegen refused it: `defineJsMutation requires declared writes or sequences`.

That is a defensible rule — a mutation that writes nothing is a query — but
combined with the absence of `ctx.runQuery` it means **an action has no
sanctioned way to read durable state at all**. The two rules are individually
reasonable and jointly leave a hole. My options were:

- declare `writes: ['transactions']` on a mutation that never writes, which is
  exactly the over-broad authority this demo praises Snapback for making
  visible;
- fold the read into the mutation that *does* write, which cannot work because
  the outbound call has to sit between the read and the write;
- decide at enqueue time and put the answer in the payload.

I took the third. It is safe here in a way it would not be for a transaction's
*status*: `kind` is our own catalog fact and does not drift under a queued job,
whereas a store status absolutely does — which is the whole thesis of slices 3
and 7. Every durable guard still runs at execution time inside
`markAcknowledged`, the only place that can see current state at commit time.
But I want to be clear that I chose it because the platform closed the other
doors, not because it was my first design. Filed as a gap below.

**A pre-existing check was over-broad and slice 8 exposed it.** `no registered
endpoint means no delivery is scheduled` asserted the *entire* job queue was
empty. It passed for three slices because nothing else enqueued. The moment
acknowledgement joined the same `default` queue it broke — and the trigger was
a slice-1 check that happens to buy on `google` for reasons that have nothing
to do with adapters (it is testing live delivery).

The fix was to scope the assertion to `action === 'notifyDeveloper'`, which is
what the check's name and intent already claimed. Worth recording as a habit:
when a check asserts on a shared subsystem's *global* state, it is implicitly
asserting that no future feature will ever use that subsystem. That is a claim
about the future, and it will be wrong. The narrower assertion is both more
honest and more durable.

**`suppressAck` needed to refuse, not to lie.** My first instinct was a switch
that made the endpoint return 200 without recording. That would have tested a
dishonest store rather than an unreachable one, and it would have let a bug
where we mark acknowledged on any 200 slip through. Returning 503 exercises the
real failure mode and costs six drain rounds to walk the ladder.

**The compressed deadline had to be scoped, or it would have been collateral
damage.** A store-wide "revoke everything unacknowledged" sweep would have
destroyed the slice 1-7 fixtures the moment slice 8 called it. Scoping it to
Google transactions is not a test convenience — it is what the real obligation
is, since Apple and Stripe never auto-refund for a missing server ack. Getting
the fixture's scope right *because* the domain rule is narrow was a pleasant
case of accuracy and convenience pointing the same way.

### Compared to Convex / Supabase

Closest comparison is Convex's scheduler plus a mutation. Two differences.

- **Transactional enqueue is native here and manual there.** Convex's
  `ctx.scheduler.runAfter` inside a mutation is also transactional, so this one
  is a draw with Convex — but against Supabase (or any Postgres-plus-worker
  stack) it is the difference between one call and an outbox table with its own
  poller.
- **`uses:` made the config grant reviewable.** Adding `storeBaseUrl` to the
  ack action's `uses` list is the entire authorization story, and a reader can
  see that the ack action reads two config entries and writes one table without
  reading the handler. The papercut is that `expose()` is the only way to get a
  plain string out of a config handle, and it reads like a secret escape hatch
  even when the value is a URL — I annotated the call rather than leave a
  reader wondering why a non-secret needed exposing.

### Guide gaps worth filing

Not filed as tickets: this session was scoped to `demos/eas-payments/` plus
this diary. Per CLAUDE.md and LLP 0061 §5 both want one, with `guide-gap` in
the title.

- **An action has no sanctioned way to read durable state.** No `ctx.db`, no
  `ctx.runQuery`, and a read-only mutation is refused with `defineJsMutation
  requires declared writes or sequences`. The jobs and actions pages both say
  "an action calls a mutation for durable effects" without addressing reads.
  The guide should either name the intended pattern (payload carries what the
  action needs, decided at enqueue time) or the platform should admit a
  read-only callee — silence currently pushes authors toward declaring a write
  they never perform.
- **Nothing documents that config is the way to give a job an endpoint.** A
  job's arguments are minted inside a mutation, which cannot know a
  runtime-discovered origin, so the testing-seam trick of passing
  `storeBaseUrl` as an action argument does not generalize to queued work.
  Config plus `expose()` is the answer and I had to derive it;
  `guide/backend/jobs.md` is where a reader would look.

## 2026-08-10 — slice 9: the after-sale money lifecycle

### What the slice is

A sale is not final. Money moves back — voluntarily (the user asks, the store
agrees) or involuntarily (a bank disputes the charge) — and then forward again
when either is reversed. Plus one inverted obligation: Apple's
CONSUMPTION_REQUEST, where the store asks US for data before deciding a refund
and gives us a window to answer.

`transactions.refundState` became a second axis alongside `status`, and a small
`consumptionRequests` table makes the deadline durable state rather than a
timer.

65/65 green, stable across four consecutive runs.

### What felt good

**Two axes was the right call and the acceptance proved it in one check.** The
sharpest case is a dispute closing LOST: `status` is 'revoked' before and after
— it does not move at all — so `refundState` is the only thing that changes.
With a single axis that transition is invisible and the row keeps claiming the
dispute is open forever. Writing `assertEqual(res.result.changed, false)` next
to `assertEqual(res.result.refundState, 'dispute_lost')` in the same check is
the whole argument for the split, compressed into two lines.

The other half is that access derives from `status` alone, so nothing on the
money axis can accidentally change what a user may do. That separation made the
whole slice feel low-risk in a way slice 7's single-axis widening did not.

**The reverse direction needed no new code at all.** I expected re-granting
after a refund reversal to be the hard part. It was zero lines: `deriveGrant`
already recomputes from every transaction, `applyDerivedGrant` already keeps
the grant row when it goes inactive and patches it back, and slice 7's
`(active, activeUntil, state)` change key already ticks the feed for it. The
reversal check passed the first time and asserts the SAME grant `_id` comes
back rather than a second row appearing — which is only true because the
derived read model was built as a projection from the start.

This is the clearest payoff yet from slice 3's insistence on one derivation.
Four slices later, a genuinely new business event (reversal) required only that
the store be able to say it.

**No new mechanism for any of the four money transitions.** Refund, reversal,
dispute open, dispute close — all four arrive through slice 3's re-fetch
reconcile. I added store seams and a vocabulary; the engine path was untouched.
When an architecture absorbs a whole new domain concept without a new code
path, that is the architecture being right rather than the feature being easy.

**Durable deadlines beat timers, and made the claim checkable.** Putting
`requestedAt` / `deadlineAt` / `respondedAt` in a row means the property "we
answered on time" is a comparison anyone can run after the fact, not an
inference from log timing. The two consumption checks assert `respondedAt <
deadlineAt` directly and report the margin (~3.6M ms), which is the kind of
evidence that survives someone asking "but did it really?".

### What felt bad, or needed thought

**I shipped a duplicate-delivery race and the acceptance caught it.** This was
the real work of the slice.

My first design enqueued TWO jobs per consumption request: an eager attempt at
`delayMs: 0` so we could answer the moment the developer supplied data, and a
deadline alarm. Both became due in the same drain wave, both ran
`settleConsumptionRequest` phase 'resolve', both saw `respondedAt` unset, and
the store received **two** consumption POSTs. Check 7 caught it immediately,
and check 3 caught it too.

The fix is not obvious, because the obvious fix is wrong. Claiming the response
before the POST — stamp `respondedAt`, then send — closes the race and
introduces a strictly worse failure: a POST that fails leaves the request
looking answered, so the retry declines to send and we silently miss a deadline
whose entire purpose is not being missed. **Send-then-record is mandatory
here**, which means concurrent resolvers cannot be made safe, which means there
must not be concurrent resolvers.

So: exactly one job. The eager attempt was my addition, not the brief's, and it
bought a property nobody needs — Apple does not care where in a 12-hour window
the answer lands. The obligation is "answer before the deadline", not "answer
instantly". Deleting the second enqueue fixed both checks and made the design
smaller.

Two things I want to record about this. First, the two-job version would very
plausibly have shipped: it passes any test that drains twice, and only fails
when both jobs land in one wave. Second, the residual exposure is real and I
documented it rather than implying it away — execution is at-least-once, so if
the POST succeeds and the record mutation then fails, the retry re-sends.
`jobs.md` warns about exactly this ("do not treat idempotent enqueue as
exactly-once execution") and it is now a `notClaiming` line.

**The phase-switched mutation, again, and with a better justification.** Slice
8 hit "an action cannot read durable state" and solved it by resolving at
enqueue time. That does not work here: the developer's data may arrive
*between* the request and the alarm, so it cannot be baked into a job's
arguments — the read has to happen at execution time.

So `settleConsumptionRequest` takes a `phase` of 'resolve' | 'record'. I
disliked this shape in slice 8 and I like it here, and the difference is worth
naming: the two halves are one operation that *must* straddle an outbound call,
and the alternative is declaring `writes: ['consumptionRequests']` on a resolve
function that never writes. Keeping them in one function makes the declaration
truthful. The platform constraint is still a gap (filed in slice 8), but this
is the right local answer to it rather than a workaround.

**Adding a field to a projection is a codegen input, and I forgot.** Six checks
failed at once with `refundState: undefined` because I added the field to
`listPurchases`'s result contract and mapping but ran the suite before codegen.
The suite loads generated artifacts, so it was reading the previous shape.
Third time this session that an unregenerated artifact produced a confusing
multi-check failure (slice 7's `v.optional()` null, slice 8's none, this). The
lesson has stopped being "remember to regenerate" and started being "any edit
under `snapback/` invalidates the suite until codegen runs" — worth a
pre-flight check in the run loop rather than discipline.

**Checking an existing `@ref` was not a formality.** Slice 7 left an `@ref` on
LLP 0069 asserting our vocabulary and that RFC's are "disjoint on purpose".
Adding `refundState` made that partly false: 0069's `refunded`,
`partiallyRefunded`, and `disputed` are the same events this axis tracks.
AGENTS.md's rule about re-checking refs you modify near caught a comment that
would have quietly become wrong, and the corrected version says something more
useful than the original — that `refundState`, not `status`, is the side an
adapter maps onto.

### Compared to Convex / Supabase

The two-axis modelling would be identical anywhere; nothing about it is
Snapback-specific. Two differences showed up in the *obligation* half.

- **Transactional enqueue plus declared writes made the race diagnosable rather
  than mysterious.** Once the duplicate POST appeared, the enqueue site and the
  two idempotency keys were the only two places it could come from, both
  visible in one function. On a queue-plus-worker stack I would have been
  reading worker logs to find out whether two workers claimed the same row.
- **At-least-once is stated, not discovered.** `guide/backend/jobs.md` says
  plainly that execution is at-least-once with fenced attempts and that
  enqueue-side dedup is not execution-side exactly-once. Having that written
  down is why I reached the "there must not be concurrent resolvers" conclusion
  in minutes rather than after a second bug. Convex documents its scheduler's
  guarantees similarly; Supabase-plus-pgmq leaves it to you.

Against both, the `v.optional()`-is-not-nullable rule from slice 7 has now
saved time twice — I wrote every optional-arg payload as omit-not-null without
thinking about it, which is the sign a papercut has become internalized
knowledge rather than a recurring cost.

### Guide gap worth filing

Not filed as a ticket: this session was scoped to `demos/eas-payments/` plus
this diary. Per CLAUDE.md and LLP 0061 §5 it wants one, with `guide-gap` in the
title.

- **Nothing warns that two jobs which can be due simultaneously are concurrent
  resolvers.** `guide/backend/jobs.md` documents at-least-once execution,
  pinned claim order, and the 64-per-wave claim batch, but a reader designing
  an eager-attempt-plus-deadline-alarm pair will not learn from it that both
  can execute before either commits. The page should say that jobs within a
  wave are not serialized with respect to each other, and name the
  send-then-record vs claim-then-send trade-off for outbound obligations,
  because the safe choice depends on which failure you can tolerate.
