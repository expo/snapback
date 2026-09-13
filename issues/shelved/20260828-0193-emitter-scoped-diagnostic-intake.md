# Implement emitter-scoped intake for non-`SNAPBACK_*` product diagnostics

**Status:** Open
**Opened:** 2026-08-28
**Owner:** LLP 0193 (Charlie Cheever / Claude)
**Systems:** Diagnostics, Codegen, Guide, CI
**Related:** LLP 0193 (dated amendment 2026-08-28), LLP 0317.000 O44/P4 lane L8,
`issues/closed/20260828-non-snapback-diagnostic-registry-scope.md`

## What was decided

LLP 0193's 2026-08-28 amendment ruled that stable non-`SNAPBACK_*` product
diagnostics join the existing registry and ledger — one ledger, one grade
vocabulary, one ratchet — and that they enter through a **second, disjoint,
emitter-scoped discovery rule**, never a widened prefix pattern. This ticket is
the implementation of that rule. The decision itself is closed; do not reopen
it here.

## Work

1. **Emitter allowlist.** Add a checked allowlist to
   `scripts/diagnostics-registry-source.mjs` naming the declared product
   diagnostic emitters. First and currently only entry: the codegen diagnostic
   channel in `packages/snapback-codegen/` — the
   `{ code, severity, subsystem, message, … }` records pushed onto
   `diagnostics`, plus the `err`/`warn`/`fail`/`refuse` helpers that build them
   (`index.mjs`, `generate-worker.mjs`).
2. **Leave `SNAPBACK_*` intake untouched.** `DIAGNOSTIC_CODE_PATTERN` and the
   existing source-site classification must not change behaviour. Add a
   negative test proving the lexical sweep's output is byte-identical before
   and after.
3. **Namespace field.** Registry entries carry `codeNamespace`
   (`snapback` | `codegen`), reporting-only. No gate branches on it.
4. **Regenerate the chain.** `guide/reference/diagnostics-registry.json` feeds
   the guide manifest, which the embedded artifact carries; run the generators
   and `node scripts/check-inventories.mjs`, not a diff grep.
5. **Admit the five observed codes** with the intake dispositions the amendment
   tabulates (`CODEGEN_POLICY_INVALID`, `CODEGEN_MODULE_PARSE_FAILED`,
   `CODEGEN_MODULE_EVALUATION_FAILED`,
   `SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED`,
   `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS`) and let the grading lane assign
   grades. Their guide anchors already exist and are retrieval-eval covered.
6. **Extend the Phase 3 ratchet** so a new agent-triggerable code from a
   declared emitter cannot land without a remediation or resolving anchor,
   with the same negative tests the `SNAPBACK_*` half has.

## Guardrail

The rule that makes this safe is that **application** refusal codes are not
product diagnostics. `ctx.refuse('MESSAGE_NOT_FOUND')` and
`refusals: [...]` entries in app source are app-owned and must never be
admitted, graded, or routed. Any implementation that can admit an app-authored
code — including any that widens the lexical pattern — is wrong even if the
five observed codes come out right. Add a positive test that a demo's
`ctx.refuse` codes stay out of the registry.
