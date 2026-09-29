# HV round 3 context

Scope: the two defects reproduced in the full Grok round-2 review: concurrent
format migration during a built-in save, and the missing private witness
reservation in the one-candidate acquisition fallback. Rounds 0–2 prompts,
reports and their retained constraints remain binding. No word-index deferral,
ceiling increase, publication or push. The wasm must not grow.

Applied the read-only `llp-orient` skill from
`/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md`; the local
skill link still has no target. Current scope:

- LLP 3000#4: separate Snapback 4 workspace, checks and fixed budgets.
- LLP 2000.000#6 and #7: runtime metering and partition custody.
- LLP 3000.015#3: live basis, private witness reservation, caller-ledger admission
  before prepaid certification and state restoration on success/refusal.
- LLP 3000.007#20.4: strict per-call commit, format migration, canonical images
  at memory-store boundaries, complete indexes before publication and replay.
- LLP 3000.008.004#3: actual browser persistence fault and reopen evidence.
- LLP 3000.007#20.4.1: deferred word indexes are still only a proposal.

Root, .007 and .015 remain in current; no Snapback 4 foundation entry. Read the
current sync card. Existing LLP sections govern both fixes; no new design doc.
Risk: stale cached format versus the actual writing transaction, retry authority,
private SQLite witness allocation hidden by prepaid peak restoration. The
pricing scanner is still canonical-only, protected by canonical publication and
restore, with entry assertions. Hand-off: none.

Merged origin/main `16fb4aa721` first, in `5b5e8db91c`, keeping both append-only
journal sides. LL and SR changes survive. The delivery await file merged cleanly
but was regenerated through `awaitBoundary()` anyway, and regenerated after the
save change. No fault classification, recipe or site was removed. The cache
retry remains inside the persistence boundary already exercised by its callers.
The new concurrency tests hold the completion callback of the preliminary
readonly marker transaction; another built-in object migrates before it resumes.
No source instrumentation or production test hook creates the interleaving.
