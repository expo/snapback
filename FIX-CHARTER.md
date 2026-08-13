# Charter — integration fix: semantic-generation canonicalizer fails a merged-tree valid case

**You do not commit.** Use apply_patch. Never run git commit/push/rebase.

Repro: `env -u FORCE_COLOR node packages/snapback-codegen/authoring-validation.test.mjs`
fails at its validCase (invoked ~line 1013) with
CODEGEN_WRITE_FAILED: "runtime source could not be canonicalized: Unexpected
token (2:5)" thrown from canonicalExecutableSource
(packages/snapback-codegen/semantic-generation.mjs:85, via
executableOperation:160 / semanticOperation:192 / buildSemanticGenerationInputs:268).

Each lane passed this suite alone; the union broke it. Diagnose which
operation/source form the failing fixture produces on the merged tree and why
the canonical parser rejects it (wrong parser mode — module vs script vs
TypeScript? JSDoc/emitted-form change from the client-lifecycle lane? a
source kind S3 never saw?). Fix the CANONICALIZER'S coverage so every
legitimately emitted executable source form canonicalizes — do not weaken
identity discipline (evidence-vs-executable separation stays; no catch-and-
skip: an unparseable source must still refuse, but legitimate forms must
parse). Add a regression test for the exact form.

Then run the COMPLETE codegen package chain
(`env -u FORCE_COLOR npm test --workspace @expo/snapback-codegen`) and the
semantic-generation golden/rotation suites; all must pass. If a golden
vector legitimately changes, regenerate it and explain why.

Report (REPORT-fix2.md): root cause, the source form, the fix, chain result
verbatim tail, any golden changes.
