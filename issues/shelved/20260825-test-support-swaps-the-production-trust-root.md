# Enabling `test-support` swaps the production trust root for one whose private key is in the repo

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-auth, snapback
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  llp/0098-hosted-edge-adapter.spec.md,
  issues/shelved/20260825-the-critical-path-is-the-shared-surface-not-the-rows.md,
  issues/shelved/20260825-production-equivalent-is-not-a-clearing-rule.md

> **CORRECTION (2026-08-25, same day).** The file paths and line numbers below describe the **q14 lane
> worktree**, not `origin/main`. Verified directly against `origin/main`:
> `crates/snapback-kernel/src/auth/invalidation_issuer.rs` and
> `crates/snapback-auth/tests/hosted_admission_replay.rs` **do not exist**, and
> `crates/snapback-kernel/src/auth/hosted_edge.rs:36` is watermark initialization, not a trust-root
> substitution. The executed `build-identity` result was real, but real *in that lane* — the review ran
> inside it, and the lane's own commits created those files. I generalised a lane-local finding into a
> repository-wide claim without checking, which is the error, not the review's.
>
> **The class is nonetheless real on `origin/main`, in a broader form.** An independent read-only
> analysis found the same self-certifying shape in the shipped hosted path: configuration carries the
> Ed25519 key (`crates/snapback-auth/src/auth/hosted_edge.rs:215`, `:229`) and the server verifies the
> envelope **with that same configured key** (`crates/snapback-server/src/admin.rs:211`, `:219`,
> `:220`). That is a caller/operator-supplied key verified against itself, which is the defect this
> ticket is about — so the ticket stands, with that as its `origin/main` citation and the material
> below read as the lane-local instance that surfaced it.

## The finding

`crates/snapback-kernel/src/auth/hosted_edge.rs:36` substitutes a deterministic test root for the
production hosted-admission trust root whenever `snapback-kernel/test-support` is enabled.

An adversarial review executed this against a **runnable binary**, not a test harness:

```
cargo run -p snapback --features snapback-kernel/test-support -- build-identity
  -> hostedAdmissionPublicKey: 6kpsY-...        # the test root
```

The corresponding private seed `[7; 32]` is checked into
`crates/snapback-auth/tests/hosted_admission_replay.rs:206`, and an existing regression demonstrates a
seed-7 signature installing `(5, 10)`. Since max-safe epoch and floor are valid values, that same
known signer can install `(9007199254740991, 9007199254740991)` and **permanently poison the monotone
watermark**.

Configuration validation cannot catch it: it requires equality with whichever root *that build*
selected (`crates/snapback-auth/src/auth/hosted_edge.rs:284`).

## Why this is worse than a per-row defect

**Cargo features are additive and unify across the dependency graph.** `test-support` does not have to
be enabled deliberately, or by the operator, or anywhere near this crate — it is enough that *any*
dependent anywhere in the graph enables it, and every compilation of `snapback-kernel` in that graph
gets the substituted root. The trust root is therefore selected by the build graph rather than by the
system.

This is the same additive-feature rule that has now defeated lanes on enumeration grounds four times.
The difference is the blast radius: previously it exposed a constructor, here it replaces the root of
trust with one whose private key is public.

## The mitigation that exists is not a boundary

`scripts/pack-hosted-release.mjs:773` rejects the root mismatch, so a packaged hosted release should
not ship this way. That is real and worth keeping — but it is an **external packaging check, not a
runtime-owned property**. A property enforced only by the packer is not enforced by the system, and
the claim under review was specifically that the runtime owns a fixed root.

## Direction

Preference order, per the DERIVE-over-VERIFY ruling:

1. **The production root is not substitutable by a build feature at all.** A test supplies its root to
   a test-constructed edge; nothing substitutes one globally. This removes the failure mode rather
   than detecting it.
2. Failing that, **hosted mode refuses at runtime to operate on a non-production root**, so a
   `test-support` build cannot serve hosted traffic regardless of how it was compiled.

Option 2 is a fence; option 1 is a derivation. Prefer 1.

## Related second route, same review

A signature-free durable poison route is publicly composable under `test-support`:
`ServingDatabase::adopt` → `initialize_sender_proof_after_hosted_preflight`
(`crates/snapback-kernel/src/storage.rs:1988`) → `apply_sender_replay_epoch_floor`
(`crates/snapback-kernel/src/storage/auth_sender.rs:847`). The last call opens **its own
`BEGIN IMMEDIATE`** (`storage/auth_sender.rs:131`), outside any admission-ledger or watermark
transaction — so a genuine single-transaction property elsewhere does not cover it. `i64::MAX`
advances the durable sender epoch irreversibly and breaks later stream-reset rotation, which only
updates while the epoch is below `i64::MAX`.
