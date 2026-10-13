use super::*;

thread_local! { pub(super) static MISSING_CLOCK: Cell<bool> = const { Cell::new(false) }; }

#[test]
fn missing_cpu_clock_omits_header_metric_and_doctor_reports_unavailable() {
    // Thread-local injection also covers failure after a successful starting
    // stamp; other concurrently running request tests keep their real clock.
    struct RestoreClock;
    impl Drop for RestoreClock { fn drop(&mut self) { MISSING_CLOCK.set(false); } }
    for missing_at_start in [true, false] {
        let _restore = RestoreClock;
        let bound = snapback4_lang::compile(&[("schema.q".into(), "query one():\n  return 1\n".into())]);
        let registry = Arc::new(Registry::new(&bound));
        let request = tiny_http::TestRequest::new().with_method(Method::Post).with_path("/q/one").into();
        let sample = Sample::with_headers(&request, &registry, true).unwrap();
        MISSING_CLOCK.set(missing_at_start);
        sample.run(|| {
            MISSING_CLOCK.set(true);
            assert!(thread_cpu().is_none());
            let header = header().unwrap();
            let keys: Vec<_> = header.value.as_str().split(',')
                .map(|metric| metric.trim().split_once(";dur=").unwrap().0).collect();
            assert_eq!(keys, ["total", "wait", "engine"], "{header}");
            finished(false);
        });
        let snapshot = registry.snapshot(false);
        let operation = &serde_json::to_value(&snapshot).unwrap()["operations"]["/q/one"];
        assert_eq!(operation["n"], 1);
        assert_eq!(operation["cpu_n"], 0);
        assert_eq!(operation["cpu"], Value::Null, "{operation}");
        crate::verbs::doctor_tests::assert_cpu_unavailable(&snapshot);
    }
}

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
    for n in 0..1000 { registry.record(&format!("/q/unknown-{n}"), start, Duration::from_millis(1), Duration::ZERO, Duration::ZERO, None, true); }
    assert_eq!(registry.snapshot(false).operations.len(), FIXED.len() + 1);
    assert_eq!(registry.snapshot(false).operations["/q/<unknown>"].refused, 1000);
    registry.snapshot(true);
    registry.record("/q/one", start, Duration::from_secs(1), Duration::ZERO, Duration::ZERO, None, false);
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
    for _ in 0..1_000_000 { registry.record("/q/one", start, Duration::from_micros(100), Duration::from_micros(10), Duration::ZERO, None, false); }
    println!("latency recorder: {:.1} ns/request; {} bytes/operation; {} buckets/distribution", start.elapsed().as_nanos() as f64 / 1_000_000.0, std::mem::size_of::<Operation>(), BINS);
    assert_eq!(registry.snapshot(false).operations["/q/one"].n, 1_000_000);
}

#[test]
fn snapshot_of_ten_thousand_operations_does_not_serialize_recording() {
    use std::{sync::mpsc, thread};
    let source = (0..10_000).map(|n| format!("query op{n}():\n  return 1\n")).collect::<String>();
    let registry = Arc::new(Registry::new(&snapback4_lang::compile(&[("schema.q".into(), source)])));
    let window = lock(&registry.0).clone();
    // Stop the snapshot on its first operation. An unrelated record must still
    // finish; no assumption about scheduling or snapshot memcpy speed is needed.
    let first = lock(window.operations.first_key_value().unwrap().1);
    let r = registry.clone();
    let snapshot = thread::spawn(move || r.snapshot(false));
    let start = Instant::now();
    while Arc::strong_count(&window) < 3 {
        assert!(start.elapsed() < Duration::from_secs(60), "snapshot did not reach its held mutex"); thread::yield_now();
    }
    let (tx, rx) = mpsc::channel();
    let r = registry.clone();
    let recorder = thread::spawn(move || {
        let start = Instant::now();
        r.record("/q/op0", start, Duration::from_millis(1), Duration::ZERO, Duration::ZERO, None, false);
        tx.send(start.elapsed()).unwrap();
    });
    let elapsed = rx.recv_timeout(Duration::from_secs(60));
    drop(first); // Always release before asserting so a failed test can unwind.
    recorder.join().unwrap();
    let result = snapshot.join().unwrap();
    assert_eq!(result.operations.len(), 10_007);
    println!("record with snapshot held on another operation: {:?}", elapsed);
    assert!(elapsed.is_ok(), "record waited for unrelated operation's snapshot");

    let (tx, rx) = mpsc::channel();
    let r = registry.clone();
    let snapshot = thread::spawn(move || {
        let start = Instant::now();
        tx.send(()).unwrap();
        for _ in 0..3 { assert_eq!(r.snapshot(false).operations.len(), 10_007); }
        start.elapsed()
    });
    rx.recv().unwrap();
    let mut worst = Duration::ZERO;
    let mut count = 0;
    while !snapshot.is_finished() {
        let start = Instant::now();
        registry.record("/q/op0", start, Duration::from_millis(1), Duration::ZERO, Duration::ZERO, None, false);
        worst = worst.max(start.elapsed()); count += 1;
        thread::yield_now();
    }
    println!("10,000-operation concurrent snapshots: {:?}; {count} records; max record wait+work: {worst:?}", snapshot.join().unwrap());
    // The held first-operation test above proves independent recording.
    // Concurrent wall time is a diagnostic, including scheduler preemption.
}
