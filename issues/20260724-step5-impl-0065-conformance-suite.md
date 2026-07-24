# 0065: implementation-conformance suite (gates Implemented + STEP5.DECLARATION_REDUCTION)

**Status:** Open
**Severity:** P2
**Systems:** Testing, Authorization, Codegen
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §6, LLP 0053, LLP 0058, LLP 0063 WS6
**Marker:** step5-impl

Build the §6 suite: byte-identical regeneration; named negative generation
cases; cross-user negatives with byte-indistinguishable missing-vs-other-owner
outcomes across every claimed adapter; unique-conflict fixtures (partitioned +
declared-disclosure); client-supplied owner-field rejection on create and
update; posture parity with a handwritten equivalent; trusted now/id replay;
principal negatives (SNAPBACK_AUTH_REQUIRED for anonymous; pattern code for
servicePrincipal/autonomous agents; delegated-agent resolution); conditional
guard races; duplicate-order-key cross-target determinism; pagination
no-skip/no-duplicate + cursor refusals; exact ceiling assertions + one
out-of-ceiling fault; live conservative resnapshot with the disabled-skip
capability record; same-subject two-app domain negative; no-Exact-core and
package gates rerun. Depends on every other 0065-lane ticket. The Step 5
Partitime receipt itself stays a separate LLP 0063 gate deliverable. L-sized.
