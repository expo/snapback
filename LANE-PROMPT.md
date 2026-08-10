# Lane J — mutation-wire artifact identity (LLP 0093/0094)
Single ticket: issues/20260726-0093-mutation-wire-artifact-identity.md — read it fully, then
LLP 0093/0094's relevant sections. Carry build-time client artifact identity
(schemaHash/generation) on the mutation wire so read-set-free predecessor writes can be refused
at the migration floor; LLP 0094 wire-version negotiation (landed at cea20de7) is the compat
vehicle. Scope: Rust wire + schemas, both first-party clients, codegen emission, and the two
dated LLP amendments the ticket names. Acceptance per the ticket. This is a large lane — work
incrementally, keep the full lib suite green minus the filed pre-existing family, and if you
must cut scope, finish a coherent, landable vertical slice and document the exact remainder.
Rules: read CLAUDE.md first; @ref rules apply; volta run --node 24.18.0 node for all node tooling; /usr/bin/grep; demo codegen preflight (todo+rbac) before cargo test; no DYLD var; known filed pre-existing red = rehearsal fork-custody family; demos with invalid signed activations (latency-kanban, triage-graph, fleet-observatory-move1) cannot regenerate (ticketed, not yours); new proof gates must be classified in scripts/local-proof-selection-policy.v1.json; packages/snapback-client byte growth needs precise byte notes for the orchestrator. DO NOT git commit. Write the named notes file at repo root. Notes file: LANE-J-NOTES.md.
