use super::*;

fn complete_or_refused(e: &mut Engine, heap: u64) -> bool {
    e.set_ceilings(Ceilings { heap_bytes: heap, ..Ceilings::default() });
    match e.query("newest",cx("cof",None)) {
        Ok(page) => {
            assert!(page.complete, "heap={heap}: {page:?}");
            assert_eq!(ids(&page.data), ["hit"], "heap={heap}: {page:?}");
            true
        }
        Err(why) => {
            assert_eq!(why.code,"E_SEARCH_OPEN","heap={heap}: {why}");
            assert!(why.message.contains("heap bytes"),"{why}");
            false
        }
    }
}

#[test]
fn compact_refill_heap_failure_is_an_explicit_refusal() {
    for (body,witness,heap) in [(4_000,Some(1_045_950),16 << 20),(1_023_557,None,64 << 10)] {
        let mut e=tiny_payload_engine(body,witness);
        e.set_ceilings(Ceilings {heap_bytes:heap,..Ceilings::default()});
        let old=e.query("control",cx("cof",None)).unwrap();
        assert!(old.complete,"{old:?}");
        assert_eq!(ids(&old.data),["hit"]);
        assert!(!complete_or_refused(&mut e,heap),"the compact refill exceeds its remaining heap");
    }
}

#[test]
fn eligible_heap_ceiling_sweep_never_returns_a_heap_null_page() {
    for (body,witness) in [(1_023_557,None),(4_000,Some(1_045_950))] {
        let mut e=tiny_payload_engine(body,witness);
        let heaps: Vec<_> = if witness.is_some() {
            (0..=128).map(|n|(16 << 20) - (64 << 10) + n * 1024).collect()
        } else { (2_048..=256 << 10).step_by(512).collect() };
        let mut completed=0; let mut refused=0;
        for heap in heaps {
            if complete_or_refused(&mut e,heap) { completed+=1; } else { refused+=1; }
        }
        assert!(completed>0 && refused>0,"body={body}: completed={completed}, refused={refused}");
        eprintln!("heap sweep body={body} witness={witness:?}: complete={completed}, refused={refused}");
    }
}

#[test]
fn stored_megabyte_payload_overflow_refuses_after_internal_emission() {
    for size in [1_900_000,2_000_000,2_200_000] {
        let b=snapback4_lang::compile(&[("schema.q".into(),SOURCE.replace("  expire at .until\n", "").replace("text <=20000", &format!("text <={size}")))]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        e.seed_at(vec![
            ("members".into(),object([("id",id("m")),("room",id("r")),("principal",id("alice"))])),
            ("messages".into(),object([("id",id("hit")),("room",id("r")),("body",Value::String("coffee".into())),
                ("payload",Value::String("p".repeat(size))),("at",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)])),
        ],100).unwrap();
        assert!(!complete_or_refused(&mut e,16 << 20));
    }
}

fn default_engine(witness: bool) -> Engine {
    let source=SOURCE.replace("  expire at .until\n", "");
    let source=if witness {
        source.replace("table messages:","table rooms:\n  read <- allow\ntable messages:")
            .replace("  read <- exists members[.room, viewer]\nquery newest", "  read <- exists rooms[.room]\nquery newest")
    } else { source.replace("  payload: text <=20000\n", "") };
    let b=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut row=object([("id",id("hit")),("room",id("r")),("body",Value::String("coffee".into())),
        ("at",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)]);
    if witness { if let Value::Row(fields)=&mut row { fields.insert("payload".into(),Value::String("tiny".into())); } }
    let mut rows=vec![("members".into(),object([("id",id("m")),("room",id("r")),("principal",id("alice"))])),("messages".into(),row)];
    if witness { rows.push(("rooms".into(),object([("id",id("r"))]))); }
    e.seed_at(rows,100).unwrap();
    let (table,field) = if witness {("rooms","note")} else {("messages","payload")};
    let stored=e.store().rows(table).unwrap();
    let source=source.replace(&format!("table {table}:"), &format!("table {table}:\n  {field}: text <=1000000 default '{}'", "p".repeat(1_000_000)));
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let p=&b.programs.iter().find(|p|p.program.name=="newest").unwrap().program;
    assert!(snapback4_lang::bind::merges(&p.body).iter().any(|m|snapback4_core::search_plan::eligible(&b.schema,m)));
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(e.store().rows(table).unwrap(),stored,"default remains omitted from storage");
    e
}

#[test]
fn adopted_default_prepay_is_replaced_by_the_retained_row_charge() {
    let mut e=default_engine(false);
    e.set_ceilings(Ceilings {heap_bytes:3_600_000,..Ceilings::default()});
    let old=e.query("control",cx("cof",None)).unwrap();
    let new=e.query("newest",cx("cof",None)).unwrap();
    assert!(old.complete && new.complete,"old={:?}, new={:?}",old.metered,new.metered);
    assert_eq!(ids(&new.data),["hit"]);
    assert_eq!(new.data,old.data);
    assert_eq!(new.data.as_array().unwrap()[0].field("payload").unwrap().as_str().unwrap().len(),1_000_000);
    eprintln!("3,600,000-byte heap: compact={}, control={}",new.metered.heap_bytes,old.metered.heap_bytes);
    assert!(!complete_or_refused(&mut e,64 << 10));
}

#[test]
fn public_witness_default_must_fit_before_materialization() {
    let mut e=default_engine(true);
    assert!(!complete_or_refused(&mut e,64 << 10),"a million-byte public witness cannot fit in 64 KiB");
    let old=e.query("control",cx("cof",None)).unwrap();
    assert!(old.unavailable && !old.complete,"public witness default cannot evade the ordinary meter: {:?}",old.metered);
    assert!(complete_or_refused(&mut e,16 << 20));
}

#[test]
fn carriage_return_search_text_withholds_the_runtime_repair() {
    let mut e=setup(1,1);
    e.set_ceilings(Ceilings {heap_bytes:2_000,..Ceilings::default()});
    let why=e.query("newest",cx("cof\r",None)).unwrap_err();
    assert_eq!(why.code,"E_SEARCH_OPEN");
    if let Some(rewrite)=&why.rewrite {
        let source=format!("{}\nquery repaired(q: text <=100, c: cursor ?):\n  {rewrite}\n",SOURCE.split("query newest").next().unwrap());
        let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(b.diagnostics.is_empty(),"{rewrite:?}: {:?}",b.diagnostics);
    }
    assert!(why.rewrite.is_none(),"Quarry cannot represent a carriage return: {why}");
    assert_eq!(why.guide.as_deref(),Some("search"));
}

#[test]
fn calendar_repair_executes_the_same_offset_boundary_predicate() {
    for (calendar,period,offset) in [("day(.at, 8h)",86_400_000,28_800_000),("hour(.at, 30m)",3_600_000,1_800_000),("bucket(.at, 2m, 1s)",120_000,1_000)] {
        let source=SOURCE.replace("  expire at .until\n", "").replace("last 2 by .at", "last 20 by .at")
            .replace("not .tombstone and exists",&format!("not .tombstone and {calendar} = 0 and exists"));
        let b=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        let mut rows=Vec::new();
        let times=[offset-period-1,offset-period,offset-1,offset,offset+1,offset+period-1,offset+period];
        for (n,at) in times.into_iter().enumerate() {
            let room=format!("r{n}");
            rows.push(("members".into(),object([("id",id(&room)),("room",id(&room)),("principal",id("alice"))])));
            rows.push(("messages".into(),object([("id",id(&room)),("room",id(&room)),("body",Value::String("coffee".into())),
                ("payload",Value::String("tiny".into())),("at",Value::Int(at)),("tombstone",Value::Bool(false)),("until",Value::Null)])));
        }
        e.seed_at(rows.clone(),100).unwrap();
        let original=e.query("newest",cx("cof",None)).unwrap();
        assert!(original.complete,"{original:?}");
        assert_eq!(ids(&original.data),["r5","r4","r3"],"{calendar}");
        e.set_ceilings(Ceilings {index_entries:1,..Ceilings::default()});
        let why=e.query("newest",cx("cof",None)).unwrap_err();
        assert_eq!(why.code,"E_SEARCH_OPEN");
        let rewrite=why.rewrite.unwrap();
        let source=format!("{}\nquery repaired(q: text <=100, c: cursor ?):\n  {rewrite}\n",source.split("query newest").next().unwrap());
        let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(b.diagnostics.is_empty() && b.notes.is_empty(),"{rewrite}: {:?} {:?}",b.diagnostics,b.notes);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        e.seed_at(rows,100).unwrap();
        let repaired=e.query("repaired",cx("cof",None)).unwrap();
        assert!(repaired.complete,"{repaired:?}");
        let groups=repaired.data.as_array().unwrap();
        assert_eq!(groups.iter().map(|g|g.field("room").unwrap().as_str().unwrap()).collect::<Vec<_>>(),["r3","r4","r5"],"{calendar}: {rewrite}");
        for group in groups {
            assert_eq!(ids(group.field("hits").unwrap()),[group.field("room").unwrap().as_str().unwrap()],"{calendar}");
        }
    }
}
