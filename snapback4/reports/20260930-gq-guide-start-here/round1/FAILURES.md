# GQ round 1 — every failed check

All guide/test development failures below are **ours** and were repaired.
No affected product test remains failing. The round-0 records are unchanged.

- Setup: the first edit/test command used repository-relative paths while its
  working directory was already `snapback4/`. The Python read failed with
  `FileNotFoundError`, followed by missing report-directory redirections. No
  source edit or test execution occurred. Corrected the command's working path.
- [guide-first.log](guide-first.log), exit 101: **108 passed, 1 failed**.
  `every_card_compiles_clean` found `N_NO_HORIZON` in the new unbounded reaction
  table at rules blocks 1/3 and start block 4. Added an explicit child horizon.
- [guide-second.log](guide-second.log), exit 101: the new runtime witness failed
  to compile with `E0596`; its query helper took `&Engine` instead of `&mut Engine`.
  Corrected the test helper. No tests executed in that invocation.
- [guide-third.log](guide-third.log), exit 101: **108 passed, 2 failed**.
  `every_card_compiles_clean` and
  `intent::rules_opening_inherits_message_authority_lifetime_and_sync` found
  `N_SYNC_ORDER`: a per-message read was not covered by the conversation horizon.
  An attempted expansion had synced the example's previously online parents.
  Restored their existing online residency and the original principal-ordered
  reaction query, retaining the requested child sync declaration and its horizon.
  The reference explicitly states that those reaction pages use the server.

[guide-final.log](guide-final.log) passes **110/110**. After restoring the original
self-equality tip and exact current-partition qualification in prose,
[guide-preservation-final.log](guide-preservation-final.log) also passes **110/110**.
Every affected command in [commands.json](commands.json) exits 0; four aggregate
cases remain pre-existing ignores. No assertion or budget was relaxed.

**Baseline:** `node scripts/generate-diagnostics-registry.mjs --check` exits 1.
[root-registry.log](root-registry.log) reports exactly three stale projections:
`guide/reference/diagnostics-registry.json`, `guide/reference/diagnostics.md`,
and `packages/snapback-client/diagnostic-codes.d.mts`. These are the same unchanged
Snapback 1 authorities reported in round 0. No GQ path belongs to the root
registry's source set. The Snapback 4 registry checks pass in the whole guide.
There were no environmental test failures this round.

No full-suite run this round, per instruction. The failed full-suite record from
round 0 remains a failed record; see the parent report's FAILURES.md.
