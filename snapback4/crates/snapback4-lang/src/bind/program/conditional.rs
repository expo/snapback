//! Conditional values keep lazy execution; incompatible row arms are refused.
// @ref LLP 3000.013#7 — authoring sugar lowers to the existing ruled, metered IR.
use super::*;

impl Binder<'_> {
    pub(super) fn conditional(&mut self, then: &A, condition: &A, otherwise: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let (cond, cond_ty) = self.expr(condition, out)?;
        if !cond_ty.is_bool() {
            return Err(type_error(condition.site(), format!("a conditional value needs a bool condition, got {}", cond_ty.name()), control::bool_condition_rewrite(&cond_ty, "x if ttl {} else y")));
        }
        // Each arm binds under its narrowing and runs only when taken.
        let temp = self.temp("if");
        let mut then_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, true);
        let then_bound = self.expr(then, &mut then_out);
        self.pop_scope();
        let (then_expr, then_ty) = then_bound?;
        let mut else_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, false);
        let else_bound = self.expr(otherwise, &mut else_out);
        self.pop_scope();
        let (else_expr, else_ty) = else_bound?;
        let ty = then_ty.join(&else_ty).map_err(|error| self.join_error(error, &then_ty, &else_ty, then, otherwise, Some(condition)))?;
        then_out.push(Stmt::Assign { name: temp.clone(), value: then_expr });
        else_out.push(Stmt::Assign { name: temp.clone(), value: else_expr });
        out.push(Stmt::Let { name: temp.clone(), value: Expr::Literal(Value::Null) });
        out.push_if(cond, then_out, else_out);
        Ok((ir::var(&temp), ty))
    }
}
