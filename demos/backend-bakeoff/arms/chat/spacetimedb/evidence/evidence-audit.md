# Evidence audit

- Frozen scenario count: 15
- Accounted scenario count: 15
- Result mix: 13 PASS, 2 GAP, 0 FAIL
- Duplicate or missing acceptance IDs: none
- Stop-class defects: none
- Raw identity tokens retained: no
- Actor identifiers in receipts: SHA-256 only
- Private read proof: Mallory saw zero private rows
- Private subscription proof: direct private-table subscription rejected
- Push attribution: SpacetimeDB WebSocket row callbacks; no product polling
- Performance: five paths, each with two warmups and seven raw samples
- Cleanup: failed owner-token delete preserved; exact arm-only data-directory
  fallback succeeded; database negative lookup and both port negatives retained
- Hosted evidence: explicit environment GAP, not a local-as-hosted claim
- Snapback frozen commit changed: no

The two scenario GAPs are CHAT-06 (typing is durable-row application glue)
and CHAT-09 (no persistent cold-start offline history). Neither is counted as
a pass.
