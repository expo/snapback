# Implementation plan — the 4 promoted P1 rows, and questions for the 5 promoted P2 rows

Status: open
Date: 2026-08-24
Systems: snapback-engine, snapback-server, snapback-sync
Related: issues/20260824-p3-low-bucket-verification.md, LLP 0303,
  issues/shelved/20260824-liveness-row-bucket-assignment.md

Nine rows were promoted out of P3-LOW when that bucket failed verification: four to P1, five to P2.
This is their plan. They are work that did not exist before that verification, and nothing was
scheduled for them.

**Headline: all four P1 rows remain live on current main — none reverts to P3.** They share one
connection-binding invariant and the same `engine.rs` / `server.rs` call sites, so they should land
**together in one lane** rather than separately.

**Shared implementation shape:** use `PreparedConnectionAct` — specifically its exact registry check
in `try_act` (`crates/snapback-server/src/server.rs:8740`) — as the sole production binding
predicate. It already holds the canonical connection ID, the grant-derived fence, and the
invalidation descriptor (`server.rs:6142`). Reuse beats a parallel check that drifts.

**One of the five P2 rows is not a new decision:** C009 is covered by the already-approved LLP 0303
**Q33** ruling (live-subscribe authority, input connection, invalidation admission and effect fence
must all derive from one subject). It needs implementation, not adjudication.

**Analysis caveat, recorded:** the plan was produced in a read-only sandbox that could not write
`.git/FETCH_HEAD`, so it inspected local `origin/main` at `78ba9c538`; the relevant files showed no
diff from the verification commit `097df2338`. The `llp-orient` skill was unavailable (unresolved
vendor symlink), so LLP 0303 and the code were read directly. Re-verify anchors before editing —
main moves continuously.

---


I could not refresh the remote: the read-only sandbox rejected writing `.git/FETCH_HEAD`. Local `HEAD` and local `origin/main` are identical at `78ba9c5389e7b3e468ee258f285247fd9dd6b0bd`; the relevant files have no diff from verification commit `097df2338`. The project’s `llp-orient` skill was unavailable because its vendor symlink is unresolved, so I read LLP 0303 and the relevant code directly.

## Shared implementation shape

Use `PreparedConnectionAct`—especially its exact registry check in [`try_act`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:8740)—as the sole production binding predicate. It already holds the canonical connection ID, grant-derived fence, and invalidation descriptor at [`server.rs:6142`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:6142).

For the production HTTP boundary:

- DERIVE connection ID, effect fence, and invalidation descriptor from the same `PreparedConnectionAct`.
- Treat wire `connectionId` only as the lookup/authentication input consumed by middleware; do not forward it independently into an engine operation.
- Finalize the staged operation inside `PreparedConnectionAct::try_act`, as today.
- Where retained asynchronous subscription state must match the active connection, VERIFY its stored connection ID/fence against the act-derived values before touching activity or mutating state. That verification is justified because the subscription was completed independently.

This makes mismatching impossible at the production handler-to-engine composition boundary. It does not make arbitrary construction impossible for every Rust embedding that can call the exported raw engine APIs. Merely adding a public “bound context” DTO would mean callers *could choose not to construct* a mismatch; it would not make one impossible. If the inventory requires a crate-global impossibility claim, ownership of the raw constructors must move behind the connection-registry abstraction. Do not close the rows on a cosmetic wrapper alone.

## F285 — staged unsubscribe

**Current site and signature**

[`engine.rs:21731`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21731):

```rust
pub fn prepare_unsubscribe_live_for_transport(
    &mut self,
    name: String,
    input: LiveUnsubscribeInput,
    authority: PreparedAuthority,
    effect_fence: ConnectionEffectFence,
) -> SnapbackResult<PreparedLiveUnsubscribe>
```

It mints a `PreparedLiveUnsubscribe` stage. The pending stage records `input.connection_id`, `effect_fence`, reservation keys/slots, and control state at [`engine.rs:20502`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:20502). It writes no SQLite columns.

**Confirmed effect path**

The path remains:

1. The subscription owner test at [`engine.rs:21673`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21673) checks authority and fence, but not `input.connection_id`.
2. A caller can therefore select B’s subscription and B’s fence/authority while independently supplying A as the input connection.
3. The final operation touches A at [`engine.rs:21691`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21691), then removes B’s subscription and retires its memo.
4. `ConnectionActivity::touch` creates or refreshes the selected entry at [`engine.rs:2437`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:2437); stale-ID reaping consumes that state at [`engine.rs:2472`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:2472).

The existing production caller is [`server.rs:31930`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:31930). Engine tests also call the factory directly around [`engine.rs:33450`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:33450).

**Target**

DERIVE the engine input’s connection ID from `PreparedConnectionAct`, not the wire body:

```rust
let input = LiveUnsubscribeInput {
    subscription_id: wire.subscription_id,
    connection_id: connection_act.connection_id().to_owned(),
    auth: wire.auth,
};
```

Add a final VERIFY before `touch`:

```rust
require_subscription_connection(
    &subscription,
    connection_act_connection_id,
    connection_act_effect_fence,
)?;
```

The helper should compare the stored subscription’s connection ID and full fence to the act-derived pair. Reuse `PreparedConnectionAct::try_act` as the tested current-act predicate; extend the existing subscription-owner helper rather than introducing a second authority/fence comparison beside `LiveSubscription::is_owned_by` at [`engine.rs:4141`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:4141).

Observable compatibility change: a stale connection can no longer unsubscribe a subscription that has moved to another connection, and the rejected operation will no longer refresh the stale connection’s activity. Normal exact-owner unsubscribe is unchanged.

**Readback**

No database columns are written. Tests must read back all in-memory writes:

- subscription presence/removal;
- activity entries and timestamps for A and B;
- memo retirement;
- scope/obligation retirement;
- receipt outbox destination;
- observation/stat counters.

Relevant axes are connection ID, all `ConnectionEffectFence` fields, authority identity, and subscription ID. `LiveUnsubscribeInput.auth` is ignored by the prepared transport path and must not become a binding axis.

## F286 — invalidation ACK

**Current site and signature**

[`engine.rs:21825`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21825):

```rust
pub fn prepare_authorization_invalidation_ack_for_transport(
    &mut self,
    input: AuthorizationInvalidationAckInput,
    connection: AuthorizationInvalidationConnection,
    admission: AdmissionLease,
    effect_fence: ConnectionEffectFence,
) -> SnapbackResult<PreparedAuthorizationInvalidationAck>
```

It stages the independently supplied input ID, descriptor, admission, and fence. The final operation starts at [`engine.rs:21778`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21778). Successful acknowledgement removes the obligation/resolution and records the discharged scope at [`engine.rs:1322`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:1322). There are no SQLite writes.

**Confirmed effect path**

The path remains:

1. It touches `input.connection_id` before validating the descriptor/token pairing at [`engine.rs:21785`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21785).
2. The descriptor is checked only against globally accepted invalidation state at [`engine.rs:21793`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21793).
3. The ACK token then discharges the descriptor’s issuer/generation scope through [`engine.rs:1330`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:1330).

Consequently, A’s input ID can be combined with B’s accepted descriptor and B’s ACK token. Even a later refusal has already touched A.

The sole production caller is [`server.rs:31612`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:31612).

**Target**

DERIVE all three connection facts from one `PreparedConnectionAct`:

```rust
pub fn prepare_authorization_invalidation_ack_for_transport(
    &mut self,
    ack_token: AuthorizationInvalidationAckToken,
    connection_id: String,                    // act-derived
    connection: AuthorizationInvalidationConnection, // act-derived
    admission: AdmissionLease,
    effect_fence: ConnectionEffectFence,      // act-derived
) -> SnapbackResult<PreparedAuthorizationInvalidationAck>
```

Removing the connection ID from `AuthorizationInvalidationAckInput` at this boundary is preferable to overwriting it silently. The server should extract only the ACK token from the wire object and obtain everything else from the act.

The correct tested predicate is `PreparedConnectionAct::try_act`; its exact ID/grant comparison is at [`server.rs:8756`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:8756). Move the activity touch after descriptor and token validation so every refusal is effect-free.

Compatibility change: malformed/mixed ACKs stop refreshing the supplied connection’s activity. Exact ACK behavior is unchanged.

**Readback**

No SQL columns are written. Read back:

- obligation presence;
- resolution-by-scope entry;
- `last_discharged`;
- connection-child/quarantine state;
- activity for both candidate IDs;
- quarantine-exit statistics.

Descriptor axes actually read are `protocol_version`, full `issuer_id`, authorization incarnation and epoch, `version_stream`, and `connection_generation`. The path does not read `issuer_retirement`; do not lock or biject that field. Also vary ACK token, connection ID, and every fence component.

## F288 — staged resume

**Current site and signature**

[`engine.rs:22625`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22625):

```rust
pub fn prepare_resume_live_for_transport(
    &mut self,
    name: String,
    input: LiveResumeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<PreparedLiveResume>
```

The stage records the input ID and the fence extracted from `invalidation`. The completed resume can rewrite the subscription connection ID/fence, authorization scope, dependency state, obligations, activity, and outbox. It writes no SQLite columns.

**Confirmed effect path**

The path remains:

1. It touches the independently supplied connection ID before subscription lookup at [`engine.rs:22121`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22121).
2. Ownership checks authority plus the invalidation fence at [`engine.rs:22148`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22148), but do not bind the input ID to the descriptor.
3. The accepted descriptor’s generation is then used to create replacement authorization scopes at [`engine.rs:22225`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22225).
4. Successful paths store the independent input ID alongside the descriptor-derived scope and fence, for example at [`engine.rs:22583`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22583).

The production caller is [`server.rs:31852`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:31852); engine tests call the factory around [`engine.rs:33432`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:33432).

**Target**

DERIVE a normalized resume request at the server boundary:

```rust
pub fn prepare_resume_live_for_transport(
    &mut self,
    name: String,
    subscription_id: String,
    recorded_permission_epochs: RecordedPermissionEpochs,
    authority: PreparedAuthority,
    connection_id: String,              // PreparedConnectionAct
    invalidation: LiveInvalidationAdmission, // same act
) -> SnapbackResult<PreparedLiveResume>
```

The wire `LiveResumeInput.connection_id` and `auth` must not cross this boundary. `recorded_permission_epochs` remains supplied because production actually reads it at [`engine.rs:22565`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22565), but it is not a connection-binding field.

Reuse `PreparedConnectionAct::try_act` for the active connection/grant predicate and the existing subscription owner check for authority/fence. Move the initial `touch` until after lookup, ownership, descriptor acceptance, and scope construction validation.

Compatibility change: a failed or mixed resume stops refreshing an unrelated ID. Successful resume stores the act’s canonical ID, fence, and descriptor generation.

**Readback**

No SQLite columns are written. Project:

- subscription connection ID and full fence;
- authorization scope issuer/generation;
- recorded permission epochs and read dependencies;
- activity for A and B;
- obligation/connection-child/quarantine state;
- resume outbox entries and destination;
- observations/statistics.

Use the same descriptor and fence axes as F286. Do not add `issuer_retirement`, wire `auth`, or unrelated descriptor fields as axes.

## C009 — freely composable invalidation descriptor

**Current site and signature**

[`invalidation.rs:110`](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:110):

```rust
pub struct AuthorizationInvalidationConnection {
    pub protocol_version: u32,
    pub issuer_id: IssuerId,
    pub connection_generation: u64,
    pub authorization: AuthorizationVersion,
    pub version_stream: String,
    pub issuer_retirement: Option<IssuerRetirement>,
}
```

The type itself mints or writes nothing; it is a public, freely constructible descriptor. The live sink is `LiveInvalidationAdmission::new` at [`engine.rs:4201`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:4201), which accepts that descriptor beside an independent fence.

**Confirmed effect path**

The path remains. `accepts_connection` at [`engine.rs:3741`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:3741) validates global issuer/protocol/version facts but does not establish that the descriptor was minted for the same connection act/fence. Resume then uses its generation to create scopes. ACK and manual-retry APIs also accept raw descriptors.

Production currently *does* obtain the descriptor and fence from the same `PreparedConnectionAct` in ACK, subscribe, resume, and manual retry. That means current production callers do not construct the demonstrated mismatch; it is not globally impossible because the exported raw sinks remain.

**Target**

Do not modify the descriptor merely to add another ignored field. Instead:

- Remove raw `AuthorizationInvalidationConnection` plus independent-fence composition from authority-bearing production adapters.
- Centralize descriptor/fence/ID extraction in one `PreparedConnectionAct` method and use it in ACK, subscribe, resume, unsubscribe, and manual retry.
- Cover subscribe even though it was not one of the four promoted rows: LLP 0303 Q33 already rules strict DERIVE.
- Add a source/API inventory test asserting that no production handler obtains any member of this tuple from a wire input or a different act.
- If the row must be closed for all exported engine users, move the raw admission constructors behind the connection-registry owner; otherwise label the resulting guarantee precisely as production-boundary enforcement.

Changing public fields in [`invalidation.rs`](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:110) would collide with an occupied file and must wait. The recommended implementation does not need that file.

## Batching and lane ownership

All four should be one lane because splitting them would temporarily leave interchangeable raw compositions in ACK/resume/subscribe. Expected touched files are:

- `crates/snapback-engine/src/local/engine.rs`
- `crates/snapback-server/src/server.rs`
- related tests, and possibly `crates/snapback-sync/src/live_protocol.rs` if transport-normalized input structs are introduced.

None of the six currently occupied files is required by the recommended plan. If implementation chooses to privatize or reshape `AuthorizationInvalidationConnection`, it needs `crates/snapback-auth/src/auth/invalidation.rs`; although not in the supplied occupied list, that expands the public protocol surface and should be separately coordinated. No listed occupied auth/oauth/kernel file is necessary.

## Promoted P2 authorization questions

| Row | Question a person must answer | Existing LLP 0303 ruling? |
|---|---|---|
| F043 | May someone who can name a live step-up challenge spend its verification-attempt budget using a binding/code not belonging to the challenge’s flow, and if so under what abuse policy? | No. Q39 governs sending challenges and Q41 governs correlation shape; neither identifies who may charge an existing challenge. |
| F044 | May someone who can name an exchange challenge consume that challenge’s attempt budget with a wrong code, or only the flow/principal to which it was issued? | No; adjacent to Q39/Q41, but not answered by either. |
| F054 | At `StepUpProofAdmission::for_step_up`, must the challenge, binding, and submitted code be flow-bound before a failed attempt is charged? | No. Same unresolved policy decision as F043, not a separate product question. |
| F055 | At `ExchangeAdmission::for_exchange`, what authority permits the selected challenge’s attempt counter to be incremented? | No. Same unresolved policy decision as F044. |
| F063 | Should an unauthenticated password attempt against a canonical identifier be allowed to advance that identifier’s failure/lockout ledger, and under what anti-abuse/rate rule? | No. Q38 concerns password registration, not login-failure charging; Q39 concerns challenge delivery. |

Thus none of the five P2 rows is fully disposed by Q01–Q45. F043/F054 share one new decision, and F044/F055 share another; they should not be presented as four independent policy questions.