use snapback4_core::{
    Context, Value,
    engine::runner::Runner,
    error::RuntimeError,
    meter::{Ceilings, Cut, Meter},
    rows::{Bounds, Dir, MemoryRows, Rows},
    schema::{Index, Table},
};
use std::cell::Cell;
struct Counted<R = MemoryRows> {
    inner: R,
    fetched: Cell<usize>,
}
impl<R: Rows> Rows for Counted<R> {
    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let row = self.inner.get(t, id)?;
        self.fetched
            .set(self.fetched.get() + usize::from(row.is_some()));
        Ok(row)
    }
    fn lookup(
        &self,
        t: &str,
        n: &str,
        ix: &Index,
        k: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        let row = self.inner.lookup(t, n, ix, k)?;
        self.fetched
            .set(self.fetched.get() + usize::from(row.is_some()));
        Ok(row)
    }
    fn scan(
        &self,
        t: &str,
        n: &str,
        p: &[Value],
        b: &Bounds,
        d: Dir,
        l: usize,
    ) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let r = self.inner.scan(t, n, p, b, d, l)?;
        self.fetched.set(self.fetched.get() + r.len());
        Ok(r)
    }
    fn index_head(&self, t: &str, n: &str, p: &[Value], b: &Bounds, d: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        self.inner.index_head(t,n,p,b,d)
    }
    fn count_prefix(&self, t: &str, n: &str, p: &[Value], l: u64) -> Result<u64, RuntimeError> {
        self.inner.count_prefix(t, n, p, l)
    }
    fn cap_count(&self, table: &str, by: &[String], key: &[Value]) -> Result<u64, RuntimeError> { self.inner.cap_count(table, by, key) }
    fn put(&self, t: &str, def: &Table, r: &Value, o: Option<&Value>) -> Result<u64, RuntimeError> {
        self.inner.put(t, def, r, o)
    }
    fn delete(&self, t: &str, def: &Table, o: &Value) -> Result<u64, RuntimeError> {
        self.inner.delete(t, def, o)
    }
    fn sequence_value(&self, p: &str, id: &str) -> Result<i64, RuntimeError> {
        self.inner.sequence_value(p, id)
    }
    fn set_sequence(&self, p: &str, id: &str, v: i64) -> Result<(), RuntimeError> {
        self.inner.set_sequence(p, id, v)
    }
}
#[test]
fn expired_cap_population_stops_at_the_physical_bound() {
    let source = "table parents:\n  public\n  online only\ntable messages:\n  parent: parents\n  owner: principal default viewer\n  ordinal: sequence by parent\n  expiresAt: time ?\n  expire at .expiresAt\n  cap 1 by parent\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation send(parent: parents):\n  return insert messages { parent }\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    for count in [8193, 20000, 8191, 8192] {
        let rows = Counted {
            inner: MemoryRows::default(),
            fetched: Cell::new(0),
        };
        for n in 1..=count {
            let r=snapback4_core::wire::row_from_json(&b.schema.tables["messages"],&serde_json::json!({"id":format!("expired{n}"),"parent":"p","owner":"bob","ordinal":n,"expiresAt":500})).unwrap();
            rows.put("messages", &b.schema.tables["messages"], &r, None)
                .unwrap();
        }
        rows.set_sequence("parents", "p", count as i64).unwrap();
        let context = Context::new("alice", [("parent".into(), Value::Id("p".into()))].into())
            .at(1000)
            .with_ids(["new".into()]);
        let mut runner = Runner::new(
            &rows,
            &b.schema,
            context,
            Meter::new(Ceilings::default(), Cut::Abort),
            0,
        );
        let r = runner.run(&b.programs[0].program);
        println!(
            "population={count} fetched={} result={r:?}",
            rows.fetched.get()
        );
        assert!(
            rows.fetched.get() <= 8192,
            "physical cap scan exceeded bound"
        );
        if count < 8192 {
            assert!(r.is_ok(), "{r:?}");
        } else {
            assert_eq!(r.unwrap_err().refusal().code, "E_RULE");
        }
    }
}

#[test]
fn cap_group_updates_share_the_declared_physical_limit() {
    let source = "table parents:\n  public\n  online only\ntable messages:\n  parent: parents\n  ordinal: sequence by parent\n  bucket: text <=10\n  until: time ?\n  expire at .until\n  cap 1 by bucket\n  public\n  update <- allow\n  online only\nmutation move():\n  return update messages['old'] { bucket: 'b' }\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    for count in [8192] {
        let rows = Counted {
            inner: MemoryRows::default(),
            fetched: Cell::new(0),
        };
        for n in 0..count {
            let row=snapback4_core::wire::row_from_json(&b.schema.tables["messages"],&serde_json::json!({"id":format!("expired{n}"),"parent":"p","bucket":"b","ordinal":n+2,"until":500})).unwrap();
            rows.put("messages", &b.schema.tables["messages"], &row, None)
                .unwrap();
        }
        let row = snapback4_core::wire::row_from_json(
            &b.schema.tables["messages"],
            &serde_json::json!({"id":"old","parent":"p","bucket":"a","ordinal":1,"until":null}),
        )
        .unwrap();
        rows.put("messages", &b.schema.tables["messages"], &row, None)
            .unwrap();
        rows.set_sequence("parents", "p", count + 1).unwrap();
        let context = Context::new("alice", Default::default()).at(1000);
        let mut runner = Runner::new(
            &rows,
            &b.schema,
            context,
            Meter::new(Ceilings::default(), Cut::Abort),
            0,
        );
        let result = runner.run(&b.programs[0].program);
        assert_eq!(
            result.as_ref().unwrap_err().refusal().code,
            "E_RULE",
            "update crossed physical bound: {result:?}"
        );
        assert!(rows.fetched.get() <= 8192);
        println!(
            "expired_messages={count} physical_rows_fetched={} result={result:?}",
            rows.fetched.get()
        );
    }
}

#[test]
fn nested_expired_witnesses_share_the_cap_allowance() {
    let source = "table parents:\n  public\n  online only\ntable grants:\n  parent: parents\n  who: principal\n  until: time ?\n  expire at .until\n  by byParentWho: parent, who\n  read <- deny\n  online only\ntable messages:\n  parent: parents\n  owner: principal default viewer\n  ordinal: sequence by parent\n  fresh: bool\n  until: time ?\n  expire at .until\n  cap 2 by parent\n  read <- .fresh = true or exists grants[parent = .parent, who = viewer] or .owner = viewer\n  insert <- allow\n  online only\nmutation send(parent: parents):\n  return insert messages { parent, fresh: true }\n";
    for (aggregate, deadline) in [(false, 500), (true, 500), (true, 2000)] {
        let source = if aggregate {
            source.replace(
                "exists grants[parent = .parent, who = viewer]",
                "exists counts[parent = .parent, who = viewer]",
            ) + "\nmaintain counts: count grants by parent, who\n  read <- deny\n"
        } else {
            source.to_string()
        };
        let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let mut observations = vec![];
        for count in [8193, 20000] {
            let rows = Counted {
                inner: MemoryRows::default(),
                fetched: Cell::new(0),
            };
            if aggregate {
                let row = snapback4_core::value::object([
                    ("id", Value::Id("count".into())),
                    ("parent", Value::Id("p".into())),
                    ("who", Value::Id("alice".into())),
                    ("count", Value::Int(count)),
                ]);
                rows.put("counts", &b.schema.tables["counts"], &row, None)
                    .unwrap();
            }
            for n in 0..count {
                let row=snapback4_core::wire::row_from_json(&b.schema.tables["grants"],&serde_json::json!({"id":format!("expired{n}"),"parent":"p","who":"alice","until":deadline})).unwrap();
                rows.put("grants", &b.schema.tables["grants"], &row, None)
                    .unwrap();
            }
            let row=snapback4_core::wire::row_from_json(&b.schema.tables["messages"],&serde_json::json!({"id":"old","parent":"p","owner":"alice","ordinal":1,"fresh":false})).unwrap();
            rows.put("messages", &b.schema.tables["messages"], &row, None)
                .unwrap();
            rows.set_sequence("parents", "p", 1).unwrap();
            let context = Context::new("alice", [("parent".into(), Value::Id("p".into()))].into())
                .at(1000)
                .with_ids(["new".into()]);
            let mut runner = Runner::new(
                &rows,
                &b.schema,
                context,
                Meter::new(Ceilings::default(), Cut::Abort),
                0,
            );
            let result = runner.run(&b.programs[0].program);
            assert!(
                rows.fetched.get() <= 8192,
                "nested witnesses escaped the physical allowance"
            );
            if aggregate {
                // The contribution index supplies the last surviving expiry
                // without fetching either the live or the expired payload range.
                assert!(result.is_ok(), "{result:?}");
                assert!(rows.fetched.get() < 32);
                observations.push(None);
            } else {
                assert_eq!(result.as_ref().unwrap_err().refusal().code, "E_RULE");
                observations.push(Some(result.as_ref().unwrap_err().refusal()));
            }
            println!(
                "expired_grants={count} physical_rows_fetched={} result={result:?}",
                rows.fetched.get()
            );
        }
        assert_eq!(observations[0], observations[1]);
    }
}

#[test]
fn physical_exhaustion_uses_the_shared_cause_neutral_rule_explanation() {
    let ordinary = RuntimeError::Rule {
        table: "messages".into(),
        effect: snapback4_core::schema::Effect::Insert,
    }
    .refusal();
    let exhausted = RuntimeError::AuthorizationBudget { table: "messages".into(), effect: snapback4_core::schema::Effect::Insert }.refusal();
    assert_eq!(ordinary, exhausted, "the refusal must not select a cause");
    assert!(ordinary.message.contains("physical work allowance"));
    assert!(ordinary.message.contains("messages's insert rule"));
    assert!(
        snapback4_lang::guide::explain_code("E_RULE")
            .unwrap()
            .contains("physical work allowance")
    );
    assert!(!ordinary.message.contains("8192"));
}

#[test]
fn nonexpiring_private_caps_share_the_physical_allowance() {
    let source = "table parents:\n  public\n  online only\ntable messages:\n  parent: parents\n  owner: principal default viewer\n  ordinal: sequence by parent\n  cap 8193 by parent\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation send():\n  return insert messages { parent: 'p' }\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    for count in [8191, 8192, 20000] {
        let rows = Counted {
            inner: MemoryRows::default(),
            fetched: Cell::new(0),
        };
        for n in 0..count {
            let row = snapback4_core::wire::row_from_json(&b.schema.tables["messages"], &serde_json::json!({"id":format!("own{n}"),"parent":"p","owner":"alice","ordinal":n+1})).unwrap();
            rows.put("messages", &b.schema.tables["messages"], &row, None)
                .unwrap();
        }
        rows.set_sequence("parents", "p", count).unwrap();
        let mut runner = Runner::new(
            &rows,
            &b.schema,
            Context::new("alice", Default::default())
                .at(1000)
                .with_ids(["new".into()]),
            Meter::new(
                Ceilings {
                    examined: 32768,
                    ..Ceilings::default()
                },
                Cut::Abort,
            ),
            0,
        );
        let result = runner.run(&b.programs[0].program);
        if count < 8192 {
            assert!(result.is_ok(), "{result:?}");
        } else {
            assert_eq!(result.unwrap_err().refusal().code, "E_RULE");
        }
        assert!(
            rows.fetched.get() <= 8192,
            "the absence of an expire declaration cannot disable the physical bound"
        );
    }
}

#[test]
fn server_private_witness_and_expired_unique_walks_share_one_allowance() {
    for unique in [false,true] {
        let source = if unique {
            "table records:\n  tag: int\n  until: time ?\n  expire at .until\n  unique tag\n  public\n  online only\nquery one():\n  return records[tag = 0]\n"
        } else {
            "table records:\n  tag: int\n  until: time ?\n  expire at .until\n  by byTag: tag\n  read <- deny\n  online only\ntable gates:\n  read <- exists records[tag = 0] or viewer = 'alice'\n  online only\nquery one():\n  return gates['g']\n"
        };
        let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let observations=[18000,20000].map(|n| {
            let rows=Counted {inner:MemoryRows::default(),fetched:Cell::new(0)};
            for i in 0..=n {
                let value=snapback4_core::wire::row_from_json(&b.schema.tables["records"],&serde_json::json!({"id":format!("r{i:05}"),"tag":0,"until":if unique && i<n {500} else {2000}})).unwrap();
                rows.put("records",&b.schema.tables["records"],&value,None).unwrap();
            }
            if !unique { rows.put("gates",&b.schema.tables["gates"],&snapback4_core::value::object([("id",Value::Id("g".into()))]),None).unwrap(); }
            let mut r=Runner::new(&rows,&b.schema,Context::new("alice",Default::default()).at(1000),Meter::new(Ceilings::default(),Cut::Cap),0);
            let result=r.run(&b.programs[0].program).unwrap_err().refusal();
            assert_eq!(result.code,"E_RULE"); assert_eq!(rows.fetched.get(),8192);
            (result,rows.fetched.get())
        });
        assert_eq!(observations[0],observations[1],"unique={unique}");
    }
}

#[test]
fn an_odd_point_prefix_cannot_turn_a_short_physical_batch_into_exhaustion_of_data() {
    let source="table held:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable grants:\n  tag: int\n  until: time ?\n  expire at .until\n  by byTag: tag\n  read <- deny\n  online only\ntable gates:\n  owner: principal\n  read <- exists grants[tag = 0] or .owner = viewer\n  online only\nquery a():\n  return held['a']\nquery b():\n  return held['b']\nquery one():\n  return gates['g']\n";
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let observations=[11,43].map(|population| {
        let rows=Counted {inner:MemoryRows::default(),fetched:Cell::new(0)};
        for (table,id) in [("held","a"),("held","b"),("gates","g")] {
            let row=snapback4_core::value::object([("id",Value::Id(id.into())),("owner",Value::Id("alice".into()))]);
            rows.put(table,&b.schema.tables[table],&row,None).unwrap();
        }
        for n in 0..population {
            let row=snapback4_core::wire::row_from_json(&b.schema.tables["grants"],&serde_json::json!({"id":format!("g{n:03}"),"tag":0,"until":if n+1==population {None} else {Some(500)}})).unwrap();
            rows.put("grants",&b.schema.tables["grants"],&row,None).unwrap();
        }
        let mut r=Runner::new(&rows,&b.schema,Context::new("alice",Default::default()).at(1000),Meter::new(Ceilings::default(),Cut::Cap),0);
        for n in 0..8181 { r.run(&b.programs.iter().find(|p|p.program.name==if n%2==0 {"a"} else {"b"}).unwrap().program).unwrap(); }
        let result=r.run(&b.programs.iter().find(|p|p.program.name=="one").unwrap().program).unwrap_err().refusal();
        assert_eq!(result.code,"E_RULE"); assert_eq!(rows.fetched.get(),8192);
        (result,rows.fetched.get())
    });
    assert_eq!(observations[0],observations[1]);
}

#[test]
fn sqlite_and_memory_server_fetch_counts_cover_expired_points_and_private_lifetimes() {
    fn run<R: Rows>(inner:R, schema:&snapback4_core::Schema, program:&snapback4_core::Program, count:usize, unique:bool) -> (Option<snapback4_core::Refusal>,usize) {
        let rows=Counted {inner,fetched:Cell::new(0)};
        for n in 0..=count {
            let row=snapback4_core::wire::row_from_json(&schema.tables["leases"],&serde_json::json!({"id":format!("lease{n:05}"),"tag":0,"until":if unique && n<count {500} else {2000}})).unwrap();
            rows.put("leases",&schema.tables["leases"],&row,None).unwrap();
        }
        if !unique {
            rows.put("counts",&schema.tables["counts"],&snapback4_core::value::object([("id",Value::Id("count".into())),("tag",Value::Int(0)),("count",Value::Int(count as i64+1))]),None).unwrap();
            rows.put("gates",&schema.tables["gates"],&snapback4_core::value::object([("id",Value::Id("g".into()))]),None).unwrap();
        }
        let mut runner=Runner::new(&rows,schema,Context::new("alice",Default::default()).at(1000),Meter::new(Ceilings::default(),Cut::Cap),0);
        let result=runner.run(program);
        if unique {assert_eq!(result.as_ref().unwrap_err().refusal().code,"E_RULE");assert_eq!(rows.fetched.get(),8192);}
        else {assert!(result.is_ok(),"{result:?}");assert_eq!(rows.fetched.get(),2,"leases must be read from index metadata, not row payloads");}
        (result.err().map(|e|e.refusal()),rows.fetched.get())
    }
    for unique in [false,true] {
        let source=if unique {"table leases:\n  tag: int\n  until: time ?\n  expire at .until\n  unique tag\n  public\n  online only\nquery one():\n  return leases[tag = 0]\n"}
        else {"table leases:\n  tag: int\n  until: time ?\n  expire at .until\n  by byTag: tag\n  read <- deny\n  online only\nmaintain counts: count leases by tag\n  read <- deny\ntable gates:\n  read <- exists counts[tag = 0] or viewer = 'alice'\n  online only\nquery one():\n  return gates['g']\n"};
        let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let outcomes=[18000,20000].map(|n| {
            let memory=run(MemoryRows::default(),&b.schema,&b.programs[0].program,n,unique);
            let mut engine=snapback4_core::Engine::memory(b.schema.clone(),vec![]).unwrap();
            let tx=engine.store_mut().transaction().unwrap();
            let sqlite=run(tx,&b.schema,&b.programs[0].program,n,unique);
            assert_eq!(memory,sqlite);memory
        });
        assert_eq!(outcomes[0],outcomes[1]);
    }
}


// Astra's landing pair: populations and permanent authority are identical;
// only an unreadable early witness's deadline changes.
fn compound_lifetime_pair(sqlite: bool, operation: &str) {
    let early = "exists early[parent = .parent]";
    let stable = "exists stable[parent = .parent]";
    for rule in [format!("{early} or {stable}"),
        format!("not (not {early} and not {stable})"),
        format!("({early} or {stable}) and viewer = 'alice'")] {
        let source = format!(r#"table parents:
  public
  online only
table early:
  parent: parents
  until: time ?
  expire at .until
  by byParent: parent
  read <- deny
  online only
table stable:
  parent: parents
  until: time ?
  expire at .until
  by byParent: parent
  read <- deny
  online only
table messages:
  parent: parents
  ordinal: sequence by parent
  read <- {rule}
  insert <- allow
  online only
query one():
  return messages['old']
query compound():
  left = messages['old']
  right = messages['old']
  return {{ left, right }}
mutation send():
  return insert messages {{ parent: 'p' }}
"#);
        let b = snapback4_lang::compile(&[("compound.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        for count in [8193, 2] {
            let mut observations = Vec::new();
            for until in [None, Some(2000)] {
                let run = |rows: &dyn Rows| {
                    let put = |table: &str, json: serde_json::Value| {
                        let row = snapback4_core::wire::row_from_json(&b.schema.tables[table], &json).unwrap();
                        rows.put(table, &b.schema.tables[table], &row, None).unwrap();
                    };
                    put("parents", serde_json::json!({"id":"p"}));
                    put("messages", serde_json::json!({"id":"old","parent":"p","ordinal":1}));
                    put("early", serde_json::json!({"id":"early","parent":"p","until":until}));
                    for n in 0..count {
                        put("stable", serde_json::json!({"id":format!("s{n:05}"),"parent":"p","until":null}));
                    }
                    rows.set_sequence("parents", "p", 1).unwrap();
                    let mut runner = Runner::new(rows, &b.schema,
                        Context::new("alice", Default::default()).at(1000).with_ids(["new".into()]),
                        Meter::new(Ceilings::default(), Cut::Abort), 0);
                    let result = runner.run(&b.programs.iter().find(|p| p.program.name.ends_with(&format!(".{operation}"))).unwrap().program)
                        .map_err(|e| e.refusal());
                    if count == 2 {
                        let value = result.as_ref().unwrap();
                        if operation == "send" { assert_eq!(value.field("ordinal").unwrap(), &Value::Int(2)); }
                    }
                    result
                };
                let observation = if sqlite {
                    let dir = std::env::temp_dir().join(format!("sb4-compound-lifetime-{}-{operation}", std::process::id()));
                    std::fs::create_dir_all(&dir).unwrap();
                    let path = dir.join("store.sqlite");
                    let mut engine = snapback4_core::Engine::new(snapback4_core::Store::open(&path).unwrap(), b.schema.clone(), vec![]).unwrap();
                    let tx = engine.store_mut().transaction().unwrap();
                    let rows = Counted { inner: tx, fetched: Cell::new(0) };
                    let observation = (run(&rows), rows.fetched.get());
                    assert!(observation.1 <= 8192);
                    drop(rows);
                    drop(engine);
                    std::fs::remove_dir_all(dir).unwrap();
                    observation
                } else {
                    let rows = Counted { inner: MemoryRows::default(), fetched: Cell::new(0) };
                    let observation = (run(&rows), rows.fetched.get());
                    assert!(observation.1 <= 8192);
                    observation
                };
                observations.push(observation);
            }
            assert_eq!(observations[0], observations[1], "{operation}/{rule}/sqlite={sqlite}/count={count}");
            if count == 8193 { assert_eq!(observations[0].0.as_ref().unwrap_err().code, "E_RULE"); }
        }
    }
}

#[test]
fn compound_witness_lifetime_cannot_select_point_read_exhaustion_memory() {
    compound_lifetime_pair(false, "one");
}
#[test]
fn compound_witness_lifetime_cannot_select_point_read_exhaustion_sqlite() {
    compound_lifetime_pair(true, "one");
}
#[test]
fn compound_witness_lifetime_cannot_select_sequence_insert_exhaustion_memory() {
    compound_lifetime_pair(false, "send");
}
#[test]
fn compound_witness_lifetime_cannot_select_sequence_insert_exhaustion_sqlite() {
    compound_lifetime_pair(true, "send");
}
#[test]
fn compound_witness_lifetime_cannot_select_compound_read_exhaustion_memory() {
    compound_lifetime_pair(false, "compound");
}
#[test]
fn compound_witness_lifetime_cannot_select_compound_read_exhaustion_sqlite() {
    compound_lifetime_pair(true, "compound");
}
