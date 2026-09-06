# Snapback2 silently drops authored argument formats

Status: Open
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
