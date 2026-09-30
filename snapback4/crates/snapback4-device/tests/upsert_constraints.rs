//! Changed constraint populations require coverage, independently of target custody.
// @ref LLP 3000.007#20.5 — unchanged keys reuse admission; new populations need proof.
mod common;
use common::*;
#[path="../../snapback4-lang/tests/membership_paths/fixture.rs"] mod fixture;
use serde_json::json;
use snapback4_core::{wire, WriteState};

fn generated<H: Host>(host: &mut H) {
    let mut failures = Vec::new();
    let mut cases = 0;
    for shape in ["natural", "unique", "unique-multi", "unique-covered", "cap", "cap-multi", "cap-covered", "expiring-cap", "expiring-covered", "combined"] {
        let covered = matches!(shape, "natural" | "unique-covered" | "cap-covered" | "expiring-covered");
        let expiring = shape.starts_with("expiring");
        let extra = match shape {
            "natural" => "",
            "unique" => "  unique byEmoji: emoji\n",
            "unique-multi" => "  unique byEmoji: principal, emoji\n",
            "unique-covered" => "  unique byEmoji: parent, emoji\n",
            "cap" | "expiring-cap" => "  cap 1 by emoji\n",
            "cap-multi" => "  cap 1 by principal, emoji\n",
            "cap-covered" | "expiring-covered" => "  cap 1 by parent, emoji\n",
            "combined" => "  unique byEmoji: parent, emoji\n  cap 1 by principal, emoji\n",
            _ => unreachable!(),
        };
        for horizon in [false, true] { for arm in ["insert", "update", "unchanged"] {
            let label = format!("{shape}-{horizon}-{arm}");
            let mut source = fixture::source(2, true, false, horizon, "group").replace("upsert reactions[parent, viewer]", "upsert reactions[parent = parent, principal = viewer]").replace("  emoji: text <=32\n", &format!("  emoji: text <=32\n{extra}"));
            if expiring { source = source.replace("  emoji: text <=32\n", "  emoji: text <=32\n  deadline: time default 9000000000000000\n  expire at .deadline\n"); }
            let (mut e, b) = compile(&source);
            let mut rows = vec![
                ("groups", json!({"id":"g0","title":"Visible"})), ("groups", json!({"id":"g1","title":"Hidden"})),
                ("members", json!({"id":"a","group":"g0","principal":"alice"})),
                ("messages", json!({"id":"m0","group":"g0"})), ("messages", json!({"id":"m1","group":"g1"})),
                ("reactions", json!({"id":"hidden","parent":"m1","principal":"alice","emoji":"taken"})),
            ];
            if arm != "insert" { rows.push(("reactions", json!({"id":"held","parent":"m0","principal":"alice","emoji":"old"}))); }
            if expiring { for (table, row) in &mut rows { if *table == "reactions" { row["deadline"] = json!(9000000000000000_i64); } } }
            let rows: Vec<(String, snapback4_core::Value)> = rows.into_iter().map(|(name,row)|(name.into(),wire::row_from_json(&e.schema().tables[name],&row).unwrap())).collect();
            e.seed_at(rows,100).unwrap();
            let mut d = host.open(&label, Some(b)).unwrap();
            for (i,p) in snapshot_pages(&mut e,"alice",3).iter().enumerate() { d.apply(p,i==0).unwrap(); }
            let read = |d: &mut snapback4_device::device::Device<H::Store>| snapback4_device::call::call(d,json!({"op":"query","name":"page","args":{"parent":"m0"},"viewer":"alice","now":100}))["ok"]["data"].clone();
            let before = read(&mut d);
            let emoji = if arm == "unchanged" { "old" } else { "taken" };
            let q = d.admit(serde_json::from_value(json!({"id":label,"seq":0,"op":"react","args":{"parent":"m0","emoji":emoji,"allowed":true},"viewer":"alice","now":100,"predictable":true})).unwrap()).unwrap();
            let expected = arm == "unchanged" || (arm == "update" && shape == "natural") || (covered && !horizon && !expiring);
            if q.predictable != expected || q.predicted.len() != usize::from(expected) { failures.push(format!("{label}: expected prediction={expected}, got {q:?}")); }
            if !expected && read(&mut d) != before { failures.push(format!("{label}: queued write changed the visible row")); }
            let outcome = e.mutate("react",None,context("alice", &[("parent",id("m0")),("emoji",snapback4_core::Value::String(emoji.into())),("allowed",snapback4_core::Value::Bool(true))]).at(100).with_ids(vec!["minted".into()])).unwrap();
            assert_eq!(matches!(outcome.state,WriteState::Sent{..}), covered || arm=="unchanged", "{label}: {outcome:?}");
            if !covered && arm != "unchanged" { assert!(matches!(&outcome.state,WriteState::Failed{why, ..} if ["E_RULE","E_CONSTRAINT","NOT_FOUND"].contains(&why.code.as_str())), "{label}: {outcome:?}"); }
            d.settle(&label,None).unwrap();
            assert_eq!(read(&mut d),before,"{label}: settlement changed confirmed image");
            cases += 1;
        }}
    }
    assert!(failures.is_empty(), "{} cases on {}:\n{}", cases, host.label(), failures.join("\n"));
    println!("{cases} generated constraint cases on {}",host.label());
}
#[test] fn generated_constraints_memory() { generated(&mut Memory::new()); }
#[test] fn generated_constraints_sqlite() { generated(&mut Sqlite::new("qx-constraints")); }
