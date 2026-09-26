# Snapback 4: a denied answer can become readable when a negatively probed `expire at` witness expires, with no notification

**Opened:** 2026-09-26 (from the LLP 3000.017 revision-1 review, Astra F6)
**Severity:** Medium (stale denial on the client until an unrelated change)
**Area:** `crates/snapback4-core/src/engine/rules.rs` (`evaluate_verdict`), `read.rs` `note_expiry`, the clients' `nextExpiry` re-fetch

## What happens

A rule such as `read <- not exists silence[principal = viewer]` over a durable
table `silence` with `expire at .until` denies while the witness row lives.
The denied answer carries `nextExpiry = null`: `evaluate_verdict` keeps a rule
deadline only for `Readable` verdicts (`rules.rs:250`), so the witness's
deadline is not exported. When the witness expires, the same query becomes
readable, but no commit happens (expiry is not a commit until the sweep's
deletion, and a watcher of the denied query may not read `silence` at all), so
a client keeps the empty answer.

Astra's probe (existing mechanism, 0.4.2 tree): the query returned `[]` with
`nextExpiry=None` at t=1500; after the witness expired at 2000 it returned a
row at 2001.

## Why it is not simply "export the deadline"

Exporting a denied witness's deadline discloses when a hidden row expires.
A fix needs a disclosure-safe tick (for example, a per-table expiry epoch that
wakes watchers of a rule-probed expiring table without the row's time), or a
compile-time restriction on negative probes of expiring tables.

## Scope note

LLP 3000.017 (ephemeral tables) avoids widening this by refusing every rule
probe of an ephemeral table (§2.1, §6). This ticket is the durable case only.
