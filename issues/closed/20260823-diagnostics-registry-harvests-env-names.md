# Diagnostics registry harvests `SNAPBACK_*` environment-variable names as codes

- Status: Closed
- Date: 2026-08-23
- Systems: `scripts/generate-diagnostics-registry.mjs`,
  `guide/reference/diagnostics-registry.json`,
  `packages/snapback-client/diagnostic-codes.d.mts`
- Governing: LLP 0193 (errors as docs)
- Found by: grok review of the LLP 0299 landing (finding #4)

## Problem

The generator harvests every `SNAPBACK_[A-Z0-9_]+` literal in production
sources as a diagnostic code. Environment-variable names therefore appear as
codes with sites and guide anchors: `SNAPBACK_DEV_AUTH_ORIGINS`,
`SNAPBACK_RUNTIME_BINARY`, `SNAPBACK_EXPO_METRO_PORT` were already registered
on main before LLP 0299, and 0298 adds `SNAPBACK_DEV_PORT`,
`SNAPBACK_DEV_CLIENT_PORT`, `SNAPBACK_DEV_BOOTSTRAP_PORT`,
`SNAPBACK_DEV_PORT_RANGE` the same way. Rust has a reviewed
`NON_DIAGNOSTIC_SNAPBACK_LITERALS` classification for this; JS has none.

The reviewer's proposed dodge — assembling env names so the full token never
appears as a string literal — was refused: it hides the names from `grep`
and from the guide, which is worse than a mislabelled registry row.

## Fix

Add an environment-name classification to the generator (a reviewed list or
a `process.env[...]`/`env?.[...]` usage heuristic) that records these
literals under a separate `environment` section of the registry and types
instead of as diagnostic codes, then regenerate.

## Resolution (2026-08-25)

The generator now classifies each source site before publishing either
vocabulary. An outer literal is an emission when it is a diagnostic-position
whole code or a leading `CODE:` message; `WARNING`, `ERROR`, or `INFO` may
precede that leading code. A nested quoted token counts only when its enclosing
string is demonstrably generated executable source that constructs or assigns a
diagnostic, SQL that writes an explicit diagnostic/error-code column, or an
escaped poison message. `diagnostics-registry: emission SNAPBACK_X` covers a real site
whose syntax cannot prove that fact. Rust match patterns, `matches!`, equality
comparisons, all-code arrays/sets, comments, and marked reference-only sites do
not emit.

A token later in prose, the environment name after a valid diagnostic prefix,
or a `NAME=value` example is a reference. Whole-string names in environment
accessors and environment-name tables/lists are environment sites. The scan is
two-pass so a name established as environment configuration in one production
file is still classified correctly when another file mentions it. Comment
exclusion runs first, so the explanatory `SNAPBACK_ADMIN_TOKEN` access in
`packages/snapback-client/app-data.mjs` is no longer published as a read.

The machine registry's separate `environment` section records `read`, `write`,
`remove`, `indirect-read`, `declaration`, `table-entry`, and `mention` sites.
Known secret writers (`stageSecrets`, `setSecrets`, and Fly secret helpers),
spawn `env: { ... }` objects, and the explicit `diagnostics-registry:
environment SNAPBACK_X` marker contribute write sites. The generated
`diagnostic-codes.d.mts` continues to own both `SnapbackDiagnosticCode` and
`SnapbackEnvironmentVariable`, re-exported by `@expo/snapback-client`, so the
diagnostics registry, symbol registry, and Guide projections share one generated
authority.

The final comparison with merge-base `e370bb8f7` finds 223 removed names: 147
are now environment variables and 76 are not in the environment section.
Thirteen names re-enter the public union relative to the earlier review
checkpoint: the client-protocol vocabulary
`SNAPBACK_AUTH_SESSION_REVOKED`, `SNAPBACK_AUTH_FAMILY_REVOKED`, and
`SNAPBACK_CLIENT_UPGRADE_REQUIRED`, plus the wire-compatible caller-error
vocabulary `SNAPBACK_INVALID_FLOAT`, as `received` sites, plus the eight
HTTP-table-only names already listed and
`SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING` as nine explicit `reserved` sites. The
non-environment group contains constants, protocol/version symbols, receipt
labels, wildcard/identifier fragments, test/reference vocabulary, and
incomplete family prefixes rather than diagnostics. The three target mTLS
secret-staging keys are now environment writes rather than unclassified names.
The five earlier review exemplars
`SNAPBACK_DEV_APP_BINDING_UNAVAILABLE`,
`SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED`,
`SNAPBACK_CODEGEN_DEFINITION_AMBIENT_UNAVAILABLE`,
`SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE`, and
`SNAPBACK_JOB_LEASE_EXPIRED` are present again, along with the related generated
definition, familiar, job, poison, and LAN-warning codes.

Round 4 inventories all 14 production JavaScript modules under
`targets/cloudflare/src/`, excluding test and fixture trees under the same walk
rule as other production JavaScript. The three `targets/cloudflare/app/`
application/reference bundles are also excluded because their app-authored
vocabulary is not a framework or operator diagnostic source. This restores seven names that existed in
the merge-base registry and were lost earlier in the lane:
`SNAPBACK_ACTION_STREAM_CANCELLED`, `SNAPBACK_ACTION_REPLAY_DIVERGED`,
`SNAPBACK_CONNECTION_SESSION_REPLACED`,
`SNAPBACK_TEST_CRON_ACTION_INTERRUPTED`,
`SNAPBACK_HOST_FETCH_DESTINATION_INVALID`,
`SNAPBACK_HOST_FETCH_DESTINATION_REFUSED`, and
`SNAPBACK_HOST_FETCH_REDIRECT_REFUSED`. The six review-named Cloudflare codes
are real target emissions with target source sites, not reference vocabulary.
The target scan also inventories 73 other production Cloudflare diagnostics
that were absent from both the merge-base and pre-round registries.

The three publication-authority messages now retain their original runtime text:
`SNAPBACK_PUBLICATION_AUTHORITY_PORT`,
`SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID`, and
`SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN` are environment-only names: their
configuration reads and validation-message mentions remain in
`SnapbackEnvironmentVariable`, and none is a `SnapbackDiagnosticCode` member.
`SNAPBACK_PASSWORD`,
`SNAPBACK_ADMIN_TOKEN`, `SNAPBACK_DEV_PORT`, and `SNAPBACK_RUNTIME_BINARY` are
environment-only. Constant declarations no longer depend on environment-like
identifier spelling: every constant carrying a `SNAPBACK_*` literal is traced
to bracket access and recognized environment-helper calls. Consequently
`SNAPBACK_DERIVED_INSTANCE_ID` is environment-only through the opaque
`DERIVED_INSTANCE_ID_BINDING` declaration in the Cloudflare target.

The dual-role rule still holds: an environment name emitted elsewhere at a
proven diagnostic site stays registered, but only the emitting occurrence
appears in its diagnostic sites. Ordinary comments remain excluded. The
`diagnostics-registry: emission SNAPBACK_X` marker records a normal emitting
site for a real dynamically assembled spelling. The four concrete
`validate_artifact_header` stale-artifact spellings use that marker, while
`diagnostics-registry: reserved SNAPBACK_X` retains the retired
`SNAPBACK_IBEX_CLI_UNAVAILABLE` spelling, the retired
`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` seed-lane refusal, and nine
HTTP-table-only spellings: `SNAPBACK_AUTH_MODE_CHANGED`,
`SNAPBACK_OPERATION_CANCELLED`, `SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED`,
`SNAPBACK_API_BUDGETS_UNAVAILABLE`,
`SNAPBACK_AUTHORITY_ROSTER_CURSOR_INVALID`,
`SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING`,
`SNAPBACK_PROMOTION_EFFECT_INTENT_MISSING`,
`SNAPBACK_SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD`,
`SNAPBACK_UNSUPPORTED_BLOB`. Reservations do not count as emissions. The nine
HTTP-only arms are deletion candidates for the Rust-capable follow-up
`issues/20260825-http-table-only-diagnostic-reservations.md`.
`SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS` stays in that Rust table as a match
reference but is environment-only and is not reserved. An audit of all 76
non-environment removals initially missed this ninth retired diagnostic; after
reserving `SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING`, the remaining names are active
catalogue/reference vocabulary, protocol and format constants, fixture names,
wildcard fragments, or other non-diagnostic identifiers. The lifecycle registry
names none of the 76. The HTTP-only
`NON_DIAGNOSTIC_SNAPBACK_LITERALS` table remains separate because it includes
legitimate non-HTTP diagnostics and is not a safe public-registry denylist.

Closed code-literal Sets/arrays in shipped client packages now contribute
`received` sites when they flow to a `.has(code)` or `.includes(code)` dispatch
membership test; ambiguous tables use the explicit `diagnostics-registry:
received` marker. The wire-compatible `CALLER_ERROR_CODES` table additionally
marks `SNAPBACK_INVALID_FLOAT` as received. This keeps 83 received names across
93 sites in the public
diagnostic union without mislabelling them as emissions. The three round-6
client-protocol restorations named above are received-only.

The companion fixture now has 85 raw `SNAPBACK_*` substrings and retains 17
emitting occurrences across 16 names plus two received-protocol occurrences.
Its fail-first runs proved all classifier
repairs: generated JavaScript and multiline Rust SQL were absent while match
arms, `matches!`, code catalogues (including singleton `codes:` metadata),
prefix and JavaScript membership checks, and a trailing-underscore family
token were falsely present; the exact production
`eprintln!("SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH field={field}")` line and
the `println!`, `tracing::*!`, `log::*!`, and synthetic-marker rows were absent.
The environment half additionally pins multiline block-comment exclusion,
known/custom environment-writing helpers, and distinct read, write, and remove
roles for JavaScript and Rust process/child environment sites. A separate
constructed fixture places the first token of a Rust or-pattern more than 8192
characters before its arrow.
The final classifier treats a diagnostic-leading string argument to those Rust
print/log macros as an emission when the token is followed by `:` or whitespace,
treats `startsWith`/`starts_with`/`contains`/`endsWith` operands as references,
and never recognizes a token ending in `_` as a complete code.

Package production sources now derive from each package manifest's shipped
`files`/`exports`/entry points, plus package ship-tool entry points and their
local module closure; target-local operator carriers derive from all
`targets/*` JavaScript outside tests, fixtures, and examples. That adds eleven
active diagnostic spellings:
`SNAPBACK_APP_DESCRIPTOR_UNAVAILABLE`,
`SNAPBACK_AUTH_CUSTODY_BACKUP_RULES_CONFLICT`,
`SNAPBACK_CONFIG_APPLY_PENDING`, `SNAPBACK_CONFIG_DEADLINE_EXCEEDED`,
`SNAPBACK_CONFIG_STATUS_UNKNOWN`, `SNAPBACK_CONNECTION_GRANT_LIMIT`,
`SNAPBACK_EXPO_DESCRIPTOR_PATH_INVALID`,
`SNAPBACK_EXPO_PROJECT_ROOT_REQUIRED`, `SNAPBACK_HANDLER_INVALID_CHARACTER`,
`SNAPBACK_TEXT_DECODER_INSTALL_FAILED`, and
`SNAPBACK_WRANGLER_PRECHECK_FAILED`.

The hosted Tigris partial-credential loop retains its original private helper
and dynamic runtime template. Explicit dynamic-emission markers register the
five grammar-valid finite spellings without changing runtime strings. The
`control-state` role still produces the unregisterable hyphenated spelling;
this lane does not change that thrown-message compatibility surface or export
the IAM-mutating helper. The separately scoped private-helper compatibility proposal is
`issues/20260825-hosted-target-tigris-role-code-spelling.md`.

The worker-binding repair moves six names into the environment vocabulary:
`SNAPBACK_ACCEPTED_SOCKET_LIMIT`, `SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT`,
`SNAPBACK_SOCKETS_PER_CONNECTION_LIMIT`, `SNAPBACK_SUBSCRIPTION_ARGS_BYTES`,
`SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT`, and
`SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT`. The accepted, legacy-proof,
global-subscription, and connection-grant dual-role names keep only their
actual `kitError`, `requestDiagnostic`, or `code:` emitting sites in the
diagnostic vocabulary.

Final regeneration produces 3,537 diagnostic codes, 10,257 emitting sites, 93
received sites, and 11 reserved sites from 634 production source files. The
environment section contains 181 variables across 359 sites: 256 reads, 17
writes, 3 removes, 16 indirect reads, 14 declarations, 12 table entries, and 41
message mentions. The full Rust match-arm scan removes false `api_error.rs`
emission sites from 234 names; the file had 237 ordinary emission sites before
the repair and retains only three real producer sites across two names.
`SNAPBACK_INVALID_FLOAT` remains in the union as received caller-error wire
vocabulary, while `SNAPBACK_ARG_MISSING` retains its real `value_expr.rs`
producer without freezing that source's line number in the test.
Excluding the comment-only `SNAPBACK_ADMIN_TOKEN` pseudo-read and a falsely
enclosed `SNAPBACK_ADMIN_TOKEN` table entry removes the remaining bad sites;
the three target mTLS staging names add real writes.

The final numbers above were computed from the generated registry, not copied
from an earlier review. This is the exact measurement script:

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
}, null, 2));
```

Captured output:

```json
{
  "mergeBase": "e370bb8f789007cffae1f4d80c4feabdedc81cb5",
  "counts": {
    "codes": 3537,
    "sourceFiles": 634,
    "emittingSites": 10257,
    "receivedSites": 93,
    "reservedSites": 11,
    "httpClassified": 1709,
    "guideAnchored": 427,
    "environmentVariables": 181,
    "environmentSites": 359
  },
  "environmentKinds": {
    "read": 256,
    "mention": 41,
    "declaration": 14,
    "remove": 3,
    "write": 17,
    "table-entry": 12,
    "indirect-read": 16
  },
  "mergeBaseRemovals": {
    "total": 223,
    "environment": 147,
    "other": 76
  },
  "fixtureRawTokens": 85,
  "receivedCodes": 83,
  "httpReservations": 9
}
```
