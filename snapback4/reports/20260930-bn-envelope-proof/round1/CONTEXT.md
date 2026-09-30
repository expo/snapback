# BN round 1 orientation

Scope: packaged acquisition witness, CLI family usage, bounds/witness cards,
and the native coverage annotation. The engine, SDK public contract and
process-device performance are outside this change.

- LLP 3000 §1 decision 4 and §4: periphery lane, Snapback 4's independent
  workspace and checks; preserve the wasm ratchet.
- LLP 2000.000 §7.2: acquisition is a partition stream; local retention and a
  completed reconnect are separate facts.
- LLP 3000.007 §18.4 and §20.10: use the real native process device, retain
  evidence, and clean up only owned processes.
- LLP 3000.019 §3.4: residency counts SQLite pages and table payload bytes;
  detailed coverage inspection follows the timed local answer.
- LLP 3000.030 §14 (`#acquire`, current working set): stable-fixture acquisition,
  offline coverage equality and completed zero-event reconnect. The merge moved
  BN's section from §13 to §14, preserving NS's already-landed §13 and both
  histories. Updated both BN code references; historical reports/journal remain
  unchanged.

Read both complete round 0 reviews, the original prompt/report, live bounds,
witness and sync code, the native process adapter, and actual server wire
forms. `client.sync()` deliberately returns no boolean; inspect validated
transport and native publication evidence without changing that API.

Risks: SDK error swallowing, identical old/new watermarks hiding failed native
apply, reflected remote text, and conflating a local-query timer with a later
coverage scan. The known JSON-lines/SQLite apply performance defect belongs to
NA and is documented without attempting an engine or IPC optimization.

Documentation updates: existing LLP 3000.030, the two existing guide cards,
round 1 report and one appended journal entry. Hand-off: none.
