//! Shared SQLite/Postgres transitions, comparing physical and interpreted state.
// @ref LLP 3000.009.001.000#3.5 — EV-2's oracle includes raw bytes after every transition.
use super::*;
use snapback4_core::{schema::row_image, value::canonical_json};

struct Pair {
    sqlite: Engine,
    pg: Engine,
    namespace: String,
    release: u64,
}
impl Pair {
    fn new(source: &str) -> Self {
        let (s, p) = bound(source);
        let c = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16 required");
        let namespace = format!("sb4_ev2_{:x}", snapback4_core::ids::seed());
        let pg = AnyStore::create_postgres(&c, &namespace).unwrap();
        let mut pair = Self {
            sqlite: Engine::new_release(AnyStore::memory().unwrap(), s.clone(), p.clone(), 1, None)
                .unwrap(),
            pg: Engine::new_release(pg, s, p, 1, None).unwrap(),
            namespace,
            release: 1,
        };
        pair.equal();
        pair
    }
    fn sql(&self, sql: &str) -> Vec<Vec<String>> {
        let mut client = postgres::Client::connect(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            postgres::NoTls,
        )
        .unwrap();
        client
            .batch_execute(&format!("SET search_path={},pg_catalog", self.namespace))
            .unwrap();
        client
            .query(sql, &[])
            .unwrap()
            .iter()
            .map(|r| (0..r.len()).map(|i| r.get(i)).collect())
            .collect()
    }
    fn put(&mut self, name: &str, row: Value) {
        for e in [&mut self.sqlite, &mut self.pg] {
            let table = e.schema().tables[name].clone();
            let tx = e.store_mut().transaction().unwrap();
            tx.put(name, &table, &row, None).unwrap();
            tx.commit().unwrap();
        }
        self.equal();
    }
    fn transition(&mut self, source: &str, restore: bool) -> Result<(), String> {
        let before = self.snapshot();
        let a = release(&mut self.sqlite, source, self.release + 1, restore);
        let b = release(&mut self.pg, source, self.release + 1, restore);
        assert_eq!(
            a.as_ref().err().map(RuntimeError::code),
            b.as_ref().err().map(RuntimeError::code),
            "SQLite {a:?}; PG {b:?}"
        );
        println!("EV-2 SQLite/PG release {}: {a:?} / {b:?}", self.release + 1);
        if a.is_ok() {
            self.release += 1;
        } else {
            assert_eq!(
                before,
                self.snapshot(),
                "failed activation changed durable state"
            );
        }
        self.equal();
        a.map(|_| ()).map_err(|e| e.to_string())
    }
    fn equal(&mut self) {
        let conn = self.sqlite.store().test_support_conn();
        for (sqlite, pg) in [
            (
                "SELECT c.name,d.id,d.data FROM _dormant_rows d JOIN _catalog c ON c.num=d.t ORDER BY c.name,d.id",
                "SELECT t,id,data FROM _dormant_rows ORDER BY t,id",
            ),
            (
                "SELECT c.name,d.id,d.column_name,p.name,d.parent_id,CAST(d.invalid AS TEXT) FROM _dormant_refs d JOIN _catalog c ON c.num=d.t JOIN _catalog p ON p.num=d.parent_t ORDER BY c.name,d.id,d.column_name,p.name,d.parent_id",
                "SELECT t,id,column_name,parent_t,parent_id,invalid::text FROM _dormant_refs ORDER BY t,id,column_name,parent_t,parent_id",
            ),
            (
                "SELECT CAST(id AS TEXT),operation,CAST(generation AS TEXT),CAST(revision AS TEXT),summary FROM _release_events ORDER BY id",
                "SELECT id::text,operation,generation::text,revision::text,summary FROM _release_events ORDER BY id",
            ),
            (
                "SELECT CAST(event AS TEXT),path,detail FROM _release_event_items ORDER BY event,path",
                "SELECT event::text,path,detail FROM _release_event_items ORDER BY event,path",
            ),
            (
                "SELECT c.name,r.id,r.data FROM r JOIN _catalog c ON c.num=r.t ORDER BY c.name,r.id",
                "SELECT t,id,data FROM r ORDER BY t,id",
            ),
            (
                "SELECT c.name,n.id,n.data,n.definition,n.reason FROM _dormant_narrow_rows n JOIN _catalog c ON c.num=n.t ORDER BY c.name,n.id",
                "SELECT t,id,data,definition,reason FROM _dormant_narrow_rows ORDER BY t,id",
            ),
            (
                "SELECT c.name,v.id,v.column_name,v.data FROM _dormant_values v JOIN _catalog c ON c.num=v.t ORDER BY c.name,v.id,v.column_name",
                "SELECT t,id,column_name,data FROM _dormant_values ORDER BY t,id,column_name",
            ),
            (
                "SELECT c.name,hex(i.k),i.id FROM i JOIN _catalog c ON c.num=i.ti ORDER BY c.name,i.k",
                "SELECT t||'.'||ix,upper(encode(k,'hex')),id FROM i ORDER BY t||'.'||ix,k",
            ),
        ] {
            let mut statement = conn.prepare(sqlite).unwrap();
            let n = statement.column_count();
            let rows: Vec<Vec<String>> = statement
                .query_map([], |r| (0..n).map(|i| r.get(i)).collect())
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(rows, self.sql(pg), "physical bytes: {sqlite}");
        }
        let has_caps: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_cap_counts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let caps: Vec<Vec<String>> = if has_caps {
            conn.prepare("SELECT c.name,hex(k),CAST(n AS TEXT) FROM _cap_counts JOIN _catalog c ON c.num=t ORDER BY c.name,k").unwrap().query_map([],|r|Ok(vec![r.get(0)?,r.get(1)?,r.get(2)?])).unwrap().collect::<Result<_,_>>().unwrap()
        } else {
            vec![]
        };
        assert_eq!(
            caps,
            self.sql("SELECT t,upper(encode(k,'hex')),n::text FROM _cap_counts ORDER BY t,k")
        );
        assert_eq!(self.sqlite.generation(), self.pg.generation());
        for (name, table) in &self.sqlite.schema().tables {
            let a = self.sqlite.store().rows(name).unwrap();
            let b = self.pg.store().rows(name).unwrap();
            assert_eq!(a, b, "raw rows {name}");
            assert_eq!(
                a.iter().map(|r| row_image(r, table)).collect::<Vec<_>>(),
                b.iter().map(|r| row_image(r, table)).collect::<Vec<_>>()
            );
        }
        assert_eq!(
            canonical_json(
                &self
                    .sqlite
                    .store_mut()
                    .dormant_inventory(None, usize::MAX)
                    .unwrap()
            ),
            canonical_json(
                &self
                    .pg
                    .store_mut()
                    .dormant_inventory(None, usize::MAX)
                    .unwrap()
            ),
            "inventory"
        );
        for name in self
            .sqlite
            .programs()
            .filter(|p| p.name.starts_with("all"))
            .map(|p| p.name.clone())
            .collect::<Vec<_>>()
        {
            let a = self
                .sqlite
                .query(&name, Context::new("alice", Default::default()).at(1000))
                .unwrap();
            let b = self
                .pg
                .query(&name, Context::new("alice", Default::default()).at(1000))
                .unwrap();
            assert_eq!(
                canonical_json(&a),
                canonical_json(&b),
                "interpreted wire/meter {name}"
            );
        }
    }
    fn snapshot(&self) -> Vec<Vec<Vec<String>>> {
        ["SELECT t,id,data FROM r ORDER BY t,id",
         "SELECT t,ix,encode(k,'hex'),id FROM i ORDER BY t,ix,k",
         "SELECT t,id,data,definition,reason FROM _dormant_narrow_rows ORDER BY t,id",
         "SELECT t,id,column_name,data FROM _dormant_values ORDER BY t,id,column_name",
         "SELECT table_name,column_name,definition FROM _dormant_columns ORDER BY table_name,column_name",
         "SELECT key,value FROM _meta ORDER BY key",
         "SELECT name,num::text FROM _catalog ORDER BY name",
         "SELECT generation::text,schema,programs,at::text FROM _generations ORDER BY generation",
         "SELECT t,encode(k,'hex'),n::text FROM _cap_counts ORDER BY t,k",
         "SELECT t,id,column_name,parent_t,parent_id,invalid::text FROM _dormant_refs ORDER BY t,id,column_name,parent_t,parent_id",
         "SELECT table_name,definition FROM _dormant_tables ORDER BY table_name",
         "SELECT table_name,index_name,definition FROM _dormant_indexes ORDER BY table_name,index_name",
         "SELECT t,id,data FROM _dormant_rows ORDER BY t,id",
         "SELECT id::text,at::text,operation,COALESCE(release::text,''),COALESCE(previous::text,''),generation::text,revision::text,summary FROM _release_events ORDER BY id",
         "SELECT event::text,path,detail FROM _release_event_items ORDER BY event,path"].iter().map(|sql|self.sql(sql)).collect()
    }
    fn count(&self, name: &str, n: usize) {
        assert_eq!(self.sqlite.store().rows(name).unwrap().len(), n);
    }
}
fn source(kind: &str) -> String {
    format!(
        "table notes:\n  item: {kind}\n  memo: json <=100 ?\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\nquery allNotes():\n  return notes first 100\n"
    )
}
fn row(key: &str, value: Value) -> Value {
    object([
        ("id", id(key)),
        ("item", value),
        ("memo", Value::String("雪\0exact".into())),
    ])
}

macro_rules! dual {
    ($name:ident,$body:expr) => {
        #[test]
        #[ignore = "requires private PG16; scripts/test-postgres.sh"]
        fn $name() {
            $body
        }
    };
}

dual!(type_and_bounds, {
    for (wide, narrow, values, visible) in [
        (
            "int",
            "int 0..10",
            vec![
                Value::Int(-1),
                Value::Int(0),
                Value::Int(10),
                Value::Int(11),
            ],
            2,
        ),
        (
            "text <=100",
            "text 2..4",
            vec![
                Value::String("a".into()),
                Value::String("ab".into()),
                Value::String("abcd".into()),
                Value::String("abcde".into()),
            ],
            2,
        ),
        (
            "enum('a','b','c')",
            "enum('a','b')",
            vec![
                Value::String("a".into()),
                Value::String("b".into()),
                Value::String("c".into()),
            ],
            2,
        ),
        ("int", "text <=100", vec![Value::Int(7)], 0),
        (
            "[int] <=4",
            "[int] <=2",
            vec![
                Value::Array(vec![]),
                Value::Array(vec![Value::Int(1), Value::Int(2)]),
                Value::Array(vec![Value::Int(1), Value::Int(2), Value::Int(3)]),
            ],
            2,
        ),
    ] {
        let mut p = Pair::new(&source(wide));
        for (n, v) in values.into_iter().enumerate() {
            p.put("notes", row(&format!("r{n}"), v));
        }
        p.transition(&source(narrow), false).unwrap();
        p.count("notes", visible);
        p.transition(&source(wide), false).unwrap();
        assert!(
            p.sqlite
                .store_mut()
                .dormant_inventory(None, 100)
                .unwrap()
                .iter()
                .all(|i| i.kind != "rows")
        );
    }
});
dual!(requiredness_and_defaults, {
    let wide = source("int ?");
    let mut p = Pair::new(&wide);
    p.put("notes", row("null", Value::Null));
    p.put("notes", row("seven", Value::Int(7)));
    p.transition(&source("int"), false).unwrap();
    p.count("notes", 1);
    p.transition(&wide, false).unwrap();
    p.count("notes", 2);
    let base = source("int default 7");
    let mut p = Pair::new(&base);
    p.put("notes", object([("id", id("sparse"))]));
    p.put("notes", row("explicit", Value::Int(7)));
    p.transition(&source("int default 8"), false).unwrap();
    assert!(
        p.sqlite
            .store()
            .rows("notes")
            .unwrap()
            .iter()
            .find(|r| r.field("id").unwrap() == &id("sparse"))
            .unwrap()
            .field("item")
            .is_err()
    );
    p.transition(&source("int"), false).unwrap_err();
    p.transition(&base, false).unwrap();
});
dual!(text_constraints_and_retained_definitions, {
    for (a, b, value) in [
        ("text <=100", "text <=100 format email", "bad"),
        ("text <=100", "text 8..100", "short"),
        ("int default 7", "int default 8", "7"),
    ] {
        let mut p = Pair::new(&source(a));
        let value = if value == "7" {
            Value::Int(7)
        } else {
            Value::String(value.into())
        };
        p.put("notes", row("r", value));
        let retired = source(a).replace(&format!("  item: {a}\n"), "");
        p.transition(&retired, false).unwrap();
        p.transition(&source(b), true).unwrap();
        p.transition(&source(a), false).unwrap();
        p.count("notes", 1);
    }
});
dual!(required_and_context_default_columns, {
    let base = source("int");
    for added in [
        "new: int",
        "new: time default now",
        "new: principal default viewer",
    ] {
        let candidate = base.replace("  item: int\n", &format!("  item: int\n  {added}\n"));
        let mut empty = Pair::new(&base);
        empty.transition(&candidate, false).unwrap();
        let mut p = Pair::new(&base);
        p.put("notes", row("r", Value::Int(1)));
        assert!(
            p.transition(&candidate, false)
                .unwrap_err()
                .contains("E_ADOPT")
        );
        p.count("notes", 1);
    }
});
dual!(transitive_references_and_partial_restore, {
    // Children sort before their parent: more than one closure sweep is needed.
    let wide = "table zparents:\n  n: int\n  public\n  online only\ntable bchildren:\n  parent: zparents on delete keep\n  public\n  online only\ntable agrandchildren:\n  parent: bchildren on delete keep\n  public\n  online only\nquery allParents():\n  return zparents first 100\nquery allChildren():\n  return bchildren first 100\nquery allGrandchildren():\n  return agrandchildren first 100\n";
    let mut p = Pair::new(wide);
    for (key, n) in [("low", 0), ("middle", 5), ("high", 10)] {
        p.put("zparents", object([("id", id(key)), ("n", Value::Int(n))]));
        p.put("bchildren", object([("id", id(key)), ("parent", id(key))]));
        p.put(
            "agrandchildren",
            object([("id", id(key)), ("parent", id(key))]),
        );
    }
    p.transition(&wide.replace("n: int", "n: int 0..0"), false)
        .unwrap();
    for name in ["zparents", "bchildren", "agrandchildren"] {
        p.count(name, 1);
    }
    p.transition(&wide.replace("n: int", "n: int 0..5"), false)
        .unwrap();
    for name in ["zparents", "bchildren", "agrandchildren"] {
        p.count(name, 2);
    }
    p.transition(wide, false).unwrap();
    for name in ["zparents", "bchildren", "agrandchildren"] {
        p.count(name, 3);
    }
});
dual!(partial_row_restore_and_removed_cells, {
    let wide = source("int");
    let mut p = Pair::new(&wide);
    p.put("notes", row("r", Value::Int(10)));
    p.transition(&source("int 0..5"), false).unwrap();
    p.count("notes", 0);
    let partial = wide
        .replace("  memo: json <=100 ?\n", "")
        .replace("  item: int\n", "  item: int\n  sibling: int default 9\n");
    p.transition(&partial, false).unwrap();
    p.count("notes", 1);
    p.transition(
        &wide.replace("  item: int\n", "  item: int\n  sibling: int default 9\n"),
        true,
    )
    .unwrap();
    p.count("notes", 1);
});
dual!(caps_unique_null_groups_and_rollback, {
    for nulls in [false, true] {
        let base = source("int").replace(
            "  memo: json <=100 ?\n",
            "  group: text <=10 ?\n  by byGroup: group, id\n",
        );
        let mut p = Pair::new(&base);
        for (key, n) in [("a", 0), ("b", 10)] {
            p.put(
                "notes",
                object([
                    ("id", id(key)),
                    ("item", Value::Int(n)),
                    (
                        "group",
                        if nulls {
                            Value::Null
                        } else {
                            Value::String("g".into())
                        },
                    ),
                ]),
            );
        }
        let narrow = base.replace("item: int", "item: int 0..0");
        p.transition(&narrow, false).unwrap();
        p.count("notes", 1);
        let unique = narrow.replace("by byGroup: group, id", "unique byGroup: group");
        p.transition(&unique, false).unwrap();
        let widening = unique.replace("item: int 0..0", "item: int");
        if nulls {
            p.transition(&widening, false).unwrap();
            p.count("notes", 2);
        } else {
            p.transition(&widening, false).unwrap_err();
            p.count("notes", 1);
        }
        p.transition(&base, false).unwrap();
        p.count("notes", 2);
        let capped = base.replace("  public\n", "  cap 1 by group\n  public\n");
        // Ordinary caps count null, unlike unique keys.
        p.transition(&capped, false).unwrap_err();
        p.count("notes", 2);
        let capped_narrow = capped.replace("item: int", "item: int 0..0");
        p.transition(&capped_narrow, false).unwrap();
        p.count("notes", 1);
        p.transition(&capped, false).unwrap_err();
        p.count("notes", 1);
        p.transition(&base, false).unwrap();
    }
});
dual!(narrowed_ids_and_deleted_parent_lifetime, {
    let wide = "table parents:\n  public\n  online only\ntable notes:\n  parent: parents on delete keep\n  n: int\n  public\n  online only\n";
    let mut p = Pair::new(wide);
    p.put("parents", object([("id", id("p"))]));
    p.put(
        "notes",
        object([("id", id("r")), ("parent", id("p")), ("n", Value::Int(10))]),
    );
    p.transition(&wide.replace("n: int", "n: int 0..0"), false)
        .unwrap();
    for e in [&mut p.sqlite, &mut p.pg] {
        let table = e.schema().tables["notes"].clone();
        let tx = e.store_mut().transaction().unwrap();
        let error = tx
            .put(
                "notes",
                &table,
                &object([("id", id("r")), ("parent", id("p")), ("n", Value::Int(0))]),
                None,
            )
            .unwrap_err();
        assert_eq!(error.code(), "E_RULE");
        drop(tx);
        let table = e.schema().tables["parents"].clone();
        let tx = e.store_mut().transaction().unwrap();
        let old = tx.get("parents", "p").unwrap().unwrap();
        tx.delete("parents", &table, &old).unwrap();
        tx.put("parents", &table, &old, None).unwrap();
        tx.commit().unwrap();
    }
    p.equal();
    p.transition(wide, false).unwrap();
    p.count("notes", 0);
});

dual!(whole_table_restore_with_edited_domain, {
    let wide = source("int");
    let mut p = Pair::new(&wide);
    p.put("notes", row("low", Value::Int(1)));
    p.put("notes", row("high", Value::Int(10)));
    let retired = "table other:\n  public\n  online only\n";
    p.transition(retired, false).unwrap();
    p.transition(&source("int 0..5"), true).unwrap();
    p.count("notes", 1);
    p.transition(&wide, false).unwrap();
    p.count("notes", 2);
});
dual!(set_null_cap_groups, {
    let wide = "table parents:\n  public\n  online only\ntable notes:\n  parent: parents ? on delete set null\n  n: int\n  cap 1 by parent\n  public\n  online only\nquery allNotes():\n  return notes first 100\n";
    let mut p = Pair::new(wide);
    for (key, n) in [("a", 0), ("b", 10)] {
        p.put(
            "notes",
            object([
                ("id", id(key)),
                ("parent", Value::Null),
                ("n", Value::Int(n)),
            ]),
        );
    }
    p.transition(&wide.replace("n: int", "n: int 0..0"), false)
        .unwrap();
    p.count("notes", 1);
    p.transition(wide, false).unwrap();
    p.count("notes", 2);
});

dual!(default_change_rebuilds_unique_groups_atomically, {
    let wide = source("int default 7").replace("  public\n", "  unique byItem: item\n  public\n");
    let mut p = Pair::new(&wide);
    p.put("notes", object([("id", id("sparse"))]));
    p.put("notes", row("explicit", Value::Int(8)));
    p.transition(&wide.replace("default 7", "default 8"), false)
        .unwrap_err();
    let nonunique = wide
        .replace("unique byItem: item", "by byItem: item, id")
        .replace("default 7", "default 8");
    p.transition(&nonunique, false).unwrap();
    p.count("notes", 2);
    p.transition(&wide, false).unwrap();
});

dual!(unversioned_adoption_refuses_incompatible_values, {
    let (schema, programs) = bound(&source("int"));
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let namespace = format!("sb4_ev2_dev_{:x}", snapback4_core::ids::seed());
    let mut sqlite = Engine::new_at(
        AnyStore::memory().unwrap(),
        schema.clone(),
        programs.clone(),
        1000,
    )
    .unwrap();
    let mut pg = Engine::new_at(
        AnyStore::create_postgres(&url, &namespace).unwrap(),
        schema,
        programs,
        1000,
    )
    .unwrap();
    for e in [&mut sqlite, &mut pg] {
        let table = e.schema().tables["notes"].clone();
        let tx = e.store_mut().transaction().unwrap();
        tx.put("notes", &table, &row("r", Value::Int(10)), None)
            .unwrap();
        tx.commit().unwrap();
    }
    let generation = pg.generation();
    for candidate in [
        source("int 0..5"),
        source("int").replace("  item: int\n", "  item: int\n  required: int\n"),
    ] {
        let (schema, programs) = bound(&candidate);
        let a = sqlite
            .adopt_at(schema.clone(), programs.clone(), 1000)
            .unwrap_err();
        let b = pg.adopt_at(schema, programs, 1000).unwrap_err();
        assert_eq!(a.code(), "E_ADOPT");
        assert_eq!(a.code(), b.code(), "SQLite {a:?}; PG {b:?}");
        assert_eq!(pg.generation(), generation);
        assert_eq!(
            sqlite.store().rows("notes").unwrap(),
            pg.store().rows("notes").unwrap()
        );
    }
});

// The large literal must belong to the retained predecessor, not be added later.
dual!(
    large_retained_definition_restores_and_allows_later_release,
    {
        let literal = "x".repeat(300 * 1024);
        let wide = format!(
            "table notes:\n  n: int\n  payload: text <=400000 default \"{literal}\"\n  public\n  online only\n"
        );
        let mut p = Pair::new(&wide);
        p.put("notes", object([("id", id("r")), ("n", Value::Int(99))]));
        p.transition(&wide.replace("n: int", "n: int 0..10"), false)
            .unwrap();
        p.count("notes", 0);
        assert!(
            p.sql("SELECT octet_length(definition)::text FROM _dormant_narrow_rows")[0][0]
                .parse::<usize>()
                .unwrap()
                > 300 * 1024
        );
        p.transition(&wide, false).unwrap();
        p.count("notes", 1);
        assert_eq!(
            p.sqlite.store().rows("notes").unwrap()[0]
                .field("payload")
                .unwrap(),
            &Value::String(literal)
        );
        p.transition(
            &format!("{wide}table unrelated:\n  public\n  online only\n"),
            false,
        )
        .unwrap();
        p.count("notes", 1);
    }
);

fn group_candidate(cap: bool) -> (String, String) {
    if cap {
        let before = source("int").replace("  public\n", "  cap 2 by item\n  public\n");
        let after = before.replace("cap 2", "cap 1");
        (before, after)
    } else {
        let before = source("int");
        let after = before.replace("  public\n", "  unique byItem: item\n  public\n");
        (before, after)
    }
}
// Both source and typed schemas reject zero before store dispatch.
fn group_bound(source: &str, zero: bool) -> (Schema, Vec<Program>) {
    let (mut schema, programs) = bound(source);
    if zero {
        for constraint in &mut schema.tables.get_mut("notes").unwrap().constraints {
            if let snapback4_core::schema::Constraint::Cap { max, .. } = constraint {
                *max = 0;
            }
        }
    }
    (schema, programs)
}
fn dev_group_refusal(cap: bool, zero: bool, added_literal: bool) {
    let (before, after) = group_candidate(cap);
    let after = if added_literal {
        after.replace(
            "  unique byItem: item\n",
            "  tag: int default 7\n  unique byTag: tag\n",
        )
    } else {
        after
    };
    let before = if zero {
        before.replace("cap 2", "cap 1")
    } else {
        before
    };
    let (schema, programs) = bound(&before);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let namespace = format!("sb4_ev2_dev_group_{:x}", snapback4_core::ids::seed());
    let mut sqlite = Engine::new_at(
        AnyStore::memory().unwrap(),
        schema.clone(),
        programs.clone(),
        1000,
    )
    .unwrap();
    let mut pg = Engine::new_at(
        AnyStore::create_postgres(&url, &namespace).unwrap(),
        schema,
        programs,
        1000,
    )
    .unwrap();
    for e in [&mut sqlite, &mut pg] {
        let table = e.schema().tables["notes"].clone();
        let tx = e.store_mut().transaction().unwrap();
        for key in if zero { vec!["a"] } else { vec!["a", "b"] } {
            tx.put("notes", &table, &row(key, Value::Int(1)), None)
                .unwrap();
        }
        tx.commit().unwrap();
    }
    let original = sqlite.store().rows("notes").unwrap();
    let generation = pg.generation();
    let (schema, programs) = group_bound(&after, zero);
    let a = sqlite
        .adopt_at(schema.clone(), programs.clone(), 1000)
        .unwrap_err();
    let b = pg.adopt_at(schema, programs, 1000).unwrap_err();
    println!("SQLite {a:?}; PG {b:?}");
    for e in [&sqlite, &pg] {
        assert_eq!(e.generation(), generation);
        assert_eq!(e.store().rows("notes").unwrap(), original);
    }
    assert_eq!(a.code(), if zero { "E_SCHEMA" } else { "E_ADOPT" });
    assert_eq!(a.code(), b.code(), "SQLite {a:?}; PG {b:?}");
    assert_eq!(a.to_string(), b.to_string());
}
fn release_group_refusal(cap: bool, zero: bool) {
    let (before, after) = group_candidate(cap);
    let before = if zero {
        before.replace("cap 2", "cap 1")
    } else {
        before
    };
    let mut p = Pair::new(&before);
    p.put("notes", row("a", Value::Int(1)));
    if !zero {
        p.put("notes", row("b", Value::Int(1)));
    }
    let snapshot = p.snapshot();
    let (schema, programs) = group_bound(&after, zero);
    let options = ReleaseActivation::new(2, Some(1));
    let a = p
        .sqlite
        .adopt_release_at(schema.clone(), programs.clone(), &options, false, 1000)
        .unwrap_err();
    let b =
        p.pg.adopt_release_at(schema, programs, &options, false, 1000)
            .unwrap_err();
    println!("SQLite {a:?}; PG {b:?}");
    assert_eq!(snapshot, p.snapshot());
    p.equal();
    assert_eq!(a.code(), if zero { "E_SCHEMA" } else { "E_ADOPT" });
    assert_eq!(a.to_string(), b.to_string());
}
dual!(dev_unique_refusal_matches_code_and_text, {
    dev_group_refusal(false, false, false);
    // A newly defaulted column is additive; SQLite diagnoses its unique index.
    dev_group_refusal(false, false, true);
});
dual!(
    dev_cap_refusal_matches_code_and_text,
    dev_group_refusal(true, false, false)
);
dual!(
    release_unique_refusal_matches_text,
    release_group_refusal(false, false)
);
dual!(
    release_cap_refusal_matches_text,
    release_group_refusal(true, false)
);

dual!(restored_unique_refusal_bounds_samples_and_matches_text, {
    let wide = source("int");
    let mut p = Pair::new(&wide);
    for n in 1..=6 {
        for prefix in ["a", "b"] {
            p.put("notes", row(&format!("{prefix}{n}"), Value::Int(n)));
        }
    }
    p.transition(&source("int 0..0"), false).unwrap();
    p.count("notes", 0);
    let unique = wide.replace("  public\n", "  unique byItem: item\n  public\n");
    let snapshot = p.snapshot();
    let a = release(&mut p.sqlite, &unique, 3, false).unwrap_err();
    let b = release(&mut p.pg, &unique, 3, false).unwrap_err();
    assert_eq!(snapshot, p.snapshot());
    p.equal();
    assert_eq!(a.to_string(), b.to_string());
    assert!(a.to_string().contains("1 more restoration groups"));
    assert!(a.to_string().contains("sample ids [a1, a2, a3, a4, a5]"));
});

dual!(
    dev_zero_cap_refuses_before_store_dispatch,
    dev_group_refusal(true, true, false)
);
dual!(
    release_zero_cap_refuses_before_store_dispatch,
    release_group_refusal(true, true)
);

#[path = "ev2_fix2.rs"]
mod fix2;
