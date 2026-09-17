use super::*;
use crate::ir::{BinaryOp, Builtin, LoopDomain, UnaryOp};
use std::time::{Duration, Instant};

#[path = "setup_reference.rs"]
mod reference;

fn family(n: usize, shape: &str) -> Vec<Stmt> {
    let mut body = vec![Stmt::Let { name: "a0".into(), value: Expr::Binary { op: BinaryOp::Gt, left: Box::new(Expr::Builtin { builtin: Builtin::Connected, args: vec![Expr::Variable("p".into())] }), right: Box::new(Expr::Literal(Value::Int(0))) } }];
    for i in 1..=n { body.push(Stmt::Let { name: format!("a{i}"), value: Expr::Variable(format!("a{}", i - 1)) }); }
    let emit = || Stmt::Emit { effect: "notify".into(), payload: Expr::Literal(Value::Null) };
    let guard = |then_body| Stmt::If { condition: Expr::Variable("flag".into()), then_body, else_body: vec![] };
    let mut guards = Vec::new();
    for _ in 0..n { guards.push(guard(vec![emit()])); }
    if shape == "nested" { for _ in 0..n / 10 { guards = vec![guard(guards)]; } }
    body.extend(guards);
    body.push(Stmt::If { condition: Expr::Unary { op: UnaryOp::Not, value: Box::new(Expr::Variable(format!("a{n}"))) }, then_body: vec![emit()], else_body: vec![] });
    if shape == "loop" { vec![Stmt::For { binding: "i".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 1 }, body }] } else { body }
}

fn metadata(body: &[Stmt], setups: &mut Setups, guards: &mut BTreeMap<String, Guard>) {
    for stmt in body {
        match stmt {
            Stmt::If { then_body, else_body, .. } => {
                let statement = stmt as *const Stmt as usize;
                let site = statement.to_string();
                setups.guards.insert(statement, site.clone());
                guards.insert(site, Guard { yes: true, emit_yes: true, ..Default::default() });
                metadata(then_body, setups, guards);
                metadata(else_body, setups, guards);
            }
            Stmt::For { body, .. } => metadata(body, setups, guards),
            _ => {}
        }
    }
}

fn benchmark(shape: &str) {
    // Time the server-only pass itself: the unchanged metered proof planner
    // exceeds the ordinary heap ceiling before N=4000. No ceiling is raised.
    let n = std::env::var("W15A_SETUP_N").map(|v| v.parse().unwrap()).unwrap_or(4000);
    let budget = std::env::var("W15A_SETUP_BUDGET_MS").map(|v| v.parse().unwrap()).unwrap_or(5000);
    let body = family(n, shape);
    let mut setups = Setups::default();
    let mut guards = BTreeMap::new();
    metadata(&body, &mut setups, &mut guards);
    let start = Instant::now();
    needed_setups(&body, &mut Default::default(), &guards, &mut setups);
    mark_bindings(&setups, &mut guards);
    let elapsed = start.elapsed();
    println!("w15a5 setup {shape} N={n}: {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    assert_eq!(setups.inputs.len(), n + 1, "retain every live alias definition");
    assert_eq!(setups.roots.len(), 1, "the final qualifying guard reaches its alias");
    let mut current = setups.roots[0];
    for _ in 0..n { assert_eq!(setups.inputs[&current].len(), 1); current = setups.inputs[&current][0]; }
    assert!(setups.inputs[&current].is_empty(), "the chain reaches the connected read");
    assert!(elapsed < Duration::from_millis(budget), "{shape} setup discovery took {elapsed:?}");
}

#[test]
fn w15a5_setup_live_aliases_sibling_guards() { benchmark("siblings"); }

#[test]
fn w15a5_setup_live_aliases_inside_loop() { benchmark("loop"); }

#[test]
fn w15a5_setup_live_aliases_nested_guards() {
    // N/10 nested IR arms need stack headroom even though discovery work is bounded.
    std::thread::Builder::new().stack_size(32 << 20).spawn(|| benchmark("nested")).unwrap().join().unwrap();
}

fn assignments_benchmark(repeated: bool) {
    let n = std::env::var("W15A_SETUP_N").map(|v| v.parse().unwrap()).unwrap_or(4000);
    let depth = std::env::var("W15A_SETUP_D").map(|v| v.parse().unwrap()).unwrap_or(400);
    let budget = std::env::var("W15A_SETUP_BUDGET_MS").map(|v| v.parse().unwrap()).unwrap_or(5000);
    let mut body = family(1, "siblings");
    body.remove(2);
    let mut nested = (0..n).map(|i| Stmt::Assign {
        name: if repeated { "independent".into() } else { format!("independent{i}") }, value: Expr::Literal(Value::Bool(true)),
    }).collect();
    for _ in 0..depth { nested = vec![Stmt::If { condition: Expr::Variable("flag".into()), then_body: nested, else_body: vec![] }]; }
    body.splice(2..2, nested);
    let mut setups = Setups::default();
    let mut guards = BTreeMap::new();
    metadata(&body, &mut setups, &mut guards);
    fn independent(body: &[Stmt], setups: &mut Setups) {
        for stmt in body {
            match stmt {
                Stmt::Assign { .. } => { setups.independent.insert(stmt as *const Stmt as usize); }
                Stmt::If { then_body, .. } => independent(then_body, setups),
                _ => {}
            }
        }
    }
    independent(&body, &mut setups);
    let start = Instant::now();
    needed_setups(&body, &mut Default::default(), &guards, &mut setups);
    mark_bindings(&setups, &mut guards);
    let elapsed = start.elapsed();
    println!("w15a6 setup repeated={repeated} D={depth} N={n}: {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    assert_eq!(setups.inputs.len(), 2);
    assert_eq!(setups.roots, [body[1..].as_ptr() as usize]);
    assert_eq!(setups.inputs[&setups.roots[0]], [body.as_ptr() as usize]);
    assert!(setups.inputs[&(body.as_ptr() as usize)].is_empty(), "retain the connected read through independent assignments");
    assert!(elapsed < Duration::from_millis(budget), "assignment setup discovery took {elapsed:?}");
}

#[test]
fn w15a6_setup_nested_assignments() {
    std::thread::Builder::new().stack_size(32 << 20).spawn(|| assignments_benchmark(false)).unwrap().join().unwrap();
}

#[test]
fn w15a6_setup_nested_reassignment() {
    std::thread::Builder::new().stack_size(32 << 20).spawn(|| assignments_benchmark(true)).unwrap().join().unwrap();
}

// Round 4 (GPT, Medium): a balanced tree of independent arms with a distinct assignment
// at each of N = 2^h leaves re-merges N/2 names at every level — Θ(S log S) map and set
// operations, not linear. That bound is accepted (LLP 3000.007 §21.8 L21). This is a
// shape-and-timeout regression: it builds the shape, checks the graph facts its siblings
// check and holds the walk to the same 5 s budget. It is not a complexity proof — a
// quadratic merge would still fit the budget at the default 4,096 leaves.
fn balanced(levels: u32, next: &mut usize) -> Vec<Stmt> {
    if levels == 0 {
        *next += 1;
        return vec![Stmt::Assign { name: format!("independent{}", *next), value: Expr::Literal(Value::Bool(true)) }];
    }
    vec![Stmt::If { condition: Expr::Variable("flag".into()), then_body: balanced(levels - 1, next), else_body: balanced(levels - 1, next) }]
}

fn balanced_benchmark() {
    let levels = std::env::var("W15A_SETUP_LEVELS").map(|v| v.parse().unwrap()).unwrap_or(12);
    let budget = std::env::var("W15A_SETUP_BUDGET_MS").map(|v| v.parse().unwrap()).unwrap_or(5000);
    let mut body = family(1, "siblings");
    body.remove(2);
    let mut leaves = 0;
    body.splice(2..2, balanced(levels, &mut leaves));
    let mut setups = Setups::default();
    let mut guards = BTreeMap::new();
    metadata(&body, &mut setups, &mut guards);
    fn independent(body: &[Stmt], setups: &mut Setups) {
        for stmt in body {
            match stmt {
                Stmt::Assign { .. } => { setups.independent.insert(stmt as *const Stmt as usize); }
                Stmt::If { then_body, else_body, .. } => { independent(then_body, setups); independent(else_body, setups); }
                _ => {}
            }
        }
    }
    independent(&body, &mut setups);
    let start = Instant::now();
    needed_setups(&body, &mut Default::default(), &guards, &mut setups);
    mark_bindings(&setups, &mut guards);
    let elapsed = start.elapsed();
    println!("w15a7 setup balanced levels={levels} leaves={leaves}: {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    assert_eq!(leaves, 1usize << levels);
    assert_eq!(setups.inputs.len(), 2);
    assert_eq!(setups.roots, [body[1..].as_ptr() as usize]);
    assert_eq!(setups.inputs[&setups.roots[0]], [body.as_ptr() as usize]);
    assert!(setups.inputs[&(body.as_ptr() as usize)].is_empty(), "retain the connected read through the independent tree");
    assert!(elapsed < Duration::from_millis(budget), "balanced setup discovery took {elapsed:?}");
}

#[test]
fn w15a7_setup_balanced_independent_tree_is_s_log_s() {
    std::thread::Builder::new().stack_size(32 << 20).spawn(balanced_benchmark).unwrap().join().unwrap();
}
