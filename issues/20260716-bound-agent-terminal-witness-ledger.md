# Bound or compact the Agent terminal-witness ledger

**Status:** Open
**Severity:** P3
**Systems:** Agent auth, Durable custody, Filesystem storage, Operations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Durable custody record
**Marker:** durability, storage-growth, operations

Durable Agent custody now retains one terminal witness per exact
`(custodyId, authorityKey)` so a later primary-row replacement cannot resurrect
an old validated descriptor. Those witnesses intentionally have no age-based
garbage collection: deleting one independently would reopen its tuple. A
long-lived custody id with unusually high durable tuple churn can therefore
accumulate an unbounded number of small witness files. Explicit replacement of
the whole custody store is the only safe reclamation boundary today.

**Done when:**

- Define and document a bounded representation or an operationally explicit
  whole-store rotation/compaction protocol that cannot forget any terminal
  tuple still representable by a validated descriptor.
- Compaction linearizes with the universal custody gate and is crash-safe; a
  mixed old/new process cannot bypass the compacted evidence.
- Inspect/diagnostics expose redacted witness count and storage bytes with a
  bounded warning threshold.
- Tests cover high-churn growth, crash at every compaction phase, delayed old
  descriptors, mixed-version refusal, and recovery without resurrection.
