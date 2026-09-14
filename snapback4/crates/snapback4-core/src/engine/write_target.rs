//! Engine-private write addressing, conditions and disclosure.
use super::runner::{Flow, Runner};
use crate::error::RuntimeError;
use crate::ir::{Expr, KeyProvenance, Read, Stmt, WriteCondition};
use crate::schema::{Effect, materialize_optional_fields};
use crate::value::Value;

impl Runner<'_> {
    pub(super) fn no_write_target(&self) -> RuntimeError {
        RuntimeError::Require { site: Some(self.statement_site.clone()), code: "NOT_FOUND".into() }
    }

    // @ref LLP 3000.007#8 — item 7: any unheld write target queues, including a no-horizon unique-key miss.
    pub(super) fn write_miss(&mut self, table: &str, index: &str, key: &[Value]) -> RuntimeError {
        if self.device {
            self.unknown_fact(table, index, key, &self.statement_site.clone());
            if let Some(message) = &mut self.missing_fact { *message = message.replace("the row or its absence is past the acquired horizon or online only", "the write target is not held on this device; only the server can resolve it"); }
            RuntimeError::Prediction(self.missing_fact.clone().expect("missing site recorded"))
        } else { self.no_write_target() }
    }

    pub(super) fn write_target(&mut self, target: &Read, patch: &Expr, upsert: bool, condition: Option<&WriteCondition>, valued: bool) -> Result<Value, RuntimeError> {
        self.refuse_engine_owned(&target.table)?;
        let key = target.key.iter().map(|e| self.expr(e)).collect::<Result<Vec<_>, _>>()?;
        let patch = self.expr(patch)?;
        let definition = self.schema.table(&target.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", target.table)))?.clone();
        let index = definition.index(&target.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", target.table, target.index)))?;
        if !index.unique || key.len() != index.columns().len() { return Err(RuntimeError::Input("a write target needs one complete unique key".into())); }
        if patch.as_object()?.contains_key("id") { return Err(RuntimeError::Input(format!("{} update patch cannot change id", target.table))); }
        self.read_tables.insert(target.table.clone());
        let old = self.live_lookup(&target.table, &target.index, index, &key)?;
        if self.device && (old.is_none() || definition.sync.is_none()) { return Err(self.write_miss(&target.table, &target.index, &key)); }
        let id = if let Some(mut old) = old {
            materialize_optional_fields(&mut old, &definition);
            let readable = self.check_rule(&target.table, Effect::Read, None, &old)?;
            let id = old.field("id")?.clone();
            let mut fields = old.as_object()?.clone();
            fields.extend(patch.as_object()?.iter().map(|(k, v)| (k.clone(), v.clone())));
            let new = Value::Row(fields.into());
            self.meter.heap(new.heap_bytes())?;
            // The old image is used only in this isolated condition scope, after update authority.
            self.authorize_update(&target.table, &old, &new, readable)?;
            if let Some(condition) = condition {
                let passed = self.write_condition(condition, &old);
                match passed {
                    Ok(true) => {}
                    Ok(false) if readable => return Err(RuntimeError::Conflict { current: Read { key: vec![Expr::Literal(id)], index: "byId".into(), ..target.clone() } }),
                    Ok(false) => return Err(self.no_write_target()),
                    Err(error) if !readable && error.is_refusal() && !matches!(error, RuntimeError::Bound { .. } | RuntimeError::Prediction(_)) => return Err(self.no_write_target()),
                    Err(error) => return Err(error),
                }
            }
            self.replace_authorized(&target.table, old, new, readable)?;
            id
        } else {
            if !upsert { return Err(self.no_write_target()); }
            let id = if target.index == "byId" { key[0].clone() } else { Value::Id(self.context.mint()?) };
            let mut fields = patch.as_object()?.clone();
            for (column, value) in index.columns().iter().zip(&key) { fields.entry(column.clone()).or_insert_with(|| value.clone()); }
            fields.insert("id".into(), id.clone());
            let row = Value::Row(fields.into());
            self.meter.heap(row.heap_bytes())?;
            self.insert_upsert(&target.table, row)?;
            id
        };
        // Only an ordinary read of the final row can enter the author's program.
        if !valued { return Ok(Value::Null); }
        self.get(&Read { site: target.site.clone(), table: target.table.clone(), index: "byId".into(), key: vec![Expr::Literal(id)], provenance: KeyProvenance::Computed })
    }

    fn write_condition(&mut self, condition: &WriteCondition, old: &Value) -> Result<bool, RuntimeError> {
        // Helpers may bind locals while evaluating a predicate. Neither those locals nor old
        // survive the condition. Reject writes even in hand-authored IR before entering it.
        fn pure(stmts: &[Stmt]) -> bool {
            stmts.iter().all(|s| match s {
                Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } | Stmt::Emit { .. } => false,
                Stmt::If { condition, then_body, else_body } => pure_expr(condition) && pure(then_body) && pure(else_body),
                Stmt::For { body, domain, .. } => pure(body) && match domain {
                    crate::ir::LoopDomain::DerivedArray { value, .. } => pure_expr(value),
                    crate::ir::LoopDomain::Page(scan) => pure_scan(scan),
                    crate::ir::LoopDomain::Recurse(recurse) => pure_expr(&recurse.seed),
                    _ => true,
                },
                Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => pure_expr(value),
                Stmt::Require { condition, .. } | Stmt::Check { condition, .. } => pure_expr(condition),
                _ => true,
            })
        }
        fn pure_scan(scan: &crate::ir::Scan) -> bool {
            scan.prefix.iter().all(|key| match key { crate::ir::IndexKeyExpr::Scalar(expr) | crate::ir::IndexKeyExpr::WordPrefix(expr) => pure_expr(expr) })
                && [&scan.after, &scan.before].into_iter().flatten().all(|expr| pure_expr(expr))
                && scan.range.as_ref().is_none_or(|range| [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten().all(|expr| pure_expr(expr)))
        }
        fn pure_expr(expr: &Expr) -> bool {
            match expr {
                Expr::Merge(merge) => merge.lanes.iter().all(|lane| pure(&lane.setup) && pure_scan(&lane.scan) && lane.source.as_ref().is_none_or(pure_scan)),
                Expr::Scan(scan) => pure_scan(scan),
                Expr::Array(items) | Expr::Builtin { args: items, .. } => items.iter().all(pure_expr),
                Expr::Object(fields) => fields.values().all(pure_expr),
                Expr::Field { base, .. } | Expr::Unary { value: base, .. } => pure_expr(base),
                Expr::Binary { left, right, .. } => pure_expr(left) && pure_expr(right),
                Expr::Get(read) | Expr::Exists(read) => read.key.iter().all(pure_expr),
                _ => true,
            }
        }
        if !pure(&condition.setup) || !pure_expr(&condition.value) { return Err(RuntimeError::Input("an update condition cannot write".into())); }
        self.meter.heap(self.env.values().map(Value::heap_bytes).sum::<u64>() + old.heap_bytes())?;
        let env = self.env.clone();
        let consts = self.consts.clone();
        let site = self.statement_site.clone();
        self.env.insert(condition.old.clone(), old.clone());
        let result = (|| {
            if !matches!(self.statements(&condition.setup, &site)?, Flow::Next) { return Err(RuntimeError::Input("an update condition must produce one boolean".into())); }
            Ok(self.expr(&condition.value)?.as_bool()?)
        })();
        self.env = env;
        self.consts = consts;
        self.statement_site = site;
        result
    }
}
