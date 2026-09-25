//! Total-key page planning. This side table is never serialized. It evaluates
//! no Quarry expression: the interpreter remains the only semantic executor.
//! @ref LLP 3000.009#4.2 — speculative access must preserve every observation.
use crate::{ir::*, rows::PrefetchRequest, schema::{RuleExpr, RuleTerm, Schema}, Value};
use super::super::Context;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
enum Key { Row(Vec<String>), Literal(Value), Viewer, Arg(String), Field(Box<Key>, String) }

#[derive(Clone, Debug)]
struct Mark { read: Read, keys: Vec<Key>, probes: Vec<Mark> }

#[derive(Default)]
pub(in crate::engine) struct Plan { sites: BTreeMap<String, Vec<Mark>> }

#[derive(Clone, Default)]
struct Env { keys: BTreeMap<String, Key>, pages: BTreeSet<String> }

fn total(expr: &Expr, env: &Env) -> Option<Key> {
    match expr {
        Expr::Literal(v) if scalar(v) => Some(Key::Literal(v.clone())),
        Expr::Input(Input::Viewer) => Some(Key::Viewer),
        Expr::Variable(name) => env.keys.get(name).cloned(),
        Expr::Field { base, name } => match total(base, env)? {
            Key::Row(mut path) => { path.push(name.clone()); Some(Key::Row(path)) }
            base => Some(Key::Field(Box::new(base), name.clone())),
        },
        _ => None,
    }
}

fn plain(scan: &Scan) -> bool {
    scan.merge_site.is_none() && scan.prefix.iter().all(|k| matches!(k, IndexKeyExpr::Scalar(_)))
}
fn page(expr: &Expr, env: &Env) -> bool {
    match expr { Expr::Scan(scan) => plain(scan), Expr::Variable(name) => env.pages.contains(name), _ => false }
}
fn scalar(value: &Value) -> bool { matches!(value, Value::Null | Value::Bool(_) | Value::Int(_) | Value::String(_) | Value::Id(_) | Value::Bytes(_)) }

// Assign and Push can mutate aliases; repeated declarations can shadow them.
// Conservative whole-program rejection keeps branch and helper flow honest.
fn mutations(body: &[Stmt], writes: &mut BTreeMap<String, usize>, assigned: &mut BTreeSet<String>) {
    for stmt in body {
        match stmt {
            Stmt::Const { name, .. } | Stmt::Let { name, .. } => { *writes.entry(name.clone()).or_default() += 1; }
            Stmt::Assign { name, .. } | Stmt::Push { target: name, .. } => { assigned.insert(name.clone()); }
            Stmt::For { binding, domain, body } => {
                *writes.entry(binding.clone()).or_default() += 1;
                match domain {
                    LoopDomain::Page(scan) => { if let Some(filter) = &scan.filter { block_mutations(filter, writes, assigned); } }
                    LoopDomain::DerivedArray { value, .. } => block_mutations(value, writes, assigned),
                    _ => {}
                }
                mutations(body, writes, assigned);
            }
            Stmt::If { then_body, else_body, .. } => { mutations(then_body, writes, assigned); mutations(else_body, writes, assigned); }
            Stmt::InsertIfAbsent { result, .. } => { assigned.insert(result.clone()); }
            Stmt::WriteTarget { result, condition, .. } => {
                if let Some(result) = result { assigned.insert(result.clone()); }
                if let Some(condition) = condition {
                    assigned.insert(condition.old.clone());
                    mutations(&condition.setup, writes, assigned);
                }
            }
            _ => {}
        }
        // Blocks are where/helper setup; none of their bindings may become
        // an assumed immutable argument in a later page.
        expressions(stmt, &mut |expr| block_mutations(expr, writes, assigned));
    }
}
fn block_mutations(expr: &Expr, writes: &mut BTreeMap<String, usize>, assigned: &mut BTreeSet<String>) {
    if let Expr::Block { body, .. } = expr { mutations(body, writes, assigned); }
    if let Expr::Builtin { builtin: Builtin::Divmod { remainder_sink }, .. } = expr { assigned.insert(remainder_sink.clone()); }
    if let Expr::Scan(scan) = expr {
        if let Some(filter) = &scan.filter { block_mutations(filter, writes, assigned); }
    }
    children(expr, &mut |expr| block_mutations(expr, writes, assigned));
}

pub(super) fn plan(program: &Program) -> Plan {
    let (mut writes, mut assigned) = (BTreeMap::new(), BTreeSet::new());
    mutations(&program.body, &mut writes, &mut assigned);
    assigned.extend(writes.iter().filter(|(_, n)| **n > 1).map(|(name, _)| name.clone()));
    let mut env = Env::default();
    for name in program.args.keys().filter(|name| !assigned.contains(*name) && !writes.contains_key(*name)) {
        env.keys.insert(name.clone(), Key::Arg(name.clone()));
    }
    let mut plan = Plan::default();
    walk(&program.body, &program.name, &mut env, &assigned, None, &mut plan);
    plan
}

fn walk(body: &[Stmt], prefix: &str, env: &mut Env, assigned: &BTreeSet<String>, owner: Option<&str>, plan: &mut Plan) {
    for (n, stmt) in body.iter().enumerate() {
        let site = format!("{prefix}:{}", n + 1);
        if let Some(owner) = owner {
            expressions(stmt, &mut |expr| mark(expr, owner, env, plan));
        }
        match stmt {
            Stmt::Let { name, value } | Stmt::Const { name, value } => {
                let key = (!assigned.contains(name)).then(|| total(value, env)).flatten();
                let is_page = !assigned.contains(name) && page(value, env);
                env.keys.remove(name); env.pages.remove(name);
                if let Some(key) = key { env.keys.insert(name.clone(), key); }
                if is_page { env.pages.insert(name.clone()); }
            }
            Stmt::If { then_body, else_body, .. } => {
                let (mut left, mut right) = (env.clone(), env.clone());
                walk(then_body, &format!("{site}:then"), &mut left, assigned, owner, plan);
                walk(else_body, &format!("{site}:else"), &mut right, assigned, owner, plan);
                left.keys.retain(|k, v| right.keys.get(k) == Some(v));
                left.pages.retain(|k| right.pages.contains(k));
                *env = left;
            }
            Stmt::For { binding, domain, body } => {
                let page_site = match domain {
                    LoopDomain::Page(scan) if plain(scan) => Some(scan.site.as_str()),
                    LoopDomain::DerivedArray { value, .. } if page(value, env) => Some(site.as_str()),
                    _ => None,
                };
                // Never plan inside a recurse, matching lane or merge.
                if let Some(page_site) = page_site {
                    let mut local = env.clone();
                    // An enclosing row is not the current page's row.
                    local.keys.retain(|_, key| !row_key(key));
                    if !assigned.contains(binding) { local.keys.insert(binding.clone(), Key::Row(Vec::new())); }
                    walk(body, &site, &mut local, assigned, Some(page_site), plan);
                    // Lowered shapes collect a page in an initially empty
                    // array. Its rows may be shaped, so fill at DerivedArray
                    // iteration time using the actual shaped images.
                    for statement in body { if let Stmt::Push { target, .. } = statement { env.pages.insert(target.clone()); } }
                } else if !matches!(domain, LoopDomain::Page(_) | LoopDomain::DerivedArray { .. } | LoopDomain::Recurse(_)) {
                    // Inline helpers can use a one-iteration range for their
                    // local return. Outer total keys remain safe to mark;
                    // the helper's range/list binding is never a row alias.
                    let mut local = env.clone();
                    local.keys.remove(binding);
                    walk(body, &site, &mut local, assigned, owner, plan);
                }
                env.keys.remove(binding);
            }
            Stmt::WriteTarget { condition: Some(condition), .. } => {
                let mut local = env.clone();
                local.keys.remove(&condition.old);
                walk(&condition.setup, &format!("{site}:condition"), &mut local, assigned, owner, plan);
            }
            Stmt::Assign { name, .. } => { env.keys.remove(name); env.pages.remove(name); }
            _ => {}
        }
    }
}
fn row_key(key: &Key) -> bool { match key { Key::Row(_) => true, Key::Field(base, _) => row_key(base), _ => false } }

fn mark(expr: &Expr, owner: &str, env: &Env, plan: &mut Plan) {
    match expr {
        Expr::Get(read) | Expr::Exists(read) => {
            if let Some(keys) = read.key.iter().map(|e| total(e, env)).collect::<Option<Vec<_>>>() {
                plan.sites.entry(owner.into()).or_default().push(Mark { read: read.clone(), keys, probes: Vec::new() });
            }
            // A dependent outer lookup stays unmarked; an inner lookup
            // whose own key is total can still belong to this first flight.
            for key in &read.key { mark(key, owner, env, plan); }
        }
        Expr::Block { .. } | Expr::Scan(_) | Expr::Merge(_) => return,
        _ => children(expr, &mut |expr| mark(expr, owner, env, plan)),
    }
}
fn children(expr: &Expr, f: &mut impl FnMut(&Expr)) {
    match expr {
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => f(base),
        Expr::Binary { left, right, .. } => { f(left); f(right); }
        Expr::Array(values) | Expr::Builtin { args: values, .. } => values.iter().for_each(f),
        Expr::Object(fields) => fields.values().for_each(f),
        Expr::Shape { base, fields } => { f(base); fields.values().for_each(f); }
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().for_each(f),
        Expr::Block { value, .. } => f(value),
        _ => {}
    }
}
fn expressions(stmt: &Stmt, f: &mut impl FnMut(&Expr)) {
    match stmt {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value)
        | Stmt::Require { condition: value, .. } | Stmt::If { condition: value, .. }
        | Stmt::Insert { row: value, .. } | Stmt::InsertIfAbsent { row: value, .. } | Stmt::Delete { key: value, .. } => f(value),
        Stmt::Emit { payload, once, .. } => { f(payload); if let Some(key) = once { f(key); } },
        Stmt::Update { key, patch, .. } | Stmt::Upsert { key, row: patch, .. } => { f(key); f(patch); }
        Stmt::Check { condition, current } => { f(condition); f(&Expr::Get(current.clone())); }
        Stmt::DeleteTarget { target } => f(&Expr::Get(target.clone())),
        Stmt::WriteTarget { target, patch, condition, .. } => {
            f(&Expr::Get(target.clone()));
            f(patch);
            if let Some(condition) = condition { f(&condition.value); }
        }
        _ => {}
    }
}

fn value(key: &Key, row: &Value, ctx: &Context) -> Option<Value> {
    match key {
        Key::Row(path) => { let mut v = row; for field in path { v = v.field(field).ok()?; } Some(v.clone()) }
        Key::Literal(v) => Some(v.clone()),
        Key::Viewer => Some(Value::Id(ctx.viewer.clone())),
        Key::Arg(name) => ctx.args.get(name).cloned(),
        Key::Field(base, field) => value(base, row, ctx)?.field(field).ok().cloned(),
    }
}
fn cacheable(schema: &Schema, name: &str) -> bool {
    schema.table(name).is_some_and(|t| t.expire.is_none()) && schema.maintain_for(name)
        .is_none_or(|m| schema.table(&m.source).is_some_and(|t| t.expire.is_none()))
}
fn request(schema: &Schema, table: &str, index: &str, keys: Vec<Value>, requests: &mut Vec<PrefetchRequest>) {
    if cacheable(schema, table) && keys.iter().all(|v| *v != Value::Null && scalar(v))
        && schema.table(table).and_then(|t| t.index(index)).is_some_and(|i| i.is_plain() && i.components.len() == keys.len()) {
        requests.push(PrefetchRequest::Lookup { table: table.into(), index: index.into(), key: keys });
    }
}
fn probes(rule: &RuleExpr, schema: &Schema, pinned: &BTreeMap<String, Key>, out: &mut Vec<Mark>) {
    match rule {
        RuleExpr::Exists { table, index, key, provenance, .. } => {
            let keys = key.iter().map(|term| match term {
                RuleTerm::Field(field) | RuleTerm::NextField(field) => pinned.get(field).cloned(),
                RuleTerm::Literal(value) if scalar(value) => Some(Key::Literal(value.clone())),
                RuleTerm::Viewer => Some(Key::Viewer), _ => None,
            }).collect::<Option<Vec<_>>>();
            if let Some(keys) = keys && cacheable(schema, table)
                && schema.table(table).and_then(|t| t.index(index)).is_some_and(|i| i.is_plain() && i.components.len() == keys.len()) {
                out.push(Mark { read: Read { site: String::new(), table: table.clone(), index: index.clone(), key: Vec::new(), provenance: *provenance }, keys, probes: Vec::new() });
            }
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => rules.iter().for_each(|rule| probes(rule, schema, pinned, out)),
        RuleExpr::Not(rule) => probes(rule, schema, pinned, out),
        _ => {}
    }
}
impl Plan {
    pub(super) fn admit(mut self, schema: &Schema) -> Self {
        for marks in self.sites.values_mut() {
            marks.retain_mut(|mark| {
                if !cacheable(schema, &mark.read.table) { return false; }
                let Some(table) = schema.table(&mark.read.table) else { return false };
                let Some(index) = table.index(&mark.read.index).filter(|i| i.is_plain() && i.components.len() == mark.keys.len()) else { return false };
                let pinned = index.columns().into_iter().zip(mark.keys.iter().cloned()).collect();
                probes(&table.rules.read, schema, &pinned, &mut mark.probes);
                true
            });
        }
        self.sites.retain(|_, marks| !marks.is_empty());
        self
    }
    pub(in crate::engine) fn fill(&self, site: &str, rows: &[Value], ctx: &Context, schema: &Schema, tx: &crate::engine::authorized_scan::GuardedRows<'_>) {
        let Some(marks) = self.sites.get(site) else { return };
        let mut requests = Vec::new();
        for mark in marks {
            for row in rows {
                let Some(keys) = mark.keys.iter().map(|k| value(k, row, ctx)).collect::<Option<Vec<_>>>() else { continue };
                if keys.iter().any(|v| *v == Value::Null || !scalar(v)) { continue; }
                request(schema, &mark.read.table, &mark.read.index, keys, &mut requests);
                for probe in &mark.probes {
                    if let Some(keys) = probe.keys.iter().map(|k| value(k, row, ctx)).collect::<Option<Vec<_>>>() {
                        request(schema, &probe.read.table, &probe.read.index, keys, &mut requests);
                    }
                }
            }
        }
        tx.prefetch(&requests);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scan() -> Scan {
        Scan { variant: None, site: "page".into(), table: "items".into(), index: "byId".into(), prefix: vec![], order: Order::Asc, take: Bound::Literal(10), existence: false,
            after: None, before: None, range: None, filter: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }
    }
    fn read(site: &str, key: Expr) -> Expr {
        Expr::Get(Read { site: site.into(), table: "items".into(), index: "byId".into(), key: vec![key], provenance: KeyProvenance::Shape })
    }
    fn program(body: Vec<Stmt>) -> Program {
        Program { name: "p".into(), kind: ProgramKind::Query, args: BTreeMap::from([("arg".into(), ArgType::Id)]),
            read_time_granularity_ms: None, body, native: false, returned_shapes: Default::default() }
    }
    #[test]
    fn total_aliases_are_marked_but_assignments_reads_arithmetic_and_filters_are_not() {
        let body = vec![
            Stmt::Let { name: "alias".into(), value: field(var("row"), "id") },
            Stmt::Return(Expr::Array(vec![
                read("alias", var("alias")), read("arg", var("arg")), read("viewer", Expr::Input(Input::Viewer)),
                read("literal", lit(Value::Id("x".into()))),
                read("unstable", var("unstable")),
                read("dependent", field(read("inner", var("alias")), "id")),
                read("arithmetic", Expr::Binary { op: BinaryOp::Add, left: Box::new(lit(Value::Int(1))), right: Box::new(lit(Value::Int(2))) }),
                Expr::Block { body: vec![], value: Box::new(read("filter", var("alias"))) },
            ])),
        ];
        let p = program(vec![
            Stmt::Let { name: "unstable".into(), value: var("arg") },
            Stmt::For { binding: "row".into(), domain: LoopDomain::Page(scan()), body },
            Stmt::Assign { name: "unstable".into(), value: lit(Value::Id("later".into())) },
        ]);
        let plan = plan(&p);
        let sites: Vec<_> = plan.sites["page"].iter().map(|m| m.read.site.as_str()).collect();
        assert_eq!(sites, ["alias", "arg", "viewer", "literal", "inner"]);
        assert_eq!(plan.sites["page"][0].keys, [Key::Row(vec!["id".into()])]);
    }
    #[test]
    fn derived_page_aliases_plan_at_their_loop_but_matching_and_merges_do_not() {
        let body = vec![Stmt::Return(read("related", field(var("row"), "id")))];
        let p = program(vec![Stmt::Let { name: "page".into(), value: Expr::Scan(scan()) },
            Stmt::Const { name: "alias".into(), value: var("page") },
            Stmt::For { binding: "row".into(), domain: LoopDomain::DerivedArray { value: var("alias"), max: 10, bound_source: "page".into() }, body: body.clone() }]);
        assert_eq!(plan(&p).sites["p:3"][0].read.site, "related");
        for merge in [false, true] {
            let mut scan = scan();
            if merge { scan.merge_site = Some("merge".into()); } else { scan.prefix.push(IndexKeyExpr::WordPrefix(lit(Value::String("word".into())))); }
            let p = program(vec![Stmt::For { binding: "row".into(), domain: LoopDomain::Page(scan), body: body.clone() }]);
            assert!(plan(&p).sites.is_empty());
        }
    }

    #[test]
    fn schema_admission_marks_only_pinned_probes_and_excludes_expiring_targets() {
        let mut schema: Schema = serde_json::from_value(serde_json::json!({"tables": {
            "items": {"columns": {"id": "Id", "at": "Time"},
                "indexes": {"byId": {"components": [{"Column": "id"}], "unique": true}},
                "rules": {"read": "Allow", "insert": "Allow", "update": "Allow", "delete": "Allow"}}
        }})).unwrap();
        schema.tables.insert("probes".into(), schema.tables["items"].clone());
        let probe = |field: &str| RuleExpr::Exists { table: "probes".into(), index: "byId".into(), key: vec![RuleTerm::Field(field.into())], equalities: vec![], provenance: KeyProvenance::Shape };
        schema.tables.get_mut("items").unwrap().rules.read = RuleExpr::And(vec![probe("id"), probe("at")]);
        let p = program(vec![Stmt::For { binding: "row".into(), domain: LoopDomain::Page(scan()),
            body: vec![Stmt::Return(read("related", field(var("row"), "id")))] }]);
        let admitted = plan(&p).admit(&schema);
        assert_eq!(admitted.sites["page"][0].probes.len(), 1);
        assert_eq!(admitted.sites["page"][0].probes[0].keys, [Key::Row(vec!["id".into()])]);
        schema.tables.get_mut("probes").unwrap().expire = Some("at".into());
        assert!(plan(&p).admit(&schema).sites["page"][0].probes.is_empty());
        schema.tables.get_mut("items").unwrap().expire = Some("at".into());
        assert!(plan(&p).admit(&schema).sites.is_empty());
    }
}

#[cfg(test)]
mod write_walk_tests {
    use super::*;
    #[test]
    fn checks_targets_and_condition_setup_are_walked() {
        let target = Read { site: "target".into(), table: "items".into(), index: "byId".into(), key: vec![var("alias")], provenance: KeyProvenance::Arg };
        let setup = vec![Stmt::Assign { name: "alias".into(), value: lit(Value::Id("changed".into())) }];
        let body = vec![Stmt::WriteTarget { target: target.clone(), patch: lit(Value::Null), upsert: false, result: None,
            condition: Some(WriteCondition { old: "current".into(), setup, value: lit(Value::Bool(true)) }) }];
        let mut writes = BTreeMap::new();
        let mut assigned = BTreeSet::new();
        mutations(&body, &mut writes, &mut assigned);
        assert!(assigned.contains("alias"));
        let mut env = Env::default();
        env.keys.insert("alias".into(), Key::Arg("arg".into()));
        let mut found = Plan::default();
        for stmt in body.iter().chain([Stmt::Check { condition: lit(Value::Bool(false)), current: Read { site: "current".into(), ..target } }].iter()) {
            expressions(stmt, &mut |expr| mark(expr, "page", &env, &mut found));
        }
        assert_eq!(found.sites["page"].iter().map(|m| m.read.site.as_str()).collect::<Vec<_>>(), ["target", "current"]);
        let scan = Scan { variant: None, site: "page".into(), table: "items".into(), index: "byId".into(), prefix: vec![], order: Order::Asc,
            take: Bound::Literal(10), existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: false,
            merge_site: None, provenance: KeyProvenance::Const };
        let make = |body| Program { name: "p".into(), kind: ProgramKind::Mutation,
            args: BTreeMap::from([("alias".into(), ArgType::Id)]), read_time_granularity_ms: None,
            body: vec![Stmt::For { binding: "row".into(), domain: LoopDomain::Page(scan.clone()), body }], native: false, returned_shapes: Default::default() };
        assert!(plan(&make(body.clone())).sites.is_empty(), "setup assignment invalidates the argument alias before marking");
        let mut stable = body;
        if let Stmt::WriteTarget { condition: Some(condition), .. } = &mut stable[0] { condition.setup.clear(); }
        assert_eq!(plan(&make(stable)).sites["page"][0].read.site, "target", "the same write target is marked without reassignment");
    }
}
