# Snapback2 silently drops authored argument formats

Status: Closed
Date: 2026-09-06
Scope: Quarry compiler and native/client recursive argument admission

Frozen compiler e6c46a2 accepts `format handle` and `format url` on query,
mutation, job and channel arguments, including Optional/List wrappers, but
emits only Text maxima/minima. There is no format descriptor or generated
validation body. The same direct table columns retain their Text constraints.
The public guide says columns and arguments support formats and that formats
are enforced; no column-only restriction is established.

This is an independently executed compilation finding, not an API witness.
The complete fixture, probe and output remain in
`/Users/ccheever/clique-improvement/revisions/compiler-argument-format-audit/`.
The audit and source-bound scalar parity result are retained in
`benchmarks/runs/2026-09-06-clique-improvement/evidence/argument-format-audit/`.

Root chose faithful support under unattended delegation: optional Text format
`handle`/`url`, recursively validated before execution, enqueue, subscription
or publish. Reuse exact existing column-format semantics, with no argument
normalization, body guards, or column representation change. Engine, compiler
and twin owners agreed on new identities:

- `i53-codepoint-bytes-unicode-search-text-refinements-v5`
- `bounded-spike-rust-search-text-refinements-4`

Use the matched new compiler, owner and client. Certificate/value/evaluator
identities fence compiled program custody, but cannot retroactively repair old
raw ProjectJson v1 decoders that ignore unknown Text members when recertifying.
Arbitrary mixed-version raw-IR compatibility remains unsupported. Existing v4 witnesses remain version-bound historical
evidence. New native/client checks must verify valid controls, recursive
refusals and no side effects, using the existing error families. Keep this
ticket open until the coherent implementation is reviewed and landed.

## 2026-09-11 triage and resolution

**Priority:** P2. **Disposition:** Closed; the coherent v5 implementation and
direct-Quarry custody landed.

Commit `799ba19a6` added `ArgType::Text { min, format }`, recursive native/twin
admission, new fenced identities, and `engine/input_format_tests.rs`.
Commit `5c35f692d` then pinned direct Quarry's recursive argument descriptors
and pre-body refusals. Packaged `guide types` says argument minimums and
`format handle`/`format url` are enforced.

**Verification:** `cargo test -p snapback2-core argument_formats_` passed both
`argument_formats_share_exact_column_predicates_and_closed_wire_values` and
`argument_formats_admit_before_query_mutation_and_channel_and_fence_v4` on
2026-09-11. The compiler suite also passed `direct Quarry preserves recursive
text refinements and refuses them before the body`, and the evaluator suite
passed its native-v5 format/channel custody and recursive scalar admission
checks. The maintained mixed-version raw-IR exclusion remains explicit, not
unfinished ticket scope. The named compiler checks passed within a run that
finished 297 passed / 1 failed (`JourneyEffects.provider` declaration
mismatch); the complete compiler suite was not green.
