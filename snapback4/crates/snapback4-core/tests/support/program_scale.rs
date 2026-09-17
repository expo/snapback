use super::*;
#[test]
fn reversed_thousand_programs() {
    use snapback4_core::{Program, ir::{ProgramKind, Stmt, Expr}};
    use std::{hint::black_box, time::Instant};
    let source: Vec<_> = (0..1000).rev().map(|i| { let name = format!("program{i:04}"); (name.clone(), Program { name, kind: ProgramKind::Query, args: SmallMap::new(), body: vec![Stmt::Return(Expr::Literal(snapback4_core::Value::Null))], native: false, read_time_granularity_ms: None }) }).collect();
    let mut small_times = Vec::new(); let mut tree_times = Vec::new();
    for trial in 0..7 { for small in if trial % 2 == 0 { [true, false] } else { [false, true] } {
        let entries = source.clone(); let start = Instant::now();
        if small { let map: SmallMap<_, _> = entries.into_iter().collect(); assert_eq!(map.len(), 1000); black_box(map); small_times.push(start.elapsed().as_secs_f64()*1000.); }
        else { let map: BTreeMap<_, _> = entries.into_iter().collect(); assert_eq!(map.len(), 1000); black_box(map); tree_times.push(start.elapsed().as_secs_f64()*1000.); }
    } }
    small_times.sort_by(f64::total_cmp); tree_times.sort_by(f64::total_cmp);
    println!("programs=1000 reverse small_ms={:.3} btree_ms={:.3} ratio={:.3}", small_times[3], tree_times[3], small_times[3]/tree_times[3]);
}
