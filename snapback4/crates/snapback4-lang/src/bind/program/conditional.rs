//! Keep each conditional arm's wildcard rule until its projection is bound.
// @ref LLP 3000.013#7 — authoring sugar lowers to the existing ruled, metered IR.
use super::*;

impl Binder<'_> {
    pub(super) fn conditional(&mut self, then: &A, condition: &A, otherwise: &A, shape: Option<(&[ShapeField], &Site)>, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
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
        let (mut then_expr, mut then_ty) = then_bound?;
        let mut else_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, false);
        let else_bound = self.expr(otherwise, &mut else_out);
        self.pop_scope();
        let (mut else_expr, mut else_ty) = else_bound?;
        let mixed = shape.is_some() && matches!(then_ty.join(&else_ty).required(), Ty::RowMixed(_));
        if let Some((fields, site)) = shape.filter(|_| mixed) {
            // The arm types are still separate here. A mixed local has lost
            // that choice and is refused by shape_object instead. Nullable
            // arms retain the ordinary null-preserving shape behavior.
            for (value, ty, arm_out, truth) in [
                (&mut then_expr, &mut then_ty, &mut then_out, true),
                (&mut else_expr, &mut else_ty, &mut else_out, false),
            ] {
                if *ty == Ty::Null { continue; }
                self.push_scope();
                self.narrow(condition, truth);
                let shaped = self.shape_bound(value.clone(), ty.clone(), fields, site, arm_out);
                self.pop_scope();
                (*value, *ty) = shaped?;
            }
        }
        then_out.push(Stmt::Assign { name: temp.clone(), value: then_expr });
        else_out.push(Stmt::Assign { name: temp.clone(), value: else_expr });
        out.push(Stmt::Let { name: temp.clone(), value: Expr::Literal(Value::Null) });
        out.push_if(cond, then_out, else_out);
        let ty = if then_ty == Ty::Null { else_ty.optional() }
            else if else_ty == Ty::Null { then_ty.optional() }
            else { then_ty.join(&else_ty) };
        match shape.filter(|_| !mixed) {
            Some((fields, site)) => self.shape_bound(ir::var(&temp), ty, fields, site, out),
            None => Ok((ir::var(&temp), ty)),
        }
    }
}
