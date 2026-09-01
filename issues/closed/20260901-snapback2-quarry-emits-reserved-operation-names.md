# snapback2: Quarry emits reserved operation names as invalid TypeScript

**Status:** Closed
**Resolution:** packages/quarry/src/parser.ts now refuses ECMAScript reserved operation binding names at their declaration site; the delete-name regression is in packages/quarry/src/test.ts.
**Systems:** snapback2, quarry
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/parser.ts:174-185 and snapback2/packages/quarry/src/program.ts:66-71. A source declaration such as `query delete()` parses, then code generation emits `export const delete = ...`, which is invalid TypeScript and breaks the generated module. The parser validates the token shape but not whether the name is a legal ECMAScript binding, and generation interpolates it verbatim. Validate operation and generated binding names against ECMAScript identifier and reserved-word rules with a source diagnostic, or apply one documented collision-free escaping scheme consistently to exports and callers.
