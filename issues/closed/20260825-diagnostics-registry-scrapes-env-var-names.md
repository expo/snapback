# Diagnostics registry scrapes environment-variable names

**Status:** Closed
**Date:** 2026-08-25
**Systems:** Diagnostics, Guide, Packaging
**Related:** LLP 0193, `scripts/generate-diagnostics-registry.mjs`,
`crates/snapback-kernel/src/live_matcher.rs`, intermediate evidence ticket
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

## Canonical resolution (2026-08-25)

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
reviewed sites at `admin_link.rs:765,1008` and `cli.rs:4467,6641`; the fifth is
`admin.rs:696`. The historical round-19 intermediate projection contained
9,216 emitting sites after whitespace-delimited prose was excluded; that
figure is superseded by the final count table below.

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

Round 21 replaces filename guesses with a transitive Rust external-module
walk. It resolves both `#[cfg(test)] mod tests;` through Rust's `x.rs` /
`x/mod.rs` rules and `#[cfg(test)] #[path = "..."] mod x;`, then inherits the
test-only context through ordinary child modules. Twenty-two external test
files are discovered. Four formerly published test-only emitting sites leave
the registry: `SNAPBACK_AUTH_MODE_PENDING` and
`SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT` in
`local/admission_fence_tests.rs`, plus two
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` sites in
`local/auth_room_kick_acceptance.rs`. No code leaves the union because each
code has production emitters elsewhere.

Whole-string constants now publish `kind: "declaration"` at the literal and
identifier-flow publishes the call/property/shorthand coordinate that actually
emits it. The final registry has 167 declaration sites across 140 codes; 137
pre-existing codes move off a declaration coordinate to at least one real use
site, including `SNAPBACK_APP_READINESS_DECLARATION_INVALID` from
`operational_readiness.rs:27` to its `SnapbackError::error(...)` call at line
617. Sixty-three of those codes had no other emitting coordinate in the
round-20 registry.

Nine cross-file, Rust-format-interpolation, or otherwise non-local flows need
explicit synthetic emission markers at their real uses:

- `SNAPBACK_FORK_WRITER_COVERAGE_GAP`
- `SNAPBACK_IBEX_CARGO_NOT_FOUND`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_CLOSURE_INVALID`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_IDENTITY_UNQUALIFIED`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_SUITE_UNQUALIFIED`
- `SNAPBACK_RESUME_JOURNAL_FLOOR`
- `SNAPBACK_RESUME_POLICY_REPLACED`
- `SNAPBACK_RESUME_WITNESS_REPLAY_DIVERGED`
- `SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH`

The explicitly dead-code stable spellings `SNAPBACK_RESUME_BUDGET_EXCEEDED`
and `SNAPBACK_RESUME_RATE_LIMITED` are retained honestly as reservations, not
fabricated emissions. Scanning the real `runtime-link-smoke.mjs` operator use
also adds its seven previously omitted diagnostics:
`SNAPBACK_IBEX_CARGO_BUILD_FAILED`, `SNAPBACK_IBEX_RUNTIME_LINK_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED`, `SNAPBACK_IBEX_RUNTIME_LINK_OK`,
`SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED`,
`SNAPBACK_IBEX_RUNTIME_LINK_TARGET_NOT_OWNED`, and
`SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`.

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

Round 22 restricts declaration-to-identifier flow to proven diagnostic
positions: a throw, a known diagnostic constructor/helper, a diagnostic-code
property/shorthand, or the first argument of a diagnostic print/log operator.
Membership calls such as `allowed.includes(LOCAL_CODE)`, `.has`, and
`.contains`, ordinary comparisons, catalogues, and match arms no longer become
emissions merely because the argument is a diagnostic constant. The two live
false positives leave the projection:

- `packages/snapback-cli/index.mjs:7276` —
  `DECLARATION_SUGGESTION_REASON_CODES.includes(code)`;
- `crates/snapback-types/src/auth/mode.rs:428` — the
  `Some(PASSWORD_PROVIDER_REQUIRES_V4_CODE)` coherence comparison.

The 137 round-21 identifier-flow-resolved codes were re-audited before
regeneration. Twenty-eight would have lost their only proven emitter under the
new rule, so each now has an explicit synthetic marker at one real custom
emission use; no code was dropped:

- `SNAPBACK_AUTH_BARRIER_PHASE_CLOSURE_RETRY`
- `SNAPBACK_BUNDLE_ENTRY_INVALID`
- `SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED`
- `SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH`
- `SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH`
- `SNAPBACK_BUNDLE_LIMIT_QUERIES`
- `SNAPBACK_BUNDLE_PENDING_CAPACITY`
- `SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED`
- `SNAPBACK_DECLARATION_SUGGESTION_STALE`
- `SNAPBACK_FORK_ADMISSION_TIMEOUT`
- `SNAPBACK_FORK_APP_BINDING_MISMATCH`
- `SNAPBACK_FORK_APP_BINDING_REQUIRED`
- `SNAPBACK_FORK_ASSET_CUT_INCOMPLETE`
- `SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED`
- `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH`
- `SNAPBACK_FORK_NET_DIFF_UNAVAILABLE`
- `SNAPBACK_FORK_RENEW_EXPIRED`
- `SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED`
- `SNAPBACK_FORK_SERVER_EXPIRED`
- `SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED`
- `SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT`
- `SNAPBACK_RESUME_WITNESS_INVALID`
- `SNAPBACK_RESUME_WITNESS_OVERSIZE`
- `SNAPBACK_VECTOR_CORPUS_BOUND`
- `SNAPBACK_VECTOR_MAINTENANCE_LIMIT`
- `SNAPBACK_VECTOR_VALUE_INVALID`
- `SNAPBACK_VECTOR_WORK_LIMIT`
- `SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_WRITE_FAILED`

Dual-role classification is now site-specific. A spelling's environment role
elsewhere no longer suppresses an identifier emission or a protocol receive
table. `SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT` consequently keeps its three real
emitters, gains the `OVERLOAD_CODES` site as `received`, keeps its Cloudflare
environment read, and no longer records either the receive table or HTTP match
arm as an environment mention. Proven environment-key allowlists remain
environment `table-entry` sites rather than becoming received diagnostics.

The JavaScript exact-lookup formatter now renders the 167 declaration sites in
a `Declaration sites:` group. The native-parity follow-up explicitly includes
that fourth diagnostic site kind alongside emitting, received, and reserved
sites.

Round 23 recognizes zero-hash Rust raw and raw-byte strings (`r"…"` and
`br"…"`). The fail-first fixture ends each raw string with a backslash and
then emits a real diagnostic; before the fix the scanner returned zero sites,
and after the fix it retains both. The hosted-target partial-credential path
also replaces role-name interpolation with a private exhaustive six-role code
mapping. That adds the grammar-valid `CONTROL_STATE` spelling without changing
the closed role/action policy.

Round 25 closes the remaining classifier and surface-review findings. A
semicolon-less JavaScript `throw` now stops at the first ASI boundary where its
balanced expression is complete; the inverse fixture keeps a following
`.includes(CODE)` reference non-emitting. Delimiter matching reuses the
JavaScript tokenizer's exclusions for strings, comments, regex literals, and
template literals, so `/}/` inside an environment helper cannot truncate the
helper body. Rust identifier flow recognizes error-producing `ok_or`,
`ok_or_else`, `map_err`, `Err`-returning `unwrap_or_else` closures, and
`.context(...)`, while `matches!(..., Err(code::X))` remains a reference.

Synthetic marker sites are suppressed when identifier flow proves the same
code on the same statement, and registry sites are unique by `code@file:line`.
The eight redundant markers on direct `return Err(code::...)` /
`return Err(refusal::...)` statements were removed; markers on custom helpers
and dynamic throws remain. The Tigris partial-code mapping and credential-pair
helper are private again, with the six pairs and the registered unknown-role
refusal pinned through a non-executing module-text seam. Finally, a depth-zero
`}` terminates a Rust test-attributed region, so a production diagnostic after
a last match arm without a trailing comma is retained.

The canonical round-21-intermediate versus round-25-final count table is:

| Count | Before | After |
| --- | ---: | ---: |
| Codes | 3,540 | 3,541 |
| Source files | 626 | 626 |
| Emitting sites | 9,551 | 9,286 |
| Received sites | 339 | 382 |
| Reserved sites | 11 | 11 |
| HTTP-classified | 1,704 | 1,704 |
| Guide-anchored | 431 | 431 |
| Environment variables | 186 | 186 |
| Environment sites | 368 | 364 |

The round-22 post-marker re-audit reported no added or dropped code and no
declaration-backed code whose emitter set fell to zero. Round 23 deliberately
added the one formerly unregisterable `CONTROL_STATE` code and dropped none;
round 25 changes sites only and keeps the code population fixed.

The canonical embedded measurement was rerun after the final implementation and
projection regeneration. Its captured output is:

```json
{
  "mergeBase": "e370bb8f789007cffae1f4d80c4feabdedc81cb5",
  "counts": {
    "codes": 3541,
    "sourceFiles": 626,
    "emittingSites": 9286,
    "receivedSites": 378,
    "reservedSites": 11,
    "httpClassified": 1704,
    "guideAnchored": 431,
    "environmentVariables": 188,
    "environmentSites": 366
  },
  "environmentKinds": {
    "read": 259,
    "mention": 35,
    "declaration": 14,
    "remove": 9,
    "write": 26,
    "table-entry": 8,
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
  "receivedCodes": 298,
  "httpReservations": 7,
  "cloudflareDeployEmissionCodes": 12,
  "s3TestEnvironmentNames": []
}
```

### Round-27 final verification

The final candidate tree was verified immediately before its local-only commit;
no source or generated projection changed between these results and the commit.
The command summaries were:

```text
node --test scripts/generate-diagnostics-registry.test.mjs
tests 33; pass 33; fail 0

node scripts/generate-diagnostics-registry.mjs --check
[diagnostics-registry] ok — 3541 codes, 9286 emitting sites, 378 received sites, 11 reserved sites, 188 environment variables, 366 environment sites, 1704 HTTP-classified

node scripts/generate-symbol-registry.mjs --check
[symbol-registry] ok — 56 modules, 1455 symbols, runtime parity exact

node packages/snapback-cli/reference-lookup.test.mjs
reference-lookup.test.mjs: exact diagnostic/environment/dual-role/member, bounded symbol/module, identity, and fallback pass

node scripts/check-inventories.mjs
[check-inventories] PASS: 357 package tests; 32 scripts tests; 31 demos/31 catalog entries; 487 publication leaves; 157 guide pages/1872 snippets

node scripts/check-first-read.mjs
[first-read] ok — 5 profiles checked

node scripts/check-guide.mjs
[guide-check] ok — 22 passed, 0 failed, 0 skipped, 0 preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 100 warnings

./ref-check --verbose
ref-check: ok — 311 LLP docs, 7871 refs in 16052 files, 0 errors, 0 unchecked

git diff --check
(no output; exit 0)
```

### Round-26 review closure

The received-vocabulary classifier now admits a `Map.get` table only when the
lookup key is proven to carry an inbound diagnostic record/response value.
`GRAPH_SOURCE_FAULT_ORDER` is a sorting table, so its four key sites are no
longer received sites. The same four spellings remain honestly received through
the separate `DEFINITION_EVALUATION_DIAGNOSTIC_CODES.has(evaluationCode)`
receiver. `EXACT_CODE_EXITS.get(record.code)` and the derived issuer-response
lookup remain received.

Rust `matches!` delimiter matching now uses the Rust-aware literal table, and a
lifetime/char-literal fixture pins the following real `SnapbackError::error`
emission. The private Tigris test seam now pins both the unknown-role refusal and
the partial-credential throw's exact read from
`TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES[role]`.

Round 27 extends shell environment classification to command-position
assignments. Prefix assignments, `export NAME=value`, and
`env NAME=value command` are writes; quoted strings and comments remain
non-sites. The production All Aboard build therefore adds
`SNAPBACK_ALL_ABOARD_API` and `SNAPBACK_ALL_ABOARD_TARGET_PROFILE` to the
environment registry and `SnapbackEnvironmentVariable` without changing the
diagnostic population.

The final count table from the round-27 tree is:

| Count | Round 26 | Round 27 |
| --- | ---: | ---: |
| Codes | 3,541 | 3,541 |
| Source files | 626 | 626 |
| Emitting sites | 9,286 | 9,286 |
| Received sites | 378 | 378 |
| Reserved sites | 11 | 11 |
| HTTP-classified | 1,704 | 1,704 |
| Guide-anchored | 431 | 431 |
| Environment variables | 186 | 188 |
| Environment sites | 364 | 366 |

The complete Guide check passed. Its verbatim terminal summary was:

```text
node scripts/check-guide.mjs
[guide-check] ok — 22 passed, 0 failed, 0 skipped, 0 preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 100 warnings
```

### Known JS/native lookup divergence

The generated registry and JavaScript Guide wrapper expose environment-only
and dual-role names, but the embedded Rust CLI/MCP lookup does not yet consult
the registry's `environment` section and mislabels declaration, received, and
reserved sites as emissions. This closed ticket does not claim native parity;
the exact Rust change and parity tests are tracked in
`issues/20260825-native-guide-lookup-registry-kinds-parity.md`.
That ticket explicitly records that v1 diagnostic `sites` entries now carry an
optional `kind` field and native must consume it.
