//! @ref LLP 3000.023#12 — a consumed ledger defeats a held query snapshot.
use super::super::*;

#[test]
fn once_commit_before_serialization_reprices_rows_and_derived_facts() {
    for event in ["viewed", "released", "transferring"] {
    for name in ["page", "filtered", "derived", "fact"] {
        let directory = ReaderTestDirectory::new();
        let source = "use personas alice, bob\ntable docs:\n  photo: image <=10000 once ?\n  public\n  update <- allow\n  sync public\nquery page():\n  return docs[] first 10 by byId\nquery filtered():\n  return docs[] where .photo != null first 10 by byId\nquery derived():\n  row = docs['a']\n  return row.photo\nquery fact():\n  row = docs['a']\n  return row.photo.width if row.photo != null else null\n";
        let host = Host::with_store(true, snapback4_core::Store::open(&directory.0.join("store.sqlite")).unwrap(), source);
        {
            let mut engine = lock(&host.shared.engine);
            engine.store().record_asset(&snapback4_core::assets::Asset { id: "asset".into(), owner: "dev:alice".into(), kind: snapback4_core::assets::AssetKind::Image, content_type: "image/png".into(), bytes: 68, width: Some(1), height: Some(1), duration: None, created_at: 1, home: None, released_at: None }).unwrap();
            let row = wire::row_from_json(&engine.schema().tables["docs"], &json!({"id":"a","photo":{"id":"asset"}})).unwrap();
            engine.seed_at([("docs".into(), row)], 1).unwrap();
        }
        let headers = "x-snapback-persona: bob\r\n";
        let before = body(&host.request("POST", &format!("/q/{name}"), headers, "{}"));
        assert_ne!(before["data"], Json::Null, "positive proof before the race: {before}");
        let shared = Arc::downgrade(&host.shared);
        *host.shared.query_serialization.lock().unwrap() = Some(Arc::new(move || {
            let shared = shared.upgrade().unwrap();
            if shared.query_serialization.lock().unwrap().take().is_none() { return; }
            match event {
                "viewed" => lock(&shared.engine).record_asset_view("dev:bob", "asset", 2).unwrap(),
                "released" => {
                    let mut engine = lock(&shared.engine);
                    let tx = engine.store_mut().transaction().unwrap();
                    tx.release_asset("asset", "docs", "a", "photo", 2).unwrap();
                    tx.commit().unwrap();
                },
                // The download has sent bytes but has not committed its view.
                _ => { lock(&shared.asset_transfers.active).insert(("asset".into(), "dev:bob".into())); },
            }
        }));
        let after = body(&host.request("POST", &format!("/q/{name}"), headers, "{}"));
        assert!(!after["data"].to_string().contains("asset"), "{name}: {after}");
        match name {
            "page" => assert!(after["data"][0]["photo"].is_null(), "{after}"),
            "filtered" => assert_eq!(after["data"], json!([]), "{after}"),
            _ => assert!(after["data"].is_null(), "{after}"),
        }
        assert_eq!(after["complete"], true, "{event}/{name}");
        lock(&host.shared.asset_transfers.active).clear();
    }
}
}
