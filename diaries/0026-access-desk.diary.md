# 0026 — Access Desk membership workout

## 2026-07-27 — resource bootstrap, admission, and protected writes

Access Desk is a workspace notes kernel. It atomically creates a workspace and
owner membership, proves an outsider's membership-filtered query is empty,
admits another principal through an authority-creating mutation, and refuses
an unrelated writer at the transactional permission check.

### What felt good

- Membership bootstrap kept the resource and first authority row in one
  mutation. There was no observable workspace without an owner.
- Query membership declarations and handler permission checks made read and
  write authority separate and explicit.
- The outsider read returned an empty result, which composes with a future
  membership change and live wakeup without disclosing resource existence.

### What felt bad or surprising

- I initially expected a denied membership-gated query to throw. The empty
  result is deliberate and documented, but it differs from the mutation
  permission helper's explicit refusal.
- Membership insertion takes one record containing both membership fields and
  the resource field. My first handler shaped those as separate arguments.

Compared with Supabase row policies, Snapback made authority creation and the
transactional write check more explicit, at the cost of learning two distinct
denial semantics. The final app keeps both cases adjacent in acceptance so the
difference remains visible.
