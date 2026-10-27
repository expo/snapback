//! Explicit query caller branches can be broader than a table read rule.
// @ref LLP 3000.036.002#131-notes-and-declarations — missing proof is advice about filtering, never a grant or disjoint-role claim.
use super::catalog::Catalog;
use crate::{ast::*, Diagnostic};
use snapback4_core::schema::{RuleExpr, RuleTerm, Schema};
use std::collections::BTreeMap;

pub(super) fn implies(have: &RuleExpr, need: &RuleExpr) -> bool {
    if matches!(need, RuleExpr::Eq(a,b) if a == b && matches!(a, RuleTerm::Field(_) | RuleTerm::Viewer | RuleTerm::Literal(_))) || have == need || need.is_uniformly_readable() || matches!(have, RuleExpr::Deny) { return true; }
    match (have, need) {
        (_, RuleExpr::And(items)) => items.iter().all(|n| implies(have, n)),
        (RuleExpr::Or(items), _) => items.iter().all(|h| implies(h, need)),
        (RuleExpr::And(items), _) => items.iter().any(|h| implies(h, need)),
        (_, RuleExpr::Or(items)) => items.iter().any(|n| implies(have, n)),
        (RuleExpr::Eq(a,b), RuleExpr::Eq(c,d)) => a == d && b == c,
        (RuleExpr::Exists { table:a, index:ai, key:ak, equalities:ae, .. }, RuleExpr::Exists { table:b, index:bi, key:bk, equalities:be, .. }) =>
            a == b && ai == bi && ak == bk && be.iter().all(|pair| ae.contains(pair)),
        _ => false,
    }
}
// A live row selected by a total unique key has exactly one value of each
// required finite enum. Only raw-safe negative witnesses exclude alternatives.
pub(super) fn finite_rosters(schema:&Schema,conditions:&[RuleExpr])->Vec<RuleExpr>{
    fn leaves<'a>(rule:&'a RuleExpr,positive:bool,out:&mut Vec<(&'a RuleExpr,bool)>){match rule{
        RuleExpr::And(parts) if positive=>for part in parts{leaves(part,true,out)},
        RuleExpr::Or(parts) if !positive=>for part in parts{leaves(part,false,out)},
        RuleExpr::Not(value)=>leaves(value,!positive,out),_=>out.push((rule,positive)),
    }}
    let mut facts=Vec::new();for rule in conditions{leaves(rule,true,&mut facts);}
    let mut derived=Vec::new();
    for (fact,true_) in &facts{
        if !true_{continue;}
        let RuleExpr::Exists{table,index,key,equalities,..}=fact else{continue;};
        if !equalities.is_empty(){continue;}
        let Some(t)=schema.table(table)else{continue;};let Some(idx)=t.index(index)else{continue;};
        if !idx.unique||key.len()!=idx.components.len()||idx.components.iter().any(|part|part.column().is_none_or(|c|c!="id"&&t.columns.get(c).is_none_or(|kind|kind.is_optional()))){continue;}
        for (column,kind) in &t.columns{
            let snapback4_core::schema::ColumnType::Enum{variants}=kind else{continue;};
            if variants.len()>32{continue;}
            let mut alternatives=Vec::new();
            for variant in variants{
                let term=RuleTerm::Literal(snapback4_core::Value::String(variant.clone()));
                let excluded=facts.iter().any(|(other,positive)|!*positive&&matches!(other,RuleExpr::Exists{table:t,index:i,key:k,equalities:e,..} if t==table&&i==index&&k==key&&e.as_slice()==[(column.clone(),term.clone())]));
                if !excluded{let mut probe=(*fact).clone();if let RuleExpr::Exists{equalities,..}=&mut probe{equalities.push((column.clone(),term));}alternatives.push(probe);}
            }
            derived.push(RuleExpr::Or(alternatives));
        }
    }derived
}
fn positive_probe(rule: &RuleExpr) -> bool {
    match rule {
        RuleExpr::Exists { .. } => true,
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(positive_probe),
        _ => false,
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Origin { read: ReadExpr, gates: Vec<Expr>, path: Vec<String> }
type Locals = BTreeMap<String, Vec<Origin>>;
fn returned(catalog: &Catalog, value: &Expr, gates: &[Expr], locals: &Locals) -> Vec<Origin> {
    let read = match value {
        Expr::Read(read) => catalog.source.read(&read.site).map(|r| r.0).or_else(|| Some(read.clone())),
        Expr::Merge(merge) => catalog.source.read(&merge.site).map(|r| r.0),
        _ => None,
    };
    if let Some(read) = read { return vec![Origin { read, gates: gates.to_vec(), path: Vec::new() }]; }
    match value {
        Expr::Name { name, .. } => locals.get(name).cloned().unwrap_or_default().into_iter().map(|mut origin| { origin.gates.extend_from_slice(gates); origin }).collect(),
        Expr::Member { base, name, .. } => returned(catalog, base, gates, locals).into_iter().filter_map(|mut origin| {
            if origin.path.is_empty() { return Some(origin); }
            if origin.path[0] != *name { return None; }
            origin.path.remove(0); Some(origin)
        }).collect(),
        Expr::Shape { base, .. } | Expr::Assert { value: base, .. } | Expr::ShapeUse { base, .. } => returned(catalog, base, gates, locals),
        Expr::Array { items, .. } => items.iter().flat_map(|v| returned(catalog, v, gates, locals)).collect(),
        Expr::Binary { op, left, right, .. } if op == "+" => returned(catalog, left, gates, locals).into_iter().chain(returned(catalog, right, gates, locals)).collect(),
        Expr::Object { fields, .. } => fields.iter().flat_map(|f| {
            let value = f.value.clone().unwrap_or_else(|| Expr::Name { name: f.name.clone(), site: f.site.clone() });
            returned(catalog, &value, gates, locals).into_iter().map(|mut origin| {
                if !f.spread { origin.path.insert(0, f.name.clone()); }
                origin
            }).collect::<Vec<_>>()
        }).collect(),
        Expr::If { condition, then, otherwise, .. } => {
            let mut yes = gates.to_vec(); yes.push(*condition.clone());
            let mut no = gates.to_vec(); no.push(Expr::Unary { op: "not".into(), value: condition.clone(), site: condition.site().clone() });
            returned(catalog, then, &yes, locals).into_iter().chain(returned(catalog, otherwise, &no, locals)).collect()
        }
        _ => Vec::new(),
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Default)]
struct State { gates: Vec<Expr>, locals: Locals }
#[derive(Default)]
struct Flow { normal: Vec<State>, broken: Vec<State>, continued: Vec<State> }
struct Budget { left: usize, exhausted: bool }
fn gates(values: &mut Vec<Expr>) {
    let unique: BTreeMap<_, _> = values.drain(..).map(|v| (crate::print::expression(&v), v)).collect();
    values.extend(unique.into_values());
}
fn states(values: &mut Vec<State>) {
    for state in values.iter_mut() {
        gates(&mut state.gates);
        for origins in state.locals.values_mut() {
            for origin in origins.iter_mut() { gates(&mut origin.gates); }
            origins.sort_by_cached_key(|o| format!("{o:?}")); origins.dedup();
        }
    }
    values.sort_by_cached_key(|s| format!("{s:?}")); values.dedup();
}
fn mentions(value: &Expr, name: &str) -> bool {
    let mut value = value.clone(); let mut found = false;
    super::intent_walk::expression(&mut value, &mut |e| { if matches!(e, Expr::Name { name: n, .. } if n == name) { found = true; } });
    found
}
fn captured_condition(value:&Expr,locals:&Locals,args:&[ArgDecl])->Expr{
    match value{
        Expr::Binary{op,left,right,site} if op=="and"||op=="or"=>Expr::Binary{op:op.clone(),left:Box::new(captured_condition(left,locals,args)),right:Box::new(captured_condition(right,locals,args)),site:site.clone()},
        Expr::Binary{op,left,right,site} if op=="="=>{
            for (field,chosen) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{
                if let Expr::Member{base,name,..}=field&&let Expr::Name{name:alias,..}=base.as_ref()&&let Some(origins)=locals.get(alias)&&origins.len()==1&&matches!(chosen,Expr::Name{name,..} if name=="viewer"){
                    let mut read=origins[0].read.clone();super::advisory_model::normalize_point(&mut read,args);read.keys.push(KeyPart{column:Some(name.clone()),value:chosen.clone(),site:site.clone()});return Expr::Exists{read,site:site.clone()};
                }
            }value.clone()
        },_=>value.clone(),
    }
}
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for program in catalog.documents.iter().flat_map(|d| &d.programs).filter(|p| p.kind == ProgramKind::Query && !p.native) {
        let body: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
        let mut fuel = Budget { left: 512, exhausted: false };
        inspect(catalog, schema, program, &body, vec![State::default()], true, &mut fuel, &mut notes);
        if fuel.exhausted {
            let mut restricted = BTreeMap::new();
            super::intent_walk::statements(&mut body.clone(), &mut |expr| {
                let table = match expr { Expr::Read(r) | Expr::Exists { read: r, .. } => Some(&r.table), Expr::Merge(m) => Some(&m.table), _ => None };
                if let Some(name) = table && let Some(table) = schema.table(name).filter(|t| !t.rules.read.is_uniformly_readable()) {
                    restricted.insert(name.clone(), table.rules.read.quarry());
                }
            });
            if !restricted.is_empty() {
                notes.push(Diagnostic::new(&program.site, "N_QUERY_FILTERED", format!("query {}: saw caller branches at {}; not proved: source-analysis limit while establishing read authority for {}", program.name, program.site, restricted.iter().map(|(t,r)| format!("{t} (`read <- {r}`)")).collect::<Vec<_>>().join(", ")), "review caller filtering against the named table read rules; this is an advisory analysis limit, not a runtime limit or an authority grant").guide("rules"));
            }
        }
    }
    notes
}
fn inspect(catalog: &Catalog, schema: &Schema, program: &ProgramDecl, body: &[Stmt], entry: Vec<State>, implicit: bool, fuel: &mut Budget, notes: &mut Vec<Diagnostic>) -> Flow {
    let mut flow = Flow { normal: entry, ..Flow::default() };
    for (at, statement) in body.iter().enumerate() {
        let incoming = std::mem::take(&mut flow.normal);
        for mut state in incoming {
            if fuel.left == 0 { fuel.exhausted = true; return flow; } fuel.left -= 1;
            let completes = implicit && at + 1 == body.len();
            match statement {
                Stmt::Return { value, .. } => inspect_result(catalog, schema, program, value, &state, notes),
                Stmt::Expr { value, .. } if completes => inspect_result(catalog, schema, program, value, &state, notes),
                Stmt::Require { condition, .. } => { state.gates.push(captured_condition(condition,&state.locals,&program.args)); flow.normal.push(state); }
                Stmt::If { condition, then_body, else_body, .. } => {
                    let mut no = state.clone();
                    state.gates.push(condition.clone());
                    no.gates.push(Expr::Unary { op: "not".into(), value: Box::new(condition.clone()), site: condition.site().clone() });
                    for branch in [inspect(catalog, schema, program, then_body, vec![state], completes, fuel, notes), inspect(catalog, schema, program, else_body, vec![no], completes, fuel, notes)] {
                        flow.normal.extend(branch.normal); flow.broken.extend(branch.broken); flow.continued.extend(branch.continued);
                    }
                }
                Stmt::Bind { names, value, .. } => {
                    let origins = returned(catalog, value, &state.gates, &state.locals);
                    state.gates.retain(|g| !names.iter().any(|name| mentions(g, name)));
                    for name in names { state.locals.remove(name); }
                    if names.len() == 1 { state.locals.insert(names[0].clone(), origins); }
                    flow.normal.push(state);
                }
                Stmt::For { name, domain, body, .. } => {
                    // A query loop can run zero times, break, continue or return.
                    // Follow aliases to a fixed point across every backedge;
                    // each finite origin retains the gates at its own read.
                    let outer = state.locals.get(name).cloned();
                    let domain_origins = returned(catalog, domain, &state.gates, &state.locals);
                    let restore = |mut s: State| {
                        if let Some(value) = &outer { s.locals.insert(name.clone(), value.clone()); } else { s.locals.remove(name); }
                        s.gates.retain(|g| !mentions(g, name));
                        for origins in s.locals.values_mut() { for origin in origins { origin.gates.retain(|g| !mentions(g, name)); } }
                        s
                    };
                    flow.normal.push(state.clone());
                    if matches!(domain, Expr::Array { items, .. } if items.is_empty()) { continue; }
                    let mut queue = vec![state]; let mut seen = Vec::new();
                    while let Some(mut header) = queue.pop() {
                        let mut normalized = vec![header]; states(&mut normalized); header = normalized.pop().unwrap();
                        if seen.contains(&header) { continue; } seen.push(header.clone());
                        header.locals.insert(name.clone(), domain_origins.clone());
                        let iteration = inspect(catalog, schema, program, body, vec![header], false, fuel, notes);
                        flow.normal.extend(iteration.broken.into_iter().map(&restore));
                        let mut back: Vec<_> = iteration.normal.into_iter().chain(iteration.continued).map(&restore).collect(); states(&mut back);
                        flow.normal.extend(back.clone()); queue.extend(back);
                    }
                }
                Stmt::Break { .. } => flow.broken.push(state),
                Stmt::Continue { .. } => flow.continued.push(state),
                Stmt::Expr { value,.. } => {state.gates.extend(super::advisory_guards::requirements(catalog,value));flow.normal.push(state);}
                Stmt::Emit { .. } => flow.normal.push(state),
                Stmt::As { .. } => { state.gates.clear(); flow.normal.push(state); }
            }
        }
        states(&mut flow.normal); states(&mut flow.broken); states(&mut flow.continued);
    }
    flow
}

fn inspect_result(catalog: &Catalog, schema: &Schema, program: &ProgramDecl, value: &Expr, state: &State, notes: &mut Vec<Diagnostic>) {
    for origin in returned(catalog, value, &state.gates, &state.locals) {
        let mut all = origin.gates; all.extend(state.gates.clone()); gates(&mut all);
        inspect_read(catalog, schema, program, &origin.read, &all, notes);
    }
}

// A positive caller witness implies physical existence. Caller absence does
// not imply raw absence unless the existing visibility proof establishes it.
fn caller_facts(catalog:&Catalog, schema: &Schema, value: &Expr, bind: &impl Fn(&Expr) -> Option<RuleExpr>) -> RuleExpr {
    if super::advisory_guards::raw_monotone(catalog,schema,value,true)
        && let Some(rule) = bind(value) { return rule; }
    match value {
        Expr::Binary { op, left, right, .. } if op == "and" => RuleExpr::And(vec![caller_facts(catalog,schema, left, bind), caller_facts(catalog,schema, right, bind)]),
        Expr::Binary { op, left, right, .. } if op == "or" => RuleExpr::Or(vec![caller_facts(catalog,schema, left, bind), caller_facts(catalog,schema, right, bind)]),
        _ => RuleExpr::Allow,
    }
}

fn inspect_read(catalog: &Catalog, schema: &Schema, program: &ProgramDecl, read: &ReadExpr, gates: &[Expr], notes: &mut Vec<Diagnostic>) {
    let Some(info) = catalog.tables.get(&read.table).filter(|t| t.maintained.is_none() && t.through.is_none()) else { return };
    let Some(table) = schema.table(&read.table).filter(|t| !t.rules.read.is_uniformly_readable() && !matches!(t.rules.read, RuleExpr::Deny)) else { return };
    // Give operation arguments stable symbolic field identities for
    // this proof only. The real schema and authority are untouched.
    let mut context = info.clone();
    for arg in &program.args { context.columns.insert(format!("$queryArg:{}", arg.name), arg.type_.clone()); }
    let bind = |value: &Expr| {
        let mut value = value.clone();
        super::intent_walk::expression(&mut value, &mut |expr| {
            if let Expr::Name { name, site } = expr && program.args.iter().any(|a| a.name == *name) {
                *expr = Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: format!("$queryArg:{name}"), site: site.clone() };
            }
        });
        super::schema::bind_rule(catalog, &context, &RuleDecl { effect: Effect::Read, bindings: Vec::new(), site: value.site().clone(), value }).ok()
    };
    let Some(rule) = info.decl.rules.iter().find(|r| r.effect == Effect::Read) else { return };
    let mut expected = rule.value.clone();
    let pins = super::auth_lints::pins(catalog, &read).unwrap_or_default();
    super::intent_walk::expression(&mut expected, &mut |expr| {
        if let Expr::Member { base, name, .. } = expr && matches!(base.as_ref(), Expr::Focal { .. }) && let Some(value) = pins.get(name) { *expr = value.clone(); }
    });
    let expected=super::advisory_model::child_policy(catalog,&read.table,&expected,&pins);
    let Some(expected) = bind(&expected) else { return };
    let expand = |value: &Expr| super::advisory_model::visible_guard(catalog,&super::advisory_guards::expand(catalog,value).unwrap_or_else(||value.clone()),&program.args,true);
    let mut conditions: Vec<_> = gates.iter().map(|g| caller_facts(catalog,schema, &expand(g), &bind)).collect();
    if let Some(filter) = &read.filter { conditions.push(caller_facts(catalog,schema, &expand(filter), &bind)); }
    if !conditions.iter().any(positive_probe) { return; }
    for key in &read.keys {
        if let Some(column) = &key.column {
            let equality = Expr::Binary { op: "=".into(), left: Box::new(Expr::Member { base: Box::new(Expr::Focal { site: key.site.clone() }), name: column.clone(), site: key.site.clone() }), right: Box::new(key.value.clone()), site: key.site.clone() };
            if let Some(rule) = bind(&equality) { conditions.push(rule); }
        }
    }
    conditions.extend(finite_rosters(schema,&conditions));
    if implies(&RuleExpr::And(conditions), &expected) { return; }
    if notes.iter().any(|n| n.code == "N_QUERY_FILTERED" && n.site == read.site) { return; }
    let site = info.decl.rules.iter().find(|r| r.effect == Effect::Read).map(|r| r.site.to_string()).unwrap_or_default();
    let saw = gates.iter().map(crate::print::expression).collect::<Vec<_>>().join("; ");
    notes.push(Diagnostic::new(&read.site, "N_QUERY_FILTERED", format!("query {}: saw `{saw}`; not proved: branch at {} establishes {} read rule `{}` ({site}); rows may be filtered", program.name, read.site, read.table, table.rules.read.quarry()), "require or filter by the matching table read condition in each branch, or deliberately handle caller-filtered rows; the query never widens table authority. Authorization recipes: guide rule-recipes").guide("rules"));
}
