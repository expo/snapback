# Capability index budget for the guest-session row

Status: Open

`auth.guest-sessions` is a shipped, independently searchable capability and
LLP 0061 requires it to remain in the capability index with a real witness.
The index on `origin/main` is 61,435 bytes against a 61,440-byte ceiling, so
the new row cannot fit without deleting or truncating unrelated truth.

This change raises the authored capability-index ceiling to 63,488 bytes,
while keeping the unrelated `backend.write-activity-v1` GAP review date
byte-identical to `origin/main` at 2026-09-30. Future work should split the
index by product area under LLP 0061 rather than manufacture space by altering
evidence or review dates.
