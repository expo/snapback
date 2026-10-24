# DX10 → SEC10: wave-27 gate semantic fixes (#9)

Open; integration-25 coordination. DX10 owns wording only in write_advice.rs
and verbs/security/presence.rs. SEC10 owns bind/security/**. Its current
ff50223231 plus uncommitted changes do not touch those two wording sites.

Three requested end-game semantics need SEC10 ownership and shared review:

- `photos: [image] <=4 write <- P`: insert with [] should be initialization,
  as null is, while nonempty creation and **all changed updates including
  nonempty→[]** must keep P. Runtime rule construction is
  snapback4-core/src/schema/column_writes.rs. Keep derived/enforced campaign
  predicates in bind/security/derived.rs consistent; check explicit defaults,
  upsert, insert-if-absent and device/server parity. Current runtime counts []
  as a write. LLP 3000.036.004.000 §2 explicitly says non-null, so this needs
  its amendment, not just a diagnostic string.
- Presence gate currently persists only ColumnType::is_optional(). Track list
  minimums as well: [image] 1..4 → <=4 (and 2..4 → 1..4) must ask the presence
  question against both successful local baseline and selected production
  predecessor. Preserve compatibility with existing bool-valued baseline files.
  Same/increased minimums and maximum-only edits should not trigger it. The
  authored answer must discuss cardinality, not `.photos = null`.
- bind/rule_helpers.rs::expand expands column.read but omits column.write and
  immutable_when. Run the same bounded hygienic expander on write predicates;
  preserve cycle, depth/node bound, wrong-arity/type and helper-effects refusals.
  Helpers must remain identical to inlining, including both update images.

Concrete wave-27 sources: 047 photos minimum/empty creation, 038 helper
rejection (also 004). DX10 changes the create/edit rewrite to lead with the
existing deliberate `invariant T.c update only P` answer and adds a regression.
No semantic fix is claimed by that wording change. Integration must not claim
all of #9 complete until SEC10 lands these fixes and tests. Mac skipped.

Executable reproduction: `node snapback4/reports/20261024-dx10/security-repro.mjs`.
Recorded in the adjacent security-repro.json: pure column-write helper refuses
E_QUARRY_RULE_OPERATOR; 1..4→<=4 passes without N_PRESENCE_LOOSENING; outsider
empty-list creation fails E_RULE. These are reproduced gaps, not passing fixes.
