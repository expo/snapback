use super::*;
#[path = "counted.rs"] mod counted;
use counted::{Counted, Visits};

fn measured<S: DeviceStore>(store: S) {
    let source = SOURCE.replace("last 3 by .ordinal", "last 19999 by .ordinal")
        + "\nquery many(member: members):\n  a = unread[member]\n  b = unread[member]\n  c = unread[member]\n  return { a, b, c }\n";
    let (mut server, mut backend) = compile(&source);
    let mut rows = vec![("conversations", json!({"id":"c","title":"chat"})), ("members", member(json!(19997), json!(0)))];
    for i in 1..=20000 { rows.push(("messages", message(i))); }
    server.seed(rows.into_iter().map(|(t,r)|(t.into(),wire::row_from_json(&server.schema().tables[t],&r).unwrap())).collect::<Vec<_>>()).unwrap();
    backend.schema = backend.schema.public_projection();
    let visits = Visits::default();
    let mut d = Device::open_store(Counted { inner: store, visits: visits.clone() }, Some(backend.clone())).unwrap();
    for (i,p) in snapshot_pages(&mut server,"bob",512).iter().enumerate() { d.apply(p,i==0).unwrap(); }
    // Populated adoption keeps the existing comparison-index entries.
    d.adopt(backend).unwrap();
    visits.borrow_mut().clear();
    let q = d.query("badge","bob",&json!({"member":"b"}),1).unwrap();
    assert!(q.complete); assert_eq!(q.data,Value::Int(3));
    let candidates: usize = visits.borrow().iter().filter(|((table,_),_)|table=="messages").map(|(_,n)|n).sum();
    assert_eq!(candidates,3,"{:?}",visits.borrow());
    eprintln!("20,000-row group / 3 unread: {candidates} source candidates; {:?}",q.metered);
    page(&mut d,vec![put("members",member(json!(16000),json!(0)))],json!({}),json!([]));
    visits.borrow_mut().clear();
    let q = call::call(&mut d,json!({"op":"query","name":"many","viewer":"bob","args":{"member":"b"},"now":1}));
    assert_eq!(q["ok"]["complete"],false,"{q}");
    assert_eq!(q["ok"]["unknown"],false,"{q}");
    assert_ne!(q["ok"]["speculative"],true,"{q}");
    assert_eq!(q["ok"]["data"]["a"],4000,"{q}");
    let candidates: usize = visits.borrow().iter().filter(|((table,_),_)|table=="messages").map(|(_,n)|n).sum();
    assert!(candidates >= 4000 && candidates < 8192,"{candidates}: {q}");
    let sum: i64 = ["a","b","c"].iter().map(|f|q["ok"]["data"][f].as_i64().unwrap()).sum();
    assert_eq!(sum,candidates as i64,"{q}");
    eprintln!("three 4,000-unread badges share one allowance: {candidates} candidates, {q}");
}
#[test] fn memory_candidate_visits() { measured(snapback4_device::memory::MemoryStore::new()); }
#[test] fn sqlite_candidate_visits() {
    let host = Sqlite::new("measured-unread");
    let path = host.path("visits");
    let _ = Device::open(&path, None); // Initialize the native device tables before wrapping its store.
    measured(snapback4_core::store::Store::open(&path).unwrap());
}

#[test]
fn server_large_live_basis_ignores_expired_backlog() {
    let mut meters = Vec::new();
    for expired in [0,10000] {
        let (mut e,_) = compile(SOURCE);
        let mut rows = vec![("conversations",json!({"id":"c","title":"chat"})),("members",member(json!(19997),json!(0)))];
        for i in 1..=20000 { rows.push(("messages",message(i))); }
        for i in 1..=expired { let mut row=message(20000+i); row["until"]=json!(4102444800000_i64); rows.push(("messages",row)); }
        e.seed(rows.into_iter().map(|(t,r)|(t.into(),wire::row_from_json(&e.schema().tables[t],&r).unwrap())).collect::<Vec<_>>()).unwrap();
        let context=||Context::new("bob",args(&[("member",id("b"))])).at(4102444800000_i64);
        let q=e.query("badge",context()).unwrap();
        assert!(q.complete); assert_eq!(q.data,Value::Int(3));
        eprintln!("server 20,000 live + {expired} expired: {:?}",q.metered);
        meters.push(q.metered);
        let w=e.mutate("depend",None,context()).unwrap();
        assert!(matches!(&w.state,snapback4_core::WriteState::Sent { result,.. } if result==&Value::Int(3)),"{w:?}");
    }
    assert_eq!(meters[0],meters[1]);
}
