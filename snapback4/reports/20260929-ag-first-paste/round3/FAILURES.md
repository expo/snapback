# Round 3 failure attribution

## Detecting controls — ours, intentional and restored

- `pre-fix-detecting.log`: against round 2's helper and residency code,
  `upsert_advice_withholds_expiring_and_optional_result_images`,
  `upsert_advice_keeps_hidden_writable_targets`, and
  `upsert_advice_withholds_private_incomplete_defaulted_and_inherited_expiry_images`
  fail because unsafe advice is offered. Four selected tests pass.
- `mutant-key-change.log`: disabling the addressed-key-change guard fails
  `upsert_advice_withholds_key_changing_patches` on the stable `principal: other`
  patch. This is the detecting test requested by finding 2.
- `mutant-expiry.log`: disabling the expiry guard fails
  `upsert_advice_withholds_expiring_and_optional_result_images` on required
  expiresAt. The optional-field guard cannot mask this control.
- `mutant-optional.log`: disabling the optional-image guard fails that test
  on omitted extra after both expiry cases pass.
- `mutant-private.log`: disabling the unconditional-read gate fails
  `upsert_advice_keeps_hidden_writable_targets`.

All mutations were restored. `first-paste-final.log` and `affected-final.log`
pass all 17 first-paste regressions. No intentionally disabled guard is committed.

## Development/setup failures — ours, corrected

- `pre-fix.log`: the initial public-parent test fixture retained the private
  aggregate's inferred sync audience. This causes E_SYNC in the positive,
  expiry/optional, key-change and effectful-input tests. Removed that unrelated
  aggregate from the new public fixture. The private-image withholding failure
  in the same run is a real round-2 regression, confirmed separately above.
- `fixed-initial.log`: the defaulted fixture used `int = 7` instead of
  `int default 7`; the positive effect assertion assumed oldest-first outbox
  ordering. Corrected the spelling and asserted the current result appears in
  the complete compared effect list. Both now pass.
- `affected-lang-guide.log`: mistyped test target `lowering_differential`;
  corrected to `lowering`. `affected-lang-guide-2.log` passes 1 compatibility,
  16 then-current first-paste, 99 guide, 11 lowering and 41 residency tests.
- An optional guide-sentence edit initially used a root-relative path with
  snapback4 as cwd and raised FileNotFoundError without changing any file.
  Applied the edit from the repository root. The same shell then started the
  one requested full-suite invocation; it was not restarted. Final guide
  qualification is in `affected-final.log`.

The missing local llp-orient submodule link was handled by reading the existing
lane PF copy. The machine-fleet file is absent here; verification uses this warm
Linux lane. These read-only environment limitations did not fail a product test.

## Full suite

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1387 s
```

Every stage passed. Rust: **274 binaries / 987 executions**. Client tests:
**4,561 passed / 10 declared skips / 0 failed** across eight processes.
Client models: **79 passed / 0 failed**. Full-suite failures: **ours 0,
baseline 0, environmental 0**. Expected authentication refusals in the model
log are negative-case observations, not failed tests. The inherited 60-second
suite target remains missed; no timeout, ceiling or test count was reduced.
