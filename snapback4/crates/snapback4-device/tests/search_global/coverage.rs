use super::*;
use serde_json::json;
#[path = "../../../snapback4-sim/tests/common/held_coverage.rs"] mod witness;

fn run<H: Host>(host: &mut H, case: &str, op: &str, complete: bool, count: usize, covered: bool) {
    let (mut engine, backend) = compile(&witness::source(case));
    engine.seed(witness::seed()).unwrap();
    let mut device = host.open("coverage", Some(backend)).unwrap();
    let pages = super::super::snapshot_pages_at(&mut engine, "alice", 100, 1000);
    let acquired = pages.iter().flat_map(|page| &page.events).filter(|event| event.table == "messages").count();
    assert_eq!(acquired, if case == "online" { 0 } else if case == "horizon" { 1 } else { 2 });
    for (n, page) in pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("coverage", device);
    let mut device = host.open("coverage", None).unwrap();
    let args = if op == "searchHeld" { json!({"q":"cof", "c":null}) } else { json!({}) };
    let read = device.query(op, "alice", &args, 1000).unwrap();
    assert_eq!(read.complete, complete, "{read:?}");
    if op == "constantHeld" { assert_eq!(read.data, snapback4_core::Value::Int(7)); }
    else { assert_eq!(read.data.as_array().unwrap().len(), count); }
    assert!(read.next.is_none() && read.capped_at.is_none() && read.word_cut_at.is_none());
    if case == "temporary" { assert_eq!(read.next_expiry, Some(10_000)); }
    println!("W9R1a coverage store={} case={case} op={op} acquired={acquired} rows={count} complete={} examined={} index_entries={} probes={} steps={} heap_bytes={} output_bytes={} rows_written={} meter_cut=0 word_cut=0 next=0",
        host.label(), read.complete, read.metered.examined, read.metered.index_entries, read.metered.rule_probes, read.metered.steps, read.metered.heap_bytes, read.metered.output_bytes, read.metered.rows_written);
    witness::assert_line(device.schema(), op, covered);
    host.close("coverage", device);
}

#[test]
fn w9r1a_temporary_audience_search_memory() { run(&mut Memory::new(), "temporary", "searchHeld", false, 2, true); }
#[test]
fn w9r1a_temporary_audience_search_sqlite() { run(&mut Sqlite::new("w9r1a-temporary"), "temporary", "searchHeld", false, 2, true); }

#[test]
fn w9r1a_truncated_held_page_memory() { run(&mut Memory::new(), "full", "firstHeld", true, 1, true); }
#[test]
fn w9r1a_truncated_held_page_sqlite() { run(&mut Sqlite::new("w9r1a-truncated"), "full", "firstHeld", true, 1, true); }

fn clique<H: Host>(host: &mut H) {
    run(host, "full", "searchHeld", true, 2, true);
    run(host, "horizon", "searchHeld", false, 1, false);
}
#[test]
fn w9r1a_clique_full_and_horizon_memory() { clique(&mut Memory::new()); }
#[test]
fn w9r1a_clique_full_and_horizon_sqlite() { clique(&mut Sqlite::new("w9r1a-clique")); }

fn no_coverage<H: Host>(host: &mut H) {
    run(host, "online", "searchHeld", false, 0, false);
    run(host, "full", "constantHeld", true, 0, false);
}
#[test]
fn w9r1a_online_source_and_zero_reads_memory() { no_coverage(&mut Memory::new()); }
#[test]
fn w9r1a_online_source_and_zero_reads_sqlite() { no_coverage(&mut Sqlite::new("w9r1a-no-coverage")); }

fn nested<H: Host>(host: &mut H, case: &str) {
    let (mut engine, backend) = compile(&witness::nested_source(case));
    engine.seed(witness::nested_seed()).unwrap();
    let mut device = host.open("nested", Some(backend)).unwrap();
    let pages = super::super::snapshot_pages_at(&mut engine, "alice", 100, 1000);
    let terms = pages.iter().flat_map(|page| &page.events).filter(|event| event.table == "terms").count();
    assert_eq!(terms, usize::from(case != "online"));
    for (n, page) in pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("nested", device);
    let mut device = host.open("nested", None).unwrap();
    let read = device.query("nestedSearch", "alice", &json!({}), 1000).unwrap();
    println!("W9R2 store={} acquired_terms={terms}", host.label());
    witness::assert_nested_read(&read, case);
    witness::assert_nested(device.schema(), case);
    host.close("nested", device);
}

#[test]
fn w9r2_matching_online_memory() { nested(&mut Memory::new(), "online"); }
#[test]
fn w9r2_matching_online_sqlite() { nested(&mut Sqlite::new("w9r2-online"), "online"); }
#[test]
fn w9r2_matching_horizon_memory() { nested(&mut Memory::new(), "horizon"); }
#[test]
fn w9r2_matching_horizon_sqlite() { nested(&mut Sqlite::new("w9r2-horizon"), "horizon"); }
#[test]
fn w9r2_matching_full_memory() { nested(&mut Memory::new(), "full"); }
#[test]
fn w9r2_matching_full_sqlite() { nested(&mut Sqlite::new("w9r2-full"), "full"); }
