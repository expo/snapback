# Reads inside mutations obey viewer read rules — admin flows get silent nulls

**Opened:** 2026-08-31 · **Systems:** snapback2 rules, engine, guide
**Source:** first Clique diagnostic run — two failed designs before the workaround.

Inside a mutation, `db.get` of a row the viewer's `viewerIs` read rule
hides returns null silently. Group-admin flows (remove/promote reading the
target's member row) therefore see absent rows and misbehave; the cold lane
burned two designs before splitting members into an inbox-pointer table +
roster source-of-truth table readable to admins. Combined with read-rule
uniformity over capped scans (`E_STRUCTURAL_COUNT`), nothing in the guide
warns about either behavior. This is the LLP 0331 actor/authority gap
surfacing in practice, and LLP 0329.014.004 dimension L's answer (declared
per-mutation read views / sealed operation authority) is the paved design.
Minimum: a guide page + a diagnostic when a mutation's read is
rule-narrowed; better: `reads:` declarations per mutation.
