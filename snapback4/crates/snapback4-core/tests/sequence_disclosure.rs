mod paired_worlds;
#[path = "paired_worlds/sequences.rs"]
mod cases;
#[test]
fn sequence_worlds_compare_all_channels() {
    let mut failed = 0;
    for (n, pair) in cases::pairs().into_iter().enumerate() {
        if std::panic::catch_unwind(|| pair.assert_equal()).is_err() {
            eprintln!("pair {n}: {} by {}", pair.operations[0].name, pair.principal);
            failed += 1;
        }
    }
    assert_eq!(failed, 0, "pairs with differences");
}
#[test]
fn counter_reads_reserve_before_hidden_target_resolution() {
    for entries in 0..=3 { cases::boundary(entries).assert_equal(); }
}

#[test]
fn counter_read_boundary_at_default_ceilings_after_512_scratch_writes() {
    let mut pair = cases::boundary(16_384);
    pair.source.push_str("\ntable scratch:\n  n: int\n  public\n  insert <- allow\n  online only\n");
    for n in 0..31 { pair.source.push_str(&format!("  by ix{n}: n, id\n")); }
    pair.source.push_str("\nmutation burn(parent: parents, body: text <=40):\n");
    for n in 0..512 { pair.source.push_str(&format!("  insert scratch {{ id: 'scratch{n}', n: {n} }}\n")); }
    pair.source.push_str("  return upsert messages[parent = parent, body = body] { owner: 'alice' }\n");
    pair.operations[0].name = "burn".into();
    pair.assert_equal();
}
