use super::*;
use snapback4_core::{engine::LoadMode, schema::{ColumnDefault, ColumnType}, successor::{Change, classify, keeps_literal_default_images}, value::object};

fn bare() -> String {
    MODEL.replace("  likeCount: count likes by postId\n", "")
        .replace("  selected: count likes where .active by postId\n", "")
        .replace("  total: sum likes of amount where .active by postId\n", "")
        .replace("byLikes: likeCount, at, id", "byLikes: at, id")
        .replace("{ id, at, likeCount }", "{ id, at }")
}
fn adopt(e: &mut Engine, source: &str) {
    let b = compile(source);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
}
fn no_events(e: &mut Engine, from: u64) {
    assert_eq!(e.seq().unwrap(), from + 1, "activation always records a commit");
    let events: i64 = e.store().conn().query_row("SELECT count(*) FROM _log WHERE seq > ?1", [from as i64], |r| r.get(0)).unwrap();
    assert_eq!(events, 0, "activation mirror emitted row events");
    let touched: String = e.store().conn().query_row("SELECT touched FROM _commits ORDER BY seq DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert!(touched.contains("posts"), "{touched}");
    assert!(!touched.contains("$column:"));
}

#[test]
fn activation_mirror_is_event_free_in_place_and_zero_additions_stay_unwritten() {
    for nonzero in [false, true] {
        let mut e = engine(&bare().replace("  online only", "  sync public"));
        post(&mut e, "p", 17); post(&mut e, "zero", 19);
        if nonzero { like(&mut e, "l", id("p"), true, 7); }
        // Assert at SQLite's row adapter, including REPLACE's insert path.
        e.store().conn().execute_batch("CREATE TRIGGER no_parent_delete BEFORE DELETE ON r WHEN OLD.t = (SELECT num FROM _catalog WHERE name = 'posts') BEGIN SELECT RAISE(ABORT, 'mirror deleted parent'); END;
            CREATE TRIGGER no_parent_insert BEFORE INSERT ON r WHEN NEW.t = (SELECT num FROM _catalog WHERE name = 'posts') AND EXISTS(SELECT 1 FROM r WHERE t=NEW.t AND id=NEW.id) BEGIN SELECT RAISE(ABORT, 'mirror replaced parent'); END;
            CREATE TRIGGER zero_untouched BEFORE UPDATE ON r WHEN OLD.t = (SELECT num FROM _catalog WHERE name = 'posts') AND OLD.id='zero' BEGIN SELECT RAISE(ABORT, 'zero parent written'); END;").unwrap();
        let from = e.seq().unwrap();
        adopt(&mut e, &MODEL.replace("  online only", "  sync public"));
        no_events(&mut e, from);
        assert_eq!(totals(&mut e, "p"), if nonzero {(1,1,7)} else {(0,0,0)});
        assert_eq!(totals(&mut e, "zero"), (0,0,0));
        let rows = e.store().rows("posts").unwrap();
        let p = rows.iter().find(|r| r.field("id").unwrap() == &id("p")).unwrap();
        assert_eq!(p.field("at").unwrap(), &Value::Int(17));
        if nonzero { assert_eq!(p.field("likeCount").unwrap(), &Value::Int(1)); }
        else { assert!(p.field("likeCount").is_err()); }
        let zero = rows.iter().find(|r|r.field("id").unwrap() == &id("zero")).unwrap();
        assert!(zero.field("likeCount").is_err());
        assert_eq!(zero.field("at").unwrap(), &Value::Int(19));
        assert!(e.schema().tables["posts"].defaults.get("likeCount").is_none());
        let indexed=e.query("ranked",context(&[("c",Value::Null)])).unwrap();
        assert!(indexed.data.as_array().unwrap().iter().any(|r|r.field("id").unwrap()==&id("zero") && r.field("likeCount").unwrap()==&Value::Int(0)),"index build includes implicit zero");
    }
}

#[test]
fn redefinition_zero_removal_and_readdition_preserve_other_fields() {
    let mut e = engine(&MODEL.replace("  online only", "  sync public"));
    post(&mut e, "p", 17); like(&mut e, "l", id("p"), true, 7);
    e.store().conn().execute_batch("CREATE TRIGGER no_parent_delete BEFORE DELETE ON r WHEN OLD.t = (SELECT num FROM _catalog WHERE name = 'posts') BEGIN SELECT RAISE(ABORT, 'mirror deleted parent'); END;
        CREATE TRIGGER no_parent_insert BEFORE INSERT ON r WHEN NEW.t = (SELECT num FROM _catalog WHERE name = 'posts') AND EXISTS(SELECT 1 FROM r WHERE t=NEW.t AND id=NEW.id) BEGIN SELECT RAISE(ABORT, 'mirror replaced parent'); END;").unwrap();
    let target = e.schema().maintains.iter().find(|m|m.private.as_ref().unwrap().column == "likeCount").unwrap().target.clone();
    let from = e.seq().unwrap();
    adopt(&mut e, &MODEL.replace("count likes by postId", "count likes where .active = false by postId").replace("  online only", "  sync public"));
    no_events(&mut e, from);
    e.store().conn().execute_batch("DROP TRIGGER no_parent_delete; DROP TRIGGER no_parent_insert;").unwrap();
    assert_eq!(totals(&mut e, "p"), (0,1,7));
    let row = e.store().rows("posts").unwrap().remove(0);
    assert_eq!(row.field("likeCount").unwrap(), &Value::Int(0));
    assert_eq!(row.field("at").unwrap(), &Value::Int(17));
    let removed = MODEL.replace("  likeCount: count likes by postId\n", "").replace("byLikes: likeCount, at, id", "byLikes: at, id").replace("{ id, at, likeCount }", "{ id, at }");
    adopt(&mut e, &removed);
    assert!(e.schema().table(&target).is_none());
    assert!(e.schema().maintain_for(&target).is_none());
    let count: i64 = e.store().conn().query_row("SELECT count(*) FROM r WHERE t=(SELECT num FROM _catalog WHERE name=?1)", [&target], |r|r.get(0)).unwrap();
    assert_eq!(count, 0);
    like(&mut e, "l2", id("p"), false, 4);
    adopt(&mut e, MODEL);
    assert_eq!(totals(&mut e, "p"), (2,1,7));
}

#[test]
fn classify_keeps_ordinary_narrowing_and_never_keeps_pre_generation_images() {
    let old = compile(&bare()).schema;
    let mut new = compile(MODEL).schema;
    assert!(new.maintain_for("posts").is_none());
    let steps = classify(&old, &new);
    assert!(steps.iter().any(|s|s.path == "tables.posts.columns.likeCount" && s.change == Change::Additive && s.message.contains("required maintained column")));
    assert!(!keeps_literal_default_images(&old.public_projection(), &new.public_projection()));
    let mut old = old;
    old.tables.get_mut("posts").unwrap().columns.insert("body".into(), ColumnType::Text {max: 100});
    new.tables.get_mut("posts").unwrap().columns.insert("body".into(), ColumnType::Text {max: 10});
    assert!(classify(&old, &new).iter().any(|s|s.path == "tables.posts.columns.body" && s.change == Change::Narrowing));
}

#[test]
fn source_default_widened_optional_recounts_missing_references() {
    let mut b = compile(MODEL);
    let reference = ColumnType::Ref {table:"posts".into()};
    b.schema.tables.get_mut("likes").unwrap().columns.insert("postId".into(),reference.clone());
    b.schema.tables.get_mut("likes").unwrap().defaults.insert("postId".into(),ColumnDefault::Literal(id("p")));
    for m in &b.schema.maintains { b.schema.tables.get_mut(&m.target).unwrap().columns.insert(snapback4_core::schema::columns::GROUP.into(),reference.clone()); }
    let mut e = Engine::memory(b.schema.clone(), b.programs.iter().map(|p|p.program.clone())).unwrap();
    post(&mut e, "p", 1); like(&mut e, "l", id("p"), true, 9);
    e.store().conn().execute_batch("UPDATE r SET data=json_remove(data, '$.Row.postId') WHERE t=(SELECT num FROM _catalog WHERE name='likes')").unwrap();
    b.schema.tables.get_mut("likes").unwrap().columns.insert("postId".into(),ColumnType::Optional(Box::new(reference.clone())));
    for m in &b.schema.maintains { b.schema.tables.get_mut(&m.target).unwrap().columns.insert(snapback4_core::schema::columns::GROUP.into(),ColumnType::Optional(Box::new(reference.clone()))); }
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(totals(&mut e,"p"),(0,0,0));
}

#[test]
fn expired_parent_skipped_on_activation_then_swept_and_recreated_right() {
    let before = bare().replacen("  at: time", "  expiresAt: time ?\n  by byExpiry: expiresAt, id\n  expire at .expiresAt\n  at: time", 1);
    let after = MODEL.replacen("  at: time", "  expiresAt: time ?\n  by byExpiry: expiresAt, id\n  expire at .expiresAt\n  at: time", 1);
    let mut e = engine(&before);
    e.load_mode([("posts".into(),object([("id",id("p")),("at",Value::Int(1)),("expiresAt",Value::Int(1))]))],LoadMode::Restore).unwrap();
    like(&mut e,"l",id("p"),true,4);
    post(&mut e,"live",2); like(&mut e,"live-like",id("live"),true,5);
    e.store().conn().execute_batch("CREATE TRIGGER no_expired_put BEFORE UPDATE ON r WHEN NEW.t=(SELECT num FROM _catalog WHERE name='posts') AND NEW.id='p' BEGIN SELECT RAISE(ABORT,'expired put'); END").unwrap();
    let b = compile(&after);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 1000).unwrap();
    let rows = e.store().rows("posts").unwrap();
    assert!(rows.iter().find(|r| r.field("id").unwrap() == &id("p")).unwrap().field("likeCount").is_err());
    assert_eq!(rows.iter().find(|r| r.field("id").unwrap() == &id("live")).unwrap().field("likeCount").unwrap(), &Value::Int(1));
    e.store().conn().execute_batch("DROP TRIGGER no_expired_put").unwrap();
    e.sweep_expired(1000, 100).unwrap();
    post(&mut e,"p",2);
    assert_eq!(totals(&mut e,"p"),(1,1,4));
}

#[test]
fn activation_uses_host_clock_on_both_sides_of_parent_expiry() {
    for live_on_host in [true, false] {
        let wall = snapback4_core::now_ms();
        let host = wall + if live_on_host { -7_200_000 } else { 7_200_000 };
        let expires = wall + if live_on_host { -3_600_000 } else { 3_600_000 };
        assert_eq!(host < expires, live_on_host);
        assert_eq!(expires < wall, live_on_host);
        let expiry = "  expiresAt: time ?\n  by byExpiry: expiresAt, id\n  expire at .expiresAt\n  at: time";
        let before = bare().replacen("  at: time", expiry, 1);
        let after = MODEL.replacen("  at: time", expiry, 1);
        for reopen in [false, true] {
            let dir = std::env::temp_dir().join(format!("sb4-activation-clock-{}-{live_on_host}-{reopen}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("store.sqlite");
            let b = compile(&before);
            let mut e = Engine::new(snapback4_core::Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            e.seed_at([("posts".into(), object([("id",id("p")),("at",Value::Int(17)),("expiresAt",Value::Int(expires))]))], host.min(expires - 1)).unwrap();
            like(&mut e,"l",id("p"),true,4);
            if !live_on_host {
                e.store().conn().execute_batch("CREATE TRIGGER no_expired_put BEFORE UPDATE ON r WHEN NEW.t=(SELECT num FROM _catalog WHERE name='posts') BEGIN SELECT RAISE(ABORT,'expired parent written'); END").unwrap();
            }
            let b = compile(&after);
            if reopen {
                drop(e);
                e = Engine::new_at(snapback4_core::Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program), host).unwrap();
            } else {
                e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), host).unwrap();
            }
            let stored = e.store().rows("posts").unwrap().remove(0);
            assert_eq!(stored.field("at").unwrap(), &Value::Int(17));
            if live_on_host { assert_eq!(stored.field("likeCount").unwrap(), &Value::Int(1)); }
            else { assert!(stored.field("likeCount").is_err()); }
            drop(e);
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
}
