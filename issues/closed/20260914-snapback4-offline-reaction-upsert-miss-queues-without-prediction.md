# Snapback 4: reported offline reaction upsert failure is the documented write-target miss rule

Status: Closed — observed behavior matches the accepted contract
Priority: P3
Date: 2026-09-14
Systems: device prediction, Quarry upsert, write authority, Clique measurement
Observed version: published `snapback4@0.2.10`
Evidence status: received builder differential; independently reproduced at the published pin

## Received observation

The 0.2.10 Clique Astra builder labeled its M8 offline-reaction correction
`snapback4-defect` / `defect`. A reaction written with `upsert` returned
`pending`, while an immediately read, complete local history contained no
reaction. Replacing the upsert with an explicit existence check followed by
update or insert produced the local reaction and passed the durable offline
web check.

The received label and correction remain part of the benchmark. They do not
establish an implementation defect: the write-target miss is deliberately
unpredicted under [LLP 3000.007 §8.7(e)](../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#8),
and the published `guide writes` states that a device write-target miss queues
without a predicted row, regardless of horizon. This disposition applies the
existing accepted rule; it does not relax it or make a new author ruling.

## Independent reproduction and disposition

An isolated one-table program uses a principal-owned, fully synced reactions
table with a unique `(key, principal)` index. Two mutations receive the same
patch shape:

```quarry
mutation put(key: text <=30, emoji: text <=30):
  upsert reactions[key, viewer] { emoji }
  return null

mutation explicit(key: text <=30, emoji: text <=30):
  if exists reactions[key, viewer]:
    update reactions[key, viewer] { emoji }
  else:
    insert reactions { key, principal: viewer, emoji }
  return null
```

With a fresh process device synced online, then its transport made offline:

| Observation | Upsert on a missing local key | Explicit absent insert |
| --- | --- | --- |
| Static residency | predicts: eligible | predicts: eligible |
| Mutation card | pending | pending |
| Local pending row | absent | present |
| Upsert outbox entry | `predictable:false`, `predicted:[]` | — |
| After reconnect | row committed | row committed |

Both outbox entries settled and both authoritative rows became visible.
`eligible` permits a prediction attempt; the actual missing write target
still prevents prediction. In
[write_target.rs](../../snapback4/crates/snapback4-core/src/engine/write_target.rs),
`resolve_write_target` explicitly returns `write_miss` on a device when the
old row is absent, before the insert arm. The result agrees with §8.7(e).

Closed as existing, documented behavior. The builder paid a real correction
loop to obtain offline reaction rendering, and the final cell comparison must
retain that cost separately from technical defect attribution. This probe
does not establish the safety or completeness of arbitrary exists/insert
rewrites across hidden rows, revocation, horizons or races; it covers the
fully acquired principal-owned fixture above. No implementation was changed.

## Evidence

Received packet:
`~/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/`:

- `run-log.md`, epochs 1789389802 and 1789389842: diagnosis and received defect label.
- `evidence/m8-reaction-diagnostic.jsonl`: two pending cards with complete local histories; the first has no reaction, the explicit-write control has one.
- `evidence/m8-durable-web-explicit.txt` and `evidence/m8-durable-web.json`: received successful web workaround check; the latter explicitly makes no native simulator claim.
- `snapback/media.q`: final explicit exists/update/insert form. This is a live builder path, so the final cell archive must bind the retained source state.

Independent isolated probe:
`~/projects/snapback-lanebriefs/upsert-probe-20260914/`:

- `probe.mjs`, `snapback/schema.q`, `check.txt`, `guide-writes.txt`, `result.json`, `server.log`.
- Uses the already installed published 0.2.10 client and binary from ceremony third run 1. It starts a fresh server on an OS-assigned free port and a separate process-device store; it does not modify or steer the running Clique lane.
- Result: upsert predictable false, zero local upsert rows; one local explicit-insert row; two confirmed rows after reconnect. Client and owned server were closed.

Before filing, fetched origin/main and searched open/closed issues, the RFC
(including §18), and recent commits. No duplicate Snapback 4 report was found;
CU1–CU5 cover different findings.
