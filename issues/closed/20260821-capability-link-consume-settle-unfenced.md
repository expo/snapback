# `consume_capability_link_use` and `settle_capability_link_use` commit with no admission fence

**Status:** Resolved
**Filed:** 2026-08-21
**Found by:** grok-4.6 review of `244385daa`
**Related:** `issues/20260821-capability-link-mint-revoke-deadlock.md`

## Finding

`AdmissionEffectGuard` is the atomic epoch-retirement fence: LLP 0058's gate
algorithm requires durable generation and admission epoch to be checked
atomically at commit, and that guard is what holds the admission mutex across
the commit.

Capability-link **mint** and **revoke** each hold exactly one such guard across
their `tx.commit()`. Two sibling paths do not hold any:

- `consume_capability_link_use` — `crates/snapback-engine/src/local/engine.rs:5119-5139`,
  called from `crates/snapback-server/src/server.rs:25740-25742`
- `settle_capability_link_use` — called from `server.rs:25806-25808`

Both are durable capability-link writes. Neither takes an admission guard.

## This is pre-existing, not a regression

It was NOT introduced by `244385daa`, which removed duplicate transport guards
from mint and revoke only. The reviewer explicitly scoped its verified claim:
"exactly one guard across each durable capability-link commit" is true of mint
and revoke, and not of consume/settle. Recording that scoping honestly rather
than letting the broader phrasing stand.

## Why it matters

If the fence is required for mint and revoke, the argument for requiring it on
consume/settle is the same: an authority whose admission epoch was retired
between validation and commit could still consume or settle a link use. Whether
that is reachable in practice is UNVERIFIED — the reviewer found the missing
guard by inspection and did not demonstrate an exploit.

## Next step

Determine whether consume/settle genuinely need the fence or are safe for a
structural reason (for example, if they cannot outlive a retirement by
construction). If they need it, add it the same way the engine owns it for mint
and revoke. If they are safe, record why, because the asymmetry currently reads
as an oversight.

Do not add a guard by copying the transport pattern that caused the deadlock:
see the related ticket for how the same non-reentrant mutex wedges when a guard
is held across a call that revalidates.


## Resolution — 2026-08-21

Both paths did need the fence. They mutate durable capability-link counters and
outcomes and have no structural exemption from LLP 0058's gate algorithm, so
the argument for fencing mint and revoke applies to them unchanged.

Fences added ENGINE-side, deliberately not at the transport. `server.rs` only
passes the existing `PreparedAuthority`; it does not take a guard. Taking one
there is what deadlocked capability-link mint, revoke, and push.send, since the
engine method then re-locks the same non-reentrant `AdmissionInner.state`.

Both are proven by mutation rather than asserted: deleting either fence makes
its own regression fail and restoring it makes it pass. See
`crates/snapback-engine/src/local/admission_fence_tests.rs`.

The reachability question this ticket left open is now moot — the fences exist
and are enforced, so whether the gap was exploitable no longer needs settling.
