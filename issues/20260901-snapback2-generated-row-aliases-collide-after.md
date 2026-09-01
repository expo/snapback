# snapback2: generated row aliases collide after name normalization

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/project.ts:537-540 and snapback2/packages/compiler/src/project.ts:590-603. A schema with legal table names `foo_bar` and `fooBar` normalizes both to `FooBarRow`, causing duplicate type aliases in `api.d.ts` and making generated consumer type-checking fail. API generation independently Pascal-cases table names without checking uniqueness after normalization. Detect normalized identifier collisions during schema validation and report both source names, or assign stable collision-free aliases and use them consistently throughout generated declarations.
