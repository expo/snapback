# LLP 0184: two storage catalog rows await storage-owner operability classification

**Status:** Open

`storage.protected-erasure` and `storage.operation-coverage.activate` are the
last two control-catalog rows carrying the fail-closed default
(`operability: unavailable`, "not yet manually classified"). The default is
the designed safety posture (an untriaged row can never read as
agent-invokable), so nothing is broken — but LLP 0184 Phase 1 item 6 calls
for explicit authored values on every row, and these two need a security
judgment the LLP 0184 program deliberately did not make on the storage
owner's behalf:

- `storage.protected-erasure` (`POST /_snapback/api/storage/protected-erasure`,
  AdminWrite with a concrete-credential revalidation —
  `src/admin.rs` `resolve_protected_erasure_admin_credential`) is a
  destructive erasure surface. Plausible classifications: `(apiOnly, direct)`
  with `approvalPosture: humanApprovalRequired`, or `internal` if operator
  invocation is not meant to be supported outside guided flows.
- `storage.operation-coverage.activate` looks like an operator maintenance
  activation; `direct` with a note, or `internal`, per its owner's intent.

**How to apply:** the storage owner (or an author sitting) adds authored
entries to `control-catalog/operability-overrides.json` with reasons, and
regenerates. The LLP 0184 close-out (this program) records these two rows as
the only classification residue.
