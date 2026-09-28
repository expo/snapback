# RG round 6 context pack

Scope: the local client's FIFO, receipt batch, settlement and terminal delivery,
replacement/reset and reconnect; receipt history, media pruning, clock saves,
hold metadata and transport adapters. The matrix observes SDK call boundaries;
the host's internal transaction implementation remains behind DeviceCore.call.

Read the round 0–5 prompts/reports/RG journal records, the Snapback 4 command
sheet/exclusions/root and adopted rules, Astra's entire round-4/5 review, and
Grok's progress at start and completed READY review during work. Used llp-orient
read-only from /home/ccheever/sb4-intent/lane-i/vendor/llp/skills/llp-orient/SKILL.md
because the local vendor link is uninitialized. No skill/tool installation.

Governing LLPs (current/, not the legacy foundation/):

- LLP 3000#1 / #7 and LLP 2000.000#6: the Snapback 4 fence, single device,
  authorization/disclosure and unchanged meters/ceilings.
- LLP 3000.013#6: terminal custody, receipt persistence before retirement,
  caller/lookup/onWrite consistency and single settlement ownership.
- LLP 3000.019#3.3: FIFO without intermediate sync, eventual observation,
  independent housekeeping retry and outstanding emission ownership.
- LLP 3000.001 Repair B: publication and replacement fences remain unchanged.
- LLP 3000.022#4: delivery reports follow ordinary outbox work and committed
  coverage; no receipt telemetry becomes delivery authority.

Fact homes: writes.rs, receipts.rs and sequences.md in the compiler guide.
Media authority still follows LLP 3000.007#8 / LLP 3000.019#3.5.

Risk: a required outbox/custody read and an optional observation read may use
exactly the same device operation. Classify and inject by awaited call site,
not merely operation name. An already-proven terminal head need not block a
healthy tail while its receipt recovery waits. Never bypass an unknown head,
turn uncommitted storage into success, discard a notification owner or create a
second receipt window. Rejection catches cannot repair a promise that never
settles; the existing bounded exit transport remains a separate barrier.

Docs: extend LLP 3000.019#3.3, report the matrix and failure dispositions, append
one journal entry. Hand-off: none. No new generic gate or LLP.
