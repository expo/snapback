# RV round 2 context

## Scope

SQLite server/native device opening, `Tx::record_commit`, and the existing
revocation-history test target. No client or classifier behavior changes.

## Governing LLPs

- LLP 3000 (foundation), §4 and §7: Snapback 4 fence and SQLite plan reuse.
- LLP 2000.000 (foundation), §12: unchanged resource ceilings and append-only journal.
- LLP 3000.023 (current), §12: server evidence, bounded history, missing intervals.
- LLP 3000.019 (current), §3.4: native store ownership and legacy opening contract.
- LLP 3000.011.004.000 §2: caller-owned open busy timeout remains intact.

## Active constraints

- LLP 3000#7-decisions-during-execution: prepare and reuse SQLite read plans;
  ordinary transaction boundaries must not force schema invalidation.
- LLP 3000.023#12: retain 1,000 summaries in the commit transaction, certify no
  more than 500 contiguous commits, and widen absent evidence.
- LLP 3000.019#3.4: native opening must not add the server evidence table;
  retain the sidecar ownership boundary and legacy device behavior.
- LLP 3000#4-fence-numbering-routing: use Snapback 4's own workspace/checks.

## Relevant rationale

LLP 3000#7-decisions-during-execution records that SQLite schema changes still
invalidate plans despite QPSG. LLP 3000.023#12 requires summary persistence,
not per-commit table creation. The current client guide's “Honest read
boundaries” remains accurate: absent historical evidence stays conservative.

## Open questions / risks

The shared `open_shared` call formerly entered server `open`; adding DDL there
would violate native compatibility. It must enter common initialization before
server evidence is added. The device has no `record_commit` callers.

## Likely doc updates

Update LLP 3000.023 §12, append report/failure corrections and one journal entry.
Do not rewrite historical round-1 records or change either performance test.

## Hand-off

None. The user authorized this repair and a local commit only.
