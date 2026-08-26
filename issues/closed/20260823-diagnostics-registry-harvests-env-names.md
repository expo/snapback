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
entries/mentions, and inert references. Diagnostic-leading strings, explicit
diagnostic positions, generated executable source, stored diagnostic SQL,
print/log macros, and explicit emission markers remain emissions. Comments,
match arms, `matches!`, comparisons, prefix checks, and inert catalogues do
not.

Environment-name tables are bounded by their matching closing delimiter using
the existing nested bracket/brace, comment, escape, and string-aware scanner.
The fail-first fixture is exactly:

```js
const SNAPBACK_ENVIRONMENT_NAMES = ['SNAPBACK_FOO_ENV']; throw new Error('SNAPBACK_REAL_FAILURE');
```

It retains only `SNAPBACK_FOO_ENV` as a table entry and
`SNAPBACK_REAL_FAILURE` as an emission.

The final round-16 correction derives each table's opener from the lexical
delimiter stack and then tests containment against that exact declaration
pair. An unmatched `{` in a table comment, a `{` inside a string value, and a
nested object before a later entry can no longer replace the declaration's
real opener; all three shapes are pinned in the boundary fixture.

Generic environment-object mutations are classified before the read fallback:
the current `delete childEnv.SNAPBACK_CLIENT_RQS_DIR` site is a removal and
`delegatedEnvironment.SNAPBACK_ADMIN_TOKEN = …` is a write. The object-boundary
fixture also retains environment entries after a `}` embedded in a string
value.

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
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE`, `SNAPBACK_ADMIN_TOKEN`,
`SNAPBACK_DEV_PORT`, and `SNAPBACK_RUNTIME_BINARY` remain absent from the
diagnostic registry and `SnapbackDiagnosticCode`, while remaining present in
the environment registry and `SnapbackEnvironmentVariable`.

The final comparison with merge-base
`e370bb8f789007cffae1f4d80c4feabdedc81cb5` finds 239 removed diagnostic
names: 141 are now environment variables and 98 are other non-emitting
vocabulary. The companion mixed-language fixture contains 87 raw
`SNAPBACK_*` substrings. The final registry contains 262 codes with at least
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
const environmentKinds = {};
for (const record of Object.values(registry.environment)) {
  for (const site of record.sites) {
    environmentKinds[site.kind] = (environmentKinds[site.kind] ?? 0) + 1;
  }
}
const removed = Object.keys(base.diagnostics)
  .filter((code) => !(code in registry.diagnostics));
const environmentRemovals = removed.filter((code) => code in registry.environment);
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
    "codes": 3538,
    "sourceFiles": 642,
    "emittingSites": 9196,
    "receivedSites": 338,
    "reservedSites": 9,
    "httpClassified": 1709,
    "guideAnchored": 426,
    "environmentVariables": 191,
    "environmentSites": 390
  },
  "environmentKinds": {
    "read": 258,
    "mention": 56,
    "declaration": 14,
    "remove": 9,
    "write": 18,
    "table-entry": 20,
    "indirect-read": 15
  },
  "mergeBaseRemovals": {
    "total": 239,
    "environment": 141,
    "other": 98
  },
  "fixtureRawTokens": 87,
  "receivedCodes": 262,
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
