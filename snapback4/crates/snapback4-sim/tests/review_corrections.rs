//! Architectural review regressions over authored programs and real SQLite.
use snapback4_core::{Context, Engine, Store, Value, WriteState, wire};
use snapback4_core::value::{canonical_json, I53_MAX};
use std::collections::BTreeMap;

fn compile(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn engine(source: &str) -> Engine {
    let b = compile(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn ctx() -> Context { Context::new("dev:alice", BTreeMap::new()).at(1000) }
fn seed(e: &mut Engine, table: &str, rows: serde_json::Value) {
    let rows = rows.as_array().unwrap().iter().map(|row| (table.into(), wire::row_from_json(e.schema().table(table).unwrap(), row).unwrap())).collect::<Vec<_>>();
    e.seed(rows).unwrap();
}
fn adopt(e: &mut Engine, source: &str) -> Result<u64, snapback4_core::error::RuntimeError> {
    let b = compile(source);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program))
}
const ITEMS: &str = "table items:\n  body: text <=100\n  by byBody: body\n  read <- allow\n  update <- allow\n  sync public\nquery q():\n  return items['a'] by byId\n";

#[test]
fn checked_narrowing_is_atomic_for_types_unique_and_caps() {
    let mut e = engine(ITEMS);
    seed(&mut e, "items", serde_json::json!([{"id":"a","body":"same"},{"id":"b","body":"same"}]));
    let generation = e.generation();
    let hash = e.schema().hash();
    for candidate in [ITEMS.replace("<=100", "<=1"), ITEMS.replace("by byBody", "unique byBody"), ITEMS.replace("  read <- allow", "  cap 1 by body\n  read <- allow")] {
        assert!(adopt(&mut e, &candidate).is_err());
        assert_eq!(e.generation(), generation);
        assert_eq!(e.schema().hash(), hash);
        assert_eq!(e.query("q", ctx()).unwrap().data.field("body").unwrap(), &Value::String("same".into()));
    }
}

#[test]
fn projection_removes_fields_and_dropped_tables_do_not_resurrect() {
    let mut e = engine(ITEMS);
    seed(&mut e, "items", serde_json::json!([{"id":"a","body":"obsolete"}]));
    let next = "table items:\n  read <- allow\n  update <- allow\n  sync public\nquery q():\n  return items['a'] by byId\nmutation touch():\n  update items['a'] {}\n";
    adopt(&mut e, next).unwrap();
    let row = e.query("q", ctx()).unwrap().data;
    assert_eq!(wire::to_json(&row), serde_json::json!({"id":"a"}));
    assert!(matches!(e.mutate("touch", Some("touch"), ctx()).unwrap().state, WriteState::Sent { .. }));
    assert!(e.snapshot("dev:alice").unwrap().0.iter().all(|e| e.data.as_ref().is_none_or(|r| r.field("body").is_err())));
    adopt(&mut e, "query q():\n  return null\n").unwrap();
    adopt(&mut e, ITEMS).unwrap();
    assert_eq!(e.query("q", ctx()).unwrap().data, Value::Null);
}

#[test]
fn restart_and_competing_owner_use_semantic_generations() {
    let dir = std::env::temp_dir().join(format!("sb4-activation-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let open = |source: &str| { let b = compile(source); Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p|p.program)).unwrap() };
    let mut old = open(ITEMS);
    seed(&mut old, "items", serde_json::json!([{"id":"a","body":"kept"}]));
    let first = old.generation();
    let same = open(ITEMS);
    assert_eq!(same.generation(), first);
    drop(same);
    let mut next = open(&ITEMS.replace("<=100", "<=200"));
    assert_eq!(next.generation(), first + 1);
    assert_eq!(old.query("q", ctx()).unwrap_err().code, "E_GENERATION");
    assert_eq!(next.query("q", ctx()).unwrap().data.field("body").unwrap(), &Value::String("kept".into()));
    drop(next);
    let reverted = open(ITEMS);
    assert_eq!(reverted.generation(), first + 2);
    assert_eq!(old.query("q", ctx()).unwrap_err().code, "E_GENERATION");
    assert!(adopt(&mut old, ITEMS).is_err());
    drop(reverted); drop(old);
    let changed_program = open(&ITEMS.replace("return items['a'] by byId", "return null"));
    assert_eq!(changed_program.generation(), first + 3);
    drop(changed_program);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn failed_derived_rebuild_and_sql_commit_keep_previous_activation() {
    let source = "table items:\n  category: text <=10\n  amount: int\n  read <- allow\nquery q():\n  return 1\n";
    let mut e = engine(source);
    seed(&mut e, "items", serde_json::json!([{"id":"a","category":"g","amount":I53_MAX},{"id":"b","category":"g","amount":1}]));
    let generation = e.generation();
    let candidate = format!("{source}\nmaintain sums: sum items of amount by category\n  read <- allow\n");
    assert!(adopt(&mut e, &candidate).is_err());
    assert_eq!(e.generation(), generation);
    assert_eq!(e.query("q", ctx()).unwrap().data, Value::Int(1));
    e.store().conn().execute_batch("CREATE TRIGGER refuse_activation BEFORE UPDATE ON _meta WHEN NEW.key = 'generation' BEGIN SELECT RAISE(ABORT, 'injected activation failure'); END;").unwrap();
    assert!(adopt(&mut e, &source.replace("return 1", "return 2")).is_err());
    assert_eq!(e.query("q", ctx()).unwrap().data, Value::Int(1));
    assert_eq!(e.generation(), generation);
}

#[test]
fn json_numbers_are_checked_at_every_untyped_depth() {
    let kind = snapback4_core::ir::ArgType::Json { max_bytes: 1000 };
    for value in [serde_json::json!(1.25), serde_json::json!({"a":[{"b":1.25}]}), serde_json::json!(u64::MAX), serde_json::json!(I53_MAX + 1)] {
        assert!(wire::from_json(&kind, &value).is_err(), "{value}");
    }
    let value = serde_json::json!({"min":-I53_MAX,"max":I53_MAX,"zero":0});
    assert_eq!(wire::to_json(&wire::from_json(&kind, &value).unwrap()), value);
}

#[test]
fn output_budget_refuses_indivisible_results_and_rolls_back_mutations() {
    for source in ["query q():\n  return 'abcdefghijklmnopqrstuvwxyz'\n", "query q():\n  return {text: 'abcdefghijklmnopqrstuvwxyz'}\n", "query q():\n  return ['abcdefghijklmnopqrstuvwxyz']\n"] {
        let mut e = engine(source);
        let data = e.query("q", ctx()).unwrap().data;
        let bytes = canonical_json(&data).len() as u64;
        let mut ceilings = e.ceilings(); ceilings.output_bytes = bytes;
        e.set_ceilings(ceilings);
        assert!(e.query("q", ctx()).is_ok());
        ceilings.output_bytes -= 1; e.set_ceilings(ceilings);
        assert_eq!(e.query("q", ctx()).unwrap_err().code, "E_BOUND");
    }
    let mut e = engine("table items:\n  read <- allow\n  insert <- allow\nmutation add():\n  row = insert items {}\n  return 'abcdefghijklmnopqrstuvwxyz'\n");
    let mut ceilings = e.ceilings(); ceilings.output_bytes = 5; e.set_ceilings(ceilings);
    assert!(matches!(e.mutate("add", Some("a"), ctx()).unwrap().state, WriteState::Failed { why, .. } if why.code == "E_BOUND"));
    assert_eq!(e.store().count("items").unwrap(), 0);
}

#[test]
fn updating_one_created_row_keeps_sibling_facts() {
    let source = "table grants:\n  name: text <=10\n  unique byName: name\n  read <- allow\n  insert <- allow\n  update <- allow\ntable items:\n  name: text <=10\n  read <- allow\n  insert <- created grants[.name]\nmutation add():\n  a = insert grants {name: 'a'}\n  b = insert grants {name: 'b'}\n  update grants[a] {name: 'c'}\n  insert items {name: 'b'}\n  insert items {name: 'c'}\n  return null\n";
    let mut e = engine(source);
    assert!(matches!(e.mutate("add", Some("a"), ctx()).unwrap().state, WriteState::Sent { .. }));
    assert_eq!(e.store().count("items").unwrap(), 2);
}

#[test]
fn inserted_constraint_images_survive_later_updates_and_deletes() {
    let source = "table targets:\n  name: text <=10\n  unique byName: name\n  read <- allow\n  insert <- allow\ntable sources:\n  name: text <=10\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  after insert <- exists targets[.name]\nmutation remove():\n  s = insert sources {name: 'a'}\n  delete sources[s]\nmutation change():\n  s = insert sources {name: 'a'}\n  update sources[s] {name: 'b'}\n  insert targets {name: 'b'}\n";
    let mut e = engine(source);
    for op in ["remove", "change"] {
        assert!(matches!(e.mutate(op, Some(op), ctx()).unwrap().state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"));
        assert_eq!(e.store().count("sources").unwrap(), 0);
        assert_eq!(e.store().count("targets").unwrap(), 0);
    }
}

#[test]
fn current_release_is_checked_under_activation_lock_and_attach_never_adopts() {
    let dir = std::env::temp_dir().join(format!("sb4-release-cas-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let activate = |source: &str, release, previous| { let b = compile(source); Engine::new_release(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program), release, previous) };
    let first = activate(ITEMS, 1, None).unwrap();
    drop(first);
    let next = activate(&ITEMS.replace("<=100", "<=200"), 2, Some(1)).unwrap();
    assert!(activate(ITEMS, 3, Some(1)).is_err());
    assert!(Engine::attach_release(Store::open(&path).unwrap(), 1).is_err());
    let attached = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_eq!(attached.schema(), next.schema());
    assert_eq!(attached.generation(), next.generation());
    drop(attached); drop(next);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn asset_narrowing_and_removed_homes_share_the_activation_commit() {
    let source="table items:\n  photo: image <=1000\n  read <- allow\nquery q():\n  return 1\n";
    let mut e=engine(source);
    let mut png=b"\x89PNG\r\n\x1a\n".to_vec();png.extend_from_slice(&13u32.to_be_bytes());png.extend_from_slice(b"IHDR");png.extend_from_slice(&1u32.to_be_bytes());png.extend_from_slice(&1u32.to_be_bytes());
    let asset=e.store_asset("dev:alice",&png,1000).unwrap();let path=e.store().asset_path(&asset.id);
    e.seed([("items".into(),snapback4_core::value::object([("id",Value::Id("a".into())),("photo",asset.column_value())]))]).unwrap();
    let generation=e.generation();
    assert_eq!(adopt(&mut e,&source.replace("<=1000","<=1")).unwrap_err().code(),"E_ASSET_TOO_LARGE");
    assert_eq!(e.generation(),generation);assert!(e.store().asset(&asset.id).unwrap().unwrap().released_at.is_none());
    let removed=source.replace("  photo: image <=1000\n", "");
    assert!(adopt(&mut e,&removed.replace("  read <- allow", "  required: int\n  read <- allow")).is_err());
    assert!(e.store().asset(&asset.id).unwrap().unwrap().released_at.is_none());
    adopt(&mut e,&removed).unwrap();assert!(e.store().asset(&asset.id).unwrap().unwrap().released_at.is_some());
    assert_eq!(e.sweep_assets(2000).unwrap(),1);assert!(!path.exists());
}

#[test]
fn program_only_activation_does_not_walk_or_rebuild_unchanged_maintains() {
    let source="table items:\n  group: text <=10\n  value: int\n  read <- allow\nmaintain sums: sum items of value by group\n  read <- allow\nquery q():\n  return 1\n";
    let mut e=engine(source);seed(&mut e,"items",serde_json::json!([{"id":"a","group":"g","value":3}]));
    let seq=e.seq().unwrap();let generation=e.generation();
    e.store().conn().execute_batch("CREATE TRIGGER no_rebuild_delete BEFORE DELETE ON r BEGIN SELECT RAISE(ABORT, 'unexpected rebuild'); END; CREATE TRIGGER no_rebuild_put BEFORE INSERT ON r BEGIN SELECT RAISE(ABORT, 'unexpected rebuild'); END;").unwrap();
    adopt(&mut e,&source.replace("return 1","return 2")).unwrap();
    assert_eq!(e.seq().unwrap(),seq);assert_eq!(e.generation(),generation+1);assert_eq!(e.query("q",ctx()).unwrap().data,Value::Int(2));
}

#[test]
fn a_stale_engine_cannot_park_or_enqueue_a_new_owners_jobs() {
    let source="table items:\n  value: int\n  read <- allow\njob change():\n  chunk row in items first 10 by byId:\n    update items[row.id] {value: 1}\n";
    let dir=std::env::temp_dir().join(format!("sb4-job-owner-{}-{}",std::process::id(),snapback4_core::now_ms()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("store.sqlite");
    let open=|source:&str|{let b=compile(source);Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()};
    let mut old=open(source);seed(&mut old,"items",serde_json::json!([{"id":"a","value":0}]));
    let mut new=open(&source.replace("value: 1}","value: 2}"));let id=new.enqueue_job("change",BTreeMap::new(),1000).unwrap();
    assert_eq!(old.run_job_chunk(1001).unwrap_err().code(),"E_GENERATION");
    assert_eq!(old.enqueue_job("change",BTreeMap::new(),1001).unwrap_err().code(),"E_GENERATION");
    assert_eq!(new.job(&id).unwrap().unwrap().state,snapback4_core::engine::job::JobState::Queued);
    assert!(new.run_job_chunk(1002).unwrap().is_some());assert_eq!(new.store().rows("items").unwrap()[0].field("value").unwrap(),&Value::Int(2));
    drop(new);drop(old);std::fs::remove_dir_all(dir).unwrap();
}
