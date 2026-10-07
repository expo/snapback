# Native.2 supplied list helper leaves both independent apps with TS2769

**Opened:** 2026-10-07, Lane P3 Round 2
**Status:** Open
**Area:** Native benchmark observation helper
**Related:** LLP 0201.000; Phase-2 rerun results

Both independent builders report the same retained typecheck error in unchanged
`vendor/helper/index.ts:199`: an optional `ViewabilityConfig` is not assignable
to the required callback-pair config. Their Hermes exports succeed, but neither
full TypeScript check is green. Source audit passivity and the existing mounted
runtime tests do not establish this public type surface compiles in both apps.

Fix and typecheck the supplied wrapper against pinned RN 0.86.3 without weakening
the zero-threshold observer or changing application callback semantics. Include
both independent consumers' type configurations as regressions; requalify the
affected callback composition, rendered/native parity and mounted mutation
controls if implementation bytes change. Cut new candidate bytes before a new
pilot. Builder typecheck logs remain in the archived custody evidence.
