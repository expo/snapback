# Diary 0045: Private Incident Room — Snapback × Zero

**Date:** 2026-08-01  
**Protocol:** LLP 0138 / `private-incident-room.v1.json` (8 checks; 10 incidents)  
**Arms:** Snapback source-local Ibex/SQLite; Zero 1.8.0 `zero-cache-dev` / PostgreSQL 17  
**Machine:** frozen program machine, Apple M5 Max, Node 25.9.0, Bun 1.3.12  
**Assistance:** no product credentials or human intervention; the program's shared dependency install and PostgreSQL process were reused. Each arm owned and cleaned its server/cache resources.

## Contract and first-attempt freeze

This app tests a protected room, not merely filtered presentation. Commander,
responder, observer, and outsider roles had to produce different delivered
rows and write authority. Revocation had to retire already delivered rows,
deny a delayed pending write at server execution, and prevent predecessor rows
from surviving a user switch. A second authenticated context changed
membership out of band so the test did not depend only on the client under
test asking to refresh.

The first Snapback implementation used an authenticated live query with the
schema's `incidentMembers.memberOf(...)` capability, JS mutations for role
checks, the real email-code mailbox sign-in flow, and the real WebSocket
client. The first Zero implementation used mapped PostgreSQL tables, ZQL
queries, shared client/server mutators, bearer actor context, and a real local
`zero-cache-dev`. Neither arm claimed hostile-device byte secrecy.

## Snapback chronology

The guide path was `guide/index.md`, auth, backend queries/functions, live
queries, React, and acceptance. The membership declaration made non-delivery
and live invalidation concise. Codegen produced five tables and five
operations without warnings. Four JS mutation result contracts were correctly
reported as degraded because those handlers do not declare a precise result
shape.

The real provider auth flow was more setup than a static test token, but it
paid off in the user-switch witness: the predecessor context blanked its rows
and the outsider successor received none. A delayed client intent was refused
after membership disappeared, proving authority at execution rather than
enqueue. One authoring gap was concrete: private membership backing rows do not
expose their row IDs, and membership insertion returns `null`, so a natural
commander-removes-other-member mutation was not directly expressible. The
witness uses responder self-removal from a second authenticated context. That
still proves out-of-band invalidation but exposes a Snapback membership-admin
DX limitation.

Authored source/touch count, excluding generated artifacts: 7 Snapback/runtime
files and 337 lines (48 schema, 47 functions, 39 handlers, 1 seed, 162
acceptance, 16 React, 24 README). The retained receipt is
`apps/private-incident-room/evidence/snapback.v1.json`: 8 pass, 0 GAP, 0 fail,
cleanup green. The final identity-bearing rerun observed 239.4 ms revocation
retirement, 45.4 ms out-of-band retirement, zero outsider rows, and three live
WebSocket clients. Its startup identity records commit
`15a4e35001611a4a73161efc63e527d71b5519f7`, `gitDirty:true`, and verdict
`unpinned-binary`.

## Zero chronology

Zero's role-filtered query and mutator model was easy to read. The same actor
context guarded query delivery and server mutation execution, while the
materialized view made row retirement directly observable. The first local
run exposed two setup defects: `zero-cache-dev` needed the shared `.bin` in
`PATH`, and PostgreSQL snake-case columns needed explicit Zero mappings. Those
were harness fixes, not product findings.

Expected observer/outsider writes produce loud `ApplicationError` logs even
when the typed mutation result correctly reports an application refusal. The
API is sound, but the logs made intentional negative tests noisier than their
Snapback equivalents. The runtime required an owned database, app ID,
replication slot, replica file, API server, cache process group, and bounded
cleanup. Once isolated, it was reliable and fast.

Authored source/touch count: 8 Zero/runtime files and 181 lines (29 schema, 14
queries, 22 mutators, 61 runtime, 7 SQL, 3 validation, 28 acceptance, 17
React). The retained receipt is
`apps/private-incident-room/evidence/zero.v1.json`: 8 pass, 0 GAP, 0 fail,
cleanup green. Representative observations were 240.1 ms revocation
retirement, 26.7 ms out-of-band retirement, zero outsider rows, and three live
Zero WebSocket clients.

## Replicache control

Not applicable. LLP 0138 reserves the Replicache control for Field Notebook;
folding it into this protected-partial-sync score would blur two different
products and contracts.

## Immutable first-pass comparison

The observable result was a tie under the frozen checks: both arms passed all
eight, including the two safety-critical non-delivery transitions. Zero's
schema/query/mutator code made permissions compact and its measured local
retirement was slightly quicker, but these single-machine values are not a
performance benchmark.

Snapback was materially simpler to operate: one qualified binary, generated
contract, and owned state directory versus PostgreSQL plus API plus cache plus
replication cleanup. Its capability-derived membership invalidation also made
the security intention explicit in the schema. Zero was better at exposing
ordinary row IDs and SQL-backed administration; commander removal is a normal
database mutation there, while Snapback's hidden membership-row identity
forced the narrower self-removal witness.

Both products required explicit application discipline on account switching.
Snapback blanked the predecessor query through its auth coordinator; the Zero
surface destroyed the predecessor view and created a separately keyed
successor. Neither result demonstrates secrecy against an attacker who already
controls the device.

## Findings

- **Capability:** both products enforce protected delivery and live revocation. Witnesses: `ir.read-visibility`, `ir.revocation-retirement`, and `ir.out-of-band-permission-change`.
- **DX friction:** Snapback lacks an ergonomic public handle for commander-remove-other on private membership rows. Witness: the self-removal implementation behind `ir.out-of-band-permission-change`.
- **Operations:** Zero's local proof needs PostgreSQL logical replication, API/cache processes, native SQLite, slots, and exact cleanup; Snapback's arm is substantially smaller operationally.
- **DX friction:** expected Zero application refusals are logged loudly despite being typed result values. Witness: `ir.write-authority` and `ir.pending-write-revocation`.
- **Security boundary:** both user-switch witnesses prove client-view custody, not hostile-device byte secrecy. Witness: `ir.user-switch-custody`.
- **Guide assessment:** the Snapback guide correctly led to membership-dependent protected delivery and auth switching; the commander-removal problem is an API capability/DX issue, not missing guide knowledge.

## Dated remediation appendices

### 2026-08-01 — runtime and cleanup corrections

The Zero first run failed before product checks because its child executable
was not discoverable and then because mapped column names were incomplete.
The final runtime launches the exact shared binary, owns a unique database and
app ID, tolerates only the benign duplicate-close condition, removes its
replication slot/database/replica, and retains an 8/8 receipt. These changes do
not rewrite the first-pass comparison.
