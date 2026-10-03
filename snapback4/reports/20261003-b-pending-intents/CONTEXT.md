# Lane B context pack

Scope: pending writes, receipt facts, React presentation, client/facade retirement;
Cal29 B1–B3 and the missing media-send fallback. `llp-orient` was read from the
available sibling `lane-cx/vendor/llp/skills/llp-orient/SKILL.md`; this lane’s
project skill symlink was uninitialized. No skill install or external action.

Governing LLPs and working-set links at orientation:

- `3000-snapback4.explainer.md`: current.
- `3000.019-what-the-builder-still-wrote.rfc.md`: current.
- `3000.022-delivery-the-sdk-reports.rfc.md`: current.
- `3000.023-answers-stay-on-screen.rfc.md`: current.
- `3000.032-client-contract-builder-costs.research.md`: current.

Active constraints: LLP 3000.019#3.3 (sole outbox, FIFO, observed retirement);
LLP 3000.022#14 (no provisional receipt accounting or fabricated media authority);
LLP 3000.023#3.4 and #3.6 (hard scope/facade withdrawals);
LLP 3000.032#4.2 (explicit mappings and terminal-to-observed composition), #2.3
(physical lines/UTF-8 byte measurement). The Snapback 4 fence excludes Snapback
1–3 bootstrap, inventory and proof gates. Core contract.ts is unchanged.

Rationale: pendingWrites omits terminal success; a view of that list cannot
represent the interval. Read existing local receipt/outbox facts, without adding
admission, delivery, prediction or settlement authority. The proposed guaranteed
predicted row is unsound under unknown coverage and authority.

Risk: an online journal retires arguments at terminal settlement, unlike a local
device’s observed-write custody. Online presentation is therefore a session
reference, not new durable custody. After close, use a saved scoped intent
reference and receipt lookup. A missing receipt remains unknown.

Doc updates: LLP 3000.019 §3.3.1, the §4.2 implementation pointer, client/writes/
social guide cards, package README/Client and operations, starter README and
emitted declaration comments. Hand-off: none.
