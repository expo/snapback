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
emission markers win over an environment classification at the same offset;
broad throw syntax does not override proven direct environment access.
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

Round 18 adds the exact inverse-boundary fixture
`throw new Error(process.env["SNAPBACK_FIXTURE_ENV"])`, which must yield one
environment read and zero diagnostics. It also binds Rust `matches!(...)`
reference detection to the macro's matched closing parenthesis. This restores
five production emitters following completed macros, including the four
reviewed sites at `admin_link.rs:765,1008` and `cli.rs:4464,6638`; the fifth is
`admin.rs:696`. The round-19 projection contains 9,216 emitting sites after
whitespace-delimited prose is excluded.

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
the same object. `SNAPBACK_ADMIN_TOKEN` remains environment-only: the refusal
sentence in `targets/cloudflare/config-set.mjs` contributes a mention, not a
diagnostic emission.

Round 19 restricts diagnostic-leading literals to a whole-string code or a
`CODE:` prefix. Its fail-first fixture is exactly
`throw new Error('SNAPBACK_FIXTURE_ENV is required to continue')` plus
`process.env.SNAPBACK_FIXTURE_ENV`, producing one mention, one read, and zero
diagnostics. `SNAPBACK_ADMIN_TOKEN` and the three
`SNAPBACK_PUBLICATION_AUTHORITY_{PORT,INSTALLATION_ID,ORIGIN}` names therefore
stay environment-only. Explicit code-bearing dual-role sites remain intact,
including `SNAPBACK_ACCEPTED_SOCKET_LIMIT`, `SNAPBACK_GRAPH_EXEC_DISABLED`,
`SNAPBACK_VERIFY_PROFILE_TIMEOUT`, and
`SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE`.

Round 20 admits a leading diagnostic followed by space-separated fields only
when it is the proven first argument of Rust `println!`/`eprintln!`,
`tracing::*`/`log::*`, JavaScript `console.error`/`console.warn`, or the
existing shell emission operators. The generated projection pins
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` at
`crates/snapback-kernel/src/live_matcher.rs:215`, while
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` remains environment-only and ordinary
`throw new Error('CODE is required…')` prose remains non-emitting.

The Rust test-region mask now skips intervening `//`/`///` comments and covers
`#[cfg(test)]` functions, statements, blocks, fields, and match arms. Its
comma/semicolon/block terminators are fixture-pinned so the next production
site is never swallowed. Six test-only codes and ten test-only emitting sites
leave the production projection. Combined diagnostic/environment pagination
no longer reinserts an absent owner's first site; exact concatenated coverage
and empty out-of-range slices are both asserted.

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
the merge-base carrier files. Only `SNAPBACK_APP_BINDING_EXPIRED` has
whole-string code-bearing emitters and was re-typed back as a diagnostic. The
other 140 remain environment removals. A delimiter-aware pass over every
carrier finds no whole-string or `CODE:` diagnostic emitter among those 140;
the four round-19 throw sentences are environment mentions.

The canonical embedded measurement was rerun after the final implementation and
projection regeneration. Its captured output is:

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
That ticket explicitly records that v1 diagnostic `sites` entries now carry an
optional `kind` field and native must consume it.
