# RG round 3 context pack

Scope: local terminal receipt delivery, flush exit observation, store replacement,
keepalive settlement, and their deterministic real-device tests. Read the prior
rounds' prompts, reports and journal entries, and Astra's entire round-1/2 review.
Grok had no verdict at start; no wait. First fetch/merge was already up to date
at 86fd998e8 (origin/main a745b110f).

Used llp-orient from the existing sibling
`lane-i/vendor/llp/skills/llp-orient/SKILL.md` read-only because this worktree's
vendor link is uninitialized. No installation.

Governing LLPs (all in current, none in foundation):

1. LLP 3000#1 and #7: Snapback 4 fence and execution decisions.
2. LLP 3000.013#6: durable receipt custody, single settlement ownership,
   closing responses, local versus shared lookup and terminal consistency.
3. LLP 3000.019#3.3: FIFO dispatch and shared settlement observation.
4. LLP 3000.001 Repair B: an image ahead of a live prediction stays private;
   received pages are not necessarily published rows. Consulted for full-suite
   maintained-column fixture correction.
5. LLP 3000.022#2.2 and #4: delivery reports require committed coverage;
   background delivery respects the ordinary outbox and its network chain.

Active constraints and rationale:

- LLP 3000.013#6: a terminal result already durably recorded must reach the
  caller and onWrite; later housekeeping is not authority to erase it.
- LLP 3000.019#3.3: retain healthy publication-before-batch-completion and
  never insert sync between successful FIFO POSTs. The final flush guard
  covers a tail retired before the network callback's queue lookup.
- LLP 3000.013#6: a callback is evidence only after device commit; a failed
  pre-commit persistence attempt cannot retire the outbox or publish an exit refusal.
- LLP 3000.022#2.2: no receipt telemetry becomes delivery evidence. No server,
  meter, authorization, schema, wasm capability or budget change.
- DeviceCore.call's existing callback contract (local-device.ts): memory
  invalidation may happen at commit; application callbacks wait until the host
  call completes or rejects, preventing reentry into host bookkeeping.

Current authoring facts checked against the writes, receipts and sequences
cards. Relevant rationale: terminal notifications and client.write(id) agree;
store replacement invalidates the partition before publishing new answers.

Risk: post-commit media/host work also sits inside call(), including recovered
receipts and settle_exit. Reset additionally awaited state and metadata work
before reporting retired successes. Audit and fault controls cover these paths.

Likely docs: LLP 3000.019#3.3, the round report with the complete audit and test
record, and one append-only journal entry. No new LLP or gate.
Hand-off: none.
