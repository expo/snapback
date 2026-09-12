# Quarry first-pass grammar still mismatches what Clique builders type

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 Quarry parser/diagnostics, published guide
**Related:** Clique Linux lanes on `snapback2@0.0.24` and `0.0.25`

## Symptom

Every first-pass `snapback2 check` on tonight’s Clique runs died on syntax the builders reasonably guessed from TypeScript/SQL and from older Snapback 1 docs. Diagnostics eventually taught the right form. The published first examples still do not.

Independent 0.0.24 and 0.0.25 Astra lanes hit the same set:

1. `maintain … public` / missing `read <- allow` → `E_QUARRY_SYNTAX` “unknown maintain property public”, “requires read <- rule”.
2. Comments: `#` and `//` refused; only `--` works.
3. `count(text)` unsupported; caption length became `body = slice(body, 0, 500)`.
4. Text concatenation unsupported; split into two queries.
5. Object arrays refused (scalar arrays only) when batching search lanes.
6. Ambiguous index (`byId` vs `byName`) without `by <index>`.
7. Point-delete of a missing digest/custody row → `E_REQUIRE:NOT_FOUND` (optional cleanup must be guarded).
8. `E_GUIDE_UNKNOWN` for importing JSON config into Quarry; builders generated constants at startup instead.
9. `held_search` `E_ARGS_TYPE` and dynamic merge `E_QUARRY_SYNTAX` while rewriting 1,000-lane search (also noted on the hub-scale envelope ticket).

## Evidence

- 0.0.25 `evidence/check-m2.log` (maintain public / read <- rule).
- 0.0.25 run-log epochs `1789165609` (comments), `1789164691` (`E_GUIDE_UNKNOWN`), `1789170273` / `1789170312` (arrays, maintain sum, held_search).
- 0.0.24 run-log epochs `1789163102`, `1789164817`, `1789165007`, `1789169597` (point-delete of absent digest).

Fixing all nine in one pass is fine; splitting is also fine. Do not “fix” a real bound by weakening certification.

## Requested outcome and acceptance

For each item: either accept the current grammar and put the **first** worked example in the relevant guide page (maintain, expressions, comments, arrays, indexes, delete, config), or accept the guessed form.

Acceptance: a cold builder following `snapback2 guide` for maintain + a caption check + a JSON window config does not hit (1), (2), (3), or (8) on the first `check`. Items 5–7 and 9 need a diagnostic rewrite line that names the legal form, not only the refusal.

## Resolution (2026-09-11)

The packaged guide now leads with `read <- allow`, `--` comments, `slice` for
captions, separate text fields, scalar arrays, explicit `by` selection, guarded
optional deletes, generated Quarry functions for JSON integer windows, and the
typed two-query global-search pager. The parser, binder, certifier, and runtime
refusals name those legal forms without widening Quarry or its bounds.

An installed-package test resolves the public `maintain`, `expressions`, and
`config` guide topics, runs the packaged JSON generator, and completes the
resulting first `snapback2 check`. Compiler coverage executes absent and present
guarded deletes; Rust coverage pins the held-search and missing-row rewrites.
The integrated compiler suite passes 317/317 with the rebuilt checker.
