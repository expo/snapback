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
