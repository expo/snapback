# Burn down the schema-export ownership exception

Status: Closed — 2026-08-19

`schema_export.rs` and `snapback-schemagen` remain in the rank-7 `snapback`
package after the Phase 2 flip. The generator joins schema carriers and route
facts from every architectural rank, so placing it in its manifest-assigned
activation/transport owners today would introduce an upward dependency.

Burn-down target: move each exported schema registration beside its owning
carrier, assemble the registry through downward dependencies in
`snapback-tools`, then move the generator and delete the named
`schema-export-facade-integration` membership exception by 2026-09-15.

Resolution: each carrier-owning crate now exposes its own schema and artifact
registrations, using the common contract-leaf artifact helpers. Rank-7
`snapback-tools` assembles those registries through downward dependencies and
owns `snapback-schemagen`; the façade module and binary paths were removed.
The generator reproduced the committed `schemas/` corpus byte-for-byte, and
the exception was removed from both confinement artifacts without adding or
widening any dependency edge.
