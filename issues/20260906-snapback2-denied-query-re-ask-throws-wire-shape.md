# Snapback2 persistent client throws E_WIRE_SHAPE on the second ask of a denied query

Status: Open
Date: 2026-09-06
Scope: Snapback2 persistent client (offline store) query path; owner receipt envelope

On the published `snapback2@0.0.10` package, a client with an offline store
that asks a query the viewer is denied on receives a typed `denied` answer the
first time and a thrown `E_WIRE_SHAPE` the second time, warm or after a cold
reopen of the same partition:

```
E_WIRE_SHAPE: query response.denied must not carry next
```

Mechanism, from the captured wire bytes (`f-denied-next-0.0.10.log`):

1. First ask, `POST /api/query?receipt=1` with no validator. The owner's
   delivery envelope is `{"state":"denied","rule":"MEMBERSHIP_REQUIRED",
   "next":null,"data":null,"rows":[],"receipt":{...},"validator":"021e…",
   "seq":29,...}`. The delivery path accepts it and the app sees `denied`.
2. Second ask, same request plus the held `validator`. The owner answers
   `{"seq":29,"state":"unchanged","validator":"021e…"}`. The client rebuilds
   the answer from the held envelope and passes it through `wireQuery`
   (`client-wire.ts`, `case "denied": if (has(record, "next")) throw …`),
   which refuses the `next: null` the held envelope carries. The same happens
   after closing and reopening the partition, and on every later ask.
3. Control: the same two asks on a client with no store use the plain
   `POST /api/query` shape, whose denied envelope carries no `next`, and both
   asks return typed `denied` (`f-control-nostore-0.0.10.log`).

So the owner's receipt-bearing denied envelope and the client's strict wire
shape disagree, and the disagreement only surfaces on replay of a held denied
answer. Which side should move is the owners' call: either the receipt
envelope omits `next` on `denied` (and `partial`), or the held-envelope replay
is normalized before re-validation. Other queries on the same client keep
working; the throw is per query.

Reached in practice by the ordinary chat template on native: after a member is
denied on a room (not a member, or removed while offline, LLP 1012 §5), the
second render or the first render after a relaunch of that room throws instead
of showing the denied state. Observed first in an actual Release Hermes
simulator run of the standalone chat app on 0.0.10 (`state` of
`conversation-2` as `bob` after a SIGKILL and relaunch), then reduced to Node.

Identity: `snapback2@0.0.10` + `snapback2-darwin-arm64@0.0.10` from npm
(published 2026-09-06T13:15Z); dev owner from the same install; template chat
project (`deliveries.thread` with `require exists memberships[...] else
MEMBERSHIP_REQUIRED`). Classification: product defect. Owner: client/engine
lanes (wire contract between the receipt envelope and `client-wire.ts`).

Retained repro and evidence (outside the repository, per scratch policy):
`~/verify-snapback2-liveoffline-20260906/harness/f-denied-next.mjs` (fails on
0.0.10: 4/6) and `f-control-nostore.mjs` (2/2), logs under `evidence-F/`, plus
the native run `evidence-native/runs/native-accounts-2026-09-06T17-50-04-544Z`
(step 5). The failing script is retained unchanged to confirm a repair.
