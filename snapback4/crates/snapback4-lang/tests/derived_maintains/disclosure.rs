use super::*;
use snapback4_device::{device::{Backend, Device, StreamPage}, memory::MemoryStore};
#[allow(dead_code)]
#[path = "../../../snapback4/src/sync_wire.rs"]
mod sync_wire;
use sync_wire::{SnapshotReply, StreamReply, SyncEvents};

fn snapshot(e: &mut Engine, who: &str) -> StreamPage {
    let p = e.snapshot_acquisition_page_at(who,None,1000,86_400_010).unwrap();
    assert!(p.next.is_none());
    serde_json::from_slice(&serde_json::to_vec(&SnapshotReply {
        acknowledged: e.acknowledged(who,&[],p.watermark).unwrap(), acquisitions:p.acquisitions,
        events:SyncEvents::Snapshot(p.events),generation:e.generation(),
        store_id:e.store().meta("store_id").unwrap().unwrap(),held:p.held,
        more:false,next:None,after:None,snapshot:true,watermark:p.watermark,
    }).unwrap()).unwrap()
}
fn stream(e: &mut Engine, who: &str, from: u64) -> StreamPage {
    let p = e.stream_at(who,from,1000,86_400_010).unwrap();
    assert!(!p.more);
    let (acknowledged,committed_above) = e.acknowledged_at(who,&[],p.watermark,p.images_at.unwrap_or(p.watermark)).unwrap();
    serde_json::from_slice(&serde_json::to_vec(&StreamReply {
        acknowledged,committed_above,acquisitions:p.acquisitions,events:SyncEvents::Stream(p.events),
        generation:e.generation(),store_id:e.store().meta("store_id").unwrap().unwrap(),images_at:p.images_at,
        joined:p.joined,more:false,snapshot:false,watermark:p.watermark,
    }).unwrap()).unwrap()
}

#[test]
fn derived_membership_is_identical_to_explicit_rules_and_keeps_residency() {
    let derived = bound(PRIVATE);
    let explicit = PRIVATE.replace("by conversationId\nmaintain", "by conversationId\n  read <- exists members[.conversationId, viewer]\nmaintain")
        .replace("by conversationId, day(.at)\nquery", "by conversationId, day(.at)\n  read <- exists members[.conversationId, viewer]\nquery");
    let expected = bound(&explicit);
    assert_eq!(semantics(&derived.schema),semantics(&expected.schema));
    // Residency messages embed declaration line numbers, which the explicit rule shifts.
    assert_eq!(derived.notes.iter().map(|n|(&n.code,&n.guide,&n.rewrite)).collect::<Vec<_>>(),expected.notes.iter().map(|n|(&n.code,&n.guide,&n.rewrite)).collect::<Vec<_>>());
    for name in ["messageCount","dailyCount"] {
        let table = &derived.schema.tables[name];
        assert_eq!(table.rules.read,derived.schema.tables["messages"].rules.read);
        assert!(table.sync.as_ref().unwrap().horizon.is_none());
        assert_eq!(table.sync.as_ref().unwrap().audience,derived.schema.tables["messages"].sync.as_ref().unwrap().audience);
        assert_eq!(table.residency.inherited_from.as_deref(),Some("messages"));
    }
    let online = bound(&PRIVATE.replace("maintain dailyCount:","  online only\nmaintain dailyCount:"));
    assert!(online.schema.tables["messageCount"].sync.is_none());
    let unsynced = bound(&PRIVATE.replace("  sync to members[.conversationId] last 10 by byConversation\n", ""));
    assert!(unsynced.schema.tables["messageCount"].sync.is_none());
    let public = CLIQUE.replace("  public 'Public follow graph'", "  public 'Public follow graph'\n  sync public");
    let public = bound(&public);
    assert!(public.schema.tables["followerCount"].sync.is_some());
    // An explicit policy still goes through the partition consistency check.
    let invalid = compile(&PRIVATE.replace("maintain dailyCount:","  read <- deny\nmaintain dailyCount:"));
    assert!(invalid.diagnostics.iter().any(|d|d.code == "E_SYNC"),"{:?}",invalid.diagnostics);
}

#[test]
fn private_aggregates_never_reach_nonmembers_online_or_on_a_device() {
    let mut e = engine(PRIVATE);
    for (who,room) in [("alice","secret"),("bob","other")] {
        let row = wire::row_from_json(e.schema().table("members").unwrap(),&json!({"id":who,"conversationId":room,"principal":who,"role":"member"})).unwrap();
        e.seed_at(vec![("members".into(),row)],86_400_010).unwrap();
    }
    write(&mut e,"send","alice",&[("id",id("m1")),("conversationId",id("secret"))]);
    let backend = Backend {generation:e.generation(),schema:e.schema().public_projection(),programs:bound(PRIVATE).programs.into_iter().map(|p|p.program).collect()};
    let mut devices = Vec::new();
    for who in ["alice","bob","stranger"] {
        let page = snapshot(&mut e,who);
        let counts: Vec<_> = page.events.iter().filter(|event|event.table == "messageCount" || event.table == "dailyCount").collect();
        assert_eq!(counts.len(),if who == "alice" {2} else {0});
        let mut device = Device::open_store(MemoryStore::new(),Some(backend.clone())).unwrap();
        device.apply(&page,true).unwrap();
        devices.push((who,device,page.watermark));
    }
    let compare = |e: &mut Engine, devices: &mut Vec<(&str,Device<MemoryStore>,u64)>, authorized: Option<&str>, expected: i64| {
        for (who,device,_) in devices {
            let server = e.query("total",ctx(who,&[("conversationId",id("secret"))])).unwrap();
            let local = device.query("total",who,&json!({"conversationId":"secret"}),86_400_010).unwrap();
            assert!(server.complete && local.complete,"{who}: {server:?} {local:?}");
            let value = Value::Int(if Some(*who) == authorized {expected} else {0});
            assert_eq!(server.data,value,"online {who}");
            assert_eq!(local.data,value,"device {who}");
            for result in [e.query("ranked",ctx(who,&[])).unwrap(),device.query("ranked",who,&json!({}),86_400_010).unwrap()] {
                // An unpinned private scan may be incomplete; its rows must still authorize.
                assert_eq!(result.data.as_array().unwrap().len(),usize::from(Some(*who) == authorized));
            }
        }
    };
    compare(&mut e,&mut devices,Some("alice"),1);
    write(&mut e,"send","alice",&[("id",id("m2")),("conversationId",id("secret"))]);
    for (who,device,watermark) in &mut devices {
        let page = stream(&mut e,who,*watermark);
        if *who != "alice" {assert!(page.events.iter().all(|event|event.table != "messageCount" && event.table != "dailyCount"));}
        device.apply(&page,false).unwrap();
        *watermark = page.watermark;
    }
    compare(&mut e,&mut devices,Some("alice"),2);
    write(&mut e,"leave","alice",&[("conversationId",id("secret"))]);
    for (who,device,watermark) in &mut devices {
        let page = stream(&mut e,who,*watermark);
        device.apply(&page,false).unwrap();
        *watermark = page.watermark;
    }
    compare(&mut e,&mut devices,None,0);
    assert!(snapshot(&mut e,"alice").events.iter().all(|event|event.table != "messageCount" && event.table != "dailyCount"));
}

#[test]
fn rule_fields_in_extra_probe_equalities_are_not_lost() {
    let source = PRIVATE.replace("  senderId: principal", "  senderId: principal\n  role: text <=10")
        .replace("read <- exists members[.conversationId, viewer]\n  insert <- .senderId", "read <- exists members[conversationId = .conversationId, principal = viewer, role = .role]\n  insert <- .senderId")
        .replace("  sync to members[.conversationId] last 10 by byConversation\n", "");
    let b = compile(&source);
    assert!(b.diagnostics.iter().any(|d|d.code == "E_MAINTAIN_READ_RULE" && d.message.contains(".role")),"{:?}",b.diagnostics);
}

#[test]
fn column_audience_rules_survive_calendar_grouping_and_service_grants() {
    use snapback4_core::schema::{Audience, Sync};
    for rule in [".owner = viewer", ".owner = viewer or viewer = 'service:ranker'"] {
        for calendar in [false,true] {
            let keys = if calendar { "owner, day(.at)" } else { "owner" };
            let lookup = if calendar { "owner, day(now)" } else { "owner" };
            let time_column = if calendar { "  at: time\n" } else { "" };
            let source = format!("table entries:\n  owner: principal\n{time_column}  by byOwner: owner, id\n  read <- {rule}\n  sync to .owner\nmaintain totals: count entries by {keys}\nquery total(owner: principal):\n  return totals[{lookup}]\n");
            let b = bound(&source);
            let target = &b.schema.tables["totals"];
            assert_eq!(target.rules.read.quarry(),rule);
            assert_eq!(target.rules.read,b.schema.tables["entries"].rules.read);
            assert_eq!(target.sync,Some(Sync {audience:Audience::Column("owner".into()),horizon:None}));
            assert_eq!(target.residency.inherited_from.as_deref(),Some("entries"));
            let mut e = engine(&source);
            let mut row = json!({"id":"entry","owner":"alice"});
            if calendar { row["at"] = json!(86_400_001); }
            let row = wire::row_from_json(e.schema().table("entries").unwrap(),&row).unwrap();
            e.seed_at(vec![("entries".into(),row)],86_400_010).unwrap();
            for (who,allowed) in [("alice",true),("bob",false),("service:ranker",rule.contains("service:ranker"))] {
                let answer = e.query("total",ctx(who,&[("owner",id("alice"))])).unwrap();
                assert!(answer.complete && answer.cut.is_none());
                assert_eq!(answer.data,Value::Int(i64::from(allowed)),"{rule}; {keys}; {who}");
                let (events,_) = e.snapshot_at(who,86_400_010).unwrap();
                assert_eq!(events.iter().filter(|event|event.table == "totals").count(),usize::from(who == "alice"),"a service grant adds no device audience");
            }
        }
    }
}
