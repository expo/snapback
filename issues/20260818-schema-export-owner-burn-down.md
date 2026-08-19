# Burn down the schema-export ownership exception

Status: Open

`schema_export.rs` and `snapback-schemagen` remain in the rank-7 `snapback`
package after the Phase 2 flip. The generator joins schema carriers and route
facts from every architectural rank, so placing it in its manifest-assigned
activation/transport owners today would introduce an upward dependency.

Burn-down target: move each exported schema registration beside its owning
carrier, assemble the registry through downward dependencies in
`snapback-tools`, then move the generator and delete the named
`schema-export-facade-integration` membership exception by 2026-09-15.
