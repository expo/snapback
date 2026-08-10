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
