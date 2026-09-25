use snapback4_core::{
    Context, Value,
    engine::runner::Runner,
    error::RuntimeError,
    meter::{Ceilings, Cut, Meter},
    rows::{Bounds, Dir, MemoryRows, Rows},
    schema::{Index, Table},
};
use std::cell::Cell;
struct Counted {
    inner: MemoryRows,
    fetched: Cell<usize>,
}
impl Rows for Counted {
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
    fn count_prefix(&self, t: &str, n: &str, p: &[Value], l: u64) -> Result<u64, RuntimeError> {
        self.inner.count_prefix(t, n, p, l)
    }
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
    for aggregate in [false, true] {
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
                let row=snapback4_core::wire::row_from_json(&b.schema.tables["grants"],&serde_json::json!({"id":format!("expired{n}"),"parent":"p","who":"alice","until":500})).unwrap();
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
            assert_eq!(result.as_ref().unwrap_err().refusal().code, "E_RULE");
            observations.push(result.as_ref().unwrap_err().refusal());
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
    let exhausted = RuntimeError::AuthorizationBudget.refusal();
    assert_eq!(ordinary, exhausted, "the refusal must not select a cause");
    assert!(ordinary.message.contains("physical work allowance"));
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
