mod common;
use common::*;
use serde_json::json;
use snapback4_core::{value::object, Value, WriteState};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/rx/reactions.q");
fn seed(e: &mut snapback4_core::Engine, owner: &str) {
    e.load([
        ("conversations".into(),object([("id",id("c")),("owner",id(owner))])),
        ("members".into(),object([("id",id("member")),("conversation",id("c")),("principal",id("alice"))])),
        ("messages".into(),object([("id",id("m")),("conversation",id("c")),("deleted",Value::Bool(false)),("until",Value::Null)])),
        ("reactions".into(),object([("id",id("r")),("message",id("m")),("principal",id("alice")),("emoji",Value::String("like".into()))])),
    ]).unwrap();
}
fn scenario<H: Host>(host: &mut H) {
    // Retained images remain readable after current coverage is removed.
    // Unlike until-revoked images, their presence is not itself current evidence.
    let retained = SOURCE.replace("  sync", "  retain delivered-history\n  sync");
    let (mut e, backend) = compile(&retained);
    seed(&mut e,"alice");
    for missing in [None, Some("reactions"), Some("messages"), Some("conversations"), Some("members")] {
        let name = format!("rx-{}",missing.unwrap_or("complete"));
        let mut d = host.open(&name,Some(backend.clone())).unwrap();
        for (i,mut page) in snapshot_pages(&mut e,"alice",100).into_iter().enumerate() {
            if let Some(table) = missing {
                // Keep the row images but remove their current coverage. A
                // cached parent alone must never establish write authority.
                if let Some(held) = &mut page.held { held.remove(table); }
                page.acquisitions.retain(|scope| scope.table != table);
            }
            d.apply(&page,i==0).unwrap();
        }
        let predicted = d.predict("endorse","alice",&json!({"id":"e","reaction":"r"}),100,vec![],0);
        if missing.is_none() {
            assert!(predicted.is_ok(),"{predicted:?}");
            let result = e.mutate("endorse",None,context("alice",&[("id",id("server-e")),("reaction",id("r"))]).at(100)).unwrap();
            assert!(matches!(result.state,WriteState::Sent { .. }),"{result:?}");
            d.withdraw(&[]).unwrap();
            assert!(d.predict("obligation","alice",&json!({"id":"o","message":"m"}),100,vec![],0).is_ok());
            d.withdraw(&[]).unwrap();
            // Each hop may follow an earlier provisional row, with the same
            // membership, liveness and current-coverage requirements.
            d.predict("send","alice",&json!({"id":"pending-m","conversation":"c"}),100,vec![],0).unwrap();
            d.predict("react","alice",&json!({"id":"pending-r","message":"pending-m"}),100,vec![],0).unwrap();
            assert!(d.predict("endorse","alice",&json!({"id":"pending-e","reaction":"pending-r"}),100,vec![],0).is_ok());
        } else {
            let error = predicted.expect_err(&format!("{missing:?}: uncovered chain predicted"));
            assert_eq!(error.refusal().code,"E_PREDICT","{missing:?}: {error:?}");
            let row = d.query("endorsement","alice",&json!({"id":"e"}),100).unwrap();
            assert_eq!(row.data,Value::Null,"failed prediction must roll back");
        }
        host.close(&name,d);
    }
    // The device sees the middle rows through membership, but the live
    // conversation at the third hop is hidden from this viewer.
    let (mut hidden, backend) = compile(SOURCE);
    seed(&mut hidden,"bob");
    let mut d = host.open("rx-hidden",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut hidden,"alice",100).iter().enumerate() { d.apply(page,i==0).unwrap(); }
    assert!(d.predict("endorse","alice",&json!({"id":"hidden","reaction":"r"}),100,vec![],0).is_err());
    let result = hidden.mutate("endorse",None,context("alice",&[("id",id("hidden")),("reaction",id("r"))]).at(100)).unwrap();
    assert!(matches!(result.state,WriteState::Failed { .. }),"{result:?}");
    host.close("rx-hidden",d);
}
#[test] fn memory_chains_and_final_obligations_need_every_covered_row() { scenario(&mut Memory::new()); }
#[test] fn sqlite_chains_and_final_obligations_need_every_covered_row() { scenario(&mut Sqlite::new("rx")); }
