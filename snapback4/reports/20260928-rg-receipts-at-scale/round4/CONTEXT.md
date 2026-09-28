# RG round 4 context pack

Scope: terminal local-client delivery, emission cleanup, replacement/reset,
FIFO snapshots, receipt recovery and concurrent lookups. First fetched and
merged origin/main 80036b4664 into RG round 3; merge commit 412c9191c.
Read all four earlier prompts, reports and RG journal entries, and Astra's
complete round-3 review. Grok had progress text but no verdict at startup.

Used llp-orient read-only from the initialized sibling
`/home/ccheever/sb4-intent/lane-i/vendor/llp/skills/llp-orient/SKILL.md`;
this worktree's skill symlink is uninitialized. No install or sibling edit.

Governing LLPs (current, not foundation):

1. LLP 3000#1 and #7: Snapback 4 fence, scope and execution decisions.
2. LLP 3000.013#6: receipt custody, local versus shared lookup, single
   settlement authority, retained outcomes through failed saves and close.
3. LLP 3000.019#3.3: FIFO, shared settlement sync, terminal delivery despite
   post-commit failure and emission-marker lifetime.
4. LLP 3000.022#2.2 and #4: delivery evidence and ordinary outbox ordering.

Active constraints and rationale:

- LLP 3000.013#6: the caller, terminal event and retained receipt agree;
  unpersisted known outcomes precede replacement/replay. Lookup is not
  settlement authority. Unknown execution cannot be relabeled successful.
- LLP 3000.019#3.3: preserve FIFO without intermediate settlement sync,
  retryable-head blocking and final observation of settled successes.
- LLP 3000.019#3.3: committed retirement is not the end of notification
  ownership. Main's readQueued extraction must preserve RG's active owners.
- LLP 3000.022#2.2: no new telemetry, authorization, disclosure or delivery
  evidence; this task changes only notification lifetime in the SDK.
- LLP 3000#4: no legacy gates; no budget increase. Local.ts stays at 1,500 lines.

Current authoring facts read in the writes, receipts and sequences cards.
Risk found during audit: a FIFO snapshot can retain a later successful entry
across replacement even before that entry's branch starts. Its notification
ownership must start at snapshot acquisition, including a delayed host reply.

Docs to update: LLP 3000.019 §3.3, writes card and its existing fact-home
fixture, round report with per-path audit, append-only journal. No new LLP,
registry or gate. Hand-off: none.
