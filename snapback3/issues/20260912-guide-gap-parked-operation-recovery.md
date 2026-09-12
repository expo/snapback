# guide-gap: parked operation inspection and recovery do not match the guide

Status: Open
Date: 2026-09-12
Scope: Snapback3 operation lifecycle and application recovery
Related: [guide](../guide.md), [LLP 2000](../../llp/2000-snapback3.rfc.md), [focused Clique audit](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/coordinator-audit.md)

The guide says `client.dismissOperation(id)` acknowledges terminal or parked
work after the app preserves the user's input. The measured package's
[implementation](../packages/snapback3/src/client.ts) requires a terminal
receipt and rejects an uncommitted parked entry with `S3_OPERATION_PENDING`.
`client.operation(id).getSnapshot()` does expose its status, original input and
error. Inspection is present; the guide's parked dismissal promise is not.

The M7 independent assessment retained an original pre-change queued send
after reconnecting against a migrated app. It did not settle in the observed
interval. The grader initially read nonexistent `state` instead of the public
`status` field; its raw nulls do not establish the operation's phase. A separate
coordinator control on frozen copies confirms `parked` and `S3_OPERATION_CHANGED`
through 25.036 seconds online, with the same input/ID, no receipt, and no server
message. Do not repeat the grader's “forever” duration or its claim that the SDK
has no inspection affordance.

Bring the guide and supported recovery behavior into agreement. Preserve the
original immutable identity and arguments, make the reason visible, and define
how an application handles user input that cannot execute under the new
program. Do not silently reinterpret the old intent, create a replacement on
retry, or allow disposal of a possibly committed outcome without an explicit
safe protocol. The benchmark app also needs a reachable recovery presentation.
No product or guide repair was supplied to the pinned benchmark builders.
