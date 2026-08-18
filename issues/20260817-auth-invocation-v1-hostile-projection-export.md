# `auth_invocation_v1` hostile auth projection test loses its handler export

**Status:** Open
**Filed:** 2026-08-17
**Systems:** Auth, Runtime, Testing
**Related:** LLP 0214,
`issues/closed/20260817-rust-tests-gate-red-auth-invocation-v1.md`, `df1449a46`

## Finding

After the integration target compiled again,
`handler_projection_is_exact_null_prototype_and_deep_frozen` failed with:

```text
SNAPBACK_HANDLER_EXPORT_MISSING: undefined is not registered
```

The failure occurs before the assertions that the hostile module cannot forge
or loosen `ctx.auth`. Commit `df1449a46` called this failure pre-existing, but
no open filesystem ticket names it. On the repaired target the exact run is 2
passed / 3 failed; this is the non-LLP-0264 failure among the three.

## Required repair

Determine which hostile built-in replacement causes handler registration or
export selection to become `undefined`, then preserve both runtime export
resolution and the intended captured-intrinsics security proof. Do not weaken
the test by removing an adversarial replacement without proving that the
replacement is outside the supported threat model.

## Acceptance

- The selected hostile-projection test reaches and passes all projection shape,
  frozen-state, own-data, and inherited-pollution assertions.
- Handler export selection remains host-owned under the same adversarial source.
- A focused regression identifies the built-in mutation that previously turned
  the selected export into `undefined`.
