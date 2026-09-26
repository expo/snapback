# Snapback 4: signed-in /changes waits for the whole adoption

- **Opened:** 2026-09-26, lane AD round 1 / 0.4.4 review.
- **Area:** `snapback4/crates/snapback4/src/serve_changes.rs`, atomic schema adoption.
- **Severity:** Medium — availability and scale.
- **Status:** Open.
- **Design:** LLP 3000.019 §3.6; LLP 3000.015 §3 preserves atomic adoption.

A signed-in `GET /changes?since=0&wait=0` authenticates and records
`presence_reconnected` under the writer. The current adoption holds that writer
for the entire rebuild. Detached query and sync snapshots remain available,
but reconnect polls wait for adoption to commit. There is no population-independent
bound on that hold.

On the retained M7 scale fixture (1,447,960 rows, 9,077,125 index entries), round 1's
HTTP witness measured **6,302 ms** for `/changes` during a **6,299 ms** adoption.
The same held transaction answered an authenticated query in **5.607 ms** and
sync in **9.573 ms**. Before round 1's key-validation reuse and capture-key
optimization, the transaction-measured core fixture took **9,239 ms**; independent
round-0 reviews measured **7,283–7,732 ms** (the lane recorded 9,601 ms).
Disabling the two round-1 performance changes in the same HTTP witness gave
**9,710 ms** of `/changes` wait for **9,709 ms** of adoption
(`r1-http-scale-before.log`). These are observations, not constant bounds. Raw logs are ignored under
`snapback4/target/lane-ad-evidence/r1-http-scale.log` and `r1-scale-before.log`;
the durable summary is in `snapback4/reports/20260926-lane-ad-adoption.md`.

Reproduce from `snapback4/` after preparing `m7_to_m8`'s opt-in fixture:

```sh
SNAPBACK4_ADOPTION_HTTP_DB="$PWD/crates/snapback4-core/target/adoption-scale/m7.db" \
  cargo test -p snapback4 --bin snapback4 scale_changes_waits -- --ignored --nocapture
```

The witness holds adoption inside SQLite, proves `/changes` has queued for the
writer, serves query/sync through the real HTTP dispatcher, then measures how
long the reconnect waits through the remaining adoption.

The follow-up must give durable reconnects bounded writer access, for example
by durable adoption chunks. Preserve old-generation reads until complete
publication, exactly-once concurrent-write accounting, rollback/restart behavior,
log order, authorization, disclosure and resource meters. A pending count must
never become a complete partial answer.

Do **not** acknowledge reconnect only in memory or defer its durable write:
a crash after acknowledgment could leave a previous durable presence-loss
candidate eligible and send a notification despite the acknowledged reconnect.
The acknowledgment must follow durable cancellation/renewal of that candidate.
Acceptance should hold adoption across multiple chunks, prove a reconnect
commits within one bounded writer interval, and crash/reopen around both the
reconnect and adoption boundaries without resurrecting the loss candidate.
