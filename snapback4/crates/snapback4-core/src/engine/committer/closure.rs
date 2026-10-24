//! A finite S1 point closure, selected before any buffered execution.
use super::overlay::{Access, Base, RowKey};
use crate::{Program, Schema, Value, engine::Context, ir::*, schema::*};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
enum Binding {
    Scalar(Value),
    Row(String, String),
    Unknown,
}
pub(crate) struct Closure {
    pub roots: Vec<Access>,
    pub writes: BTreeSet<RowKey>,
    pub viewer: String,
}
impl Closure {
    // @ref LLP 3000.009.001.000.002#3.3 — eligibility proves all branches and all authority probes, never just distinct targets.
    pub fn new(
        schema: &Schema,
        program: &Program,
        context: &Context,
        generation: u64,
    ) -> Option<Self> {
        // Evolved generations may carry dormant/backfill/retained transitions.
        if generation != 1
            || program.native
            || program.kind != ProgramKind::Mutation
            || !schema.backfills.is_empty()
            || !schema.downfills.is_empty()
            || !schema.receipts.is_empty()
            || !schema.delivery.is_empty()
            || context.is_system()
        {
            return None;
        }
        if program.args.values().any(|a| {
            !matches!(
                a,
                ArgType::Ref { .. }
                    | ArgType::Id
                    | ArgType::Principal
                    | ArgType::Int
                    | ArgType::IntRange { .. }
                    | ArgType::Bool
                    | ArgType::Text { .. }
            )
        }) {
            return None;
        }
        let mut context = context.clone();
        crate::engine::validate::validate_inputs(schema, program, &mut context.args).ok()?;
        let mut env: BTreeMap<_, _> = context
            .args
            .iter()
            .map(|(k, v)| (k.clone(), Binding::Scalar(v.clone())))
            .collect();
        let mut plan = Self {
            roots: Vec::new(),
            writes: BTreeSet::new(),
            viewer: context.viewer.clone(),
        };
        plan.body(schema, &program.body, &mut env)?;
        if plan.roots.len() > 128 || plan.writes.is_empty() {
            return None;
        }
        Some(plan)
    }
    fn table<'a>(&self, schema: &'a Schema, name: &str) -> Option<&'a Table> {
        let t = schema.tables.get(name)?;
        if t.ephemeral.is_some()
            || t.through.is_some()
            || t.expire.is_some()
            || t.not_before.is_some()
            || !t.sequences.is_empty()
            || !t.maintained.is_empty()
            || !t.recorded.is_empty()
            || !t.written_by.is_empty()
            || !t.column_reads.is_empty()
            || t.update_transition
            || t.constraints.iter().any(|c| {
                !matches!(
                    c,
                    Constraint::Immutable { .. }
                        | Constraint::Unique { .. }
                        | Constraint::Text { .. }
                        | Constraint::AppendOnly
                        | Constraint::Capabilities(_)
                )
            })
            || schema
                .maintains
                .iter()
                .any(|m| m.source == name || m.target == name)
            || t.columns.values().any(ColumnType::contains_asset)
        {
            return None;
        }
        // Only one-hop, unique, read-only probes with immutable addresses.
        for rule in [&t.rules.read, &t.rules.update] {
            self.rule_shape(schema, t, rule)?;
        }
        Some(t)
    }
    fn rule_shape(&self, schema: &Schema, source: &Table, rule: &RuleExpr) -> Option<()> {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => {}
            RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => {
                self.term_shape(source, a, false)?;
                self.term_shape(source, b, false)?;
            }
            RuleExpr::And(rs) | RuleExpr::Or(rs) => {
                for r in rs {
                    self.rule_shape(schema, source, r)?;
                }
            }
            RuleExpr::Not(r) => self.rule_shape(schema, source, r)?,
            RuleExpr::Exists {
                table,
                index,
                key,
                equalities,
                ..
            } => {
                let target = schema.tables.get(table)?;
                let ix = target.indexes.get(index)?;
                if !ix.unique
                    || !ix.is_plain()
                    || key.len() != ix.components.len()
                    || target.expire.is_some()
                    || target.not_before.is_some()
                    || target.through.is_some()
                    || target.ephemeral.is_some()
                    || !target.maintained.is_empty()
                    || !target.recorded.is_empty()
                    || !target.column_reads.is_empty()
                    || !matches!(
                        target.rules.read,
                        RuleExpr::Public { .. }
                            | RuleExpr::Allow
                            | RuleExpr::Deny
                            | RuleExpr::Eq(RuleTerm::Field(_), RuleTerm::Viewer)
                    )
                {
                    return None;
                }
                for term in key {
                    self.term_shape(source, term, true)?;
                }
                for (_, term) in equalities {
                    self.term_shape(source, term, false)?;
                }
            }
            _ => return None,
        }
        Some(())
    }
    fn term_shape(&self, table: &Table, term: &RuleTerm, address: bool) -> Option<()> {
        match term {
            RuleTerm::Viewer | RuleTerm::Literal(_) => Some(()),
            RuleTerm::Field(name)
                if !address || name == "id" || table.immutable_fields().any(|f| f == name) =>
            {
                Some(())
            }
            _ => None,
        }
    }
    fn read(
        &mut self,
        schema: &Schema,
        r: &Read,
        env: &mut BTreeMap<String, Binding>,
    ) -> Option<Binding> {
        self.table(schema, &r.table)?;
        if r.index != "byId" || r.key.len() != 1 {
            return None;
        }
        let Binding::Scalar(id) = self.expr(schema, &r.key[0], env)? else {
            return None;
        };
        let id = id.as_str().ok()?.to_owned();
        let access = Access::point(&r.table, &id);
        if !self.roots.contains(&access) {
            self.roots.push(access);
        }
        Some(Binding::Row(r.table.clone(), id))
    }
    fn write(
        &mut self,
        schema: &Schema,
        table: &str,
        key: Binding,
        patch: &Expr,
        env: &mut BTreeMap<String, Binding>,
    ) -> Option<Binding> {
        let t = self.table(schema, table)?;
        let Binding::Scalar(id) = key else {
            return None;
        };
        let id = id.as_str().ok()?.to_owned();
        let Expr::Object(fields) = patch else {
            return None;
        };
        for field in fields.keys() {
            if field == "id"
                || t.immutable_fields().any(|f| f == field)
                || t.indexes
                    .values()
                    .any(|ix| !ix.is_plain() || ix.columns().contains(field))
            {
                return None;
            }
        }
        self.expr(schema, patch, env)?;
        let access = Access::point(table, &id);
        if !self.roots.contains(&access) {
            self.roots.push(access);
        }
        self.writes.insert((table.into(), id.clone()));
        Some(Binding::Row(table.into(), id))
    }
    fn body(
        &mut self,
        schema: &Schema,
        body: &[Stmt],
        env: &mut BTreeMap<String, Binding>,
    ) -> Option<()> {
        for s in body {
            match s {
                Stmt::Const { name, value } | Stmt::Let { name, value } => {
                    if env.contains_key(name) {
                        return None;
                    }
                    let v = self.expr(schema, value, env)?;
                    env.insert(name.clone(), v);
                }
                Stmt::Require { condition, .. } | Stmt::Return(condition) => {
                    self.expr(schema, condition, env)?;
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    self.expr(schema, condition, env)?;
                    self.body(schema, then_body, &mut env.clone())?;
                    self.body(schema, else_body, &mut env.clone())?;
                }
                Stmt::Update { table, key, patch } => {
                    let k = self.expr(schema, key, env)?;
                    self.write(schema, table, k, patch, env)?;
                }
                Stmt::WriteTarget {
                    target,
                    patch,
                    upsert: false,
                    condition: None,
                    result,
                } => {
                    let Binding::Row(table, id) = self.read(schema, target, env)? else {
                        return None;
                    };
                    let value =
                        self.write(schema, &table, Binding::Scalar(Value::Id(id)), patch, env)?;
                    if let Some(name) = result {
                        env.insert(name.clone(), value);
                    }
                }
                _ => return None,
            }
        }
        Some(())
    }
    fn expr(
        &mut self,
        schema: &Schema,
        e: &Expr,
        env: &mut BTreeMap<String, Binding>,
    ) -> Option<Binding> {
        Some(match e {
            Expr::Literal(v) => Binding::Scalar(v.clone()),
            Expr::Variable(name) => env.get(name)?.clone(),
            Expr::Input(Input::Viewer) => Binding::Scalar(Value::Id(self.viewer.clone())),
            Expr::Field { base, name } => {
                let b = self.expr(schema, base, env)?;
                if let Binding::Row(table, id) = b {
                    if name == "id" {
                        Binding::Scalar(Value::Id(id))
                    } else {
                        schema.tables.get(&table)?.columns.get(name)?;
                        Binding::Unknown
                    }
                } else {
                    return None;
                }
            }
            Expr::Get(r) | Expr::Exists(r) => self.read(schema, r, env)?,
            Expr::Block { body, value } => {
                self.body(schema, body, env)?;
                self.expr(schema, value, env)?
            }
            Expr::Binary { left, right, .. } => {
                self.expr(schema, left, env)?;
                self.expr(schema, right, env)?;
                Binding::Unknown
            }
            Expr::Unary { value, .. } => {
                self.expr(schema, value, env)?;
                Binding::Unknown
            }
            Expr::Object(fields) => {
                for v in fields.values() {
                    self.expr(schema, v, env)?;
                }
                Binding::Unknown
            }
            Expr::Array(values) => {
                for v in values {
                    self.expr(schema, v, env)?;
                }
                Binding::Unknown
            }
            Expr::Builtin { builtin, args }
                if matches!(
                    builtin,
                    Builtin::RequireUncapped
                        | Builtin::OptionalField { .. }
                        | Builtin::Min
                        | Builtin::Max
                ) =>
            {
                let values = args
                    .iter()
                    .map(|v| self.expr(schema, v, env))
                    .collect::<Option<Vec<_>>>()?;
                if matches!(builtin, Builtin::RequireUncapped) {
                    values.into_iter().next()?
                } else {
                    Binding::Unknown
                }
            }
            _ => return None,
        })
    }
    pub fn probes(&self, schema: &Schema, base: &Base) -> Option<Vec<Access>> {
        let mut probes = Vec::new();
        for root in &self.roots {
            let Some(row) = base.answer(root).ok()? else {
                continue;
            };
            let t = &schema.tables[&root.table];
            let image = crate::schema::row_image(&row, t);
            for rule in [&t.rules.read, &t.rules.update] {
                self.probe_rule(rule, &image, t, &mut probes)?;
            }
        }
        Some(probes)
    }
    fn probe_rule(
        &self,
        rule: &RuleExpr,
        row: &Value,
        table: &Table,
        out: &mut Vec<Access>,
    ) -> Option<()> {
        match rule {
            RuleExpr::And(rs) => {
                for r in rs {
                    self.probe_rule(r, row, table, out)?;
                    if self.stable(r, row, table) == Some(false) {
                        break;
                    }
                }
            }
            RuleExpr::Or(rs) => {
                for r in rs {
                    self.probe_rule(r, row, table, out)?;
                    if self.stable(r, row, table) == Some(true) {
                        break;
                    }
                }
            }
            RuleExpr::Not(r) => self.probe_rule(r, row, table, out)?,
            RuleExpr::Exists {
                table, index, key, ..
            } => {
                let values = key
                    .iter()
                    .map(|t| match t {
                        RuleTerm::Field(f) => row.field(f).ok().cloned(),
                        RuleTerm::Viewer => Some(Value::Id(self.viewer.clone())),
                        RuleTerm::Literal(v) => Some(v.clone()),
                        _ => None,
                    })
                    .collect::<Option<Vec<_>>>()?;
                let a = Access {
                    table: table.clone(),
                    index: index.clone(),
                    key: values,
                };
                if !out.contains(&a) {
                    out.push(a);
                }
            }
            _ => {}
        }
        Some(())
    }
    // Only immutable comparisons can prune a branch: a predecessor may change
    // an ordinary value, so its alternatives remain in the complete closure.
    fn stable(&self, rule: &RuleExpr, row: &Value, table: &Table) -> Option<bool> {
        let term = |t: &RuleTerm| match t {
            RuleTerm::Literal(v) => Some(v.clone()),
            RuleTerm::Viewer => Some(Value::Id(self.viewer.clone())),
            RuleTerm::Field(f) if f == "id" || table.immutable_fields().any(|i| i == f) => {
                row.field(f).ok().cloned()
            }
            _ => None,
        };
        match rule {
            RuleExpr::Allow | RuleExpr::Public { .. } => Some(true),
            RuleExpr::Deny => Some(false),
            RuleExpr::Eq(a, b) => Some(term(a)? == term(b)?),
            RuleExpr::Ne(a, b) => Some(term(a)? != term(b)?),
            RuleExpr::Not(r) => self.stable(r, row, table).map(|v| !v),
            _ => None,
        }
    }
}
