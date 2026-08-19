# Caught denial with an unrelated failure used a stale public-message assertion

**Status:** Resolved
**Filed:** 2026-08-19
**Resolved:** 2026-08-19
**Systems:** Runtime, Actions, Auth, Testing
**Source:** LLP 0283 F-4 final-workspace test triage
**Related:** LLP 0053, `7437e6e07`, `a8787cb53`,
`pre-0276-rearchitecture` (`c66d8ea6f`)

## Failure

`caught_denial_with_unrelated_failure_is_not_restored` received the intended
`SNAPBACK_HANDLER_FAILED`, but its second assertion expected the handler's raw
message in public `diagnostic.details.message`. Direct and production-default
handler execution now redacts those details, so the observed value was absent.

## Attribution

**Pre-existing, not introduced by the carve or the security hardening.**

- `git log -S` and `git blame` attribute the test and its witness semantics to
  `7437e6e07` (2026-08-01).
- `a8787cb53` (2026-08-09) made direct handler failures redacted by default and
  exposed raw handler error detail only through the explicit development
  exposure seam. It did not update this older assertion.
- The rollback tag `pre-0276-rearchitecture` at `c66d8ea6f` already contains
  that redaction behavior. A scratch-checkout run of the exact test at the tag
  failed identically: the code assertion passed and the message assertion saw
  `""` instead of `"unrelated failure after catching the denial"`.
- The carve moved the test and split `runtime.rs` without changing these
  semantics. The named hardening commit `7d8ffe524` changed only rustfmt layout
  in `host_glue.rs` around an unrelated membership-writer constructor.

## Resolution

Run this assertion through the existing thread-local
`with_development_handler_error_exposure` test seam. The test still proves that
the caught denial is not restored—the final code is `SNAPBACK_HANDLER_FAILED`,
not `SNAPBACK_AUTH_PERMISSION_DENIED`—and can deliberately inspect the unrelated
handler message without weakening production-default redaction.

`cargo test -p snapback --test action_denial_witness_v0` passes all four tests.
