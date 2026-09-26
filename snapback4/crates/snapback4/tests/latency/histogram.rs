use super::*;

#[test]
fn random_exact_nearest_rank_percentiles_are_within_five_percent() {
    let mut seed = 71u64;
    for distribution in 0..4 {
        let mut samples = Vec::new();
        let mut histogram = Histogram::default();
        for _ in 0..50_000 {
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
            let ns = match distribution {
                0 => seed % 600_000_000_000 + 10_000,
                1 => (10f64.powf((seed % 11800) as f64 / 1000.0)) as u64,
                2 => seed % 10_000,
                _ => if seed % 100 < 95 { 10_000 } else { 600_000_000_000 },
            };
            samples.push(ns);
            histogram.record(Duration::from_nanos(ns));
        }
        samples.sort_unstable();
        for percent in 1..=100 {
            let exact = samples[(samples.len() * percent as usize).div_ceil(100) - 1] as f64;
            let approximate = histogram.percentile(percent) * 1_000_000.0;
            assert!((approximate - exact).abs() <= exact * 0.05, "distribution {distribution} p{percent}: {approximate} vs {exact}");
        }
        assert_eq!(histogram.max, *samples.last().unwrap());
    }
}

#[test]
fn zero_edges_and_extreme_durations_keep_the_error_bound() {
    assert_eq!(EDGES[BINS - 1], u64::MAX);
    for ns in [0, 1, 10_000, 600_000_000_000, u64::MAX].into_iter().chain(EDGES.iter().copied()).chain(EDGES.iter().map(|n| n.saturating_add(1))) {
        let mut h = Histogram::default();
        h.record(Duration::from_nanos(ns));
        let p = h.percentile(95) * 1_000_000.0;
        assert!((p - ns as f64).abs() <= ns as f64 * 0.05, "{ns}: {p}");
    }
}

#[test]
fn registry_bounds_unknown_names_adopts_and_excludes_old_arrivals_after_reset() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "query one():\n  return 1\n".into())]);
    let registry = Registry::new(&bound);
    let start = Instant::now();
    for n in 0..1000 { registry.record(&format!("/q/unknown-{n}"), start, Duration::from_millis(1), Duration::ZERO, true); }
    assert_eq!(registry.snapshot(false).operations.len(), FIXED.len() + 1);
    assert_eq!(registry.snapshot(false).operations["/q/<unknown>"].refused, 1000);
    registry.snapshot(true);
    registry.record("/q/one", start, Duration::from_secs(1), Duration::ZERO, false);
    assert_eq!(registry.snapshot(false).operations["/q/one"].n, 0);
    registry.adopt(&snapback4_lang::compile(&[]));
    assert_eq!(registry.snapshot(false).operations.len(), FIXED.len());
}

#[test]
#[ignore = "measurement: one million bounded recordings, no timing gate"]
fn latency_record_cost_and_memory() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "query one():\n  return 1\n".into())]);
    let registry = Registry::new(&bound);
    let start = Instant::now();
    for _ in 0..1_000_000 { registry.record("/q/one", start, Duration::from_micros(100), Duration::from_micros(10), false); }
    println!("latency recorder: {:.1} ns/request; {} bytes/operation; {} buckets/distribution", start.elapsed().as_nanos() as f64 / 1_000_000.0, std::mem::size_of::<Operation>(), BINS);
    assert_eq!(registry.snapshot(false).operations["/q/one"].n, 1_000_000);
}
