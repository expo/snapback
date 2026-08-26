# Diagnostics registry harvests `SNAPBACK_*` environment-variable names as codes

- Status: Closed
- Date: 2026-08-23
- Systems: `scripts/generate-diagnostics-registry.mjs`,
  `guide/reference/diagnostics-registry.json`,
  `packages/snapback-client/diagnostic-codes.d.mts`
- Governing: LLP 0193 (errors as docs)
- Found by: grok review of the LLP 0299 landing (finding #4)

## Problem

The generator harvested every `SNAPBACK_[A-Z0-9_]+` literal in production
sources as a diagnostic code. Environment-variable names therefore appeared as
codes with sites and Guide anchors. Rust had a reviewed
`NON_DIAGNOSTIC_SNAPBACK_LITERALS` classification for its HTTP table, but the
cross-language registry had no source-site classification.

Assembling environment names so the full token never appeared as a literal was
rejected because it would hide configuration names from search and the Guide
instead of fixing the registry.

## Fix

Classify each production source site before publishing diagnostic or
environment vocabulary, retain explicit source markers for ambiguous emissions,
received vocabulary, reservations, and environment writes, and derive shipped
package sources from package manifests. Regenerate the diagnostic, type, symbol,
and Guide projections from that source-complete inventory.

## Resolution (2026-08-25)

The source classifier now distinguishes real emissions, received protocol
vocabulary, reservations, environment reads/writes/removals/declarations/table
entries/mentions, and inert references. Whole-string diagnostic literals,
`CODE:` prefixes, explicit diagnostic positions, generated executable source,
stored diagnostic SQL, delimiter-bound print/log prefixes, and explicit
emission markers remain emissions. Comments,
match arms, `matches!`, comparisons, prefix checks, and inert catalogues do
not.

Environment-name tables are bounded by their matching closing delimiter using
the existing nested bracket/brace, comment, escape, and string-aware scanner,
and are admitted only when their direct structure proves a name collection:
arrays of ordinary string literals or objects proven by ordinary string-literal
name keys or values. Only direct elements, keys, and values become table entries; nested
functions, methods, calls, objects, arrays, and template bodies never do.
Explicit emission markers win over an environment classification at the same
offset. Broad throw/error/failure/diagnostic syntax wins only for whole-string
codes or `CODE:` prefixes; a leading `SNAPBACK_*` token followed by whitespace
is prose. Proven direct environment access remains an environment site even
when nested inside broad throw syntax. The round-17 fail-first fixture is
exactly:

```js
const environment = {
  refresh() {
    throw codedError('SNAPBACK_APP_BINDING_EXPIRED');
  },
};
bindingFailure('SNAPBACK_APP_BINDING_EXPIRED');
```

Both literals are emissions and neither is an environment site. The older
direct-array-plus-following-throw delimiter fixture remains covered separately.

The round-18 correction pins the opposite precedence boundary with the exact
fail-first fixture
`throw new Error(process.env["SNAPBACK_FIXTURE_ENV"])`: it produces one
environment read and zero diagnostic emissions. Direct `process.env.X`,
`process.env["X"]`, injected `env["X"]`, Rust `var_os("X")`, and shell
`${X}`/`$X` syntax remain environment access regardless of an enclosing broad
throw heuristic; a named emission marker remains the explicit override.

Round 19 pins the adjacent prose boundary with exactly
`throw new Error('SNAPBACK_FIXTURE_ENV is required to continue')` plus
`process.env.SNAPBACK_FIXTURE_ENV`: the result is one environment mention, one
environment read, and zero diagnostics. Consequently `SNAPBACK_ADMIN_TOKEN`
and the `SNAPBACK_PUBLICATION_AUTHORITY_{PORT,INSTALLATION_ID,ORIGIN}` names
remain environment vocabulary only. Genuine dual-role names retain their
explicit code-bearing emitters, including `SNAPBACK_ACCEPTED_SOCKET_LIMIT`,
`SNAPBACK_GRAPH_EXEC_DISABLED`, `SNAPBACK_VERIFY_PROFILE_TIMEOUT`, and
`SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE`.

Round 20 restores leading `SNAPBACK_*` tokens followed by space-separated
fields when the literal is the proven first argument of Rust
`println!`/`eprintln!`, `tracing::*`/`log::*`, or JavaScript
`console.error`/`console.warn`. The generated-registry regression pins
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` at
`crates/snapback-kernel/src/live_matcher.rs:215`; the adjacent
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` read remains environment-only, and the
round-19 `throw new Error('CODE is required…')` prose boundary remains closed.
Shell `deploy_fail` and print operators retain their existing proven-emission
classification without converting known environment assignments into codes.

The Rust production mask now crosses `//` and `///` comments between a test
attribute and its item, masks `#[cfg(test)]` functions, semicolon-terminated
statements, block statements, fields, and match arms, and stops at the exact
comma/semicolon/block boundary so following production code stays visible.
This removes six test-only codes and ten test-only emitting sites. Combined
diagnostic/environment lookup pagination now slices the merged site stream
without reinserting either owner's first site: concatenated slices cover each
site exactly once, and an out-of-range slice is empty.

Round 18 also bounds Rust `matches!(...)` reference detection to the macro's
matched closing parenthesis. Five real emitters that follow completed macros
are restored: `SNAPBACK_ADMIN_LAN_TARGET_INVALID` at
`admin_link.rs:765`, `SNAPBACK_ADMIN_TAILSCALE_TARGET_UNSUPPORTED` at
`admin_link.rs:1008`, `SNAPBACK_PROFILE_FORBIDS` at `cli.rs:4464`,
`SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID` at `cli.rs:6638`, and the additional
`SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID` site at `admin.rs:696`.
Exact per-file line lists for the four reviewed codes guard the generated
registry projection.

The final round-16 correction derives each table's opener from the lexical
delimiter stack and then tests containment against that exact declaration
pair. An unmatched `{` in a table comment, a `{` inside a string value, and a
nested object before a later entry can no longer replace the declaration's
real opener; all three shapes are pinned in the boundary fixture.

Generic environment-object mutations are classified before the read fallback:
the current `delete childEnv.SNAPBACK_CLIENT_RQS_DIR` site is a removal and
`delegatedEnvironment.SNAPBACK_ADMIN_TOKEN = …` is a write. The object-boundary
fixture also retains environment entries after a `}` embedded in a string
value. `SNAPBACK_ADMIN_TOKEN` remains environment-only: the refusal sentence in
`targets/cloudflare/config-set.mjs` contributes a mention, not a diagnostic.

Manifest-derived package inventory now admits shipped `.swift` and `.kt`
files alongside JavaScript. Six native package files join the production
inventory. In particular, the generated registry retains
`SNAPBACK_AUTH_CUSTODY_EXTENSION_IO_OCCURRED` at
`packages/snapback-expo-custody/ios/SnapbackExpoCustodyCore.swift` and
`SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_IO_OCCURRED` at
`packages/snapback-expo-custody/android/src/main/java/expo/modules/snapbackcustody/SnapbackExpoCustodyModule.kt`.
The target inventory additionally admits shipped `.sh` operator carriers.
Shell classification treats `deploy_fail` and diagnostic-bearing
`echo`/`printf` sites as emissions while `${SNAPBACK_X}` and `$SNAPBACK_X`
remain environment reads. The final registry contains 12 unique
`targets/cloudflare/deploy.sh` emission codes, including
`SNAPBACK_CF_DEPLOY_APP_UNKNOWN`, `SNAPBACK_CF_DEPLOY_CREDENTIAL_MISSING`,
and `SNAPBACK_CF_DEPLOY_HEALTH_REFUSED`. The affected-proof extension list
now includes `.sh`, `.swift`, and `.kt`; its manifest rule matches only
`packages/*/package.json`.

Production Rust classification masks inline `#[cfg(test)] mod tests` regions
and standalone `#[test]` functions while preserving byte offsets and line
numbers. Consequently every `SNAPBACK_S3_TEST_*` name is absent from the
public environment union.

Received-table detection now recognizes direct
`NAME.binary_search(...)` consumers and
`is_code_member(..., NAME)` consumers in addition to
`.has`/`.includes`/`.contains`. Consequently
`CANCELLATION_CODES`, `TIMEOUT_CODES`, `OVERLOAD_CODES`, and
`CALLER_ERROR_CODES` contribute received sites without hand markers.
`SNAPBACK_INVALID_FLOAT` remains received after its marker is removed, and
`SNAPBACK_OPERATION_CANCELLED` is received through `CANCELLATION_CODES`
rather than reserved as HTTP-table-only. Seven genuine HTTP-only reservations
remain; the two other reserved sites are the historical Ibex CLI and seed
membership spellings.

The synthetic stale-artifact markers are attached to the branches that emit
them: kind spellings annotate the artifact-kind branch and version spellings
annotate the schema-version branch. Environment-only exemplars such as
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE`, `SNAPBACK_DEV_PORT`, and
`SNAPBACK_RUNTIME_BINARY` remain absent from the
diagnostic registry and `SnapbackDiagnosticCode`, while remaining present in
the environment registry and `SnapbackEnvironmentVariable`.

The final comparison with merge-base
`e370bb8f789007cffae1f4d80c4feabdedc81cb5` finds 244 removed diagnostic
names: 140 are now environment variables and 104 are other non-emitting
vocabulary. The earlier 141-name environment claim was audited in full. Only
`SNAPBACK_APP_BINDING_EXPIRED` has whole-string code-bearing emitters and was
re-typed back as a diagnostic. A delimiter-aware re-audit of the remaining 140
finds no whole-string or `CODE:` diagnostic emitter; the four leading-token
throw sentences corrected in round 19 are environment mentions.

`SNAPBACK_APP_BINDING_EXPIRED` is pinned to exactly three emitting sites:
`packages/snapback-expo/app-binding.mjs:586` and
`packages/snapback-expo/supervised-environment.mjs:595,712`. It and the five
other false Expo environment names identified in round 17 are absent from
`SnapbackEnvironmentVariable`.

The companion mixed-language fixture contains 87 raw `SNAPBACK_*` substrings.
The final registry contains 263 codes with at least
one received site and seven reservations in the server HTTP table.

The exact final measurement script was rerun after the implementation and all
generated projections were complete:

```js
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const registryPath = 'guide/reference/diagnostics-registry.json';
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const mergeBase = 'e370bb8f789007cffae1f4d80c4feabdedc81cb5';
const base = JSON.parse(execFileSync('git', ['show', `${mergeBase}:${registryPath}`], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}));
const reviewedHead = JSON.parse(execFileSync('git', ['show',
  `8bfa89fc075968fc9ad069a80371a23ea9e1f0b7:${registryPath}`,
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
const environmentKinds = {};
for (const record of Object.values(registry.environment)) {
  for (const site of record.sites) {
    environmentKinds[site.kind] = (environmentKinds[site.kind] ?? 0) + 1;
  }
}
const removed = Object.keys(base.diagnostics)
  .filter((code) => !(code in registry.diagnostics));
const environmentRemovals = removed.filter((code) => code in registry.environment);
const retypedBack = Object.keys(registry.diagnostics).filter((code) => (
  !(code in reviewedHead.diagnostics)
  && code in reviewedHead.environment
  && code in base.diagnostics
)).sort();
const fixture = readFileSync(
  'tests/fixtures/diagnostics-registry/non-emitting-reference-sites.txt', 'utf8',
);
console.log(JSON.stringify({
  mergeBase,
  counts: registry.counts,
  environmentKinds,
  mergeBaseRemovals: {
    total: removed.length,
    environment: environmentRemovals.length,
    other: removed.length - environmentRemovals.length,
  },
  retypedBack,
  fixtureRawTokens: [...fixture.matchAll(/SNAPBACK_[A-Z0-9_]+/gu)].length,
  receivedCodes: Object.values(registry.diagnostics).filter((record) => (
    record.sites.some((site) => site.kind === 'received')
  )).length,
  httpReservations: Object.values(registry.diagnostics).filter((record) => (
    record.sites.some((site) => site.kind === 'reserved'
      && site.file === 'crates/snapback-server/src/server/api_error.rs')
  )).length,
  cloudflareDeployEmissionCodes: Object.values(registry.diagnostics).filter((record) => (
    record.sites.some((site) => site.file === 'targets/cloudflare/deploy.sh'
      && site.kind === undefined)
  )).length,
  s3TestEnvironmentNames: Object.keys(registry.environment).filter((name) => (
    name.startsWith('SNAPBACK_S3_TEST_')
  )),
}, null, 2));
```

Captured output:

```json
{
  "mergeBase": "e370bb8f789007cffae1f4d80c4feabdedc81cb5",
  "counts": {
    "codes": 3533,
    "sourceFiles": 642,
    "emittingSites": 9207,
    "receivedSites": 339,
    "reservedSites": 9,
    "httpClassified": 1704,
    "guideAnchored": 426,
    "environmentVariables": 185,
    "environmentSites": 368
  },
  "environmentKinds": {
    "read": 258,
    "mention": 42,
    "declaration": 14,
    "remove": 9,
    "write": 24,
    "table-entry": 6,
    "indirect-read": 15
  },
  "mergeBaseRemovals": {
    "total": 244,
    "environment": 140,
    "other": 104
  },
  "retypedBack": [
    "SNAPBACK_APP_BINDING_EXPIRED"
  ],
  "fixtureRawTokens": 87,
  "receivedCodes": 263,
  "httpReservations": 7,
  "cloudflareDeployEmissionCodes": 12,
  "s3TestEnvironmentNames": []
}
```

### Known JS/native lookup divergence

The generated registry and JavaScript Guide wrapper expose environment-only
and dual-role names, but the embedded Rust CLI/MCP lookup does not yet consult
the registry's `environment` section and mislabels received/reserved sites as
emissions. This closed ticket does not claim native parity; the exact Rust
change and parity tests are tracked in
`issues/20260825-native-guide-lookup-registry-kinds-parity.md`.
That ticket also records the v1 schema obligation: diagnostic `sites` entries
now carry optional `kind`, and native must read it rather than treating every
site as an emission.
