//! Executed IR is baseline lowering, independent of presence ownership.
#[path = "lowering/cases.rs"]
mod cases;
#[path = "lowering/regression.rs"]
mod regression;
#[path = "lowering/snapshot.rs"]
mod snapshot;

use snapback4_lang::{ast, bind::{catalog::Catalog, program::Binder}, Diagnostic};
use std::collections::BTreeMap;

fn without_ownership(catalog: &Catalog, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<snapback4_lang::BoundProgram> {
    Binder::bind_with_ownership(catalog, module, decl, diagnostics, false)
}

#[test]
fn baseline_golden_and_ownership_switch_agree_byte_for_byte() {
    let mut inputs = cases::generated();
    let generated = inputs.len();
    inputs.extend(cases::census());
    let enabled = snapshot::snapshot(inputs.clone(), snapshot::baseline, true);
    let disabled = snapshot::snapshot(inputs, without_ownership, true);
    // The baseline golden keeps one SHA-256 per executed program's serialized IR
    // (derived from the ce15819ad serialization; see lowering/README.md).
    let golden: BTreeMap<String, String> = include_str!("lowering/ce15819ad.sha256").lines().map(|line| { let (name, digest) = line.split_once('\t').unwrap(); (name.to_owned(), digest.to_owned()) }).collect();
    let digest = |ir: &str| { use sha2::{Digest, Sha256}; Sha256::digest(ir.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>() };
    assert_eq!(enabled.keys().collect::<Vec<_>>(), golden.keys().collect::<Vec<_>>(), "the corpus must neither lose nor gain a compiled program");
    assert_eq!(enabled.keys().collect::<Vec<_>>(), disabled.keys().collect::<Vec<_>>());
    for name in include_str!("lowering/r1p-programs.txt").lines() {
        assert!(enabled.contains_key(name), "missing R1p census program {name}");
    }
    let mut differences = Vec::new();
    let mut admissions = 0;
    let mut executions = 0;
    for (name, record) in &enabled {
        if digest(&record.ir) != golden[name] { differences.push(format!("{name}: baseline IR")); }
        let control = &disabled[name];
        if record.ir.as_bytes() != control.ir.as_bytes() { differences.push(format!("{name}: disabled IR")); }
        if record.admission != control.admission { differences.push(format!("{name}: disabled admission")); }
        if record.observations != control.observations { differences.push(format!("{name}: disabled meters/results/error sites")); }
        admissions += record.admission.len();
        executions += record.observations.len();
    }
    println!("differential: {generated} generated bundles; 740 R1p bundles; {} programs; {} IR comparisons; {admissions} admission comparisons; {executions} execution comparisons; {} differences", enabled.len(), enabled.len() * 2, differences.len());
    assert!(differences.is_empty(), "{}", differences.join("\n"));
}
