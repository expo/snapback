//! Compare the incremental index plan with the former whole-store activation.
use super::*;
use crate::{Context, Engine, value::object};
const BASE: &str = r#"
table posts:
  author: principal
  at: time
  parent: posts ?
  amount: int
  immutable author, at, parent
  public
  sync public
table likes:
  post: posts
  author: principal
  at: time
  immutable post, author, at
  public
  sync public
table unrelated:
  owner: principal
  n: int
  read <- .owner = viewer
  sync to .owner
query unrelated(owner: principal):
  return unrelated where .owner = owner first 10 by .id
"#;
const VIEWS: &str = r#"
view originalTotals: count posts where .parent = null by .author
view receivedLikes: count likes by .post.author
view receivedReplies: count posts where .parent != null by .parent.author
view dailyPosts: count posts where .parent = null by .author, day(.at)
view dailyLikes: count likes by .post.author, day(.at)
view sums: sum posts of .amount by .author
query total(owner: principal):
  return receivedLikes[owner]
"#;
struct Bound {
    schema: Schema,
    programs: Vec<crate::ir::Program>,
}
fn compile(s: &str) -> Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), s.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Bound {
        schema: serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap(),
        programs: b
            .programs
            .into_iter()
            .map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap())
            .collect(),
    }
}
fn engine(full: bool) -> Engine {
    let b = compile(BASE);
    let mut store = Store::memory().unwrap();
    store.full_adoption = full;
    let mut e = Engine::new_at(store, b.schema, b.programs, 10).unwrap();
    for n in 0..40 {
        e.seed_at(
            [(
                "posts".into(),
                object([
                    ("id", Value::Id(format!("p{n}"))),
                    ("author", Value::Id(format!("u{}", n % 3))),
                    ("at", Value::Int(n * 86_400_000 - 1)),
                    (
                        "parent",
                        if n % 2 == 0 {
                            Value::Null
                        } else {
                            Value::Id(format!("p{}", n - 1))
                        },
                    ),
                    ("amount", Value::Int(n - 20)),
                ]),
            )],
            10,
        )
        .unwrap();
        e.seed_at(
            [(
                "likes".into(),
                object([
                    ("id", Value::Id(format!("l{n}"))),
                    ("author", Value::Id("reader".into())),
                    ("post", Value::Id(format!("p{}", n + 1))),
                    ("at", Value::Int(n)),
                ]),
            )],
            10,
        )
        .unwrap();
    }
    e.seed_at(
        [(
            "unrelated".into(),
            object([
                ("id", Value::Id("other".into())),
                ("owner", Value::Id("private".into())),
                ("n", Value::Int(5)),
            ]),
        )],
        10,
    )
    .unwrap();
    e
}
fn rows(e: &Engine, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut stmt = e
        .store()
        .conn()
        .prepare(&format!("SELECT * FROM {table} ORDER BY 1,2,3"))
        .unwrap();
    let columns = stmt.column_count();
    stmt.query_map([], |r| (0..columns).map(|i| r.get(i)).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}
fn same(a: &Engine, b: &Engine) {
    assert_eq!(a.generation(), b.generation());
    assert_eq!(a.seq().unwrap(), b.seq().unwrap());
    for table in ["r", "i", "_log", "_commits"] {
        assert_eq!(rows(a, table), rows(b, table), "{table}");
    }
}

#[test]
fn activation_workspace_rolls_back_and_restores_the_callers_cache() {
    let mut e = engine(false);
    e.store().conn().pragma_update(None, "cache_size", 7).unwrap();
    let before = [rows(&e, "r"), rows(&e, "i"), rows(&e, "_commits")];
    let generation = e.generation();
    let b = compile(&format!("{BASE}{VIEWS}"));
    e.store().conn().commit_hook(Some(|| true)).unwrap();
    assert!(e.adopt_at(b.schema.clone(), b.programs.clone(), 20).is_err());
    e.store().conn().commit_hook(None::<fn() -> bool>).unwrap();
    assert_eq!(e.generation(), generation);
    for (table, expected) in ["r", "i", "_commits"].into_iter().zip(before) { assert_eq!(rows(&e, table), expected); }
    let conn = e.store().conn();
    assert_eq!(conn.pragma_query_value(None, "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 7);
    assert_eq!(conn.query_row("SELECT count(*) FROM sqlite_temp_schema WHERE name='_adoption_index'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    e.adopt_at(b.schema, b.programs, 20).unwrap();
    assert_eq!(e.store().conn().pragma_query_value(None, "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 7);
}

#[test]
fn activation_nomem_rolls_back_every_write_then_retries_at_the_original_cache() {
    let (mut retry, mut control) = (engine(false), engine(false));
    let next = compile(&format!("{BASE}\nquery latest():\n  return unrelated last 10 by .n\n"));
    let programs: BTreeMap<_, _> = next.programs.into_iter().map(|p| (p.name.clone(), p)).collect();
    for (engine, inject) in [(&mut retry, true), (&mut control, false)] {
        let before: Vec<_> = ["r", "i", "_log", "_commits"].map(|t| rows(engine, t)).into();
        engine.store().conn().pragma_update(None, "cache_size", 7).unwrap();
        engine.store().conn().pragma_update(Some("temp"), "cache_size", 9).unwrap();
        let mut calls = 0;
        let generation = engine.store_mut().with_activation_cache(64, |store| {
            calls += 1;
            if calls == 2 {
                assert!(store.conn().is_autocommit());
                assert_eq!(store.conn().pragma_query_value(None, "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 7);
                assert_eq!(store.conn().pragma_query_value(Some("temp"), "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 9);
                for (table, expected) in ["r", "i", "_log", "_commits"].into_iter().zip(&before) {
                    let mut stmt = store.conn().prepare(&format!("SELECT * FROM {table} ORDER BY 1,2,3")).unwrap();
                    let columns = stmt.column_count();
                    let actual: Vec<Vec<rusqlite::types::Value>> = stmt.query_map([], |r| (0..columns).map(|i| r.get(i)).collect()).unwrap().collect::<Result<_, _>>().unwrap();
                    assert_eq!(&actual, expected, "{table} leaked from the failed attempt");
                }
                assert_eq!(store.meta("generation").unwrap().as_deref(), Some("1"));
                assert_eq!(store.conn().query_row("SELECT count(*) FROM sqlite_temp_schema WHERE name='_adoption_index'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            }
            store.activate_transaction(&next.schema, Some(&programs), false, 20, true, |tx, _, _| {
                // Inject after index writes and a real builder write, not at an
                // empty transaction's entry. The retry must start from scratch.
                let row = object([("id", Value::Id("built".into())), ("owner", Value::Id("u".into())), ("n", Value::Int(9))]);
                tx.put("unrelated", &next.schema.tables["unrelated"], &row, None)?;
                tx.record_commit(tx.next_seq()?, 20, "rebuild", crate::SYSTEM_PRINCIPAL, "rebuild", &["unrelated".into()], 1)?;
                if inject && calls == 1 {
                    return Err(rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_NOMEM), Some("out of memory".into())).into());
                }
                Ok(())
            })
        }).unwrap();
        assert_eq!(generation, 2);
        assert_eq!(calls, if inject { 2 } else { 1 });
        assert_eq!(engine.store().conn().pragma_query_value(None, "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 7);
        assert_eq!(engine.store().conn().pragma_query_value(Some("temp"), "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 9);
        assert_eq!(engine.store().adoption_report.phases.iter().any(|(name, _)| *name == "memory fallback (rolled back)"), inject);
    }
    same(&retry, &control);
}

#[test]
fn retirement_only_and_mixed_adoptions_always_warn_about_their_write_work() {
    const SOURCE: &str = "table entries:\n  n: int\n  by byN: n\n  public\n";
    let source = compile(SOURCE);
    let mut engine = Engine::new_at(Store::memory().unwrap(), source.schema, source.programs, 1).unwrap();
    engine.seed_at((0..1000).map(|n| ("entries".into(), object([("id", Value::Id(format!("r{n}"))), ("n", Value::Int(n))]))), 1).unwrap();
    for (next, rows, indexes, mixed) in [
        ("", 1000, 2000, false),
        ("table entries:\n  n: int\n  public\n", 0, 1000, false),
        ("table entries:\n  n: int\n  public\nview totals: count entries by .n\n", 0, 1000, true),
    ] {
        let next = compile(next);
        let estimate = engine.store_mut().adoption_estimate(&next.schema).unwrap().unwrap();
        assert_eq!((estimate.retired_rows, estimate.retired_index_entries), (rows, indexes));
        let message = estimate.summary();
        assert!(message.contains("unestimated") && message.contains("retirement pause"), "{message}");
        assert!(message.contains("147 MiB") && message.contains("SNAPBACK4_ADOPTION_CACHE_MIB"), "{message}");
        if mixed { assert!(estimate.aggregate_rows > 0 && message.contains("not a floor")); }
    }
}

#[test]
fn generated_rebuilds_keep_sparse_rows_captures_indexes_and_wide_sum_cancellation() {
    for seed in 0..12_u64 {
        let (mut fast, mut slow) = (engine(false), engine(true));
        let mut random = seed + 1;
        for n in 0..31 {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            let amount = if n % 2 == 0 { crate::value::I53_MAX / 4 } else { -(crate::value::I53_MAX / 4) };
            let row = object([("id", Value::Id(format!("generated{n}"))), ("author", Value::Id(format!("u{}", random % 7))),
                ("at", Value::Int((random % 100_000_000) as i64 - 50_000_000)), ("parent", Value::Null), ("amount", Value::Int(amount))]);
            for e in [&mut fast, &mut slow] { e.seed_at([("posts".into(), row.clone())], 10).unwrap(); }
        }
        for e in [&fast, &slow] {
            e.store().conn().execute("UPDATE r SET data=json_remove(data, '$.Row.parent') WHERE t=(SELECT num FROM _catalog WHERE name='posts') AND id LIKE 'generated%'", []).unwrap();
        }
        let extra = VIEWS.replace("sum posts of .amount by .author", "sum posts of .amount by .parent");
        let b = compile(&format!("{BASE}{extra}"));
        for e in [&mut fast, &mut slow] { e.adopt_at(b.schema.clone(), b.programs.clone(), 20).unwrap(); }
        same(&fast, &slow);
        assert_eq!(fast.store().conn().query_row("SELECT count(*) FROM r WHERE t=(SELECT num FROM _catalog WHERE name='posts') AND id LIKE 'generated%' AND json_type(data, '$.Row.parent') IS NULL", [], |r| r.get::<_, i64>(0)).unwrap(), 31);
    }
}
#[test]
fn optimized_activation_equals_full_rows_indexes_log_images_and_sequence() {
    let (mut optimized, mut full) = (engine(false), engine(true));
    same(&optimized, &full);
    for extra in [
        VIEWS.to_owned(),
        format!("{VIEWS}\nquery newest():\n  return unrelated last 10 by .n\n"),
        VIEWS.replace("day(.at)", "day(.at, 8h)"),
    ] {
        let b = compile(&format!("{BASE}{extra}"));
        for e in [&mut optimized, &mut full] {
            e.adopt_at(b.schema.clone(), b.programs.clone(), 20)
                .unwrap();
        }
        same(&optimized, &full);
    }
    // The captured fact belongs to the old source even if the target vanishes.
    for e in [&mut optimized, &mut full] {
        e.seed_delete("posts", "p1").unwrap();
    }
    let b = compile(&format!(
        "{BASE}{}",
        VIEWS.replace("count likes by", "count likes where .at > 5 by")
    ));
    for e in [&mut optimized, &mut full] {
        e.adopt_at(b.schema.clone(), b.programs.clone(), 30)
            .unwrap();
    }
    // seed_delete takes wall time; compare data/log and sequences, not its clock.
    for table in ["r", "i", "_log"] {
        assert_eq!(rows(&optimized, table), rows(&full, table), "{table}");
    }
    let result = optimized
        .query_at(
            "total",
            Context::new(
                "reader",
                BTreeMap::from([("owner".into(), Value::Id("u1".into()))]),
            )
            .at(30),
        )
        .0
        .unwrap();
    assert!(result.complete);
}

#[test]
fn an_added_view_does_not_touch_an_unrelated_index() {
    let mut e = engine(false);
    e.store().conn().execute_batch("CREATE TEMP TRIGGER forbid_unrelated_delete BEFORE DELETE ON i WHEN OLD.ti = (SELECT num FROM _catalog WHERE name = 'unrelated.byId') BEGIN SELECT RAISE(ABORT, 'unrelated index was rewritten'); END; CREATE TEMP TRIGGER forbid_unrelated_insert BEFORE INSERT ON i WHEN NEW.ti = (SELECT num FROM _catalog WHERE name = 'unrelated.byId') BEGIN SELECT RAISE(ABORT, 'unrelated index was rewritten'); END;").unwrap();
    let b = compile(&format!("{BASE}{VIEWS}"));
    e.adopt_at(b.schema, b.programs, 20).unwrap();
}

#[test]
fn changed_defaults_rebuild_unique_and_word_keys_from_legacy_absent_fields() {
    let old = "table notes:\n  label: text <=20 default 'old'\n  at: time default 0\n  unique label\n  search label\n  public\nquery page():\n  return notes matching 'new' first 10 by .at\n";
    let mut engines = Vec::new();
    for full in [false, true] {
        let b = compile(old);
        let mut store = Store::memory().unwrap();
        store.full_adoption = full;
        let mut engine = Engine::new_at(store, b.schema.clone(), b.programs, 1).unwrap();
        let tx = engine.store_mut().transaction().unwrap();
        tx.put(
            "notes",
            &b.schema.tables["notes"],
            &object([("id", Value::Id("n".into()))]),
            None,
        )
        .unwrap();
        tx.commit().unwrap();
        let next = compile(&old.replace("default 'old'", "default 'new'"));
        engine.adopt_at(next.schema, next.programs, 2).unwrap();
        engines.push(engine);
    }
    same(&engines[0], &engines[1]);
    let result = engines[0]
        .query("page", Context::new("reader", BTreeMap::new()))
        .unwrap();
    assert!(result.complete);
    assert!(canonical_json(&result.data).contains("new"));
}

#[test]
fn rebuilt_maintains_reject_unchanged_unique_and_cap_violations_atomically() {
    const SOURCE: &str = "table items:\n  owner: principal\n  active: bool\n  public\n  sync public\n";
    for unique in [true, false] {
        for full in [false, true] {
            let base = compile(SOURCE);
            let mut store = Store::memory().unwrap();
            store.full_adoption = full;
            let mut e = Engine::new_at(store, base.schema, base.programs, 1).unwrap();
            e.seed_at([( "a", true), ("a", false), ("b", true), ("b", true)].into_iter().enumerate().map(|(n, (owner, active))|
                ("items".into(), object([("id", Value::Id(n.to_string())), ("owner", Value::Id(owner.into())), ("active", Value::Bool(active))]))), 2).unwrap();
            let old = format!("{SOURCE}view totals: count items where .active by .owner\nquery total(owner: principal):\n  return totals[owner]\n");
            let constrained = |source: &str| {
                let mut bound = compile(source);
                let target = bound.schema.tables.get_mut("totals").unwrap();
                target.indexes.insert("valueKey".into(), crate::schema::Index::of(&["value"], unique));
                if !unique { target.constraints.push(crate::schema::Constraint::Cap {by:vec!["value".into()],max:1}); }
                bound
            };
            let first = constrained(&old);
            e.adopt_at(first.schema, first.programs, 3).unwrap();
            let generation = e.generation();
            let seq = e.seq().unwrap();
            let tables = ["r", "i", "_log", "_commits", "_generations"];
            let before: Vec<_> = tables.iter().map(|t| rows(&e, t)).collect();
            let next = constrained(&old.replace(" where .active", ""));
            let error = e.adopt_at(next.schema, next.programs, 4).unwrap_err();
            assert!(error.to_string().contains(if unique {"existing group exceeds a unique key"} else {"existing group exceeds cap"}), "unique={unique} full={full}: {error}");
            assert_eq!(e.generation(), generation);
            assert_eq!(e.seq().unwrap(), seq);
            for (table, before) in tables.into_iter().zip(before) { assert_eq!(rows(&e, table), before, "{table} rollback"); }
            for (owner, expected) in [("a", 1), ("b", 2)] {
                let value = e.query("total", Context::new("reader", BTreeMap::from([("owner".into(), Value::Id(owner.into()))]))).unwrap();
                assert_eq!(value.data, Value::Int(expected));
                assert!(value.complete);
            }
        }
    }
}

#[test]
fn validated_keys_skip_rescanning_but_legacy_or_changed_proofs_do_not() {
    let source = "table notes:\n  label: text <=8000\n  public\n  online only\n";
    let b = compile(source);
    let mut e = Engine::new_at(Store::memory().unwrap(), b.schema, b.programs, 1).unwrap();
    e.seed_at([("notes".into(),object([("id",Value::Id("row".into())),("label",Value::String("x".repeat(6000)))]))],2).unwrap();
    // A program-only adoption has no index work. An authorizer proves it does
    // not secretly scan even a single previously admitted key.
    e.store().conn().authorizer(Some(|ctx: rusqlite::hooks::AuthContext<'_>| {
        if matches!(ctx.action,rusqlite::hooks::AuthAction::Read {table_name:"i",..}) {rusqlite::hooks::Authorization::Deny}
        else {rusqlite::hooks::Authorization::Allow}
    })).unwrap();
    let b = compile(&format!("{source}query one():\n  return 1\n"));
    e.adopt_at(b.schema.clone(),b.programs.clone(),3).unwrap();
    e.store().conn().authorizer(None::<fn(rusqlite::hooks::AuthContext<'_>)->rusqlite::hooks::Authorization>).unwrap();
    let proof = e.store().meta("index_keys_validated").unwrap();
    // Checking newly generated ordinary keys is required to carry that proof
    // forward, even when the core Schema API bypasses Quarry's static bound.
    let mut indexed = b.schema.clone();
    indexed.tables.get_mut("notes").unwrap().indexes.insert("byLabel".into(),crate::schema::Index::of(&["label"],false));
    let generation = e.generation();
    assert_eq!(e.adopt_at(indexed,b.programs.clone(),4).unwrap_err().code(),"E_INDEX_KEY_BYTES");
    assert_eq!(e.generation(),generation);
    assert_eq!(e.store().meta("index_keys_validated").unwrap(),proof);
    // Legacy keys, or keys from an adoption by an older binary that retained
    // an obsolete proof, still receive the same physical-key refusal.
    for stale in [None,Some("2048:obsolete-activation")] {
        e.store().conn().execute("DELETE FROM _meta WHERE key='index_keys_validated'",[]).unwrap();
        e.store().conn().execute("INSERT INTO i SELECT num, ?1, 'legacy' FROM _catalog WHERE name='notes.byId'",[vec![b'x';3000]]).unwrap();
        if let Some(value)=stale {e.store().set_meta("index_keys_validated",value).unwrap();}
        assert_eq!(e.adopt_at(b.schema.clone(),b.programs.clone(),5).unwrap_err().code(),"E_INDEX_KEY_BYTES");
        assert_eq!(e.generation(),generation);
        assert_eq!(e.store().meta("index_keys_validated").unwrap().as_deref(),stale);
        e.store().conn().execute("DELETE FROM i WHERE id='legacy'",[]).unwrap();
    }
    e.adopt_at(b.schema,b.programs,6).unwrap();
    assert!(e.store().meta("index_keys_validated").unwrap().is_some());
}

#[test]
fn physical_key_edits_invalidate_a_matching_proof() {
    let source = "table notes:\n  public\n  online only\n";
    for update in [false, true] {
        for missing in ["neither", "both", "operation"] {
            let b = compile(source);
            let mut e = Engine::new_at(Store::memory().unwrap(), b.schema, b.programs, 1).unwrap();
            e.seed_at([("notes".into(), object([("id", Value::Id("row".into()))]))], 2).unwrap();
            let generation = e.generation();
            let seq = e.seq().unwrap();
            let proof = e.store().meta("index_keys_validated").unwrap();
            assert!(proof.is_some());
            let legacy = missing != "neither";
            if missing == "both" {
                // Simulate a store blessed by the unguarded predecessor binary.
                e.store().conn().execute_batch("DROP TRIGGER _index_keys_insert_2048; DROP TRIGGER _index_keys_update_2048;").unwrap();
            } else if missing == "operation" {
                // Exactly the guard for the corrupting operation is absent.
                e.store().conn().execute_batch(if update { "DROP TRIGGER _index_keys_update_2048" }
                    else { "DROP TRIGGER _index_keys_insert_2048" }).unwrap();
            }
            // Leave the matching proof alone: only the physical key changes.
            let sql = if update { "UPDATE i SET k = ?1 WHERE id = 'row'" }
                else { "INSERT INTO i SELECT num, ?1, 'corrupt' FROM _catalog WHERE name = 'notes.byId'" };
            assert_eq!(e.store().conn().execute(sql, [vec![b'x'; 3000]]).unwrap(), 1);
            assert_eq!(e.store().meta("index_keys_validated").unwrap(), if legacy { proof.clone() } else { None });
            let guards = rows(&e, "sqlite_master");
            let before: Vec<_> = ["r", "i", "_log", "_commits", "_generations"].map(|t| rows(&e, t)).into();
            let next = compile(&format!("{source}query one():\n  return 1\n"));
            assert_eq!(e.adopt_at(next.schema, next.programs, 3).unwrap_err().code(), "E_INDEX_KEY_BYTES");
            assert_eq!(e.generation(), generation);
            assert_eq!(e.seq().unwrap(), seq);
            assert_eq!(rows(&e, "sqlite_master"), guards, "guard installation rolls back");
            for (table, previous) in ["r", "i", "_log", "_commits", "_generations"].into_iter().zip(before) {
                assert_eq!(rows(&e, table), previous, "{table} rollback");
            }
            assert_eq!(e.store().meta("index_keys_validated").unwrap(), if legacy { proof } else { None });
        }
    }
}
