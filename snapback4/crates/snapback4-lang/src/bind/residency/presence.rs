//! Flow of server presence through the bound mutation, including loop back edges.
use snapback4_core::ir::{self, Expr, LoopDomain, Program, Stmt};
use snapback4_core::schema::{Execution, ResidencySite, SiteClass};
use snapback4_core::engine::prediction::{total_body, total_expr};
use std::collections::{BTreeMap, BTreeSet};

use super::super::program::setup::{Owner, Ownership, runtime_path};

type Origins = BTreeSet<String>;
type Env = BTreeMap<String, Origins>;
const REWRITE: &str = "decide only the emit with presence; read it on the server in a service mutation for anything else";

// @ref LLP 3000.007#19.1 — only presence flows ending in effects preserve prediction; every other sink stays server-only.
pub(super) fn inspect(program: &Program, fact: &mut Execution, ownership: &Ownership) {
    let mut flow = Flow { seen: false, sites: BTreeMap::new(), effect_control: Origins::new(), escaped: Env::new(), ownership, program: &program.name, guards: BTreeSet::new() };
    flow.body(&program.body, &mut Env::new(), &Origins::new(), "", false);
    fact.connected_effects_only = flow.seen && flow.sites.is_empty();
    if fact.connected_effects_only { fact.prediction_guards = flow.guards.into_iter().collect(); }
    fact.sites.extend(flow.sites.into_values());
}

struct Flow<'a> {
    seen: bool,
    sites: BTreeMap<(String, String, String), ResidencySite>,
    effect_control: Origins,
    escaped: Env,
    ownership: &'a Ownership,
    program: &'a str,
    guards: BTreeSet<String>,
}

impl Flow<'_> {
    fn reject(&mut self, origins: &Origins, usage: &str, site: &str) {
        let site = if site.starts_with(|c: char| c.is_ascii_digit()) { format!("programs.{}.body.{site}", self.program) } else { site.to_owned() };
        for origin in origins {
            self.sites.entry((site.clone(), usage.into(), origin.clone())).or_insert_with(|| ResidencySite {
                site: site.clone(), table: "connected".into(), index: "principal".into(), kind: "presence".into(), class: SiteClass::Server,
                reason: format!("{origin} decides {usage} at {site}"), rewrite: REWRITE.into(),
            });
        }
    }

    fn sink(&mut self, value: &Expr, env: &mut Env, control: &Origins, usage: &str, site: &str) -> Origins {
        let mut origins = self.expr(value, env, control, site);
        origins.extend(control.iter().cloned());
        if usage.starts_with("a write") || usage.starts_with("a require") || usage == "a check/refusal" { origins.extend(self.effect_control.iter().cloned()); }
        self.reject(&origins, usage, site);
        origins
    }

    // Assignments replace a slot on this path; branches join their slots. A
    // loop joins its entry and back edge until stable, so a later assignment
    // cannot hide a presence use in the next iteration. Binder slots are unique.
    fn body(&mut self, body: &[Stmt], env: &mut Env, control: &Origins, path: &str, block_value: bool) -> Origins {
        let mut returned = Origins::new();
        for (n, stmt) in body.iter().enumerate() {
            let site = if path.is_empty() { n.to_string() } else { format!("{path}.{n}") };
            let owner = self.ownership.get(&site).map(|owner| owner.kind);
            let block_value = block_value || owner.is_some();
            let before_effect = self.effect_control.clone();
            let empty = Origins::new();
            let control = if owner == Some(Owner::Payload) {
                self.effect_control.extend(control.iter().cloned());
                &empty
            } else { control };
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    let mut origins = self.expr(value, env, control, &site);
                    // A presence-selected variable-width value could make later
                    // clones cost more on the server even after both arms paid.
                    if block_value && !fixed_scalar(value) { self.reject(control, "a variable-size conditional value", &site); }
                    origins.extend(control.iter().cloned());
                    env.insert(name.clone(), origins);
                }
                Stmt::Push { target, value } => {
                    let mut origins = self.expr(value, env, control, &site);
                    origins.extend(control.iter().cloned());
                    env.entry(target.clone()).or_default().extend(origins);
                }
                Stmt::If { condition, then_body, else_body } => {
                    let mut branch = self.expr(condition, env, control, &site);
                    if !branch.is_empty() {
                        if !total_body(then_body) || !total_body(else_body) { self.reject(&branch, "a fallible or variable-cost arm", &site); }
                        let runtime = runtime_path(self.program, &site);
                        if !runtime.is_empty() { self.guards.insert(runtime); }
                        else { self.reject(&branch, "an arm without a prediction charge plan", &site); }
                    }
                    branch.extend(control.iter().cloned());
                    // Owned short-circuit/coalesce setup computes values;
                    // the remaining source statement arms must
                    // contain only emits. Sinks inside either form still reject below.
                    if !block_value && let Some(usage) = non_effect(then_body, &format!("{site}.then"), self.ownership).or_else(|| non_effect(else_body, &format!("{site}.else"), self.ownership)) { self.reject(&branch, usage, &site); }
                    let mut then_env = env.clone();
                    returned.extend(self.body(then_body, &mut then_env, &branch, &format!("{site}.then"), block_value));
                    let mut else_env = env.clone();
                    returned.extend(self.body(else_body, &mut else_env, &branch, &format!("{site}.else"), block_value));
                    *env = join(then_env, &else_env);
                }
                Stmt::For { binding, domain, body } => {
                    let origins = match domain {
                        LoopDomain::Page(scan) => self.scan(scan, env, control),
                        LoopDomain::ExpressionRange { start, end_exclusive } => {
                            let mut origins = self.expr(start, env, control, &site);
                            origins.extend(self.expr(end_exclusive, env, control, &site)); origins
                        }
                        LoopDomain::DerivedArray { value, .. } => self.expr(value, env, control, &site),
                        LoopDomain::ArgList { name, .. } => env.get(name).cloned().unwrap_or_default(),
                        LoopDomain::Recurse(recurse) => self.sink(&recurse.seed, env, control, "a read key", &recurse.site),
                        LoopDomain::LiteralRange { .. } => Origins::new(),
                    };
                    let mut branch = control.clone(); branch.extend(origins);
                    self.reject(&branch, "a loop domain", &site);
                    loop {
                        let before = env.clone();
                        let mut iteration = before.clone();
                        iteration.insert(binding.clone(), branch.clone());
                        returned.extend(self.body(body, &mut iteration, &branch, &format!("{site}.loop"), block_value));
                        *env = join(before.clone(), &iteration);
                        if *env == before { break; }
                    }
                }
                Stmt::Require { condition, code, site: location } => {
                    self.sink(condition, env, control, &format!("a require {code}"), location.as_deref().unwrap_or(&site));
                }
                Stmt::Check { condition, current } => {
                    self.sink(condition, env, control, "a check/refusal", &site);
                    self.read(current, env, control, "a read key");
                }
                Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => {
                    let origins = self.sink(row, env, control, "a write row", &format!("{site} insert {table}"));
                    if let Stmt::InsertIfAbsent { result, .. } = stmt { env.insert(result.clone(), origins); }
                }
                Stmt::Update { table, key, patch } | Stmt::Upsert { table, key, row: patch } => {
                    self.sink(key, env, control, "a write key", &format!("{site} write {table}"));
                    self.sink(patch, env, control, "a write patch", &format!("{site} write {table}"));
                }
                Stmt::WriteTarget { target, patch, condition, result, .. } => {
                    let mut origins = self.read(target, env, control, "a write key");
                    origins.extend(self.sink(patch, env, control, "a write patch", &target.site));
                    if let Some(condition) = condition {
                        let mut local = env.clone();
                        local.insert(condition.old.clone(), origins.clone());
                        origins.extend(self.body(&condition.setup, &mut local, control, &format!("{site}.condition"), true));
                        origins.extend(self.sink(&condition.value, &mut local, control, "a write condition", &target.site));
                    }
                    if let Some(result) = result { env.insert(result.clone(), origins); }
                }
                Stmt::Delete { table, key } => { self.sink(key, env, control, "a write key", &format!("{site} delete {table}")); }
                Stmt::Return(value) => {
                    let mut origins = self.expr(value, env, control, &site);
                    origins.extend(control.iter().cloned());
                    if !block_value { self.reject(&origins, "the returned value", &site); }
                    returned.extend(origins);
                }
                Stmt::Emit { payload, .. } => {
                    // A guard on emit need not taint a constant read key inside its
                    // payload. It still controls any write/refusal a helper performs.
                    let before = self.effect_control.clone();
                    self.effect_control.extend(control.iter().cloned());
                    self.expr(payload, env, &Origins::new(), &site);
                    self.effect_control = before;
                }
                Stmt::Break => self.reject(control, "break", &site),
                Stmt::Continue => self.reject(control, "continue", &site),
            }
            self.effect_control = before_effect;
            // An exit skips later overwrites. Keep every possible exit image
            // conservatively, including a continue's back edge and a break's
            // loop exit; joining only the ordinary branch tail loses these.
            if matches!(stmt, Stmt::Return(_) | Stmt::Break | Stmt::Continue) {
                self.escaped = join(std::mem::take(&mut self.escaped), env);
                break;
            }
            *env = join(std::mem::take(env), &self.escaped);
        }
        returned
    }

    fn expr(&mut self, value: &Expr, env: &mut Env, control: &Origins, site: &str) -> Origins {
        if !total_expr(value) {
            let mut controlled = control.clone();
            controlled.extend(self.effect_control.iter().cloned());
            self.reject(&controlled, "a fallible evaluation", site);
        }
        match value {
            Expr::Variable(name) => env.get(name).cloned().unwrap_or_default(),
            Expr::Literal(_) | Expr::Input(_) => Origins::new(),
            Expr::Builtin { builtin, args } => {
                let mut origins = Origins::new();
                for arg in args { origins.extend(self.expr(arg, env, control, site)); }
                if *builtin == ir::Builtin::Connected {
                    self.seen = true;
                    self.reject(&origins, "a presence read key", site);
                    origins.insert(format!("connected[{}]", args.first().map(label).unwrap_or_else(|| "principal".into())));
                }
                else {
                    let usage = match builtin { ir::Builtin::Divmod { .. } => "fallible division", ir::Builtin::Slice => "a variable-size slice", _ => "a fallible or variable-cost builtin" };
                    self.reject(&origins, usage, site);
                }
                origins
            }
            Expr::Field { base, .. } => self.expr(base, env, control, site),
            Expr::Unary { op, value: base } => {
                let origins = self.expr(base, env, control, site);
                if *op == ir::UnaryOp::Neg { self.reject(&origins, "fallible negation", site); }
                origins
            }
            Expr::Array(values) => {
                let mut origins = Origins::new();
                for value in values { origins.extend(self.expr(value, env, control, site)); } origins
            }
            Expr::Object(fields) => {
                let mut origins = Origins::new();
                for value in fields.values() { origins.extend(self.expr(value, env, control, site)); } origins
            }
            Expr::Shape { base, fields } => {
                let mut origins = self.expr(base, env, control, site);
                for value in fields.values() { origins.extend(self.expr(value, env, control, site)); } origins
            }
            Expr::Binary { op, left, right } => {
                let mut origins = self.expr(left, env, control, site);
                if matches!(op, ir::BinaryOp::And | ir::BinaryOp::Or) { self.reject(&origins, "short-circuit evaluation without a prediction charge plan", site); }
                origins.extend(self.expr(right, env, control, site));
                if matches!(op, ir::BinaryOp::Add | ir::BinaryOp::Sub | ir::BinaryOp::Mul) { self.reject(&origins, "fallible arithmetic", site); }
                origins
            }
            Expr::Get(read) | Expr::Exists(read) => self.read(read, env, control, "a read key"),
            Expr::Block { body, value } => {
                let mut local = env.clone();
                let mut origins = self.body(body, &mut local, control, &format!("{site}.value"), true);
                origins.extend(self.expr(value, &mut local, control, site));
                // Blocks can update a caller slot; join conservatively across early returns.
                for (name, before) in env.iter_mut() { if let Some(after) = local.get(name) { before.extend(after.iter().cloned()); } }
                origins
            }
            Expr::Scan(scan) => self.scan(scan, env, control),
            Expr::Merge(merge) => {
                let mut origins = Origins::new();
                for lane in &merge.lanes {
                    let mut local = env.clone();
                    if let Some(source) = &lane.source {
                        let source = self.scan(source, &mut local, control);
                        local.insert(lane.binding.clone(), source.clone()); origins.extend(source);
                    }
                    origins.extend(self.body(&lane.setup, &mut local, control, &format!("{}.lane", merge.site), true));
                    origins.extend(self.scan(&lane.scan, &mut local, control));
                }
                origins
            }
        }
    }

    fn read(&mut self, read: &ir::Read, env: &mut Env, control: &Origins, usage: &str) -> Origins {
        let mut origins = Origins::new();
        for key in &read.key { origins.extend(self.sink(key, env, control, usage, &read.site)); }
        origins
    }

    fn scan(&mut self, scan: &ir::Scan, env: &mut Env, control: &Origins) -> Origins {
        let mut origins = Origins::new();
        for key in &scan.prefix {
            let (ir::IndexKeyExpr::Scalar(value) | ir::IndexKeyExpr::WordPrefix(value)) = key;
            origins.extend(self.sink(value, env, control, "a read key", &scan.site));
        }
        for value in [&scan.after, &scan.before].into_iter().flatten() { origins.extend(self.sink(value, env, control, "a read cursor", &scan.site)); }
        if let Some(range) = &scan.range {
            for value in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { origins.extend(self.sink(value, env, control, "a read key", &scan.site)); }
        }
        if let Some(filter) = &scan.filter { origins.extend(self.sink(filter, env, control, "a read condition", &scan.site)); }
        if let ir::Bound::Arg { name, .. } = &scan.take {
            let bound = env.get(name).cloned().unwrap_or_default();
            self.reject(&bound, "a read bound", &scan.site); origins.extend(bound);
        }
        origins
    }
}

fn fixed_scalar(value: &Expr) -> bool {
    match value {
        Expr::Literal(snapback4_core::Value::Int(_) | snapback4_core::Value::Bool(_) | snapback4_core::Value::Null) => true,
        Expr::Builtin { builtin: ir::Builtin::Connected, .. } | Expr::Unary { op: ir::UnaryOp::Not, .. } => true,
        Expr::Binary { op, .. } => matches!(op, ir::BinaryOp::Eq | ir::BinaryOp::Ne | ir::BinaryOp::Lt | ir::BinaryOp::Lte | ir::BinaryOp::Gt | ir::BinaryOp::Gte | ir::BinaryOp::And | ir::BinaryOp::Or),
        _ => false,
    }
}

fn join(mut a: Env, b: &Env) -> Env {
    for (name, origins) in b { a.entry(name.clone()).or_default().extend(origins.iter().cloned()); }
    a
}

fn non_effect(body: &[Stmt], path: &str, ownership: &Ownership) -> Option<&'static str> {
    let mut assignment = None;
    for (index, stmt) in body.iter().enumerate() {
        let site = format!("{path}.{index}");
        if ownership.contains_key(&site) { continue; }
        let usage = match stmt {
            Stmt::Emit { .. } => None,
            Stmt::If { then_body, else_body, .. } => non_effect(then_body, &format!("{site}.then"), ownership).or_else(|| non_effect(else_body, &format!("{site}.else"), ownership)),
            Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } => Some("a write"),
            Stmt::Break => Some("break"),
            Stmt::Continue => Some("continue"),
            Stmt::Return(_) => Some("the returned value"),
            Stmt::Require { .. } | Stmt::Check { .. } => Some("a require/check refusal"),
            Stmt::For { .. } => Some("a loop"),
            Stmt::Const { .. } | Stmt::Let { .. } | Stmt::Assign { .. } | Stmt::Push { .. } => { assignment = Some("an assignment"); None }
        };
        if usage.is_some() { return usage; }
    }
    assignment
}

fn label(value: &Expr) -> String {
    match value {
        Expr::Variable(name) => if let Some(name) = name.strip_prefix('$') { name.trim_end_matches(|c: char| c.is_ascii_digit()).into() } else { name.clone() },
        Expr::Input(ir::Input::Viewer) => "viewer".into(),
        Expr::Field { base, name } => format!("{}.{name}", label(base)),
        _ => "principal expression".into(),
    }
}
