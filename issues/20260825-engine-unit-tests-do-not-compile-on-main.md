# The engine unit-test cell does not compile on main

Status: open
Date: 2026-08-25
Systems: snapback-engine, Testing
Related: issues/20260825-the-two-inherited-reds-every-lane-re-derives.md

## The defect

`crates/snapback-engine/src/local/tests/engine.rs` invokes a test for a variant that does not exist:

```rust
oauth_consent_begin_case_test!(
    oauth_consent_request_derives_the_durable_user_from_authority_absent_user,
    OAuthConsentBeginCase::AbsentUser
);
```

The enum has four variants and no `AbsentUser`:

```rust
enum OAuthConsentBeginCase { FirstExact, SecondExact, ThirdExact, WrongSource }
```

Introduced by `711a77bd8a` ("test(auth): split OAuth consent matrices by case"), which is an ancestor
of current `origin/main`. No commit reachable from any ref defines the variant, so the reference has
been dangling since it landed — this is an incomplete change, not a regression from a later merge.

## Why it is worth a ticket rather than a quiet fix

**It blocks the engine unit-test cell for every lane.** Three separate lanes have reported it
independently, each correctly classifying it as inherited and moving on:

- the F170 lane, blocked from running engine unit tests
- the authority-descriptor lane, "unit-test compilation remains blocked by the inherited
  `OAuthConsentBeginCase::AbsentUser` reference, also present on current `origin/main`"
- the service-fence review, which distinguished it from two failures that lane *had* introduced

So it is costing every lane its engine unit-test signal, and each one is spending effort attributing it.

## Why I am not fixing it inline

Restoring the variant means choosing what the case asserts: which `user_id` is absent, which
`expected_error` code an absent user produces, and whether it belongs in
`OAUTH_CONSENT_BEGIN_L_SHAPE`. The surrounding test asserts an exact durable snapshot is unchanged on
refusal, so a guessed error code would produce a test that passes for the wrong reason — which is the
failure mode this programme has spent the day eliminating.

The alternative — deleting the invocation — would silently drop coverage the authoring session intended.

## What is needed

Whoever owns `711a77bd8a` should add the variant with its intended semantics: `name()`, `user_id()`,
`session_id()`, `oauth_state()`, `source()`, and an `expected_error()` returning the code an absent
user actually produces. It is a small change; it just needs the author's intent rather than a
plausible-looking guess.

## Correction, 2026-08-25: it is six errors, not one

This ticket originally recorded a single dangling reference. That was **incomplete** — measured with
`cargo check -p snapback-engine --tests` on a clean checkout of `origin/main`, the target fails with
**six errors from at least three independent causes**:

| Location | Error | Cause |
| --- | --- | --- |
| `crates/snapback-engine/src/local/engine.rs:9764` | `E0624` `create_agent_principal` is private | a narrowing of kernel visibility that a caller was not migrated for |
| `crates/snapback-engine/src/local/engine.rs:9777` | `E0624` `issue_initial_agent_credential` is private | same |
| `crates/snapback-engine/src/local/tests/engine.rs:31427` | `E0599` `OAuthConsentBeginCase::AbsentUser` | the originally-recorded dangling variant |
| `crates/snapback-engine/src/local/tests/engine.rs:42786` | `E0599` `LiveInvalidationIssuer::with_authenticator` | an issuer API change; **possibly the q43 landing**, which reworked issuer construction and authenticated-authorization advance |
| `crates/snapback-engine/src/local/tests/engine.rs:42589` | `E0502` cannot borrow `database_a.admission` | a borrow shape that a signature change invalidated |
| `crates/snapback-engine/src/local/tests/engine.rs:42664` | `E0502` cannot borrow `database.admission` | same |

**Why the under-count mattered.** Six lanes have now reported "engine unit tests do not compile on
main" as the reason their full test target could not run, and each was told it was one inherited
dangling reference. Disabling that one reference removes exactly one of six errors and unblocks
nothing. Any lane that tried it would have wasted the attempt.

**On the `AbsentUser` variant specifically**: it is deliberately still not implemented. The case needs
a `user_id`, a durable seeding shape and an `expected_error`, and inventing them produces a test that
passes for the wrong reason. The other four cases derive the durable user from the authority, and
`WrongSource` is the only refusing case, expecting `SNAPBACK_AUTH_REQUIRED` for an `HttpMutation`
source. Whoever restores it should supply the intent, not guess it.

**Priority.** This blocks full-target verification for every lane in the LLP 0283 F-1 programme, so
lanes have been landing on affected-scope tests plus separately-executed regressions. That is
acceptable under LLP 0189 but it is a standing tax, and the two `E0624` errors are in **production**
`engine.rs`, not in test code — those deserve a look on their own merits.
