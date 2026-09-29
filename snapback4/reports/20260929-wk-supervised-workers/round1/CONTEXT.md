# WK round 1 context

Scope: host worker supervision, source snapshotting and the opt-in Node completion
ledger. Root rules route this work inside the Snapback 4 fence. The round 0 prompt
and report, Astra's full NOT READY review, and Grok's initially in-progress and then complete review were read.
The required first fetch/merge produced one append-only journal conflict; both
entries were preserved in merge `aab7acbbc` (with the required co-author trailer).
No runtime conflict resolution was needed.

Orientation used `skills/llp-orient/SKILL.md` after initializing the checkout's
missing `vendor/llp` submodule; no skill code was changed. Snapback 4's own
AGENTS.md, NOT-DOING.md, journal, root/bet and native-job rationale govern this
fence. The effects card is the current worker authoring surface.

Governing constraints and rationale:

- LLP 3000#4-fence-numbering-routing and #7-decisions-during-execution: independent candidate;
  host changes do not add device/wasm responsibilities.
- LLP 3000.009#5.2: completion commits before settlement; external I/O cannot be
  atomic with this ledger. Stable effect IDs, at-least-once delivery and the
  provider ambiguity remain. Actions/generated steps keep their own contracts.
- LLP 3000.009#5.3: declaration-by-source convention, explicitly constructed
  environments, independent service families, trusted Node application code,
  supervision and deployment snapshots. This is the living design updated here.
- LLP 3000.007#9.2: worker execution remains outside the data plane and uses the
  existing authenticated wire. No new action/effect semantics or authoring API.
- LLP 3000.019#3.6: worker supervision/revocation stays off HTTP admission; it
  may wait for the writer. Retirement failure must retain custody during waits.
- LLP 3000.005#2-where-it-sits: native jobs stay metered transaction chunks,
  distinct from workers performing external I/O.

Risks resolved by this round: failed retirement loses custody; path traversal
follows a linked root; fresh stores collide in a persistent ledger; process
cleanup depends on destructors and only targets one PID; initialization failures
spend delivery attempts. Tests reproduce these before the fixes.

Documentation changes are limited to LLP 3000.009 §5.2/§5.3, its Revised header,
the effects guide, operations manual, this report and the append-only journal. No new LLP, core
policy, approval flow, publication or push. Handoff: none.

Grok's final review also prompted explicit per-entry secret subsets, common
failure backoff, parallel shutdown initiation, storage-failure termination and
stronger contention witnesses. Its shared-file stall concern is addressed by
explicit documentation and a bounded provider example, preserving concurrent
same-key exclusion. See REVIEWS.md for every disposition.
