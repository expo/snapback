//! Total effect arms and the device's conservative charge for untaken arms.
use super::runner::Runner;
use crate::ir::{BinaryOp, Builtin, Expr, Input, Stmt, UnaryOp};
use crate::error::RuntimeError;
use std::collections::BTreeSet;

/// Typechecked, terminating work which cannot read, write, mint or refuse.
/// Presence-derived builtin arguments are additionally rejected by the binder.
pub fn total_expr(expr: &Expr) -> bool {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer | Input::Now | Input::ReadTime) => true,
        Expr::Input(Input::NewId) | Expr::Get(_) | Expr::Exists(_) | Expr::Scan(_) | Expr::Merge(_) => false,
        Expr::Field { base, .. } | Expr::Unary { op: UnaryOp::Not, value: base } => total_expr(base),
        Expr::Unary { op: UnaryOp::Neg, .. } => false,
        Expr::Array(values) => values.iter().all(total_expr),
        Expr::Object(fields) => fields.values().all(total_expr),
        Expr::Shape { base, fields } => total_expr(base) && fields.values().all(total_expr),
        Expr::Binary { op, left, right } => !matches!(op, BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul) && total_expr(left) && total_expr(right),
        Expr::Builtin { builtin, args } => matches!(builtin, Builtin::Connected | Builtin::Slice | Builtin::Len | Builtin::Count | Builtin::Min | Builtin::Max | Builtin::First | Builtin::Last | Builtin::At | Builtin::Lower | Builtin::Trim) && args.iter().all(total_expr),
        Expr::Block { body, value } => total_body(body) && total_expr(value),
    }
}

pub fn total_body(body: &[Stmt]) -> bool {
    total_with_skips(body, "", &BTreeSet::new())
}

fn assigned(body: &[Stmt], names: &mut BTreeSet<String>) {
    for stmt in body {
        match stmt {
            Stmt::Let { name, .. } | Stmt::Assign { name, .. } => { names.insert(name.clone()); }
            Stmt::If { then_body, else_body, .. } => { assigned(then_body, names); assigned(else_body, names); }
            _ => {}
        }
    }
}

fn total_with_skips(body: &[Stmt], prefix: &str, skips: &BTreeSet<String>) -> bool {
    body.iter().enumerate().all(|(index, stmt)| {
        let path = if skips.is_empty() { String::new() } else { format!("{prefix}:{}", index + 1) };
        skips.contains(&path) || match stmt {
            Stmt::Let { value, .. } | Stmt::Assign { value, .. } => total_expr(value),
            Stmt::Emit { payload, once, .. } => total_expr(payload) && once.as_ref().is_none_or(total_expr),
            Stmt::If { condition, then_body, else_body } => total_expr(condition)
                && total_with_skips(then_body, &format!("{path}:then"), skips)
                && total_with_skips(else_body, &format!("{path}:else"), skips),
            _ => false,
        }
    })
}

impl Runner<'_> {
    // @ref LLP 3000.007#19.1 — prediction pays safe untaken presence arms too; their effects and local assignments do not escape.
    pub(super) fn charge_untaken(&mut self, body: &[Stmt], prefix: &str) -> Result<(), RuntimeError> {
        if !total_with_skips(body, prefix, &self.prediction_skips) { return Err(RuntimeError::Prediction("presence controls an arm that is not total; queued without a predicted row".into())); }
        self.charged_untaken = true;
        let mut names = BTreeSet::new();
        assigned(body, &mut names);
        let mut saved = Vec::new();
        for name in names {
            self.meter.heap(64)?; // Saved dependency slot, including vector growth.
            let value = self.env.get(&name);
            if let Some(value) = value { self.meter.heap(value.clone_heap_bytes())?; }
            let deps = self.effect_presence.variables.get(&name);
            if let Some(deps) = deps { self.meter.heap(super::presence::bytes(deps) + name.len() as u64 + 64)?; }
            saved.push((name, value.cloned(), deps.cloned()));
        }
        let discard = std::mem::replace(&mut self.discard_effects, true);
        let reads = std::mem::take(&mut self.effect_presence.reads);
        let result = self.statements(body, prefix);
        self.effect_presence.reads = reads;
        self.discard_effects = discard;
        for (name, value, deps) in saved {
            match deps { Some(deps) => { self.effect_presence.variables.insert(name.clone(), deps); } None => { self.effect_presence.variables.remove(&name); } }
            match value { Some(value) => { self.env.insert(name, value); } None => { self.env.remove(&name); } }
        }
        match result {
            Ok(_) => Ok(()),
            Err(error @ RuntimeError::Bound { .. }) => Err(error),
            // A combined data/presence guard may have narrowed a nullable
            // input only on its taken arm. Do not turn that counterfactual
            // type failure into an application refusal or a predicted row.
            Err(_) => Err(RuntimeError::Prediction("an untaken presence arm needs the guard's value refinement; put the data guard outside the presence guard; queued without a predicted row".into())),
        }
    }
}
