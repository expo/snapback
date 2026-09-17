# Snapback 4: four `worker.test.mjs` lost-effect-lease tests are red on `main`

**Priority:** P2
**Status:** Resolved
**Date:** 2026-09-17
**Scope:** `snapback4/packages/snapback4/test/worker.test.mjs` ("lost effect lease on the wire reports queued / failed / sent / running"), `snapback4/crates/snapback4-core/src/engine/effects.rs`, `snapback4/packages/snapback4/src/worker.ts`

At `12c64165b0` (unmodified `main`, verified in a clean detached worktree after
`cargo build --workspace` and the package build):

```text
node --test --test-name-pattern='lost effect lease' packages/snapback4/test/worker.test.mjs
ℹ tests 14   ℹ pass 10   ℹ fail 4
```

Each of the four asserts, at `worker.test.mjs:465`,

```js
assert.match(refused.message, new RegExp(`is ${state} and not claimed by this worker`));
```

and receives the newer, state-free refusal from `effects.rs:126`:

```text
E_EFFECT_LEASE: effect effect-… is not held by this live claim; claim it first and use its current token
```

The state-specific message still exists at `effects.rs:293`, but the live-claim
check now refuses first. The effect files last changed in `c872a3e3d1`
("add strict effect steps") and `6d893cac8f` ("repair effect admission
invariants"), both landed 2026-09-17 11:21 PDT; the four tests passed in the
full-suite run on `614898e9a7` the same morning.

This is more than test wording: `packages/snapback4/src/worker.ts:140`
synthesizes `effect … is queued and not claimed by this worker; claim it first`
and the test at `worker.test.mjs:486` expects the same family of message for
every state, so the worker's reporting of a lost lease may now carry a message
whose state it can no longer learn from the wire. Decide which message the wire
carries when the claim is not live — state-specific, or the live-claim one with
the state as a separate field — then align `worker.ts` and the four tests.

Found by the device-diet S5 landing's full-suite run, which was otherwise green
(Rust 0 failures; client 669 of 676 with these 4 the only failures). S5 touches
no effect code; the failure reproduces without it.

## Resolution — 2026-09-17

B3b keeps the live-claim refusal opaque. The worker preserves that actual
error, normalizes its code prefix once, and does not infer a queued or
terminal state or issue an extra status read. The four wire assertions now
pin that contract. This was an introduced Bwork2 regression, not an inherited
S5 or fixture-server failure.

Final source `42ce2d9f563bfba6fa8bd357920b3e7ca2e4ad80` passed the complete
worker file, 32/32, against freshly built output, including these four
actual-wire cases. Both independent final Sol and Grok source reviews are
READY. See the [qualification and retained failures](../../snapback4/reports/20260917-bwork3b.md).
