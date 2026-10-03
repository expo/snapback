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


## Round 1 context and affected-scope audit

Read both complete blind reviews (`b-r0.astra.md`, `b-r0.grok.md`) and the
Snapback 4 fence, NOT-DOING, governing root/design brief, rules, journal tail,
LLP 3000.019 §3.3.1, LLP 3000.023 §§3.4–3.6 and the paved client/writes guide.
The previously recorded lane-cx skill path is absent on this host. Read the
available `llp-orient` at
`/home/ccheever/projects/exact/.agents/skills/llp-orient/SKILL.md` instead.
Its read-only orientation produced this extension; no installation or delegation.

Scope: online and local pending presentation, custody/receipt transitions,
React owners and read evidence. Governing working-set docs are unchanged from
the pack above. Constraints: LLP 3000.019#3.3.1, LLP 3000.023#3.4 and #3.6,
LLP 3000.022#14, LLP 3000.032#4.2. Presentation retirement is distinct from
query/watch reset. Same-principal/store bearer/schema changes fence read
revisions but retain settling text; account/store retirement still withdraws.

The existing LLP is updated, without a new registry, outbox, persistence format,
wire protocol, Client contract, or gate. Online state retirement now requires
explicit authorized-read evidence; bare value equality is insufficient. The
read is optional only because local device retirement remains authoritative.
Mounted ownership and bounded eviction replace the unbounded session history.

Affected-scope audit: LLP 3000.019, Client and operations, client guide and hook
option declarations now agree. LLP 3000.032's implementation pointer and the
closed ticket already delegate lifetime details to §3.3.1; their preserved
pre-implementation estimates remain marked historical. The pilot remains a
local-device app; it makes no online read-evidence or code-saving claim. No
broken @ref or new design document is needed. Hand-off: none.
