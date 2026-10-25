//! The generation barrier checks predecessor audiences before destructive projection.
// @ref LLP 3000.014#7-activation — pinned time, child scan, capture before validation, atomic publication.
use crate::{
    error::RuntimeError,
    rows::{Bounds, Dir, Rows},
    schema::{RuleExpr, Schema, Table, through::PARENT_DEADLINE},
    value::Value,
};
use std::collections::BTreeMap;

const EXPIRY_TABLE_CURSOR: &str = "$expiry-table";

/// Whether a bare read-through changed only because its parent's read rule
/// changed.  The compiler's through identity includes that predicate, so raw
/// identity equality is deliberately too strong here; every field, lifetime,
/// type, default and provenance-bearing table fact must otherwise be equal.
pub(crate) fn predicate_only_capture_change(previous:&Schema,next:&Schema,name:&str)->bool {
    let (Some(mut old_child),Some(new_child))=(previous.table(name).cloned(),next.table(name).cloned()) else{return false};
    let (Some(old_edge),Some(new_edge))=(old_child.through.as_ref(),new_child.through.as_ref()) else{return false};
    if old_edge==new_edge || old_edge.live.is_some() || new_edge.live.is_some() || old_edge.parent!=new_edge.parent {return false}
    let (Some(mut old_parent),Some(new_parent))=(previous.table(&old_edge.parent).cloned(),next.table(&new_edge.parent).cloned()) else{return false};
    old_parent.rules.read=new_parent.rules.read.clone();
    old_child.rules.read=new_child.rules.read.clone();
    if let (Some(old),Some(new))=(old_child.through.as_mut(),new_child.through.as_ref()) {old.identity=new.identity.clone();}
    old_child==new_child && old_parent==new_parent
}

/// Rotate a sweep's table order after the last table that consumed a bounded
/// visit. Per-table row cursors alone can starve every later table when an
/// earlier table contains a permanently restricted due row.
pub(crate) fn resume_expiry_tables(
    mut tables: Vec<String>,
    cursors: &BTreeMap<String, Vec<Value>>,
) -> Vec<String> {
    let after = cursors
        .get(EXPIRY_TABLE_CURSOR)
        .and_then(|cursor| cursor.first())
        .and_then(|value| value.as_str().ok());
    if let Some(index) = after.and_then(|after| tables.iter().position(|table| table == after)) {
        let next = (index + 1) % tables.len().max(1);
        tables.rotate_left(next);
    }
    tables
}

pub(crate) fn mark_expiry_table(cursors: &mut BTreeMap<String, Vec<Value>>, table: &str) {
    cursors.insert(EXPIRY_TABLE_CURSOR.into(), vec![Value::String(table.into())]);
}

/// Only inherited batches need staging. Preserve the streaming path for
/// existing schemas, including large fixture imports.
pub(crate) fn ancestor_order<'a, I>(
    schema: &Schema,
    rows: I,
) -> Box<dyn Iterator<Item = (String, Value)> + 'a>
where
    I: IntoIterator<Item = (String, Value)>,
    I::IntoIter: 'a,
{
    if schema.tables.values().all(|t| t.through.is_none()) {
        return Box::new(rows.into_iter());
    }
    let order = schema.through_order();
    let mut rows: Vec<_> = rows.into_iter().collect();
    rows.sort_by_key(|(name, _)| order.iter().position(|n| n == name).unwrap_or(usize::MAX));
    Box::new(rows.into_iter())
}

fn refusal(name: &str, count: usize, reason: &str, samples: &[String]) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_READ_THROUGH_ADOPT",
        message: format!(
            "{name}: {count} child rows cannot adopt read through: {reason}; sample ids/parent values [{}]; rewrite: reconcile the named audience fields and live parents in a bridge release, then `snapback4 deploy <dir> --restore-dormant` (guide rules)",
            samples.join(", ")
        ),
    }
}

fn sample(samples: &mut Vec<String>, row: &Value, reference: &str, parent: &str) {
    fn bounded(text: &str) -> &str {
        let mut end = text.len().min(256);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        &text[..end]
    }
    if samples.len() < 5 {
        let id = row
            .field("id")
            .ok()
            .and_then(|v| v.as_str().ok())
            .unwrap_or("<missing>");
        let value = row
            .field(reference)
            .ok()
            .and_then(|v| v.as_str().ok())
            .unwrap_or("<missing>");
        samples.push(format!(
            "{}: {reference} -> {parent}[{}]",
            bounded(id),
            bounded(value)
        ));
    }
}

fn live_work(tx:&dyn Rows,name:&str,old:Option<&Table>,next:&Schema)->Result<bool,RuntimeError> {
    Ok(old.and_then(|t|t.through.as_ref()).is_some_and(|t|t.live.is_some())
        || next.table(name).and_then(|t|t.through.as_ref()).is_some_and(|t|t.live.is_some())
        || tx.has_restored_live_authority(name)?)
}

// Both definitions may coexist in a raw source image until projection.
fn parent_bytes(a:Option<&Table>,b:Option<&Table>)->u64 {
    a.into_iter().chain(b).map(crate::rows::disclosed::decode_reservation).fold(0_u64,u64::saturating_add).saturating_mul(4)
}

fn rows(
    tx: &dyn Rows, name: &str, table: &Table, parent_scratch: u64, bounded: bool, destination: Option<&Table>,
    mut visit: impl FnMut(Value) -> Result<(), RuntimeError>,
) -> Result<(), RuntimeError> {
    if !bounded {
        let mut bounds=Bounds::default();
        loop {
            let page=tx.scan(name,"byId",&[],&bounds,Dir::Asc,256)?;
            if page.is_empty() {return Ok(());}
            for (row,key) in page {bounds.after=crate::key::decode(&key);visit(row)?;}
        }
    }
    let decode=crate::rows::disclosed::decode_reservation(table);
    let keys=crate::rows::adoption::index_scratch(name,table).saturating_add(destination.map_or(0,|t|crate::rows::adoption::index_scratch(name,t)));
    let entries=crate::rows::adoption::index_capacity(table).saturating_add(destination.map_or(0,crate::rows::adoption::index_capacity)).saturating_mul(2);
    let scratch=decode.saturating_mul(4).saturating_add(destination.map_or(0,crate::rows::disclosed::decode_reservation).saturating_mul(4)).saturating_add(keys.saturating_mul(2))
        .saturating_add(parent_scratch).saturating_add(8192);
    tx.walk_adoption(name,decode,scratch,[2,table.columns.len() as u64+16,entries],&mut visit)
}

pub(crate) fn correspondence(
    child: &RuleExpr,
    parent: &RuleExpr,
) -> Option<std::collections::BTreeMap<String, String>> {
    if child.is_uniformly_readable() && parent.is_uniformly_readable() {
        return Some(Default::default());
    }
    fn walk(
        a: &serde_json::Value,
        b: &serde_json::Value,
        map: &mut std::collections::BTreeMap<String, String>,
    ) -> bool {
        use serde_json::Value::*;
        match (a, b) {
            (Object(a), Object(b)) if a.len() == b.len() => {
                if let (Some(String(a)), Some(String(b))) = (a.get("Field"), b.get("Field")) {
                    if map.get(a).is_some_and(|old| old != b)
                        || map.iter().any(|(old, v)| v == b && old != a)
                    {
                        return false;
                    }
                    map.insert(a.clone(), b.clone());
                    true
                } else {
                    a.iter()
                        .all(|(k, a)| b.get(k).is_some_and(|b| walk(a, b, map)))
                }
            }
            (Array(a), Array(b)) if a.len() == b.len() => {
                a.iter().zip(b).all(|(a, b)| walk(a, b, map))
            }
            _ => a == b,
        }
    }
    let mut map = Default::default();
    walk(
        &serde_json::to_value(child).ok()?,
        &serde_json::to_value(parent).ok()?,
        &mut map,
    )
    .then_some(map)
}

/// The retirement phase shared by activation and its read-only occupancy
/// preview. Selection and the predecessor deadline predicate live here once;
/// checking a candidate must not count a row this phase would remove.
pub(crate) struct Retirement<'a> {
    affected: Vec<(String, &'a Table)>,
    now: i64,
}

impl<'a> Retirement<'a> {
    pub(crate) fn new(next: &Schema, previous: &'a Schema, now: i64) -> Self {
        let affected = next
            .through_order()
            .into_iter()
            .filter_map(|name| {
                let next = &next.tables[&name];
                let old = previous.table(&name)?;
                Self::changes_lifetime(next,old).then_some((name, old))
            })
            .collect();
        Self { affected, now }
    }

    fn changes_lifetime(next:&Table,old:&Table) -> bool {
        next.through != old.through || next.through.is_some() && (next.expire != old.expire || next.expire.as_ref().is_some_and(|field|old.defaults.get(field)!=next.defaults.get(field)))
    }

    pub(crate) fn retires_image(next:&Table,old:&Table,row:&Value,now:i64) -> bool {
        (next.through!=old.through || next.expire!=old.expire || old.expire.as_ref().is_some_and(|field|old.defaults.get(field)!=next.defaults.get(field))) && old.expired(row,now)
    }

    pub(crate) fn affects(&self, name: &str) -> bool {
        self.affected.iter().any(|(table, _)| table == name)
    }

    pub(crate) fn retires(&self, name: &str, row: &Value) -> bool {
        self.affected
            .iter()
            .find(|(table, _)| table == name)
            .is_some_and(|(_, old)| old.expired(row, self.now))
    }
}

/// Capture barrier for an authoritative adapter's uncommitted generation.
pub fn activate(
    tx: &dyn Rows,
    next: &Schema,
    previous: Option<&Schema>,
    now: i64,
) -> Result<std::collections::BTreeMap<String, u64>, RuntimeError> {
    activate_retained(tx, next, previous, now, &Default::default(), false)
}

pub(crate) fn activate_retained(
    tx: &dyn Rows,
    next: &Schema,
    previous: Option<&Schema>,
    now: i64,
    retained: &std::collections::BTreeSet<String>,
    rebuild_all_indexes: bool,
) -> Result<std::collections::BTreeMap<String, u64>, RuntimeError> {
    let mut shortened = std::collections::BTreeMap::new();
    let Some(previous) = previous else {
        return Ok(shortened);
    };
    // Previous indexes and row images still exist. Every affected expired row
    // retires under its old deadline, before a new default or capture can revive it.
    let retirement = Retirement::new(next, previous, now);
    for (name, old) in retirement.affected.iter().rev() {
        let bounded=live_work(tx,name,Some(old),next)?;
        rows(tx, name, old, 0, bounded, None, |row| {
            if retirement.retires(name, &row) {
                tx.delete(name, old, &row)?;
            }
            Ok(())
        })?;
    }
    forward_sources(tx,next,&previous.tables,now)?;
    reconcile_manual(tx,next,&previous.tables,now)?;
    // Compare all predecessor images before any ancestor is recaptured.
    for (name, _) in &retirement.affected {
        let Some(t) = &next.tables[name].through else {
            continue;
        };
        let Some(old) = previous.table(name).filter(|t| t.through.is_none()) else {
            continue;
        };
        let parent = previous
            .table(&t.parent)
            .ok_or_else(|| refusal(name, 0, "the previous parent schema is absent", &[]))?;
        let bounded=live_work(tx,name,Some(old),next)?;
        let map = correspondence(&old.rules.read, &parent.rules.read);
        let mut invalid = 0;
        let mut samples = Vec::new();
        rows(tx, name, old, parent_bytes(Some(parent),next.table(&t.parent)), bounded, None, |row| {
            // @ref LLP 3000.000.000#10-wave-10-release-lifecycle-amendment — historical capture restoration needs no audience recapture.
            if tx.restored_live_authority(name,row.field("id")?.as_str()?)? || tx.restored_narrowed(name,row.field("id")?.as_str()?)? {return Ok(());}
            if t.live.is_none() && retained.contains(name) && row.field(PARENT_DEADLINE).is_ok() && t.fields.keys().all(|f|row.field(f).is_ok()) {return Ok(());}
            let Some(map) = &map else {
                invalid += 1;
                sample(&mut samples, &row, &t.reference, &t.parent);
                return Ok(());
            };
            let row = crate::schema::row_image(&row, old);
            let parent_row = row
                .field(&t.reference)
                .ok()
                .and_then(|id| id.as_str().ok())
                .map(|id| tx.get(&t.parent, id))
                .transpose()?
                .flatten();
            let matches = parent_row.as_ref().is_some_and(|image| {
                !parent.expired(image, now) && {
                    let image = crate::schema::row_image(image, parent);
                    map.iter()
                        .all(|(child, p)| row.field(child).ok() == image.field(p).ok())
                }
            });
            if !matches {
                invalid += 1;
                sample(&mut samples, &row, &t.reference, &t.parent);
            }
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(
                name,
                invalid,
                "missing, ambiguous or disagreeing predecessor audience correspondence",
                &samples,
            ));
        }
    }
    for name in next.through_order() {
        let table = &next.tables[&name];
        let Some(t) = &table.through else {
            continue;
        };
        let parent = &next.tables[&t.parent];
        let bounded=live_work(tx,&name,previous.table(&name),next)?;
        let old_through=previous.table(&name).and_then(|t|t.through.as_ref());
        // Bare captures are lifetime evidence, not a cache. A narrower parent
        // rule with the same immutable edge preserves already captured fields;
        // the SQLite adoption prepass keeps rows missing new fields dormant.
        let preserved_bare=predicate_only_capture_change(previous,next,&name);
        let recapture = old_through != Some(t) && !preserved_bare;
        let mut invalid = 0;
        let mut samples = Vec::new();
        // @ref LLP 3000.014#7-activation — captures precede the candidate index rebuild. Population restoration guarantees only the identity scan; the caller then rebuilds every candidate index. Otherwise maintain predecessor indexes.
        let mut physical = previous.table(&name).unwrap_or(table).clone();
        if rebuild_all_indexes || previous.table(&name).is_none() {
            physical.indexes.retain(|name, _| name == "byId");
        }
        rows(tx, &name, previous.table(&name).unwrap_or(table), parent_bytes(Some(parent),previous.table(&t.parent)), bounded, Some(table), |old| {
            let mut row = old.clone();
            // @ref LLP 3000.000.000#2-retain-by-default — restored audience/deadline captures retain their original lifetime.
            let id=old.field("id")?.as_str()?;
            let live_source=tx.restored_authority_mode(&name,id)?.map_or_else(||previous.table(&name).and_then(|t|t.through.as_ref()).is_some_and(|t|t.live.is_some()),|mode|mode==2) || tx.restored_live_authority(&name,id)?;
            let historical = !live_source && t.live.is_none() && retained.contains(&name) && old.field(PARENT_DEADLINE).is_ok();
            if (recapture || t.live.is_some() || live_source) && (!historical || t.fields.keys().any(|field| old.field(field).is_err()))
            {
                let parent_row = old
                    .field(&t.reference)
                    .ok()
                    .and_then(|id| id.as_str().ok())
                    .map(|id| tx.get(&t.parent, id))
                    .transpose()?
                    .flatten();
                // @ref LLP 3000.014#7-activation — previous-schema expiry was retired before projection; a newly due deadline must propagate, not veto adoption.
                let Some(parent_row) = parent_row else {
                    invalid += 1;
                    sample(&mut samples, &old, &t.reference, &t.parent);
                    return Ok(());
                };
                if historical {
                    let mut fresh = row.clone();
                    super::through::stamp(parent, t, &parent_row, &mut fresh)?;
                    if let Value::Row(fields) | Value::Map(fields) = &mut row {
                        for field in t.fields.keys().filter(|field| old.field(field).is_err()) {
                            fields.insert(field.clone(), fresh.field(field)?.clone());
                        }
                    }
                } else {
                    super::through::stamp(parent, t, &parent_row, &mut row)?;
                }
            }
            table.recompute_deadline(&mut row)?;
            let before = previous.table(&name).and_then(|table| table.deadline(&old));
            if table
                .deadline(&row)
                .is_some_and(|after| before.is_none_or(|before| after < before))
            {
                *shortened.entry(name.clone()).or_default() += 1;
            }
            tx.put(&name, &physical, &row, Some(&old))?;
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(&name, invalid, "missing parent", &samples));
        }
    }
    Ok(shortened)
}

// The legacy structural matcher maps direct Field terms. A live handoff
// requires every focal input to be covered; identical unmapped hop roots are
// not a proof that a dormant authored copy follows the current parent.
fn live_correspondence(child:&RuleExpr,parent:&RuleExpr)->Option<BTreeMap<String,String>> {
    let map=correspondence(child,parent)?;
    let mut child_fields=std::collections::BTreeSet::new();let mut parent_fields=std::collections::BTreeSet::new();
    child.fields(&mut child_fields);parent.fields(&mut parent_fields);
    (child_fields==map.keys().cloned().collect() && parent_fields==map.values().cloned().collect()).then_some(map)
}

/// Validate a recovered manual image before any authority cells are projected away.
pub(crate) fn forward_image(tx:&dyn Rows,next:&Schema,sources:&BTreeMap<String,Table>,name:&str,old:&Table,row:&Value,now:i64)->Result<(),RuntimeError> {
    forward_authority(tx,next,sources,name,old,row,now,false)
}
pub(crate) fn forward_authority(tx:&dyn Rows,next:&Schema,sources:&BTreeMap<String,Table>,name:&str,old:&Table,row:&Value,now:i64,captured:bool)->Result<(),RuntimeError> {
    let Some(destination)=next.table(name) else {return Ok(())};
    let Some(edge)=destination.through.as_ref().filter(|e|captured || e.live.is_some()) else {return Ok(())};
    if old.through.as_ref().is_some_and(|t|t.live.is_some()) || tx.restored_live_authority(name,row.field("id")?.as_str()?)? || Retirement::retires_image(destination,old,row,now) {return Ok(());}
    let parent=sources.get(&edge.parent).filter(|old|old.through.is_none() || next.table(&edge.parent).is_none_or(|t|t.through.is_some())).or_else(||next.table(&edge.parent)).ok_or_else(||refusal(name,1,"restored manual source needs its parent definition",&[]))?;
    let map=live_correspondence(&old.rules.read,&parent.rules.read).ok_or_else(||refusal(name,1,"restored manual source lacks full audience correspondence",&[]))?;
    let p=row.field(&edge.reference).ok().and_then(|v|v.as_str().ok()).map(|id|tx.get(&edge.parent,id)).transpose()?.flatten();
    let matches=p.as_ref().is_some_and(|p|parent.live(p,now) && {
        let p=crate::schema::row_image(p,parent);let old=crate::schema::row_image(row,old);
        map.iter().all(|(f,source)|old.field(f).ok()==p.field(source).ok())
    });
    if !matches {return Err(refusal(name,1,"restored manual source has disagreeing audience correspondence",&[]));}Ok(())
}
pub(crate) fn forward_sources(tx:&dyn Rows,next:&Schema,sources:&BTreeMap<String,Table>,now:i64)->Result<(),RuntimeError> {
    for (name,old) in sources {
        if old.through.as_ref().is_none_or(|t|t.live.is_none()) && next.table(name).and_then(|t|t.through.as_ref()).is_some_and(|t|t.live.is_some()) {
            let parent=next.table(&next.tables[name].through.as_ref().unwrap().parent);
            rows(tx,name,old,parent_bytes(parent,next.tables[name].through.as_ref().and_then(|e|sources.get(&e.parent))),true,None,|row| {if tx.restored_narrowed(name,row.field("id")?.as_str()?)? {return Ok(());} forward_image(tx,next,sources,name,old,&row,now)})?;
        }
    }Ok(())
}
/// Narrowed images retain their own source definition. Admit every current
/// parent image before either forward correspondence or reverse recapture.
pub(crate) fn restored_parent_scratch(next:&Schema,sources:&BTreeMap<String,Table>,name:&str,old:&Table)->u64 {
    let destination=next.table(name).and_then(|t|t.through.as_ref());
    let source=old.through.as_ref().filter(|e|e.live.is_some());
    [destination,source].into_iter().flatten().map(|edge| {
        parent_bytes(sources.get(&edge.parent),next.table(&edge.parent))
    }).fold(0_u64,u64::saturating_add)
}
/// Only authority cells are replaceable before narrowed restoration. Other
/// incompatible data must keep its dormant lifetime without fetching a parent.
pub(crate) fn manual_authority_fields(next:&Schema,name:&str,old:&Table)->Vec<String> {
    let Some(edge)=old.through.as_ref().filter(|e|e.live.is_some()) else {return Vec::new()};
    let Some(table)=next.table(name).filter(|t|t.through.is_none()) else {return Vec::new()};
    let Some(parent)=next.table(&edge.parent) else {return Vec::new()};
    live_correspondence(&table.rules.read,&parent.rules.read).map(|map|map.into_keys().collect()).unwrap_or_default()
}
/// Reconcile per-row provenance as well as complete-table source definitions.
pub(crate) fn manual_image(tx:&dyn Rows,next:&Schema,name:&str,old:&Table,row:&mut Value,now:i64)->Result<(),RuntimeError> {
    let Some(edge)=old.through.as_ref().filter(|e|e.live.is_some()) else {return Ok(())};
    let Some(destination)=next.table(name).filter(|t|t.through.is_none()) else {return Ok(())};
    let parent=next.table(&edge.parent).ok_or_else(||refusal(name,1,"manual restoration needs current parent",&[]))?;
    let map=live_correspondence(&destination.rules.read,&parent.rules.read).ok_or_else(||refusal(name,1,"manual restoration needs whole current parent correspondence",&[]))?;
    if destination.columns.get(&edge.reference)!=old.columns.get(&edge.reference) || !destination.immutable_fields().any(|f|f==edge.reference) {return Err(refusal(name,1,"manual restoration must preserve immutable parent binding",&[]));}
    let p=tx.get(&edge.parent,row.field(&edge.reference)?.as_str()?)?.filter(|p|parent.live(p,now)).ok_or_else(||refusal(name,1,"manual restoration needs live current parent",&[]))?;
    let p=crate::schema::row_image(&p,parent);
    for (field,source) in map {
        if destination.engine_field(&field) || !destination.columns.contains_key(&field) {return Err(refusal(name,1,"manual authority needs ordinary destination cells",&[]));}
        let value=p.field(&source)?.clone();
        if field=="id" || field==edge.reference {if row.field(&field)?!=&value {return Err(refusal(name,1,"manual restoration cannot change identity or immutable parent binding; keep the reference and use a separate audience copy column",&[]));}}
        else if let Value::Row(fields)|Value::Map(fields)=row {fields.insert(field,value);}
    }Ok(())
}
#[cfg(feature="sqlite")]
pub fn restore_server_images(tx:&dyn Rows,schema:&Schema,rows:impl IntoIterator<Item=(String,Value)>,now:i64)->Result<u64,RuntimeError> {
    // Same trusted final-image contract as native SQLite/Postgres. Derived
    // images are durable import input, rather than an unbounded global rebuild.
    super::live_bulk::restore(tx,schema,rows,0,now).map(|r|r.0)
}

/// Include recovered dormant source definitions, not just the immediate predecessor.
pub(crate) fn reconcile_manual(tx:&dyn Rows,next:&Schema,sources:&BTreeMap<String,Table>,now:i64)->Result<(),RuntimeError> {
    // @ref LLP 3000.014.000#7-adoption-and-rollback — dormant manual cells are never authority after a live transfer.
    for (name,old) in sources {
        let Some(edge)=old.through.as_ref().filter(|t|t.live.is_some()) else {continue};
        let Some(destination)=next.table(name).filter(|t|t.through.is_none()) else {continue};
        let parent=next.table(&edge.parent).ok_or_else(||refusal(name,0,"reverse adoption needs its current parent",&[]))?;
        let map=live_correspondence(&destination.rules.read,&parent.rules.read)
            .ok_or_else(||refusal(name,0,"manual destination needs full current-parent audience correspondence; use a bridge release",&[]))?;
        if destination.columns.get(&edge.reference)!=old.columns.get(&edge.reference) || !destination.immutable_fields().any(|f|f==edge.reference) {
            return Err(refusal(name,0,"manual destination must preserve the immutable parent binding; use a bridge release",&[]));
        }
        let mut invalid=0;let mut samples=Vec::new();
        rows(tx,name,old,parent_bytes(Some(parent),sources.get(&edge.parent)),true,Some(destination),|stored| {
            if tx.restored_narrowed(name,stored.field("id")?.as_str()?)? {return Ok(());}
            let p=stored.field(&edge.reference).ok().and_then(|v|v.as_str().ok()).map(|id|tx.get(&edge.parent,id)).transpose()?.flatten();
            let Some(p)=p.filter(|p|parent.live(p,now)) else {invalid+=1;sample(&mut samples,&stored,&edge.reference,&edge.parent);return Ok(())};
            let p=crate::schema::row_image(&p,parent);
            let mut row=stored.clone();
            for (field,source) in &map {
                if destination.engine_field(field) || !destination.columns.contains_key(field) {return Err(refusal(name,0,"manual authority must use writable ordinary destination cells",&[]));}
                let value=p.field(source)?.clone();
                if field=="id" || field==&edge.reference {
                    if row.field(field)? != &value {return Err(refusal(name,0,"manual audience correspondence cannot change identity or immutable parent binding; keep the reference and use a separate audience copy column",&[]));}
                } else if let Value::Row(fields)|Value::Map(fields)=&mut row {fields.insert(field.clone(),value);}
            }
            tx.put(name,old,&row,Some(&stored))?;Ok(())
        })?;
        if invalid>0 {return Err(refusal(name,invalid,"manual destination needs live current parents",&samples));}
    }
    Ok(())
}

/// Trusted restoration validates the existing immutable captures; it never stamps them.
pub fn validate_restore(tx: &dyn Rows, schema: &Schema, now: i64) -> Result<(), RuntimeError> {
    for name in schema.through_order() {
        let table = &schema.tables[&name];
        let Some(t) = &table.through else {
            continue;
        };
        let parent = &schema.tables[&t.parent];
        let mut invalid = 0;
        let mut samples = Vec::new();
        rows(tx, &name, table, parent_bytes(Some(parent),None), table.through.as_ref().is_some_and(|t|t.live.is_some()), None, |row| {
            let found = row
                .field(&t.reference)
                .ok()
                .and_then(|v| v.as_str().ok())
                .map(|id| tx.get(&t.parent, id))
                .transpose()?
                .flatten();
            let matches = found.as_ref().is_some_and(|p| {
                (!parent.expired(p, now) || table.expired(&row, now)) && {
                    let p = crate::schema::row_image(p, parent);
                    t.fields
                        .iter()
                        .all(|(field, source)| row.field(field).ok() == p.field(source).ok())
                        && row.field(PARENT_DEADLINE).ok()
                            == Some(&parent.deadline(&p).map(Value::Int).unwrap_or(Value::Null))
                }
            });
            if !matches {
                invalid += 1;
                sample(&mut samples, &row, &t.reference, &t.parent);
            }
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(
                &name,
                invalid,
                "restored captures do not match a live parent",
                &samples,
            ));
        }
    }
    Ok(())
}

pub fn validate_indexes(tx: &dyn Rows, schema: &Schema) -> Result<(), RuntimeError> {
    for (name, table) in &schema.tables {
        let mut checks: Vec<_> = table
            .indexes
            .iter()
            .filter(|(_, i)| i.unique)
            .map(|(name, i)| (name, i.components.len(), 1, true))
            .collect();
        for constraint in &table.constraints {
            if let crate::schema::Constraint::Cap { by, max } = constraint {
                let (index, _) = table
                    .indexes
                    .iter()
                    .find(|(_, i)| i.is_plain() && i.columns().starts_with(by))
                    .ok_or_else(|| RuntimeError::Schema(format!("{name} cap has no index")))?;
                checks.push((index, by.len(), u64::from(*max), false));
            }
        }
        for (index, width, max, nulls_distinct) in checks {
            let mut bounds = Bounds::default();
            let mut previous = None;
            let mut count = 0;
            while let Some(full)=tx.index_head(name,index,&[],&bounds,Dir::Asc)? {
                let group=full[..width].to_vec();
                bounds.after=Some(full);
                if nulls_distinct && group.contains(&Value::Null) {continue;}
                if previous.as_ref()==Some(&group) {count+=1;}else{previous=Some(group);count=1;}
                if count>max {return Err(RuntimeError::Constraint(format!("cannot activate {name}.{index}: existing group exceeds {max}")));}
            }
        }
    }
    Ok(())
}

impl super::runner::Runner<'_> {
    /// Authoritative adapters feed an ancestor-ordered batch to the ordinary
    /// insert/update path; captures always resolve inside this transaction.
    pub fn seed_server_rows(
        &mut self,
        rows: impl IntoIterator<Item = (String, Value)>,
    ) -> Result<u64, RuntimeError> {
        if !self.context.is_system() || self.device {
            return Err(RuntimeError::Input(
                "server seed requires system authority".into(),
            ));
        }
        let bounded=crate::schema::live::has_live(self.schema);
        if bounded {self.meter=crate::meter::Meter::new(crate::meter::Ceilings::job(),crate::meter::Cut::Abort);}
        let order = self.schema.through_order();
        let mut held=Vec::new();
        for (name,row) in rows {
            if bounded {
                self.meter.heap(row.retained_heap_bytes().saturating_mul(8).saturating_add(1024+name.len() as u64*4))?;
                self.meter.charge(crate::error::MeterKind::Examined,1)?;
            }
            held.push((name,row));
        }
        let mut rows=held;
        rows.sort_by_key(|(n, _)| order.iter().position(|x| x == n));
        let count = rows.len() as u64;
        for (name, row) in rows {
            #[cfg(feature="sqlite")]
            if bounded {self.reserve_bulk_source(&name)?;}
            super::timeline::check_import(self.schema, &name)?;
            // Adoption rewrites are system imports of stored images (LLP 3000.015 §1).
            self.upsert(
                &name,
                &row.field("id")?.clone(),
                row.import_input(&super::ImportInput(())),
            )?;
        }
        self.check_final_exists()?;
        Ok(count)
    }

    /// A bounded child-first sweep on the common Rows interface.
    pub fn sweep_server_rows(&mut self, limit: usize, expiry_after: &mut BTreeMap<String, Vec<Value>>) -> Result<u64, RuntimeError> {
        if !self.context.is_system() || self.device {
            return Err(RuntimeError::Input(
                "server sweep requires system authority".into(),
            ));
        }
        let now = self
            .context
            .now
            .ok_or_else(|| RuntimeError::Input("sweep clock is not pinned".into()))?;
        let mut count = 0;
        let mut visited = 0;
        let tables = resume_expiry_tables(self.schema.through_order().into_iter().rev().collect(), expiry_after);
        for name in tables {
            let Some((index, _)) = self.schema.tables[&name].expiry_index() else {
                continue;
            };
            let due = Bounds { gte: Some(Value::Int(i64::MIN)), lte: Some(Value::Int(now)), ..Default::default() };
            let mut bounds = due.clone();
            bounds.after = expiry_after.get(&name).cloned();
            let mut wrapped = bounds.after.is_none();
            while visited < limit {
                let batch = (limit - visited).min(256);
                let page = self.metered_scan(|runner, scope| {
                    runner
                        .tx
                        .scan(scope, &name, index, &[], &bounds, Dir::Asc, batch)
                })?;
                if page.is_empty() {
                    expiry_after.remove(&name);
                    if !wrapped && visited < limit {
                        bounds = due.clone();
                        wrapped = true;
                        continue;
                    }
                    break;
                }
                let page_len = page.len();
                for (row, key) in page {
                    bounds.after = crate::key::decode(&key);
                    if let Some(after) = &bounds.after { expiry_after.insert(name.clone(), after.clone()); }
                    visited += 1;
                    mark_expiry_table(expiry_after, &name);
                    match self.retire_expired_row(&name, &row) {
                        Ok(true) => count += 1,
                        Ok(false) => {},
                        Err(RuntimeError::Structural { code: "E_REFERENCED" | "E_PARENT_HAS_CHILDREN", .. }) => {},
                        Err(error) => return Err(error),
                    }
                }
                if page_len < batch {
                    expiry_after.remove(&name);
                    if !wrapped && visited < limit {
                        bounds = due.clone();
                        wrapped = true;
                        continue;
                    }
                    break;
                }
            }
        }
        Ok(count)
    }
}

#[cfg(test)]
mod live_handoff_tests {
    use super::*;
    #[test]
    fn complete_copy_inference_never_treats_an_unmapped_hop_as_empty() {
        let rule=RuleExpr::Eq(crate::schema::RuleTerm::Reference{table:"departments".into(),column:"department".into(),field:"owner".into(),old:false},crate::schema::RuleTerm::Viewer);
        // Core read-rule admission currently refuses hops. Keep the live
        // handoff's own proof complete if that surface ever expands.
        assert!(correspondence(&rule,&rule).unwrap().is_empty());
        assert!(live_correspondence(&rule,&rule).is_none());
    }
}
