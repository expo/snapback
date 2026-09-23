use super::*;
use snapback4_core::{engine::LoadMode, schema::{ColumnDefault, ColumnType}, value::object};

#[test]
fn expired_unswept_parent_is_never_physically_written_and_lifetime_edits_refuse() {
    let source = MODEL.replacen("  at: time", "  until: time ?\n  by byUntil: until, id\n  expire at .until\n  at: time", 1);
    let mut b = compile(&source);
    let parent = b.schema.tables.get_mut("posts").unwrap();
    parent.columns.insert("until".into(), ColumnType::Time);
    parent.defaults.insert("until".into(), ColumnDefault::Literal(Value::Int(900)));
    let mut e = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    e.load_mode([("posts".into(), object([("id", id("p")), ("at", Value::Int(1)), ("until", Value::Int(900))]))], LoadMode::Restore).unwrap();
    // A legacy image missing a required literal-default field is interpreted
    // through that default, including in Table::expired.
    e.store().conn().execute_batch("UPDATE r SET data = json_remove(data, '$.Row.until') WHERE t = (SELECT num FROM _catalog WHERE name = 'posts');").unwrap();
    let before = e.store().rows("posts").unwrap();
    assert!(before[0].field("until").is_err());
    assert!(e.schema().tables["posts"].expired(&before[0],1000));
    let check = |e: &Engine, count: i64, total: i64| {
        assert_eq!(e.store().rows("likes").unwrap().len(),count as usize);
        for m in &e.schema().maintains {
            let rows=e.store().rows(&m.target).unwrap();
            if count==0 {assert!(rows.is_empty());} else {
                assert_eq!(rows[0].field("value").unwrap(),&Value::Int(if m.private.as_ref().unwrap().column=="total" {total} else {count}));
            }
        }
    };
    e.store().conn().execute_batch("CREATE TRIGGER no_expired_mirror BEFORE UPDATE ON r WHEN NEW.t = (SELECT num FROM _catalog WHERE name = 'posts') BEGIN SELECT RAISE(ABORT, 'expired parent written'); END;").unwrap();
    like(&mut e, "l", id("p"), true, 3);
    check(&e,1,3);
    mutate(&mut e, "unlike", &[("id", id("l"))]);
    check(&e,0,0);
    let mut now_unspecified = context(&[("id", id("clock")), ("postId", id("p")), ("active", Value::Bool(true)), ("amount", Value::Int(1))]);
    now_unspecified.now = None;
    assert!(matches!(e.mutate("like", None, now_unspecified).unwrap().state, WriteState::Sent { .. }));
    check(&e,1,1);
    assert_eq!(e.store().rows("posts").unwrap(), before);
    for change in 0..3 {
        let mut candidate = b.schema.clone();
        let parent = candidate.tables.get_mut("posts").unwrap();
        match change {
            0 => { parent.columns.insert("until".into(), ColumnType::Optional(Box::new(ColumnType::Time))); },
            1 => { parent.defaults.insert("until".into(), ColumnDefault::Literal(Value::Int(2000))); },
            _ => parent.expire = None,
        }
        let generation = e.generation();
        let seq = e.seq().unwrap();
        let error = e.adopt(candidate, b.programs.iter().map(|p| p.program.clone())).unwrap_err();
        assert_eq!(error.code(), "E_MAINTAINED_COLUMN_ACTIVATION", "{error}");
        assert_eq!((e.generation(), e.seq().unwrap()), (generation, seq));
        assert_eq!(e.store().rows("posts").unwrap(), before);
    }
    e.store().conn().execute_batch("DROP TRIGGER no_expired_mirror").unwrap();
    e.adopt(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
}

#[test]
fn resolved_source_edits_refuse_with_only_source_rows_populated() {
    for edit in ["kind", "predicate", "optional", "default"] {
        let mut e = engine(MODEL);
        like(&mut e, "l", id("missing"), true, 3);
        assert!(e.store().rows("posts").unwrap().is_empty());
        let source = match edit {
            "kind" => MODEL.replace("likeCount: count likes by postId", "likeCount: sum likes of amount by postId"),
            "predicate" => MODEL.replace("likeCount: count likes by postId", "likeCount: count likes where .active by postId"),
            "optional" => MODEL.to_owned(),
            _ => MODEL.replace("  active: bool", "  active: bool default true"),
        };
        let mut b = compile(&source);
        if edit == "optional" {
            let kind = ColumnType::Ref { table: "posts".into() };
            b.schema.tables.get_mut("likes").unwrap().columns.insert("postId".into(), kind.clone());
            for maintain in &b.schema.maintains { b.schema.tables.get_mut(&maintain.target).unwrap().columns.insert(snapback4_core::schema::columns::GROUP.into(), kind.clone()); }
        }
        let old = (e.generation(), e.seq().unwrap(), e.schema().clone());
        let error = e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err();
        assert_eq!(error.code(), "E_MAINTAINED_COLUMN_ACTIVATION", "{edit}: {error}");
        assert_eq!((e.generation(), e.seq().unwrap(), e.schema().clone()), old);
        post(&mut e, "missing", 1);
        assert_eq!(totals(&mut e, "missing"), (1, 1, 3));
    }
}

#[test]
fn restore_preserves_values_import_rebuilds_and_neither_publishes_private_names() {
    let mut e = engine(&MODEL.replace("  online only", "  sync public"));
    like(&mut e, "l", id("p"), true, 3);
    let row = object([("id", id("p")), ("at", Value::Int(1)), ("likeCount", Value::Int(77)), ("selected", Value::Int(78)), ("total", Value::Int(79))]);
    let private: Vec<_> = e.schema().maintains.iter().map(|m| {
        let value = row.field(&m.private.as_ref().unwrap().column).unwrap().clone();
        (m.target.clone(), object([("id", id(&snapback4_core::schema::maintained_id(&[id("p")]))),
            (snapback4_core::schema::columns::GROUP, id("p")), ("value", value)]))
    }).collect();
    let from = e.seq().unwrap();
    e.load_mode(std::iter::once(("posts".into(), row.clone())).chain(private.clone()), LoadMode::Restore).unwrap();
    assert_eq!(e.store().rows("posts").unwrap(), vec![row]);
    for (target, image) in &private { assert_eq!(e.store().rows(target).unwrap(), vec![image.clone()]); }
    assert_eq!(totals(&mut e, "p"), (77, 78, 79));
    assert!(!serde_json::to_string(&e.stream("alice", from, 100).unwrap()).unwrap().contains("$column:"));
    let metadata: Vec<String> = e.store().conn().prepare("SELECT touched FROM _commits").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert!(metadata.iter().all(|s| !s.contains("$column:")));
    let before = e.seq().unwrap();
    assert_eq!(e.load(private).unwrap_err().code(), "E_MAINTAINED_COLUMN_PRIVATE");
    assert_eq!(e.seq().unwrap(), before);
    e.load([("posts".into(), object([("id", id("p")), ("at", Value::Int(1)), ("likeCount", Value::Int(999))]))]).unwrap();
    assert_eq!(totals(&mut e, "p"), (1, 1, 3));
    for m in &e.schema().maintains {
        let expected = if m.private.as_ref().unwrap().column == "total" { 3 } else { 1 };
        assert_eq!(e.store().rows(&m.target).unwrap()[0].field("value").unwrap(), &Value::Int(expected));
    }
    let metadata: Vec<String> = e.store().conn().prepare("SELECT touched FROM _commits").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert!(metadata.iter().all(|s| !s.contains("$column:")));
    assert!(!serde_json::to_string(&e.stream("alice", before, 100).unwrap()).unwrap().contains("$column:"));
}

#[test]
fn optional_materialization_and_all_write_arms_preserve_authoritative_columns() {
    let source = MODEL.replacen("  delete <- allow", "  update <- allow\n  delete <- allow", 1)
        + "\nmutation absent(id: id):\n  return insert posts { id, at: 1 } if absent\nmutation put(id: posts):\n  return upsert posts[id] { at: 2 }\nmutation edit(id: posts):\n  return update posts[id] { at: 3 }\n";
    for op in ["post", "absent", "put"] {
        let mut e = engine(&source);
        like(&mut e, "l", id("p"), true, 7);
        let args = if op == "post" { vec![("id", id("p")), ("at", Value::Int(1))] } else { vec![("id", id("p"))] };
        mutate(&mut e, op, &args);
        assert_eq!(totals(&mut e, "p"), (1, 1, 7), "birth {op}");
        for arm in ["absent", "put", "edit"] {
            let result = mutate(&mut e, arm, &[("id", id("p"))]);
            if result != Value::Null { for field in ["likeCount","selected","total"] {assert!(result.field(field).is_err());} }
            assert_eq!(totals(&mut e, "p"), (1, 1, 7), "existing {arm}");
        }
        let table = &e.schema().tables["posts"];
        let mut row = object([("id", id("legacy")), ("at", Value::Int(1))]);
        snapback4_core::engine::validate::validate_row(e.schema(), "posts", &row).unwrap();
        snapback4_core::schema::materialize_optional_fields(&mut row, table);
        for field in ["likeCount","selected","total"] {assert_eq!(row.field(field).unwrap(), &Value::Int(0));}
        let mut present = e.store().rows("posts").unwrap()[0].clone();
        snapback4_core::schema::materialize_optional_fields(&mut present, table);
        assert_eq!(["likeCount","selected","total"].map(|field|present.field(field).unwrap().as_int().unwrap()),[1,1,7]);
    }
}

#[test]
fn bad_sources_and_references_refuse_without_panicking() {
    for source in [
        MODEL.replace("count likes by postId", "count missing by postId"),
        MODEL.replace("count likes by postId", "count likes by missing"),
        MODEL.replace("  postId: posts ?", "  postId: int ?"),
        MODEL.replace("  postId: posts ?", "  postId: missing ?"),
        MODEL.replace("sum likes of amount", "sum missing of amount"),
        MODEL.replace("sum likes of amount", "sum likes of missing"),
    ] {
        let result = std::panic::catch_unwind(|| snapback4_lang::compile(&[("schema.q".into(), source.clone())]));
        let bound = result.expect("binder panicked on a bad aggregate reference");
        assert!(!bound.diagnostics.is_empty(), "admitted {source}");
    }
}

#[test]
fn rust_write_structs_keep_id_and_ordinary_fields_without_private_storage() {
    use std::{io::Write, process::{Command, Stdio}};
    let source = MODEL.replacen("  at: time", "  type: text <=8 default ''\n  optional: text <=8 ?\n  at: time", 1)
        + "\ntable postsWrite:\n  public\n  online only\n";
    let b = compile(&source);
    let emitted = snapback4_lang::emit::rust(&b);
    assert!(!emitted.contains("$column:"));
    let write = emitted.split("/// The id-bearing result of a write to `posts`").nth(1).unwrap();
    let name = write.split("pub struct ").nth(1).unwrap().split_whitespace().next().unwrap();
    assert_ne!(name, "PostsWrite", "the ordinary table owns this struct name");
    let body = write.split('{').nth(1).unwrap().split('}').next().unwrap();
    for field in ["pub id: String", "pub at: i64", "pub r#type: String", "pub optional: Option<String>"] { assert!(body.contains(field), "{body}"); }
    for field in ["like_count", "selected", "total"] { assert!(!body.contains(field), "{body}"); }
    // Match the emitter's existing namespace test: compile every identifier,
    // omitting only external derive attributes (the runtime decoder is tested separately).
    let mut compilable = emitted.lines().filter(|line| !line.trim_start().starts_with("#[serde")).map(|line| if line.starts_with("#[derive(") { "#[derive(Clone, Debug, Default, PartialEq)]" } else { line }).collect::<Vec<_>>().join("\n");
    compilable.push_str(&format!("\nfn key(row: {name}) -> String {{ row.id }}\n"));
    let output = std::env::temp_dir().join(format!("f1a-write-{}.rmeta", std::process::id()));
    let mut child = Command::new("rustc").args(["--crate-name", "generated_columns", "--crate-type", "lib", "--edition=2024", "--emit=metadata", "-o"]).arg(&output).arg("-").stdin(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(compilable.as_bytes()).unwrap();
    let result = child.wait_with_output().unwrap();
    let _ = std::fs::remove_file(output);
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
}

#[test]
fn count_and_sum_remain_reference_type_names() {
    // A source table named `default` must still bind as an aggregate source.
    let b=compile(&MODEL.replace("likes", "default"));
    assert_eq!(b.schema.tables["posts"].maintained.len(),3);
    assert_eq!(b.schema.maintains.len(),3);
    assert!(b.schema.maintains.iter().all(|m|m.source=="default"));
    for kind in ["count", "sum", "count ?", "sum ?", "count default 'p'", "count default 'by'", "count default 'where'", "sum default 'of'", "sum ? default null"] {
        let source = format!("table count:\n  public\n  online only\ntable sum:\n  public\n  online only\ntable refs:\n  target: {kind}\n  public\n  online only\n");
        let b = compile(&source);
        assert!(b.schema.tables["refs"].maintained.is_empty());
        assert!(b.schema.maintains.is_empty());
    }
}

#[test]
fn numeric_sums_use_integer_minor_units_on_birth_and_missing_images() {
    for kind in ["int", "decimal 2", "money USD 2"] {
        let source = MODEL.replace("amount: int", &format!("amount: {kind}"));
        let mut e = engine(&source);
        like(&mut e, "l", id("p"), true, 234);
        post(&mut e, "p", 1);
        assert_eq!(totals(&mut e, "p"), (1, 1, 234));
        let mut row = object([("id", id("missing")), ("at", Value::Int(1))]);
        snapback4_core::engine::validate::validate_row(e.schema(), "posts", &row).unwrap();
        snapback4_core::schema::materialize_optional_fields(&mut row, &e.schema().tables["posts"]);
        assert_eq!(row.field("total").unwrap(), &Value::Int(0));
    }
}

#[test]
fn cascades_refuse_the_maintained_field_with_a_valid_parent_reference() {
    let base=MODEL.replacen("  at: time","  parentId: posts ?\n  at: time",1);
    let source=base.replace("total: sum likes of amount where .active by postId","total: sum posts of likeCount by parentId");
    let refused=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
    assert!(refused.diagnostics.iter().any(|d|d.code=="E_MAINTAINED_COLUMN" && d.message.contains("posts.likeCount")),"{:?}",refused.diagnostics);
    assert!(Engine::memory(refused.schema,[]).is_err());
    let accepted=compile(&source.replace("likeCount: count likes by postId","likeCount: int default 0"));
    assert!(accepted.schema.maintains.iter().any(|m|m.source=="posts" && matches!(&m.kind,snapback4_core::schema::MaintainKind::Sum {of} if of=="likeCount")));
    let source=format!("{base}\nmaintain cascade: sum posts of likeCount by at\n  online only\n  read <- allow\n");
    let refused=snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
    assert!(refused.diagnostics.iter().any(|d|d.code=="E_MAINTAINED_COLUMN" && d.message.contains("posts.likeCount")),"{:?}",refused.diagnostics);
    assert!(Engine::memory(refused.schema,[]).is_err());
    let accepted=compile(&source.replace("likeCount: count likes by postId","likeCount: int default 0"));
    assert!(accepted.schema.maintain_for("cascade").is_some());
}
