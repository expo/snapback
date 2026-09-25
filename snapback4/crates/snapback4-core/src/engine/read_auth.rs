//! Read authorization of provisional images, over raw combined-state witnesses.
use super::authorized_scan::Authorization;
use super::{rules::{self, Probe}, runner::Runner};
use crate::{error::{MeterKind, RuntimeError}, schema::{Audience}, value::Value};

use super::rules::Verdict;

impl Runner<'_> {
    pub(super) fn is_provisional(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        Ok(self.device && (self.provisional_rows.contains(&(table.into(), row.field("id")?.as_str()?.into())) || self.tx.provisional_row(table, row)?))
    }

    pub(super) fn provisional_readable(&mut self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        if self.context.is_system() || !self.is_provisional(table, row)? { return Ok(true); }
        self.authorize_read(table, row, false)
    }

    /// F3 calls this on an image before insertion; provenance cannot bypass it.
    pub(super) fn evaluate_read_rule(&mut self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        self.authorize_read(table, row, false)
    }

    pub(super) fn authorize_read(&mut self, table: &str, row: &Value, prepaid: bool) -> Result<bool, RuntimeError> {
        self.device_work(|runner| {
            let probes = if prepaid { 0 } else { rules::rule_probes(&runner.schema.tables[table].rules.read) };
            runner.authorized_scratch(runner.rule_scratch(&runner.schema.tables[table].rules.read), &[(MeterKind::RuleProbes, probes)], |runner, allowance| {
                let scratch = runner.meter.mark();
                let result = runner.authorize_read_inner(allowance, table, row, prepaid || !runner.device_work_active);
                if runner.device_work_active { runner.meter.release_heap(scratch); }
                result
            })
        })
    }

    fn authorize_read_inner(&mut self, allowance: &Authorization, table: &str, row: &Value, prepaid: bool) -> Result<bool, RuntimeError> {
        let provisional = self.is_provisional(table, row)?;
        let definition = &self.schema.tables[table];
        let rule = definition.rules.read.clone();
        if self.device_work_active { self.authorized_scratch(0,&[],|runner, scope| { let image = runner.disclosed_row(definition,row.clone()); super::authorized_scan::InternalLedger::with_meter(&mut runner.meter, |meter,_| image.charge_materialization_internal(meter,scope)) })?; }
        let row = self.disclosed_row(definition, row.clone()).into_value();
        self.rule_dependencies(&rule);
        let viewer = self.context.viewer.clone();
        let verdict = rules::evaluate_verdict(&rule, &viewer, None, &row, false, &mut ReadProbe { runner: self, allowance, table, provisional, prepaid, unknown: false })?;
        if self.read_capped() { return Ok(false); }
        if verdict == Verdict::Unknown {
            self.unknown_fact(table, "byId", &[row.field("id")?.clone()], "provisional read authority");
        }
        Ok(verdict == Verdict::Readable)
    }

    pub(super) fn witness_covered(&self, table: &str, index: &str, key: &[Value], row: &Value) -> Result<bool, RuntimeError> {
        // Own pending writes are facts in the combined state, even in a Left
        // group. Settlement removes their dependents if the server refuses.
        Ok(!self.device || self.is_provisional(table, row)? ||
            (self.schema.tables[table].sync.is_some() && !self.tx.retained_row(table, row)? && !self.tx.retained_group(table, index, key)?))
    }

    pub(super) fn authorization_absence_covered(&mut self, allowance: &Authorization, table: &str, index: &str, key: &[Value]) -> Result<bool, RuntimeError> {
        let definition = &self.schema.tables[table];
        let Some(sync) = &definition.sync else { return Ok(false) };
        if sync.horizon.is_some() || self.tx.retained_group(table, index, key)? { return Ok(false); }
        let pinned: std::collections::BTreeMap<_, _> = definition.index(index).expect("validated index").columns().into_iter().zip(key).collect();
        match &sync.audience {
            Audience::Public => Ok(true),
            Audience::Column(column) => Ok(pinned.get(column).is_some_and(|value| value.as_str() == Ok(self.context.viewer.as_str()))),
            Audience::Target { table: target, prefix, .. } => {
                let Some(mut group) = prefix.iter().map(|column| pinned.get(column).map(|value| (*value).clone())).collect::<Option<Vec<_>>>() else { return Ok(false) };
                let binding = crate::schema::audience_binding(self.schema, table, definition, sync).map_err(RuntimeError::Schema)?;
                group.push(Value::Id(self.context.viewer.clone()));
                let target_def = &self.schema.tables[target];
                self.read_tables.insert(target.clone());
                // This is a raw audience membership, not the witness's ACL.
                let found = self.live_lookup(allowance, target, &binding.group_index, target_def.index(&binding.group_index).expect("audience index"), &group)?;
                found.map(|row| self.witness_covered(target, &binding.group_index, &group, &row)).transpose().map(|known| known.unwrap_or(false))
            }
        }
    }
}

struct ReadProbe<'a, 'b> { runner: &'a mut Runner<'b>, allowance: &'a Authorization, table: &'a str, provisional: bool, prepaid: bool, unknown: bool }
impl Probe for ReadProbe<'_, '_> {
    fn take_unknown(&mut self) -> bool { std::mem::take(&mut self.unknown) }
    fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { std::mem::replace(&mut self.runner.next_expiry, expiry) }
    fn field(&mut self, field: &str, _old: bool) {
        self.runner.provisional_sequence_read |= self.provisional && self.runner.schema.tables[self.table].sequences.contains_key(field);
    }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        if !self.prepaid && !self.runner.read_charge(MeterKind::RuleProbes, 1)? { return Ok(false); }
        let (present, known) = self.runner.probe_witness(self.allowance, table, index, key, equalities, true)?;
        self.unknown |= !known;
        Ok(present)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool { self.runner.created(table, index, key) }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, meter::{Ceilings, Cut, Meter}, rows::{MemoryRows, Rows}, value::object};

    #[test]
    fn provisional_authorization_scopes_expiry_to_succeeded_predicates() {
        let witness = "exists grants[parent = .parent, who = viewer, kind = 'admin']";
        for kind in ["guest", "admin"] {
            for rule in [format!("{witness} or .owner = viewer"), format!("({witness} and .owner != viewer) or .owner = viewer"), witness.into()] {
                let source = format!("table grants:\n  parent: text <=10\n  who: principal\n  kind: text <=10\n  until: time ?\n  expire at .until\n  unique parent, who\n  public\n  sync public\ntable notes:\n  parent: text <=10\n  owner: principal\n  read <- {rule}\n  online only\n");
                let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
                assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                let schema: crate::schema::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
                for until in [2000, 3000] {
                    let rows = MemoryRows::default();
                    let grant = object([("id", Value::Id("g".into())), ("parent", Value::String("p".into())), ("who", Value::Id("alice".into())), ("kind", Value::String(kind.into())), ("until", Value::Int(until))]);
                    rows.put("grants", &schema.tables["grants"], &grant, None).unwrap();
                    let candidate = object([("id", Value::Id("own".into())), ("parent", Value::String("p".into())), ("owner", Value::Id("alice".into()))]);
                    let mut runner = Runner::new(&rows, &schema, Context::new("alice", Default::default()).at(1000), Meter::new(Ceilings::default(), Cut::Cap), 0);
                    runner.device = true;
                    runner.provisional_rows.insert(("notes".into(), "own".into()));
                    runner.next_expiry = Some(9000); // A separate earlier read's dependency survives.
                    assert_eq!(runner.authorize_read("notes", &candidate, false).unwrap(), rule != witness || kind == "admin");
                    assert_eq!(runner.next_expiry, Some(if rule == witness && kind == "admin" { until } else { 9000 }), "{kind}/{rule}");
                }
            }
        }
    }
    #[test]
    fn provisional_authority_uses_complete_existential_and_correlated_timelines() {
        let a = "exists grants[parent = .parent, who = viewer]";
        for rule in [a.to_string(), format!("{a} or not {a}"), format!("not ({a} and not {a})"), format!("({a} and not {a}) or .owner = viewer")] {
            for permanent in [false, true] {
                let source = format!("table grants:\n  parent: text <=10\n  who: principal\n  until: time ?\n  expire at .until\n  by byParentWho: parent, who\n  public\n  sync public\ntable notes:\n  parent: text <=10\n  owner: principal\n  read <- {rule}\n  online only\n");
                let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
                assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                let schema: crate::schema::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
                for early in [2000, 3000] {
                    let rows = MemoryRows::default();
                    for (id, until) in [("early", Value::Int(early)), ("later", if permanent { Value::Null } else { Value::Int(8000) })] {
                        rows.put("grants", &schema.tables["grants"], &object([("id", Value::Id(id.into())), ("parent", Value::String("p".into())), ("who", Value::Id("alice".into())), ("until", until)]), None).unwrap();
                    }
                    let candidate = object([("id", Value::Id("own".into())), ("parent", Value::String("p".into())), ("owner", Value::Id("alice".into()))]);
                    for now in [1000, 2000, 3000, 8000] {
                        let mut runner = Runner::new(&rows, &schema, Context::new("alice", Default::default()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
                        runner.device = true;
                        runner.provisional_rows.insert(("notes".into(), "own".into()));
                        runner.next_expiry = Some(9000);
                        assert_eq!(runner.authorize_read("notes", &candidate, false).unwrap(), rule != a || permanent || now < 8000);
                        assert_eq!(runner.next_expiry, Some(if rule == a && !permanent && now < 8000 { 8000 } else { 9000 }), "{rule}/{now}/{permanent}");
                    }
                }
            }
        }
    }

    #[test]
    fn witness_answer_cache_is_invalidated_by_every_row_write() {
        let source = "table grants:\n  parent: text <=10\n  who: principal\n  unique parent, who\n  public\n  sync public\ntable notes:\n  parent: text <=10\n  read <- exists grants[.parent, viewer]\n  online only\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: crate::schema::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
        let rows = MemoryRows::default();
        let note = object([("id", Value::Id("note".into())), ("parent", Value::String("p".into()))]);
        let grant = object([("id", Value::Id("g".into())), ("parent", Value::String("p".into())), ("who", Value::Id("alice".into()))]);
        let mut runner = Runner::new(&rows, &schema, Context::new("alice", Default::default()).at(1000), Meter::new(Ceilings::default(), Cut::Abort), 0);
        assert!(!runner.authorize_read("notes", &note, false).unwrap());
        runner.tx.put("grants", &schema.tables["grants"], &grant, None).unwrap();
        assert!(runner.authorize_read("notes", &note, false).unwrap());
        runner.tx.delete("grants", &schema.tables["grants"], &grant).unwrap();
        assert!(!runner.authorize_read("notes", &note, false).unwrap());
    }

}

#[cfg(all(test, feature="sqlite"))]
mod row_view_tests {
    use super::*;
    use crate::{Context, Schema, meter::{Ceilings,Cut,Meter}, rows::{MemoryRows,Rows}, value::object};
    #[test]
    fn provisional_row_view_witness_uses_complete_rule_deadline() {
        let witness="exists unread[member = .member]";
        for rule in [format!("{witness} or viewer = 'alice'"),format!("{witness} or not {witness}"),format!("{witness} or exists unread[member = .backup]"),witness.into()] {
            let source=include_str!("../../../snapback4-lang/tests/fixtures/row-keyed-view.q").replace("  joinedAt: int default 0","  joinedAt: int default 0\n  deadline: time ?\n  expire at .deadline")
                + &format!("\ntable gates:\n  member: members\n  backup: members\n  read <- {rule}\n  online only\n");
            let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
            assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
            let schema:Schema=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
            for until in [1001,1100] {
                let rows=MemoryRows::default();
                for (id,expiry) in [("b",until),("c",1200)] {
                    let member=object([("id",Value::Id(id.into())),("conversationId",Value::Id("chat".into())),("principal",Value::Id(id.into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0)),("deadline",Value::Int(expiry))]);
                    rows.put("members",&schema.tables["members"],&member,None).unwrap();
                    let view=object([("id",Value::Id(id.into())),("member",Value::Id(id.into())),("value",Value::Int(0)),("recountPending",Value::Bool(false))]);
                    rows.put("unread",&schema.tables["unread"],&view,None).unwrap();
                }
                let gate=object([("id",Value::Id("gate".into())),("member",Value::Id("b".into())),("backup",Value::Id("c".into()))]);
                let mut runner=Runner::new(&rows,&schema,Context::new("alice",Default::default()).at(1000),Meter::new(Ceilings::default(),Cut::Cap),0);
                runner.device=true;
                runner.provisional_rows.insert(("gates".into(),"gate".into()));
                runner.next_expiry=Some(9000);
                assert!(runner.authorize_read("gates",&gate,false).unwrap());
                assert_eq!(runner.next_expiry,Some(if rule==witness {until} else if rule.contains(".backup") {1200} else {9000}),"{rule}");
            }
        }
    }
}
