# Review artifact: LLP 0268 — codex family

Target: `llp/0268-broadcast-shaped-realtime.rfc.md`

## Round 1 — 2026-08-16

- **Reviewer:** Codex gpt-5.6-sol, model_reasoning_effort=xhigh, read-only
  sandbox, fresh non-interactive session, blind to the other family's review.
- **Revision under review (v0.1):** sha256
  `c3aa642869535322206769a85b338ad674e3e7c3fce7f4782d1b3314b726a72f`
  (authoring-worktree bytes, pre-commit).
- **Verdict:** NOT READY.

1. SEVERITY: MATERIAL — llp/0268-broadcast-shaped-realtime.rfc.md:61 (§1.1 The rule) — The RFC never requires a mechanical binding between the checked admission scope and the result scope. I opened LLP 0170 lines 64–69 and 178–182; it explicitly says an argument-addressed membership check is insufficient without proved equality binding the queried resource to that argument. Here, the RFC permits the group identifier to be a query argument, keys the result instance and establishment scope separately, and asks G0 only for scope identity/equality normalization. It does not require proof that admission for P authorizes the result requested by args Q, nor does §6.2 test that adversarial mismatch. Class-1 invariance at fixed args does not close this channel: a P member could receive Q’s authority-independent base unless G0 certifies the admission-scope/result binding. That missing property must be an explicit G0 input and acceptance case.
2. SEVERITY: MINOR — llp/0268-broadcast-shaped-realtime.rfc.md:162 (§2.1 Group identity and establishment) — The ephemeral precedent is incompletely characterized. I opened `src/ephemeral.rs` lines 6481–6502 and `src/server.rs` lines 30120–30233: `ensure_authorized` checks an already-populated `AccessPolicy`, while sessions-mode durable `permissionBacking` authorization actually occurs in `authorize_bound_ephemeral_room`, which acquires and retains a `RoomAuthorityPermit` across the lookup, registration, and transport boundary. The RFC later mentions `RoomAuthorityRegistry`, so the proposed design is not necessarily unsound, but the grounding citation should name this load-bearing establishment path rather than making `ensure_authorized` appear sufficient.
## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Codex gpt-5.6-sol xhigh read-only session; delta review
  of v0.2 against both round-1 reviews.
- **Revision under review (v0.2):** sha256
  `fcb0194016e4fa223423d72d414f50737569f210bbac7fba830710e58bbeee3a`.
- **Verdict:** READY (all round-1 findings verified fixed; no new defects).
