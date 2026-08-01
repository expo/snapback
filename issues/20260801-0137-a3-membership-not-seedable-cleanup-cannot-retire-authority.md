# A3 sweep: membership tables cannot be seeded or reset, so a fixture reset cannot retire authority

**Opened:** 2026-08-01
**Systems:** Auth, Storage, Versioned seeds
**Related:** LLP 0137 (A3 arm), LLP 0056, LLP 0109, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f1-membership-not-seedable-cleanup-cannot-retire-authority.json

Naming a membership table in `snapback/seed.json` with an EMPTY row array
refuses at install with `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`
("sessions-mode versioned seed cannot install membership rows"). Because
unnamed tables are not reset targets, a versioned reset-install restores all
app data to the literal fixture while every membership seat survives — the
receipted reset cannot retire authority, and a fixture cannot establish it.
The scoped-roles design reserves a "trusted migration/import context" that
holds row ids; the versioned seed is exactly such a context but is refused.

The A3 arm worked around it with per-persona `leaveOrg` self-removal before
the reset, and post-reset verification had to re-redeem a restored invite to
earn a seat back (evidence: A3-12 in the arm capsule).

Fix shape: a declaration-checked trusted-import lane — fixture membership
rows admitted only when they satisfy the declared roles, and named membership
tables become reset targets. Witness: seed with fixture seats installs; reset
deletes runtime seats and restores fixture seats; runtime-only principal is
denied after reset.
