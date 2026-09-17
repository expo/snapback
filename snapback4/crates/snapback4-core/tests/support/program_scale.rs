use super::*;
#[test]
fn reversed_thousand_programs() {
    use snapback4_core::{Program, ir::{ProgramKind, Stmt, Expr}};
    use std::{hint::black_box, time::Instant};
    let source: Vec<_> = (0..1000).rev().map(|i| { let name = format!("program{i:04}"); (name.clone(), Program { name, kind: ProgramKind::Query, args: SmallMap::new(), body: vec![Stmt::Return(Expr::Literal(snapback4_core::Value::Null))], native: false, read_time_granularity_ms: None }) }).collect();
    let mut small_times = Vec::new(); let mut tree_times = Vec::new();
    for trial in 0..7 { for small in if trial % 2 == 0 { [true, false] } else { [false, true] } {
        let entries = source.clone(); let start = Instant::now();
        if small { let map = snapback4_core::ir::program_map(entries.into_iter().map(|(_, program)| program).collect()); assert_eq!(map.len(), 1000); black_box(map); small_times.push(start.elapsed().as_secs_f64()*1000.); }
        else { let map: BTreeMap<_, _> = entries.into_iter().collect(); assert_eq!(map.len(), 1000); black_box(map); tree_times.push(start.elapsed().as_secs_f64()*1000.); }
    } }
    small_times.sort_by(f64::total_cmp); tree_times.sort_by(f64::total_cmp);
    println!("programs=1000 reverse small_ms={:.3} btree_ms={:.3} ratio={:.3}", small_times[3], tree_times[3], small_times[3]/tree_times[3]);
}

#[test]
fn installed_program_order_and_duplicate_identity_match_btree() {
    use snapback4_core::{ir::program_map, Program};
    let program = |name: &str, n| Program { name: name.into(), kind: snapback4_core::ir::ProgramKind::Query, args: SmallMap::new(), body: vec![snapback4_core::ir::Stmt::Return(snapback4_core::ir::Expr::Literal(snapback4_core::Value::Int(n)))], native: false, read_time_granularity_ms: None };
    let input = vec![program("z", 1), program("a", 2), program("z", 3)];
    let tree: BTreeMap<_, _> = input.iter().cloned().map(|p| (p.name.clone(), p)).collect();
    let small = program_map(input);
    assert_eq!(serde_json::to_vec(&small).unwrap(), serde_json::to_vec(&tree).unwrap());
    assert_eq!(small["z"], program("z", 3));
}
