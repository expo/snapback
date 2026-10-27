//! Wave31 003/023: frozen parent photos survive a guarded view and native-child lineage.
use super::*;
#[test]
fn wave31_003_023_guarded_photos_follow_receipt_owned_ids_after_exact_cycles(){
    let app=App::new();
    let old="table items:\n  owner: principal\n  photo: image <=1000\n  immutable owner\n  read <- .owner = viewer\n  online only\nquery list():\n  return items where .owner = viewer first 20 by .id\n";
    let new="table items:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  online only\ntable photos:\n  item: items on delete cascade\n  photo: image <=1000\n  immutable item\n  read through .item\n  cap 4 by item\n  online only\nextract photos from items via item: {photo:photo}\nquery list():\n  return (items where .owner = viewer first 20 by .id) { *, marker: true }\nalias result list.oldOwner = owner\n";
    app.source(old);app.ok(&["deploy","deploy"]);
    let png=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";
    let first={let mut e=app.engine();let asset=e.store_asset("alice",png,1000).unwrap();let value=snapback4_core::wire::to_json(&asset.column_value());let b=snapback4_lang::compile(&[("schema.q".into(),old.into())]);e.seed([("items".into(),snapback4_core::wire::row_from_json(&b.schema.tables["items"],&json!({"id":"v1","owner":"alice","photo":value})).unwrap())]).unwrap();value};
    app.source(new);app.ok(&["deploy","deploy"]);
    let second={let mut e=app.engine();let asset=e.store_asset("alice",png,1000).unwrap();let value=snapback4_core::wire::to_json(&asset.column_value());let b=snapback4_lang::compile(&[("schema.q".into(),new.into())]);e.seed([("items".into(),snapback4_core::wire::row_from_json(&b.schema.tables["items"],&json!({"id":"native-parent","owner":"alice"})).unwrap()),("photos".into(),snapback4_core::wire::row_from_json(&b.schema.tables["photos"],&json!({"id":"native-child","item":"native-parent","photo":value})).unwrap())]).unwrap();value};
    app.ok(&["rollback","deploy","--to","1","--exact"]);app.ok(&["rollback","deploy","--to","latest"]);
    {let mut e=app.engine();let b=snapback4_lang::compile(&[("schema.q".into(),new.into())]);let asset=e.store_asset("alice",png,1000).unwrap();e.seed([("photos".into(),snapback4_core::wire::row_from_json(&b.schema.tables["photos"],&json!({"id":"followup","item":"native-parent","photo":snapback4_core::wire::to_json(&asset.column_value())})).unwrap())]).unwrap();}
    for _ in 0..2 {
        let human=app.ok(&["rollback","deploy","--to","1","--check"]);assert!(!human.contains("\"matchesTarget\"")&&!human.contains("\"differences\""),"{human}");
        let preview=app.json(&["rollback","deploy","--to","1","--check"]);assert_eq!(preview["visibility"]["hiddenRows"],0,"{preview}");
        let out=app.ok(&["rollback","deploy","--to","1"]);assert!(out.contains("still runs the registered workflow and current guards"),"{out}");
        let status=app.json(&["releases","deploy"]);assert_eq!(status["live"]["exact"],false);
        let before=status.clone();app.ok(&["rollback","deploy","--to","1"]);assert_eq!(app.json(&["releases","deploy"]),before);
        let mut e=app.engine();let result=e.query("list",Context::new("alice",BTreeMap::new())).unwrap();let rows=snapback4_core::wire::to_json(&result.data);
        for(id,photo)in[("v1",&first),("native-parent",&second)]{let row=rows.as_array().unwrap().iter().find(|row|row["id"]==id).unwrap();assert_eq!(&row["photo"],photo,"{rows}");assert_eq!(row["oldOwner"],"alice");assert_eq!(row["marker"],true);}
        assert!(snapback4_core::wire::to_json(&e.query("list",Context::new("bob",BTreeMap::new())).unwrap().data).as_array().unwrap().is_empty());drop(e);
        assert_eq!(app.json(&["data","photos","--release","deploy"])["rows"].as_array().unwrap().len(),3);
        app.ok(&["rollback","deploy","--to","latest"]);
    }
}
