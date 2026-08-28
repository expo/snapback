# Decide how non-`SNAPBACK_*` diagnostics enter the errors-as-docs ledger

**Status:** Closed
**Owner:** Charlie Cheever / Claude (LLP 0193 owner)
**Systems:** Diagnostics, Guide, Codegen, Testing
**Date:** 2026-08-28
**Related:** LLP 0193, LLP 0317.000 O44/P4, Lane L8

## Question for LLP 0193

Should stable non-`SNAPBACK_*` product diagnostics join the existing
diagnostics registry and errors-as-docs ledger, or should a parallel extractor
and completeness check own them?

Lane L8 deliberately does not answer that program-level question. It routes
only the codes emitted by the eight published 0.1.29 Snapback benchmark lanes.
The population question is profile-neutral: the observed codes crossed
Explicit and Familiar authoring, and the eventual completeness rule must serve
both.

## Evidence

Those run logs emitted five non-`SNAPBACK_*` product diagnostics that the
current registry extractor cannot see:

- `CODEGEN_MODULE_EVALUATION_FAILED`
- `CODEGEN_MODULE_PARSE_FAILED`
- `CODEGEN_POLICY_INVALID`
- `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS`
- `SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED`

`FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS` already routed at
`guide/operating/diagnostics.md#anti-patterns` (a bullet under that heading).
The other four previously had no occurrence under source `guide/` pages. L8
added profile-neutral Codegen routes in
`guide/getting-started/generated-artifacts.md`, an exact structured-ID route in
`guide/getting-started/your-first-backend.md`, and retrieval-eval coverage for
the lane searches. That closes the observed retrieval misses but leaves all
five codes outside LLP 0193's ledger.

The current extractor is intentionally narrower:

```js
export const DIAGNOSTIC_CODE_PATTERN = /(?<![A-Z0-9_])SNAPBACK_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_])/gu;
```

Source: `scripts/diagnostics-registry-source.mjs`.

## Decision required

Choose and document one owned completeness path that:

- discovers stable non-`SNAPBACK_*` product codes without weakening the
  existing `SNAPBACK_*` check;
- gives each discovered code an errors-as-docs ledger disposition and checked
  author-facing route; and
- migrates or explicitly dispositions all five observed prefix-invisible codes
  above.

The choice belongs to LLP 0193 because it changes the population and grading
unit of that program, not merely one guide route.

## Resolution (2026-08-28)

**Decided: they join the existing registry and ledger. No parallel extractor,
no parallel ledger, no second completeness check.** Recorded as a dated
amendment in `llp/0193-errors-as-docs-completeness.plan.md`
(§"Dated amendment — 2026-08-28: non-`SNAPBACK_*` product diagnostics join this
ledger"), which is where the population and grading unit of that program are
owned.

The deciding reason is exit criteria 2 and 4: they range over "every ledger
entry classified agent-triggerable" and are validated by a benchmark run
encountering zero B/C refusals. A second ledger lets a run be clean against the
`SNAPBACK_*` half while the author's actual experience is ungraded. Lexical
prefix is not a property of the set LLP 0186 W3's bar is about.

**The rule that makes it safe** is that intake changes, not the pattern. The
`SNAPBACK_*` sweep is untouched. Non-`SNAPBACK_*` codes enter through a second,
disjoint, **emitter-scoped** rule: a code is admitted where a *declared product
diagnostic emitter* constructs it — currently only the codegen diagnostic
channel in `packages/snapback-codegen/` — from a checked allowlist.
Prefix-widening is refused because SCREAMING_SNAKE is also the **application**
refusal namespace (`ctx.refuse('MESSAGE_NOT_FOUND')`, `refusals: [...]`), and
an app-authored code is indistinguishable from a product code by shape. Emitter
scope makes the population decidable by construction instead of by a growing
exclusion list.

All five observed codes are dispositioned in the amendment's table: all are
codegen-channel emissions, all are agent-triggerable, and all five already
carry the checked author-facing route lane L8 landed
(`guide/getting-started/generated-artifacts.md#recover-from-policy-parse-and-broad-module-evaluation-failures`,
`guide/getting-started/your-first-backend.md#structured-stored-values`,
`guide/operating/diagnostics.md#anti-patterns`). They enter at Phase 1 intake
with those anchors; grades belong to the grading lane and are not asserted in
the amendment.

**Follow-up filed:**
`issues/20260828-0193-emitter-scoped-diagnostic-intake.md` — the extractor,
`codeNamespace` field, registry-chain regeneration, ratchet extension, and the
negative test proving an application's `ctx.refuse` codes stay out.
