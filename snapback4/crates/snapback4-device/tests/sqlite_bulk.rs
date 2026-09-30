//! Sorted native replacement must be identical to ordinary row/index writes,
//! including rollback, caps, residency triggers and subsequent ordinary edits.
mod common;
use common::*;
use snapback4_device::store::DeviceTx;
use snapback4_core::{Store, Value, error::RuntimeError, value::object};

fn stored(store: &Store) -> (Vec<(i64,String,String)>, Vec<(i64,Vec<u8>,String)>, Vec<(i64,Vec<u8>,i64)>, Vec<(i64,i64,i64)>) {
    let conn = store.conn();
    let rows = conn.prepare("SELECT t,id,data FROM r ORDER BY t,id").unwrap().query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<Result<_,_>>().unwrap();
    let indexes = conn.prepare("SELECT ti,k,id FROM i ORDER BY ti,k").unwrap().query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<Result<_,_>>().unwrap();
    let caps = conn.prepare("SELECT t,k,n FROM _cap_counts ORDER BY t,k").unwrap().query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<Result<_,_>>().unwrap();
    let residency = conn.prepare("SELECT t,rows,bytes FROM _device_residency ORDER BY t").unwrap().query_map([],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<Result<_,_>>().unwrap();
    (rows,indexes,caps,residency)
}

#[test]
fn sorted_replacement_matches_ordinary_indexes_and_rolls_back_every_failure() {
    let (mut engine, backend) = compile(r#"
table items:
  group: text <=10
  body: text <=100
  at: time
  until: time ?
  cap 10 by group
  expire at .until
  by byGroup: group, at, id
  search body
  public
  sync public
"#);
    engine.seed((0..30).map(|n| ("items".into(),object([
        ("id",id(&format!("row{n:02}"))), ("group",Value::String(format!("g{}",n/10))),
        ("body",Value::String(format!("sorted native word index rollback row{n}"))),
        ("at",Value::Int(n)), ("until",Value::Null),
    ])))).unwrap();
    let mut host = Sqlite::new("na-bulk");
    let mut device = host.open("bulk", Some(backend.clone())).unwrap();
    for (n,page) in snapshot_pages(&mut engine,"dev:alice",37).iter().enumerate() { device.apply(page,n==0).unwrap(); }
    drop(device);
    let mut store = Store::open_shared(&host.path("bulk")).unwrap();
    let rows: Vec<_> = backend.schema.tables.iter().flat_map(|(name,table)| store.rows(name).unwrap().into_iter().map(move |row| (name,table,row))).collect();
    // Establish the oracle with the old ordinary insertion API, independent of
    // the replacement optimization being checked.
    let tx = store.transaction().unwrap();
    tx.clear_rows().unwrap();
    for (name,table,row) in &rows { tx.put(name,table,row,None).unwrap(); }
    tx.commit().unwrap();
    let expected = stored(&store);
    for failure in ["loader", "duplicate-index", "none"] {
        let tx = store.transaction().unwrap();
        let result = tx.replace_rows(|| {
            for (name,table,row) in &rows { tx.put_staged("unused",name,table,row)?; }
            match failure {
                "loader" => Err(RuntimeError::Input("injected loader failure".into())),
                "duplicate-index" => {
                    tx.conn().execute("INSERT INTO temp._device_index_load SELECT * FROM temp._device_index_load LIMIT 1",[])?;
                    Ok(())
                }
                _ => Ok(()),
            }
        });
        assert_eq!(result.is_ok(),failure=="none");
        assert_eq!(tx.conn().query_row("SELECT count(*) FROM temp.sqlite_master WHERE name = '_device_index_load'",[],|r| r.get::<_,i64>(0)).unwrap(),0);
        if result.is_ok() { tx.commit().unwrap(); } else { tx.rollback().unwrap(); }
        assert_eq!(stored(&store),expected,"{failure}");
    }
    // Statements cached during loading must target the ordinary index again.
    let tx = store.transaction().unwrap();
    let (name,table,row) = &rows[0];
    tx.delete(name,table,row).unwrap();
    tx.put(name,table,row,None).unwrap();
    tx.commit().unwrap();
    assert_eq!(stored(&store),expected);
}
