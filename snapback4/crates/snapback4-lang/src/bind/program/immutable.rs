//! Equality proofs silence notes; only proven changes refuse immutable patches.
use super::*;
use std::collections::BTreeSet;

impl Binder<'_> {
    // @ref LLP 3000.036.002#10 — uncertainty is a note, never an upgrade refusal.
    pub(super) fn immutable_patch(&mut self, info: &TableInfo, key: &WriteKey, patch: &Expr,
        fields: &[ObjectField], site: &Site, prior: &[Stmt], upsert: bool, conditional: bool) -> Fallible<()> {
        let Expr::Object(patch) = patch else { return Ok(()) };
        let index = info.indexes.iter().find(|index| index.name == key.index).expect("selected write key");
        let stable = self.scopes.iter().flat_map(|scope|scope.values()).filter(|binding|binding.parameter).map(|binding|binding.runtime.clone()).collect::<BTreeSet<_>>();
        let components = key.key.iter().map(|value| resolve(value, prior, 32, &stable)).collect::<Vec<_>>();
        let target = components.iter().cloned().collect::<Option<Vec<_>>>();
        let stored = inserted_target(info, index, target.as_deref(), prior, &stable);
        let always_hidden = self.caller_kind != ProgramKind::Job && self.schema.table(&info.decl.name)
            .is_some_and(|table| matches!(table.rules.read, snapback4_core::schema::RuleExpr::Deny));
        for (column, supplied) in patch {
            if !info.decl.immutable.iter().any(|(fields, _)| fields.contains(column)) { continue; }
            let value = resolve(supplied, prior, 32, &stable);
            let pinned = index.columns.iter().position(|field| field == column)
                .and_then(|at| components.get(at)?.as_ref());
            let snapshot = if let (Some(Expr::Field { base, name }), Some(target)) = (&value, &target) {
                name == column && match base.as_ref() {
                    Expr::Get(read) => read.table == info.decl.name && (
                        read.index == key.index && &read.key == target
                        || key.index == "byId" && *target == vec![ir::field((**base).clone(), "id")]),
                    _ => false,
                }
            } else { false };
            let known = pinned.or_else(|| stored.as_ref()?.get(column));
            if snapshot || known.zip(value.as_ref()).is_some_and(|(old, new)| old == new || constant(old).zip(constant(new)).is_some_and(|(old,new)|old==new)) { continue; }
            let field_site = fields.iter().find(|field| &field.name == column).map_or(site, |field| &field.site);
            let rewrite = format!("omit {column} from the patch; set it on insert instead. For create-or-edit, branch on a readable point, insert all initial fields when absent, and update only mutable fields when present");
            let differing = known.zip(value.as_ref()).is_some_and(|(old, new)| different(old, new));
            let clock = info.columns.get(column).is_some_and(|ty| matches!(ty.kind, ast::TypeKind::Time))
                && value.as_ref().is_some_and(clock_value) && !self.may_have_written
                && self.loops + self.caller_loops == 0 && self.depth == 0 && self.scopes.len() == 1 && !conditional
                && scalar_prefix(prior, &stable)
                && !prior.iter().any(|statement| ir::effects::Effects::writes_in(std::slice::from_ref(statement)));
            let fresh = matches!(supplied, Expr::Input(Input::NewId)) || value.as_ref().is_some_and(|value| fresh_capture(value, prior));
            if !always_hidden && (differing || clock || fresh) {
                let reason = if differing { "the supplied value provably differs from the target key or the row inserted earlier in this transaction" }
                    else if fresh { "a freshly minted id cannot equal an existing stored value" }
                    else { "a fresh clock value changes the original timestamp on a later conflict" };
                return Err(Diagnostic::new(field_site, "E_QUARRY_IMMUTABLE",
                    format!("{}.{} is immutable; {reason}", info.decl.name, column), rewrite).guide("writes"));
            }
            let viewer = if matches!(value, Some(Expr::Input(Input::Viewer))) {
                format!(" (viewer must be the original {column})")
            } else { String::new() };
            let arm = if upsert { "on conflict, this upsert" } else { "this update" };
            self.notes.push(Diagnostic::new(field_site, "N_IMMUTABLE_PATCH",
                format!("{arm} is refused at runtime on a readable target unless {}.{column} equals the stored value{viewer}; omit {column} from the patch if another value may update this row", info.decl.name), rewrite).guide("writes"));
        }
        Ok(())
    }
}

/// Only an unconditional successful insert of this exact identity establishes
/// local storage. Other writes/control flow end this proof. Source writers in
/// other calls cannot constrain historical, seeded, or adopted storage.
fn inserted_target(info: &TableInfo, index: &ast::IndexDecl, target: Option<&[Expr]>, prior: &[Stmt], stable: &BTreeSet<String>) -> Option<BTreeMap<String, Expr>> {
    let target = target?;
    for (at, statement) in prior.iter().enumerate().rev() {
        if matches!(statement, Stmt::If { .. } | Stmt::For { .. }) { return None; }
        if !ir::effects::Effects::writes_in(std::slice::from_ref(statement)) { continue; }
        let Stmt::Insert { table, row } = statement else { return None };
        if table != &info.decl.name { return None; }
        let (row, captured) = object(row, &prior[..at], 32)?;
        let identity = index.columns.iter().map(|column| scalar(row.get(column)?, captured, 32, stable)).collect::<Option<Vec<_>>>()?;
        if identity != target { return None; }
        // An opaque mutable sibling cannot erase a known immutable value.
        return Some(row.iter().filter_map(|(column,value)| Some((column.clone(),scalar(value,captured,32,stable)?))).collect());
    }
    None
}

/// Adding/subtracting zero cannot turn a proved equal timestamp into a
/// fresh clock patch, or erase an exact snapshot's value identity.
fn binary(op: ir::BinaryOp, left: Expr, right: Expr) -> Expr {
    if matches!(op, ir::BinaryOp::Add | ir::BinaryOp::Sub) && constant(&right) == Some(Value::Int(0)) { return left; }
    if op == ir::BinaryOp::Add && constant(&left) == Some(Value::Int(0)) { return right; }
    Expr::Binary { op, left: Box::new(left), right: Box::new(right) }
}

/// A guard or storage-dependent/opaque setup may already constrain the clock
/// to the stored timestamp. Only scalar straight-line setup proves freshness.
fn scalar_prefix(prior: &[Stmt], stable: &BTreeSet<String>) -> bool {
    prior.iter().enumerate().all(|(at, statement)| match statement {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } => scalar(value, &prior[..at], 32, stable).is_some(),
        _ => false,
    })
}

fn clock_value(value: &Expr) -> bool {
    match value {
        Expr::Input(Input::Now | Input::ReadTime) => true,
        Expr::Binary { op: ir::BinaryOp::Add, left, right } => clock_value(left) && constant(right).is_some() || constant(left).is_some() && clock_value(right),
        Expr::Binary { op: ir::BinaryOp::Sub, left, right } => clock_value(left) && constant(right).is_some(),
        _ => false,
    }
}

fn fresh_capture(value: &Expr, prior: &[Stmt]) -> bool {
    let Expr::Variable(name) = value else { return false };
    let Some(at) = name.strip_prefix("$immutableCapture:").and_then(|name|name.rsplit(':').next()).and_then(|at|at.parse::<usize>().ok()) else { return false };
    // A prior write may already have stored this capture.
    !prior[at..].iter().any(|statement| ir::effects::Effects::writes_in(std::slice::from_ref(statement))
        || matches!(statement, Stmt::If { .. } | Stmt::For { .. }))
}

fn different(old: &Expr, new: &Expr) -> bool {
    if let (Some(old), Some(new)) = (constant(old), constant(new)) { return old != new; }
    matches!((old,new), (Expr::Variable(a),Expr::Variable(b)) if a.starts_with("$immutableCapture:") && b.starts_with("$immutableCapture:") && a != b)
}

fn constant(value: &Expr) -> Option<Value> {
    Some(match value {
        Expr::Literal(value) => value.clone(),
        Expr::Unary { op: ir::UnaryOp::Neg, value } => { let Value::Int(n) = constant(value)? else { return None }; Value::Int(n.checked_neg()?) },
        Expr::Binary { op, left, right } => {
            let (Value::Int(a),Value::Int(b)) = (constant(left)?,constant(right)?) else { return None };
            Value::Int(match op { ir::BinaryOp::Add => a.checked_add(b)?, ir::BinaryOp::Sub => a.checked_sub(b)?, ir::BinaryOp::Mul => a.checked_mul(b)?, _ => return None })
        }
        _ => return None,
    })
}

/// Select a lexical object's field before interpreting its siblings.
fn object<'a>(expr: &'a Expr, prior: &'a [Stmt], fuel: usize) -> Option<(&'a BTreeMap<String,Expr>, &'a [Stmt])> {
    if fuel == 0 { return None; }
    match expr {
        Expr::Object(fields) => Some((fields, prior)),
        Expr::Variable(name) => {
            for (at, statement) in prior.iter().enumerate().rev() {
                if let Stmt::Let { name: slot, value } | Stmt::Const { name: slot, value } | Stmt::Assign { name: slot, value } = statement
                    && slot == name { return object(value, &prior[..at], fuel-1); }
                if matches!(statement, Stmt::If { .. } | Stmt::For { .. }) { return None; }
            }
            None
        }
        _ => None,
    }
}

/// Scalar lexical captures survive writes; stored-row snapshots do not.
/// This resolver cannot read storage or execute arbitrary expressions.
fn scalar(expr: &Expr, prior: &[Stmt], fuel: usize, stable: &BTreeSet<String>) -> Option<Expr> {
    if fuel == 0 { return None; }
    Some(match expr {
        Expr::Variable(name) => {
            if stable.contains(name) { return Some(expr.clone()); }
            for (at, statement) in prior.iter().enumerate().rev() {
                if let Stmt::Let { name: slot, value } | Stmt::Const { name: slot, value } | Stmt::Assign { name: slot, value } = statement
                    && slot == name {
                    if matches!(value, Expr::Input(Input::NewId)) { return Some(Expr::Variable(format!("$immutableCapture:{name}:{at}"))); }
                    return scalar(value, &prior[..at], fuel - 1, stable);
                }
                if matches!(statement, Stmt::If { .. } | Stmt::For { .. }) { return None; }
            }
            expr.clone()
        }
        Expr::Field { base, name } => {
            let (fields, captured) = object(base, prior, fuel-1)?;
            scalar(fields.get(name)?, captured, fuel-1, stable)?
        }
        Expr::Binary { op, left, right } => binary(*op, scalar(left,prior,fuel-1,stable)?, scalar(right,prior,fuel-1,stable)?),
        Expr::Unary { op, value } => Expr::Unary { op: *op, value: Box::new(scalar(value,prior,fuel-1,stable)?) },
        Expr::Array(values) => Expr::Array(values.iter().map(|value|scalar(value,prior,fuel-1,stable)).collect::<Option<_>>()?),
        Expr::Object(fields) => Expr::Object(fields.iter().map(|(name,value)|Some((name.clone(),scalar(value,prior,fuel-1,stable)?))).collect::<Option<_>>()?),
        Expr::Literal(_) | Expr::Input(Input::Viewer | Input::Now | Input::ReadTime) => expr.clone(),
        _ => return None,
    })
}

/// Follow current lexical values, preserving capture-time operands. A stored
/// snapshot cannot prove a current value across writes or uncertain control flow.
fn resolve(expr: &Expr, prior: &[Stmt], fuel: usize, stable: &BTreeSet<String>) -> Option<Expr> {
    if let Some(value) = scalar(expr, prior, fuel, stable) { return Some(value); }
    if fuel == 0 { return None; }
    Some(match expr {
        Expr::Variable(name) => {
            if stable.contains(name) { return Some(expr.clone()); }
            for (at, statement) in prior.iter().enumerate().rev() {
                if let Stmt::Let { name: slot, value } | Stmt::Const { name: slot, value } | Stmt::Assign { name: slot, value } = statement
                    && slot == name { return resolve(value, &prior[..at], fuel - 1, stable); }
                if ir::effects::Effects::writes_in(std::slice::from_ref(statement)) { return None; }
                if matches!(statement, Stmt::If { .. } | Stmt::For { .. }) { return None; }
            }
            expr.clone()
        }
        Expr::Field { base, name } => ir::field(resolve(base, prior, fuel - 1, stable)?, name),
        Expr::Get(read) => {
            let mut read = read.clone();
            read.key = read.key.iter().map(|value| resolve(value, prior, fuel - 1, stable)).collect::<Option<_>>()?;
            read.site.clear();
            Expr::Get(read)
        }
        Expr::Binary { op, left, right } => binary(*op, resolve(left, prior, fuel - 1, stable)?, resolve(right, prior, fuel - 1, stable)?),
        Expr::Unary { op, value } => Expr::Unary { op: *op, value: Box::new(resolve(value, prior, fuel - 1, stable)?) },
        Expr::Array(values) => Expr::Array(values.iter().map(|value|resolve(value,prior,fuel-1,stable)).collect::<Option<_>>()?),
        Expr::Object(fields) => Expr::Object(fields.iter().map(|(name,value)|Some((name.clone(),resolve(value,prior,fuel-1,stable)?))).collect::<Option<_>>()?),
        _ => return None,
    })
}
