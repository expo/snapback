use super::*;
use snapback4_core::assets::{Asset, AssetKind};
pub(super) const SCHEMA: &str = r#"
table pictures:
  reader: principal
  until: time ?
  ordinary: image <=1000 ?
  oncePhoto: image <=1000 once ?
  read <- .reader = viewer
  expire at .until
"#;
pub(super) fn seed(h: &Host) {
    let mut e=lock(&h.shared.engine);
    let mut rows: Vec<(String,Value)>=Vec::new();
    for (id,reader,until,once) in [("ordinary","member:bob",Value::Null,false),("once","member:bob",Value::Null,true),("hidden","other",Value::Null,true),("expired","member:bob",Value::Int(NOW-1),true),("released","member:bob",Value::Null,true)] {
        e.store().record_asset(&Asset{id:id.into(),owner:snapback4_core::SYSTEM_PRINCIPAL.into(),kind:AssetKind::Image,content_type:"image/png".into(),bytes:24,width:Some(1),height:Some(1),duration:None,created_at:NOW,home:None,released_at: None, name: None}).unwrap();
        std::fs::create_dir_all(e.store().asset_path(id).parent().unwrap()).unwrap();
        std::fs::write(e.store().asset_path(id), b"012345678901234567890123").unwrap();
        let asset=e.store().asset(id).unwrap().unwrap().column_value();
        rows.push(("pictures".into(),object([("id",Value::Id(id.into())),("reader",Value::Id(reader.into())),("until",until),("ordinary",if once {Value::Null}else{asset.clone()}),("oncePhoto",if once {asset}else{Value::Null})])));
    }
    let table=e.schema().tables["pictures"].clone();
    let tx=e.store_mut().transaction().unwrap();
    for (name,row) in rows {
        let id=row.field("id").unwrap().as_str().unwrap();
        tx.put(&name,&table,&row,None).unwrap();
        tx.claim_asset(id,snapback4_core::SYSTEM_PRINCIPAL,&name,id,if id=="ordinary" {"ordinary"} else {"oncePhoto"}).unwrap();
    }
    tx.commit().unwrap();
    e.store().conn().execute("UPDATE _assets SET released_at=?1 WHERE id='released'",[NOW]).unwrap();
}
fn fetch(h:&Host,id:&str,header:&str,range:bool)->String {
    h.request("GET",&format!("/assets/{id}"),&format!("{header}{}",if range {"Range: bytes=0-1\r\n"}else{""}),"")
}
pub(super) fn matrix(h:&Host,read:Option<&str>) {
    if let Some(read)=read {
        for id in ["missing","hidden","expired","released"] { for header in [FULL,read] { for range in [false,true] {
            let response=fetch(h,id,header,range);assert_eq!(status(&response),404,"{id}: {response}");assert_eq!(body(&response)["denied"]["code"],"E_ASSET_UNKNOWN");
        } } }
        for range in [false,true] {
            let a=fetch(h,"ordinary",FULL,range);let b=fetch(h,"ordinary",read,range);
            assert_eq!(status(&b),if range {206}else{200});assert_eq!(a.split_once("\r\n\r\n").unwrap().1,b.split_once("\r\n\r\n").unwrap().1);
        }
        for header in [FULL,read] { let response=fetch(h,"once",header,true);assert_eq!(status(&response),416);assert_eq!(body(&response)["denied"]["code"],"E_ASSET_RANGE"); }
        let before=snapshot(h);let response=fetch(h,"once",read,false);
        assert_eq!(status(&response),403);assert_eq!(body(&response)["denied"]["code"],"E_ASSET_READ_ONLY");assert_eq!(snapshot(h),before);
        // No file open precedes the read-only refusal, even if the bytes have vanished.
        let path=lock(&h.shared.engine).store().asset_path("once");let bytes=std::fs::read(&path).unwrap();std::fs::remove_file(&path).unwrap();
        assert_eq!(status(&fetch(h,"once",read,false)),403);std::fs::write(path,bytes).unwrap();
    }
    assert_eq!(status(&fetch(h,"once",FULL,false)),200);
    for header in std::iter::once(FULL).chain(read) {
        let ranged=fetch(h,"once",header,true); assert_eq!(status(&ranged),416); assert_eq!(body(&ranged)["denied"]["code"],"E_ASSET_RANGE");
        let response=fetch(h,"once",header,false);assert_eq!(status(&response),410);assert_eq!(body(&response)["denied"]["code"],"E_ASSET_VIEWED");}
}
#[test]
fn complete_asset_matrix_preserves_access_order_and_once_consumption() {
    let h=host();seed(&h);let session=narrowed(&h);matrix(&h,Some(&headers(&session)));
}
