use super::*;
use snapback4_core::{Context, Value};
use snapback4_device::device::Backend;
#[path = "../../../snapback4-sim/tests/common/following_app.rs"]
mod recipe;

fn execute(e: &mut Engine, b: &Backend, op: &str, viewer: &str, input: Json, ids: Vec<String>) -> u64 {
    let p=b.programs.iter().find(|p|p.name==op).unwrap();
    let args=p.args.iter().map(|(k,t)|(k.clone(),wire::from_json(t,input.get(k).unwrap_or(&Json::Null)).unwrap())).collect();
    let out=e.mutate(op,None,Context::new(viewer,args).at(100).with_ids(ids)).unwrap();
    match out.state { WriteState::Sent{seq,..}=>seq, WriteState::Failed{why,..} if op=="edit" && why.code=="NOT_FOUND" => 0, _=>panic!("{op}: {out:?}") }
}
fn acquire<H:Host>(h:&mut H,e:&mut Engine,b:Backend) -> Device<H::Store> {
    let mut d=h.open("census",Some(b)).unwrap();
    for (n,p) in snapshot_pages(e,"alice",1000).iter().enumerate() {d.apply(p,n==0).unwrap();}
    d
}
fn queued_lifecycle<H:Host>(h:&mut H,mut d:Device<H::Store>,e:&mut Engine,op:&str,input:Json) {
    let q=admit(&mut d,op,input.clone());
    assert!(!q.predictable && q.predicted.is_empty(),"{op}: {q:?}");
    h.close("census",d); d=h.open("census",None).unwrap();
    assert!(!d.queued().unwrap()[0].predictable);
    // Reconnect replays every outstanding mutation before its response arrives.
    let from=d.state().unwrap().0;
    d.apply(&stream_page(e,"alice",from),false).unwrap();
    assert!(!d.queued().unwrap()[0].predictable);
    let seq=execute(e,&d.backend(),op,"alice",input,q.new_ids);
    d.settle(&q.id,(seq!=0).then_some(seq)).unwrap();
    let from=d.state().unwrap().0;
    d.apply(&stream_page(e,"alice",from),false).unwrap();
    assert!(d.queued().unwrap().is_empty());
    h.close("census",d);
}
fn create_room<H:Host>(mut h:H) {
    let (mut e,b)=compile(&snapback4_lang::guide::language());
    let mut d=acquire(&mut h,&mut e,b);
    let input=json!({"name":"New","kind":"open","tags":[]});
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
    d.apply(&stream_page(&mut e,"alice",from),false).unwrap();
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
    let b=recipe::built();
    let backend=Backend{generation:1,schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
    let mut e=Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
    for who in ["alice","bob"] {execute(&mut e,&backend,"social.register",who,json!({}),vec![]);}
    execute(&mut e,&backend,"social.follow","bob",json!({"authorId":"alice"}),vec![]);
    execute(&mut e,&backend,"social.createPost","bob",json!({"postId":"original","body":"Original"}),vec![]);
    let input=if op=="social.createPost" {json!({"postId":"new","body":"New"})} else {json!({"postId":"original"})};
    let d=acquire(&mut h,&mut e,backend);
    queued_lifecycle(&mut h,d,&mut e,op,input);
}
#[test] fn recipe_post_memory() {recipe_fanout(Memory::new(),"social.createPost");}
#[test] fn recipe_post_sqlite() {recipe_fanout(Sqlite::new("census-post"),"social.createPost");}
#[test] fn recipe_repost_memory() {recipe_fanout(Memory::new(),"social.repost");}
#[test] fn recipe_repost_sqlite() {recipe_fanout(Sqlite::new("census-repost"),"social.repost");}

fn retained_edit<H:Host>(mut h:H,source:&str,language:bool,write_forms:bool) {
    let group=if language {"roomId"} else {"conversationId"};
    let members=if language {"members"} else {"memberships"};
    let rooms=if language {"rooms"} else {"conversations"};
    let source=format!("{source}\nquery raw(messageId: messages):\n  return messages[messageId]\nmutation depart():\n  delete {members}[\"member\"]\n");
    let (mut e,b)=compile(&source);
    let room=if language {json!({"id":"left","name":"Left","ownerId":"alice","kind":"open","tags":[],"createdAt":1})} else {json!({"id":"left","title":"Left","creatorId":"alice"})};
    let rows=[(rooms,room),(members,json!({"id":"member",group:"left","principal":"alice","role":"admin","joinedAt":1})),
        ("messages",json!({"id":"message",group:"left","authorId":"alice","body":"Old","at":1}))];
    for (table,row) in rows {e.seed([(table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())]).unwrap();}
    if write_forms {
        for (table,row) in [(rooms,json!({"id":"active","name":"Active","ownerId":"alice","kind":"open","tags":[],"createdAt":1})),
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
    assert_eq!(d.query("raw","alice",&json!({"messageId":"message"}),100).unwrap().data.field("body").unwrap(),&Value::String("Old".into()),"delivered retained image remains readable");
    let op=if write_forms {"writeForms"} else {"edit"};
    let input=if write_forms {json!({"roomId":"active","messageId":"message","postId":"post","body":"New"})} else if language {json!({"messageId":"message","body":"New","expected":"Old"})} else {json!({"messageId":"message","body":"New"})};
    queued_lifecycle(&mut h,d,&mut e,op,input);
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
    let (mut e,b)=compile(&snapback4_lang::recipe::following("", "").unwrap());
    for who in ["alice","bob"] {execute(&mut e,&b,"register",who,json!({}),vec![]);}
    execute(&mut e,&b,"follow","bob",json!({"authorId":"alice"}),vec![]);
    execute(&mut e,&b,"createPost","bob",json!({"postId":"original"}),vec![]);
    let input=if op=="createPost" {json!({"postId":"new"})} else {json!({"eventId":"original"})};
    let d=acquire(&mut h,&mut e,b);
    queued_lifecycle(&mut h,d,&mut e,op,input);
}
#[test] fn standalone_post_memory() {standalone(Memory::new(),"createPost");}
#[test] fn standalone_post_sqlite() {standalone(Sqlite::new("standalone-post"),"createPost");}
#[test] fn standalone_repost_memory() {standalone(Memory::new(),"repost");}
#[test] fn standalone_repost_sqlite() {standalone(Sqlite::new("standalone-repost"),"repost");}

fn bridge<H:Host>(mut h:H,op:&str) {
    let bound=super::census::installed_bridge();
    let b=Backend {generation:1,schema:bound.schema,programs:bound.programs.into_iter().map(|p|p.program).collect()};
    let mut e=Engine::memory(b.schema.clone(),b.programs.clone()).unwrap();
    for who in ["alice","bob"] {execute(&mut e,&b,"social.saveProfile",who,json!({"name":who}),vec![]);}
    execute(&mut e,&b,"social.follow","bob",json!({"authorId":"alice"}),vec![]);
    execute(&mut e,&b,"social.createPost","bob",json!({"postId":"original","body":"Original"}),vec![]);
    let (table,row,input)=if op=="social.publishExisting" {("posts",json!({"id":"new","authorId":"alice","body":"New","at":100}),json!({"postId":"new"}))}
        else {("reposts",json!({"id":"repost","actorId":"alice","postId":"original","at":100}),json!({"repostId":"repost"}))};
    e.seed([(table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())]).unwrap();
    let d=acquire(&mut h,&mut e,b);
    queued_lifecycle(&mut h,d,&mut e,op,input);
}
#[test] fn bridge_publish_memory() {bridge(Memory::new(),"social.publishExisting");}
#[test] fn bridge_publish_sqlite() {bridge(Sqlite::new("bridge-publish"),"social.publishExisting");}
#[test] fn bridge_repost_memory() {bridge(Memory::new(),"social.repostExisting");}
#[test] fn bridge_repost_sqlite() {bridge(Sqlite::new("bridge-repost"),"social.repostExisting");}
