# snapback2: Quarry focal patches hoist field preludes out of callbacks

**Status:** Closed
**Resolution:** packages/quarry/src/program.ts now evaluates focal patch fields in authored order inside the old-row callback, with generated block-callback lowering in packages/compiler/src/compiler.ts; the nested-reference regression is in packages/quarry/src/test.ts.
**Systems:** snapback2, quarry
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/program.ts:430-442 and snapback2/packages/quarry/src/program.ts:501-508. For `~posts[id] { authorName: .author.name }`, lowering emits the reference lookup for `.author.name` before the update callback, where the synthetic old-row binding is not in scope, so execution fails with an undefined variable. Patch field expressions contribute prelude statements, but the focal-update builder places those statements outside the callback that defines the row binding. Move each patch expression prelude and value evaluation inside the update callback, preserving authored order and the old-row scope.
