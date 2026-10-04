//! Runtime reservations: deterministic schema families, not copies of charge formulas.
use super::*;
fn base(label: &str, receipts: bool) -> Case {
    let mut c=make(label.into(),receipts,0,false,usize::from(receipts),false,true,0,1,0);
    c.source.truncate(c.source.rfind("\nmutation burst").unwrap());
    c.writes=usize::from(receipts);
    c
}
fn body(c: &mut Case, signature: &str, body: &str) {
    c.source+=&format!("\nmutation burst({}{}):\n{}{}",if c.receipts {"conversation: conversations"}else{""},
        if signature.is_empty(){String::new()}else{format!("{}{signature}",if c.receipts {", "}else{""})},
        if c.receipts {"  insert messages { conversation, shelf: 's', sender: viewer, text: 'burst', photo: null, shots: null, at: now }\n"}else{""},body);
}
fn owners(receipts: bool,n:usize,columns:usize) -> Case {
    let mut c=base(&format!("r4-owners-r{receipts}-n{n}-c{columns}"),receipts);
    if receipts {c.source=c.source.replace("table notes:\n  public","table notes:\n  shelf: shelves ?\n  public");}
    let cols=(0..columns).map(|i|format!("  total{i}: count notes by .shelf\n")).collect::<String>();
    c.source=c.source.replace("table shelves:\n",&format!("table shelves:\n{cols}"));
    body(&mut c,"",&format!("  for n in range(0, {n}):\n    insert shelves {{}}\n"));
    c.writes+=n;c
}
fn sequences(receipts:bool,n:usize,indexes:usize) -> Case {
    let mut c=base(&format!("r4-sequence-r{receipts}-n{n}-i{indexes}"),receipts);
    c.source+="\ntable sequenced:\n  parent: shelves\n  ordinal: sequence by parent\n";
    for i in 0..indexes {c.source+=&format!("  mark{i}: int default 0\n  by ix{i}: mark{i}\n");}
    c.source+="  public\n  insert <- allow\n  sync public\n";
    body(&mut c,"",&format!("  for n in range(0, {n}):\n    insert sequenced {{ parent: 's' }}\n"));
    c.writes+=n;c
}
fn parents(receipts:bool,n:usize,children:usize) -> Case {
    let mut c=base(&format!("r4-parent-delete-r{receipts}-n{n}-c{children}"),receipts);
    c.source+="\ntable parents:\n  public\n  insert <- allow\n  delete <- allow\n  sync public\n";
    for i in 0..children {c.source+=&format!("\ntable child{i}:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- allow\n  sync\n");}
    for i in 0..n {let key=id(&format!("p{i}"));c.keys.push(key.clone());c.seeds.push(("parents".into(),object([("id",key)])));}
    body(&mut c,"keys: [parents] <=200","  for p in keys:\n    delete parents[p]\n");
    c.writes+=n;c
}
fn effects(receipts:bool,n:usize,once:bool,duplicate:bool) -> Case {
    let mut c=base(&format!("r4-effects-r{receipts}-n{n}-once{once}-duplicate{duplicate}"),receipts);
    c.source+="\neffect pinged\n";
    body(&mut c,"",&format!("  for n in range(0, {n}):\n    emit pinged {{ n }}{}\n",if once {if duplicate {" once [0]"}else{" once [n]"}}else{""}));
    c
}
fn edits(receipts:bool,n:usize,delete:bool) -> Case {
    let mut c=base(&format!("r4-edit-r{receipts}-n{n}-delete{delete}"),receipts);
    c.source+="\ntable edited:\n  room: rooms\n  mark: int default 0\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nview editCount: count edited by .room\n";
    if receipts {c.source+="\ntable rooms:\n  public\n  insert <- allow\n  sync public\n";c.seeds.push(("rooms".into(),object([("id",id("c"))])));}
    for i in 0..n {let key=id(&format!("e{i}"));c.keys.push(key.clone());c.seeds.push(("edited".into(),object([("id",key),("room",id("c")),("mark",Value::Int(0))])));}
    body(&mut c,"keys: [edited] <=200",&format!("  for p in keys:\n    {}\n",if delete {"delete edited[p]"}else{"update edited[p] { mark: 1 }"}));
    c.writes+=n;c
}
// Port the reviewers' sources, including the parent scan and repeated secondary
// index components. These are also executed by wasm from the shared corpus.
fn review(kind:&str)->Case {
    let mut c=Case {label:format!("r4-review-{kind}"),source:include_str!("../fixtures/rp-predecessor/schema.q").into(),receipts:true,writes:0,seeds:vec![],keys:vec![]};
    let body=match kind {
        "owners"=>{
            c.source+="\ntable notes:\n  shelf: shelves\n  public\n  insert <- allow\n  sync public\ntable shelves:\n";
            for i in 0..20 {c.source+=&format!("  total{i}: count notes by .shelf\n");}
            c.source+="  public\n  insert <- allow\n  sync public\n";
            c.writes=601;"  for n in range(0, 600):\n    insert shelves {}\n"
        },
        "sequences"=>{
            c.source+="\ntable notes:\n  room: conversations\n  title: text <=20\n  ordinal: sequence by room\n  public\n  insert <- allow\n  sync public\n";
            for i in 0..17 {c.source+=&format!("  by extra{i}: title, room\n");}
            c.writes=741;"  for n in range(0, 740):\n    insert notes { room: 'c', title: 'review' }\n"
        },
        "parents"=>{
            c.source+="\ntable parents:\n  cap 160\n  public\n  delete <- allow\n  sync public\n";
            for i in 0..20 {c.source+=&format!("table children{i}:\n  parent: parents\n  immutable parent\n  read through .parent\n  sync public\n");}
            for i in 0..160 {c.seeds.push(("parents".into(),object([("id",id(&format!("p{i:03}")))])));}
            c.writes=161;"  for p in parents first 160 by byId:\n    delete parents[p]\n"
        },_=>unreachable!()
    };
    c.source+="\nmutation burst(conversation: conversations):\n  insert messages { conversation, sender: viewer, text: 'review', photo: null, at: now }\n";
    c.source+=body;c
}
fn hidden_once_case()->Case {
    let mut c=effects(false,1025,true,false);c.label="r4-hidden-once".into();
    c.source+="\ntable profiles:\n  name: text <=20\n  public\n  online only\n";
    c.source=c.source.replace("emit pinged { n } once", "emit pinged { n, label: profiles['p'].name ?? '' } once");
    c
}
fn hidden_payload(n:usize)->Case {
    let mut c=base(&format!("r4-hidden-payload-{n}"),false);
    c.source+="\neffect pinged\ntable profiles:\n  name: text <=2000\n  public\n  online only\n";
    c.seeds.push(("profiles".into(),object([("id",id("p")),("name",Value::String("x".repeat(2000)))])));
    body(&mut c,"",&format!("  insert notes {{room: 'c', shots: null}}\n  for n in range(0, {n}):\n    emit pinged {{ n, label: sha256(profiles['p'].name ?? '') }}\n"));
    c.writes=1;c
}
fn following(n:usize,partial:bool)->Case {
    let mut source=include_str!("../../../snapback4/tests/timeline/app.q").to_string()
        + include_str!("../../../snapback4/tests/timeline/declaration.q");
    if partial {source=source.replace("table posts:\n", "table posts:\n").replace("  sync public\ntable reposts:","  sync public last 10 by .at\ntable reposts:");}
    source+=&format!("\nmutation registerReservation():\n  insert profiles {{principal: viewer}}\nmutation burst():\n  for n in range(0, {n}):\n    insert posts {{authorId: viewer, at: now}}\n");
    source+="\nquery rows():\n  return posts first 100 by byId\n";
    Case{label:format!("r4-following-{n}-partial{partial}"),source,receipts:false,writes:n,seeds:vec![],keys:vec![]}
}
fn must_queue(c:&Case)->bool {
    let n=&c.label;
    n.contains("review-") || n.contains("effects-rtrue-n1025-oncetrue-duplicatefalse")
        || n.contains("effects-rfalse-n1025-oncetrue-duplicatefalse") || n=="r4-hidden-once"
        || n.starts_with("r4-following-257-")
}
fn concrete()->Vec<Case> {vec![
    effects(true,1025,true,false),review("owners"),review("sequences"),review("parents"),
    effects(false,1024,true,false),effects(false,1025,true,false),
    effects(false,1024,false,false),effects(false,1025,false,false),effects(false,1025,true,true),
    make("r4-explicit-zero".into(),false,0,false,0,false,false,0,1,0),hidden_once_case(),
    hidden_payload(1),hidden_payload(40),following(1,false),following(257,false),following(1,true),following(257,true),
]}
pub(super) fn generated()->Vec<Case> {
    let mut rng=0x5250_0420_2610_03_u64;
    let boundaries=concrete();
    (0..64).map(|i|{
        rng=rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let receipts=(rng>>32)&1==0;let n=[1,2,16,40][(rng>>8)as usize%4];
        let mut c=if i<boundaries.len() {boundaries[i].clone()}else{match i%6 {0=>owners(receipts,n,((rng>>16)%21)as usize),1=>sequences(receipts,n,((rng>>16)%18)as usize),
            2=>parents(receipts,n,((rng>>16)%21)as usize),3=>effects(receipts,n,rng&4!=0,rng&8!=0),4=>edits(receipts,n,false),_=>edits(receipts,n,true)}};
        c.label=format!("seed-52500420261003-case-{i}-{}",c.label);c
    }).collect()
}
fn regressions<H:Host>(host:&mut H){
    for c in concrete() {let queues=must_queue(&c);let(p,s)=run(host,&c,queues);assert_eq!(s,!queues,"{}",c.label);if !queues {assert!(p,"{}",c.label);}}
}
both!(reservation_round4_regressions_memory,reservation_round4_regressions_sqlite,regressions);
#[test]
fn reservation_round4_wasm_corpus_matches_engine(){
    let mut cases=concrete();cases.extend(generated().into_iter().skip(9).take(6));
    let mut corpus=Vec::new();
    for c in cases {
        let queues=must_queue(&c);
        let(mut e,b)=setup(&c);let pages=snapshot_pages(&mut e,"alice",1000);
        let mut d=Device::open_store(snapback4_device::memory::MemoryStore::new(),Some(b)).unwrap();
        for(i,p)in pages.iter().enumerate(){d.apply(p,i==0).unwrap();}
        let q=d.admit(request("burst",c.args(),1));let values=c.values();
        let out=e.mutate("burst",None,ctx("alice",&values,NOW)).unwrap();let committed=matches!(out.state,WriteState::Sent{..});
        let predicted=q.as_ref().is_ok_and(|q|q.predictable);assert!(!predicted||committed,"{}: {out:?}",c.label);
        corpus.push(json!({"label":c.label,"source":c.source,"pages":pages,"args":c.args(),"serverCommitted":committed,"predicted":predicted,"denied":q.is_err(),"mustQueue":queues}));
    }
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rp-runtime-reservation-cases.json");
    let actual=serde_json::to_string(&corpus).unwrap()+"\n";
    if std::env::var_os("UPDATE_RP_WASM_CASES").is_some(){std::fs::write(&path,&actual).unwrap();}
    assert_eq!(serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(path).unwrap()).unwrap(),json!(corpus));
}

fn existing_once_keys<H:Host>(host:&mut H) {
    let mut c=effects(false,1025,true,false);
    c.source+="\nmutation prime(offset: int):\n  for n in range(0, 1024):\n    emit pinged { n } once [n + offset]\n";
    let(mut e,b)=setup(&c);
    for offset in [0,1] {
        let out=e.mutate("prime",None,ctx("alice",&[("offset",Value::Int(offset))],NOW)).unwrap();
        assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
        assert_eq!(out.metered.rows_written,if offset==0 {1024}else{1});
    }
    let mut d=host.open("r4-existing-once",Some(b)).unwrap();publish(&mut e,&mut d,"alice");
    let q=d.admit(request("burst",json!({}),1)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty());
    assert_eq!(d.queued().unwrap().len(),1);
    let out=e.mutate("burst",None,ctx("alice",&[],NOW)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    assert_eq!(out.metered.rows_written,0,"the device never creates durable effect keys");
    assert_eq!(e.store().conn().query_row("SELECT count(*) FROM _effect_keys",[],|r|r.get::<_,i64>(0)).unwrap(),1025);
    assert_eq!(e.store().conn().query_row("SELECT count(*) FROM _outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1025);
}
both!(once_keys_unknown_on_memory,once_keys_unknown_on_sqlite,existing_once_keys);

fn hidden_once<H:Host>(host:&mut H){
    let c=hidden_once_case();
    let(mut e,mut b)=setup(&c);
    assert_eq!(b.schema.operations["burst"].predicts.as_deref(),Some("eligible"));
    let mut d=host.open("hidden-once-current",Some(b.clone())).unwrap();publish(&mut e,&mut d,"alice");
    let q=d.admit(request("burst",json!({}),1)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty());
    // R4 prices in a kept blob are obsolete metadata. Their absence cannot
    // erase runtime once-key charges: the same 1,025 distinct keys still queue.
    let mut wire=serde_json::to_value(&b).unwrap();
    wire["schema"]["operations"]["burst"]["effect_reservations"]=json!({});
    b=serde_json::from_value(wire).unwrap();
    let mut old=host.open("hidden-once-legacy",Some(b)).unwrap();publish(&mut e,&mut old,"alice");
    let q=old.admit(request("burst",json!({}),1)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty());
}
both!(hidden_once_memory,hidden_once_sqlite,hidden_once);

// General client scenarios exercise a current backend. Authentic predecessor
// fixtures stay frozen in rp-predecessor and the upgrade suites; missing prices
// there intentionally queue the writers that need them.
#[test]
fn current_client_chat_fixture_exports_complete_prices() {
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback4/test/chat-schema.json");
    let original:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let mut backend:Backend=serde_json::from_value(original.clone()).unwrap();
    backend.schema.export_write_reservations();
    let current=serde_json::to_value(backend).unwrap();
    if std::env::var_os("UPDATE_RP_WASM_CASES").is_some(){std::fs::write(&path,serde_json::to_string(&current).unwrap()+"\n").unwrap();}
    assert_eq!(serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(path).unwrap()).unwrap(),current);
}

// Explicitly commissioned R5 actual-value exception; do not hide it among the
// passing admission differential. This preserves R4's pathological payload
// input and makes its restored behavior a reproducible, ticketed counterexample.
fn pathological_payload<H:Host>(host:&mut H) {
    let c=hidden_payload(600);
    let(mut e,b)=setup(&c);let pages=snapshot_pages(&mut e,"alice",1000);
    let mut d=host.open("payload-gap",Some(b)).unwrap();
    for(i,p)in pages.iter().enumerate(){d.apply(p,i==0).unwrap();}
    let q=d.admit(request("burst",json!({}),1)).unwrap();
    assert!(q.predictable && q.predicted.len()==1,"{q:?}");
    let out=e.mutate("burst",None,ctx("alice",&[],NOW)).unwrap();
    assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_BOUND"),"{out:?}");
    assert!(e.store().rows("notes").unwrap().is_empty());
    assert!(e.effects(None,1000).unwrap().is_empty());
    eprintln!("RP documented payload gap {:?} {:?}",out.state,out.metered);
    let corpus=json!({"label":c.label,"source":c.source,"pages":pages,"args":{},"serverCommitted":false,"predicted":true,"denied":false,"mustQueue":false});
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rp-effect-payload-gap.json");
    if std::env::var_os("UPDATE_RP_WASM_CASES").is_some(){std::fs::write(&path,serde_json::to_string(&corpus).unwrap()+"\n").unwrap();}
    let expected:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(corpus,expected);
}
both!(documented_payload_gap_memory,documented_payload_gap_sqlite,pathological_payload);
