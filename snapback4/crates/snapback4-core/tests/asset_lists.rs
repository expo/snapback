//! Lists use the scalar upload ownership, facts and one-home contract.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::assets::{Asset, AssetKind};
use std::collections::BTreeMap;

fn engine(kind: &str) -> Engine {
    let source = format!(r#"
use server
table posts:
  owner: principal
  photos: {kind}
  read <- allow
  insert <- .owner = viewer
  update <- allow
  delete <- .owner = viewer
mutation post(photos: {kind}):
  return insert posts {{ owner: viewer, photos }}
mutation edit(post: posts, photos: {kind}):
  update posts[post] {{ photos }}
"#);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn upload(engine: &Engine, id: &str, owner: &str, kind: AssetKind, bytes: u64) {
    engine.store().record_asset(&Asset { id:id.into(), owner:owner.into(), kind,
        content_type:if kind == AssetKind::Image {"image/png"} else {"video/mp4"}.into(), bytes,
        width:Some(640), height:Some(480), duration:None, created_at:0, home:None, released_at:None }).unwrap();
}
fn asset(id: &str) -> Value { Value::Map(BTreeMap::from([("id".into(),Value::Id(id.into()))]).into()) }
fn list(ids: &[&str]) -> Value { Value::Array(ids.iter().map(|id| asset(id)).collect()) }
fn post(engine: &mut Engine, photos: Value, id: &str) -> WriteState {
    engine.mutate("post", None, Context::new("alice", BTreeMap::from([("photos".into(), photos)])).with_ids([id.into()]).at(1)).unwrap().state
}
fn assert_sent(state: WriteState) { assert!(matches!(state,WriteState::Sent{..}), "{state:?}"); }
fn assert_failed(state: WriteState, code: &str) { assert!(matches!(&state,WriteState::Failed{why,..} if why.code == code), "{state:?}"); }

#[test]
fn list_facts_are_authoritative_and_each_asset_has_the_cell_home() {
    let mut e = engine("[image <=1000] <=4");
    for id in ["a", "b"] { upload(&e,id,"alice",AssetKind::Image,24); }
    let mut a = asset("a").as_object().unwrap().clone(); a.insert("width".into(),Value::Int(1));
    assert_sent(post(&mut e,Value::Array(vec![Value::Map(a.into()),asset("b")]),"p"));
    let row = e.store().rows("posts").unwrap().remove(0);
    let Value::Array(photos) = row.field("photos").unwrap() else { panic!("not a list") };
    for photo in photos {
        assert_eq!(photo.field("width").unwrap(),&Value::Int(640));
        assert_eq!(photo.field("bytes").unwrap(),&Value::Int(24));
    }
    for id in ["a","b"] {
        assert_eq!(e.store().asset(id).unwrap().unwrap().home,Some(("posts".into(),"p".into(),"photos".into())));
    }
}

#[test]
fn list_checks_every_elements_owner_kind_size_and_home_atomically() {
    for (owner,kind,bytes,expected) in [("mallory",AssetKind::Image,24,"E_ASSET_UNKNOWN"),
        ("alice",AssetKind::Video,24,"E_ASSET_TYPE"),("alice",AssetKind::Image,1001,"E_ASSET_TOO_LARGE")] {
        let mut e = engine("[image <=1000] <=4");
        upload(&e,"a","alice",AssetKind::Image,24); upload(&e,"b",owner,kind,bytes);
        assert_failed(post(&mut e,list(&["a","b"]),"p"),expected);
        assert!(e.store().rows("posts").unwrap().is_empty());
        assert!(e.store().asset("a").unwrap().unwrap().home.is_none());
    }
    let mut e = engine("[image <=1000] <=4");
    upload(&e,"a","alice",AssetKind::Image,24); upload(&e,"b","alice",AssetKind::Image,24);
    assert_sent(post(&mut e,list(&["b"]),"first"));
    assert_failed(post(&mut e,list(&["a","b"]),"second"),"E_ASSET_PLACED");
    assert!(e.store().asset("a").unwrap().unwrap().home.is_none(),"a late claim failure rolls back earlier claims");
    assert_failed(post(&mut e,list(&["absent"]),"third"),"E_ASSET_UNKNOWN");
}

#[test]
fn optional_nested_lists_and_video_lists_are_placeable_and_clearable() {
    for (ty,kind,nested) in [("[video <=1000] <=4 ?",AssetKind::Video,false),
        ("[[image <=1000] <=2] <=2 ?",AssetKind::Image,true)] {
        let mut e = engine(ty);
        upload(&e,"a","alice",kind,24); upload(&e,"b","alice",kind,24);
        let photos = if nested { Value::Array(vec![Value::Array(vec![asset("a")]),list(&["b"])]) } else { list(&["a","b"]) };
        assert_sent(post(&mut e,photos,"p"));
        for id in ["a","b"] { assert!(e.asset_access("bob",id,2).is_ok()); }
        let cleared = e.mutate("edit",None,Context::new("alice",BTreeMap::from([("post".into(),Value::Id("p".into())),("photos".into(),Value::Null)])).at(3)).unwrap();
        assert_sent(cleared.state);
        for id in ["a","b"] { assert_eq!(e.asset_access("alice",id,4).unwrap_err().code(),"E_ASSET_UNKNOWN"); }
    }
}

#[test]
fn readable_editor_can_retain_and_reorder_another_uploaders_elements() {
    let mut e = engine("[image <=1000] <=4");
    for id in ["a","b"] { upload(&e,id,"alice",AssetKind::Image,24); }
    assert_sent(post(&mut e,list(&["a","b"]),"p"));
    let edited=e.mutate("edit",None,Context::new("bob",BTreeMap::from([("post".into(),Value::Id("p".into())),("photos".into(),list(&["b","a"]))])).at(2)).unwrap();
    assert_sent(edited.state);
    for id in ["a","b"] { assert!(e.asset_access("bob",id,3).is_ok()); }
}
