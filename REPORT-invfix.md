# Inventory-fix report

## Restored

- Restored `generate-check.test.mjs` in the `@expo/snapback-cli`
  `expectedFiles` list, in alphabetical position between
  `fake-expo-push.test.mjs` and `hosted-admission-producer.test.mjs`.
- Confirmed `packages/snapback-cli/package.json` already invokes
  `generate-check.test.mjs` exactly once, so it was not changed.
- The audited on-disk maintained-test total is 263 (and already includes this
  test), so corrected the stale `expectedTotal` from 256 to 263. Existing
  changelog comments were left intact.

## Verification tails

Scoped CLI inventory proof (exit 0):

```text
[invfix-scoped] @expo/snapback-cli PASS: 23 maintained test files; generate-check registered and declared exactly once
```

`node scripts/check-package-test-inventory.mjs` does not reach its final PASS
because the merged tree has additional, out-of-charter inventory losses (exit
1):

```text
AssertionError [ERR_ASSERTION]: @expo/snapback-client maintained test IDs/count changed; review and update the canonical inventory
actual: { unexpected: [ 'reference-kind.test.mjs' ], missing: [] }
expected: { unexpected: [], missing: [] }
```

`node scripts/check-inventories.mjs` package-test section (exit 1):

```text
[check-inventories] FAIL package-test
  @expo/snapback-client unexpected on disk: reference-kind.test.mjs
  @expo/snapback-codegen unexpected on disk: client-lifecycle.test.mjs, handler-graph-parity.test.mjs, handler-runtime-profile.test.mjs, semantic-generation-golden.test.mjs, semantic-generation-rotation.test.mjs
  @expo/snapback-codegen absent from package scripts: client-lifecycle.test.mjs, handler-graph-parity.test.mjs, handler-runtime-profile.test.mjs, semantic-generation-golden.test.mjs, semantic-generation-rotation.test.mjs
```

Those six entries require edits beyond the CLI-only repair authorized by
`INVFIX-CHARTER.md`, including `packages/snapback-codegen/package.json`; they
were therefore reported rather than changed or bypassed.
