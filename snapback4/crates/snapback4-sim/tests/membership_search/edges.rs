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
    // Each ceiling lies inside the window where the ordinary read completes and
    // the compact refill cannot: 16,768,717 B and 48 KiB. They were 16 MiB
    // and 64 KiB while SQLite also charged its 8 KiB column reserve (LLP 3000.007 §20.24.5).
    for (body,witness,heap) in [(4_000,Some(1_045_950),16_768_717),(1_023_557,None,48 << 10)] {
        let mut e=tiny_payload_engine(body,witness);
        e.set_ceilings(Ceilings {heap_bytes:heap,..Ceilings::default()});
        let old=e.query("control",cx("cof",None)).unwrap();
        assert!(old.complete,"{old:?}");
        assert_eq!(ids(&old.data),["hit"]);
        assert!(!complete_or_refused(&mut e,heap),"the compact refill exceeds its remaining heap");
    }
}

// Compute the retained boundaries from a completed page. The merge charges
// its rows, the generated binding charges the array + rows, and reading that
// binding copies only the array (row maps are shared). With no returned shape,
// cursor/page reservation is the last charge before the merge result.
fn delivery_sweep(e: &mut Engine, expected: &[&str]) {
    e.set_ceilings(Ceilings {heap_bytes:64 << 20,output_bytes:16 << 20,..Ceilings::default()});
    let page=e.query("newest",cx("cof",None)).unwrap();
    assert!(page.complete,"{page:?}");
    assert_eq!(ids(&page.data),expected);
    let next=page.next.clone();
    let Value::Array(rows)=&page.data else {panic!("array page")};
    let row_bytes: u64=rows.iter().map(|row| 40 + row.as_object().unwrap().iter().map(|(key,value)| {
        let owned=match value {Value::String(s)|Value::Id(s)=>s.capacity() as u64,_=>0};
        80 + key.capacity() as u64 + owned
    }).sum::<u64>()).sum();
    let copy=rows.len() as u64 * std::mem::size_of::<Value>() as u64;
    // These fixtures have one or two hits, and explicit growth retains exactly
    // one/two slots before the final clone tightens the returned Vec.
    let binding=copy+row_bytes;
    let final_copy=page.metered.heap_bytes;
    let bound_binding=final_copy-copy;
    let bound_result=bound_binding-binding;
    let bound_cursor=bound_result-row_bytes;
    for (name,boundary) in [("cursor",bound_cursor),("result",bound_result),("binding",bound_binding),("final copy",final_copy)] {
        let mut completed=0;
        for heap in boundary.saturating_sub(copy+1)..=boundary+1 {
            e.set_ceilings(Ceilings {heap_bytes:heap,output_bytes:16 << 20,..Ceilings::default()});
            match e.query("newest",cx("cof",None)) {
                Ok(page)=>{assert!(page.complete,"{name} boundary={boundary}, heap={heap}: {page:?}");assert_eq!(ids(&page.data),expected);assert_eq!(page.next,next,"{name} heap={heap}: continuation is unchanged");completed+=1;}
                Err(why)=>{assert_eq!(why.code,"E_SEARCH_OPEN","{name} boundary={boundary}, heap={heap}: {why}");assert!(why.message.contains("heap bytes"),"{why}");}
            }
        }
        eprintln!("byte sweep {name}: {}..={}, complete={completed}",boundary.saturating_sub(copy+1),boundary+1);
    }
}

#[test]
fn eligible_heap_ceiling_sweep_never_returns_a_heap_null_page() {
    for (body,witness) in [(1_023_557,None),(4_000,Some(1_045_950))] {
        let mut e=tiny_payload_engine(body,witness);
        // Locate the active admission boundary, which can be a transient
        // witness reservation above the final retained charge, then visit every
        // byte around it instead of skipping 512/1,024-byte intervals.
        let (mut low,mut high)=(2_048,32 << 20);
        while low+1<high {let mid=(low+high)/2;if complete_or_refused(&mut e,mid){high=mid}else{low=mid}}
        for heap in low-64..=high+64 {assert_eq!(complete_or_refused(&mut e,heap),heap>=high,"heap={heap}, boundary={high}");}
        eprintln!("byte sweep admission body={body} witness={witness:?}: {}..={}",low-64,high+64);
        delivery_sweep(&mut e,&["hit"]);
    }
    delivery_sweep(&mut default_engine(false),&["hit"]);
}

#[test]
fn final_result_copy_preserves_the_compact_refusal() {
    let mut e=default_engine(false);
    for heap in 3_025_040..=3_025_073 {complete_or_refused(&mut e,heap);}
}

#[test]
fn cursor_delivery_boundaries_never_return_null() {
    let mut e=default_engine_rows(false,3);
    e.set_ceilings(Ceilings {output_bytes:16 << 20,..Ceilings::default()});
    let page=e.query("newest",cx("cof",None)).unwrap();
    assert!(page.next.is_some(),"exercise a real output cursor");
    let expected=ids(&page.data);
    delivery_sweep(&mut e,&expected.iter().map(String::as_str).collect::<Vec<_>>());
}

#[test]
fn stored_megabyte_payload_overflow_refuses_after_internal_emission() {
    // Sizes past the logical heap threshold at the default 16 MiB; they were
    // 1.9-2.2 MB while SQLite also charged two preflight payload copies
    // (LLP 3000.007 §20.24.5). 18,216,630 is 2.6 MB's last refusing ceiling.
    for size in [2_600_000,2_700_000,3_000_000] {
        let b=snapback4_lang::compile(&[("schema.q".into(),SOURCE.replace("  expire at .until\n", "").replace("text <=20000", &format!("text <={size}")))]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
        e.seed_at(vec![
            ("members".into(),object([("id",id("m")),("room",id("r")),("principal",id("alice"))])),
            ("messages".into(),object([("id",id("hit")),("room",id("r")),("body",Value::String("coffee".into())),
                ("payload",Value::String("p".repeat(size))),("at",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)])),
        ],100).unwrap();
        assert!(!complete_or_refused(&mut e,16 << 20));
        if size==2_600_000 {
            assert!(!complete_or_refused(&mut e,18_216_630));
            delivery_sweep(&mut e,&["hit"]);
        }
    }
}

fn default_engine(witness: bool) -> Engine { default_engine_rows(witness,1) }

fn default_engine_rows(witness: bool, count: usize) -> Engine {
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
    for n in 2..=count {
        let mut extra=rows[1].1.clone();
        if let Value::Row(fields)=&mut extra {fields.insert("id".into(),id(&format!("hit{n}")));fields.insert("at".into(),Value::Int(n as i64));}
        rows.push(("messages".into(),extra));
    }
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
    // Both were 8-9 KB higher while SQLite's column reserve and preflight copies stayed on the meter (LLP 3000.007 §20.24.5).
    assert_eq!(new.metered.heap_bytes,3_016_535,"exact retained compact ownership");
    assert_eq!(old.metered.heap_bytes,3_025_663,"exact retained control ownership");
    eprintln!("3,600,000-byte heap: compact={}, control={}",new.metered.heap_bytes,old.metered.heap_bytes);
    assert!(!complete_or_refused(&mut e,64 << 10));
}

#[test]
fn public_witness_default_must_fit_before_materialization() {
    let mut e=default_engine(true);
    assert!(!complete_or_refused(&mut e,64 << 10),"a million-byte public witness cannot fit in 64 KiB");
    assert!(!complete_or_refused(&mut e,200_000),"an 80,000-byte default placeholder cannot authorize a million-byte copy");
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
        // The repaired grouped search may carry lane UB's N_SHAPE_METER advice; nothing else.
        assert!(b.diagnostics.is_empty() && b.notes.iter().all(|n| n.code=="N_SHAPE_METER"),"{rewrite}: {:?} {:?}",b.diagnostics,b.notes);
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

fn witness_engine(note: Option<&str>, title: usize, literal: bool) -> Engine {
    let source=format!(r#"
table members:
  room: id
  principal: principal
  unique room, principal
  read <- .principal = viewer
table rooms:
  title: text <=2000000
{}  read <- allow
table messages:
  room: id
  body: text <=100
  at: time
  search body
  read <- exists rooms[.room]
query newest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.room, viewer] last 2 by .at after c
"#,if note.is_some(){"  note: text <=1000000\n"}else{""});
    let b=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut room=object([("id",id("r")),("title",Value::String("t".repeat(title)))]);
    if let (Some(note),Value::Row(fields))=(note,&mut room) {fields.insert("note".into(),Value::String(note.into()));}
    e.seed_at(vec![
        ("rooms".into(),room),
        ("members".into(),object([("id",id("m")),("room",id("r")),("principal",id("alice"))])),
        ("messages".into(),object([("id",id("hit")),("room",id("r")),("body",Value::String("coffee".into())),
            ("at",Value::Int(1))])),
    ],100).unwrap();
    let field=if literal {format!("  note: text <=1000000 default '{}'\n","n".repeat(1_000_000))} else {"  note: text <=1000000 ?\n".into()};
    let source=source.replace("  note: text <=1000000\n", "").replace("table rooms:\n",&format!("table rooms:\n{field}"));
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e
}

#[test]
fn stored_public_witness_field_does_not_reserve_its_unused_default() {
    let mut e=witness_engine(Some("hi"),0,true);
    e.set_ceilings(Ceilings {heap_bytes:64 << 10,..Ceilings::default()});
    let page=e.query("newest",cx("cof",None)).unwrap();
    assert!(page.complete,"{page:?}");
    assert_eq!(ids(&page.data),["hit"]);
}

#[test]
fn public_witness_materialization_uses_actual_stored_fields_and_active_ceiling() {
    assert!(!complete_or_refused(&mut witness_engine(None,1_500_000,true),1_200_000));
    assert!(!complete_or_refused(&mut witness_engine(None,1_500_000,false),64 << 10));
}


