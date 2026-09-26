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

// Restored pre-placement rows may name somebody else's upload. Clearing those
// references must not mutate that upload's ledger, including its GC timestamp.
fn legacy_release(scalar: bool, placed: bool, delete: bool, disk: bool) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../target/image-list-fix-2/legacy-{scalar}-{placed}-{delete}-{disk}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let store = if disk { snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap() }
        else { snapback4_core::Store::memory().unwrap() };
    let kind = if scalar { "image <=1000 ?" } else { "[image <=1000] <=4" };
    let empty = if scalar { "null" } else { "[]" };
    let source = format!(r#"
use server
table posts:
  owner: principal
  photo: image <=1000 ?
  refs: {kind}
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
mutation place(photo: image <=1000):
  return insert posts {{ owner: viewer, photo, refs: {empty} }}
mutation clear(post: posts):
  update posts[post] {{ refs: {empty} }}
mutation rewrite(post: posts, refs: {kind}):
  update posts[post] {{ refs }}
mutation remove(post: posts):
  delete posts[post]
"#);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    upload(&e, "foreign", "alice", AssetKind::Image, 24);
    let facts = e.store().asset("foreign").unwrap().unwrap().column_value();
    let refs = if scalar { facts } else { Value::Array(vec![facts]) };
    e.load_trusted([("posts".into(), Value::Row(BTreeMap::from([
        ("id".into(), Value::Id("mallory-row".into())),
        ("owner".into(), Value::Id("mallory".into())),
        ("photo".into(), Value::Null), ("refs".into(), refs.clone()),
    ]).into()))]).unwrap();
    // The old cell predates placement. A same-id rewrite does not claim it;
    // only the uploader can preview until a new row actually claims the id.
    let out = e.mutate("rewrite", None, Context::new("mallory", BTreeMap::from([
        ("post".into(), Value::Id("mallory-row".into())), ("refs".into(), refs),
    ])).at(1)).unwrap();
    assert_sent(out.state);
    assert_eq!(e.store().asset("foreign").unwrap().unwrap().home, None);
    assert!(e.asset_access("alice", "foreign", 1).is_ok());
    assert_eq!(e.asset_access("mallory", "foreign", 1).unwrap_err().code(), "E_ASSET_UNKNOWN");
    if placed {
        let out = e.mutate("place", None, Context::new("alice", BTreeMap::from([
            ("photo".into(), asset("foreign")),
        ])).with_ids(["alice-row".into()]).at(2)).unwrap();
        assert_sent(out.state);
    }
    let before = e.store().asset("foreign").unwrap().unwrap();
    assert!(e.asset_access("alice", "foreign", 2).is_ok());
    assert_eq!(e.asset_access("mallory", "foreign", 2).unwrap_err().code(), "E_ASSET_UNKNOWN");
    let out = e.mutate(if delete { "remove" } else { "clear" }, None,
        Context::new("mallory", BTreeMap::from([("post".into(), Value::Id("mallory-row".into()))])).at(3)).unwrap();
    assert_sent(out.state);
    let rows = e.store().rows("posts").unwrap();
    let own = rows.iter().find(|row| row.field("id").unwrap().as_str().unwrap() == "mallory-row");
    if delete { assert!(own.is_none()); }
    else { assert_eq!(own.unwrap().field("refs").unwrap(), &if scalar { Value::Null } else { Value::Array(vec![]) }); }
    // Reopening the disk store also proves the no-op survives commit.
    if disk {
        drop(e);
        e = Engine::open_at(snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap(), 4).unwrap();
    }
    let after = e.store().asset("foreign").unwrap().unwrap();
    assert!(e.asset_access("alice", "foreign", 4).is_ok(),
        "owner lost access: scalar={scalar} placed={placed} delete={delete} disk={disk}");
    assert_eq!(after.home, before.home, "a foreign home's placement must not change");
    assert_eq!(after.released_at, before.released_at, "an unplaced upload must not be marked for collection");
    assert_eq!(e.asset_access("mallory", "foreign", 4).unwrap_err().code(), "E_ASSET_UNKNOWN");
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}

macro_rules! legacy_test {
    ($name:ident, $scalar:expr, $placed:expr, $delete:expr) => {
        mod $name {
            #[test]
            fn memory() { super::legacy_release($scalar, $placed, $delete, false); }
            #[test]
            fn sqlite() { super::legacy_release($scalar, $placed, $delete, true); }
        }
    };
}
legacy_test!(legacy_list_clear_preserves_foreign_home, false, true, false);
legacy_test!(legacy_list_delete_preserves_foreign_home, false, true, true);
legacy_test!(legacy_list_clear_preserves_unplaced_upload, false, false, false);
legacy_test!(legacy_list_delete_preserves_unplaced_upload, false, false, true);
legacy_test!(legacy_scalar_clear_preserves_foreign_home, true, true, false);
legacy_test!(legacy_scalar_delete_preserves_foreign_home, true, true, true);
legacy_test!(legacy_scalar_clear_preserves_unplaced_upload, true, false, false);
legacy_test!(legacy_scalar_delete_preserves_unplaced_upload, true, false, true);

fn move_between_columns(scalar: bool, earlier: bool, disk: bool) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../target/image-list-fix-3/move-{scalar}-{earlier}-{disk}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let store = if disk { snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap() }
        else { snapback4_core::Store::memory().unwrap() };
    let kind = if scalar { "image <=1000 ?" } else { "[image <=1000] <=4" };
    let source = format!(r#"
use server
table posts:
  early: {kind}
  late: {kind}
  read <- allow
  insert <- allow
  update <- allow
mutation post(early: {kind}, late: {kind}):
  return insert posts {{ early, late }}
mutation edit(post: posts, early: {kind}, late: {kind}):
  update posts[post] {{ early, late }}
"#);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for id in ["moving", "other"] { upload(&e, id, "alice", AssetKind::Image, 24); }
    let (from, to) = if earlier { ("late", "early") } else { ("early", "late") };
    let fields = |column: &str, id: &str| ["early", "late"]
        .into_iter().map(|name| (name.into(), if name == column {
            if scalar { asset(id) } else { list(&[id]) }
        } else if scalar { Value::Null } else { list(&[]) })).collect::<BTreeMap<_, _>>();
    for (row, column, id) in [("source", from, "moving"), ("destination", to, "other")] {
        let out = e.mutate("post", None, Context::new("alice", fields(column, id))
            .with_ids([row.into()]).at(1)).unwrap();
        assert_sent(out.state);
    }
    // Replacing a different row's asset must still refuse and roll back the
    // release of its current asset along with the row change.
    let before = e.store().rows("posts").unwrap();
    let mut args = fields(to, "moving");
    args.insert("post".into(), Value::Id("destination".into()));
    assert_failed(e.mutate("edit", None, Context::new("alice", args).at(2)).unwrap().state, "E_ASSET_PLACED");
    assert_eq!(e.store().rows("posts").unwrap(), before);
    for (id, row, column) in [("moving", "source", from), ("other", "destination", to)] {
        let record = e.store().asset(id).unwrap().unwrap();
        assert_eq!(record.home, Some(("posts".into(), row.into(), column.into())));
        assert_eq!(record.released_at, None);
    }
    let mut args = fields(to, "moving");
    args.insert("post".into(), Value::Id("source".into()));
    assert_sent(e.mutate("edit", None, Context::new("alice", args).at(3)).unwrap().state);
    if disk {
        drop(e);
        e = Engine::open_at(snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap(), 4).unwrap();
    }
    let rows = e.store().rows("posts").unwrap();
    let row = rows.iter().find(|r| r.field("id").unwrap().as_str().unwrap() == "source").unwrap();
    for (column, value) in fields(to, "moving") {
        if column == to {
            let value = row.field(&column).unwrap();
            let photo = if scalar { value } else { &value.as_array().unwrap()[0] };
            assert_eq!(photo.field("id").unwrap(), &Value::Id("moving".into()));
            assert_eq!(photo.field("width").unwrap(), &Value::Int(640));
        } else { assert_eq!(row.field(&column).unwrap(), &value); }
    }
    for (id, row) in [("moving", "source"), ("other", "destination")] {
        let record = e.store().asset(id).unwrap().unwrap();
        assert_eq!(record.home, Some(("posts".into(), row.into(), to.into())));
        assert_eq!(record.released_at, None);
        assert!(e.asset_access("bob", id, 4).is_ok());
    }
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}

macro_rules! move_test {
    ($name:ident, $scalar:expr, $earlier:expr) => {
        mod $name {
            #[test]
            fn memory() { super::move_between_columns($scalar, $earlier, false); }
            #[test]
            fn sqlite() { super::move_between_columns($scalar, $earlier, true); }
        }
    };
}
move_test!(list_move_to_earlier_column, false, true);
move_test!(list_move_to_later_column, false, false);
move_test!(scalar_move_to_earlier_column, true, true);
move_test!(scalar_move_to_later_column, true, false);
