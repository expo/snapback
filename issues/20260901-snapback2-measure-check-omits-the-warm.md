# snapback2: measure check omits the warm-build budget

**Status:** Open
**Systems:** snapback2, measurement, rules
**Severity:** P3
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/scripts/measure.mjs:126-128

Failure scenario: a warm release build takes 301 seconds but exits successfully, while all other scored steps remain within budget. measure.mjs --check exits 0 despite violating the five-minute Full build, warm cache budget in rules/RULES.md.

Why it happens: warm_build_s is measured and recorded, but the scoreChecks lists at lines 286-295 omit it entirely. Successful duration therefore never participates in the blocking verdict.

Suggested fix: score warm_build_s against the exact Full build, warm cache rule row and extend the self-test with an over-budget successful step that must set a failing exit status.
