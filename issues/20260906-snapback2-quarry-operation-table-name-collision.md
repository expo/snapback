# Quarry operation names collide with table imports in generated code

Status: Open
Scope: Snapback2 compiler
Observed: 2026-09-06, fresh published 0.0.8 Astra-medium Clique M4
Owner: active compiler hygiene repair, separate from Unicode search

A table named `reactions` and an operation `query reactions(messageId: messages)`
are valid, distinct authoring concepts. The generated TypeScript imports the
table under the same binding as the exported operation. `snapback2 check`
refuses with `E_OPAQUE`: “Individual declarations in merged declaration
'reactions' must be all exported or all local.” The failure points at the
module's first line and emits a whole-module rewrite, exposing the lowering
implementation instead of a useful authoring boundary.

The builder renamed the operation to continue. The search compiler recipe
also used `findPeople` to avoid the same pre-existing collision. A product
repair should keep public operation/table names while giving generated
bindings distinct identities; verify ordinary table reads and emitted API
operation identity with a failing-before regression. Do not introduce a
second public authoring spelling or modify the running benchmark application.

Evidence: M5
`/Users/ccheever/clique-full-008-20260906/logs/astra-snapback2.ndjson`,
command item_158, and the builder's M4 diary. Source-frozen search compiler
`fcd45e71770e5c7ce79cacd2ab98b839b9c4712e` does not include this repair.
A separate Astra xhigh worker is reproducing and repairing the defect.
