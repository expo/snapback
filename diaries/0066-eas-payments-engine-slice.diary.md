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

### Guide gaps filed

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
