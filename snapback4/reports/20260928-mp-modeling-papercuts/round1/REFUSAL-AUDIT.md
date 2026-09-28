# Refusal-path audit — MP round 1

Audit: `rg -n 'RuntimeError::Rule|"E_RULE"|"NOT_FOUND"|no_write_target'`
over `crates/snapback4-core/src`, following each helper's callers. The
collector records already evaluated refusals; it never runs a second rule.

| Path | Developer cause after this round |
| --- | --- |
| `through::capture_insert`, bad reference | `read through parent reference`, at the child's declaration. Normally caught earlier by input validation; raw interpreter path also records. |
| `through::capture_insert`, missing or expired parent | `read through parent missing or expired`, at the child's declaration. Missing and expired deliberately share a clause. |
| `through::capture_insert`, false captured read rule | `read through parent read rule`, at the child's declaration. No extra parent lookup/evaluation. |
| `write::insert_attempt`, independent/dependent insert denial, including an upsert insert arm | Existing `check_rule` records `insert rule`; upsert's NOT_FOUND conversion preserves it. |
| `write::insert_attempt`, sequence read prerequisite | Existing `sequence read authority`, at the sequence column, including upsert. |
| `write::insert_attempt`, parent identity absent but physical children remain | New `parent identity has stored children`, table source fallback; physical occupancy was already evaluated. This is also the defensive raw-storage path for invalid orphan state. |
| `write::delete_attempt` / `write_target::delete_target`, referenced parent not readable | New `read rule` before NOT_FOUND; ordinary readable delete-rule denial remains recorded by `check_rule`. |
| `write_target::require_readable_condition` | New `read rule`, with the target table passed explicitly; a hidden condition still returns NOT_FOUND. |
| `field_authority::project_row`, no authorized final image | New `read rule`; caller NOT_FOUND is unchanged. |
| `field_authority::authorize_fields`, hidden ownership denial / `authorize_update_fields`, private transition input | New `field authority <column>`, mapped to that column's written-by declaration; hidden NOT_FOUND conversion preserves it. |
| `authorize_update_fields`, false ordinary update/transition rule | Existing `check_rule` records `update rule`, before either E_RULE or NOT_FOUND. |
| `write::replace_authorized`, ephemeral renewed insert admission | Existing `check_rule` records `insert rule`, though a readable caller's error has update effect. |
| `write::check_constraints`, hidden collision / cap occupant | Existing collision/cap read denial records the exact `unique ...` / `cap ...` clause. This round also records a readable collision hidden by an unreadable *target* as `unique ...` before NOT_FOUND. |
| Authorization physical allowance exhausted anywhere under `Runner::run` | Existing final error handling records `authorization allowance (<effect>)` with its target table. No guessed false-rule cause. |
| `actions::authorize` | **No row collector.** This is static action-seat admission, outside Runner, with no store probes or ambiguous row cause. Its existing E_RULE already identifies the one rejecting `actions.<name>` site. Compile-time action/schedule checks use the same function; no developer row evaluation is invented. |
| `authorized_scan.rs` test fixture's synthetic E_RULE | **No product path.** Unit-test closure used to check accounting. |

Paths that still intentionally record no *rule* cause:

- A plain absent/expired write target (`write_miss`, missing update/delete arm,
  legacy direct delete) returns NOT_FOUND without evaluating a denying rule.
- Missing required supplied fields, invalid projection/input, defensive changes
  to engine-recorded attribution, and hidden immutable-constraint violations
  can be converted to NOT_FOUND. These are validation/constraint failures,
  not evaluated false rules. They have no invented rule clause. Where a real
  rule/collision denied before a conversion, its recorded clause survives.
- Authored `require ... else E_RULE/NOT_FOUND` (including a null-read assertion)
  is the author's explicit program refusal and already carries its execution
  site. An empty read does not prove a particular hidden rule failed, so the
  collector does not guess. Ordinary filtered/empty reads are not refusals.
- Replayed mutation/action receipts do not evaluate rules. Historical causes
  are neither recreated nor claimed as belonging to a new evaluation.
- Production serve, device execution, static compilation, CLI import/seed and
  background system work do not opt in to the dev HTTP request collector.
  Their existing caller/operator boundaries are unchanged.

Tests compare trace-on/off serialized E_RULE or NOT_FOUND and every logical
meter field. The three capture tests keep both parents physically stored,
then pin a time between their deadlines; the expired test is not merely an
already-deleted/missing-row fixture. The extra hidden-write test exercises
parent deletion, conditional writes and field ownership. Five original
insert/sequence/unique/cap/allowance cases continue to pass.
