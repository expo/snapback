# Swift client robustness: non-Sendable public machine, silent grant-loss quiesce, unbounded collections

**Opened:** 2026-08-08 · **Severity:** P2 · **Area:** clients/swift (separate from the P1 reconnect-dead-code ticket)

## [P2] Actor exposes mutable non-Sendable `ClientStateMachine` as `public let machine`

`SnapbackClient.swift:81`; `StateMachine.swift:176`; `Package.swift`
(`swift-tools-version:5.9`). `public let machine = ClientStateMachine()` on a
`public actor`, where `ClientStateMachine` is a `final class` with
unsynchronized mutable dictionaries. Under Swift 5 mode, app code can read
`client.machine.subscriptions` from any thread while the actor mutates it
mid-`ingestDurable` — dictionary read-during-mutation is UB (crash or torn
state). Under Swift 6 mode the API is uncompilable for clients. *Fix:* make
`machine` actor-isolated/`internal` and expose read-only async projections
(`await client.subscriptions`), or make the machine an actor/`Sendable` value.

## [P2] Grant loss quiesces silently with no event surface

`SnapbackClient.swift:1044-1057`. On `SNAPBACK_CONNECTION_TOKEN_INVALID` the
client sets `grant = nil`, stops both lanes, appends a diagnostic — but discards
the `.reopenConnection` event from `machine.noteGrantLost()` and fires no
callback. A reaped/expired grant (24 h server TTL) quietly halts all delivery;
recovery depends entirely on the app polling `diagnostics: [String]`. The
unstructured drain/socket Tasks also strongly retain the client (cycle until
`stopDrainLoop`), so dropping the client without `stopDrainLoop` leaks the actor
+ URLSession. *Fix:* add an `onConnectionStateChange` / typed
`AsyncStream<ClientEvent>` surface and an explicit `shutdown()` that cancels loop
tasks; document the ownership contract.

## [P3] Unbounded growth of long-lived client collections

`StateMachine.swift:191` (`clientMutationSettlements`), :196
(`appliedAuthorizationInvalidationsByAckToken`); `SnapbackClient.swift:87`
(`diagnostics`). All append-only for the process lifetime; `diagnostics` gains
an entry per drain failure (up to one per 10 s indefinitely). A long-running
client on flaky networks accumulates memory without bound. *Fix:* ring-buffer
`diagnostics` (keep last N); prune settlement / ack-token maps on subscription
removal or by count.

## [P3] Snapshot rows without `_id`/`id` get a random UUID identity per apply

`StateMachine.swift:322`: `let id = row["_id"]?.stringValue ?? row["id"]?.stringValue ?? UUID().uuidString`.
A query whose rows carry no id field gets fresh identities on each replace; a
later `live_delta` `remove`/`update` by server row id can never match. Snapback
rows always carry `_id`, so this masks a protocol violation instead of surfacing
it. *Fix:* treat a missing `_id` as an undecodable row (emit a diagnostic)
rather than minting synthetic identity.

## Confidence

High on the Sendable and collection-growth mechanics; medium-high on the
grant-loss surface gap. The T-GRANT-LOSS quiesce itself is partly deliberate
(@ref LLP 0095 §4.4); the absence of any error/event surface is not documented
as intended.
