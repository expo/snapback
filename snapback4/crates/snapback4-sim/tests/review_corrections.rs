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

#[test]
fn drained_partitions_cover_successful_writes_without_viewer_events() {
    let mut e = engine(&format!("{ITEMS}\nmutation noop():\n  return null\ntable privateRows:\n  value: int\n  insert <- allow\nmutation privateWrite():\n  insert privateRows {{value: 1}}\n  return null\n"));
    seed(&mut e, "items", serde_json::json!([{"id":"a","body":"kept"}]));
    let mut watermark = e.seq().unwrap();
    for name in ["noop", "privateWrite"] {
        let result = e.mutate(name, Some(name), ctx()).unwrap();
        let WriteState::Sent { seq, .. } = result.state else { panic!("expected sent") };
        let page = e.stream("dev:alice", watermark, 10).unwrap();
        assert!(page.events.is_empty()); assert!(!page.more);
        assert_eq!(page.watermark, seq);
        assert_eq!(e.acknowledged("dev:alice", &[name.into()], page.watermark).unwrap()[name], seq);
        watermark = page.watermark;
    }
}

#[test]
fn cursorless_nonunique_scans_keep_live_siblings_after_an_expired_batch() {
    let mut e = engine("table notes:\n  tag: text <=10\n  until: time ?\n  by byTag: tag\n  by byExpiry: until\n  expire at .until\n  read <- allow\n  sync public\nquery q():\n  return notes[] first 10 by byTag\n");
    let rows = (0..17).map(|n| serde_json::json!({"id":format!("n{n:02}"),"tag":"open","until":if n<12 {serde_json::json!(10)} else {serde_json::Value::Null}})).collect::<Vec<_>>();
    seed(&mut e,"notes",serde_json::json!(rows));
    let result=e.query("q",ctx()).unwrap();
    assert_eq!(result.data.as_array().unwrap().len(),5);
    assert!(result.complete);
}

#[test]
fn job_chunks_enforce_final_exists_and_rollback_the_whole_chunk() {
    let mut e=engine("table inputs:\n  read <- allow\n  sync public\ntable targets:\n  name: text <=10\n  unique byName: name\n  read <- allow\ntable sources:\n  name: text <=10\n  read <- allow\n  insert <- allow\n  after insert <- exists targets[.name]\njob j():\n  chunk i in inputs first 5 by byId:\n    insert sources {name: 'ghost'}\n");
    seed(&mut e,"inputs",serde_json::json!([{"id":"one"}]));
    let run=e.run_job("j",BTreeMap::new(),1000).unwrap();
    assert_eq!(run.state,snapback4_core::JobState::Parked);
    assert!(run.error.unwrap().contains("E_CONSTRAINT"));
    assert!(e.store().rows("sources").unwrap().is_empty());
}

#[test]
fn schedules_do_not_rewind_and_changed_shapes_start_at_the_next_boundary() {
    let source="table rows:\n  read <- allow\njob tick():\n  chunk r in rows first 1 by byId:\n    break\nschedule clock every 2m: tick\n";
    let mut e=engine(source);
    assert!(e.fire_schedules(600001).unwrap().is_empty());
    assert_eq!(e.fire_schedules(720001).unwrap().len(),1);
    for now in [600001,720001] {assert!(e.fire_schedules(now).unwrap().is_empty());}
    adopt(&mut e,&source.replace("every 2m","every 5m")).unwrap();
    assert!(e.fire_schedules(840001).unwrap().is_empty());
    assert_eq!(e.fire_schedules(900001).unwrap().len(),1);
    let b=compile(source);let before=e.generation();
    assert!(e.adopt(b.schema,std::iter::empty()).is_err());
    assert_eq!(e.generation(),before);
    assert_eq!(e.jobs(10).unwrap().len(),2);
}

#[test]
fn released_assets_can_move_and_be_reclaimed_before_collection() {
    let mut e=engine("table items:\n  photo: image <=10000 ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  sync public\nmutation move(a: items,b: items):\n  row = items[a] ! else NOT_FOUND\n  p = row.photo\n  update items[a] {photo: null}\n  update items[b] {photo: p}\nmutation place(a: items,p: image <=10000 ?):\n  update items[a] {photo: p}\n");
    let mut png=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();png.extend([0,0,0,1,0,0,0,1]);
    let asset=e.store_asset("dev:alice",&png,1000).unwrap();
    e.seed([("items".into(),snapback4_core::value::object([("id",Value::Id("a".into())),("photo",asset.column_value())])),("items".into(),snapback4_core::value::object([("id",Value::Id("b".into())),("photo",Value::Null)]))]).unwrap();
    let context=|a:&str,p:Value|Context::new("dev:alice",BTreeMap::from([("a".into(),Value::Id(a.into())),("p".into(),p)])).at(1000);
    let outcome=e.mutate("move",Some("move"),Context::new("dev:alice",BTreeMap::from([("a".into(),Value::Id("a".into())),("b".into(),Value::Id("b".into()))])).at(1000)).unwrap();
    assert!(matches!(outcome.state,WriteState::Sent{..}),"{outcome:?}");
    assert_eq!(e.store().asset(&asset.id).unwrap().unwrap().home.unwrap().1,"b");
    assert!(matches!(e.mutate("place",Some("clear"),context("b",Value::Null)).unwrap().state,WriteState::Sent{..}));
    assert!(matches!(e.mutate("place",Some("reset"),context("b",asset.column_value())).unwrap().state,WriteState::Sent{..}));
    assert!(e.store().asset(&asset.id).unwrap().unwrap().released_at.is_none());
}

#[test]
fn expired_rows_do_not_consume_the_acquisition_horizon() {
    let mut e=engine("table notes:\n  at: time\n  until: time ?\n  by byTime: at, id\n  by byExpiry: until\n  expire at .until\n  read <- allow\n  sync public last 2 by byTime\nquery q():\n  return notes[] last 2 by byTime\n");
    seed(&mut e,"notes",serde_json::json!([{"id":"live","at":1,"until":null},{"id":"expired-a","at":2,"until":10},{"id":"expired-b","at":3,"until":10}]));
    let (events,_) = e.snapshot("dev:alice").unwrap();
    assert_eq!(events.iter().map(|e|e.id.as_str()).collect::<Vec<_>>(),vec!["live"]);
    let (events,_,next)=e.snapshot_page("dev:alice",None,1).unwrap();
    assert_eq!(events[0].id,"live");
    assert!(next.is_none());
    assert_eq!(e.store().count("notes").unwrap(),3,"logical acquisition must not need the sweep");
}

#[test]
fn detached_sync_reads_do_not_reserve_the_writer_and_detect_activation() {
    let dir=std::env::temp_dir().join(format!("sb4-read-owner-{}-{}",std::process::id(),snapback4_core::now_ms()));std::fs::create_dir_all(&dir).unwrap();
    let b=compile(ITEMS);
    let mut e=Engine::new(Store::open(&dir.join("store.sqlite")).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut reader=e.reader().unwrap();
    let tx=reader.store_mut().read_transaction().unwrap();
    assert_eq!(tx.next_seq().unwrap(),1);
    seed(&mut e,"items",serde_json::json!([{"id":"a","body":"new"}]));
    assert!(tx.get("items","a").unwrap().is_none(),"read snapshot is stable while a writer commits");
    tx.rollback().unwrap();
    assert_eq!(reader.snapshot("dev:alice").unwrap().0.len(),1);
    adopt(&mut e,&ITEMS.replace("<=100","<=200")).unwrap();
    assert!(matches!(reader.snapshot("dev:alice"),Err(snapback4_core::error::RuntimeError::Generation(_))));
    drop(reader);drop(e);std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn projected_reads_retain_the_next_visible_expiry() {
    let mut e=engine("table rows:\n  body: text <=10\n  until: time ?\n  by byExpiry: until\n  expire at .until\n  read <- allow\n  sync public\nquery q():\n  r = rows['a'] ! else NOT_FOUND\n  return r.body\n");
    seed(&mut e,"rows",serde_json::json!([{"id":"a","body":"live","until":2000}]));
    let q=e.query("q",ctx()).unwrap();
    assert_eq!(q.next_expiry,Some(2000));
    assert_eq!(q.data,Value::String("live".into()));
    assert!(e.query("q",ctx().at(2000)).is_err());
}

#[test]
fn expired_rows_are_absent_to_uniqueness_caps_final_exists_and_maintains() {
    let mut e=engine("table targets:\n  code: text <=10\n  until: time ?\n  unique byCode: code\n  by byExpiry: until\n  expire at .until\n  cap 1 by code\n  read <- allow\n  insert <- allow\n  sync public\nmaintain counts: count targets by code\n  read <- allow\ntable sources:\n  code: text <=10\n  insert <- allow\n  after insert <- exists targets[.code]\nmutation add():\n  insert targets {code: 'same',until: null}\nmutation source():\n  insert sources {code: 'same'}\nquery count():\n  return counts['same'] by byGroup\nquery one():\n  return targets['same'] by byCode\n");
    seed(&mut e,"targets",serde_json::json!([{"id":"old","code":"same","until":10}]));
    assert_eq!(e.query("count",ctx()).unwrap().data,Value::Int(0));
    let snapshot=e.snapshot_at("dev:alice",1000).unwrap().0;
    assert!(snapshot.is_empty(),"expired source cannot leave a maintained count in a snapshot: {snapshot:?}");
    let outcome=e.mutate("source",Some("refuse"),ctx().with_ids(["source".into()])).unwrap();
    assert!(matches!(outcome.state,WriteState::Failed{ref why,..} if why.code=="E_CONSTRAINT"));
    let outcome=e.mutate("add",Some("add"),ctx().with_ids(["new".into()])).unwrap();
    assert!(matches!(outcome.state,WriteState::Sent{..}),"{outcome:?}");
    assert_eq!(e.query("one",ctx()).unwrap().data.field("id").unwrap(),&Value::Id("new".into()));
    assert_eq!(e.query("count",ctx()).unwrap().data,Value::Int(1));
    assert_eq!(e.sweep_expired(1000,100).unwrap(),1);
    assert_eq!(e.query("count",ctx()).unwrap().data,Value::Int(1));
}

#[test]
fn expired_memberships_bound_stream_history_before_the_sweep() {
    let mut e=engine("table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  read <- .person = viewer\n  insert <- allow\n  update <- allow\n  sync to .person\ntable notes:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  sync to members[.group]\nmutation join():\n  insert members {group: 'g',person: viewer,until: 10}\nmutation renew(m: members):\n  update members[m] {until: 30}\nmutation add(body: text <=10):\n  insert notes {group: 'g',body}\n");
    let call=|e:&mut Engine,op:&str,id:&str,at:i64,args:BTreeMap<String,Value>| {
        let w=e.mutate(op,Some(id),Context::new("dev:alice",args).at(at).with_ids([id.into()])).unwrap();
        assert!(matches!(w.state,WriteState::Sent{..}),"{w:?}");
    };
    call(&mut e,"add","old",1,BTreeMap::from([("body".into(),Value::String("old".into()))]));
    let before=e.seq().unwrap();
    call(&mut e,"join","member",2,BTreeMap::new());
    let joined=e.seq().unwrap();
    call(&mut e,"add","live",9,BTreeMap::from([("body".into(),Value::String("live".into()))]));
    call(&mut e,"add","hidden",10,BTreeMap::from([("body".into(),Value::String("hidden".into()))]));
    assert!(e.snapshot_at("dev:alice",20).unwrap().0.is_empty());
    for start in [before,joined] {
        let page=e.stream_at("dev:alice",start,100,20).unwrap();
        let ids=page.events.iter().filter(|event|event.table=="notes").map(|event|event.id.as_str()).collect::<Vec<_>>();
        assert!(ids.contains(&"live"),"{ids:?}");
        assert!(!ids.contains(&"hidden"),"{ids:?}");
        assert_eq!(ids.contains(&"old"),start==before);
    }
    // Renew before expiry: the original deadline must not silently persist.
    let mut e2=e;
    call(&mut e2,"renew","renewed",9,BTreeMap::from([("m".into(),Value::Id("member".into()))]));
    let renewed=e2.seq().unwrap();
    call(&mut e2,"add","renewed-live",20,BTreeMap::from([("body".into(),Value::String("renewed".into()))]));
    assert!(e2.stream_at("dev:alice",renewed,100,20).unwrap().events.iter().any(|event|event.id=="renewed-live"));
}

#[test]
fn aggregate_rebuild_walks_multiple_source_and_target_pages() {
    let source="table items:\n  group: text <=10\n  amount: int\n  read <- allow\nmaintain counts: count items by group\n  read <- allow\nquery q():\n  return counts['same'] by byGroup\n";
    let mut e=engine(source);
    seed(&mut e,"items",serde_json::json!((0..600).map(|n|serde_json::json!({"id":format!("r{n:04}"),"group":"same","amount":2})).collect::<Vec<_>>()));
    assert_eq!(e.query("q",ctx()).unwrap().data,Value::Int(600));
    adopt(&mut e,&source.replace("count items", "sum items of amount")).unwrap();
    assert_eq!(e.query("q",ctx()).unwrap().data,Value::Int(1200));
}

#[test]
fn emit_only_job_chunks_commit_work_for_the_effect_worker() {
    let mut e=engine("effect notify\ntable inputs:\n  read <- allow\njob j():\n  chunk row in inputs first 2 by byId:\n    emit notify {id: row.id}\n");
    seed(&mut e,"inputs",serde_json::json!([{"id":"one"},{"id":"two"},{"id":"three"}]));
    let before=e.seq().unwrap();
    let run=e.run_job("j",BTreeMap::new(),1000).unwrap();
    assert_eq!(run.state,snapback4_core::JobState::Done);
    assert_eq!(e.effects(Some("queued"),10).unwrap().len(),3);
    assert!(e.seq().unwrap()>before);
}

#[test]
fn a_legacy_grant_cannot_borrow_a_later_rejoins_lifetime() {
    let mut e=engine("table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  read <- .person = viewer\n  insert <- allow\n  sync to .person\ntable notes:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  sync to members[.group]\nmutation join(until: time):\n  insert members {group: 'g',person: viewer,until}\nmutation add():\n  insert notes {group: 'g',body: 'gap'}\n");
    let call=|e:&mut Engine,op:&str,id:&str,at:i64,args:BTreeMap<String,Value>| {
        let w=e.mutate(op,Some(id),Context::new("dev:alice",args).at(at).with_ids([id.into()])).unwrap();
        let WriteState::Sent{seq,..}=w.state else {panic!("{w:?}")}; seq
    };
    let old=call(&mut e,"join","old",1,BTreeMap::from([("until".into(),Value::Int(10))]));
    // The former ledger shape stored only the group array as data.
    let legacy = canonical_json(&Value::Array(vec![Value::String("g".into())]));
    e.store().conn().execute("UPDATE _log SET data = ?1 WHERE kind = 'join' AND seq = ?2",[legacy, old.to_string()]).unwrap();
    let gap=call(&mut e,"add","gap",15,BTreeMap::new());
    e.sweep_expired(20,100).unwrap();
    let rejoin=call(&mut e,"join","new",21,BTreeMap::from([("until".into(),Value::Int(100))]));
    let page=e.stream_at("dev:alice",0,100,22).unwrap();
    assert!(!page.events.iter().any(|event|event.table=="notes" && event.seq==gap));
    assert!(page.events.iter().any(|event|event.id=="gap" && event.seq==rejoin),"the new grant independently acquires history");
}

#[test]
fn an_expired_unswept_grant_does_not_hide_its_replacement_interval() {
    let mut e = engine("table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  read <- .person = viewer\n  insert <- allow\n  sync to .person\ntable notes:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  sync to members[.group]\nmutation join(until: time):\n  insert members {group: 'g',person: viewer,until}\nmutation add():\n  insert notes {group: 'g',body: 'live'}\n");
    let before = e.seq().unwrap();
    let call = |e: &mut Engine, op: &str, id: &str, at: i64, args: BTreeMap<String, Value>| {
        let outcome = e.mutate(op, Some(id), Context::new("dev:alice", args).at(at).with_ids([id.into()])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
    };
    call(&mut e, "join", "old-member", 1, BTreeMap::from([("until".into(), Value::Int(10))]));
    call(&mut e, "join", "new-member", 20, BTreeMap::from([("until".into(), Value::Int(100))]));
    call(&mut e, "add", "content", 21, BTreeMap::new());

    let page = e.stream_at("dev:alice", before, 100, 22).unwrap();
    assert!(page.events.iter().any(|event| event.table == "notes" && event.id == "content" && event.kind == "put"), "{:#?}", page.events);
    assert!(!page.events.iter().any(|event| event.table == "notes" && event.kind == "scope"), "{:#?}", page.events);
}

#[test]
fn expired_sources_reconstitute_an_absent_zero_sum_for_point_and_scan_reads() {
    let mut e = engine("table items:\n  group: text <=10\n  amount: int\n  until: time ?\n  by byGroup: group, id\n  by byExpiry: until\n  expire at .until\n  read <- allow\nmaintain sums: sum items of amount by group\n  read <- allow\nquery point():\n  return sums['g'] by byGroup\nquery scan():\n  return sums[] first 10 by byGroup\n");
    seed(&mut e, "items", serde_json::json!([
        {"id":"live","group":"g","amount":5,"until":null},
        {"id":"expired","group":"g","amount":-5,"until":2000}
    ]));
    assert!(e.store().rows("sums").unwrap().is_empty(), "the physical zero aggregate should be absent");

    let point = e.query("point", ctx().at(3000)).unwrap().data;
    let scan = e.query("scan", ctx().at(3000)).unwrap().data;
    let scan_is_live_sum = scan.as_array().is_ok_and(|rows| {
        rows.len() == 1
            && rows[0].field("group") == Ok(&Value::String("g".into()))
            && rows[0].field("value") == Ok(&Value::Int(5))
    });
    assert_eq!((point == Value::Int(5), scan_is_live_sum), (true, true), "point={point:?}, scan={scan:?}");
}

#[test]
fn a_capped_aggregate_scan_returns_a_cursor_from_its_last_visible_group() {
    let mut e = engine("table items:\n  group: text <=10\n  until: time ?\n  by byGroup: group, id\n  by byExpiry: until\n  expire at .until\n  read <- allow\nmaintain counts: count items by group\n  read <- allow\nquery page(c: cursor ?):\n  return counts after c first 2 by byGroup\n");
    seed(&mut e, "items", serde_json::json!([
        {"id":"a","group":"A","until":null},
        {"id":"b","group":"B","until":null}
    ]));
    let mut ceilings = e.ceilings();
    ceilings.examined = 3;
    e.set_ceilings(ceilings);
    let outcome = e.query("page", Context::new("dev:alice", BTreeMap::from([("c".into(), Value::Null)])).at(1000)).unwrap();
    let rows = outcome.data.as_array().unwrap();
    assert_eq!(rows.len(), 1, "{outcome:?}");
    assert_eq!(rows[0].field("group").unwrap(), &Value::String("A".into()));
    assert!(outcome.next.is_some(), "the capped page must resume after A: {outcome:?}");
    assert!(!outcome.complete, "{outcome:?}");
}

#[test]
fn an_expiring_point_read_charges_its_live_row_once() {
    let mut e = engine("table notes:\n  body: text <=10\n  until: time ?\n  by byExpiry: until\n  expire at .until\n  read <- allow\nquery q():\n  return notes['live'] by byId\n");
    seed(&mut e, "notes", serde_json::json!([{"id":"live","body":"kept","until":2000}]));
    let mut ceilings = e.ceilings();
    ceilings.examined = 1;
    e.set_ceilings(ceilings);

    let outcome = e.query("q", ctx()).unwrap();
    assert_eq!(outcome.data.field("body"), Ok(&Value::String("kept".into())), "{outcome:?}");
    assert!(outcome.complete, "{outcome:?}");
    assert_eq!(outcome.metered.examined, 1, "{outcome:?}");
}
