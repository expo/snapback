use super::*;
use snapback4_device::device::Backend;
#[path = "../../../snapback4-sim/tests/common/following_calibration.rs"]
mod fixture;

#[test]
fn w8b_wired_calibration_acquisition_on_server_and_both_stores() {
    use std::collections::BTreeMap;
    let bound = fixture::built();
    let mut engine = snapback4_core::Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    fixture::seed(&mut engine);
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let start = std::time::Instant::now();
    let pages = snapshot_pages(&mut engine, fixture::VIEWER, 2000);
    let mut counts = BTreeMap::<String, (usize, usize)>::new();
    for event in pages.iter().flat_map(|p| &p.events) {
        if let Some(row) = &event.data {
            let count = counts.entry(event.table.clone()).or_default();
            count.0 += 1;
            count.1 += serde_json::to_vec(row).unwrap().len();
        }
    }
    fixture::check_counts(&counts);
    println!("W8b host=server cold_rows={} cold_bytes={} snapshot_ms={:.3}", counts.values().map(|v| v.0).sum::<usize>(), counts.values().map(|v| v.1).sum::<usize>(), start.elapsed().as_secs_f64() * 1000.0);
    let first = engine.query("social.following", context(fixture::VIEWER, &[])).unwrap();
    fixture::check_page(&first);
    let next_args = serde_json::json!({"c":first.next});
    let second = engine.query("social.following", context(fixture::VIEWER, &[("c", Value::String(first.next.clone().unwrap()))])).unwrap();
    fixture::check_page(&second);
    assert!(second.data.as_array().unwrap().iter().all(|r| !first.data.as_array().unwrap().iter().any(|p| p.field("eventId") == r.field("eventId"))));
    println!("W8b host=server following_rows=20 complete={} examined={} probes={}", first.complete, first.metered.examined, first.metered.rule_probes);
    let before = fixture::exercise_bridge(&mut engine);
    let changes = stream_page(&mut engine, fixture::VIEWER, before);
    let updated = engine.query("social.following", context(fixture::VIEWER, &[])).unwrap();
    fn run<H: crate::common::Host>(mut host: H, backend: &Backend, pages: &[snapback4_device::device::StreamPage], first: &snapback4_core::QueryOutcome,
        second: &snapback4_core::QueryOutcome, next_args: &serde_json::Value, changes: &snapback4_device::device::StreamPage, updated: &snapback4_core::QueryOutcome) {
        let start = std::time::Instant::now();
        let mut device = host.open("w8b-calibration", Some(backend.clone())).unwrap();
        for (n, page) in pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        println!("W8b host={} cold_rows=139413 apply_ms={:.3}", host.label(), start.elapsed().as_secs_f64() * 1000.0);
        for (args, expected) in [(serde_json::json!({}), first), (next_args.clone(), second)] {
            let local = device.query("social.following", fixture::VIEWER, &args, 100_000).unwrap();
            fixture::check_page(&local);
            assert_eq!((&local.data, &local.next, local.complete), (&expected.data, &expected.next, expected.complete));
            println!("W8b host={} following_rows=20 complete={} examined={} probes={}", host.label(), local.complete, local.metered.examined, local.metered.rule_probes);
        }
        device.apply(changes, false).unwrap();
        let local = device.query("social.following", fixture::VIEWER, &serde_json::json!({}), 100_002).unwrap();
        assert_eq!((&local.data, &local.next, local.complete), (&updated.data, &updated.next, updated.complete));
        host.close("w8b-calibration", device);
    }
    run(Memory::new(), &backend, &pages, &first, &second, &next_args, &changes, &updated);
    run(Sqlite::new("w8b-calibration"), &backend, &pages, &first, &second, &next_args, &changes, &updated);
}
