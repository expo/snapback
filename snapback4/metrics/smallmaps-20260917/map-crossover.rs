use snapback4_core::smallmap::SmallMap;
use std::collections::BTreeMap;
fn next(seed: &mut u64) -> u64 { *seed ^= *seed << 13; *seed ^= *seed >> 7; *seed ^= *seed << 17; *seed }
fn main() {
    use std::{hint::black_box, time::Instant};
    use snapback4_core::Value;
    for n in [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096] {
        let mut seed = 7;
        let sorted: Vec<_> = (0..n).map(|n| (format!("field{n:05}"), Value::Int(n as i64))).collect();
        let mut shuffled = sorted.clone();
        for i in (1..n).rev() { shuffled.swap(i, next(&mut seed) as usize % (i + 1)); }
        for (order, entries) in [("sorted", &sorted), ("shuffled", &shuffled)] {
            let repeats = (32_768 / n).max(8);
            let (mut small, mut tree) = (Vec::new(), Vec::new());
            for trial in 0..7 {
                for small_first in [trial % 2 == 0, trial % 2 != 0] {
                    let start = Instant::now();
                    for _ in 0..repeats {
                        if small_first { black_box(entries.iter().cloned().collect::<SmallMap<_, _>>()); }
                        else { black_box(entries.iter().cloned().collect::<BTreeMap<_, _>>()); }
                    }
                    let ns = start.elapsed().as_nanos() as f64 / repeats as f64;
                    if small_first { small.push(ns); } else { tree.push(ns); }
                }
            }
            small.sort_by(f64::total_cmp); tree.sort_by(f64::total_cmp);
            println!("MAP n={n} order={order} pairs=7 repeats={repeats} small_ns={:.0} btree_ns={:.0} ratio={:.3}", small[3], tree[3], small[3] / tree[3]);
        }
    }
}
