# PRL round 1 context

Scope: online ready callbacks in `client.ts` and capacity turns in `read-work.ts`.
Used `skills/llp-orient/SKILL.md`; read the round-0 prompt/report, both complete
reviews, the Snapback 4 command sheet, NOT-DOING and journal, the current client
guide card, and the PR round-5/6 publication audits.

Governing LLPs:

- LLP 3000#4: independent Snapback 4 workspace and verification fence (current).
- LLP 2000.000#8: client state vocabulary (current).
- LLP 3000.023#10: queue, publication, authority and retention rules (current).
- LLP 3000.023#11: one-shot settlement is outside this change (current).

Active constraints: LLP 3000.023#10 keeps eight starts per host turn, eight
active attempts, bounded priority overtaking, immediate withdrawal evidence,
publication before positive notification, local queue-clock pause and online
queue-inclusive authority deadlines. Captured callbacks contain no saved read
body and retain live-owner/subscription checks. The relevant rationale is the
same section's PRL per-row publication-cost record: amortize React work without
changing what authorizes an answer.

Risk: a host can deliver a timer late after a successful publication; this is
paint latency, not added authority time. React Native is tested through globals,
not a physical Hermes host. No new contract, dependency, gate or cache is needed.

Doc updates: extend LLP 3000.023#10 with callback isolation, DOM host selection
and rejected-task fallback; append one journal entry. Hand-off: none.
