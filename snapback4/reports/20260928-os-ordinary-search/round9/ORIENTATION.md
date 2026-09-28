# Round 9 context pack

Scope: SDK overlap validation/pricing and the independent process/wasm search oracle.

Governing LLPs: LLP 3000 §1/§7 (Snapback 4 fence), LLP 2000.000 §6
(runtime bounds), LLP 3000.028 §3.3/§7.2 (one call, shared device allowance,
combined live keyset and acceptance), LLP 3000.024 (compact opening/drain),
LLP 3000.019 §3.3 (delivery independence). These are in the current working set;
no new foundation or working-set document is needed.

Constraints and rationale: LLP 3000.028 §3.3 requires bounded point overlap,
current-ID authority, consumed-prefix continuation and no meter reset. Its
point-read disclosure argument is unchanged. LLP 3000.019 §3.3 keeps query
failure independent of healthy queued delivery. The search guide records the
current cut/refusal and live-keyset behavior; test expectations must model that
behavior without using returned rows as the expected position.

Risks: large valid overlap pages must fit linear bookkeeping; malformed proof
lengths must be rejected before subset work; an expired current replacement
has no point authority over retained history. A cut fixture alone does not
justify a refusal when the current server prefix fits.

Read-only llp-orient applied from the existing sibling copy at
/home/ccheever/sb4-intent/lane-ex/vendor/llp/skills/llp-orient/SKILL.md because
the local discovery symlink is unpopulated. Read binding rounds 0–8 prompts,
reports/OS journal entries, both round-7 reviews, fence/rules and scoped guide/LLP
context. No install or sibling edits. Fetch found origin/main ae265b730 already
an ancestor of this branch; no merge performed.

Likely docs: scoped LLP implementation note, report acceptance note and one
append-only journal entry. Hand-off: none.
