//! Conservative control outcomes, composed in execution order.
use super::{Expr, Stmt, Value};

const FALLS_THROUGH: u8 = 1;
const BREAKS: u8 = 2;
const CONTINUES: u8 = 4;
// A refusal, like a return, cannot reach any later use of a local.
const RETURNS: u8 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Outcomes(u8);

impl Outcomes {
    // @ref LLP 3000.007#5.1 — loop transfers carry local types; later statements cannot erase those paths.
    pub(super) fn block(statements: &[Stmt]) -> Self {
        let mut outcomes = FALLS_THROUGH;
        for statement in statements {
            if outcomes & FALLS_THROUGH == 0 { break; }
            // Only paths still falling through execute the next statement.
            outcomes = (outcomes & !FALLS_THROUGH) | Self::statement(statement);
        }
        Self(outcomes)
    }

    fn statement(statement: &Stmt) -> u8 {
        match statement {
            Stmt::Return(_) => RETURNS,
            Stmt::Break => BREAKS,
            Stmt::Continue => CONTINUES,
            Stmt::Require { condition: Expr::Literal(Value::Bool(false)), .. } => RETURNS,
            Stmt::Require { .. } => FALLS_THROUGH | RETURNS,
            Stmt::If { then_body, else_body, .. } => Self::block(then_body).0 | Self::block(else_body).0,
            // The loop may be empty or finish. Its own break/continue paths
            // do not transfer out of the enclosing loop; returns still do.
            Stmt::For { body, .. } => FALLS_THROUGH | (Self::block(body).0 & RETURNS),
            Stmt::Const { .. } | Stmt::Let { .. } | Stmt::Assign { .. }
            | Stmt::Push { .. } | Stmt::Check { .. } | Stmt::InsertIfAbsent { .. }
            | Stmt::Insert { .. } | Stmt::Update { .. } | Stmt::Upsert { .. }
            | Stmt::WriteTarget { .. } | Stmt::DeleteTarget { .. } | Stmt::Delete { .. } | Stmt::Emit { .. } => FALLS_THROUGH,
        }
    }

    pub(super) fn exits(self) -> bool { self.0 & FALLS_THROUGH == 0 }
    pub(super) fn falls_through(self) -> bool { self.0 & FALLS_THROUGH != 0 }
    pub(super) fn terminates(self) -> bool { self.0 == RETURNS }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bind::program::LoopDomain;

    fn returned() -> Stmt { Stmt::Return(Expr::Literal(Value::Int(0))) }
    fn refused() -> Stmt {
        Stmt::Require { condition: Expr::Literal(Value::Bool(false)), code: "STOP".into(), site: None, message: None }
    }
    fn maybe(body: Vec<Stmt>) -> Stmt {
        Stmt::If { condition: Expr::Variable("stop".into()), then_body: body, else_body: vec![] }
    }
    fn looped(body: Vec<Stmt>) -> Stmt {
        Stmt::For { binding: "n".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 2 }, body }
    }

    #[test]
    fn transfers_and_termination_keep_their_statement_order() {
        for (transfer, bit) in [(Stmt::Break, BREAKS), (Stmt::Continue, CONTINUES)] {
            for end in [returned(), refused()] {
                assert_eq!(Outcomes::block(&[transfer.clone(), end.clone()]), Outcomes(bit));
                assert_eq!(Outcomes::block(&[end.clone(), transfer.clone()]), Outcomes(RETURNS));
                let mixed = Outcomes::block(&[maybe(vec![transfer.clone()]), end.clone()]);
                assert_eq!(mixed, Outcomes(bit | RETURNS));
                assert!(mixed.exits());
                assert!(!mixed.terminates());
                assert_eq!(Outcomes::block(&[maybe(vec![end]), transfer.clone()]), mixed);
            }
        }
    }

    #[test]
    fn only_falling_paths_reach_later_statements_and_loops_own_their_transfers() {
        assert_eq!(Outcomes::block(&[]), Outcomes(FALLS_THROUGH));
        assert_eq!(Outcomes::block(&[maybe(vec![returned()])]), Outcomes(FALLS_THROUGH | RETURNS));
        let both = Stmt::If { condition: Expr::Variable("ready".into()), then_body: vec![returned()], else_body: vec![refused()] };
        assert!(Outcomes::block(&[both, Stmt::Continue]).terminates());
        for body in [vec![], vec![Stmt::Break], vec![Stmt::Continue]] {
            assert_eq!(Outcomes::block(&[looped(body.clone())]), Outcomes(FALLS_THROUGH));
            assert!(Outcomes::block(&[looped(body), returned()]).terminates());
        }
        assert_eq!(Outcomes::block(&[looped(vec![returned()])]), Outcomes(FALLS_THROUGH | RETURNS));
        let nested = looped(vec![looped(vec![Stmt::Break]), Stmt::Continue]);
        assert_eq!(Outcomes::block(&[nested, Stmt::Break]), Outcomes(BREAKS));
    }
}
