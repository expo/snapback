//! The shortcut has its own stop/restore contract, before the outer point wrapper.
use super::*;
use crate::rows::{MemoryRows, Rows};
use std::cell::RefCell;

#[derive(Default)]
struct ObservedRows {
    inner: MemoryRows,
    reads: RefCell<Vec<String>>,
}
impl Rows for ObservedRows {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.reads.borrow_mut().push(table.into());
        self.inner.get(table, id)
    }
    fn lookup(
        &self,
        table: &str,
        name: &str,
        index: &Index,
        key: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        self.reads.borrow_mut().push(table.into());
        self.inner.lookup(table, name, index, key)
    }
    fn scan(
        &self,
        table: &str,
        name: &str,
        prefix: &[Value],
        bounds: &Bounds,
        dir: Dir,
        limit: usize,
    ) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        self.reads.borrow_mut().push(table.into());
        self.inner.scan(table, name, prefix, bounds, dir, limit)
    }
    fn count_prefix(
        &self,
        table: &str,
        name: &str,
        prefix: &[Value],
        limit: u64,
    ) -> Result<u64, RuntimeError> {
        self.inner.count_prefix(table, name, prefix, limit)
    }
    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        self.inner.cap_count(table, by, group)
    }
    fn put(
        &self,
        name: &str,
        table: &Table,
        row: &Value,
        old: Option<&Value>,
    ) -> Result<u64, RuntimeError> {
        self.inner.put(name, table, row, old)
    }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        self.inner.delete(name, table, old)
    }
}

#[test]
fn authorized_aggregate_shortcut_stops_at_its_own_cut_boundary() {
    let model = include_str!("../../../snapback4-lang/tests/read_through/lifetime.q");
    let source = format!(
        "{model}\ntable gates:\n  parent: parents\n  until: time\n  unique parent\n  expire at .until\n  read <- deny\n  insert <- allow\ntable guards:\n  parent: parents\n  unique parent\n  read <- deny\n  insert <- allow\nview totals: count children by .parent\n  read <- exists gates[parent = .parent] and exists guards[parent = .parent]\n"
    );
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: Schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let index = schema.tables["totals"]
        .indexes
        .iter()
        .find(|(_, i)| i.columns() == vec!["parent"])
        .unwrap()
        .0;
    let id = |s: &str| Value::Id(s.into());
    let read = Read {
        site: "shortcut".into(),
        table: "totals".into(),
        index: index.clone(),
        key: vec![],
        provenance: KeyProvenance::Const,
    };
    for deadline in [300, 500] {
        let rows = ObservedRows::default();
        let mut seed = Runner::new(
            &rows,
            &schema,
            Context::system().at(100),
            Meter::new(Ceilings::default(), Cut::Abort),
            0,
        );
        for (table, row) in [
            (
                "parents",
                object([
                    ("id", id("p")),
                    ("owner", id("alice")),
                    ("until", Value::Null),
                ]),
            ),
            (
                "children",
                object([
                    ("id", id("c")),
                    ("parent", id("p")),
                    ("body", Value::String("hello".into())),
                    ("until", Value::Int(900)),
                ]),
            ),
            (
                "gates",
                object([
                    ("id", id("g")),
                    ("parent", id("p")),
                    ("until", Value::Int(deadline)),
                ]),
            ),
            ("guards", object([("id", id("g")), ("parent", id("p"))])),
        ] {
            seed.insert(table, row).unwrap();
        }
        drop(seed);
        for prior in [None, Some(700)] {
            rows.reads.borrow_mut().clear();
            let mut r = Runner::new(
                &rows,
                &schema,
                Context::new("bob", BTreeMap::new()).at(200),
                Meter::new(
                    Ceilings {
                        rule_probes: 1,
                        ..Ceilings::default()
                    },
                    Cut::Cap,
                ),
                0,
            );
            r.next_expiry = prior;
            // The static two-probe reservation caps, but PrefixProbe can still
            // evaluate true and record the gate's deadline. Stop at this boundary,
            // without relying on get_inner's later failure cleanup to mask it.
            let result = r.get_prepared(&read, &[id("p")]).unwrap();
            assert_eq!(r.next_expiry, prior);
            assert_eq!(
                rows.reads.borrow().as_slice(),
                &["gates", "guards"],
                "a cut shortcut must not fetch the aggregate or its contributions"
            );
            assert_eq!(result, object([("value", Value::Null)]));
            assert_eq!(r.metered().rule_probes, 2);
            assert_eq!(
                r.meter.capped_at.as_ref().map(|cut| cut.0),
                Some(MeterKind::RuleProbes)
            );
            let mut allowed = Runner::new(
                &rows,
                &schema,
                Context::new("bob", BTreeMap::new()).at(200),
                Meter::new(Ceilings::default(), Cut::Cap),
                0,
            );
            assert_eq!(
                allowed
                    .get_prepared(&read, &[id("p")])
                    .unwrap()
                    .field("value"),
                Ok(&Value::Int(1))
            );
            assert_eq!(allowed.next_expiry, Some(deadline));
        }
    }
}
