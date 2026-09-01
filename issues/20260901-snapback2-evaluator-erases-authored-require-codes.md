# snapback2: evaluator erases authored Require codes and typed outcomes

**Status:** Open
**Systems:** snapback2, evaluator, execution states
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:394-396

Failure scenario: a query executes Require(false, "NOT_MEMBER"). The evaluator returns errorCode E_REQUIRE, canonical Error E_REQUIRE, and localState refused. The authoritative engine returns Denied with rule NOT_MEMBER; the same statement in a mutation becomes Rejected with code NOT_MEMBER.

Why it happens: Require throws an internal code E_REQUIRE:NOT_MEMBER, then evaluateCase at lines 966-975 splits on the colon and maps every exception to a generic refused state. This discards the authored code and collapses query denial, mutation rejection, and runtime refusal into one non-spec state.

Suggested fix: model the typed query and mutation outcomes explicitly, preserve the authored Require code, and reserve refused for runtime/value/transport refusals. Add query and mutation corpus cases with a non-generic code.
