use super::*;

fn missing_backend_policy<H: RepairHost>(host: &mut H, reopen: bool, changed_generation: bool) {
    let (_, old, device) = fixture(host, "dev:alice", true);
    host.close("store", device);
    let (_, mut incoming) = compile(&SOURCE.replace("retain delivered-history", "retain until-revoked"));
    incoming.generation = old.generation + u64::from(changed_generation);
    let checked = Checked { inner: host.raw("store"), fail: Cell::new(false), legacy: Cell::new(reopen), missing_backend: Cell::new(true), edit: Cell::new(None) };
    let result = if reopen {
        Device::open_store(checked, Some(incoming), "dev:bob")
    } else {
        let mut device = Device::open_store(checked, None, "dev:alice").unwrap();
        device.store().legacy.set(true);
        device.adopt_captured(incoming, "dev:bob", BTreeMap::new()).map(|()| device)
    };
    match result {
        Err(error) => assert_eq!(error.code(), "SNAPBACK_HISTORY_OWNER"),
        Ok(mut device) => {
            let count = device.store().inner.row_count();
            let answer = device.query("both", "dev:bob", &json!({}), 100).map(|r| { let v = wire::to_json(&r.data); json!({"left_count": v["left"].as_array().map(|a| a.len()), "first_left": v["left"][0]}) });
            panic!("unknown original owner admitted Bob: physical_rows={count}, answer={answer:?}");
        }
    }
}
fn missing_backend_changed_policy<H: RepairHost>(host: &mut H, reopen: bool) { missing_backend_policy(host, reopen, true); }
fn missing_backend_same_generation_policy<H: RepairHost>(host: &mut H, reopen: bool) { missing_backend_policy(host, reopen, false); }
both_paths!(missing_parent_new_generation, missing_backend_changed_policy);
both_paths!(missing_parent_same_generation, missing_backend_same_generation_policy);

fn empty_history_table<H: RepairHost>(host: &mut H, reopen: bool) {
    let (mut engine, backend) = compile(SOURCE);
    let member = wire::row_from_json(&backend.schema.tables["members"], &json!({"id":"member", "room":"held", "principal":"dev:alice"})).unwrap();
    engine.seed(vec![("members".into(), member)]).unwrap();
    let mut device = host.open_as("store", Some(backend.clone()), "dev:alice").unwrap();
    acquire(&mut device, &mut engine, "dev:alice");
    assert_eq!(device.store().row_count(), 1);
    let result = adopt(host, device, backend, "dev:bob", reopen);
    match result {
        Ok(device) => assert_eq!(device.store().row_count(), 0),
        Err(error) => panic!("ordinary sign-in with no delivered rows refused: {error:?}"),
    }
}
both_paths!(empty_history_ordinary_signin, empty_history_table);


#[test]
fn split_catalog_must_not_hide_retained_rows() {
    for reopen in [true, false] {
        let mut host = Sqlite::new("split-catalog");
        let (_, backend, device) = fixture(&mut host, "dev:alice", true);
        host.close("store", device);
        let raw = host.raw("store");
        raw.conn().execute_batch("UPDATE _catalog SET name='orphaned_messages' WHERE name='messages'; INSERT INTO _catalog(name,num) VALUES('messages',9000); UPDATE r SET t=9000 WHERE t=(SELECT num FROM _catalog WHERE name='orphaned_messages') AND id LIKE 'held-%';").unwrap();
        drop(raw);
        let result = if reopen {
            host.open_as("store", Some(backend), "dev:bob")
        } else {
            let mut d = host.open_as("store", None, "dev:alice").unwrap();
            d.adopt_captured(backend, "dev:bob", BTreeMap::new()).map(|()| d)
        };
        match result {
            Err(e) => assert_eq!(e.code(), "SNAPBACK_HISTORY_OWNER"),
            Ok(d) => panic!("reopen={reopen}: catalog scan authorized deleting hidden left history; rows={}", d.store().row_count()),
        }
    }
}
