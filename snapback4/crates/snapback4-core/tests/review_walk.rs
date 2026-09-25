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
        self.inner.get(t, id)
    }
    fn lookup(
        &self,
        t: &str,
        n: &str,
        ix: &Index,
        k: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        self.inner.lookup(t, n, ix, k)
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
