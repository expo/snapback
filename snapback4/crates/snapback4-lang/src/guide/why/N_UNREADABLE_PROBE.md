# N_UNREADABLE_PROBE

A program guard sees only caller-readable rows. N_UNREADABLE_PROBE is advisory. The note names the target read
rule when its pins and preceding guards do not prove read authority. A hidden
row cannot satisfy `exists`; `require not exists approvals[job] else JOB_APPROVED`
may admit a caller even when an approval exists but is hidden. Table-rule
probes see all rows. This is conservative advice, not a change to execution.

Use a unique/cap/after insert constraint for an invariant across hidden rows,
or authorize the caller to read exactly the rows the guard must observe.
Keep a guard as written when caller-visible existence is intended. Jobs in
system context are exempt; a pinned self-membership key and a preceding
readable role guard do not need this note.

The check follows helper calls and named shapes. It also checks point-existence
values at observation time, so assigning the value before a later grant does
not hide a guard defect. Positive `require exists` authorizes the caller;
ordinary query prefix/search values answer caller-visible existence. If a
prefix value later feeds a guard through an alias or helper/shape input, its
original observation is checked with the authority held at that time. A job's
`as` block uses that viewer's read rules and is checked too. Facts expire after
writes, relevant rebinding and viewer changes; fresh readable evidence can
prove the next probe safe.
