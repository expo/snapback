# HV round 2 context

Scope: the two round-0 correctness findings and the residual persistence cache
question. Read both HV prompts/reports, their failure ledgers and context, the
full Astra r0n and Grok r0 reviews, and the current sync guide. The local
llp-orient symlink target is absent; used the read-only skill at
`/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md`.

Governing constraints and rationale:
- LLP 3000#4: independent Snapback 4 workspace and checks; no root inventories.
- LLP 2000.000#6 and #7: runtime resource limits and declared partition custody.
- LLP 3000.015#3: live basis certification, expiry and authority per candidate;
  optional batching must reserve from the finite caller before prepaid work.
- LLP 3000.007#20.4: canonical memory images, complete indexes before publication,
  strict per-call persistence, format migration and old-reader fences.
- LLP 3000.007#18.2: retained history and current acquisition remain distinct.
- LLP 3000.007#20.4.1: deferred word indexes remain a proposal, not implementation.

Root, .007 and .015 are in current; no Snapback 4 foundation entry. No new LLP.
Likely updates: existing .007/.015, this report and one journal append. Risks:
restoring nested heap state after refusal; noncanonical nested JSON; obsolete
packing after a separate strict migration. Hand-off: none.

Merged origin/main 38abb89b8e0b206644b9e2619c6f2d159a981d23 first, in
8474e39603. Two journal conflict hunks retained both sides. An initial resolution
script incorrectly expected one hunk; the merge commit was amended immediately
with both hunks resolved, before implementation. No delivery-await conflict;
no production TypeScript awaits changed. The existing inventory is verified by
its detecting test, without hand editing or reducing its classifications.

The fixed wasm cap remains 593,719 B. WD owns reductions in main's existing
code; this lane must not increase its round-1 artifact. No budget ratchet,
word-index deferral, push, publication, or external messages are authorized.
