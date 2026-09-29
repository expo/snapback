# SR context pack

Scope: embedded social starter, its browser/real-server tests, social/client/native cards and aliases.

Governing LLPs (all in current/, none in foundation/):
- LLP 3000 §4 and §7: Snapback 4 fence, independent workspace, unchanged ceilings.
- LLP 3000.028 §8: route/composer lifetime, typing arm, once handle ownership.
- LLP 3000.023 §10: current revalidation policy, not the superseded universal cap in §3.
- LLP 3000.022 §2: SDK delivery binding, success is coverage.
- LLP 3000.008.002.000 §3: custody, per-intent receipts and no automatic retry of unknown outcomes.

Active constraints and rationale: LLP 3000.028 §8 owns user state above transient reads;
LLP 3000.023 §10 keeps SDK authority withdrawals and account/store resets;
LLP 3000.022 §2 leaves delivery reporting with the SDK. Durable custody and a
protected-content grant are different actions under LLP 3000.008.002.000 §3.
The user explicitly authorizes correcting §8 and adding DMs without changing SDK
semantics or existing server rules, pushing, publishing, or raising budgets.

Risks: canonical server ID can differ from a predicted ID; replay receipts may
lack result; missing coverage is not absence. Native smoke remains optional.
Doc updates: revise existing LLP 3000.028 §8, guide cards and starter README;
append journal and this report. Hand-off: none.
