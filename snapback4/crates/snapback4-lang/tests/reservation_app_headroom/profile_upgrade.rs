//! Authentic a8c20c40e9 app stores: unrelated profile writes under offline Kept.
// @ref LLP 3000.022#14.3 — hidden private source footprints require adoption.
use super::*;
use snapback4_core::error::RuntimeError;
use snapback4_device::{device::Device, memory::{Change, MemoryStore}, opening::Opening, store::{DeviceStore, DeviceTx}};
use std::collections::BTreeMap;
struct Borrowed<'a,S>(&'a mut S);
impl<S:DeviceStore> DeviceStore for Borrowed<'_,S> {
    type Tx<'a>=S::Tx<'a> where Self:'a;
    fn install(&mut self,schema:&snapback4_core::Schema,metadata:&BTreeMap<String,String>,reset:bool)->Result<(),RuntimeError>{self.0.install(schema,metadata,reset)}
    fn install_checked(&mut self,schema:&snapback4_core::Schema,metadata:&BTreeMap<String,String>,reset:bool,expected:&BTreeMap<String,Option<String>>)->Result<(),RuntimeError>{self.0.install_checked(schema,metadata,reset,expected)}
    fn meta(&self,key:&str)->Result<Option<String>,RuntimeError>{self.0.meta(key)}
    fn set_meta(&mut self,key:&str,value:&str)->Result<(),RuntimeError>{self.0.set_meta(key,value)}
    fn transaction(&mut self)->Result<Self::Tx<'_>,RuntimeError>{self.0.transaction()}
}
fn directory(version: &str) -> std::path::PathBuf {
    root().parent().unwrap().join("rp-profile-upgrade").join(version)
}
fn changes(version: &str) -> Vec<Change> {
    let dir = directory(version);
    let backend = std::fs::read_to_string(dir.join("backend-schema.part")).unwrap()
        + &std::fs::read_to_string(dir.join("backend-programs.part")).unwrap();
    let mut changes = vec![Change { s: 'm', k: "device:backend".into(), v: Some(backend) }];
    for name in ["acquired.json", "pending.json"] {
        changes.extend(serde_json::from_str::<Vec<Change>>(&std::fs::read_to_string(dir.join(name)).unwrap()).unwrap());
    }
    changes
}
fn entry(name: &str, seq: u64) -> Queued {
    serde_json::from_value(json!({"id":format!("profile-{name}"),"seq":seq,"op":"saveProfile","viewer":"alice","now":NOW,
        "new_ids":[],"predicted":[],"predictable":true,"args":{"displayName":name,"handle":"alice","bio":"A new bio","location":"Berlin","link":null}})).unwrap()
}
fn exercise<S: DeviceStore>(mut d: Device<S>, version: &str) {
    let (mut e, backend) = build(version);
    seed(&mut e, version);
    assert!(!d.schema().source_reservations.is_empty());
    assert!(d.schema().tables.values().any(|t| !t.maintained.is_empty()));
    assert!(d.schema().maintains.iter().all(|m| m.private.is_none()));
    assert_eq!(d.queued().unwrap()[0].id, "profile-before-upgrade");
    let offline = d.admit(entry("offline", 2)).unwrap();
    assert!(offline.predictable && offline.predicted.len() == 1, "{offline:?}");
    assert_eq!(d.queued().unwrap().len(), 2);
    let before: Vec<_> = d.queued().unwrap().iter().map(|q| (q.id.clone(),q.args.clone())).collect();
    d.adopt(backend).unwrap(); // same current backend; queued custody is stable
    assert_eq!(d.queued().unwrap().iter().map(|q| (q.id.clone(),q.args.clone())).collect::<Vec<_>>(), before);
    let online = d.admit(entry("online", 3)).unwrap();
    assert!(online.predictable && online.predicted.len() == 1, "{online:?}");
    let mut receipts = vec![];
    for q in d.queued().unwrap() {
        let args = q.args.as_object().unwrap().iter().map(|(k,v)|
            (k.clone(),snapback4_core::wire::from_json(&e.program(&q.op).unwrap().args[k],v).unwrap())).collect();
        let out = e.mutate(&q.op,Some(&q.id),Context::new("alice",args).at(NOW).with_ids(q.new_ids.clone())).unwrap();
        let WriteState::Sent{seq,..} = out.state else { panic!("{out:?}") };
        receipts.push(json!({"id":q.id,"seq":seq}));
        d.settle(&q.id,Some(seq)).unwrap();
    }
    let pages = snapshot_pages(&mut e,"alice",1000);
    for (i,page) in pages.iter().enumerate() { d.apply(page,i==0).unwrap(); }
    assert!(d.queued().unwrap().is_empty());
    let result = d.query("profile","alice",&json!({"handle":"alice"}),NOW).unwrap();
    assert_eq!(result.data.field("displayName"),Ok(&text("online")));
    assert_ne!(result.data.field("pending"),Ok(&Value::Bool(true)));
    let result = json!({"receipts":receipts,"pages":pages});
    let path = directory(version).join("settlement.json");
    if std::env::var_os("UPDATE_RP_PROFILE_CASES").is_some() {
        std::fs::write(&path,serde_json::to_string(&result).unwrap()+"\n").unwrap();
    }
    assert_eq!(result,serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(path).unwrap()).unwrap());
}
#[test]
fn authentic_profile_kept_memory() {
    for version in ["0411","0412"] {
        let mut store = MemoryStore::new();
        store.load(changes(version)).unwrap();
        let error=match Opening::Kept.open(Borrowed(&mut store)){Err(error)=>error,Ok(_)=>panic!("legacy aggregate identity backend executed")};
        assert_eq!(error.code(),"E_SCHEMA_CAPABILITY");
        assert!(error.to_string().contains("maintained-id-sha256-v1"),"{error}");
        let (_,current)=build(version);
        exercise(Opening::Install(current).open(store).unwrap(),version);
    }
}
// Replay the exact old wasm persistence records into SQLite. This tests the
// same authentic metadata, custody and base images; it is not an old SQLite
// binary fixture (those remain in the original receipt-upgrade regression).
#[test]
fn authentic_profile_kept_sqlite() {
    for version in ["0411","0412"] {
        let host = Sqlite::new("rp-r6-profile");
        let changes = changes(version);
        let old: Backend = snapback4_core::json_codec::from_text(changes[0].v.as_ref().unwrap()).unwrap();
        let mut store = snapback4_core::Store::open_shared(&host.path("d")).unwrap();
        DeviceStore::install(&mut store,&old.schema,&Default::default(),false).unwrap();
        let tx = store.transaction().unwrap();
        for change in changes {
            match change.s {
                'm' => match change.v { Some(v) => tx.set_meta(&change.k,&v).unwrap(), None => tx.delete_meta(&[&change.k]).unwrap() },
                'r' => {
                    let (table,id): (String,String) = serde_json::from_str(&change.k).unwrap();
                    let row: Value = snapback4_core::json_codec::from_text(change.v.as_ref().unwrap()).unwrap();
                    let previous = snapback4_core::rows::Rows::get(&tx,&table,&id).unwrap();
                    snapback4_core::rows::Rows::put(&tx,&table,&old.schema.tables[&table],&row,previous.as_ref()).unwrap();
                },
                'o' => {
                    let value = change.v.unwrap();
                    let q: Queued = serde_json::from_str(&value).unwrap();
                    tx.outbox_upsert(q.seq,&q.id,&value).unwrap();
                },
                'b' => {
                    let (table,id): (String,String) = serde_json::from_str(&change.k).unwrap();
                    let image: Option<String> = serde_json::from_str(change.v.as_ref().unwrap()).unwrap();
                    tx.base_remember(&table,&id,image.as_deref()).unwrap();
                },
                's' => match change.v {
                    Some(value) => {
                        let (table,image): (String,String) = serde_json::from_str(&value).unwrap();
                        tx.staged_put(&change.k,&table,&image).unwrap();
                    },
                    None => tx.staged_delete(&change.k).unwrap(),
                },
                other => panic!("unexpected old persistence store {other}"),
            }
        }
        tx.commit().unwrap();
        drop(store);
        let mut store = snapback4_core::Store::open_shared(&host.path("d")).unwrap();
        let error=match Opening::Kept.open(Borrowed(&mut store)){Err(error)=>error,Ok(_)=>panic!("legacy aggregate identity backend executed")};
        assert_eq!(error.code(),"E_SCHEMA_CAPABILITY");
        assert!(error.to_string().contains("maintained-id-sha256-v1"),"{error}");
        let (_,current)=build(version);
        exercise(Opening::Install(current).open(store).unwrap(),version);
    }
}
