# Diagnostics registry scrapes environment-variable names

**Status:** Closed
**Date:** 2026-08-25
**Systems:** Diagnostics, Guide, Packaging
**Related:** LLP 0193, `scripts/generate-diagnostics-registry.mjs`,
`crates/snapback-kernel/src/live_matcher.rs`, canonical ticket
`issues/closed/20260823-diagnostics-registry-harvests-env-names.md`

## Symptom

The diagnostics registry treated every production `SNAPBACK_*` token as an
emitting site. That included the environment-variable read
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` in `live_matcher.rs`, even though
the diagnostic emitted by that branch is
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH`.

The environment-variable name consequently leaked into the generated registry,
Guide projection, and public `SnapbackDiagnosticCode` TypeScript union as if
it were a diagnostic code.

## Required fix

Classify source sites before adding them to the registry. Environment-variable
reads and unambiguous comparison/reference-only sites must not count as
emissions. Preserve explicit markers for syntax the classifier cannot prove,
and guard the classifier with fixtures that retain real emissions next to
excluded references.

## Resolution (2026-08-25, superseded by canonical ticket)

The final classifier separates emissions, received protocol vocabulary,
reservations, environment sites, and references. Environment-name tables are
now proven direct-string collections: arrays contain only direct ordinary
string literals, and objects are proven by direct string-literal name keys or
values. Tokens inside nested functions, methods,
calls, objects, arrays, or template bodies are never table entries. Explicit
emission syntax wins over an environment classification at the same offset.
The round-17 fail-first fixture is exactly:

```js
const environment = {
  refresh() {
    throw codedError('SNAPBACK_APP_BINDING_EXPIRED');
  },
};
bindingFailure('SNAPBACK_APP_BINDING_EXPIRED');
```

Both literals are emissions and neither is environment vocabulary. The older
delimiter-boundary fixture remains: a direct name array followed by a throw
retains the array entry and the real diagnostic separately.

The final round-16 correction binds environment-name tables to the opener
found for their declaration by the lexical delimiter stack. Comment braces,
string braces, and nested values before later entries are all regression
fixtures. Target discovery now includes `.sh`; shell-aware classification
retains 12 unique `deploy_fail` diagnostics from
`targets/cloudflare/deploy.sh` and separates `${SNAPBACK_X}`/`$SNAPBACK_X`
reads. Inline `#[cfg(test)]` modules and `#[test]` functions are excluded from
Rust production classification, leaving every `SNAPBACK_S3_TEST_*` name out
of `SnapbackEnvironmentVariable`. The affected-source selector covers `.sh`,
and the package-manifest rule is restricted to `packages/*/package.json`.

Generic environment-object mutations are classified before the read fallback:
the current `delete childEnv.SNAPBACK_CLIENT_RQS_DIR` site is a removal and
`delegatedEnvironment.SNAPBACK_ADMIN_TOKEN = …` is a write. The environment
object fixture also keeps entries after a `}` embedded in a string value inside
the same object. `SNAPBACK_ADMIN_TOKEN` is dual-role: those environment sites
remain, while the refusal in `targets/cloudflare/config-set.mjs` is restored as
a diagnostic emission.

Package manifests now contribute shipped `.swift` and `.kt` sources, and
the local-proof selection rule covers both extensions. Existing native custody
emitters are pinned to their real files:
`SNAPBACK_AUTH_CUSTODY_EXTENSION_IO_OCCURRED` in
`SnapbackExpoCustodyCore.swift` and
`SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_IO_OCCURRED` in
`SnapbackExpoCustodyModule.kt`.

Received-table detection recognizes `.has`, `.includes`, `.contains`,
`.binary_search`, and `is_code_member(..., NAME)` consumers. The four
error-tracking classifier tables now contribute received sites without hand
markers. `SNAPBACK_INVALID_FLOAT` remains received, and
`SNAPBACK_OPERATION_CANCELLED` is received through `CANCELLATION_CODES`;
neither is HTTP-table-only. The open deletion-review ticket therefore lists
seven genuine HTTP-only reservations, not nine.

`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the diagnostic registry
and `SnapbackDiagnosticCode`, but remains in the environment registry and
`SnapbackEnvironmentVariable`. `SNAPBACK_APP_BINDING_EXPIRED` has three
emitting sites (`app-binding.mjs:586` and
`supervised-environment.mjs:595,712`) and is absent from
`SnapbackEnvironmentVariable`. The five other false Expo environment names
identified in round 17 are also absent from that type.

The complete earlier 141-name environment-removal claim was re-audited against
the merge-base carrier files. Five names have real emitters and were re-typed
back as diagnostics:

- `SNAPBACK_ADMIN_TOKEN`
- `SNAPBACK_APP_BINDING_EXPIRED`
- `SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID`
- `SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN`
- `SNAPBACK_PUBLICATION_AUTHORITY_PORT`

The other 136 remain environment removals. An independent syntax-context pass
over all 136 and every carrier file recorded at merge base found zero remaining
throw/error/failure/diagnostic/code-assignment emitter candidates.

The canonical embedded measurement was rerun after the final implementation and
projection regeneration. Its captured output is:

```json
{
  "mergeBase": "e370bb8f789007cffae1f4d80c4feabdedc81cb5",
  "counts": {
    "codes": 3543,
    "sourceFiles": 642,
    "emittingSites": 9216,
    "receivedSites": 339,
    "reservedSites": 9,
    "httpClassified": 1709,
    "guideAnchored": 428,
    "environmentVariables": 185,
    "environmentSites": 364
  },
  "environmentKinds": {
    "read": 258,
    "mention": 38,
    "declaration": 14,
    "remove": 9,
    "write": 24,
    "table-entry": 6,
    "indirect-read": 15
  },
  "mergeBaseRemovals": {
    "total": 234,
    "environment": 136,
    "other": 98
  },
  "retypedBack": [
    "SNAPBACK_ADMIN_TOKEN",
    "SNAPBACK_APP_BINDING_EXPIRED",
    "SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID",
    "SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN",
    "SNAPBACK_PUBLICATION_AUTHORITY_PORT"
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
