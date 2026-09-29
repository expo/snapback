# AQ round 1 context

Scope: IndexedDB physical version, preservation of existing stores, and migration durability regressions. Read round 0 prompt, REPORT.md and CONTEXT.md; Astra review in full. Grok at start contained progress only. Initial fetch/merge produced only an append-only JOURNAL conflict; both entries retained. Merge commit: 50b66b6a0.

Applied llp-orient from the populated lane-sq/vendor/llp/skills/llp-orient/SKILL.md, read-only; this lane’s skill target remains absent. No Snapback 4 foundation entry. LLP 3000, 2000.000 and 3000.007 are in current; 3000.008.004 is archived.

Governing constraints and rationale:
- LLP 3000#4: separate Snapback 4 workspace and checks.
- LLP 3000.007#20.4: strict atomic persistence, durable outbox and exclusive ownership; format upgrade preserves all committed rows and metadata.
- LLP 3000.008.004#3: actual browser faults and reopening; configuration evidence must not be confused with physical power-loss proof.
- LLP 3000.007#18.2: acquisition publishes coverage and rows together.

The current client/sync guide was read before editing. Format 3 needs a physical database version fence because an exclusive lock only serializes owners; it cannot make an old adapter understand a new representation. An aborted row migration may retain format 2 inside physical version 2; the current adapter can retry, while old version-1 clients must remain fenced. Existing stores must not be recreated or cleared during the version upgrade.

Likely docs: update the existing .007 §20.4 record, sync guide, round1 report, append one journal entry. Hand-off: none.
