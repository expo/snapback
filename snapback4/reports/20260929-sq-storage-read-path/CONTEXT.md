# SQ round 0 context (llp-orient)

Orientation snapshot, before measurement.

Scope: server SQLite readers, writer/checkpoint interactions, calibration #25.

Governing documents: LLP 3000 §7 (reader reuse, packaged SQLite policy;
root, outside foundation/current), LLP 3000.007 §20.24.1 (PF preflight and
shared storage images), LLP 3000.019 §§3.6–3.7 (current: independent snapshots,
read admission, timing), LLP 3000.013 §4 (current: durable published watermarks).
The repository fence adopts rules/RULES.md; this commission explicitly permits
measurement tools, a regression, a report and an LLP update.

Constraints: preserve FULL and single writer (LLP 3000.013#4), fresh identity
checked read snapshots (LLP 3000.019#3.6), authorization and meter/disclosure
contracts (LLP 3000.007#20.24.1), unchanged device behavior and 593,719 B gzip
cap (user commission). Page caches are shared storage images outside caller
heap (LLP 3000.007#20.24.1). Packaged comparison builds disable SQLite global
memory management (LLP 3000#7). Read the bounds and reads guide cards: engine
wall includes I/O/descheduling, wait is acquisition, header total is preflush.

Rationale: detached read connections and reserved read admission already exist;
writer/checkpoint blocking must be established rather than inferred. PF's
warm search had zero cache misses. Warmup and live replay may differ materially.

Open questions: read cache eviction after commits; background work remaining
after replay; WAL reads versus main-file reads; macOS-specific scheduling or
I/O costs. Large per-connection cache limits multiply by reader count. Mmap
would need explicit local-file opt-in and read-only CLI consistency, not a
silent default for arbitrary filesystems.

Likely updates: this report, journal, and an extension of §20.24 if evidence
supports a policy. No new LLP needed. Agent delegation: none.
