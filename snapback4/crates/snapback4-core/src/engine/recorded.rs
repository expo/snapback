//! Historical reference attribution. Capture belongs to insertion/activation;
//! every contribution evaluator continues to read the source row image.
// @ref LLP 3000.007.003#3.2 — captures survive target deletion and generation rebuilds.
use super::runner::Runner;
use crate::{error::{MeterKind, RuntimeError}, schema::Table, value::Value};

pub(crate) fn refuse_fields(table: &Table, name: &str, row: &Value) -> Result<(), RuntimeError> {
    if let Some(field) = row.as_object()?.keys().find(|field| crate::schema::timeline::is_slot(field)) {
        return Err(RuntimeError::Structural { code: "E_TIMELINE_OWNED", message: format!("{name}.{field} is an engine event slot; omit it and write the post or repost's application fields (guide feeds)") });
    }
    if let Some(field) = row.as_object()?.keys().find(|field| table.engine_field(field)) {
        return Err(RuntimeError::Structural { code: "E_RECORDED_FIELD", message: format!("{name}.{field} is engine-recorded; omit it from the write payload (guide maintains)") });
    }
    if let Some(field) = row.as_object()?.keys().find(|field| table.maintained.contains_key(*field)) {
        return Err(RuntimeError::Structural { code: "E_MAINTAINED_COLUMN", message: format!("{name}.{field} is engine-maintained; omit it and write the source rows (guide maintains)") });
    }
    Ok(())
}

pub(crate) fn public_image(table: &Table, mut row: Value) -> Value {
    if table.ephemeral.is_none() && table.recorded.is_empty() && table.through.is_none() && !table.columns.keys().any(|f| crate::schema::timeline::is_slot(f)) { return row; }
    if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.retain(|field, _| !table.engine_field(field) && !crate::schema::timeline::is_slot(field)); }
    row
}

impl Runner<'_> {
    pub(super) fn refuse_recorded(&self, table: &str, row: &Value) -> Result<(), RuntimeError> {
        let definition = self.schema.table(table).ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        refuse_fields(definition, table, row)
    }

    pub(crate) fn capture_recorded(&mut self, table: &Table, mut row: Value, paths: &[String]) -> Result<Value, RuntimeError> {
        if paths.is_empty() { return Ok(row); }
        row.as_object()?;
        // A source image can share its map with a literal or stored image;
        // stamping fields may copy it. Account for that copy and each read.
        self.meter.heap(super::write_target::row_copy_ceiling(table))?;
        let source_image = crate::schema::row_image(&row, table).into_owned();
        self.meter.heap(super::write_target::row_copy_ceiling(table))?;
        for path in paths {
            let field = &table.recorded[path];
            let target = &self.schema.tables[&field.table];
            // Even a null reference has the same declared point-read charge.
            self.meter.charge(MeterKind::Examined, 1)?;
            self.read_tables.insert(field.table.clone());
            let found = match source_image.field(&field.reference) {
                Ok(Value::Id(id)) => {
                    #[cfg(feature = "sqlite")]
                    let imported = self.import_targets.and_then(|rows| rows.get(&(field.table.clone(), id.clone()))).cloned();
                    #[cfg(not(feature = "sqlite"))]
                    let imported: Option<Value> = None;
                    match imported { Some(row) => Some(row), None => self.lookup_stored(&field.table, "byId", target.index("byId").expect("id index"), &[Value::Id(id.clone())], false)? }
                },
                _ => None,
            };
            let live = found.as_ref().filter(|value| !self.expired(target, value));
            if self.device && matches!(source_image.field(&field.reference), Ok(Value::Id(_)))
                && (target.sync.is_none() || !live.zip(self.context.now).map(|(value, now)| {
                    self.device_work(|runner| runner.authorized_scratch(0,&[],|runner,scope| runner.tx.recording_covered(&field.table, value, &runner.context.viewer, now, scope, &mut runner.meter)))
                }).transpose()?.unwrap_or(false)) {
                return Err(RuntimeError::Prediction(format!("recorded path {path} needs a live, covered {} row; reconnect to resolve attribution", field.table)));
            }
            // Unknown coverage queues before a target-size resource refusal.
            // @ref LLP 3000.015#1 — a public capture cannot price a private sibling.
            if found.is_some() {
                self.meter.heap(super::write_target::row_copy_ceiling(target))?;
            }
            let value = live.map(|value| self.disclosed_row(target,value.clone()).into_value().field(&field.column).cloned()).transpose()?.unwrap_or(Value::Null);
            self.meter.heap(80 + path.len() as u64 + super::write_target::column_copy_ceiling(&target.columns[&field.column]))?;
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert(path.clone(), value); }
        }
        Ok(row)
    }

    pub(super) fn record_insert(&mut self, name: &str, row: Value) -> Result<Value, RuntimeError> {
        if self.schema.tables[name].recorded.is_empty() { return Ok(row); }
        let table = &self.schema.tables[name];
        let paths = table.recorded.keys().cloned().collect::<Vec<_>>();
        self.capture_recorded(table, row, &paths)
    }
}

#[cfg(feature = "sqlite")]
pub(super) fn table_paths_changed(next: Option<&Table>, old: Option<&Table>) -> bool {
    next.into_iter().flat_map(|t| &t.recorded).ne(old.into_iter().flat_map(|t| &t.recorded))
}

#[cfg(feature = "sqlite")]
pub(super) fn paths_changed(schema: &crate::schema::Schema, previous: Option<&crate::schema::Schema>) -> bool {
    schema.tables.keys().chain(previous.into_iter().flat_map(|s| s.tables.keys()))
        .any(|name| table_paths_changed(schema.table(name), previous.and_then(|s| s.table(name))))
}

#[cfg(feature = "sqlite")]
impl Runner<'_> {
    pub(super) fn rebuild_recorded_activation(&mut self, previous: Option<&crate::schema::Schema>, maintains: &[&crate::schema::Maintain], report: &mut crate::store::adoption_report::AdoptionReport) -> Result<(), RuntimeError> {
        let saved = self.event_free;
        self.event_free = true;
        let result = (|| {
            for maintain in maintains {
                if table_paths_changed(self.schema.table(&maintain.source), previous.and_then(|s| s.table(&maintain.source))) { self.rebuild_maintain_reported(maintain, report)?; }
            }
            Ok(())
        })();
        self.event_free = saved;
        result
    }

    /// Run after schema projection and before any aggregate rebuild. Only paths
    /// absent from the predecessor are captured; existing nulls are history too.
    pub(super) fn capture_activation(&mut self, previous: Option<&crate::schema::Schema>, mut report: Option<&mut crate::store::adoption_report::AdoptionReport>) -> Result<(), RuntimeError> {
        use crate::rows::{Bounds, Dir};
        if self.device { return Err(RuntimeError::Prediction("recorded activation requires the server's replacement snapshot".into())); }
        for (name, table) in &self.schema.tables.clone() {
            let paths: Vec<_> = table.recorded.keys().filter(|path| previous.and_then(|s| s.table(name)).is_none_or(|old| !old.recorded.contains_key(*path))).cloned().collect();
            if paths.is_empty() { continue; }
            let started = std::time::Instant::now();
            // @ref LLP 3000.019#3.6 — capture changes only these fields; keep unrelated physical keys.
            // Projection already installed the candidate's defaults/indexes.
            // Persist every historical capture, including null, but generate
            // old/new keys only for indexes depending on a newly stamped path.
            let mut captured_table = table.clone();
            captured_table.indexes.retain(|_, index| paths.iter().any(|path| index.uses_column(path)));
            let mut bounds = Bounds::default();
            loop {
                let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, name, "byId", &[], &bounds, Dir::Asc, 256))?;
                if page.is_empty() { break; }
                for (old, key) in page {
                    bounds.after = crate::key::decode(&key);
                    let row = self.capture_recorded(table, old.clone(), &paths)?;
                    super::validate::validate_row(self.schema, name, &crate::schema::row_image(&row, table))?;
                    let entries = self.tx.put(name, &captured_table, &row, Some(&old))?;
                    self.meter.charge(MeterKind::IndexEntries, entries)?;
                }
            }
            if let Some(report) = report.as_deref_mut() { report.detail(format!("capture {name}: {}", paths.join(", ")), started); }
        }
        Ok(())
    }
}

#[cfg(feature = "sqlite")]
#[derive(Default)]
pub struct RecordedNulls {
    /// Physical null captures by source table and path, including excluded rows.
    pub captures: std::collections::BTreeMap<String, std::collections::BTreeMap<String, u64>>,
    /// Live selected contributions with at least one null recorded dependency.
    pub contributions: std::collections::BTreeMap<String, u64>,
}

#[cfg(feature = "sqlite")]
impl super::Engine {
    /// Capture history and current null-attributed contributions are distinct:
    /// a predicate may exclude a captured null, and a source may have expired.
    pub fn recorded_nulls(&mut self) -> Result<RecordedNulls, RuntimeError> {
        use crate::rows::{Bounds, Dir};
        let tx = self.store.read_transaction()?;
        let now = crate::now_ms();
        let mut counts = RecordedNulls::default();
        for (name, source) in self.schema.tables.iter().filter(|(_, table)| !table.recorded.is_empty()) {
            let mut paths: std::collections::BTreeMap<_, u64> = source.recorded.keys().cloned().map(|path| (path, 0)).collect();
            let maintains: Vec<_> = self.schema.maintains.iter().filter(|m| &m.source == name).filter_map(|maintain| {
                let dependencies: Vec<_> = maintain.dependencies().into_iter().filter(|path| source.recorded.contains_key(path)).collect();
                if dependencies.is_empty() { None } else { Some((maintain, dependencies)) }
            }).collect();
            for (maintain, _) in &maintains { counts.contributions.insert(maintain.label(), 0); }
            let mut bounds = Bounds::default();
            loop {
                let rows = tx.scan(name, "byId", &[], &bounds, Dir::Asc, 256)?;
                if rows.is_empty() { break; }
                for (row, key) in rows {
                    bounds.after = crate::key::decode(&key);
                    let row = crate::schema::row_image(&row, source);
                    let null = |path: &str| matches!(row.field(path), Ok(Value::Null) | Err(_));
                    for (path, count) in &mut paths { if null(path) { *count += 1; } }
                    if source.expired(&row, now) { continue; }
                    for (maintain, dependencies) in &maintains {
                        if maintain.selected(&row) && dependencies.iter().any(|path| null(path)) {
                            *counts.contributions.get_mut(&maintain.label()).expect("initialized maintain") += 1;
                        }
                    }
                }
            }
            counts.captures.insert(name.clone(), paths);
        }
        tx.rollback()?;
        Ok(counts)
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{engine::Context, meter::{Meter, Ceilings, Cut}, schema::Schema, store::Store, value::object};
    fn schema() -> Schema {
        let b = snapback4_lang::compile(&[("recorded.q".into(), include_str!("../../../snapback4-lang/tests/fixtures/recorded-attribution.q").into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap()
    }
    #[test]
    fn hidden_replacement_does_not_disclose_a_stored_capture() {
        let schema = schema();
        let mut store = Store::memory().unwrap();
        store.activate(&schema, None, false, |_,_| Ok(())).unwrap();
        let tx = store.transaction().unwrap();
        let mut runner = Runner::new(&tx, &schema, Context::system(), Meter::new(Ceilings::unbounded(), Cut::Abort), 1);
        let row = object([("id", Value::Id("l".into())), ("postId",Value::Id("p".into())), ("principal",Value::Id("alice".into())), ("at",Value::Int(100)), ("postId.authorId",Value::Id("alice".into()))]);
        let mut replacement = row.clone();
        tx.put("likes",&schema.tables["likes"],&row,None).unwrap();
        let stored=tx.get("likes","l").unwrap().unwrap();
        match &mut replacement {Value::Row(fields) | Value::Map(fields) => {assert!(fields.remove("postId.authorId").is_some());}, _ => panic!("object")};
        let err = runner.replace_authorized("likes",row,replacement,false,&object([] as [(&str,Value);0]),0).unwrap_err();
        assert_eq!(err.refusal().code,"NOT_FOUND");
        for hidden in ["capture","alice","postId.authorId"] {assert!(!err.to_string().contains(hidden));}
        assert_eq!(tx.get("likes","l").unwrap(),Some(stored));
    }
    #[test]
    fn device_runner_refuses_capture_activation() {
        let schema = schema();
        let mut store = Store::memory().unwrap();
        store.activate(&schema, None, false, |_,_| Ok(())).unwrap();
        let tx = store.transaction().unwrap();
        let mut runner = Runner::new(&tx, &schema, Context::system(), Meter::new(Ceilings::unbounded(), Cut::Abort), 1);
        runner.device = true;
        assert_eq!(runner.capture_activation(None, None).unwrap_err().refusal().code,"E_PREDICT");
        assert!(tx.scan("likes","byId",&[],&Default::default(),crate::rows::Dir::Asc,10).unwrap().is_empty());
    }
    #[test]
    fn event_free_scope_restores_after_success_and_failure() {
        let schema = schema();
        let mut store = Store::memory().unwrap();
        store.activate(&schema, None, false, |_,_| Ok(())).unwrap();
        let tx = store.transaction().unwrap();
        let row=object([("id",Value::Id("l".into())),("postId",Value::Id("p".into())),("principal",Value::Id("alice".into())),("at",Value::Int(100)),("until",Value::Null),("note",Value::String("".into())),("postId.authorId",Value::Id("alice".into())),("postId.at",Value::Int(100)),("postId.parentId",Value::Null)]);
        tx.put("likes",&schema.tables["likes"],&row,None).unwrap();
        let maintains = schema.maintains.iter().collect::<Vec<_>>();
        let mut runner = Runner::new(&tx,&schema,Context::system(),Meter::new(Ceilings::unbounded(),Cut::Abort),1);
        runner.rebuild_recorded_activation(None,&maintains, &mut Default::default()).unwrap();
        assert!(!runner.event_free);
        assert!(runner.rows_written>0);
        assert!(runner.events.is_empty(),"populated activation rebuild emits no events");
        assert!(!tx.scan("receivedLikes","byId",&[],&Default::default(),crate::rows::Dir::Asc,10).unwrap().is_empty());
        for saved in [false,true] {
            runner.event_free=saved;
            runner.meter=Meter::new(Ceilings {heap_bytes:0,..Ceilings::unbounded()},Cut::Abort);
            assert!(runner.rebuild_recorded_activation(None,&maintains, &mut Default::default()).is_err());
            assert_eq!(runner.event_free,saved);
        }
    }

    struct Target { row: Value, covered: bool, calls: std::cell::Cell<usize> }
    impl crate::rows::Rows for Target {
        fn recording_covered(&self, _: &str, _: &Value, _: &str, _: i64, _scope: &crate::engine::Authorization, _: &mut crate::engine::InternalMeter<'_>) -> Result<bool,RuntimeError> {self.calls.set(self.calls.get()+1);Ok(self.covered)}
        fn get(&self, _: &str, _: &str) -> Result<Option<Value>,RuntimeError> {Ok(Some(self.row.clone()))}
        fn lookup(&self, _: &str, _: &str, _: &crate::schema::Index, _: &[Value]) -> Result<Option<Value>,RuntimeError> {unreachable!()}
        fn scan(&self, _: &str, _: &str, _: &[Value], bounds: &crate::rows::Bounds, _: crate::rows::Dir, _: usize) -> Result<Vec<(Value,Vec<u8>)>,RuntimeError> {
            Ok(if bounds.after.is_some() { vec![] } else { vec![(self.row.clone(),crate::key::encode(&[self.row.field("id")?.clone()]))] })
        }
        fn count_prefix(&self, _: &str, _: &str, _: &[Value], _: u64) -> Result<u64,RuntimeError> {unreachable!()}
        fn put(&self, _: &str, _: &Table, _: &Value, _: Option<&Value>) -> Result<u64,RuntimeError> {unreachable!()}
        fn delete(&self, _: &str, _: &Table, _: &Value) -> Result<u64,RuntimeError> {unreachable!()}
    }
    #[test]
    fn prediction_requires_a_clock_and_prices_covered_targets() {
        let mut schema=schema();
        schema.tables.get_mut("posts").unwrap().columns.insert("body".into(),crate::schema::ColumnType::Text {max:100000});
        let source=object([("id",Value::Id("l".into())),("postId",Value::Id("p".into()))]);
        let target=Target {row:object([("id",Value::Id("p".into())),("authorId",Value::Id("alice".into())),("until",Value::Int(100)),("body",Value::String("x".repeat(100000)))]),covered:true,calls:std::cell::Cell::new(0)};
        let capture=|rows: &Target, now, heap_bytes| {
            let mut context=Context::system();context.now=now;
            let mut runner=Runner::new(rows,&schema,context,Meter::new(Ceilings{heap_bytes,..Ceilings::unbounded()},Cut::Abort),0);
            runner.device=true;
            runner.capture_recorded(&schema.tables["likes"],source.clone(),&["postId.authorId".into()])
        };
        assert_eq!(capture(&target,None,u64::MAX).unwrap_err().code(),"E_PREDICT");
        assert_eq!(target.calls.get(),0,"a missing clock cannot query coverage at epoch zero");
        let captured=capture(&target,Some(99),u64::MAX).unwrap();
        assert_eq!(captured.field("postId.authorId").unwrap(),&Value::Id("alice".into()));
        assert_eq!(capture(&target,Some(100),u64::MAX).unwrap_err().code(),"E_PREDICT");
        assert_eq!(capture(&target,Some(99),32768).unwrap_err().code(),"E_BOUND");
        let uncovered=Target{covered:false,..target};
        assert_eq!(capture(&uncovered,Some(99),32768).unwrap_err().code(),"E_PREDICT");
    }

}
