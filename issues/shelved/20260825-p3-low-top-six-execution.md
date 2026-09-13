# P3-LOW top-six execution falsified all six proposed bounds

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel
Related: issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/20260824-p3-low-bucket-verification.md, LLP 0053, LLP 0059, LLP 0298,
  LLP 0303

## Result

The top six attacks in `/tmp/p3attack-plan.md` were executed in the required order against detached
`c7754094d34092c7f4f6824024340d5c6e82c9b3`. Every attempt reached its watched assertion. All six
falsified the proposed P3 bound; none survived and none was blocked.

| Row | Executed verdict | Reclassification | Observed effect |
|---|---|---|---|
| F091 | **FALSIFIED** | **P1-SHIP** | One cloned bound-session carrier authorized durable `probeRows` inserts in both cloned file databases. |
| C004 | **FALSIFIED** | **P1-SHIP** | A caller-rebuilt projection committed a durable `probeRows` row as a forged user while the durable session retained the genuine user. |
| F089 | **FALSIFIED** | **P2-POLICY** | Public registry output persisted through `seed_invalidation_retry_episodes_for_test` and survived reopen in `_snapback_auth_retry_episodes`. The policy question is whether externally feature-reachable test-support may remain a raw persistence capability. |
| C009 | **FALSIFIED** | **P1-SHIP** | A never-issued connection generation became the retained subscription scope and reached a durable manual retry episode. |
| F286 | **FALSIFIED** | **P1-SHIP** | Victim A was refreshed by B's descriptor even for a stale token; B's valid token then discharged B's obligation while A remained the input connection. |
| F288 | **FALSIFIED** | **P1-SHIP** | Victim A was refreshed before unknown-subscription rejection; the valid variant repointed B's subscription to A and installed generation `20001`, which the issuer never reserved. |

The earlier `CONFIRMED-P3` conclusions for F091, C004, and F089 are therefore retired. The earlier
P1 concerns for C009, F286, and F288 are now executed findings rather than reasoned concerns.

## Watched fail-first evidence

Each test initially ended in a deliberate `panic!` only after all attack operations and readbacks.
The following are verbatim substrings from those watched outputs; generated IDs and clocks are not
used by the permanent assertions.

### F091

Composition: create settled file database A with a genuine session; physically clone A to B; resolve
one bound carrier from A; clone it; prepare one copy against each database; execute the same
authenticated mutation in both; read both databases.

Durable table: app table `probeRows` in A and B.

```text
WATCHED F091 assertion reached:
output_a=MutationOutput { version: 2, changed_count: 1
output_b=MutationOutput { version: 2, changed_count: 1
"lane": String("A")
"lane": String("B")
"authUser": String("018f0d90-7b11-7a22-8c33-445566770091")
```

### C004

Composition: load a genuine public projection source; consistently rewrite its user, identity, and
session subject to a forged user; rebuild the public test-support projection/coordinator; resolve and
prepare its carrier against the genuine database; commit an authenticated mutation; reread the real
session subject.

Durable table: app table `probeRows`.

```text
WATCHED C004 assertion reached:
output=MutationOutput { version: 2, changed_count: 1
durable_user=018f0d90-7b11-7a22-8c33-445566770091
"lane": String("forged")
"authUser": String("018f0d90-7b11-7a22-8c33-445566770092")
```

### F089

Composition: reserve a caller-authored public retry episode; pass `registry.episodes()` directly to
the public test-support persistence sink; drop and reopen the database; load through the production
retry loader.

Durable table: `_snapback_auth_retry_episodes` (with the sink's retry counter/clock companions).

```text
WATCHED F089 assertion reached: durable_count=1
authority_subject: "sha256:p3-f089-authority"
first_attempt_reserved_at_ms: 4242
attempts_reserved: 1
```

### C009

Composition: clone genuine descriptor generation `1`; set generation `10001` without reserving it;
combine it with A's genuine fence and A-owned subscription; stage and finalize resume; corrupt the
retained query input so automatic resolution fails; drive a manual retry through the forged scope;
read the durable retry registry.

Durable table: `_snapback_auth_retry_episodes` (plus its retry counter/clock companions).

```text
WATCHED C009 assertion reached:
connection_generation: 10001
failed_resume=Diagnostic { code: "SNAPBACK_ARG_MISSING"
manual_retry=AuthorizationInvalidationManualRetryOutput { outcome: "exhausted"
durable_count=1
attempts_reserved: 3
manual_retry_id: Some("p3-c009-forged-manual-retry")
```

### F286

Composition: create victim A and genuine B generation `2`; create a B-owned subscription and B
obligation/token; stage ACK input A with B's descriptor/admission/fence; run a stale-token variant and
then B's valid-token variant; read A's activity and B's obligation after each.

No SQLite table changes in this row's immediate operation. The authoritative effects named by the
attack plan are the connection activity and obligation registries.

```text
WATCHED F286 assertion reached:
invalid_output=AuthorizationInvalidationAckOutput { outcome: "stale" }
invalid_last_seen_a=1787641952883
pending_after_invalid=Some(ResyncObligation
valid_output=AuthorizationInvalidationAckOutput { outcome: "discharged" }
valid_last_seen_a=1787641952883
pending_after_valid=None
```

Both observed timestamps are greater than the sentinel `1` installed immediately before each
variant. Their equality only means both effects occurred in the same millisecond.

### F288

Composition: create victim A and B-owned subscription/fence; clone genuine descriptor generation
`1` and set it to unreserved generation `20001`; first finalize a missing-subscription resume, then
finalize an owned-subscription resume with input A and the forged descriptor; read connection
activity, retained subscription ownership, scope, and obligation.

No SQLite table changes in the immediate resume. The authoritative effects named by the attack plan
are connection activity, subscription ownership, and scope/obligation state. C009 independently
demonstrates that such a forged scope can reach the durable retry tables.

```text
WATCHED F288 assertion reached:
invalid_error=Diagnostic { code: "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED"
invalid_last_seen_a=1787642020724
forged_generation=20001
stored_connection=p3-f288-a
connection_generation: 20001
pending_forged_scope=Some(ResyncObligation
valid_last_seen_a=1787642020724
```

## Permanent evidence

The deliberate watched panics were replaced by characterization assertions in
`crates/snapback-engine/src/local/tests/engine.rs`. They preserve the six observed compositions and
will fail if the current behavior is later closed. The tests do not assert generated IDs, wall-clock
values, or boot nonces.

## Target drift from the plan

The plan was authored against `e6565f5d9`; execution used symbols at `c7754094d3`.

| Row | Plan site | Executed site |
|---|---|---|
| F091 | `session_projection.rs:175` | `BoundConnectionSessionIdentity` at `session_projection.rs:166` |
| C004 | `session_projection.rs:150` | unchanged |
| F089 | `types/invalidation.rs:495` | unchanged |
| C009 | `auth/invalidation.rs:110` | unchanged |
| F286 | `engine.rs:21781` | `prepare_authorization_invalidation_ack_for_transport` at `engine.rs:23277` |
| F288 | `engine.rs:22581` | `prepare_resume_live_for_transport` at `engine.rs:24079` |

## Scope boundary

Execution stopped after the required top six. F285, F043, F054, F044, F055, F063, and the remaining
plan rows were not attempted. Their reasoned bounds or RED/GREEN rankings remain non-retiring until
their own watched executions run.
