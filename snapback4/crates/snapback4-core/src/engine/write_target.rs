//! Engine-private write addressing, conditions and disclosure.
use super::runner::{Flow, Runner};
use super::rules::rule_probes;
use crate::error::{MeterKind, RuntimeError};
use crate::ir::{Builtin, Expr, IndexKeyExpr, Input, KeyProvenance, LoopDomain, Read, Scan, Stmt, WriteCondition};
use crate::schema::{ColumnType, Constraint, Effect, Table, materialize_optional_fields};
use crate::rows::index_values;
use crate::value::Value;

impl Runner<'_> {
    // @ref LLP 3000.007#17 — absent and hidden-refused targets restore every logical meter field.
    pub(super) fn target_attempt<T>(&mut self, attempt: impl FnOnce(&mut Self) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        let mark = self.meter.mark();
        let result = attempt(self);
        if matches!(&result, Err(RuntimeError::Require { code, .. }) if code == "NOT_FOUND") { self.meter.restore(mark); }
        result
    }

    // @ref LLP 3000.007#17 — reserve resolution's static worst case before the target lookup; no ceiling is changed.
    pub(super) fn reserve_target_resolution(&self, table: &Table, patch: &Value, upsert: bool) -> Result<(), RuntimeError> {
        let probes = rule_probes(&table.rules.read).saturating_mul(2).saturating_add(rule_probes(&table.rules.update))
            .saturating_add(if upsert { rule_probes(&table.rules.insert).saturating_mul(2) } else { 0 });
        // Covers the largest cloned row allowed by the schema, the caller's patch
        // (including ill-typed fields), and the miss arm's image/default materialization.
        // Retained maps/assets share their Arc; the merge charges only memory it copies.
        let heap = row_copy_ceiling(table).saturating_mul(2).saturating_add(patch.heap_bytes().saturating_mul(2));
        for (kind, amount, used, ceiling) in [(MeterKind::RuleProbes, probes, self.meter.used.rule_probes, self.meter.ceilings.rule_probes),
            (MeterKind::HeapBytes, heap, self.meter.used.heap_bytes, self.meter.ceilings.heap_bytes)] {
            if !self.meter.room(kind, amount) { return Err(RuntimeError::Bound { kind, actual: used.saturating_add(amount), ceiling, site: self.meter.site().into() }); }
        }
        Ok(())
    }

    pub(super) fn merge_patch(&mut self, old: &Value, patch: &Value) -> Result<Value, RuntimeError> {
        let mut bytes = 40_u64;
        for (key, value) in old.as_object()?.iter().filter(|(key, _)| !patch.as_object().expect("patch checked").contains_key(*key)).chain(patch.as_object()?.iter()) {
            bytes = bytes.saturating_add(80 + key.len() as u64 + value.clone_heap_bytes());
        }
        self.meter.heap(bytes)?;
        let fields = old.as_object()?.iter().filter(|(key, _)| !patch.as_object().expect("patch checked").contains_key(*key)).chain(patch.as_object()?.iter())
            .map(|(key, value)| (key.clone(), value.clone())).collect::<std::collections::BTreeMap<_, _>>();
        Ok(Value::Row(fields.into()))
    }

    pub(super) fn no_write_target(&self) -> RuntimeError {
        RuntimeError::Require { site: Some(self.statement_site.clone()), code: "NOT_FOUND".into() }
    }

    // @ref LLP 3000.007#8 — item 7: an unheld write target without an absence proof queues.
    pub(super) fn write_miss(&mut self, table: &str, index: &str, key: &[Value]) -> RuntimeError {
        if self.device {
            self.unknown_fact(table, index, key, &self.statement_site.clone());
            if let Some(message) = &mut self.missing_fact { *message = message.replace("the row or its absence is past the acquired horizon or online only", "the write target is not held on this device; only the server can resolve it"); }
            RuntimeError::Prediction(self.missing_fact.clone().expect("missing site recorded"))
        } else { self.no_write_target() }
    }

    pub(super) fn upsert_absence_proven(&mut self, table: &str, index: &str, key: &[Value]) -> Result<bool, RuntimeError> {
        let expressions: Vec<_> = key.iter().map(|value| {
            if *value == Value::Id(self.context.viewer.clone()) { Expr::Input(Input::Viewer) } else { Expr::Literal(value.clone()) }
        }).collect();
        let Ok(visibility) = super::rules::upsert_absence(self.schema, table, index, &expressions) else { return Ok(false) };
        if self.tx.retained_group(table, index, key)? { return Ok(false); }
        if visibility.decided_true { return Ok(true); }
        // A uniform key can still name somebody else's private group. Evaluate
        // the rule over only its pinned columns, never using trust_synced_read:
        // the synthetic row was not delivered. A positive membership witness
        // may establish readability; an unknown probe must still queue.
        let definition = &self.schema.tables[table];
        let rule = definition.rules.read.device_audience_rule().into_owned();
        let row = Value::Row(definition.index(index).expect("checked index").columns().into_iter().zip(key.iter().cloned()).collect());
        let viewer = self.context.viewer.clone();
        self.meter.heap(row.heap_bytes())?;
        let readable = super::rules::evaluate(&rule, &viewer, None, &row, false, self)?;
        Ok(readable && !self.beyond_horizon)
    }

    // @ref LLP 3000.007#20.5 — key absence is not insert authority: the materialized image and every colliding/counting population need the same held-group proof.
    pub(super) fn prove_upsert_insert(&mut self, table: &str, addressed_index: &str, row: &Value) -> Result<(), RuntimeError> {
        let definition = self.schema.tables[table].clone();
        let image_key = index_values(definition.index(addressed_index).expect("addressed index"), row);
        if !self.upsert_absence_proven(table, addressed_index, &image_key)? {
            return Err(self.write_miss(table, addressed_index, &image_key));
        }
        // byId is either the already-proven addressed key or a fresh minted id.
        // Every application unique key can collide with a different, hidden row.
        for (name, index) in definition.indexes.iter().filter(|(name, index)| index.unique && name.as_str() != "byId" && name.as_str() != addressed_index) {
            let key = index_values(index, row);
            if !key.contains(&Value::Null) && !self.upsert_absence_proven(table, name, &key)? {
                return Err(self.write_miss(table, name, &key));
            }
        }
        for constraint in &definition.constraints {
            if let Constraint::Cap { by, .. } = constraint {
                let key: Vec<_> = by.iter().map(|field| row.field(field).cloned().unwrap_or(Value::Null)).collect();
                let Some((name, _)) = definition.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(by)) else {
                    return Err(RuntimeError::Schema(format!("cap by {} has no leading index", by.join(", "))));
                };
                // An empty prefix is a whole-table cap: only full public sync
                // covers it. A private viewer partition cannot count hidden rows.
                if !self.upsert_absence_proven(table, name, &key)? { return Err(self.write_miss(table, name, &key)); }
            }
        }
        Ok(())
    }

    pub(super) fn write_target(&mut self, target: &Read, patch: &Expr, upsert: bool, condition: Option<&WriteCondition>, valued: bool) -> Result<Value, RuntimeError> {
        self.target_attempt(|runner| runner.resolve_write_target(target, patch, upsert, condition, valued))
    }

    fn resolve_write_target(&mut self, target: &Read, patch: &Expr, upsert: bool, condition: Option<&WriteCondition>, valued: bool) -> Result<Value, RuntimeError> {
        self.refuse_engine_owned(&target.table)?;
        if upsert && condition.is_some() { return Err(RuntimeError::Input("a condition belongs on update; an upsert inserts or patches".into())); }
        if let Some(condition) = condition { validate_condition(condition)?; }
        let key = target.key.iter().map(|e| self.expr(e)).collect::<Result<Vec<_>, _>>()?;
        let patch = self.expr(patch)?;
        let definition = self.schema.table(&target.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", target.table)))?.clone();
        let index = definition.index(&target.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", target.table, target.index)))?;
        if !index.unique || key.len() != index.columns().len() { return Err(RuntimeError::Input("a write target needs one complete unique key".into())); }
        if patch.as_object()?.contains_key("id") { return Err(RuntimeError::Input(format!("{} update patch cannot change id", target.table))); }
        self.read_tables.insert(target.table.clone());
        self.reserve_target_resolution(&definition, &patch, upsert)?;
        let old = self.lookup_live(&target.table, &target.index, index, &key, false)?;
        if self.device && (definition.sync.is_none() || (old.is_none() && (!upsert || !self.upsert_absence_proven(&target.table, &target.index, &key)?))) {
            return Err(self.write_miss(&target.table, &target.index, &key));
        }
        let id = if let Some(mut old) = old {
            materialize_optional_fields(&mut old, &definition);
            let readable = self.check_rule(&target.table, Effect::Read, None, &old)?;
            let patch = self.ignore_hidden_immutable_patch(&target.table, patch, readable)?;
            let id = old.field("id")?.clone();
            let new = self.merge_patch(&old, &patch)?;
            // The old image is used only in this isolated condition scope, after update authority.
            self.authorize_update(&target.table, &old, &new, readable)?;
            if let Some(condition) = condition {
                self.require_readable_condition(readable)?;
                let passed = self.write_condition(condition, &old);
                match passed {
                    Ok(true) => {}
                    Ok(false) => return Err(RuntimeError::Conflict { current: Read { key: vec![Expr::Literal(id)], index: "byId".into(), ..target.clone() } }),
                    Err(error) => return Err(error),
                }
            }
            self.replace_authorized(&target.table, old, new, readable, &patch)?;
            id
        } else {
            if !upsert { return Err(self.no_write_target()); }
            let id = if target.index == "byId" { key[0].clone() } else { Value::Id(self.context.mint()?) };
            let mut fields = patch.as_object()?.clone();
            for (column, value) in index.columns().iter().zip(&key) { fields.entry(column.clone()).or_insert_with(|| value.clone()); }
            fields.insert("id".into(), id.clone());
            let row = Value::Row(fields.into());
            self.meter.heap(row.heap_bytes())?;
            self.insert_upsert(&target.table, &target.index, row)?;
            id
        };
        // Only an ordinary read of the final row can enter the author's program.
        if !valued { return Ok(Value::Null); }
        self.get(&Read { site: target.site.clone(), table: target.table.clone(), index: "byId".into(), key: vec![Expr::Literal(id)], provenance: KeyProvenance::Computed })
    }

    // @ref LLP 3000.007#17 — ruling 17 (a), third pass: hidden immutable fields are ignored, never compared, on update and upsert.
    pub(super) fn ignore_hidden_immutable_patch(&self, table: &str, patch: Value, readable: bool) -> Result<Value, RuntimeError> {
        if readable { return Ok(patch); }
        let mut fields = patch.as_object()?.clone();
        for constraint in &self.schema.tables[table].constraints {
            if let crate::schema::Constraint::Immutable { fields: immutable } = constraint {
                for field in immutable { fields.remove(field); }
            }
        }
        Ok(Value::Row(fields.into()))
    }

    // @ref LLP 3000.007#14 — ruling 17 (b): an author condition needs a readable target; a blind patch needs none.
    fn require_readable_condition(&self, readable: bool) -> Result<(), RuntimeError> {
        if readable { Ok(()) } else { Err(self.no_write_target()) }
    }

    // @ref LLP 3000.007#17 — the runtime also forbids writes while engine old is in scope.
    pub(super) fn refuse_condition_write(&self) -> Result<(), RuntimeError> {
        if self.evaluating_write_condition { Err(RuntimeError::Input("an update condition cannot write".into())) } else { Ok(()) }
    }

    fn write_condition(&mut self, condition: &WriteCondition, old: &Value) -> Result<bool, RuntimeError> {
        validate_condition(condition)?;
        self.meter.heap(self.env.values().map(Value::heap_bytes).sum::<u64>() + old.heap_bytes())?;
        let env = self.env.clone();
        let consts = self.consts.clone();
        let site = self.statement_site.clone();
        self.env.insert(condition.old.clone(), old.clone());
        let previous = self.evaluating_write_condition;
        self.evaluating_write_condition = true;
        let result = (|| {
            if !matches!(self.statements(&condition.setup, &site)?, Flow::Next) { return Err(RuntimeError::Input("an update condition must produce one boolean".into())); }
            Ok(self.expr(&condition.value)?.as_bool()?)
        })();
        self.evaluating_write_condition = previous;
        self.env = env;
        self.consts = consts;
        self.statement_site = site;
        result
    }
}

// @ref LLP 3000.007#17 — condition purity is an exhaustive allowlist, including expression setup and filters.
fn validate_condition(condition: &WriteCondition) -> Result<(), RuntimeError> {
    if pure(&condition.setup) && pure_expr(&condition.value) { Ok(()) }
    else { Err(RuntimeError::Input("an update condition cannot write or have side effects".into())) }
}

fn pure(stmts: &[Stmt]) -> bool {
    stmts.iter().all(|stmt| match stmt {
        Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } | Stmt::Emit { .. } => false,
        Stmt::If { condition, then_body, else_body } => pure_expr(condition) && pure(then_body) && pure(else_body),
        Stmt::For { body, domain, .. } => pure(body) && match domain {
            LoopDomain::DerivedArray { value, .. } => pure_expr(value),
            LoopDomain::Page(scan) => pure_scan(scan),
            LoopDomain::Recurse(recurse) => pure_expr(&recurse.seed),
            LoopDomain::ExpressionRange { start, end_exclusive } => pure_expr(start) && pure_expr(end_exclusive),
            LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => true,
        },
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => pure_expr(value),
        Stmt::Require { condition, .. } => pure_expr(condition),
        Stmt::Check { condition, current } => pure_expr(condition) && current.key.iter().all(pure_expr),
        Stmt::Break | Stmt::Continue => true,
    })
}

fn pure_scan(scan: &Scan) -> bool {
    scan.prefix.iter().all(|key| match key { IndexKeyExpr::Scalar(expr) | IndexKeyExpr::WordPrefix(expr) => pure_expr(expr) })
        && [&scan.after, &scan.before, &scan.filter].into_iter().flatten().all(|expr| pure_expr(expr))
        && scan.range.as_ref().is_none_or(|range| [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten().all(|expr| pure_expr(expr)))
}

fn pure_expr(expr: &Expr) -> bool {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) => true,
        Expr::Input(input) => match input { Input::NewId => false, Input::Viewer | Input::Now | Input::ReadTime => true },
        Expr::Merge(merge) => merge.lanes.iter().all(|lane| pure(&lane.setup) && pure_scan(&lane.scan) && lane.source.as_ref().is_none_or(pure_scan)),
        Expr::Scan(scan) => pure_scan(scan),
        Expr::Block { body, value } => pure(body) && pure_expr(value),
        Expr::Shape { base, fields } => pure_expr(base) && fields.values().all(pure_expr),
        Expr::Array(items) => items.iter().all(pure_expr),
        Expr::Builtin { builtin, args } => pure_builtin(builtin) && args.iter().all(pure_expr),
        Expr::Object(fields) => fields.values().all(pure_expr),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => pure_expr(base),
        Expr::Binary { left, right, .. } => pure_expr(left) && pure_expr(right),
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().all(pure_expr),
    }
}

fn pure_builtin(builtin: &Builtin) -> bool {
    match builtin {
        Builtin::Divmod { .. } | Builtin::Connected => false,
        Builtin::Len | Builtin::Slice | Builtin::Concat | Builtin::Lower | Builtin::Trim | Builtin::Join | Builtin::Group { .. }
        | Builtin::First | Builtin::Last | Builtin::At | Builtin::Min | Builtin::Max | Builtin::Sort { .. } | Builtin::MentionTokens
        | Builtin::DeterministicShare | Builtin::Count | Builtin::Sum | Builtin::CountCapped => true,
    }
}

fn row_copy_ceiling(table: &Table) -> u64 {
    table.columns.iter().fold(40, |total, (name, ty)| total.saturating_add(80 + name.len() as u64).saturating_add(column_copy_ceiling(ty)))
}
fn column_copy_ceiling(ty: &ColumnType) -> u64 {
    match ty {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => 144,
        ColumnType::Text { max } => u64::from(*max) * 4,
        ColumnType::Bytes { max } => u64::from(*max),
        ColumnType::Enum { variants } => variants.iter().map(|v| v.len() as u64).max().unwrap_or(0),
        ColumnType::Optional(inner) => column_copy_ceiling(inner),
        ColumnType::List { of, max } => u64::from(*max).saturating_mul(std::mem::size_of::<Value>() as u64 + column_copy_ceiling(of)),
        // Canonical JSON bytes bound owned strings/bytes and array slots at every
        // depth. Object subtrees, like image/video facts, are shared Arc values.
        ColumnType::Json { max_bytes } => u64::from(*max_bytes) * (std::mem::size_of::<Value>() as u64 + 1),
        ColumnType::Image { .. } | ColumnType::Video { .. } | ColumnType::Int | ColumnType::Decimal { .. } | ColumnType::Money { .. } | ColumnType::Bool | ColumnType::Time => 0,
    }
}
