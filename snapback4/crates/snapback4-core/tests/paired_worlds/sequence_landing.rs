//! Landing-review combinations on the integrated evaluator.
use crate::paired_worlds::*;
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};
const SOURCE: &str = "table parents:\n  public\n  online only\ntable grants:\n  parent: parents\n  who: principal\n  until: time ?\n  expire at .until\n  unique byParentWho: parent, who\n  read <- deny\n  online only\ntable messages:\n  parent: parents\n  owner: principal default viewer\n  ordinal: sequence by parent\n  read <- exists grants[parent = .parent, who = viewer]\n  insert <- allow\n  online only\nquery one():\n  return messages['own']\nquery page():\n  return messages where .parent = 'p' first 2 by .ordinal\nmutation send():\n  return insert messages { parent: 'p' }\n";
// Raw trusted seeds also exercise legacy duplicate physical versions;
// ordinary Quarry writes now enforce the declared unique witness key.
fn pair(populations: [usize;2], first: [Option<i64>;2], expired: bool) -> Pair {
    let seeds=[0,1].map(|world| {
        let mut rows=vec![("messages".into(),json!({"id":"own","parent":"p","owner":"alice","ordinal":1}))];
        rows.extend((0..populations[world]).map(|n|("grants".into(),json!({"id":format!("grant{n:05}"),"parent":"p","who":"alice","until":
            if expired {Some(500)} else if n==0 {first[world]} else if n+1==populations[world] {None} else {Some(2000)}}))));
        rows
    });
    let mut pair=Pair::new(SOURCE,seeds,"alice",Operation::new("send",json!({}),"alice"));
    pair.trusted=true;pair
}
#[test]
fn permanent_witness_position_cannot_select_read_or_insert_exhaustion() {
    let pair=pair([8193,8193],[None,Some(2000)],false).query("one",json!({}));
    pair.assert_equal();
    for world in 0..2 {
        let mut e=pair.engine(world);
        assert_eq!(e.query("one",Context::new("alice",Default::default()).at(NOW)).unwrap_err().code,"E_RULE");
        let out=e.mutate("send",None,Context::new("alice",Default::default()).at(NOW).with_ids(["candidate".into()])).unwrap();
        assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="E_RULE"));
    }
}
#[test]
fn expired_sequence_witness_boundary_restores_the_denied_meter() {
    let mut pair=pair([8191,8192],[None,None],true);
    pair.source=pair.source.replace("query one():\n  return messages['own']\nquery page():\n  return messages where .parent = 'p' first 2 by .ordinal\n", "");
    pair.assert_equal();
    let outcomes=[0,1].map(|world| {
        let mut e=pair.engine(world);
        e.mutate("send",None,Context::new("alice",Default::default()).at(NOW).with_ids(["candidate".into()])).unwrap()
    });
    assert_eq!(outcomes[0].metered,outcomes[1].metered);
    assert_eq!(outcomes[0].metered.rule_probes,0);
    for out in outcomes { assert!(matches!(out.state,WriteState::Failed{why,..} if why.code=="E_RULE")); }
}
#[test]
fn nested_and_sibling_page_exhaustion_have_one_empty_envelope() {
    let mut pair=pair([0,4000],[None,None],true);
    pair.source=pair.source.replace("who = viewer]\n  insert", "who = viewer] or .owner = viewer\n  insert");
    for seed in &mut pair.seeds {
        seed[0].1["ordinal"]=json!(9001);
        seed.extend((0..9000).map(|n|("messages".into(),json!({"id":format!("hidden{n}"),"parent":"p","owner":"bob","ordinal":n+1}))));
    }
    pair.operations.clear();pair=pair.query("page",json!({}));pair.assert_equal();
    for world in 0..2 {
        let mut e=pair.engine(world);
        let out=e.query("page",Context::new("alice",Default::default()).at(NOW)).unwrap();
        assert_eq!(out.data,Value::Array(vec![]));assert!(out.next.is_none());
    }
}

#[test]
fn redundant_witness_lifetimes_do_not_change_scan_or_write_probe_reservations() {
    let source="table hidden:\n  tag: int\n  until: time ?\n  expire at .until\n  unique byTag: tag\n  read <- deny\n  online only\ntable stable:\n  tag: int\n  unique byTag: tag\n  read <- deny\n  online only\ntable rows:\n  owner: principal\n  read <- (exists hidden[tag = 0] or exists stable[tag = 0]) and .owner = viewer\n  update <- exists hidden[tag = 0] or exists stable[tag = 0]\n  online only\nquery page():\n  return rows first 2\nmutation touch():\n  update rows['r'] { owner: viewer }\n";
    for finite in [false,true] {
        let seeds=[false,true].map(|present| {
            let mut seed=vec![("stable".into(),json!({"id":"stable","tag":0})),("rows".into(),json!({"id":"r","owner":"alice"}))];
            if present {seed.push(("hidden".into(),json!({"id":"hidden","tag":0,"until":if finite {Some(2000)} else {None}})));}seed
        });
        let mut pair=Pair::new(source,seeds,"alice",Operation::new("touch",json!({}),"alice")).query("page",json!({}));
        pair.trusted=true;pair.assert_equal();
        for world in 0..2 {
            let mut e=pair.engine(world);
            let out=e.query("page",Context::new("alice",Default::default()).at(NOW)).unwrap();
            // @ref LLP 3000.036.001#18 — two branch ranges retain their fixed
            // guard probes in addition to the complete authored read rule.
            assert_eq!(out.next_expiry,None);assert_eq!(out.metered.rule_probes,8);
            let out=e.mutate("touch",None,Context::new("alice",Default::default()).at(NOW)).unwrap();
            // A point mutation has no PAGE lane filter; its authored read and
            // update checks retain their existing eight-probe reservation.
            assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");assert_eq!(out.metered.rule_probes,8);
        }
    }
}
