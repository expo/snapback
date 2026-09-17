# Snapback 4: Nullable sync groups can be readable online and absent on devices

Status: Open
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)

## Evidence

Muse N2, reproduced by the lead with a standalone Rust probe using the built core/language libraries. Declare memberships(room: id ?, principal: principal) with a unique (room, principal) index and a (principal, room) discovery index; messages(room: id ?, body: text <=100) reads through `exists memberships[.room, viewer]` and syncs to memberships[.room]. Inserts/updates can be deny; seed as system.

Seed a membership for dev:alice with room:null and a message with room:null. Compilation has no diagnostics. Querying that message as alice returns the complete row. `Engine::snapshot("dev:alice")` returns `([], 1)`.

`partition::partitions`, membership discovery and intervals explicitly discard null groups. Schema validation permits optional target-group columns, so ordinary rule equality and partition reachability disagree. This finding concerns target group keys, not a null direct principal that is unreadable by every principal.

## Acceptance

Make the supported contract consistent: reject nullable target-group keys with an actionable schema diagnostic, or support null keys throughout group logging/acquisition/revocation. Do not patch only one null filter. Validate both authored Quarry and raw core schemas. Preserve existing valid required-key schemas, add an online/device regression, and document the supported form.
