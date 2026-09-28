# Round 6 context pack

Scope: SDK ordinary-search continuation, page accumulation, real-host oracle,
search guide, and the OS/EQ merge.

Governing LLPs: 3000 (fence and one Rust interpreter); 3000.028 §3.3 and §7.2
(current: composition, consumed work, one invocation, shared allowance and
acceptance); 3000.024 Decision (compact opening/drain and no durable session);
3000.007.000 §1/§3 (full order key and safe drain continuation); 3000.019 §3.3
and 3000.023 §5 (pending-page and deadline behavior). The scoped 3000-series
working links are in current/, not foundation/.

Active constraints and rationale: LLP 3000.028 §3.3 forbids hidden keys,
unbounded traversal state, extra server calls or a fresh coordinator allowance.
The round-6 supervisor explicitly decides live combined-domain keyset semantics;
mutable order/match rows may repeat or be skipped. Stable rows remain exactly
once. LLP 3000.007.000 §3 makes source cuts authoritative. LLP 3000.023 §5
keeps publication/deadline withdrawal intact during page aggregation.

Risks: separate lane positions can admit new heads before the combined key;
metadata-only page revalidation must not overwrite newer row images; adopting a
new identity discards old retained images in the oracle as on the device.
Document updates: 3000.028 §3.3 decision/notes, compiled search card, closed
traversal issue, acceptance report and append-only journal. Hand-off: none.

Applied llp-orient read-only from
/home/ccheever/sb4-intent/lane-a5/vendor/llp/skills/llp-orient/SKILL.md because the
local symlink's submodule is unpopulated. No skill/tool installation or other
worktree modification. Merge b44e5b66b retains both lane histories and EQ's
check_descriptor with OS's inferred-index translation.
