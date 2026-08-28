# L4 silent-degradation verdict: O29, O35 asset, and bounded sweeps

**Status:** Completed lane record; O29 product fix remains open at an out-of-scope activation boundary
**Date:** 2026-08-28
**Systems:** Auth successors, React asset hooks, client diagnostics, codegen refusal integrity
**Governing obligations:** LLP 0317.000 P2/P5; disposition rows O29 and O35; LLP 0227 password-policy declaration

## Executive verdict

| Obligation | Verdict | Evidence | Disposition |
|---|---|---|---|
| O29 — `defineAuth` `minimumLength` successor | **Confirmed** | A sessions store booted at 8 actively refuses a sub-eight-character password with `SNAPBACK_AUTH_PASSWORD_POLICY` and `minimumLength: 8`, then accepts a 10-character password. Same-mode `ensureApp` accepts a successor at 20 and reports `schema: provisioned`; afterward, the live process still refuses a new sub-eight-character password with `minimumLength: 8` but accepts a different 10-character password. Restarting that process on the same database makes the 10-character signup refuse with `minimumLength: 20`, while sign-in for the predecessor account still succeeds. | The predecessor policy stays actively enforced until restart; restart applies the successor without store reset or migration. Live activation must restart the auth runtime or refuse before claiming success. |
| O35 asset half — `useSnapbackAssetImage` without `maxWidth` | **Not reproducible** | Ten consecutive runs pass. With `maxWidth` omitted, a ready public asset selects the 512px rendition and produces strict URL `...?maxWidth=512`. | Keep the existing optional argument and 512px default. No diagnostic or stricter type is justified. |

The auth reproduction is [tests/acceptance/auth-password-policy-successor-v1.mjs](../../tests/acceptance/auth-password-policy-successor-v1.mjs). The asset reproduction is in [packages/snapback-react/assets.test.mjs](../../packages/snapback-react/assets.test.mjs).

The harness used
`/Users/ccheever/lanes/0317-l1-livequery/target/debug/snapback`. Its `/health`
response reports
`binary.gitCommit: 4d4ce40bd9b3921a88d37063b47693923ca8c1d3` and
`binary.gitDirty: false`. That commit is an ancestor of this checkout's HEAD,
and the declared runtime-input diff from it to HEAD is empty, so the evidence
is source-relevant. Scoped limitation: the binary was built in a sibling
worktree at the same reported commit, not from this checkout's own tree. The
original ten-character-after-provision symptom reproduced on both this runtime
and the earlier `92c0033` runtime; no broader behavioral equivalence is claimed.

## O29 — confirmed silently retained policy

The test uses one SQLite database throughout:

1. Generate and boot a sessions application with `minimumLength: 8`.
2. Confirm a sub-eight-character signup refuses with `SNAPBACK_AUTH_PASSWORD_POLICY` and reports `minimumLength: 8`; the predecessor bound is active, not disabled.
3. Confirm signup with `ten-chars!` succeeds and retains the account as the persistence witness.
4. Generate the same application successor with `minimumLength: 20` and apply it through the explicit same-mode provisioning flow.
5. Observe `ensureApp` report the schema as `provisioned`.
6. Confirm a new sub-eight-character signup still refuses with `SNAPBACK_AUTH_PASSWORD_POLICY` and reports `minimumLength: 8`, proving the predecessor bound remains actively enforced after provisioning.
7. Confirm a new signup with `ten-chars!` still succeeds in the live process. There is no refusal or diagnostic for the candidate bound.
8. Stop and restart the server with the successor startup carrier, preserving the database pathname.
9. Confirm the predecessor account still signs in with `ten-chars!`, proving the durable store survived the restart.
10. Confirm a new short signup now refuses with `SNAPBACK_AUTH_PASSWORD_POLICY`, reports `minimumLength: 20`, and a 20+-character signup succeeds.

This isolates the defect from disabled enforcement and catalog/store migration. LLP 0227 makes the password policy a boot-time declaration. The post-provision predecessor refusal pins the old bound as still active, and the successful post-restart sign-in pins persistence; the store does not need reset or migration. The old bound is retained because `AuthRuntime` constructs one `AuthProvider` from the startup manifest, while the same-mode provisioning path commits the successor generation without replacing that provider.

### Required product behavior and scope boundary

The normal successor operation must not report the candidate as applied while password admission still uses its predecessor. The cheapest truthful behavior is to refuse a live `minimumLength` change with a specific diagnostic such as `SNAPBACK_AUTH_PASSWORD_POLICY_RESTART_REQUIRED`, including predecessor/candidate bounds and a backend-restart repair. A managed dev owner may instead restart before reporting success, but plain `ensureApp` cannot silently claim activation.

That check belongs at the same-mode activation boundary in `crates/snapback-server/src/server.rs` / `crates/snapback-engine/src/local/engine.rs`, and provider replacement belongs in `crates/snapback-server/src/auth/runtime.rs`. Those product files are outside L4's authorized scope. No change was made in `crates/snapback-auth`: changing password validation there cannot tell whether a newly provisioned manifest is live, and no in-scope caller can deliver an update to the existing provider. The passing characterization test remains as the exact handoff for the supervisor/L11 fix.

`SNAPBACK_AUTH_PASSWORD_POLICY_RESTART_REQUIRED` is a proposal, not an added or reserved code. If the integrated fix adds it, run `node scripts/generate-diagnostics-registry.mjs`; lane L8 owns its guide anchor.

## O35 asset half — not reproducible

Both `useSnapbackAssetImage` and `SnapbackAssetImage` currently default `maxWidth` to 512. `git blame` places the hook default at `0fbdc5ff06` on 2026-08-10; those bytes have not changed since and predate published 0.1.29. The headless `deliveryUrl(..., { variant: "best" })` correctly refuses when no positive maximum is supplied, but the React hook always supplies its default. The new regression drives the hook from establishment to a ready `public-immutable` record and asserts both the selected 512px rendition and the strict fallback URL.

Per P2, the current runtime default is the cheapest rung carrying the desired behavior. Making `maxWidth` required or adding a missing-argument warning would add ceremony without repairing a present failure. Ten consecutive full `packages/snapback-react/assets.test.mjs` runs passed.

## Bounded sweep 1 — exported client and React hooks

This inventory was performed once over the exported hooks of `packages/snapback-client` and `packages/snapback-react`. `packages/snapback-client` exports no React-style `use*` hooks; its strict asset stores are reached by the React hooks and were inspected at those delegation points.

| Export(s) | Missing/malformed/unusable-input behavior | Classification | Action |
|---|---|---|---|
| `useSnapbackCurrentPrincipal`, `useSnapbackAuth`, `useCurrentPrincipal`, `useAuth` | Missing provider/app-client capability throws a typed provider diagnostic. | Loud; no finding. | None. |
| `useSnapbackQuery`, `useSnapbackQueries`, `useQueryState`, familiar `useQuery` | Generated arguments are normalized against contracts; invalid groups refuse. `skip` and familiar pending `undefined` are explicit lifecycle projections, and the familiar route warns in development. | Intentional empty/default states; no required input is discarded. | None. |
| `useSnapbackAuthorityRoster`, `useSnapbackAuthorityMyRole`, `useSnapbackAuthorityMutation`, `useSnapbackAuthorityMutationStatus` | Options, references, pages, and non-null mutation ids refuse when invalid. The internal caller projection substitutes an `unknown` principal when an older/malformed bound client lacks auth projection methods. | **Latent silent default:** unsupported auth capability is hidden as `unknown`. It is not reproducible with a current provider, which guarantees auth. | Propose a typed unsupported-client refusal if this compatibility seam remains public. Not changed because compatibility impact is not trivial. |
| `useSnapbackPresence`, `useSnapbackActivityPresence`, `useEphemeralRepublisher` | Required option records and activity fields refuse. Presence `skip` is the explicit observer mode; lifecycle withdrawal is intentional. | No finding. | None. |
| `useSurface` | Surface parameter/member validation is closed and refuses unbound required fields or unusable values. | Loud; no finding. | None. |
| `useSnapbackMutation`, `useSnapbackSettledMutation`, `useSnapbackOptimisticCreate`, `useSnapbackCommand`, familiar `useMutation`/`useAction` | Reference admission and generated argument validation refuse; optimistic create requires query options. | Loud; no finding. | None. |
| `useSnapbackConnection`, `useSnapbackDiagnostics` | No required caller input; missing diagnostics capability refuses with `SNAPBACK_REACT_DIAGNOSTICS_UNSUPPORTED`. | No finding. | None. |
| `useSnapbackOutbox` | `outboxStatus()` rejection is caught without emission and leaves the last snapshot—initially the all-zero `loading` default—indefinitely. | **Confirmed silent default by source inspection.** | Propose an error/diagnostic projection on the existing client channel. Not changed because error-state/coalescing semantics need an owner decision. |
| `useSnapbackAssetUrl`, `useSnapbackMedia`, `useSnapbackMediaCollection` | `null`/`undefined` scalar media and an empty collection are documented inert inputs. Empty-string/malformed asset ids, malformed media refs, collection items, and rendition options refuse. | Intentional emptiness; no finding. | None. |
| `useSnapbackAssetUpload` | Missing upload reference refuses. Idle `pause`/`resume`/`retry` no-ops reflect absence of a task rather than malformed input. | Intentional idle state; no finding. | None. |
| `useSnapbackAssetImage`, `SnapbackAssetImage` — omitted `maxWidth` | Supplies 512 and renders; ten-run reproduction is green. | Not reproducible. | Regression test only. |
| `useSnapbackAssetImage`, `SnapbackAssetImage` — failed watch | A `watchStore` error snapshot carries a diagnostic, but the renderer recognizes only ready/blank and falls through to preview, placeholder, or `empty`; with no fallback it returns `ASSET_IMAGE_IDLE`. | **Confirmed silent empty by source inspection.** | Propose forwarding the source diagnostic through the client diagnostics channel and retaining an explicit error fact. Not changed because the public phase/type and emission-coalescing contract need design. |
| `useSnapbackAssetImage`, `SnapbackAssetImage` — malformed ThumbHash | Placeholder decode catches every error and returns `null`; when it is the only source the hook returns `ASSET_IMAGE_IDLE` with no diagnostic. | **Confirmed silent empty by source inspection.** | Propose a coalesced `SNAPBACK_REACT_ASSET_PLACEHOLDER_INVALID` warning. Not changed because this adds a new public diagnostic and render-safe emission lifecycle. |

The failed-watch and malformed-placeholder rows are clearly in the silent-degradation class but are not the reported missing-`maxWidth` behavior. They are proposals only, in keeping with the bounded-sweep instruction.

## Bounded sweep 2 — codegen refusal sites

This inventory was performed once over production refusal/ignore paths in `packages/snapback-codegen`.

| Area | Observed behavior | Classification | Action |
|---|---|---|---|
| Definition constructors and generate options | Closed-key validators reject unknown fields; generated options are validated before worker serialization. | Loud; no finding. | None. |
| Authoring-profile source discovery | Three profile scans caught an unreadable discovered `.js`/`.ts` source and continued. In explicit mode an unimported invalid source could evade the familiar-source check; in familiar mode a nested invalid source could disappear completely. | **Confirmed silent drop.** | **Fixed:** all three scans now report the existing file-capability diagnostic (for the regression, `FUNCTION_SOURCE_INVALID_UTF8`) and generation stops before writing output. Added explicit and familiar regression cases in `packages/snapback-codegen/authoring-validation.test.mjs`. |
| Entry evaluation, definition dependency graph, seed/remote/capability inputs, generated write | Missing, malformed, ambiguous, outside-root, or unreadable semantic inputs already report/throw and preserve the previous generated graph atomically. | Loud; no finding. | None. |
| Relational/broadcast optimization and source-attribution helpers | Parse/proof failures fall back to the original JS/query-shaped execution or omit only repair-location/source-map metadata. They do not drop authored runtime semantics. | Conservative or metadata-only fallback; outside the defect class. | None. |
| Declaration-suggestion source graph and module-format inference | Several read/resolve/package-manifest failures `continue` or use an extension default without adding a typed hole. The command is advisory, but a suggestion can be based on a narrower analysis graph than the authored input suggests. | **Potential silent analysis drop.** | Propose recording a typed hole/refusal in the frozen suggestion before apply. Not changed; this requires suggestion identity and UX decisions. |
| Visibility-governance revision enumeration | Git read/diff/list failures can return `null`/`[]`; with no explicit backend paths, `compareGovernanceSnapshots` can consequently produce an empty comparison instead of refusing the unreadable revisions. | **Potential fail-open empty inventory.** | Propose a coded governance refusal at the Git adapter boundary. Not changed because this is high-stakes provenance behavior and not a trivial sweep fix. |
| Regeneration lock observation/cleanup | A partially written lock is treated as unknown during a bounded grace interval; cleanup failures preserve unknown files. | Deliberate conservative concurrency behavior. | None. |

The codegen fix adds no new `SNAPBACK_*` code. It does move production diagnostic sites in `index.mjs`, so `guide/reference/diagnostics-registry.json`, `guide/reference/diagnostics.md`, and the chained `guide/guide-manifest.generated.json` are intentionally stale. Per the lane rule, no generator was run and no generated artifact was hand-edited; the supervisor regenerates the chain once over the integrated tree.

## Verification

| Command | Result |
|---|---|
| `SNAPBACK_RUNTIME_BINARY=/Users/ccheever/lanes/0317-l1-livequery/target/debug/snapback node tests/acceptance/auth-password-policy-successor-v1.mjs` | Pass; the post-provision sub-eight refusal proves the predecessor bound remains active, while the ten-character signup proves the candidate bound is not active; restart activation and predecessor-account persistence also pass. `/health`: `gitCommit: 4d4ce40bd9b3921a88d37063b47693923ca8c1d3`, `gitDirty: false`. The binary was built in the named sibling worktree at that ancestor commit; its runtime-input diff to this checkout's HEAD is empty. The original ten-character-after-provision symptom also reproduced on the earlier `92c0033` runtime. |
| `bun packages/snapback-react/assets.test.mjs` repeated 10 consecutive times | 10/10 pass. |
| `node packages/snapback-codegen/authoring-validation.test.mjs` | Pass. |
| Focused `auditPackageTestInventories` invocation | Pass: 364 on disk, 364 expected, zero drift. |
| `./ref-check --verbose` | Pass: 6,908 refs, zero errors/unchecked. |
| `git diff --check` | Pass after removing the trailing whitespace on the record header. |
| `node scripts/check-inventories.mjs` | The package-test drift found for the initial standalone regression was repaired by folding it into the registered suite; the focused package audit is now green. The guide-manifest portion remains red on generated diagnostics projections and pre-existing missing generated demo/Contract snippets. Generated files were deliberately left for integrated regeneration. |

The O35 live-query half was not inspected or changed.
