# Decimal and Money columns are unreachable from any authoring surface

**Opened:** 2026-09-02 · **Systems:** snapback2 engine, compiler, Quarry
**Author:** Claude Fable 5.1 (orchestrator) · **Date:** 2026-09-02

With the TypeScript authoring surface deleted (LLP 1007 §4b, LLP 1004
amendment), `t.decimal`/`t.money` columns, their type analysis, and the engine's
`Decimal`/`Money` variants can no longer be declared by any author: Quarry
refuses `decimal` and `money` as not-in-Quarry (LLP 1007 §7 kept them out of the
grammar on purpose). Neither acceptance bar in `rules/NOT-DOING.md` needs them.

Decide one of: (a) spell them in Quarry when a bar asks for money, or (b) delete
the engine variants, the compiler's Decimal scaling analysis, and the lib.d.ts
declarations (RULES: delete, don't deprecate). Until then the guide says they
are not authorable. Do not grow the analysis.

**Resolved 2026-09-02 (`929a45268`): option (a), by author ruling.** Decimal and
Money implement LLP 0329.014.004's exact value model for the paper archetype
apps (expense splitting, marketplaces), so the author ruled to keep them and
give Quarry the spelling: `decimal <scale>` and `money <CUR> [scale]` column and
argument types, decimal literals as whole units scaled at certify time, nominal
typing, and `E_DECIMAL_SCALE` refusals mapped to `.q` sites. The engine
variants and the compiler's scale analysis are unchanged.
