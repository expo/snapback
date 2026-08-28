# Lane L8 guide-retrieval report

**Status:** Complete pending integrated generated-artifact refresh
**Lane:** LLP 0317.000 Wave 2 L8 / parent row O44
**Systems:** Guide, Diagnostics, Agent retrieval
**Date:** 2026-08-28

## Scope and method

I censused product diagnostics actually emitted in the eight Snapback run logs
under
`benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/*-snapback-*/run-log.md`,
excluding codes mentioned only as lookup facts or hypothetical avoided
failures, then checked each emitted code against source Guide pages and the
committed diagnostics registry. The result is 34 unique lane-hit codes: 29
`SNAPBACK_*` and five registry-invisible product codes.

Per-lane unique counts were: GLM Explicit 6, GLM Familiar 0, Grok Explicit 1,
Grok Familiar 2, Sol Explicit 21, Sol Familiar 12, Terra Explicit 0, and Terra
Familiar 0. Counts overlap across lanes.

## Complete lane-hit code set

The five product codes invisible to the `SNAPBACK_*` registry extractor were:

- `CODEGEN_MODULE_EVALUATION_FAILED`
- `CODEGEN_MODULE_PARSE_FAILED`
- `CODEGEN_POLICY_INVALID`
- `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS`
- `SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED`

The 29 `SNAPBACK_*` codes were:

- `SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED`
- `SNAPBACK_ASSET_REF_UNVERIFIED`
- `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`
- `SNAPBACK_AUTH_PROGRAM_INVALID`
- `SNAPBACK_AUTH_STALE_RESULT`
- `SNAPBACK_AUTH_THROTTLED`
- `SNAPBACK_CAPABILITY_UNSUPPORTED`
- `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`
- `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`
- `SNAPBACK_DEV_PORT_UNAVAILABLE`
- `SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`
- `SNAPBACK_EXPO_METRO_EXITED`
- `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`
- `SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN`
- `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE`
- `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`
- `SNAPBACK_OUTBOX_IDENTITY_MISMATCH`
- `SNAPBACK_OUTBOX_NOT_WRITER`
- `SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT`
- `SNAPBACK_REPLAY_DEFINITION_INVALID`
- `SNAPBACK_SCHEMA_FIELD_RETYPED`
- `SNAPBACK_SEED_MIGRATION_REQUIRED`
- `SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED`
- `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT`
- `SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN`
- `SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED`
- `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE`
- `SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED`
- `SNAPBACK_UNKNOWN_TABLE`

## Missing routes and disposition

Twenty of the 34 codes lacked a source-Guide route: 16 registry-visible
`SNAPBACK_*` codes and four of the five registry-invisible product codes.

| Previously unanchored code(s) | Route added |
| --- | --- |
| `CODEGEN_MODULE_EVALUATION_FAILED`, `CODEGEN_MODULE_PARSE_FAILED`, `CODEGEN_POLICY_INVALID` | `getting-started/generated-artifacts.md` — policy, parse, and broad evaluation recovery for both profiles |
| `SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED` | `getting-started/your-first-backend.md` — keep lifecycle-bearing IDs addressable; use bounded strings only for non-authoritative snapshots |
| `SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED` | `backend/assets.md` — explicit image/video location policy |
| `SNAPBACK_AUTH_PROGRAM_INVALID`, `SNAPBACK_AUTH_THROTTLED` | `auth/passwords.md` — complete auth program and bounded retry routes |
| `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT` | `clients/headless.md` — synchronous, non-reentrant authority participant rule |
| `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`, `SNAPBACK_OUTBOX_IDENTITY_MISMATCH` | `sync/offline-and-retention.md` — settlement ACK/retention and exact replay identity |
| `SNAPBACK_EXPO_METRO_EXITED` | `clients/react-expo.md` — child evidence, generation-directory exclusion, owner reload |
| `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`, `SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED`, `SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE`, `SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED`, `SNAPBACK_UNKNOWN_TABLE` | `backend/mutations.md` — result-contract and owner-write composition repairs |
| `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE` | `backend/media-happy-paths.md` — ordinary owner-visible parent requirement |
| `SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT` | `clients/react.md` — declarative-versus-imperative presence ownership |
| `SNAPBACK_REPLAY_DEFINITION_INVALID` | `testing/large-fixtures.md` — closed `defineReplay` record repair |
| `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT` | `realtime/live-queries.md` — stable bindings and handle disposal |

Every new `SNAPBACK_*` route has a `diagnostic-primary` marker. The five
prefix-invisible product codes cannot receive registry primaries because
`DIAGNOSTIC_CODE_PATTERN` recognizes only `SNAPBACK_*`; they have direct
lexical routes and the general ownership question is filed in
`issues/20260828-non-snapback-diagnostic-registry-scope.md` for LLP 0193.

The other 14 lane-hit codes already had source-Guide anchors and were left in
place: `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS`,
`SNAPBACK_ASSET_REF_UNVERIFIED`,
`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`,
`SNAPBACK_AUTH_STALE_RESULT`, `SNAPBACK_CAPABILITY_UNSUPPORTED`,
`SNAPBACK_DEV_PORT_UNAVAILABLE`,
`SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`,
`SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN`,
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, `SNAPBACK_OUTBOX_NOT_WRITER`,
`SNAPBACK_SCHEMA_FIELD_RETYPED`, `SNAPBACK_SEED_MIGRATION_REQUIRED`,
`SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED`, and
`SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN`.

## Already-shipped capabilities made retrievable

- `auth/protecting-data.md` now routes membership-scoped table visibility and
  cross-links the same declaration to ephemeral and asset authorization.
- `realtime/ephemeral-state.md` now preserves the failed
  “generated ephemeral authorization composition” wording and routes it to
  `allow.members(declarationId, { roles? })`.
- `backend/assets.md` now corrects the lane's rejected
  `access.read: 'members'` guess to `access.read: 'via-references'` plus
  membership `.assetSharing(...)`.
- `clients/headless.md` is extended in place for “drive the generated API from
  Node,” including `baseUrl`, stable live-query `connectionId`, and flat
  command inputs plus the asset source. No second Node page was added.

Each edit either states that the normalized/runtime rule is shared by Explicit
and Familiar authoring or names the profile-specific spelling where it differs.

## Retrieval-eval additions

Cases 107–113 in `guide/retrieval-eval.md` preserve the lane language and pin
the expected destination:

1. broad module-evaluation code -> generated-artifact custody;
2. `CODEGEN_POLICY_INVALID` plus `committedProjections` -> generated-artifact custody;
3. “drive the generated API from Node” and flat command inputs -> headless client;
4. removed-member membership-scoped reads -> table visibility;
5. generated membership authorization for ephemeral state -> `allow.members`;
6. rejected `access.read: 'members'` spelling -> membership asset sharing;
7. structured receipt-array IDs -> addressable IDs or non-authoritative string snapshots.

`node scripts/check-retrieval-eval.mjs` passes with zero errors.

## Verification

- `node scripts/check-retrieval-eval.mjs`: pass; every exact L8 failed phrase
  routes directly to its expected page.
- `./ref-check --verbose`: pass — 326 LLP documents, 6,906 refs, zero errors,
  zero unchecked.
- `git diff --check`: pass.
- Focused source check: each of the 16 new `SNAPBACK_*`
  `diagnostic-primary` markers occurs exactly once, with no duplicate primary
  code in the source Guide corpus; all five registry-invisible lane-hit codes
  have a source-Guide occurrence.
- `bun install --frozen-lockfile`: pass; installed the worktree's ignored JS
  dependencies without changing tracked files.
- `node scripts/check-guide.mjs`: no completed verdict. Its full diagnostics
  scan produced no output within the bounded verification window and was
  stopped. The source-only retrieval check above is conclusive for the new
  evals; the integrated generated-artifact refresh and aggregate check remain
  required below.

## Required integrated regeneration

No generated Guide artifact was edited. After integrating this lane, run these
generators in order so the new diagnostic primaries and page content enter the
checked publication graph:

```sh
node scripts/generate-diagnostics-registry.mjs
node scripts/generate-guide-manifest.mjs
```

The supervisor should then run `node scripts/check-guide.mjs` on the integrated
tree.
