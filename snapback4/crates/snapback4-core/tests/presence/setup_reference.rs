//! The e0c6f4308b discovery walk, retained only as a mark-equivalence oracle.
use super::*;

#[test]
fn w15a6_setup_marks_match_eager_walk() {
    // Reused names, sibling alternatives, nested loops, pushes, independent
    // definitions and lowered $bool arms all share the same statement IDs.
    fn body(seed: &mut u64, depth: usize) -> Vec<Stmt> {
        fn next(seed: &mut u64) -> usize { *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1); (*seed >> 32) as usize }
        let mut out = Vec::new();
        for _ in 0..8 {
            let name = format!("v{}", next(seed) % 4);
            let value = Expr::Variable(format!("v{}", next(seed) % 4));
            let statement = match next(seed) % if depth > 0 { 7 } else { 3 } {
                0 => Stmt::Let { name, value },
                1 => Stmt::Assign { name, value: Expr::Literal(Value::Bool(true)) },
                2 => Stmt::Push { target: name, value },
                3 => Stmt::For { binding: name, domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 1 }, body: body(seed, depth - 1) },
                4 => Stmt::If { condition: value, then_body: body(seed, depth - 1), else_body: body(seed, depth - 1) },
                _ => {
                    let target = format!("$bool{}", next(seed) % 3);
                    out.push(Stmt::Let { name: target.clone(), value });
                    let mut arm = body(seed, depth - 1);
                    arm.push(Stmt::Assign { name: target.clone(), value: Expr::Variable(name) });
                    let (then_body, else_body) = if next(seed) % 2 == 0 { (arm, vec![]) } else { (vec![], arm) };
                    Stmt::If { condition: Expr::Variable(target), then_body, else_body }
                }
            };
            out.push(statement);
        }
        out
    }
    fn independent(body: &[Stmt], setups: &mut Setups, guards: &mut BTreeMap<String, Guard>) {
        for stmt in body {
            match stmt {
                Stmt::Assign { value: Expr::Literal(_), .. } => { setups.independent.insert(stmt as *const Stmt as usize); }
                Stmt::If { condition, then_body, else_body } => {
                    guards.get_mut(&setups.guards[&(stmt as *const Stmt as usize)]).unwrap().is_setup = short_target(condition, then_body, else_body).is_some();
                    independent(then_body, setups, guards);
                    independent(else_body, setups, guards);
                }
                Stmt::For { body, .. } => independent(body, setups, guards),
                _ => {}
            }
        }
    }
    for seed in 0..128 {
        let body = body(&mut (seed + 1), 3);
        let (mut actual, mut expected) = (Setups::default(), Setups::default());
        let (mut actual_guards, mut expected_guards) = (BTreeMap::new(), BTreeMap::new());
        for (setups, guards) in [(&mut actual, &mut actual_guards), (&mut expected, &mut expected_guards)] {
            metadata(&body, setups, guards);
            independent(&body, setups, guards);
        }
        let mut assignments = EagerAssignments::default();
        assignments.collect(&body);
        eager_discover_setups(&body, &mut EagerBindings::default(), &expected_guards, &mut expected, &assignments);
        needed_setups(&body, &mut Bindings::default(), &actual_guards, &mut actual);
        assert_eq!(actual.roots, expected.roots, "seed {seed}: roots");
        assert_eq!(actual.inputs, expected.inputs, "seed {seed}: definition edges");
        mark_bindings(&actual, &mut actual_guards);
        mark_bindings(&expected, &mut expected_guards);
        for (site, guard) in actual_guards { assert_eq!(guard.setup, expected_guards[&site].setup, "seed {seed}: {site}"); }
    }
}

#[derive(Default)]
struct EagerBindings<'a> {
    values: HashMap<&'a str, usize>,
    undo: Vec<(&'a str, Option<usize>)>,
}

impl<'a> EagerBindings<'a> {
    fn get(&self, name: &str) -> Option<&usize> { self.values.get(name) }
    fn set(&mut self, name: &'a str, value: Option<usize>) {
        let old = self.values.get(name).copied();
        if old == value { return; }
        self.undo.push((name, old));
        if let Some(value) = value { self.values.insert(name, value); } else { self.values.remove(name); }
    }
    fn restore(&mut self, mark: usize) {
        while self.undo.len() > mark {
            let (name, old) = self.undo.pop().unwrap();
            if let Some(old) = old { self.values.insert(name, old); } else { self.values.remove(name); }
        }
    }
}

// Each assignment occurs once in this flat list. A statement's summary is
// a slice, so nested statements share their summaries without copying names
// or repeatedly searching a subtree for every live binding.
#[derive(Default)]
struct EagerAssignments<'a> {
    names: Vec<&'a str>,
    ranges: HashMap<usize, std::ops::Range<usize>>,
}

impl<'a> EagerAssignments<'a> {
    fn collect(&mut self, body: &'a [Stmt]) {
        for stmt in body {
            let start = self.names.len();
            match stmt {
                Stmt::Let { name, .. } | Stmt::Assign { name, .. } | Stmt::Const { name, .. } | Stmt::Push { target: name, .. } => self.names.push(name),
                Stmt::If { then_body, else_body, .. } => { self.collect(then_body); self.collect(else_body); }
                Stmt::For { body, .. } => self.collect(body),
                _ => {}
            }
            self.ranges.insert(stmt as *const Stmt as usize, start..self.names.len());
        }
    }
    fn forget(&self, statement: usize, bindings: &mut EagerBindings<'a>) {
        for &name in &self.names[self.ranges[&statement].clone()] { bindings.set(name, None); }
    }
}

fn eager_mark_inputs(expr: &Expr, bindings: &EagerBindings<'_>, inputs: &mut Vec<usize>) {
    match expr {
        Expr::Variable(name) => { if let Some(binding) = bindings.get(name.as_str()) { inputs.push(*binding); } }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => eager_mark_inputs(base, bindings, inputs),
        Expr::Binary { left, right, .. } => { eager_mark_inputs(left, bindings, inputs); eager_mark_inputs(right, bindings, inputs); }
        Expr::Builtin { args, .. } => { for arg in args { eager_mark_inputs(arg, bindings, inputs); } }
        _ => {}
    }
}

fn eager_discover_setups<'a>(body: &'a [Stmt], bindings: &mut EagerBindings<'a>, guards: &BTreeMap<String, Guard>, setups: &mut Setups, assignments: &EagerAssignments<'a>) {
    for stmt in body {
        let statement = stmt as *const Stmt as usize;
        match stmt {
            Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Const { name, value } => {
                if setups.independent.contains(&statement) { bindings.set(name, None); }
                else {
                    let mut inputs = Vec::new();
                    eager_mark_inputs(value, bindings, &mut inputs);
                    setups.inputs.insert(statement, inputs);
                    bindings.set(name, Some(statement));
                }
            }
            Stmt::If { condition, then_body, else_body } => {
                let guard = &guards[&setups.guards[&statement]];
                if !guard.is_setup && ((guard.yes && guard.emit_yes) || (guard.no && guard.emit_no)) {
                    eager_mark_inputs(condition, bindings, &mut setups.roots);
                }
                let target = short_target(condition, then_body, else_body);
                let mut inputs = Vec::new();
                if target.is_some() { eager_mark_inputs(condition, bindings, &mut inputs); }
                let mark = bindings.undo.len();
                eager_discover_setups(then_body, bindings, guards, setups, assignments);
                if else_body.is_empty() {
                    if let Some(binding) = target.and_then(|name| bindings.get(name)) { inputs.push(*binding); }
                }
                bindings.restore(mark);
                eager_discover_setups(else_body, bindings, guards, setups, assignments);
                if !else_body.is_empty() {
                    if let Some(binding) = target.and_then(|name| bindings.get(name)) { inputs.push(*binding); }
                }
                bindings.restore(mark);
                assignments.forget(statement, bindings);
                if let Some(name) = target {
                    if inputs.is_empty() { bindings.set(name, None); }
                    else { setups.inputs.insert(statement, inputs); bindings.set(name, Some(statement)); }
                }
            }
            Stmt::For { binding, body, .. } => {
                assignments.forget(statement, bindings);
                bindings.set(binding, None);
                eager_discover_setups(body, bindings, guards, setups, assignments);
                assignments.forget(statement, bindings);
            }
            Stmt::Push { target, .. } => bindings.set(target, None),
            _ => {}
        }
    }
}
