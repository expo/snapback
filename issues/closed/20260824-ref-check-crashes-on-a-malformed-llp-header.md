# ref-check crashes repo-wide on one malformed LLP header

Status: Resolved 2026-08-25
Date: 2026-08-24
Systems: tooling
Related: LLP 0303

## What happened

I landed LLP 0303 with plain-text metadata (`Status: Accepted`) instead of the repository's bold
convention (`**Status:** Accepted`). `FIELD_RE` did not match, so `Status` was absent from the
parsed fields, and this line crashed:

```python
status = fields.get("Status", "").split()[0].lower()   # ref-check:205
```

`"".split()` is `[]`, so `[0]` raises `IndexError`. The result was not a reported error against my
document — it was a **traceback that aborted the entire run**, for every session in the repository,
until the header was corrected.

## Why this is worth fixing rather than just not repeating

1. **One bad document disables the whole check.** ref-check is a landing gate. A single malformed
   header silently converts "the corpus is clean" into "the tool cannot run", and the failure mode
   looks like tooling breakage rather than a document problem.
2. **The adjacent line already guards correctly.** One line above, the `Type` field is read as
   `fields.get("Type", "").split()[0].lower() if fields.get("Type") else ""`. The `Status` read
   omits that guard. It is a one-line inconsistency, not a design decision.
3. **The error it should have produced already exists.** The loop immediately above emits
   `missing required metadata field **Status:**` for exactly this case. The crash happens before
   that report is printed, so the tool destroys its own diagnosis.

## Suggested fix

Guard the `Status` read the same way `Type` is guarded, and let the existing missing-field error
report the problem. Optionally, wrap the per-document parse so that one unparseable document is
reported as an error against that document and the run continues over the rest — a corpus checker
that stops at the first malformed file cannot tell you how many files are malformed.

## Note for authors

Metadata headers use bold markdown: `**Type:**`, `**Status:**`, `**Systems:**`, `**Author:**`,
`**Date:**`, `**Revised:**`, `**Related:**`. Plain `Status:` parses as ordinary prose and the
document is treated as having no status at all.

## Resolution (2026-08-25)

The `Status` guard requested by the ticket was already present on this lane's
main base, so a plain-text `Status:` no longer reaches the former empty-split
`IndexError`. A temporary copy of LLP 0303 with that malformed header produced
exactly `missing required metadata field **Status:**`, exited 1, and emitted no
traceback.

The remaining corpus-wide failure mode was that an unexpected exception in any
document's heading/metadata parse still escaped the document loop. `ref-check`
now catches that parse per document, reports the document path plus exception,
and continues collecting the rest of the corpus. `tests/ref_check_v0.py` covers
both the real plain-text-header diagnostic and a forced one-document parser
failure; the hardening test failed with the expected `ValueError` traceback
before the implementation and the full focused suite passes afterward.
