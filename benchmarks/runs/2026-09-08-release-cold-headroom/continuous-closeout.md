# Published 0.0.19 continuous Clique diagnostic

The fresh Sol/xhigh session completed M1–M6/M8 and the scale replay, then exited
0. Local web receipts passed for M1, M2, M4, M5, M6 and M8; M3 remained 6/7.
These are useful diagnostic observations. The session is **not a conforming
full-run scorecard**: M3 was abandoned before its cap, and dependent milestones
were nevertheless executed. No calibrated O scores or overall comparison are
claimed. Independent assessment and the separate fresh M7 remain in progress.

`continuous-result.json` binds selected receipts to exact suite hashes. The
104-file evidence manifest includes retained failed attempts. The source archive
is 5,855,907 bytes, SHA-256
`ecf813110cd46e46d692a920f4bc50d731e7c1be645a7ca0311da69600b72b68`,
under `/Users/ccheever/projects/snapback-artifacts/clique-cold-019-20260908/`.
Its 509 entries include authored source and frozen fixtures, including synthetic
fixture credentials; dependencies, runtime databases, private environment
files, builder narrative and grading findings are excluded.

## Record corrections

A separate read-only audit by `/root/compiler_closeout_audit` checked the
original builder records, controller prompt and frozen protocol. Original
artifacts remain unchanged; schema validation alone did not catch these issues.

- The commissioned cap was **14,400 seconds per milestone**. The builder's
  statement that no cap was supplied is incorrect. M3's 1,251 seconds is its
  observed attempt duration, not its cap. Its final `aborted` classification
  correctly replaces the early `capability-failure` label; the protocol would
  charge an abort 14,400 seconds. No such score is calculated here.
- The Erin fixture inconsistency has an independently confirmed issue, but it
  does not provide a prerequisite waiver or independent app pass. M4/M5/M6/M8
  ran despite the frozen DAG; retain their receipts as diagnostic continuation.
- The 06:58:43–13:16:18 UTC interval is **22,655 seconds gross elapsed**, including
  the 1,255-second replay. Subtracting replay gives 21,400 seconds, while the
  reported milestone values total 21,371; the remaining 29 seconds is between
  M2 and M3. Native work overlapped replay, so subtraction does not establish
  exclusive authoring time. No efficiency claim uses these figures.
- First green and later phase closure differ. M6 first browser green was
  11:53:46.721 UTC; its later terminal was 12:26:32. M8 first green was
  13:10:17.819, followed by owner-restart verification and another green at
  13:16:10.176. The latter is incorrectly labeled first green in the original
  JSON. M4/M5 also use later milestone markers. Preserve each actual timestamp.
- The chosen final acceptance marker is 13:16:18 UTC. Recorded closeout ends
  13:49:32; the controller observes process exit at about 13:50:41. These are
  separate from authoring. Original zero-second `grader-abort` is a placeholder
  for grading not yet performed, not an executed grading attempt.
- The builder diary overstates the busy group's size as 50,000 messages. Its
  actual named replay checkpoint values are **1,000 / 5,000 / 10,000 messages**,
  with 50 members. All 167,157 replay actions settled in 1,255 seconds. Only the
  named fixture checks are evidenced; full manifest coverage is unestablished.

## Native and experience limits

M6 and M8 Release builds installed and launched to the Clique sign-in UI.
Screenshots were independently viewed. No qualifying offline cold-start,
process-kill, media/search, ordered-flush or read-receipt recording exists;
native behavioral results remain null. A missing generic automation driver is
builder-reported friction, not a proven platform defect or impossibility.

The builder reports that Quarry's explicit membership, policy and retained
history made authority easier to reason about. Most friction came from composing
expiry with delivered-history retention, tombstone drains and optimistic UI,
plus client-owner lifecycle and native/web renderer differences. These are
experience reports, not competitive measurements. Existing guide-gap and
instrument tickets distinguish documented recipes from missing guidance and
harness interoperability; none was fed back into the cold builder or grader.
