# RG round 5 context pack

Scope: local-client admission, FIFO flushing, receipts, observation, media and
terminal delivery. Read prompts for rounds 0–4, their reports and RG journal
entries, the Snapback 4 fence/root/exclusions and Grok's complete round-3 review.
First fetched and merged main e0568c2ec7 in merge 58b3b2d07, without conflicts.
The merge message was amended solely to add the requested co-author trailer.

Used llp-orient read-only from the initialized sibling
`/home/ccheever/sb4-intent/lane-i/vendor/llp/skills/llp-orient/SKILL.md`.
No sibling edit, skill install or new delegation. Snapback 4's governing LLPs
are in current/, not the legacy foundation/ kernel.

Governing LLPs and constraints:

1. LLP 3000#1 / #7 and LLP 2000.000#6: the Snapback 4 fence, one device
   implementation, unchanged authorization, disclosure and resource ceilings.
2. LLP 3000.013#6: only committed/qualified outcomes establish custody;
   persist known receipts before retirement, preserve them through save failure,
   and keep caller, lookup and terminal notification consistent.
3. LLP 3000.019#3.3: queued dispatch shares settlement sync; terminal delivery
   survives failed observation/post-commit housekeeping; notification owners
   protect all outstanding FIFO snapshots and overlapping deliveries.
4. LLP 3000.022#4: delivery reporting follows ordinary outbox work and accepted
   publication; receipt coverage and conditional debt persistence are unchanged.

Current fact homes read: writes, receipts and sequences cards; MediaCache's
LLP 3000.007#8 and 3000.019#3.5 references still govern byte revalidation.
The writes card already specifies durable admission, receipt custody and
at-most-once notification; this fix adds no public spelling or guide recipe.

Rationale/risk: repeating optional media work must not prevent a healthy outbox
from progressing. Durable admission and receipt saving have the same post-commit fault boundary
as settlement. Recovery must still preserve actual pre-commit errors, denied replies,
receipt persistence, store binding and FIFO/retryable-head authority.

Likely doc updates: LLP 3000.019#3.3, round report with the housekeeping audit,
and one append-only journal entry. Hand-off: none. No new LLP or runtime gate.
