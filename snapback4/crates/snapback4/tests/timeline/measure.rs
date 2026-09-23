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
        let mut row=Value::Row(table.columns.iter().map(|(name,kind)| {
            let value=match kind {
                ColumnType::Id | ColumnType::Principal | ColumnType::Ref{..}=>id(&"x".repeat(135)),
                ColumnType::Bool=>Value::Bool(false),
                ColumnType::Int|ColumnType::Time=>Value::Int(snapback4_core::value::I53_MIN),
                _=>panic!("unpriced timeline field {name}: {kind:?}"),
            };(name.clone(),value)
        }).collect());
        if name=="feedPullTotals" {
            if let Value::Row(fields)=&mut row {
                fields.insert("id".into(),id(&snapback4_core::schema::maintained_id(&[id(&"x".repeat(135))])));
            }
        }
        let keys:Vec<_>=table.indexes.values().flat_map(|i|snapback4_core::rows::index_keys(i,&row,row.field("id").unwrap().as_str().unwrap())).collect();
        assert!(keys.iter().all(|k|k.len()<=snapback4_core::rows::MAX_INDEX_KEY_BYTES));
        let mut tagged=canonical_json(&row).len();
        let mut wire=serde_json::to_vec(&snapback4_core::wire::to_json(&row)).unwrap().len();
        if name=="feedPullTotals" {
            // This id is an encoded group key. Its backslashes are escaped a
            // second time in the stored row; ASCII alone is not the byte bound.
            let escaped=format!("{}x", "\\".repeat(67));
            assert!(snapback4_core::value::identity_fits(&escaped));
            if let Value::Row(fields)=&mut row {
                fields.insert("id".into(),id(&snapback4_core::schema::maintained_id(&[id(&escaped)])));
                fields.insert("readerId".into(),id(&escaped));
            }
            tagged=tagged.max(canonical_json(&row).len());
            wire=wire.max(serde_json::to_vec(&snapback4_core::wire::to_json(&row)).unwrap().len());
        }
        println!("ROW {name}: indexes={}, max_tagged_json={tagged}, wire_json={wire}, index_key_bytes={}",keys.len(),keys.iter().map(Vec::len).sum::<usize>());
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
fn purge_one_chunk_handles_1001_private_copies_and_one_tombstone() {
    let mut snapshots=Vec::new();
    for declared in [false,true] {
        let mut e=engine(declared);
        let mut images=vec![("feedRemovedEvents".into(),object([("id",id("removed")),("eventId",id("removed")),("actorId",id("a"))]))];
        for n in 0..1001 {images.push(("feedFeed".into(),object([("id",id(&format!("copy{n}"))),("readerId",id(&format!("r{n}"))),("eventId",id("removed")),("actorId",id("a")),("authorId",id("a")),("postId",id("p")),("repost",Value::Bool(false)),("at",Value::Int(1))])));}
        e.load_trusted(images).unwrap();
        let job=e.schema().schedules.iter().find(|s|s.target.ends_with("PurgeRemoved")).unwrap().target.clone();
        e.enqueue_job(&job,Default::default(),2).unwrap();
        let run=e.run_job_chunk(2).unwrap().unwrap();
        println!("PURGE declared={declared}: {run:?}");
        assert!(rows(&e,"feedFeed").is_empty());assert!(rows(&e,"feedRemovedEvents").is_empty());
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
