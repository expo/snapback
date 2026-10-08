//! Security review S05/S06/S10/S12: observable outcomes, replay, grants and media.
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use snapback4_core::value::object;
use snapback4_sim::chat::{CHAT, chat_engine_from};
use std::collections::BTreeMap;

fn id(s: &str) -> Value { Value::Id(s.into()) }
fn args(email: &str) -> BTreeMap<String, Value> { BTreeMap::from([("email".into(), Value::String(email.into()))]) }
fn engine(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

const ACCOUNTS: &str = r#"
table accounts:
  email: text <=254
  owner: principal
  unique byEmail: email
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer

mutation add(email: text <=254):
  return insert accounts { email, owner: viewer }

mutation quiet(email: text <=254):
  return insert accounts { email, owner: viewer } if absent

mutation put(email: text <=254):
  return upsert accounts[email = email] { owner: viewer }
"#;

#[test]
fn hidden_unique_and_id_collisions_have_only_a_generic_rule_refusal() {
    let mut e = engine(ACCOUNTS);
    e.seed([("accounts".into(), object([("id", id("hidden")), ("email", Value::String("secret@example.com".into())), ("owner", id("alice"))]))]).unwrap();
    for (n, op, email, new_id) in [(0, "add", "secret@example.com", "new0"), (1, "quiet", "secret@example.com", "new1"), (3, "add", "fresh@example.com", "hidden")] {
        let result = e.mutate(op, Some(&n.to_string()), Context::new("bob", args(email)).with_ids([new_id.into()])).unwrap();
        let WriteState::Failed { why, .. } = result.state else { panic!("hidden collision succeeded") };
        assert_eq!(why.code, "E_RULE");
        assert!(!why.message.contains("secret@example.com") && !why.message.contains("hidden") && !why.message.contains("already"), "{why}");
    }
    let public = e.mutate("add", None, Context::new("alice", args("secret@example.com"))).unwrap();
    assert!(matches!(public.state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"));
    let quiet = e.mutate("quiet", None, Context::new("alice", args("secret@example.com"))).unwrap();
    assert!(matches!(quiet.state, WriteState::Sent { result: Value::Null, .. }));
}

#[test]
fn hidden_put_uses_update_authority_and_old_owner_can_deny_it() {
    // @ref LLP 3000.007#8 — item 7(a): an unnamed update rule judges old and next, so it is the old owner's guard; only a named next-only rule hands the hidden row to its writer.
    for (source, expected) in [
        (ACCOUNTS.replace("update <- .owner = viewer", "update (old, next) <- next.owner = viewer"), "sent"),
        (ACCOUNTS.to_owned(), "NOT_FOUND"),
        (ACCOUNTS.replace("update <- .owner = viewer", "update (old, next) <- old.owner = viewer and next.owner = viewer"), "NOT_FOUND"),
    ] {
        let mut e = engine(&source);
        e.seed([("accounts".into(), object([("id", id("hidden")), ("email", Value::String("secret@example.com".into())), ("owner", id("alice"))]))]).unwrap();
        let result = e.mutate("put", Some("put"), Context::new("bob", args("secret@example.com"))).unwrap();
        match result.state {
            WriteState::Sent { result, .. } => { assert_eq!(expected, "sent"); assert_eq!(result.field("owner"), Ok(&id("bob"))); }
            WriteState::Failed { why, current } => { assert_eq!(why.code, expected); assert!(current.is_none()); }
        }
        let row = &e.store().rows("accounts").unwrap()[0];
        assert_eq!(row.field("id"), Ok(&id("hidden")));
        assert_eq!(row.field("owner"), Ok(&id(if expected == "sent" { "bob" } else { "alice" })));
    }
}

#[test]
fn catchup_cannot_recover_deleted_expired_or_replaced_content() {
    let source = r#"
table notes:
  owner: principal
  body: text <=100
  expires: time ?
  by byOwner: owner, id
  by byExpiry: expires
  expire at .expires
  read <- .owner = viewer
  sync to .owner
"#;
    let mut e = engine(source);
    let row = |key: &str, owner: &str, body: &str, expires: Value| ("notes".into(), object([("id", id(key)), ("owner", id(owner)), ("body", Value::String(body.into())), ("expires", expires)]));
    e.load([row("deleted", "alice", "DELETED_SECRET", Value::Null), row("expired", "alice", "EXPIRED_SECRET", Value::Int(1)), row("edited", "alice", "REPLACED_SECRET", Value::Null), row("moved", "alice", "MOVED_SECRET", Value::Null)]).unwrap();
    e.seed_delete("notes", "deleted").unwrap();
    e.load([row("edited", "alice", "current", Value::Null), row("moved", "bob", "PRIVATE_NOW", Value::Null)]).unwrap();
    let mut watermark = 0;
    let mut held = BTreeMap::new();
    loop {
        let page = e.stream("alice", watermark, 1).unwrap();
        let json = serde_json::to_string(&page).unwrap();
        for secret in ["DELETED_SECRET", "EXPIRED_SECRET", "REPLACED_SECRET", "MOVED_SECRET", "PRIVATE_NOW"] { assert!(!json.contains(secret), "{json}"); }
        for event in page.events {
            if event.kind == "put" { held.insert(event.id, event.data.unwrap()); }
            else if event.kind == "del" { held.remove(&event.id); }
        }
        assert!(page.watermark > watermark); watermark = page.watermark;
        if !page.more { break; }
    }
    let (snapshot, _) = e.snapshot("alice").unwrap();
    let expected: BTreeMap<_, _> = snapshot.into_iter().filter(|e| e.kind == snapback4_core::partition::EventKind::Put).map(|e| (e.id, e.data.unwrap())).collect();
    assert_eq!(held, expected);
    assert_eq!(held.len(), 1);
}

#[test]
fn revocation_suppresses_history_without_deleting_the_devices_retained_copy() {
    let mut e = chat_engine_from(CHAT, &["dev:alice", "dev:bob"]);
    let row = |body: &str| ("messages".into(), object([("id", id("message")), ("conversationId", id("c1")), ("authorId", id("dev:alice")), ("body", Value::String(body.into())), ("at", Value::Int(1))]));
    e.seed([row("already delivered")]).unwrap();
    let (_, watermark) = e.snapshot("dev:bob").unwrap();
    e.seed([row("unseen update")]).unwrap();
    e.seed_delete("memberships", "m1").unwrap();
    let page = e.stream("dev:bob", watermark, 100).unwrap();
    assert!(!page.events.iter().any(|event| event.table == "messages" && matches!(event.kind.as_str(), "put" | "del")), "{:?}", page.events);
    assert!(page.events.iter().any(|event| event.table == "messages" && event.kind == "scope"));
}

#[test]
fn audience_self_grants_and_unguarded_retargeting_are_refused_at_check() {
    let check = |source: String| snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(check(CHAT.into()).diagnostics.is_empty());
    for rule in [".principal = viewer", "allow", "exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin'] or .principal = viewer", "not exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']"] {
        let source = CHAT.replace("insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']", &format!("insert <- {rule}"));
        let bound = check(source);
        assert!(bound.diagnostics.iter().any(|d| d.message.contains("independent grant")), "{rule}: {:?}", bound.diagnostics);
    }
    let fake_grant = CHAT.replace("insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']", "insert <- created requests[groupId = .conversationId]")
        + "\ntable requests:\n  groupId: conversations\n  unique byGroup: groupId\n  read <- allow\n  insert <- allow\n";
    assert!(check(fake_grant).diagnostics.iter().any(|d| d.message.contains("independent grant")));
    let decoy = CHAT.replace("insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']", "insert <- exists requests[.conversationId, viewer]")
        + "\ntable requests:\n  conversationId: conversations\n  principal: principal\n  unique byGroupPrincipal: conversationId, principal\n  read <- allow\n  insert <- .principal = viewer\n";
    assert!(check(decoy).diagnostics.iter().any(|d| d.message.contains("independent grant")));
    let mut wrong_recipient = check(CHAT.into()).schema;
    let target = wrong_recipient.tables.get_mut("memberships").unwrap();
    target.columns.insert("sponsor".into(), snapback4_core::schema::ColumnType::Principal);
    target.indexes.insert("byGroupSponsor".into(), snapback4_core::schema::Index::of(&["conversationId", "sponsor"], true));
    if let snapback4_core::schema::RuleExpr::Exists { index, key, .. } = &mut target.rules.insert {
        *index = "byGroupSponsor".into(); key.pop();
    } else { panic!("the fixture must carry its admin grant"); }
    assert!(snapback4_core::schema::validate(&wrong_recipient).iter().any(|d| d.message.contains("independent grant")));
    let unsafe_update = CHAT.replace("immutable conversationId, principal, joinedAt", "update <- .principal = viewer");
    assert!(check(unsafe_update).diagnostics.iter().any(|d| d.message.contains("retarget")));
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
    bytes.extend(width.to_be_bytes()); bytes.extend(height.to_be_bytes()); bytes
}

#[test]
fn once_applies_to_the_placed_uploaders_view_and_ranges_do_not_consume_it() {
    let mut e = chat_engine_from(&CHAT.replace("photo: image <=5000000 ?", "photo: image <=5000000 once ?"), &["dev:alice", "dev:bob"]);
    let upload = e.store_asset("dev:alice", &png(40, 30), 1_000).unwrap();
    assert!(!e.asset_access("dev:alice", &upload.id, 1_001).unwrap().once);
    e.seed([("messages".into(), object([("id", id("photo")), ("conversationId", id("c1")), ("authorId", id("dev:alice")), ("body", Value::Null), ("photo", upload.column_value()), ("editedAt", Value::Null), ("at", Value::Int(1_000))]))]).unwrap();
    for viewer in ["dev:alice", "dev:bob"] {
        assert_eq!(e.asset_access_request(viewer, &upload.id, 1_001, true).unwrap_err().code(), "E_ASSET_RANGE");
        assert!(e.asset_access(viewer, &upload.id, 1_002).unwrap().once);
        e.record_asset_view(viewer, &upload.id, 1_002).unwrap();
        assert_eq!(e.asset_access(viewer, &upload.id, 1_003).unwrap_err().code(), "E_ASSET_VIEWED");
    }
}

#[test]
fn dimensions_and_duration_are_admitted_before_any_upload_file_exists() {
    for (w, h) in [(0, 1), (u32::MAX, 1), (16_384, 16_384), (1, 16_385)] {
        assert_eq!(snapback4_core::assets::sniff(&png(w, h)).unwrap_err().code(), "E_ASSET_BOUNDS");
    }
    let jpeg = [0xff,0xd8,0xff,0xc0,0,11,8,0xff,0xff,0xff,0xff,3,1,17,0];
    assert_eq!(snapback4_core::assets::sniff(&jpeg).unwrap_err().code(), "E_ASSET_BOUNDS");
    let mut webp = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".to_vec(); webp.extend([255; 6]);
    assert_eq!(snapback4_core::assets::sniff(&webp).unwrap_err().code(), "E_ASSET_BOUNDS");
    assert!(snapback4_core::assets::sniff(&png(8_000, 5_000)).is_ok());
}

#[test]
fn staged_upload_cleans_up_when_its_generation_changes() {
    let mut e = chat_engine_from(CHAT, &["dev:alice"]);
    let bytes = png(30, 20);
    let upload = e.prepare_asset("dev:alice", snapback4_core::assets::sniff(&bytes).unwrap(), bytes.len() as u64, 1).unwrap();
    let upload = upload.write(&bytes).unwrap();
    assert_eq!(std::fs::read_dir(e.store().assets_dir()).unwrap().count(), 1);
    let mut schema = e.schema().clone(); schema.auth.password = !schema.auth.password;
    e.adopt(schema, []).unwrap();
    assert_eq!(e.finish_asset(upload).unwrap_err().code(), "E_GENERATION");
    // The failed upload's drop removes its files, and the directory too when
    // that leaves a store-in-memory's directory empty.
    let dir = e.store().assets_dir();
    assert!(!dir.exists() || std::fs::read_dir(dir).unwrap().count() == 0);
}

#[test]
fn asset_sweep_separates_catalog_guards_from_file_io() {
    let mut e = chat_engine_from(CHAT, &["dev:alice"]);
    let upload = e.store_asset("dev:alice", &png(30, 20), 1).unwrap();
    let path = e.store().asset_path(&upload.id);
    let sweep = e
        .prepare_asset_sweep(1 + snapback4_core::assets::UNCLAIMED_TTL_MS + 1)
        .unwrap();
    assert_eq!(sweep.len(), 1);
    assert_eq!(
        e.asset_access("dev:alice", &upload.id, 2)
            .unwrap_err()
            .code(),
        "E_ASSET_UNKNOWN"
    );
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(
        tx.claim_asset(&upload.id, "dev:alice", "messages", "some-row", "photo")
            .unwrap_err()
            .code(),
        "E_ASSET_UNKNOWN",
        "an asset staged for GC cannot be reclaimed before its file is removed"
    );
    tx.rollback().unwrap();
    assert!(path.is_file());
    sweep.remove_files().unwrap();
    assert!(!path.exists());
    assert_eq!(e.finish_asset_sweep(&sweep).unwrap(), 1);
    assert!(e.store().asset(&upload.id).unwrap().is_none());
}

#[cfg(unix)]
#[test]
fn stores_sidecars_assets_and_existing_files_are_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("sb4-security-{}", snapback4_core::ids::mint(1, &mut 0).unwrap()));
    std::fs::create_dir(&dir).unwrap();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    let db = dir.join("store.sqlite");
    std::fs::write(&db, []).unwrap(); std::fs::set_permissions(&db, std::fs::Permissions::from_mode(0o644)).unwrap();
    let store = Store::open(&db).unwrap();
    assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
    for path in [db.clone(), dir.join("store.sqlite-wal"), dir.join("store.sqlite-shm")] {
        assert_eq!(std::fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let old = store.assets_dir().join("old"); std::fs::write(&old, b"private").unwrap();
    std::fs::set_permissions(&old, std::fs::Permissions::from_mode(0o644)).unwrap(); drop(store);
    let reopened = Store::open(&db).unwrap();
    assert_eq!(std::fs::metadata(old).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(reopened.assets_dir()).unwrap().permissions().mode() & 0o777, 0o700);
    // A store in memory makes no directory until its first upload (and drops it
    // with the store); the owner-only mode of the one it makes is asserted in
    // `an_in_memory_store_leaves_no_assets_directory_behind`.
    let memory = Store::memory().unwrap();
    assert!(!memory.assets_dir().exists());
    drop(memory); drop(reopened); std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_in_memory_store_leaves_no_assets_directory_behind() {
    // Before: every `Store::memory()` created `$TMPDIR/snapback4-<pid>-<ulid>`
    // and nothing removed it — 4.1 million empty directories on one machine
    // after a week of test runs. Now nothing exists until the first upload,
    // and the store's drop removes whatever it made.
    let e = chat_engine_from(CHAT, &["dev:alice"]);
    let dir = e.store().assets_dir().to_path_buf();
    assert!(dir.starts_with(std::env::temp_dir()), "{}", dir.display());
    assert!(!dir.exists(), "an in-memory store made {} before any upload", dir.display());
    drop(e);
    assert!(!dir.exists());

    let mut e = chat_engine_from(CHAT, &["dev:alice"]);
    let dir = e.store().assets_dir().to_path_buf();
    let upload = e.store_asset("dev:alice", &png(30, 20), 1).unwrap();
    assert!(e.store().asset_path(&upload.id).is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
    }
    drop(e);
    assert!(!dir.exists(), "dropping the store must remove its directory and the upload in it");
}

#[test]
fn a_detached_upload_cannot_resurrect_a_dropped_stores_directory() {
    // `prepare_asset` hands out an upload that does not borrow the engine. If
    // the engine is dropped first, the upload's write recreates the directory
    // and its drop must take it away again (review finding, 2026-09-19).
    let mut e = chat_engine_from(CHAT, &["dev:alice"]);
    let dir = e.store().assets_dir().to_path_buf();
    let bytes = png(30, 20);
    let upload = e.prepare_asset("dev:alice", snapback4_core::assets::sniff(&bytes).unwrap(), bytes.len() as u64, 1).unwrap();
    drop(e);
    assert!(!dir.exists());
    let upload = upload.write(&bytes).unwrap();
    assert!(dir.is_dir(), "the write recreated the directory");
    drop(upload);
    assert!(!dir.exists(), "an uncommitted upload leaves nothing behind, directory included");
}
