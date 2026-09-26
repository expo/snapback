//! Server-only asset cells: optional/list wrappers preserve one column home.
// @ref LLP 3000#7-decisions-during-execution — lists reconcile asset identities, never positions; ledger work is prepaid by declaration.
use super::runner::Runner;
use crate::assets::{AssetKind, asset_id};
use crate::error::{MeterKind, RuntimeError};
use crate::schema::{ColumnType, Table};
use crate::value::Value;
use std::collections::BTreeMap;

pub(super) fn leaf(kind: &ColumnType) -> &ColumnType {
    match kind {
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => leaf(inner),
        other => other,
    }
}

fn slots(kind: &ColumnType, in_list: bool) -> u64 {
    match kind {
        ColumnType::Optional(inner) => slots(inner, in_list),
        ColumnType::List { of, max } => slots(of, true).saturating_mul(u64::from(*max)),
        ColumnType::Image { .. } | ColumnType::Video { .. } if in_list => 1,
        _ => 0,
    }
}

pub(super) fn contains(kind: &ColumnType, value: Option<&Value>, id: &str) -> bool {
    match (kind, value) {
        (ColumnType::Optional(inner), value) => contains(inner, value, id),
        (ColumnType::List { of, .. }, Some(Value::Array(values))) => values.iter().any(|v| contains(of, Some(v), id)),
        (ColumnType::Image { .. } | ColumnType::Video { .. }, value) => asset_id(value) == Some(id),
        _ => false,
    }
}

fn values<'a>(kind: &ColumnType, value: Option<&'a Value>, out: &mut BTreeMap<&'a str, &'a Value>) {
    match (kind, value) {
        (ColumnType::Optional(inner), value) => values(inner, value, out),
        (ColumnType::List { of, .. }, Some(Value::Array(items))) => {
            for item in items { values(of, Some(item), out); }
        }
        (ColumnType::Image { .. } | ColumnType::Video { .. }, Some(value)) => {
            if let Some(id) = asset_id(Some(value)) { out.insert(id, value); }
        }
        _ => {}
    }
}

impl Runner<'_> {
    /// Reserve each declared list slot, even for empty/null/unchanged cells.
    /// Scalar accounting stays unchanged; no hidden list length selects a charge.
    pub(super) fn reserve_assets(&mut self, table: &Table) -> Result<u64, RuntimeError> {
        if !self.tx.holds_assets() { return Ok(0); }
        let count = table.columns.values().map(|kind| slots(kind, false)).fold(0_u64, u64::saturating_add);
        // Fact lookup, system-placeholder lookup, claim lookup and GC lookup;
        // release plus claim writes. Facts, two identity maps and list copies
        // fit the existing 16 KiB asset decode allowance per slot.
        let heap = count.saturating_mul(16_384);
        // Scratch admission must not leave an unallocated, over-ceiling heap
        // charge in a refused target's receipt (LLP 3000.015 §1).
        if !self.meter.room(MeterKind::HeapBytes, heap) {
            return Err(RuntimeError::Bound { kind: MeterKind::HeapBytes,
                actual: self.meter.used.heap_bytes.saturating_add(heap),
                ceiling: self.meter.ceilings.heap_bytes, site: self.meter.site().into() });
        }
        for (kind, amount) in [(MeterKind::Steps, count.saturating_mul(8)),
            (MeterKind::Examined, count.saturating_mul(4)),
            (MeterKind::RowsWritten, count.saturating_mul(2)),
            (MeterKind::HeapBytes, heap)] { self.meter.charge(kind, amount)?; }
        Ok(heap)
    }

    pub(super) fn with_asset_facts(&mut self, table_name: &str, row: Value, old: Option<&Value>, hidden_patch: Option<&Value>) -> Result<Value, RuntimeError> {
        if !self.tx.holds_assets() { return Ok(row); }
        let table = &self.schema.tables[table_name];
        if !table.columns.values().any(ColumnType::contains_asset) { return Ok(row); }
        let mut fields = row.as_object()?.clone();
        for (column, kind) in table.columns.iter().filter(|(_, kind)| kind.contains_asset()) {
            let Some(value) = fields.get(column) else { continue };
            // @ref LLP 3000.007#17 — explicit hidden assignments prove ownership even if the id was already in this cell.
            let explicit = hidden_patch.is_some_and(|patch| patch.as_object().is_ok_and(|fields| fields.contains_key(column)));
            let mut before = BTreeMap::new();
            if !explicit { values(kind, old.and_then(|row| row.field(column).ok()), &mut before); }
            fields.insert(column.clone(), self.asset_facts(table_name, column, kind, value, &before)?);
        }
        Ok(Value::Row(fields.into()))
    }

    fn asset_facts(&self, table: &str, column: &str, kind: &ColumnType, value: &Value, before: &BTreeMap<&str, &Value>) -> Result<Value, RuntimeError> {
        let (wanted, max) = match kind {
            ColumnType::Optional(inner) if *value != Value::Null => return self.asset_facts(table, column, inner, value, before),
            ColumnType::List { of, max } => {
                if let Value::Array(items) = value {
                    // Refuse oversized lists before allocating or touching the ledger.
                    if items.len() > *max as usize { return Err(RuntimeError::Input(format!("{table}.{column} takes at most {max} items"))); }
                    return items.iter().map(|v| self.asset_facts(table, column, of, v, before)).collect::<Result<Vec<_>, _>>().map(Value::Array);
                }
                return Ok(value.clone()); // ordinary row validation diagnoses the shape
            }
            ColumnType::Image { max, .. } => (AssetKind::Image, *max),
            ColumnType::Video { max } => (AssetKind::Video, *max),
            _ => return Ok(value.clone()),
        };
        let Some(id) = asset_id(Some(value)) else { return Ok(value.clone()) };
        if let Some(retained) = before.get(id) { return Ok((*retained).clone()); }
        let unknown = || RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: format!("{table}.{column} names an upload {id} that is not yours or does not exist; upload the bytes first (POST /assets) and place the id it returns") };
        let Some(asset) = self.tx.asset(id)? else {
            if self.context.is_system() {
                let mut map = value.as_object()?.clone();
                for fact in crate::assets::FACTS { map.entry(fact.to_owned()).or_insert(Value::Null); }
                return Ok(Value::Map(map.into()));
            }
            return Err(unknown());
        };
        if asset.owner != self.context.viewer && !self.context.is_system() { return Err(unknown()); }
        if asset.kind != wanted {
            return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("{table}.{column} takes {} and {id} is {}", wanted.word(), asset.kind.word()) });
        }
        if asset.bytes > u64::from(max) {
            return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("{table}.{column} takes at most {max} bytes; {id} is {}", asset.bytes) });
        }
        Ok(asset.column_value())
    }

    pub(super) fn place_assets(&mut self, table_name: &str, table: &Table, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        if !self.tx.holds_assets() { return Ok(()); }
        // System expiry/removal can reach this without a write-target attempt.
        let heap = if self.assets_prepaid { 0 } else { self.reserve_assets(table)? };
        let result = (|| {
            let now = self.context.now.unwrap_or(0);
            let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?;
            let mut claims = Vec::new();
            for (column, kind) in table.columns.iter().filter(|(_, kind)| kind.contains_asset()) {
                let mut before = BTreeMap::new();
                let mut after = BTreeMap::new();
                values(kind, old.and_then(|row| row.field(column).ok()), &mut before);
                values(kind, new.and_then(|row| row.field(column).ok()), &mut after);
                for released in before.keys().filter(|id| !after.contains_key(*id)) {
                    self.tx.release_asset(released, table_name, id, column, now)?;
                }
                for claimed in after.keys().filter(|id| !before.contains_key(*id)) {
                    claims.push((*claimed, column));
                }
            }
            // Release every removed cell home first, so same-row moves work
            // in either column order. The home check still fences every release.
            for (claimed, column) in claims {
                if self.context.is_system() && self.tx.asset(claimed)?.is_none() { continue; }
                self.tx.claim_asset(claimed, &self.context.viewer, table_name, id, column)?;
            }
            Ok(())
        })();
        self.meter.used.heap_bytes = self.meter.used.heap_bytes.saturating_sub(heap);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Context, Store};
    use crate::assets::Asset;
    use crate::meter::{Ceilings, Cut, Meter, Metered};

    fn fixture(kind: &str) -> (Store, crate::schema::Schema) {
        let bound = snapback4_lang::compile(&[("test.q".into(),format!("use server\ntable posts:\n  photos: {kind}\n  read <- allow\n  insert <- allow\n"))]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let store = Store::memory().unwrap();
        for id in ["a","b","c","d"] {
            store.record_asset(&Asset {id:id.into(),owner:"alice".into(),kind:AssetKind::Image,content_type:"image/png".into(),bytes:24,width:Some(1),height:Some(1),duration:None,created_at:0,home:None,released_at:None}).unwrap();
        }
        (store,serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap())
    }
    fn row(n: usize, scalar: bool) -> Value {
        let values = ["a","b","c","d"].iter().take(n).map(|id| Value::Map(BTreeMap::from([("id".into(),Value::Id((*id).into()))]).into())).collect::<Vec<_>>();
        Value::Row(BTreeMap::from([("id".into(),Value::Id("post".into())),("photos".into(),if scalar {values[0].clone()} else {Value::Array(values)})]).into())
    }
    fn price(n: usize, scalar: bool, remove: bool) -> Metered {
        let (mut store,schema) = fixture(if scalar {"image <=1000"} else {"[image <=1000] <=4"});
        let tx = store.transaction().unwrap();
        let mut runner = Runner::new(&tx,&schema,Context::new("alice",BTreeMap::new()),Meter::new(Ceilings::unbounded(),Cut::Abort),0);
        let row = row(n,scalar);
        runner.reserve_columns("posts").unwrap();
        let reserved = runner.meter.used;
        let row = runner.with_asset_facts("posts",row,None,None).unwrap();
        runner.place_assets("posts",&schema.tables["posts"],None,Some(&row)).unwrap();
        if remove { runner.place_assets("posts",&schema.tables["posts"],Some(&row),None).unwrap(); }
        assert_eq!(runner.meter.used,reserved,"the physical work uses its declaration reservation");
        reserved
    }
    #[test]
    fn list_placement_and_release_meter_are_fixed_by_cap() {
        let scalar = price(1,true,false);
        let one = price(1,false,false);
        assert_eq!(one,price(4,false,false));
        assert_eq!(one,price(0,false,false));
        assert_eq!(one,price(1,false,true));
        assert_eq!(one,price(4,false,true));
        assert_eq!(scalar,Metered::default(),"no added scalar reservation");
        assert_eq!(scalar,price(1,true,true));
        assert_eq!(one.examined,4*4);
        assert_eq!(one.rows_written,2*4);
        assert_eq!(one.steps,8*4);
        assert_eq!(one.heap_bytes,16_384*4);
    }
    #[test]
    fn release_requires_every_home_component_and_preserves_release_time() {
        let (mut store, _) = fixture("image <=1000");
        let tx = store.transaction().unwrap();
        tx.claim_asset("a", "alice", "posts", "post", "photos").unwrap();
        let home = Some(("posts".into(), "post".into(), "photos".into()));
        for (table, row, column) in [("other", "post", "photos"),
            ("posts", "other", "photos"), ("posts", "post", "other")] {
            tx.release_asset("a", table, row, column, 10).unwrap();
            let asset = tx.asset("a").unwrap().unwrap();
            assert_eq!(asset.home, home, "mismatched {table}/{row}/{column}");
            assert_eq!(asset.released_at, None);
        }
        tx.release_asset("a", "posts", "post", "photos", 20).unwrap();
        tx.release_asset("a", "posts", "post", "photos", 30).unwrap();
        let asset = tx.asset("a").unwrap().unwrap();
        assert_eq!(asset.home, None);
        assert_eq!(asset.released_at, Some(20));
    }
    #[test]
    fn list_reservation_refuses_before_any_claim_at_the_declared_boundary() {
        for (resource, ceiling, actual) in [(MeterKind::Examined,15,16),(MeterKind::HeapBytes,65_535,65_536)] {
          for n in [1,4] {
            let (mut store,schema) = fixture("[image <=1000] <=4");
            let tx = store.transaction().unwrap();
            let mut ceilings = Ceilings::unbounded();
            if resource == MeterKind::Examined { ceilings.examined=ceiling; } else { ceilings.heap_bytes=ceiling; }
            let mut runner = Runner::new(&tx,&schema,Context::new("alice",BTreeMap::new()),Meter::new(ceilings,Cut::Abort),0);
            let result = runner.target_attempt("posts",|r| r.place_assets("posts",&schema.tables["posts"],None,Some(&row(n,false))));
            assert!(matches!(result,Err(RuntimeError::Bound {kind,actual:a,ceiling:c,..}) if kind==resource && a==actual && c==ceiling),"{result:?}");
            assert_eq!(runner.meter.used.heap_bytes,0,"refused scratch was never allocated");
            for id in ["a","b","c","d"] { assert!(tx.asset(id).unwrap().unwrap().home.is_none()); }
          }
        }
    }
}
