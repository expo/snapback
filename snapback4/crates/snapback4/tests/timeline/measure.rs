use super::common::*;
use snapback4_core::{Value,WriteState,schema::ColumnType,value::{object,canonical_json}};

/// Every owned column has a fixed bound; IDs use the engine's 144-byte
/// canonical tagged identity limit (135 unescaped bytes). App row widths
/// are deliberately separate and remain charged by the ordinary write path.
#[test]
fn owned_row_and_index_byte_bounds_and_measured_transitions() {
    let e=engine(true);
    for name in OWNED {
        let table=&e.schema().tables[name];
        for principal in ["x".repeat(135),format!("{}x","\\".repeat(67))] {
            let mut fields=table.columns.iter().map(|(name,kind)| {
                let value=match kind {
                    ColumnType::Id | ColumnType::Principal | ColumnType::Ref{..}=>id(&principal),
                    ColumnType::Bool=>Value::Bool(false),
                    ColumnType::Int|ColumnType::Time=>Value::Int(snapback4_core::value::I53_MIN),
                    _=>panic!("unpriced timeline field {name}: {kind:?}"),
                };(name.clone(),value)
            }).collect::<std::collections::BTreeMap<_,_>>();
            fields.insert("id".into(),if name=="feedPosts" {id(&principal)} else {id(&snapback4_core::schema::timeline::owned_id("feed",name.strip_prefix("feed").unwrap(),&[id(&principal)]))});
            let row=Value::Row(fields.into());let identity=row.field("id").unwrap().as_str().unwrap();
            assert!(snapback4_core::value::identity_fits(identity));
            if name!="feedPosts" {assert_eq!(identity.len(),64);assert!(identity.bytes().all(|b|b.is_ascii_hexdigit()));}
            let keys:Vec<_>=table.indexes.values().flat_map(|i|snapback4_core::rows::index_keys(i,&row,identity)).collect();
            assert!(!keys.is_empty());assert!(keys.iter().all(|k|k.len()<=snapback4_core::rows::MAX_INDEX_KEY_BYTES));
            let tagged=canonical_json(&row).len();let wire=serde_json::to_vec(&snapback4_core::wire::to_json(&row)).unwrap().len();
            // All current owned schemas fit this conservative envelope, well
            // inside the mutation's heap/output ceilings.
            assert!(tagged<=2048 && wire<=2048,"{name}: {tagged}/{wire}");
            println!("ROW {name}: indexes={}, tagged_json={tagged}, wire_json={wire}, index_key_bytes={}",keys.len(),keys.iter().map(Vec::len).sum::<usize>());
        }
    }
    let mut p=Pair::new();p.register("a");p.register("r");
    for n in 0..5 {p.register(&format!("f{n}"));p.follow(&format!("f{n}"),"a");}
    for (op,viewer,args) in [("publish","a",vec![("postId",id("first"))]),("follow","r",vec![("authorId",id("a"))]),("remove","a",vec![("postId",id("first"))]),("unfollow","r",vec![("authorId",id("a"))])] {
        let result=p.sent(op,viewer,&args);
        for (name,out) in ["recipe","F3"].into_iter().zip(&result) {println!("OP {name} {op}: {:?}",out.metered);}
    }
    p.equal();
}

#[test]
fn purge_chunks_over_1001_copies_preserve_live_rows() {
    let mut snapshots=Vec::new();
    for declared in [false,true] {
        let mut e=engine(declared);
        let tombstone=|event:&str|object([("id",id(&if declared {snapback4_core::schema::timeline::owned_id("feed","RemovedEvents",&[id(event)])} else {event.into()})),("eventId",id(event)),("actorId",id("a"))]);
        let copy=|n:usize,event:&str|object([("id",id(&if declared {snapback4_core::schema::timeline::owned_id("feed","Feed",&[id(&format!("r{n}")),id(event)])} else {format!("copy-{event}-{n}")})),("readerId",id(&format!("r{n}"))),("eventId",id(event)),("actorId",id("a")),("authorId",id("a")),("postId",id(event)),("repost",Value::Bool(false)),("at",Value::Int(1))]);
        let mut images=vec![("feedRemovedEvents".into(),tombstone("removed-a")),("feedRemovedEvents".into(),tombstone("removed-b")),("feedFeed".into(),copy(0,"live"))];
        for n in 0..1001 {images.push(("feedFeed".into(),copy(n,"removed-a")));}
        for n in 0..2 {images.push(("feedFeed".into(),copy(n,"removed-b")));}
        e.load_trusted(images).unwrap();assert_eq!(rows(&e,"feedFeed").len(),1004);assert_eq!(rows(&e,"feedRemovedEvents").len(),2);
        let job=e.schema().schedules.iter().find(|s|s.target.ends_with("PurgeRemoved")).unwrap().target.clone();
        e.enqueue_job(&job,Default::default(),2).unwrap();let run=e.run_job_chunk(2).unwrap().unwrap();
        assert_eq!(run.rows_written,1002);assert_eq!(run.chunks,1);
        assert_eq!(rows(&e,"feedFeed").len(),3);assert_eq!(rows(&e,"feedRemovedEvents").len(),1);
        assert!(rows(&e,"feedFeed").iter().all(|r|r.field("eventId").unwrap()!=&id("removed-a")));
        let run=e.run_job_chunk(3).unwrap().unwrap();assert_eq!(run.rows_written,1005);assert_eq!(run.chunks,2);
        assert_eq!(rows(&e,"feedFeed"),vec![copy(0,"live")]);assert!(rows(&e,"feedRemovedEvents").is_empty());
        snapshots.push(normalized(&e));
    }
    assert_eq!(snapshots[0],snapshots[1]);
}

#[test]
fn eager_registration_cap_rolls_back_the_application_profile() {
    let mut p=Pair::new();for n in 0..1000 {p.register(&format!("a{n}"));}
    let before=normalized(&p.declared);let out=p.step("register","excess",&[]);
    assert!(matches!(&out[0].state,WriteState::Failed{why,..} if why.code=="E_CONSTRAINT"));
    assert_eq!(normalized(&p.declared),before);p.equal();
}
