# Snapback 4: a two-principal absence guard charges the server 6 heap bytes more than device prediction reserves — at an exact ceiling a device predicts a write the server refuses

Status: Open
Priority: P3 (only within six bytes of the heap ceiling, and the consequence is the ordinary, handled path — a predicted write refused by the server and rolled back; but it is a counterexample to an invariant the presence design states)
Date: 2026-09-17
Systems: `snapback4-core` `engine/presence.rs` (the dependency reservations: `grace_read`, `enter_presence_guard`, `value_presence`), `engine/local.rs` (`predict`), `engine/runner.rs` (`Builtin::Connected`)
Observed version: main at `a1afab4e36` (unchanged production sources); found by lane W15a's second session (LLP 3000.007 ruling 32), which was told to stop if the server could exceed the prediction's reservation and found that the base already does
Evidence status: reproduced by a test on both device stores (SQLite and memory)

## Problem

LLP 3000.007 §19.1's soundness rule for presence that decides only effects: *reserve every
potential dependency on every host, including absent and live principals; grace cannot
decide a mutation refusal.* Prediction "evaluates both safe arms and discards their
effects", so whatever the server charges for the arm it takes, the device must already have
reserved. For a single-principal guard that holds exactly (server absent or graced: 9 steps,
513 heap bytes; prediction on either store: 9, 513). For a conjunction of two it does not:

```quarry
effect notify
mutation push(p: principal, q: principal):
  if not exists connected[p] and not exists connected[q]:
    emit notify {}
```

With `p = 'bob'`, `q = 'carol'` the mutation is `predicts: eligible`. The server, with both
recipients absent or both inside the grace, charges **1,967 heap bytes**; prediction on both
device stores reserves **1,961** (steps 18 and output 6 agree; the other four counters are
zero). With the heap ceiling set to 1,961 the device predicts the write and the server
refuses it: `E_BOUND: heap bytes reached the ceiling 1961`, site `push:3:then:1`. At 1,967
both accept.

## Reproduction

Lane W15a's device test `w15a_necessary_absence_server_fits_prediction_reservation_on_both_stores`
(`crates/snapback4-device/tests/presence/mod.rs`; it measures prediction through the real
`local::predict` entry point by binary search on each ceiling, then runs the server at that
ceiling). It lands `#[ignore]`d with this ticket's path when W15a lands; until then it is
on branch `sb4/w15a`.

## A second instance, in a different field (found by the same lane's review-fix session)

The 50-member send of lane W15a's cost fixture
(`crates/snapback4-sim/tests/grace_effects/presence_cost.q`: `require exists
memberships[conversationId, viewer]`, an insert into `messages` whose rule probes
`memberships`, a loop over `memberships[conversationId] first 50`, an absence-guarded emit per
recipient) charges the server **3 rule probes** and device prediction **1**, on both stores, at
the lane's base and after it (every other field: server 52 examined / 2 index entries / 1,356
steps / 69,400 heap / 27 output / 1 row; prediction 52 / 2 / 1,367 / 69,843 / 27 / 1). It is
not a presence reservation at all — a device answers some rule probes from its held group
without charging them — but it is the same broken promise: a field in which the server can
charge more than prediction reserved. The rule-probe ceiling is far from either number, so
this one cannot bite in practice; it belongs in the same audit.

## Direction

Find which reservation the server makes that prediction does not (the difference is six
bytes for principals of three and five bytes — a per-principal term, not a constant) and
make prediction reserve it; never lower a server charge to meet a smaller reservation
without checking that the work is really not done. The acceptance is the ignored test
turned on, a decision on whether rule probes are meant to be inside the "server ≤ prediction"
promise at all, plus the same comparison for a three-principal conjunction, an aliased guard and
a nested guard.
