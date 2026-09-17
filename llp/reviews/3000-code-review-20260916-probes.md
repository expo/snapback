# Lead executable probes — 2026-09-16

Baseline `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`. Temporary files lived
outside the checkout. Rust probes linked the baseline core/language rlibs
produced by its normal workspace build; native selection used the built CLI
and Cargo wasm target. No secret, provider or production data was used.

## Native artifact selection

Create a temporary app with `query value(): native`, an app cdylib named
zzz_old, and the path guest SDK. Its read returns JSON 1. Run check, rename
the crate aaa_new, change the read to return 2, then check again. Both exit0.
Comparing generated/native.wasm with Cargo outputs:

```text
built_crate=zzz_old selected_matches={zzz_old.wasm:true}
built_crate=aaa_new selected_matches={aaa_new.wasm:false,zzz_old.wasm:true}
```

## Nullable target audience

The following probe returned no compiler diagnostics, an online row containing
body "visible online" and room Null, and snapshot `([],1)`. Seed is used only
to isolate rule/sync semantics from application grant mutations. The required
index and grant-authority checks remain enabled.

```rust
use snapback4_core::{Engine, value::{Value, object}, engine::Context};
use std::collections::BTreeMap;
fn main(){
let source=r#"table memberships:
  room: id ?
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipalRoom: principal, room
  read <- .principal = viewer
  insert <- deny
  update <- deny
  delete <- allow

table messages:
  room: id ?
  body: text <=100
  by byRoom: room, id
  read <- exists memberships[.room, viewer]
  insert <- deny
  update <- deny
  delete <- allow
  sync to memberships[.room]

query one(messageId: id):
  return messages[messageId]
"#;
let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
println!("diagnostics={:?}",b.diagnostics);
if !b.diagnostics.is_empty(){return;}
let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
e.seed(vec![("memberships".into(),object([("id",Value::Id("m".into())),("room",Value::Null),("principal",Value::Id("dev:alice".into()))])),("messages".into(),object([("id",Value::Id("x".into())),("room",Value::Null),("body",Value::String("visible online".into()))]))]).unwrap();
let q=e.query("one",Context::new("dev:alice",BTreeMap::from([("messageId".into(),Value::Id("x".into()))]))).unwrap();
println!("online={:?}",q.data);
println!("snapshot={:?}",e.snapshot("dev:alice").unwrap());
}
```

## Join exceeds the wire bound at page size one

The following probe returned:

```text
from=9 limit=1 events=45 bytes=18006410 response_ceiling=16777216 watermark=10 more=false
```

```rust
use snapback4_core::{Engine, value::{Value, object}};
fn main(){
let source=r#"table memberships:
  room: id
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipalRoom: principal, room
  read <- .principal = viewer
  insert <- deny
  update <- deny
  delete <- deny

table messages:
  room: id
  body: text <=400000
  by byRoom: room, id
  read <- exists memberships[.room, viewer]
  insert <- deny
  update <- deny
  delete <- deny
  sync to memberships[.room]
"#;
let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]); assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
for batch in 0..9 { e.seed((0..5).map(|i|("messages".into(),object([("id",Value::Id(format!("msg-{}",batch*5+i))),("room",Value::Id("r".into())),("body",Value::String("x".repeat(400000)))])))).unwrap(); }
let (_,from)=e.snapshot("dev:alice").unwrap();
e.seed(vec![("memberships".into(),object([("id",Value::Id("m".into())),("room",Value::Id("r".into())),("principal",Value::Id("dev:alice".into()))]))]).unwrap();
let p=e.stream("dev:alice",from,1).unwrap();
let bytes=serde_json::to_vec(&p).unwrap().len();
println!("from={from} limit=1 events={} bytes={bytes} response_ceiling={} watermark={} more={}",p.events.len(),16<<20,p.watermark,p.more);
assert!(bytes>16<<20);
}
```

## Online asset completes after close

Using Bun to import client.ts, supply a fetch stub that defers `/assets/image`,
start `client.asset("image")`, await `client.close()`, then fulfill the asset
response with 13 bytes and Content-Type image/png. Baseline returned a usable
blob URL with type image/png and bytes13. Revoke the probe's URL after checking.
The regression added with the repair uses the same delayed-completion boundary.
