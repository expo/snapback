use super::*;
use crate::{Context, Engine, Ceilings, Schema, Program, meter::{Meter, Cut}};
#[test]
fn live_basis_walk_charges_only_live_inputs_on_its_internal_ledger() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    // Also builds with --features postgres, where the compiler's core is a separate crate instance.
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let programs: Vec<Program> = crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>()).unwrap()).unwrap();
    let mut e = Engine::memory(schema, programs).unwrap();
    let member = object([("id",Value::Id("b".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("bob".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]);
    let mut rows = vec![("members".into(), member.clone())];
    for n in 0..3 {
        rows.push(("messages".into(), object([("id",Value::Id(format!("m{n}"))),("conversationId",Value::Id("c".into())),("senderId",Value::Id("alice".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Int(10))])));
    }
    for n in 0..2 {
        rows.push(("messages".into(), object([("id",Value::Id(format!("live{n}"))),("conversationId",Value::Id("c".into())),("senderId",Value::Id("alice".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)])));
    }
    e.seed_at(rows, 1).unwrap();
    let schema = e.schema().clone();
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    let mut r = Runner::new(&tx, &schema, Context::system().at(10), Meter::new(Ceilings::default(),Cut::Abort), 0);
    let (n, complete, _) = r.live_basis_scan(m, &member, None, 8).unwrap();
    assert_eq!((n,complete), (2,true));
    assert_eq!(r.meter.used.examined, 4);
    assert!(r.meter.used.steps > 0);
    for (kind, ceilings) in [
        (MeterKind::Examined, Ceilings { examined: 2, ..Default::default() }),
        (MeterKind::Steps, Ceilings { steps: 1, ..Default::default() }),
    ] {
        let mut bounded = Runner::new(&tx, &schema, Context::system().at(10), Meter::new(ceilings,Cut::Abort), 0);
        let result = bounded.live_basis_scan(m, &member, None, 8);
        assert!(matches!(result, Err(RuntimeError::Bound { kind: actual, .. }) if actual == kind), "unmetered live walk: {result:?}");
    }
}

#[test]
fn member_materialization_is_precharged_and_its_transient_peak_survives_release() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").replace("  expire at .until\n", ""))]);
    assert!(b.diagnostics.is_empty());
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let mut e = Engine::memory(schema, vec![]).unwrap();
    e.seed_at([("members".into(), object([("id",Value::Id("b".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("bob".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]))], 1).unwrap();
    // Simulate a newly adopted default absent from the stored row. Decode is
    // small; materializing the default alone must exceed the smaller allowance.
    let row = e.store().rows("unread").unwrap().pop().unwrap();
    let mut schema = e.schema().clone();
    let table = schema.tables.get_mut("members").unwrap();
    table.columns.insert("note".into(), crate::schema::ColumnType::Text { max: 2 << 20 });
    table.defaults.insert("note".into(), crate::schema::ColumnDefault::Literal(Value::String("x".repeat(2 << 20))));
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    for allowance in [1 << 20, 64 << 20] {
        let mut r = Runner::new(&tx, &schema, Context::new("bob", Default::default()).at(1), Meter::new(Ceilings { heap_bytes: allowance, ..Default::default() }, Cut::Cap), 0);
        let result = r.live_row_view(m, row.clone());
        if allowance == 1 << 20 {
            assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })), "{result:?}");
            assert!(r.meter.capped_at.is_some());
        } else {
            assert!(result.unwrap().is_some());
            let mut materialized=Runner::new(&tx,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings {heap_bytes:allowance,..Default::default()},Cut::Cap),0);
            assert!(materialized.row_view_member_image(m,&row).unwrap().is_some());
            assert!(materialized.meter.used.heap_bytes>2<<20,"authorized materialization must be priced after the fixed scratch is released");
        }
        assert!(r.meter.heap_peak > 2 << 20);
        assert_eq!(r.meter.used.heap_bytes, 0);
    }
}

#[test]
fn live_basis_reservation_is_identical_for_pending_and_zero_expired_reads() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let mut e = Engine::memory(schema, vec![]).unwrap();
    e.seed_at([("members".into(), object([("id",Value::Id("a".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("alice".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]))], 1).unwrap();
    e.seed_at((0..1200).map(|n|("messages".into(),object([("id",Value::Id(format!("live{n}"))),("conversationId",Value::Id("c".into())),("senderId",Value::Id("bob".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)]))),1).unwrap();
    let row = e.store().rows("unread").unwrap().pop().unwrap();
    let schema = e.schema().clone();
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    let mut meters=Vec::new();
    for pending in [false,true] {
        let mut image=row.as_object().unwrap().clone();
        image.insert("recountPending".into(),Value::Bool(pending));
        let mut r=Runner::new(&tx,&schema,Context::new("alice",Default::default()).at(10),Meter::new(Ceilings::default(),Cut::Cap),0);
        assert!(r.live_row_view(m,Value::Row(image.into())).unwrap().is_some());
        assert!(!r.timeline_pending);
        // One authorized member reservation, one live-basis reservation.
        assert_eq!(r.meter.used.examined,2);
        assert_eq!(r.meter.used.steps,1);
        meters.push((r.meter.used,r.meter.heap_peak,r.meter.capped_at));
    }
    assert_eq!(meters[0],meters[1]);
}

#[test]
fn private_expiry_chunks_keep_durable_cursor_edits_and_restart() {
    use crate::wire;
    use serde_json::json;
    for file in [false,true] {
        let source=include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").to_owned()
            + "\nmutation extend(message: messages, until: time):\n  update messages[message] { until: until }\n";
        let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let schema: Schema=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
        let programs: Vec<Program>=crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>()).unwrap()).unwrap();
        let path=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target").join(format!("b3-r7-cursor-{}.sqlite",std::process::id()));
        let store=if file {let _=std::fs::remove_file(&path); crate::Store::open(&path).unwrap()} else {crate::Store::memory().unwrap()};
        let mut e=Engine::new(store,schema.clone(),programs.clone()).unwrap();
        let mut rows=(0..1200).map(|n|("messages".into(),wire::row_from_json(&schema.tables["messages"],&json!({"id":format!("m{n:05}"),"conversationId":"c","ordinal":5,"senderId":"bob","tombstone":false,"until":if n<600 {10} else {20}})).unwrap())).collect::<Vec<_>>();
        rows.push(("members".into(),wire::row_from_json(&schema.tables["members"],&json!({"id":"a","conversationId":"c","principal":"alice","readUpTo":0,"joinedAt":0})).unwrap()));
        e.seed_at(rows,1).unwrap();
        let base=e.seq().unwrap();
        {
            let tx=e.store_mut().transaction().unwrap();
            let m=&schema.maintains[0];
            let work=tx.get(&m.work_table(),"a").unwrap().unwrap();
            let mut runner=Runner::new(&tx,&schema,Context::system().at(2),Meter::new(Ceilings::job(),Cut::Abort),0);
            runner.recount_chunk(m,&work).unwrap();
            assert!(runner.meter.used.examined<=RECOUNT_CHUNK as u64+4);
            drop(runner);tx.commit().unwrap();
        }
        let work=e.store().rows("$recount:unread").unwrap();
        let prefix=number(&work[0],"total");
        assert!(prefix>0 && prefix<=RECOUNT_CHUNK as i64);
        assert_eq!(number(&work[0],"deadline"),10);
        if file {drop(e);e=Engine::new(crate::Store::open(&path).unwrap(),schema,programs).unwrap();}
        let result=e.mutate("extend",None,Context::new("alice",std::collections::BTreeMap::from([("message".into(),Value::Id("m00000".into())),("until".into(),Value::Int(30))])).at(2)).unwrap();
        assert!(matches!(result.state,crate::WriteState::Sent{..}),"{result:?}");
        assert_eq!(number(&e.store().rows("$recount:unread").unwrap()[0],"total"),prefix-1);
        while let Some(chunk)=e.run_view_chunk(10).unwrap() { assert!(matches!(chunk, ViewChunk::Private)); }
        assert_eq!(e.seq().unwrap(),base+1,"only the source edit publishes a commit");
        assert_eq!(number(&e.store().rows("unread").unwrap()[0],"value"),601);
        while e.sweep_expired(10,100).unwrap()>0 {}
        assert_eq!(number(&e.store().rows("unread").unwrap()[0],"value"),601);
        drop(e);if file {std::fs::remove_file(path).unwrap();}
    }
}

#[test]
fn numeric_view_witness_certifies_before_comparing_a_stored_value() {
    let b=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    let schema:Schema=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    for file in [false,true] {
        let path=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target").join(format!("b3-r7-numeric-{}.sqlite",std::process::id()));
        let store=if file {let _=std::fs::remove_file(&path);crate::Store::open(&path).unwrap()} else {crate::Store::memory().unwrap()};
        let mut e=Engine::new(store,schema.clone(),vec![]).unwrap();
        e.seed_at([
            ("members".into(),object([("id",Value::Id("a".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("alice".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))])),
            ("messages".into(),object([("id",Value::Id("m".into())),("conversationId",Value::Id("c".into())),("senderId",Value::Id("bob".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Int(10))])),
        ],1).unwrap();
        assert_eq!(number(&e.store().rows("unread").unwrap()[0],"value"),1);
        let tx=e.store_mut().transaction().unwrap();
        for (now,expected) in [(9,1),(10,0)] {
            for (value, present) in [(expected,true),(1-expected,false)] {
                let mut runner=Runner::new(&tx,&schema,Context::new("alice",Default::default()).at(now),Meter::new(Ceilings::default(),Cut::Cap),0);
                assert_eq!(runner.authorized_scan(&[], |runner,scope| runner.probe_witness(scope,"unread","byId",&[Value::Id("a".into())],&[("value".into(),Value::Int(value))],false)).unwrap(),(present,true));
            }
        }
        drop(tx);drop(e);if file {std::fs::remove_file(path).unwrap();}
    }
}

#[test]
fn exact_expiring_cursor_delete_survives_private_chunk_reopen_and_sweep() {
    use crate::wire;
    use serde_json::json;
    let b=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    let schema:Schema=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let programs:Vec<Program>=crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>()).unwrap()).unwrap();
    let observations=[false,true].map(|delete_between_chunks| {
        let path=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/landing-cursor-{}-{delete_between_chunks}.sqlite",std::process::id()));
        let _=std::fs::remove_file(&path);
        let mut e=Engine::new(crate::Store::open(&path).unwrap(),schema.clone(),programs.clone()).unwrap();
        let mut rows=(0..1200).map(|n|("messages".into(),wire::row_from_json(&schema.tables["messages"],&json!({"id":format!("m{n:05}"),"conversationId":"c","ordinal":5,"senderId":"bob","tombstone":false,"until":20})).unwrap())).collect::<Vec<_>>();
        rows.push(("members".into(),wire::row_from_json(&schema.tables["members"],&json!({"id":"a","conversationId":"c","principal":"alice","readUpTo":0,"joinedAt":0})).unwrap()));
        e.seed_at(rows,1).unwrap();
        let base=e.seq().unwrap();
        assert!(matches!(e.run_view_chunk(2).unwrap(),Some(ViewChunk::Private)));
        assert_eq!(e.seq().unwrap(),base);
        let work=e.store().rows("$recount:unread").unwrap().pop().unwrap();
        let prefix=number(&work,"total");assert!(prefix>0 && prefix<=RECOUNT_CHUNK as i64);
        let cursor=work.field("cursor").unwrap().as_array().unwrap();
        let last=cursor.last().unwrap().clone();
        let remove=|e:&mut Engine| {
            let out=e.mutate("remove",None,Context::new("alice",[("message".into(),last.clone())].into()).at(2)).unwrap();
            assert!(matches!(out.state,crate::WriteState::Sent{..}),"{out:?}");
        };
        if delete_between_chunks {
            remove(&mut e);
            assert_eq!(number(&e.store().rows("$recount:unread").unwrap()[0],"total"),prefix-1);
        }
        drop(e);let mut e=Engine::open(crate::Store::open(&path).unwrap()).unwrap();
        let mut chunks=0;
        while let Some(chunk)=e.run_view_chunk(2).unwrap() {
            assert!(matches!(chunk,ViewChunk::Private));chunks+=1;assert!(chunks<10);
        }
        assert!(chunks>=3,"one call must not drain the private backlog");
        if !delete_between_chunks {remove(&mut e);}
        let count=number(&e.store().rows("unread").unwrap()[0],"value");assert_eq!(count,1199);
        let seq=e.seq().unwrap();assert_eq!(seq,base+1);
        while e.sweep_expired(20,100).unwrap()>0 {}
        assert_eq!(number(&e.store().rows("unread").unwrap()[0],"value"),0);
        drop(e);std::fs::remove_file(path).unwrap();
        (count,seq)
    });
    assert_eq!(observations[0],observations[1]);
}
