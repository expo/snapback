# `auth_invocation_v1` hostile auth projection test loses its handler export

**Status:** Resolved
**Filed:** 2026-08-17
**Resolved:** 2026-08-19
**Systems:** Auth, Runtime, Testing
**Related:** LLP 0009, LLP 0214,
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

## Resolution

The exact replacement was:

```javascript
JSON.parse = function() {
  return { userId: 'forged-user', roles: ['forged'] };
};
```

The module did register `projectionQuery`. The per-invocation IIFE ran after the
application source and decoded the host's serialized invocation through the
then-reachable `JSON.parse`. The forged object omitted `export`, so the later
lookup selected `undefined` and produced `SNAPBACK_HANDLER_EXPORT_MISSING`.

The bootstrap now installs sealed `__snapbackDispatch` before application
source evaluates. It decodes the single invocation payload through the already
captured `trustedJsonParse`, selects the export and other host fields there,
and delegates to the existing captured-intrinsic settlement path. The fixed
invocation tail calls that helper. No hostile replacement was removed or
softened, so the original test still attacks projection construction while
host-owned export selection survives the same source.

The focused
`hostile_json_parse_replacement_cannot_erase_host_selected_export` regression
replaces only `JSON.parse`, registers `projectionQuery`, and proves that the
host-selected export still runs with the authentic projected user ID. Before
the repair, the original selected test was 0 passed / 1 failed and the owning
integration target was 4 passed / 1 failed at this branch base. After the
repair, the selected test is 1 passed / 0 failed, the focused regression is 1
passed / 0 failed, and the owning integration target is 6 passed / 0 failed.

The originally requested `-p snapback-engine` filters select no tests because
this integration target belongs to package `snapback`; both literal commands
report 0 passed / 0 failed / 456 filtered out. The owning-package commands above
make the security proof execute.
