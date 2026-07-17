# Localize legacy Agent custody discovery and bound steady-state work

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Durable custody, Filesystem storage, Operations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-17
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** security, durability, isolation, performance

The first v2 terminal-ledger migration walked every record in the shared
custody directory on every universal-gate operation. Its filesystem pager
re-walked and parsed the directory for each page, while every nested partition
lock independently repeated a global orphan walk.

## Resolution

Global discovery is confined to a pre-cut migration attempt and uses one
bounded filesystem snapshot across all pages. The cleanup seal is durable only
after identified journal files are compacted. After it, comparisons, terminal
decisions, and straggler recovery derive only the candidate's exact witness ID;
`inspectCustody()` reads only the fixed root and at most 64 buckets.

Unidentifiable or churning scan rows are skipped without trusting their bytes.
This does not create an allow: every candidate still receives a strict exact
lookup, and a malformed record at that exact one-way-hashed filename fails the
candidate closed after the seal. Structurally identified records belonging to
the migrating custody remain strictly validated.

Crash-orphan cleanup now checks one deterministic `<record>.tmp` sidecar
instead of opening the shared directory. At most one 64-KiB new orphan can
exist for each fixed conforming partition.

## Verification

- An in-memory proof adds 1,000 unrelated/malformed partitions after the cut
  and observes zero additional scan calls through compare-and-commit and
  inspection.
- Real-filesystem proofs cover 1,000 malformed unrelated files, unrelated
  malformed JSON during migration, and an exact malformed witness that
  survives the cut and fails only its candidate closed.
- The pager and scan-limit tests cover one snapshot and the 4,096-entry
  operator-rotation boundary.
- `node demos/_kit/tests/agent-authority-custody.mjs`
- `node packages/snapback-contract/agent-authority-contract.test.mjs`
