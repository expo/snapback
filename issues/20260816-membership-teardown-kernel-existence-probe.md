# plan_membership_teardown observes resource existence without role admission

**Filed:** 2026-08-16 · **Source:** LLP 0240 dual-round review (grok-4.6
xhigh check-order enumeration, latent flag; no production caller today) ·
**Systems:** Security/authorization, Memberships

**Related:** LLP 0240 D3 landing (ordering-oracle closure), LLP 0056

The kernel-only `plan_membership_teardown` (crates/snapback/src/storage/membership_plans.rs
~:1437-1452 at review time) reads resource existence with no caller role
admission. Every production and generated path was proven oracle-free by the
22-entry-point check-order enumeration; this kernel has no production caller,
so it is latent, not exploitable. Before any future caller is added, give it
the same admission-before-observation ordering and byte-equal refusal shape
as the rest of the planner surface, with the standard byte-equality test.
