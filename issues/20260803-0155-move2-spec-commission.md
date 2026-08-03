# 0155 Move 2 Spec commission — the local persistent store

**Status:** Open — Spec authored as **LLP 0166**
(`llp/0166-local-persistent-store.spec.md`, Draft v0.1, 2026-08-03); the
dual-family super-refine loop is the remaining exit condition, then this
ticket closes pointing at it. Acceptance is Charlie's.
**Opened:** 2026-08-03 (wave-3 Track A; Charlie ruled spec-first)
**Related:** LLP 0155 §Move 2 (the charter — read first), LLP 0157
(Accepted; plan identity + completeness witness this store consumes),
LLP 0043 (offline replay retention), LLP 0053 (authorization
invalidation), LLP 0090 (resumable snapshots), LLP 0161 OQ5 / LLP 0162
§Non-goals (the unowned client-arm seam this Spec must answer), the B1
RN durable RQS store (the shipped on-device persistence substrate)

Author the Move-2 owning Spec: the client-side persistent store that
retains LLP 0157 composites keyed by plan identity and syncs them
query-driven. Scope per 0155 Move 2, including at minimum: retention
keyed by PlanHashV1/QueryMaterializationKeyV1; registered/preloaded
queries as the sync specification (no separate replica definition);
completeness-honest offline answers (a plan answers locally with
authority only when its witness and capability class permit); query
lifecycle/TTL and eviction; the resume/delta relationship to the shipped
RQS machinery; and the explicit seam answer for 0161 OQ5 — which
agent-safe properties (0162's primitives) the client store needs
natively versus never. Coordinate with the Track B Specs (0163–0165)
rather than duplicating their contracts.

Process: next available LLP number at authoring time; llp-create
conventions; dual-family super-refine loop per LLP 0005; acceptance is
Charlie's — do not flip past Review. **Exit:** the Spec on main with a
concluded loop and its number recorded here; this ticket closes pointing
at it; the implementation program is a separate wave-3 commissioning
after acceptance.
