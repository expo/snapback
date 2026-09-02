# snapback2: hot successors keep predecessor channel authorization

**Status:** Closed
**Resolution:** Hot apply now re-admits every retained channel subscriber under the installed generation in snapback2/crates/snapback2/src/writer.rs; an owner integration test proves policy-only revocation without an intervening commit.
**Systems:** snapback2, owner, channels, successors
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/writer.rs:980-1004

Failure scenario: generation A admits Alice to subscribe to typing; Alice subscribes. A policy-only successor B changes the subscribe rule to deny Alice and applies successfully. Before any data commit, an admitted publisher sends on the same channel/args and Alice still receives the payload.

Why it happens: apply reruns self.live but never re-admits self.channels. readmit_channels at lines 929-978 runs only after a data commit, and channel_publish at lines 834-837 checks only the publisher before sending to every retained subscriber. There is no downstream subscribe-rule check.

Suggested fix: re-admit every channel subscriber under the installed generation before reporting apply success, update admitted verdicts, and terminally refuse/remove revoked subscribers. Add a policy-only successor test with no intervening commit.
