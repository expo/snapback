# snapback2: owner control secret is created world-readable

**Status:** Open
**Systems:** snapback2, owner, control security
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/owner.rs:138-146

Failure scenario: under ordinary umask 022, dev creates .snapback as 0755 and owner.json as 0644. Another local account reads its 256-bit secret and invokes privileged loopback controls such as reset, migrate, requeue, and stop.

Why it happens: directory creation and the owner write at lines 475-488 leave all permissions to ambient umask. The server at snapback2/crates/snapback2/src/serve.rs:142-168 treats possession of this file value as complete control authorization.

Suggested fix: securely create/verify .snapback as 0700 and every secret-bearing owner-state file as 0600 using no-follow platform APIs; refuse unsafe ownership/modes that cannot be repaired safely. Add a mode assertion under umask 022.
