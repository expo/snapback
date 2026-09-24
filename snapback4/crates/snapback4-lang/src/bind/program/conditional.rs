//! Conditional values keep lazy execution; incompatible row arms are refused.
// @ref LLP 3000.013#7 — authoring sugar lowers to the existing ruled, metered IR.
use super::*;

impl Binder<'_> {
    pub(super) fn conditional(&mut self, then: &A, condition: &A, otherwise: &A, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        let variant = super::super::intent_variants::condition(condition)
            .map(|(kind, input)| format!("{kind}:{}", print::expression(input)));
        let mut variant_body = setup::Body::default();
        let output = if variant.is_some() { &mut variant_body } else { &mut *out };
        let (cond, cond_ty) = self.expr(condition, output)?;
        if !cond_ty.is_bool() {
            return Err(type_error(condition.site(), format!("a conditional value needs a bool condition, got {}", cond_ty.name()), control::bool_condition_rewrite(&cond_ty, "x if ttl {} else y")));
        }
        // Each arm binds under its narrowing and runs only when taken.
        let temp = self.temp("if");
        if let Some(name) = &variant { self.variants.push((name.clone(), true)); }
        let variant_start = self.sites;
        let mut then_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, true);
        let then_bound = self.expr(then, &mut then_out);
        self.pop_scope();
        let (then_expr, then_ty) = then_bound?;
        let then_sites = self.sites;
        if variant.is_some() { self.variants.last_mut().unwrap().1 = false; self.sites = variant_start; }
        let mut else_out = setup::Body::default();
        self.push_scope();
        self.narrow(condition, false);
        let else_bound = self.expr(otherwise, &mut else_out);
        self.pop_scope();
        let (else_expr, else_ty) = else_bound?;
        if variant.is_some() { self.variants.pop(); self.sites = self.sites.max(then_sites); }
        let ty = then_ty.join(&else_ty).map_err(|error| self.join_error(error, &then_ty, &else_ty, then, otherwise, Some(condition)))?;
        then_out.push(Stmt::Assign { name: temp.clone(), value: then_expr });
        else_out.push(Stmt::Assign { name: temp.clone(), value: else_expr });
        output.push(Stmt::Let { name: temp.clone(), value: Expr::Literal(Value::Null) });
        output.push_if(cond, then_out, else_out);
        let value = if variant.is_some() { Expr::Block { body: variant_body.code, value: Box::new(ir::var(&temp)) } } else { ir::var(&temp) };
        Ok((value, ty))
    }
}
