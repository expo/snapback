# No in-database mechanism defends the database against a raw connection

Status: open
Date: 2026-08-25
Systems: snapback-kernel
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/shelved/20260825-test-support-swaps-the-production-trust-root.md,
  issues/shelved/20260825-the-critical-path-is-the-shared-surface-not-the-rows.md

## The sequence worth recording

A lane spent four rounds closing a row where a raw DML connection could advance the authorization
epoch. Rounds 1–3 failed because triggers read columns the attacker writes. Round 4 started from a
genuinely good insight:

> Pure trigger SQL cannot authenticate a writer from forgeable database values alone — every column a
> trigger can read is a column an attacker can write.

and concluded that authorization should live in kernel-only connection state, exposed to the trigger
through a transient SQLite application-defined function that raw connections do not have. The refusal
was real and reproducible:

```
RAW_DML_REFUSED reservation=no such function:
  __snapback_auth_invalidation_boot_reservation_matches_v1
```

The review then defeated it in three independent ways:

1. **Shadowed the function.** SQLite explicitly permits a later registration with the same name,
   arity and encoding to replace the prior definition on a connection. On an independent raw
   connection the reviewer registered that exact function to return `1`, advanced reservation,
   metadata, issuance and epoch in an `IMMEDIATE` transaction, minted the supposed kernel-only
   authority, and **retired the legitimate live issuer**.
2. **Turned the triggers off.** `SQLITE_DBCONFIG_ENABLE_TRIGGER=0` permitted direct reservation and
   epoch advancement with no function registration at all.
3. **Poisoned it permanently.** Advancing the reservation with `owner='not-a-uuid'` committed, after
   which every legitimate issuer installation fails `SNAPBACK_AUTH_INVALIDATION_CORRUPT`. No automatic
   recovery path exists; the database needs surgery or restore.

## The principle

**A SQLite application-defined function is a name, not a capability.** So is a trigger, which is a
connection-level setting its owner can disable.

Generalised, and this is the part worth carrying to other rows:

> No in-database mechanism can defend the database against a party holding a raw connection to it. The
> adversary is on the other side of the interface that would enforce the rule.

Every hardening that stays inside SQLite is therefore unwinnable in this threat model — a second
function, a MAC over the function's result, a canary table, a check that the function is "the real
one". Each is another name the attacker can also register.

## What this implies for the row, and for others like it

The row is not really about the epoch table. It is about **who can obtain a raw writable connection to
the authorization database**, which is a Rust visibility question and squarely within DERIVE: remove
the route, and the in-database machinery becomes belt-and-braces rather than the boundary.

That relocates the row onto the shared `test-support`/handle-accessor surface already identified as
this programme's critical path — another instance of a per-row fix turning out to be blocked on the
shared surface rather than on anything specific to its own row.

## Also recorded

The same review found the new binary **refuses to start on a database written by the older binary** —
it creates the new infrastructure, then rejects the database it just migrated with
`invalidation boot sequence and issuance projections must appear together`. That is an availability
defect independent of the security question and would brick existing installs on upgrade.

The reservation's own durable properties were genuinely clean — real `INTEGER PRIMARY KEY` rather than
a unique index, trigger-protected `UPDATE`/`DELETE`, `INSERT OR REPLACE` refused with recursive
triggers both on and off, no-op paths not consuming. They evaporate only once the function or trigger
configuration is attacker-controlled, which is precisely the point.
