# Findability lane A — grammar, codegen, and policy

## Outcome

Routed O9, O13, O30, O39, O40, and O41 from vocabulary copied from the
published 0.1.29 benchmark lanes. All guide repairs state the shared
Explicit/Familiar rule. O13 has two independent eval cases so the anonymous
media route cannot mask the single-literal route.

## Per-row report

### O9 — inline-handler dialect

- Routed the existing `getMany` / `uniqueMany` page to an ID-carrying
  `find(...)` correlation rewrite that avoids computed response indexing.
- Destination: `guide/backend/queries.md`, “Batch exact lookups in one host
  call.”
- Failed vocabulary: “used dynamic array indexing while correlating bounded
  getMany results”; “Computed array lookup used to associate uniqueMany
  media.”
- Retrieval case: **114**.

### O13 — anonymous media results and one-member unions

- Routed anonymous `v.media` failures to the existing result-contract page:
  preserve the stored source by returning `results.documents(table)`,
  `results.document(table)`, or a containing `v.doc(table)`.
- Routed a one-literal schema domain to direct `v.literal(value)` rather than
  widening to `v.string()` or wrapping it in `v.union`.
- Destinations: `guide/backend/queries.md` and
  `guide/getting-started/your-first-backend.md`.
- Failed vocabulary: “v.media is restricted to stored top-level fields and
  cannot be repeated as an anonymous JS result validator”; “A schema field
  with a single literal compiled as unsupported Json; represented the closed
  digest identity as a one-member union”; “v.union requires at least two
  validators.”
- Retrieval cases: **115** and **116**.

### O30 — policy projections

- Extended generated-artifact review with the existing
  `snapback/generated/authorization-review.json` preview, including
  `tablePolicies[]`, `operations[].effectiveTablePolicies[]`, and the table,
  owner, stamped-input, and unique-conflict facts in `writePolicyChecks[]`.
- Destination: `guide/getting-started/generated-artifacts.md`, “Preview
  authorization policy changes before activation.”
- Failed vocabulary: “owner-visible collection parents interacted with
  cross-author feed reads”; “The owner-visible parent required by the
  now-abandoned generated collection also scoped ordinary handler reads, so
  Bob could not resolve Alice's parent post.”
- Retrieval case: **117**.

### O39 — elevated-read placement

- Put the admitted inline placement rule in the first handler packet and at
  the existing authorize-then-elevate recipe: direct
  `ctx.db.elevated...` calls stay in the handler after `ctx.permissions`;
  helpers cannot hide the site; `elevatedReads:` is module-form metadata.
- Added `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE` as a diagnostic primary
  on the unique existing Guide anchor.
- Destinations: `guide/getting-started/your-first-backend.md` and
  `guide/auth/protecting-data.md#authorize-first-then-elevate-the-exact-handler-read`.
- Failed vocabulary: “elevated reads can't hide in helper modules”;
  “defineJsQuery elevatedReads refused on inline handlers.”
- Retrieval case: **118**.

### O40 — table-first `ctx.db.patch`

- Changed the runtime `SNAPBACK_UNKNOWN_TABLE` refusal for patch calls to say
  `ctx.db.patch is table-first; call ctx.db.patch(table, id, values)` and to
  carry `table`, `writeForm`, and `expectedCall` details. Other unknown-table
  write forms keep their existing message.
- Added a focused Rust regression test and routed the row-id-only symptom on
  the existing mutations page.
- Destination: `guide/backend/mutations.md#read-and-delete-through-ctxdb`.
- Failed vocabulary: “I hit SNAPBACK_UNKNOWN_TABLE from the row-id-only
  spelling.”
- Retrieval case: **119**.

### O41 — null versus absence in result contracts

- Explained the result/document rule once on the query result-contract page:
  a stored optional is a present key with value `T | null`; omitting the key
  violates `results.documents`, `results.document`, or nested `v.doc`.
- Destination: `guide/backend/queries.md`, result-contract guidance.
- Failed vocabulary: “Optional asset fields still must serialize as null in
  document results”; “Result-contract requiredField on optional document
  columns”; “document results still demand null for requiredField.”
- Retrieval case: **120**.

## Verification

- `node scripts/check-retrieval-eval.mjs` — passed: 119 parsed cases, 5
  Rosetta records, 0 errors. Every new Route term independently matched its
  intended destination.
- `cargo fmt --all -- --check` — passed.
- `scripts/bootstrap-ibex-runtime` — passed exact link, launch, and restricted
  handler-VM qualification.
- Repository-pinned `cargo-nextest` 0.9.143 was installed. The scoped
  `patch_unknown_table_names_the_table_first_repair` run compiled the affected
  crates but could not link the pre-existing `snapback-engine` unit-test binary:
  its final link lacked the `_snapback_build_git_commit_*`,
  `_snapback_build_git_dirty_v1`, and `_snapback_build_distribution_*` native
  providers. No test executed; this is a verification-environment blocker, not
  a failing assertion. The focused regression remains in the tree for the
  integrated test runner.
- `./ref-check` — passed: 326 LLP docs, 6,909 refs in 13,136 files, 0 errors,
  0 unchecked.
- Reviewed-authority digests for all six edited Guide pages were recomputed
  after the final edits and match their frontmatter.
- Referenced Guide heading
  `auth/protecting-data.md#authorize-first-then-elevate-the-exact-handler-read`
  resolves and is unique.

## Required supervisor regeneration

Regeneration is needed over the integrated tree. I did not edit any forbidden
generated file.

- Regenerate `guide/reference/diagnostics-registry.json` and its generated
  diagnostics page so `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE` receives
  the new Guide anchor and the Rust diagnostic source line is refreshed.
- Regenerate the Guide manifest and `guide/*.generated.md` projections after
  the authored Guide edits. The diagnostics registry feeds the Guide manifest,
  so preserve generator order and finish with `node scripts/check-inventories.mjs`.

No commit, push, or rebase was performed.
