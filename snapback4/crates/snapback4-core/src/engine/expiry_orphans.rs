//! Explicit recovery for physically missing expiry parents; absence has no provenance.
// @ref LLP 3000.039#13-wave-13-expiry-orphan-recovery — inspect without writes; only an operator-selected missing identity can trigger recovery.
use super::{Engine, Runner, time_audience};
use crate::{Context, Value, error::RuntimeError, meter::{Ceilings, Cut, Meter}, schema::{BY_ID, Schema}, store::{Bounds, Dir}};
use std::collections::BTreeSet;

fn eligible(schema: &Schema, parent: &str) -> bool {
    schema.actionable(parent) && schema.table(parent).is_some_and(|table| table.expire.is_some())
        && schema.referencing(parent).iter().any(|reference| reference.action.writes())
}

impl Engine {
    /// At most `limit` missing parent identities, in schema/row order. A single
    /// coherent read snapshot, bounded row pages, no adoption or repair writes.
    /// These can also be deliberately dangling references, never proven expiry.
    pub fn expiry_orphans(&mut self, limit: usize) -> Result<Vec<(String, String)>, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let mut found = BTreeSet::new();
        if limit == 0 { return Ok(Vec::new()); }
        for parent in self.schema.tables.keys().filter(|parent| eligible(&self.schema, parent)) {
            for reference in self.schema.referencing(parent).iter().filter(|reference| reference.action.writes()) {
                let mut bounds = Bounds::default();
                loop {
                    let page = tx.scan(reference.child, BY_ID, &[], &bounds, Dir::Asc, 128)?;
                    let count = page.len();
                    for (row, key) in page {
                        bounds.after = crate::key::decode(&key);
                        let value = row.field(reference.column)?;
                        if value == &Value::Null { continue; }
                        let id = value.as_str()?;
                        if tx.get(parent, id)?.is_none() {
                            found.insert((parent.clone(), id.to_owned()));
                            if found.len() >= limit { return Ok(found.into_iter().collect()); }
                        }
                    }
                    if count < 128 { break; }
                }
            }
        }
        Ok(found.into_iter().collect())
    }

    /// The host has selected this missing root explicitly. Apply the current
    /// schema's ordinary bounded reference closure; never fabricate a parent
    /// image or restore it, bypass a blocker, or commit partial child actions.
    pub fn repair_expiry_orphan(&mut self, parent: &str, id: &str, now: i64) -> Result<u64, RuntimeError> {
        if id.is_empty() || !eligible(&self.schema, parent) {
            return Err(RuntimeError::Schema("expiry orphan recovery needs an expiring parent table with cascade or set-null references and a nonempty id".into()));
        }
        let tx = self.store.transaction()?;
        if tx.get(parent, id)?.is_some() {
            return Err(RuntimeError::Schema("expiry orphan recovery requires a physically missing parent; an existing expired parent uses the ordinary sweep".into()));
        }
        let now = time_audience::pin_writer_time(&self.schema, &tx, now)?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let identity = crate::value::object([("id", Value::Id(id.into()))]);
        runner.apply_missing_reference_actions(parent, &identity)?;
        let events = runner.events.take();
        let tables = runner.written_tables.iter().cloned().collect::<Vec<_>>();
        let written = runner.rows_written;
        drop(runner);
        if written > 0 {
            tx.record_commit(seq, now, "repair expiry orphan", crate::SYSTEM_PRINCIPAL, &format!("{parent}:{id}"), &tables, written)?;
            super::partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(written)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Store, value::object};
    const SOURCE: &str = "table parents:\n  until: time\n  immutable until\n  public 'test'\n  expire at .until\ntable children:\n  parent: parents on delete cascade\n  cap 5 by parent\n  public 'test'\ntable links:\n  parent: parents ? on delete set null\n  cap 5 by parent\n  public 'test'\ntable history:\n  parent: parents on delete keep\n  public 'test'\ntable leaves:\n  child: children on delete cascade\n  cap 5 by child\n  public 'test'\n";
    fn engine(extra: &str) -> Engine {
        let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{SOURCE}{extra}"))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
        Engine::new_at(Store::memory().unwrap(), schema, [], 0).unwrap()
    }
    fn row(id: &str, field: &str, value: Value) -> Value { object([("id", Value::Id(id.into())), (field, value)]) }
    fn orphan(engine: &mut Engine) {
        engine.seed_at(vec![
            ("parents".into(), row("p", "until", Value::Int(10))),
            ("children".into(), row("c", "parent", Value::Id("p".into()))),
            ("links".into(), row("l", "parent", Value::Id("p".into()))),
            ("history".into(), row("h", "parent", Value::Id("p".into()))),
            ("leaves".into(), row("leaf", "child", Value::Id("c".into()))),
        ], 0).unwrap();
        let table = engine.schema.tables["parents"].clone();
        let tx = engine.store.transaction().unwrap();
        let parent = tx.get("parents", "p").unwrap().unwrap();
        tx.delete("parents", &table, &parent).unwrap(); // 0.4.28's physical-only sweep
        tx.commit().unwrap();
    }
    #[test]
    fn missing_expiry_parent_needs_explicit_selection_and_repairs_with_normal_actions() {
        let mut engine = engine(""); orphan(&mut engine);
        let seq = engine.store.seq().unwrap();
        assert_eq!(engine.expiry_orphans(32).unwrap(), vec![("parents".into(), "p".into())]);
        assert_eq!(engine.store.seq().unwrap(), seq, "doctor is read-only");
        let schema = engine.schema.clone();
        engine.adopt_at(schema, [], 20).unwrap();
        engine.sweep_expired(20, 100).unwrap();
        assert_eq!(engine.store.rows("children").unwrap().len(), 1, "absence alone never authorizes repair");
        assert!(engine.repair_expiry_orphan("parents", "p", 20).unwrap() >= 3);
        assert!(engine.store.rows("children").unwrap().is_empty());
        assert!(engine.store.rows("leaves").unwrap().is_empty());
        assert_eq!(engine.store.rows("links").unwrap()[0].field("parent").unwrap(), &Value::Null);
        assert_eq!(engine.store.rows("history").unwrap().len(), 1);
        assert!(engine.expiry_orphans(32).unwrap().is_empty());
        let seq = engine.store.seq().unwrap();
        assert_eq!(engine.repair_expiry_orphan("parents", "p", 20).unwrap(), 0);
        assert_eq!(engine.store.seq().unwrap(), seq);
    }
    #[test]
    fn restrict_refuses_atomically_and_existing_parent_is_never_repaired() {
        let mut engine = engine("table blockers:\n  parent: parents on delete restrict\n  public 'test'\n"); orphan(&mut engine);
        engine.seed_at(vec![("blockers".into(), row("b", "parent", Value::Id("p".into())))], 0).unwrap();
        let seq = engine.store.seq().unwrap();
        assert_eq!(engine.repair_expiry_orphan("parents", "p", 20).unwrap_err().code(), "E_REFERENCED");
        assert_eq!(engine.store.seq().unwrap(), seq);
        assert_eq!(engine.store.rows("children").unwrap().len(), 1);
        assert_eq!(engine.store.rows("links").unwrap()[0].field("parent").unwrap(), &Value::Id("p".into()));
        engine.seed_at(vec![("parents".into(), row("present", "until", Value::Int(100)))], 0).unwrap();
        assert!(engine.repair_expiry_orphan("parents", "present", 20).unwrap_err().to_string().contains("physically missing"));
        assert!(engine.repair_expiry_orphan("history", "p", 20).is_err());
    }
    #[test]
    fn physical_read_through_root_child_refuses_before_cascade_or_null_writes() {
        let mut engine = engine("table captures:\n  parent: parents\n  immutable parent\n  read through .parent\n"); orphan(&mut engine);
        // Simulate a physically retained capture from before the parent vanished.
        // Trusted store insertion preserves its already-captured lifetime.
        let table = engine.schema.tables["captures"].clone();
        let tx = engine.store.transaction().unwrap();
        let mut fields = std::collections::BTreeMap::from([("id".into(), Value::Id("capture".into())), ("parent".into(), Value::Id("p".into()))]);
        for (name, kind) in &table.columns {
            if table.engine_field(name) { fields.insert(name.clone(), if matches!(kind.required(), crate::schema::ColumnType::Time) { Value::Int(10) } else { Value::Null }); }
        }
        tx.put("captures", &table, &Value::Row(fields), None).unwrap(); tx.commit().unwrap();
        let seq = engine.store.seq().unwrap();
        assert_eq!(engine.repair_expiry_orphan("parents", "p", 20).unwrap_err().code(), "E_PARENT_HAS_CHILDREN");
        assert_eq!(engine.store.seq().unwrap(), seq);
        assert_eq!(engine.store.rows("children").unwrap().len(), 1);
        assert_eq!(engine.store.rows("links").unwrap()[0].field("parent").unwrap(), &Value::Id("p".into()));
    }

}
