# Snapback 4: a seeded row that fails validation refuses NOT_FOUND, not E_INPUT

Found 2026-10-12 by workstream LANG2 (LLP 3000.040) while testing bounded
ints in fixtures; the behaviour predates it and is the same for text bounds.

`Engine::seed` (fixtures, `/seed`) of a row whose value does not fit its
column (`title: text <=3` given `"long"`, or `stars: int 1..5` given 9)
returns `Require { code: "NOT_FOUND", site: Some(""), message: None }` on
public and private tables alike, where a write of the same value refuses
`E_INPUT: notes.title must be text <=3, not the text 'long'`. The row is not
stored, so nothing unsafe happens, but a developer loading fixtures sees
NOT_FOUND with no field name.

Repro (memory engine): compile `table notes:\n  title: text <=3\n  public\n`,
then `engine.seed([("notes", {id: "n", title: "long"})])`.
`snapback4-lang/tests/bounded_calendar_caps.rs::seeded_rows_meet_the_bound`
asserts only refusal and non-storage until this is fixed.

Expected: `E_INPUT` naming the field. Next step: find where the load path
turns the validation error into a missing-target refusal.
