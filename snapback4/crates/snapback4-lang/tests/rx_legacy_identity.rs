//! Frozen backend bytes from the integrity-verified published 0.4.13 compiler.
//! See fixtures/rx/legacy-provenance.json; regenerate only with that compiler.
use snapback4_core::{ir::Program, json_codec};
use snapback4_device::device::Backend;
use snapback4_lang::compile;

fn identical(source: &str, expected: &str) {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let legacy: Backend = json_codec::from_text(expected).unwrap();
    assert_eq!(bound.schema.operations, legacy.schema.operations, "exact legacy site lists");
    assert_eq!(bound.schema.hash(), legacy.schema.hash(), "legacy schema identity");
    let mut programs: Vec<Program> = bound.programs.iter().map(|p| p.program.clone()).collect();
    programs.sort_by(|a, b| a.name.cmp(&b.name));
    let current = Backend { generation: 1, schema: bound.schema, programs };
    assert_eq!(json_codec::to_text(&current).unwrap(), expected.trim_end(), "entire backend bytes");
}

#[test]
fn repeated_one_hop_terms_keep_the_published_site_list_hash_and_backend_bytes() {
    identical(include_str!("fixtures/rx/legacy-one-hop.q"), include_str!("fixtures/rx/legacy-one-hop.json"));
}

#[test]
fn zero_hop_schema_keeps_the_published_hash_and_backend_bytes() {
    identical(include_str!("fixtures/rx/legacy-zero-hop.q"), include_str!("fixtures/rx/legacy-zero-hop.json"));
}
