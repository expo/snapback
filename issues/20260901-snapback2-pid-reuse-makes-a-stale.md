# snapback2: PID reuse makes a stale owner record look successfully attached

**Status:** Open
**Systems:** snapback2, owner, lifecycle
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/owner.rs:398-417

Failure scenario: an owner crash leaves owner.json; its PID is later reused by an unrelated long-lived process and the recorded port is dead. Every snapback2 dev prints E_OWNER_RUNNING/the stale URL and exits 0 forever, while all operational verbs refuse because status cannot authenticate.

Why it happens: any live PID plus failed or mismatched authenticated status becomes OwnerProbe::Running. run at lines 87-95 treats Running as a successful attach, although LLP 1002 allows attach only after status authenticates and names the same root.

Suggested fix: never report successful attachment without authenticated status. Reclaim stale state only after acquiring the store lock and use a process birth token/start time to distinguish PID reuse. Replace the existing exit-zero stale-PID test with recovery behavior.
