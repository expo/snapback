//! Backward value flow for rejected page collectors. This does not grant
//! cursor ownership: it only decides which loop exits can lose returned data.
use crate::ir::*;
use std::collections::BTreeSet;

// A demanded record field stays separate from its unused siblings through
// aliases and assignments. An empty path demands the whole value.
type Names = BTreeSet<(String, Vec<String>)>;
type Paths = BTreeSet<String>;

// @ref LLP 3000.007#19.2 — an auxiliary traversal cannot interrupt the intact returned page; only writes that flow to a result count.
pub(super) fn returned_collectors(program: &Program) -> Paths {
    let mut collectors = Paths::new();
    live_body(&program.body, &program.name, Names::new(), &Names::new(), &Names::new(), &[], &mut collectors);
    collectors
}

fn live_body(body: &[Stmt], prefix: &str, mut live: Names, on_break: &Names, on_continue: &Names, loops: &[String], collectors: &mut Paths) -> (Names, bool) {
    let mut relevant = false;
    for (index, statement) in body.iter().enumerate().rev() {
        let path = format!("{prefix}:{}", index + 1);
        match statement {
            Stmt::Return(value) => {
                live.clear();
                names(value, &mut live);
                relevant = true;
            }
            Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                let demanded = live.iter().filter(|(variable, _)| variable == name).map(|(_, fields)| fields.clone()).collect::<Vec<_>>();
                if !demanded.is_empty() {
                    live.retain(|(variable, _)| variable != name);
                    for fields in demanded { selected_names(value, &fields, &mut live); }
                    collectors.extend(loops.iter().cloned());
                    relevant = true;
                }
            }
            Stmt::Push { target, value } if live.iter().any(|(name, _)| name == target) => {
                names(value, &mut live);
                collectors.extend(loops.iter().cloned());
                relevant = true;
            }
            Stmt::If { condition, then_body, else_body } => {
                let (yes, yes_relevant) = live_body(then_body, &format!("{path}:then"), live.clone(), on_break, on_continue, loops, collectors);
                let (no, no_relevant) = live_body(else_body, &format!("{path}:else"), live, on_break, on_continue, loops, collectors);
                live = yes.union(&no).cloned().collect();
                if yes_relevant || no_relevant { names(condition, &mut live); relevant = true; }
            }
            Stmt::For { binding, domain, body } => {
                let after = live.clone();
                let mut nested = loops.to_vec();
                nested.push(path.clone());
                let mut loop_relevant = false;
                // Include dependencies carried from one iteration to the next.
                // A growing field path widens to the whole variable so even
                // serialized IR that repeatedly follows a field terminates.
                loop {
                    let (mut before, used) = live_body(body, &path, live.clone(), &after, &live, &nested, collectors);
                    before.retain(|(name, _)| name != binding);
                    before.extend(after.iter().cloned());
                    loop_relevant |= used;
                    let old = live.clone();
                    for (name, fields) in before {
                        if live.iter().any(|(variable, path)| variable == &name && path.len() < fields.len()) || fields.is_empty() {
                            live.retain(|(variable, _)| variable != &name);
                            live.insert((name, Vec::new()));
                        } else {
                            live.insert((name, fields));
                        }
                    }
                    if live == old { break; }
                }
                if loop_relevant { domain_names(domain, &mut live); relevant = true; }
            }
            Stmt::Break => { live = on_break.clone(); }
            Stmt::Continue => { live = on_continue.clone(); }
            _ => {}
        }
    }
    (live, relevant)
}

fn domain_names(domain: &LoopDomain, live: &mut Names) {
    match domain {
        LoopDomain::Page(scan) => scan_names(scan, live),
        LoopDomain::DerivedArray { value, .. } => names(value, live),
        LoopDomain::ArgList { name, .. } => { live.insert((name.clone(), Vec::new())); }
        LoopDomain::ExpressionRange { start, end_exclusive } => { names(start, live); names(end_exclusive, live); }
        LoopDomain::Recurse(recurse) => names(&recurse.seed, live),
        LoopDomain::LiteralRange { .. } => {}
    }
}

fn scan_names(scan: &Scan, live: &mut Names) {
    for key in &scan.prefix {
        match key { IndexKeyExpr::Scalar(value) | IndexKeyExpr::WordPrefix(value) => names(value, live) }
    }
    for value in [&scan.after, &scan.before, &scan.filter].into_iter().flatten() { names(value, live); }
    if let Some(range) = &scan.range {
        for value in [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten() { names(value, live); }
    }
    if let Bound::Arg { name, .. } = &scan.take { live.insert((name.clone(), Vec::new())); }
}

fn names(value: &Expr, live: &mut Names) {
    selected_names(value, &[], live);
}

fn selected_names(value: &Expr, selected: &[String], live: &mut Names) {
    match value {
        Expr::Variable(name) => { live.insert((name.clone(), selected.to_vec())); }
        Expr::Field { base, name } => {
            let mut fields = vec![name.clone()];
            fields.extend_from_slice(selected);
            selected_names(base, &fields, live);
        }
        Expr::Unary { value, .. } => names(value, live),
        Expr::Array(values) | Expr::Builtin { args: values, .. } => { for value in values { names(value, live); } }
        Expr::Object(fields) => field_names(fields, selected, live),
        Expr::Shape { base, fields } => { names(base, live); field_names(fields, selected, live); }
        Expr::Binary { left, right, .. } => { names(left, live); names(right, live); }
        Expr::Get(read) | Expr::Exists(read) => { for key in &read.key { names(key, live); } }
        Expr::Scan(scan) => scan_names(scan, live),
        Expr::Merge(merge) => {
            for lane in &merge.lanes {
                let mut local = Names::new();
                scan_names(&lane.scan, &mut local);
                let (mut local, _) = live_body(&lane.setup, "", local, &Names::new(), &Names::new(), &[], &mut Paths::new());
                if let Some(source) = &lane.source { local.retain(|(name, _)| name != &lane.binding); scan_names(source, &mut local); }
                live.extend(local);
            }
        }
        Expr::Block { body, value } => {
            let mut local = Names::new();
            selected_names(value, selected, &mut local);
            let (local, _) = live_body(body, "", local, &Names::new(), &Names::new(), &[], &mut Paths::new());
            live.extend(local);
        }
        Expr::Literal(_) | Expr::Input(_) => {}
    }
}

fn field_names(fields: &std::collections::BTreeMap<String, Expr>, selected: &[String], live: &mut Names) {
    if let Some((name, rest)) = selected.split_first() {
        if let Some(value) = fields.get(name) { selected_names(value, rest, live); }
    } else {
        for value in fields.values() { names(value, live); }
    }
}
