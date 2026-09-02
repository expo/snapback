# Certify-green-but-runtime-red gaps: Page.hasMore, composite cursors, Id scalar rules

**Opened:** 2026-08-31 · **Systems:** snapback2 compiler/runtime contract
**Source:** first Clique diagnostic run — each cost the lane a redesign.
**Status:** resolved 2026-09-02.

Three places where `check` accepts a program the runtime then refuses
(the loud-refusal-over-silent-degradation law says these must converge):

1. `Page.hasMore` is typed in the lib but reading it is an `E_TYPE` at
   runtime.
2. Composite range cursors: an array cursor value refuses at runtime with
   "array is not an indexable scalar" (lane fell back to a global
   seq-counter cursor column).
3. `Id` is a distinct scalar kind at runtime: `""` is not a valid Id (lane
   used self-parented originals instead of empty-parent sentinels) and ids
   cannot be concatenated into text keys (lane's dmPairs needed a
   both-order check instead of a sorted concat key).

Each should either be refused at certify time with a rewrite, or accepted
at runtime. Repros reconstructible from the Clique run diary.

**Resolution:** (1) `Page<T>` is now only an array, so `.hasMore` is a
TypeScript certification error. (2) Composite cursors are the paved form: they
carry the full post-prefix index tuple, cursored indexes end in `id`, and wrong
shapes or element domains refuse as `E_ARGS_CURSOR_SHAPE` (or
`E_ARGS_CURSOR_INDEX`) in authored lowering and raw-IR certification. (3) An
invalid literal in an Id position refuses as `E_ARGS_ID_SCALAR`, while every
Id-to-text spelling refuses as `E_ARGS_ID_TEXT`; their authored rewrites paste,
type-check, lower, and certify. Compiler regression tests exercise all paths and
their complete diagnostic envelopes.
