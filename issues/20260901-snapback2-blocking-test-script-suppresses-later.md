# snapback2: blocking test script suppresses later compiler failures

**Status:** Open
**Systems:** snapback2, test script, rules
**Severity:** P3
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/scripts/test.sh:11

Failure scenario: bun run check and bun src/test.ts both fail. The && operator prevents the compiler test suite from running, so the blocking command reports only the first failure and requires another repair cycle to expose the second.

Why it happens: the outer script accumulates subsystem statuses, but the compiler leg is one fail-fast compound command. This contradicts the script's stated and rules/RULES.md binding purpose: everything blocking in one run, reporting every failure.

Suggested fix: execute compiler type checking and compiler tests as separate status-accumulating commands, preserving both outputs and the final nonzero status. Add a script self-test/fake commands proving both run after the first fails.
