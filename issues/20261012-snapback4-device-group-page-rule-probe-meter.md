# Snapback 4: a held group's pinned page meters a rule probe on the server and none on a device

**Opened:** 2026-10-12 (workstream MERGE, LLP 3000.036.001 §10; found by `run-devices` when the generator first drew a group-synced table)

Over `read <- exists access[.bucket, viewer]` with `sync to access[.bucket]`,
the query `items where .bucket = bucket first 1 by .label, .score` answers the
same rows and `complete` on the server and on both device stores, but the
server's `metered.rule_probes` is 1 and the devices' is 0. The server decides
the pinned prefix once (`read.rs`, `prefix_verdict`, which charges the read
rule's static probe count); a device trusts its delivered rows
(`trust_synced_read`) and skips the verdict, so it charges nothing. Only a
mutation's prediction reserves the server's charge on a device
(`reserve_delivered_scan`, `Cut::Abort` only). The cut oracles then disagree
too, at every ceiling below the probe (`rule-probes-*`, and the
`examined`/`heap-bytes`/`steps` cuts whose meters include it).

It is not caused by LLP 3000.036.001: a merged group page (`.bucket = bucket
or .bucket = 1`) shows the same difference per branch, and the control (the
plain pin, replayed) shows it alone. The difftest generator had never drawn a
group-synced table, so the device oracle had never compared one.

What landing it takes:

- Decide the contract: either a device query charges the static probe count
  of every prefix verdict its delivered rows let it skip (as prediction
  already does), or the device oracle names the rule-probe meter of a trusted
  synced read as an argued exception (with the server's count recorded). The
  first keeps "all seven meter fields compare exactly".
- Then let `widen.rs` draw `Residency::Group` (kept in `ast.rs`, rendered as
  `sync to access[.bucket]`, with `access`'s insert rule the group's own
  probe) so the device oracle compares merged pages over held groups; the
  deterministic parity tests in `snapback4-device/tests/branch_merge.rs`
  cover them meanwhile (data and `complete`, not meters).
- Owner: the lead session (device meters are core, LLP 3000 decision 4).
