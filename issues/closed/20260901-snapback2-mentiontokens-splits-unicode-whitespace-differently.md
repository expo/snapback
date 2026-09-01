# snapback2: MentionTokens splits Unicode whitespace differently across twins

**Status:** Closed
**Resolution:** Defined the Unicode White_Space tokenizer explicitly in Rust and TypeScript; added U+0085, NBSP, separator, and ASCII regressions.
**Systems:** snapback2, evaluator, core engine, corpus
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:655-673

Failure scenario: MentionTokens receives the string "@a\u0085@b". JavaScript split(/\s+/) leaves it as one token and returns ["a\u0085@b"], while Rust split_whitespace treats U+0085 NEXT LINE as whitespace and returns ["a","b"].

Why it happens: each twin delegates token boundaries to a different host-language whitespace definition. Text inputs admit this character, and the shared corpus has no Unicode whitespace boundary case, so a certified program returns different values by client arm.

Suggested fix: specify and implement one explicit code-point predicate/tokenizer in both languages rather than host defaults. Add cases for U+0085, NBSP, line/paragraph separators, and ordinary ASCII whitespace.
