# Affected-scope corpus audit

Read-only post-merge check of the changed social starter and its governing
contract, limited to LLP 3000.031 §1.1/§1.3, the landed LLP 3000.023 §10 and
LLP 3000.028 §8 decisions, and the client/social/offline guide cards and starter
README. This does not assert acceptance of the Draft RFC or a whole-corpus audit.

- The implemented composer gate, client example, social README/card,
  offline-interactions example and LLP 3000.031 §1.3 agree: denial blocks;
  absence blocks only when fresh and not revalidating; stale absence, loading
  and partial permit durable custody. Authorization still occurs at sync.
- LLP 3000.031's Revised line explicitly names SR's landed decision. Its
  retention text records LL's sync-publication resumption, whole-answer
  fallback and terminal-refusal behavior. The merge keeps those paths and
  recomputes existence at replacement/publication.
- The no-horizon membership proof remains separate from send authorization.
  Admin-written membership is not widened to own-key replication.
- DM route resolution retains its complete/non-revalidating lookup rule;
  status rendering changes do not substitute the composer's custody policy
  for routing or protected-content safeguards.
- The client rules table remains, and the whole guide's 105 checks passed.
  The final reference audit is recorded in REPORT.md.

No unresolved drift was found in this affected scope. LLP 3000.031 §0 remains
historical motivating evidence; its quoted pre-change Read shape is not the
current contract declaration. No status was changed or review fabricated.
