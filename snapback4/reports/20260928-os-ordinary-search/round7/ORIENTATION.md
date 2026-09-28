# Round 7 context pack

Scope: core point overlap and search descriptor; HTTP refusals; SDK coordinator,
source-row page metadata and Pages; real-host oracle and compiled search guide.

Governing LLPs: LLP 3000 §1/§7 (one Rust interpreter and fence),
LLP 3000.028 §3.3/§7.2 (current working set: one invocation, two source domains,
combined keyset, disclosure and acceptance), LLP 3000.024 Decision (compact
opening and drain under existing meters), LLP 3000.015 §1 (authorized point
boundary), LLP 3000.019 §3.3 and LLP 3000.023 §5 (page retention and expiry).

Active constraints/rationale: LLP 3000.028 §3.3 prohibits a meter reset, hidden
keys, unbounded seen-ID cursors, automatic refill or a durable search session.
Its round-7 commission authorizes point overlap inside the existing request;
immutable updates do not prove lifetime ownership. LLP 3000.015 §1 requires
point authorization before observable row/field pricing. LLP 3000.023 §5 keeps
expiry and publication checks intact during accumulation. Query metadata must
prove source identity before a projected field can become a deduplication key.

Risks: suppressed prefixes can consume work without emitting rows; a current
image can stop matching or move outside this page; a permanent early refusal
must not become an identity refresh; model expectations must not inspect output.
Likely doc updates: LLP 3000.028 §3.3, search/why guide, package Read/usePage
notes, acceptance report and append-only journal. Hand-off: none.

Applied llp-orient read-only from
/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md after finding
the local symlink unpopulated. No install and no changes outside this worktree.
Merge d023a8fd6 keeps both parents' journal blocks and all auto-merged source.
