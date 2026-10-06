use super::*;
use snapback4_core::{Context, Value};
use snapback4_device::device::Backend;
#[path = "../../../snapback4-sim/tests/common/following_app.rs"]
mod recipe;
const TICK:&str="table ticks:\n  public 'replay'\n  insert <- allow\n  sync public\nmutation tick():\n  insert ticks { id: new }\n";

fn execute(e: &mut Engine, b: &Backend, op: &str, viewer: &str, input: Json, ids: Vec<String>) -> u64 {
    let p=b.programs.iter().find(|p|p.name==op).unwrap();
    let args=p.args.iter().map(|(k,t)|(k.clone(),wire::from_json(t,input.get(k).unwrap_or(&Json::Null)).unwrap())).collect();
    let out=e.mutate(op,None,Context::new(viewer,args).at(100).with_ids(ids)).unwrap();
    match out.state { WriteState::Sent{seq,..}=>seq, WriteState::Failed{why,..} if op=="edit" && why.code=="NOT_FOUND" => 0, _=>panic!("{op}: {out:?}") }
}
fn acquire<H:Host>(h:&mut H,e:&mut Engine,mut b:Backend) -> Device<H::Store> {
    // Real point queries for every predicted output, including private fan-out.
    use snapback4_core::ir::*;
    for table in b.schema.tables.keys() {
        b.programs.push(Program { name:format!("inspect_{table}"), kind:ProgramKind::Query,
            args:[("id".into(),ArgType::Id)].into(), read_time_granularity_ms:None, native:false, returned_shapes:Default::default(),
            body:vec![Stmt::Return(Expr::Get(Read {site:"inspect".into(),table:table.clone(),index:"byId".into(),key:vec![Expr::Variable("id".into())],provenance:KeyProvenance::Arg}))] });
    }
    let mut d=h.open("census",Some(b)).unwrap();
    for (n,p) in snapshot_pages(e,"alice",1000).iter().enumerate() {d.apply(p,n==0).unwrap();}
    d
}
fn predicted_lifecycle<H:Host>(h:&mut H,mut d:Device<H::Store>,e:&mut Engine,op:&str,input:Json) {
    let q=admit(&mut d,op,input.clone());
    assert!(q.predictable && !q.predicted.is_empty(),"{op}: {q:?}");
    let inspect=|d:&mut Device<H::Store>| -> Vec<(String,Json)> {
        if op=="edit" || op=="writeForms" {assert_eq!(d.query("raw","alice",&json!({"messageId":"message"}),100).unwrap().data,Value::Null);}

        q.predicted.iter().map(|key| {
            let (table,id)=key.split_once('/').unwrap();
            let out=d.query(&format!("inspect_{table}"),"alice",&json!({"id":id}),100).unwrap();
            let data=wire::to_json(&out.data);
            (key.clone(),json!({"data":data,"complete":out.complete}))
        }).collect()
    };
    let pending=inspect(&mut d);
    // Derive expected identities from independent stored images, never from
    // the filtered result or just a hidden-row count.
    let raw:std::collections::BTreeMap<String,Value>=d.schema().tables.keys().flat_map(|table| {
        d.store().raw_rows(table).into_iter().filter(|row|row.field("pending")==Ok(&Value::Bool(true)))
            .map(|row|(format!("{table}/{}",row.field("id").unwrap().as_str().unwrap()),row)).collect::<Vec<_>>()
    }).collect();
    let physical:std::collections::BTreeSet<_>=raw.keys().cloned().collect();
    let declared:std::collections::BTreeSet<_>=q.predicted.iter().filter(|key|raw.contains_key(*key)).cloned().collect();
    assert_eq!(physical,declared,"manifest accounts for every stored pending image");
    let hidden_keys:std::collections::BTreeSet<_>=pending.iter().filter(|(_,v)|v["data"].is_null()).map(|(key,_)|key.clone()).collect();
    let expected_hidden:std::collections::BTreeSet<_>=if op=="edit" {
        ["messages/message".to_owned()].into()
    } else if op=="writeForms" {
        q.predicted.iter().filter(|key|key.as_str()=="messages/message" || key.starts_with("reactions/") || key.starts_with("reactionCounts/")).cloned().collect()
    } else {
        raw.iter().filter(|(_,row)|row.field("readerId").is_ok_and(|value|value!=&id("alice"))).map(|(key,_)|key.clone()).collect()
    };
    assert_eq!(hidden_keys,expected_hidden,"{op}: {pending:?}");
    assert_eq!(hidden_keys.len(),if op=="writeForms" {3}else{1});
    for (key,result) in &pending {
        if let Some(row)=raw.get(key) {
            if !hidden_keys.contains(key) {assert_eq!(result["data"],wire::to_json(row));let table=key.split_once('/').unwrap().0;
                let horizon=d.schema().maintain_for(table).is_some_and(|m|d.schema().tables[&m.source].sync.as_ref().is_some_and(|s|s.horizon.is_some()));
                assert_eq!(result["complete"],!horizon,"{key}");}
            else if op!="edit" && op!="writeForms" {assert_eq!(result["complete"],true,"definite foreign denial: {key}");}
        }
    }
    if op=="edit" || op=="writeForms" {assert_eq!(d.query("raw","alice",&json!({"messageId":"message"}),100).unwrap().data,Value::Null);}
    h.close("census",d); d=h.open("census",None).unwrap();
    assert!(d.queued().unwrap()[0].predictable);
    assert_eq!(inspect(&mut d),pending);
    let from=d.state().unwrap().0;
    // A real delivered update forces replay; the receipt alone is no witness.
    execute(e,&d.backend(),"tick","alice",json!({}),vec![]);
    let page=stream_page(e,"alice",from);
    assert!(page.events.iter().any(|e|e.table=="ticks") && page.watermark>from);
    d.apply(&page,false).unwrap();
    assert!(d.queued().unwrap()[0].predictable);
    assert_eq!(inspect(&mut d),pending);
    let seq=execute(e,&d.backend(),op,"alice",input,q.new_ids);
    d.settle(&q.id,(seq!=0).then_some(seq)).unwrap();
    let from=d.state().unwrap().0;
    d.apply(&stream_page(e,"alice",from),false).unwrap();
    assert!(d.queued().unwrap().is_empty());
    if op!="edit" {
        for (key,_) in &pending {
            let (table,row_id)=key.split_once('/').unwrap();
            let out=d.query(&format!("inspect_{table}"),"alice",&json!({"id":row_id}),100).unwrap();
            if out.data!=Value::Null {
                let server=e.store().rows(table).unwrap().into_iter().find(|r|r.field("id")==Ok(&id(row_id)));
                // Left delivered history may retain its old body after a blind
                // authorized server patch; it is never promoted from the overlay.
                if key=="messages/message" {assert_eq!(out.data.field("body"),Ok(&Value::String("Old".into())));}
                else {assert_eq!(Some(out.data),server,"settled {key}");}
            }
        }
    }
    if op=="edit" {
        assert_eq!(seq,0,"server refused the departed edit");
        assert_eq!(wire::to_json(&d.query("raw","alice",&json!({"messageId":"message"}),100).unwrap().data)["body"],"Old");
    }
    h.close("census",d);
}
fn create_room<H:Host>(mut h:H) {
    let (mut e,b)=compile(&format!("{}\n{TICK}",snapback4_lang::guide::language()));
    let mut d=acquire(&mut h,&mut e,b);
    let input=json!({"name":"New","kind":"open","tags":["demo"]});
    let q=admit(&mut d,"createRoom",input.clone());
    assert!(q.predictable,"the later membership authorizes the room: {q:?}");
    let room_id=q.predicted.iter().find_map(|key|key.strip_prefix("rooms/")).unwrap().to_owned();
    assert!(q.predicted.iter().any(|key|key.starts_with("members/")));
    let args=json!({"roomId":room_id});
    let pending=d.query("room","alice",&args,100).unwrap().data;
    assert_eq!(pending.field("name").unwrap(),&Value::String("New".into()));
    h.close("census",d); d=h.open("census",None).unwrap();
    assert!(d.queued().unwrap()[0].predictable);
    assert_eq!(d.query("room","alice",&args,100).unwrap().data,pending);
    let from=d.state().unwrap().0;
    execute(&mut e,&d.backend(),"tick","alice",json!({}),vec![]);
    let page=stream_page(&mut e,"alice",from);
    assert!(!page.events.is_empty() && page.watermark>from);
    d.apply(&page,false).unwrap();
    assert!(d.queued().unwrap()[0].predictable,"createRoom still predicts during replay");
    assert_eq!(d.query("room","alice",&args,100).unwrap().data,pending);
    let seq=execute(&mut e,&d.backend(),"createRoom","alice",input,q.new_ids);
    d.settle(&q.id,Some(seq)).unwrap();
    let from=d.state().unwrap().0;
    d.apply(&stream_page(&mut e,"alice",from),false).unwrap();
    assert!(d.queued().unwrap().is_empty());
    assert_eq!(d.query("room","alice",&args,100).unwrap().data.field("name").unwrap(),&Value::String("New".into()));
    h.close("census",d);
}
#[test] fn create_room_memory() {create_room(Memory::new());}
#[test] fn create_room_sqlite() {create_room(Sqlite::new("census-room"));}

fn recipe_fanout<H:Host>(mut h:H,op:&str) {
    let mut b=recipe::built();
    let tick=snapback4_lang::compile(&[("schema.q".into(),TICK.into())]);
    b.schema.tables.extend(tick.schema.tables);b.schema.operations.extend(tick.schema.operations);b.programs.extend(tick.programs);
    let backend=Backend{generation:1,schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
    let mut e=Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
    for who in ["alice","bob"] {execute(&mut e,&backend,"social.register",who,json!({}),vec![]);}
    execute(&mut e,&backend,"social.follow","bob",json!({"authorId":"alice"}),vec![]);
    execute(&mut e,&backend,"social.createPost","bob",json!({"postId":"original","body":"Original"}),vec![]);
    let input=if op=="social.createPost" {json!({"postId":"new","body":"New"})} else {json!({"postId":"original"})};
    let d=acquire(&mut h,&mut e,backend);
    predicted_lifecycle(&mut h,d,&mut e,op,input);
}
#[test] fn recipe_post_memory() {recipe_fanout(Memory::new(),"social.createPost");}
#[test] fn recipe_post_sqlite() {recipe_fanout(Sqlite::new("census-post"),"social.createPost");}
#[test] fn recipe_repost_memory() {recipe_fanout(Memory::new(),"social.repost");}
#[test] fn recipe_repost_sqlite() {recipe_fanout(Sqlite::new("census-repost"),"social.repost");}

fn retained_edit<H:Host>(mut h:H,source:&str,language:bool,write_forms:bool) {
    let group=if language {"roomId"} else {"conversationId"};
    let members=if language {"members"} else {"memberships"};
    let rooms=if language {"rooms"} else {"conversations"};
    let source=format!("{source}\n{TICK}\nquery raw(messageId: messages):\n  return messages[messageId]\nmutation depart():\n  delete {members}[\"member\"]\n");
    let (mut e,b)=compile(&source);
    let room=if language {json!({"id":"left","name":"Left","ownerId":"alice","kind":"open","tags":["demo"],"createdAt":1})} else {json!({"id":"left","title":"Left","creatorId":"alice"})};
    let rows=[(rooms,room),(members,json!({"id":"member",group:"left","principal":"alice","role":"admin","joinedAt":1})),
        ("messages",json!({"id":"message",group:"left","authorId":"alice","body":"Old","at":1}))];
    for (table,row) in rows {e.seed([(table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())]).unwrap();}
    if write_forms {
        for (table,row) in [(rooms,json!({"id":"active","name":"Active","ownerId":"alice","kind":"open","tags":["demo"],"createdAt":1})),
            (members,json!({"id":"active-member",group:"active","principal":"alice","role":"admin","joinedAt":1})),
            ("messages",json!({"id":"active-message",group:"active","authorId":"alice","body":"Active","at":1})),
            ("posts",json!({"id":"post","authorId":"alice","body":"Post","score":0,"at":1})),
            ("reactions",json!({"id":"reaction","postId":"post","principal":"alice","direction":1}))] {
            e.seed([(table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())]).unwrap();
        }
    }
    let mut d=acquire(&mut h,&mut e,b.clone());
    let from=d.state().unwrap().0;
    execute(&mut e,&b,"depart","alice",json!({}),vec![]);
    d.apply(&stream_page(&mut e,"alice",from),false).unwrap();
    assert!(!e.store().rows(members).unwrap().iter().any(|r|r.field("id")==Ok(&id("member"))));
    assert_eq!(e.query("raw",context("alice",&[("messageId",id("message"))]).at(100)).unwrap().data,Value::Null);
    assert_eq!(d.query("raw","alice",&json!({"messageId":"message"}),100).unwrap().data.field("body").unwrap(),&Value::String("Old".into()),"delivered retained image remains readable");
    let op=if write_forms {"writeForms"} else {"edit"};
    let input=if write_forms {json!({"roomId":"active","messageId":"message","postId":"post","body":"New"})} else if language {json!({"messageId":"message","body":"New","expected":"Old"})} else {json!({"messageId":"message","body":"New"})};
    predicted_lifecycle(&mut h,d,&mut e,op,input);
}
fn language() -> String { snapback4_lang::guide::language() }
fn app_card() -> String { snapback4_lang::guide::quarry(snapback4_lang::guide::card("app").unwrap())[0].clone() }
fn writes_card() -> String { format!("{}\n{}",language(),snapback4_lang::guide::quarry(snapback4_lang::guide::card("writes").unwrap())[0]) }
macro_rules! retained_cases {
    ($memory:ident,$sqlite:ident,$source:expr,$language:expr,$writes:expr) => {
        #[test] fn $memory() {retained_edit(Memory::new(),&$source,$language,$writes);}
        #[test] fn $sqlite() {retained_edit(Sqlite::new(stringify!($sqlite)),&$source,$language,$writes);}
    }
}
retained_cases!(language_edit_memory,language_edit_sqlite,language(),true,false);
retained_cases!(app_edit_memory,app_edit_sqlite,app_card(),false,false);
retained_cases!(chat_edit_memory,chat_edit_sqlite,CHAT,false,false);
retained_cases!(write_forms_memory,write_forms_sqlite,writes_card(),true,true);

fn standalone<H:Host>(mut h:H,op:&str) {
    let (mut e,b)=compile(&format!("{}\n{TICK}",snapback4_lang::recipe::following("", "").unwrap()));
    for who in ["alice","bob"] {execute(&mut e,&b,"register",who,json!({}),vec![]);}
    execute(&mut e,&b,"follow","bob",json!({"authorId":"alice"}),vec![]);
    execute(&mut e,&b,"createPost","bob",json!({"postId":"original"}),vec![]);
    let input=if op=="createPost" {json!({"postId":"new"})} else {json!({"eventId":"original"})};
    let d=acquire(&mut h,&mut e,b);
    predicted_lifecycle(&mut h,d,&mut e,op,input);
}
#[test] fn standalone_post_memory() {standalone(Memory::new(),"createPost");}
#[test] fn standalone_post_sqlite() {standalone(Sqlite::new("standalone-post"),"createPost");}
#[test] fn standalone_repost_memory() {standalone(Memory::new(),"repost");}
#[test] fn standalone_repost_sqlite() {standalone(Sqlite::new("standalone-repost"),"repost");}

fn bridge<H:Host>(mut h:H,op:&str) {
    let mut bound=super::census::installed_bridge();
    let tick=snapback4_lang::compile(&[("schema.q".into(),TICK.into())]);
    bound.schema.tables.extend(tick.schema.tables);bound.schema.operations.extend(tick.schema.operations);bound.programs.extend(tick.programs);
    let b=Backend {generation:1,schema:bound.schema,programs:bound.programs.into_iter().map(|p|p.program).collect()};
    let mut e=Engine::memory(b.schema.clone(),b.programs.clone()).unwrap();
    for who in ["alice","bob"] {execute(&mut e,&b,"social.saveProfile",who,json!({"name":who}),vec![]);}
    execute(&mut e,&b,"social.follow","bob",json!({"authorId":"alice"}),vec![]);
    execute(&mut e,&b,"social.createPost","bob",json!({"postId":"original","body":"Original"}),vec![]);
    let (table,row,input)=if op=="social.publishExisting" {("posts",json!({"id":"new","authorId":"alice","body":"New","at":100}),json!({"postId":"new"}))}
        else {("reposts",json!({"id":"repost","actorId":"alice","postId":"original","at":100}),json!({"repostId":"repost"}))};
    e.seed([(table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())]).unwrap();
    let d=acquire(&mut h,&mut e,b);
    predicted_lifecycle(&mut h,d,&mut e,op,input);
}
#[test] fn bridge_publish_memory() {bridge(Memory::new(),"social.publishExisting");}
#[test] fn bridge_publish_sqlite() {bridge(Sqlite::new("bridge-publish"),"social.publishExisting");}
#[test] fn bridge_repost_memory() {bridge(Memory::new(),"social.repostExisting");}
#[test] fn bridge_repost_sqlite() {bridge(Sqlite::new("bridge-repost"),"social.repostExisting");}
