//! Physical reservations follow mutually exclusive statement paths.
use crate::{ir::{self, Expr, Merge, Stmt}, schema::Schema};

// @ref LLP 3000.036.002#151-evidence-and-decision — reserve before any
// private probe, but add sequential work and take the maximum of alternatives.
pub(super) fn price(schema: &Schema, body: &[Stmt]) -> Option<u64> {
    let paths = paths(schema, body)?;
    Some(maximum(paths.normal, paths.returned).unwrap_or(0))
}

struct Paths { normal: Option<u64>, returned: Option<u64> }
fn maximum(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, b) => b,
    }
}

fn sum<'a>(schema: &Schema, merges: impl IntoIterator<Item = &'a Merge>) -> Option<u64> {
    merges.into_iter().flat_map(|merge| &merge.lanes).filter(|lane| lane.bounded())
        .try_fold(0u64, |sum, lane| super::rules::bounded_walk_price(schema, lane).map(|price| sum.saturating_add(price)))
}

fn paths(schema: &Schema, body: &[Stmt]) -> Option<Paths> {
    let mut flow = Paths { normal: Some(0), returned: None };
    for statement in body {
        let Some(before) = flow.normal else { break };
        let next = match statement {
            Stmt::If { condition, then_body, else_body } => {
                let condition = sum(schema, ir::expression_merges(condition))?;
                let yes = paths(schema, then_body)?;
                let no = paths(schema, else_body)?;
                Paths {
                    normal: maximum(yes.normal, no.normal).map(|n| condition.saturating_add(n)),
                    returned: maximum(yes.returned, no.returned).map(|n| condition.saturating_add(n)),
                }
            }
            Stmt::Return(_) => Paths { normal: None, returned: Some(sum(schema, ir::body_merges(std::slice::from_ref(statement)))?) },
            Stmt::Require { condition: Expr::Literal(crate::Value::Bool(false)), .. } => Paths { normal: None, returned: Some(0) },
            // A loop can visit different arms on different iterations. Sum all
            // its occurrences, retaining the existing once-per-occurrence gate.
            // Expression blocks are likewise conservatively summed, including
            // their setup, nested loops and short-circuit alternatives.
            _ => Paths { normal: Some(sum(schema, ir::body_merges(std::slice::from_ref(statement)))?), returned: None },
        };
        flow.returned = maximum(flow.returned, next.returned.map(|n| before.saturating_add(n)));
        flow.normal = next.normal.map(|n| before.saturating_add(n));
    }
    Some(flow)
}
