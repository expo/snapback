//! Executed IR is baseline lowering, independent of presence ownership.
#[path = "lowering/cases.rs"]
mod cases;
#[path = "lowering/regression.rs"]
mod regression;
#[path = "lowering/snapshot.rs"]
mod snapshot;

use snapback4_lang::{ast, bind::{catalog::Catalog, program::Binder}, Diagnostic};
use std::collections::BTreeMap;

// The six wildcard replacements were refused by the historical compiler.
// Pin their newly admitted IR separately; preserve every original digest.
// LLP 3000.007 §23 adds three corpus programs (fallthrough helper and a
// document previously rejected by len); none changes an existing digest.
// LLP 3000.015 §3 splits maintained point-read row/count slots. The 96
// replacement digests preserve the historical records; README gives the exact
// inverse transformation proving no other IR changed.
use snapshot::{NL_REFUSED, NL_SOURCE};

const GOLDEN: &str = concat!(include_str!("lowering/ce15819ad.sha256"), include_str!("lowering/intent-shape-overrides.sha256"), include_str!("lowering/first-paste-admissions.sha256"), include_str!("lowering/maintenance-scope-overrides.sha256"), include_str!("lowering/reference-field-admissions.sha256"));

fn without_ownership(catalog: &Catalog, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<snapback4_lang::BoundProgram> {
    let schema = snapback4_lang::bind::schema::bind_schema(catalog, diagnostics);
    Binder::bind_with_ownership(catalog, &schema, module, decl, diagnostics, false)
}

fn baseline_golden_and_ownership_switch_agree_byte_for_byte(part: usize, count: usize) {
    let mut inputs = cases::generated();
    let generated_keys: std::collections::BTreeSet<_> = inputs.keys().cloned().collect();
    inputs.extend(cases::census());
    assert!(count > 0 && part < count);
    inputs = inputs.into_iter().enumerate().filter(|(index, _)| index % count == part).map(|(_, input)| input).collect();
    let generated = inputs.keys().filter(|key| generated_keys.contains(*key)).count();
    let selected: Vec<_> = inputs.keys().map(|key| format!("{key}:")).collect();
    let enabled = snapshot::snapshot(inputs.clone(), snapshot::baseline, true);
    let disabled = snapshot::snapshot(inputs, without_ownership, true);
    // The baseline golden keeps one SHA-256 per executed program's serialized IR
    // (derived from the ce15819ad serialization; see lowering/README.md).
    let mut golden: BTreeMap<String, String> = GOLDEN.lines().map(|line| { let (name, digest) = line.split_once('\t').unwrap(); (name.to_owned(), digest.to_owned()) }).filter(|(name, _)| selected.iter().any(|prefix| name.starts_with(prefix))).collect();
    for name in NL_REFUSED {
        let key = format!("{NL_SOURCE}:{name}");
        if selected.iter().any(|prefix| key.starts_with(prefix)) {
            assert!(golden.remove(&key).is_some(), "frozen refusal entry {key}");
            assert!(!enabled.contains_key(&key) && !disabled.contains_key(&key));
        }
    }
    let digest = |ir: &str| { use sha2::{Digest, Sha256}; Sha256::digest(ir.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>() };
    assert_eq!(enabled.keys().collect::<Vec<_>>(), golden.keys().collect::<Vec<_>>(), "the corpus must neither lose nor gain a compiled program");
    assert_eq!(enabled.keys().collect::<Vec<_>>(), disabled.keys().collect::<Vec<_>>());
    let mut differences = Vec::new();
    let mut admissions = 0;
    let mut executions = 0;
    for (name, record) in &enabled {
        // W13h adds serialized marks only for canonical returned query shapes.
        // Keep the historical statement bytes under the original golden, and
        // still compare the entire marked IR between ownership-on/off below.
        let mut program: snapback4_core::ir::Program = serde_json::from_str(&record.ir).unwrap();
        let baseline_ir = if program.returned_shapes.is_empty() { record.ir.clone() } else {
            program.returned_shapes.clear();
            serde_json::to_string(&program).unwrap()
        };
        if digest(&baseline_ir) != golden[name] { differences.push(format!("{name}: baseline IR")); }
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

// Keep the complete lowering census in the ordinary test inventory while
// exposing independent deterministic shards to the Rust harness. Their union
// is exactly the prior single test's ordered input map, so every golden digest,
// compiler-arm comparison, admission record, and execution observation remains
// asserted without one monolithic test owning the blocking-suite critical path.
macro_rules! lowering_shard {
    ($name:ident, $part:expr) => {
        #[test]
        fn $name() {
            baseline_golden_and_ownership_switch_agree_byte_for_byte($part, 8);
        }
    };
}

lowering_shard!(baseline_golden_and_ownership_switch_shard_0, 0);
lowering_shard!(baseline_golden_and_ownership_switch_shard_1, 1);
lowering_shard!(baseline_golden_and_ownership_switch_shard_2, 2);
lowering_shard!(baseline_golden_and_ownership_switch_shard_3, 3);
lowering_shard!(baseline_golden_and_ownership_switch_shard_4, 4);
lowering_shard!(baseline_golden_and_ownership_switch_shard_5, 5);
lowering_shard!(baseline_golden_and_ownership_switch_shard_6, 6);
lowering_shard!(baseline_golden_and_ownership_switch_shard_7, 7);

#[test]
fn golden_and_r1p_catalogs_keep_the_complete_source_census_pinned() {
    let mut inputs = cases::generated();
    inputs.extend(cases::census());
    let prefixes: Vec<_> = inputs.keys().map(|key| format!("{key}:")).collect();
    let golden: std::collections::BTreeSet<_> = GOLDEN
        .lines()
        .map(|line| line.split_once('\t').unwrap().0)
        .collect();

    for name in &golden {
        assert!(prefixes.iter().any(|prefix| name.starts_with(prefix)), "golden program has no census source bundle: {name}");
    }
    for name in include_str!("lowering/r1p-programs.txt").lines() {
        assert!(golden.contains(name), "missing R1p golden program {name}");
        assert!(prefixes.iter().any(|prefix| name.starts_with(prefix)), "missing R1p census source bundle for {name}");
    }
}
