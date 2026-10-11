//! `exists applications[status = 'submitted', totalPoints > p]`: an ordered
//! test inside brackets parses as a seek, which only a bounded page over an
//! index continuing with that column can take. When the probe does not bind,
//! the planner's key-type complaint ("(status, id) takes … wrong key type")
//! pointed away from the cause (wave 5 lanes 017 039). Say what brackets take
//! and print the search form.
// @ref LLP 3000.036#15.7 — a range in brackets names the clause and the search rewrite.
use crate::{ast::*, diag::Diagnostic, print};

pub(super) fn refusal(read: &ReadExpr, rule: bool, error: Diagnostic) -> Diagnostic {
    if read.seeks.is_empty() || read.range.is_some() || error.code == "E_QUARRY_SYNTAX" { return error; }
    let tests = read.seeks.iter().map(|seek| format!("{} {} {}", seek.column, seek.op, print::expression(&seek.value))).collect::<Vec<_>>();
    let message = format!("brackets take key equalities; `{}` is an ordered test, which brackets accept only as a seek on a bounded page over an index continuing with {} after the pinned keys",
        tests.join("`, `"), read.seeks[0].column);
    let named = read.keys.iter().all(|key| key.column.is_some());
    let mut conditions: Vec<String> = read.keys.iter().filter_map(|key| key.column.as_ref().map(|column| format!(".{column} = {}", print::expression(&key.value)))).collect();
    conditions.extend(read.seeks.iter().map(|seek| format!(".{} {} {}", seek.column, seek.op, print::expression(&seek.value))));
    let search = format!("exists {} where {}", read.table, conditions.join(" and "));
    let rewrite = if rule {
        format!("a rule probes one row by a unique key, so an ordered test cannot select it: check the order in the mutation (`require {search} else CODE`), or keep the compared value on this row")
    } else if named {
        format!("for a search, write `{search}`")
    } else {
        format!("name each key (`column = value`), then move the ordered test to where: `exists {} where .column = value and {}`", read.table, tests.iter().map(|test| format!(".{test}")).collect::<Vec<_>>().join(" and "))
    };
    Diagnostic::new(&error.site, "E_QUARRY_TYPE", message, rewrite).guide("reads")
}
