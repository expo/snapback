# Approved recursive argument-format support

Root decision under unattended user delegation,2026-09-06. Engine, compiler and
twin owners have all confirmed the following identities and may implement in
their sole-writer lanes after the current coherent work. This is not shipped.

valueModelVersion: i53-codepoint-bytes-unicode-search-text-refinements-v5
evaluator: bounded-spike-rust-search-text-refinements-4

Extend ArgType.Text with optional format using the existing schema::TextFormat
camelCase enum (`handle` | `url`). Canonical field order: max, optional nonzero
min, optional format. Absent/native None format is omitted. Match native serde
Option canonicalization for raw IR, including null if accepted; this does not
make null a supported authored descriptor option. Unknown variants refuse.

Preserve authored formats recursively through List/Optional on query, mutation,
job and channel arguments. Validate before execution, enqueue, subscription or
publish; no body guards, no input rewriting or normalization. Existing limits,
C0/cardinality behavior and error families remain. Public API stays string-typed.
Columns and their existing constraint representation remain unchanged.

Reuse exact existing column-format semantics: handle allows lowercase ASCII
letters,digits,underscore (empty allowed if minimum0). URL requires exact lowercase
http:// or https://, nonempty suffix, and no Unicode whitespace/control. This is
not a new full URL parser. Match Rust whitespace/control with actual JS/pinned
Unicode evidence; do not substitute JavaScript whitespace shorthand.

Compiler owns lowering/private descriptor validation/diagnostic rendering.
Engine owns native ArgType/ir-contract/certification/preentry/job/channel checks.
Twin owns recursive admission/hash/custody parity. Old v4 decoders must not
silently accept and discard positive format constraints. Preserve all prior v4
source snapshots and witnesses under their original identities; never relabel
those tests as v5. Final v5 runtime witnesses cover every argument-bearing path,
recursive wrappers, omitted format and valid/invalid Unicode controls, with no
side effects on refusal. Keep the exact previous minimum cases as inherited
version-bound evidence and run affected current-identity checks.
