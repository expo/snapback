# sessions-and-principals.md misdocuments where the impersonation capability lives

**Opened:** 2026-08-08 · **Severity:** P2 (documentation correctness)

guide/auth/sessions-and-principals.md:164 (the carriers table) says the
impersonation capability is "the `impersonation` field of the server's
`dev.ready.json` startup sidecar". It is not a field of the ready file: the
ready descriptor carries `impersonationCapabilityFile` — a path that must
exactly equal `<ready-file>.impersonation`, a separate sibling file holding
the `sbic_…` capability.

Evidence: src/host_ops.rs:363-371; demos/_kit/server-process.mjs:904-921
(`readSpawnedImpersonationCapability`).

A cold agent parsing `dev.ready.json` for an `.impersonation` field fails
on its first command. Fix the cell to: "the sibling file named by the ready
file's `impersonationCapabilityFile` (always `<ready-file>.impersonation`)".

Found by the 2026-08-08 comprehensive docs review (auth slice).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). The carriers-table
cell now says the capability is the sibling file named by the ready file's
`impersonationCapabilityFile` (always `<ready-file>.impersonation`), with a
short paragraph stating the descriptor carries only the validated sibling
path — never bytes — and pointing at the kit's
`captureImpersonationCapability` reader.
