# SR round 2 context and scoped reconciliation

Scope: social starter proposal/send references, one private recovery lookup,
Send's incomplete-null boundary, and its existing browser/server tests.
Read rounds 0/1 prompts and reports, Astra round-1 review in full and Grok
round-0 review in full. Merged origin/main a2e3876b60 first in afe6c62d92;
retained both journal histories and the KR/macOS fixes.

Governing LLPs: current/ LLP 3000#4 (fence), LLP 3000.028#8 (route/composer,
custody and authority), LLP 3000.023#10 (retention/reset),
LLP 3000.008.002.000#3-submit-once-then-let-the-user-continue (saved UI references),
LLP 3000.022#2 (SDK owns delivery). None is in foundation/. Read client,
social and reads cards; the current starter is their executable recipe.

Constraints/rationale: associations must survive all pending/recoverable sends,
with unchanged arguments and no automatic resubmission (LLP 3000.028#8).
Navigation and query status must not remount the composer. Private keys give
identity only; leave still revokes membership/content authority. Account/backend
fences remain (LLP 3000.023#10). No SDK/core change or raised budget.

Implementation: save association atomically with the provisional send, not the
opening; prune only associations whose last send is gone. Legacy orphans prune
on mount. One indexed private reverse lookup resolves the current route only.
Grok note 3's complete-null edge gets a defensive guard; note 4's key-writer
membership invariant remains an explicit limitation. No rule is widened.

Risk checks: multiple sends/proposals, unknown outcomes, unmount/reload before
settlement, final dismissal, failed/abandoned openings, private offline recovery,
100 unrelated unresolved peers, both HTTP opens before commit, leave/reopen.

Doc updates: existing LLP 3000.028 §8, social card, starter README, one appended
journal entry and round2 report. Scoped audit: the touched @refs still resolve
and describe the final code. No new LLP/status change is needed. Hand-off: none.
Optional native runtime smoke remains unqualified. Nothing pushed/published.
