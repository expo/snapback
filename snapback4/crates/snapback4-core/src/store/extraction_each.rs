//! A bounded historical asset list becomes one receipt-owned child per element.
// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — stable element identities and current values round-trip without copying bytes or acquiring another home.
use super::*;
use crate::error::MeterKind;
use std::collections::BTreeSet;

pub(super) fn item_type(kind: &ColumnType) -> Option<&ColumnType> {
    match kind {
        ColumnType::Optional(kind) => item_type(kind),
        ColumnType::List { of, .. } | ColumnType::ListRange { of, .. } => Some(of),
        _ => None,
    }
}
fn setup(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _extraction_each_rows(definition TEXT NOT NULL,parent_t INTEGER NOT NULL,parent_id TEXT NOT NULL,child_t INTEGER NOT NULL,child_id TEXT NOT NULL,asset_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(definition,child_t,child_id),UNIQUE(definition,parent_t,parent_id,asset_id)) WITHOUT ROWID; CREATE TABLE IF NOT EXISTS _extraction_each_definitions(definition TEXT PRIMARY KEY) WITHOUT ROWID;")?;
    Ok(())
}
fn exists(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_extraction_each_rows')",
        [],
        |r| r.get(0),
    )?)
}
pub(super) fn delete(tx: &Tx<'_>, t: i64, id: &str) -> Result<(), RuntimeError> {
    if exists(tx)? {
        tx.conn().execute("DELETE FROM _extraction_each_rows WHERE (parent_t=?1 AND parent_id=?2) OR (child_t=?1 AND child_id=?2)",params![t,id])?;
    }
    Ok(())
}
fn mapping<'a>(e: &'a Extraction, child: &Table) -> (&'a str, &'a str) {
    e.fields
        .iter()
        .find(|(c, _)| asset(&child.columns[*c]))
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .expect("admitted each mapping")
}
fn asset_id(value: &Value) -> Result<String, RuntimeError> {
    crate::assets::asset_id(Some(value))
        .map(str::to_owned)
        .ok_or_else(|| refuse("extract each requires non-null typed asset list elements"))
}
fn anchored(
    tx: &Tx<'_>,
    ct: i64,
    child_id: &str,
    key: &str,
    pt: i64,
    parent_id: &str,
) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND parent_t=?4 AND parent_id=?5 AND invalid=0)",params![ct,child_id,format!("$extract:{key}"),pt,parent_id],|r|r.get(0))?)
}
fn remember(
    tx: &Tx<'_>,
    key: &str,
    pt: i64,
    id: &str,
    column: &str,
    v: &Value,
    meter: &mut Meter,
) -> Result<(), RuntimeError> {
    meter.heap(v.retained_heap_bytes().saturating_mul(4).saturating_add(8192))?;
    let encoded = canonical_json(v);
    let conflicting:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values d WHERE d.t=?1 AND d.id=?2 AND d.column_name=?3 AND d.data!=?4 AND NOT EXISTS(SELECT 1 FROM _extraction_cells e WHERE e.definition=?5 AND e.parent_t=d.t AND e.parent_id=d.id AND e.column_name=d.column_name AND e.data=d.data))",params![pt,id,column,encoded,key],|r|r.get(0))?;
    if conflicting {
            return Err(refuse(
                "extract each has a conflicting retained source list; preserve both meanings in a bridge",
            ));
    }
    tx.conn().execute("INSERT INTO _extraction_cells VALUES(?1,?2,?3,?4,?5) ON CONFLICT(definition,parent_t,parent_id,column_name) DO UPDATE SET data=excluded.data",params![key,pt,id,column,encoded])?;
    tx.conn().execute(
        "DELETE FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",
        params![pt, id, column],
    )?;
    Ok(())
}
fn save(
    tx: &Tx<'_>,
    key: &str,
    pt: i64,
    id: &str,
    ct: i64,
    child_id: &str,
    asset_id: &str,
    position: usize,
) -> Result<(), RuntimeError> {
    tx.conn().execute("INSERT INTO _extraction_each_rows VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(definition,child_t,child_id) DO UPDATE SET asset_id=excluded.asset_id,position=excluded.position",params![key,pt,id,ct,child_id,asset_id,position as i64])?;
    Ok(())
}

// A migration-owned null can remain in narrowed storage across old views.
// Reading it validates custody without restoring it into the active population.
fn receipt_image(tx: &Tx<'_>, ct: i64, id: &str, meter:&mut Meter) -> Result<Option<Value>, RuntimeError> {
    read_image(tx,ct,id,meter,true)
}
fn read_image(tx: &Tx<'_>, ct: i64, id: &str, meter:&mut Meter, dormant:bool) -> Result<Option<Value>, RuntimeError> {
    let item:Option<(i64,bool)>=tx.conn().query_row("SELECT octet_length(data),1 FROM r WHERE t=?1 AND id=?2 UNION ALL SELECT octet_length(data),0 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2 AND ?3 LIMIT 1",params![ct,id,dormant],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let Some((size,active))=item else { return Ok(None) };
    let scratch=meter.mark();
    meter.heap((size.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
    let sql=if active {"SELECT data FROM r WHERE t=?1 AND id=?2"} else {"SELECT data FROM _dormant_narrow_rows WHERE t=?1 AND id=?2"};
    let text:String=tx.conn().query_row(sql,params![ct,id],|r|r.get(0))?;
    let image:Value=serde_json::from_str(&text).map_err(|e|refuse(e.to_string()))?;
    drop(text);
    meter.release_heap(scratch);
    // Decoder scratch is gone; the decoded image and its write/projection
    // scratch remain resident alongside the walker's page and prior children.
    meter.heap(image.retained_heap_bytes().saturating_mul(4).saturating_add(8192))?;
    Ok(Some(image))
}
fn read_value(tx:&Tx<'_>,t:i64,id:&str,row:&Value,column:&str,meter:&mut Meter)->Result<Option<Value>,RuntimeError>{
    if let Ok(value)=row.field(column) {
        // Includes the retained value, list bookkeeping and scalar-copy scratch.
        meter.heap(value.retained_heap_bytes().saturating_mul(4).saturating_add(8192))?;
        return Ok(Some(value.clone()));
    }
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column],|r|r.get(0)).optional()?;
    let Some(bytes)=bytes else{return Ok(None)};
    let scratch=meter.mark();
    meter.heap((bytes.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
    let text:String=tx.conn().query_row("SELECT data FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column],|r|r.get(0))?;
    let value:Value=serde_json::from_str(&text).map_err(|e|refuse(e.to_string()))?;
    drop(text);meter.release_heap(scratch);
    meter.heap(value.retained_heap_bytes().saturating_mul(4).saturating_add(8192))?;
    Ok(Some(value))
}
fn validate_receipts(tx:&Tx<'_>,key:&str,pt:i64,id:&str,ct:i64,meter:&mut Meter)->Result<(),RuntimeError>{
    let mut q=tx.conn().prepare("SELECT octet_length(child_id),child_id FROM _extraction_each_rows WHERE definition=?1 AND parent_t=?2 AND parent_id=?3 ORDER BY child_id")?;
    let mut receipts=q.query(params![key,pt,id])?;
    while let Some(record)=receipts.next()? {
        meter.charge(MeterKind::Examined,1)?;
        let scratch=meter.mark();
        let size:i64=record.get(0)?;
        meter.heap((size.max(0) as u64).saturating_mul(8).saturating_add(128))?;
        let child:String=record.get(1)?;
        if receipt_image(tx,ct,&child,meter)?.is_none() || !anchored(tx,ct,&child,key,pt,id)? {
            return Err(refuse("returning extract each lacks its receipt-owned child or valid parent-lifetime evidence; never recreate pruned/deleted history"));
        }
        drop(child);meter.release_heap(scratch);
    }
    Ok(())
}

pub(super) fn source<'a>(e:&'a Extraction,child:&Table)->&'a str { mapping(e,child).1 }
pub(super) fn known(tx:&Tx<'_>,key:&str)->Result<bool,RuntimeError>{
    setup(tx)?;
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _extraction_each_definitions WHERE definition=?1)",[key],|r|r.get(0))?)
}
fn validate_all_receipts(tx:&Tx<'_>,key:&str,pt:i64,ct:i64)->Result<(),RuntimeError>{
    let mut q=tx.conn().prepare("SELECT DISTINCT octet_length(parent_id),parent_id FROM _extraction_each_rows WHERE definition=?1 AND parent_t=?2 AND child_t=?3 ORDER BY parent_id")?;
    let mut parents=q.query(params![key,pt,ct])?;
    while let Some(record)=parents.next()? {
        let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
        let size:i64=record.get(0)?;
        meter.heap((size.max(0) as u64).saturating_mul(8).saturating_add(128))?;
        let id:String=record.get(1)?;
        validate_receipts(tx,key,pt,&id,ct,&mut meter)?;
    }
    Ok(())
}
// A suspended declaration has already consumed its historical list. Resume
// validates current child custody; it never replays stale list preimages.
pub(super) fn resume(tx:&Tx<'_>,e:&Extraction,parent:&Table,child:&Table,key:&str,report:&mut super::super::adoption_report::AdoptionReport)->Result<(),RuntimeError>{
    if !known(tx,key)? { return Err(refuse("extract each source list is absent and no successfully applied extraction owns this suspended definition")); }
    let pt=tx.num(&e.parent)?;let ct=tx.num(&e.child)?;
    validate_all_receipts(tx,key,pt,ct)?;
    let (destination,_)=mapping(e,child);let mut count=0u64;
    super::super::activation_walk::walk_metered(tx,ct,crate::rows::adoption::Work::DECODE,None,|id,image,meter|{
        let parent_id=image.field(&e.reference)?.as_str()?;
        if !anchored(tx,ct,id,key,pt,parent_id)? { return Err(refuse("resuming extract each lacks valid captured parent-lifetime evidence; never retrospectively capture an independent child")); }
        let active:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t=?1 AND id=?2)",params![pt,parent_id],|r|r.get(0))?;
        if !active {return Err(refuse("resuming extract each requires its existing current parent; preserve narrowed parent authority in a bridge"));}
        let current=receipt_image(tx,pt,parent_id,meter)?.ok_or_else(||refuse("resuming extract each lost its current parent"))?;
        if let Some(through)=&child.through {
            let current=crate::schema::row_image(&current,parent);
            if through.fields.iter().any(|(capture,field)|image.field(capture).ok()!=current.field(field).ok()) { return Err(refuse("resuming extract each would change captured parent authority; use an authored bridge")); }
        }
        for(dest,src)in &e.fields {
            if dest!=destination && image.field(dest).ok()!=current.field(src).ok() { return Err(refuse("resuming extract each immutable scalar copies disagree with the current parent")); }
        }
        transfer(tx,image.field(destination)?,(&e.child,id,destination),(&e.child,id,destination))?;
        count+=1;Ok(())
    })?;
    report.backfills.push(format!("extract {} each: resumed {count} current child rows without replaying consumed source lists",e.child));
    Ok(())
}

pub(super) fn forward(
    tx: &Tx<'_>,
    e: &Extraction,
    parent: &Table,
    child: &Table,
    key: &str,
    report: &mut super::super::adoption_report::AdoptionReport,
) -> Result<(), RuntimeError> {
    setup(tx)?;
    let pt = tx.num(&e.parent)?;
    let ct = tx.num(&e.child)?;
    let (destination, source) = mapping(e, child);
    validate_all_receipts(tx,key,pt,ct)?;
    let mut count = 0u64;
    super::super::activation_walk::walk_metered(tx, pt, crate::rows::adoption::Work::DECODE, None, |id, mut row, meter| {
        let Some(list) = read_value(tx, pt, id, &row, source, meter)? else {
            return Err(refuse(format!(
                "extract each source {}.{source} is absent",
                e.parent
            )));
        };
        let values = match &list {
            Value::Array(values) => values.as_slice(),
            Value::Null
                if parent
                    .columns
                    .get(source)
                    .is_some_and(ColumnType::is_optional) =>
            {
                &[]
            }
            _ => return Err(refuse("extract each source must be a bounded asset list")),
        };
        let mut seen = BTreeSet::new();
        for (position, v) in values.iter().enumerate() {
            meter.charge(MeterKind::RowsWritten, 1)?;
            meter.heap(1024)?; // retained seen-set node/IDs, before cloning them
            let child_scratch=meter.mark();
            let asset_id = asset_id(v)?;
            if !seen.insert(asset_id.clone()) {
                return Err(refuse(
                    "extract each cannot put a repeated asset in two child homes; remove the duplicate element in an authorized source edit",
                ));
            }
            let saved:Option<String>=tx.conn().query_row("SELECT child_id FROM _extraction_each_rows WHERE definition=?1 AND parent_t=?2 AND parent_id=?3 AND asset_id=?4",params![key,pt,id,asset_id],|r|r.get(0)).optional()?;
            let child_id = saved.clone().unwrap_or_else(|| {
                crate::value::digest(&("extract-each-child", key, pt, id, &asset_id))
            });
            let present = read_image(tx, ct, &child_id, meter, false)?;
            if saved.is_some() {
                if present.is_none() || !anchored(tx, ct, &child_id, key, pt, id)? {
                    return Err(refuse(
                        "returning extract each lacks its receipt-owned child or valid parent-lifetime evidence; never recreate pruned/deleted history",
                    ));
                }
            } else {
                let independent:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_rows WHERE t=?1 AND id=?2) OR EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2) OR EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2) OR EXISTS(SELECT 1 FROM _extraction_each_rows WHERE child_t=?1 AND child_id=?2) OR EXISTS(SELECT 1 FROM _extraction_rows WHERE child_t=?1 AND child_id=?2)",params![ct,child_id],|r|r.get(0))?;
                if present.is_some() || independent {
                    return Err(refuse(format!(
                        "extract each destination {}/{child_id} already has independent history",
                        e.child
                    )));
                }
            }
            let mut image = present.unwrap_or_else(|| {
                Value::Row(
                    BTreeMap::from([
                        ("id".into(), Value::Id(child_id.clone())),
                        (e.reference.clone(), Value::Id(id.into())),
                    ])
                    .into(),
                )
            });
            if image.field(&e.reference) != Ok(&Value::Id(id.into())) {
                return Err(refuse("extract each cannot rebind a child parent"));
            }
            if image.field(destination).is_ok_and(|old| old != v) {
                return Err(refuse(
                    "extract each destination asset conflicts with its source",
                ));
            }
            for (dest, src) in &e.fields {
                if dest == destination {
                    continue;
                }
                let v = read_value(tx, pt, id, &row, src, meter)?.ok_or_else(|| {
                    refuse(format!(
                        "extract each scalar source {}.{src} is absent",
                        e.parent
                    ))
                })?;
                if saved.is_some() && image.field(dest).ok() != Some(&v) {
                    return Err(refuse(
                        "extract each immutable scalar copies disagree with the returning parent",
                    ));
                }
                fields(&mut image)?.insert(dest.clone(), v);
            }
            transfer(
                tx,
                v,
                (&e.parent, id, source),
                (&e.child, &child_id, destination),
            )?;
            fields(&mut image)?.insert(destination.into(), v.clone());
            crate::schema::materialize_optional_fields(&mut image, child);
            write(tx, ct, &child_id, &image)?;
            save(tx, key, pt, id, ct, &child_id, &asset_id, position)?;
            super::super::dormant::capture_refs(
                tx,
                ct,
                &child_id,
                &format!("$extract:{key}"),
                &ColumnType::Ref {
                    table: e.parent.clone(),
                },
                &Value::Id(id.into()),
            )?;
            count += 1;
            drop(image); drop(child_id); drop(saved); drop(asset_id);
            meter.release_heap(child_scratch);
        }
        // Old-client removal has no asset to put back into that receipt's child.
        // Explicit null represents this migration-owned absence so ordinary
        // narrowing retains the other cells without reactivating an empty home.
        let mut q=tx.conn().prepare("SELECT child_id,asset_id FROM _extraction_each_rows WHERE definition=?1 AND parent_t=?2 AND parent_id=?3 ORDER BY child_id")?;
        let mut stale = q.query(params![key, pt, id])?;
        while let Some(record) = stale.next()? {
            meter.charge(MeterKind::Examined, 1)?;
            let child_id: String = record.get(0)?;
            let asset_id: String = record.get(1)?;
            if seen.contains(&asset_id) {
                continue;
            }
            let scratch=meter.mark();
            let mut image = receipt_image(tx, ct, &child_id,meter)?.ok_or_else(|| refuse("extract each lost a receipt-owned child; never recreate pruned/deleted history"))?;
            if image.field(destination).is_ok_and(|v| v != &Value::Null) {
                return Err(refuse(
                    "extract each would discard a child asset absent from the old list; preserve both meanings in a bridge",
                ));
            }
            meter.charge(MeterKind::RowsWritten, 1)?;
            fields(&mut image)?.insert(destination.into(), Value::Null);
            if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t=?1 AND id=?2)",params![ct,child_id],|r|r.get::<_,bool>(0))? { write(tx, ct, &child_id, &image)?; }
            else { tx.conn().execute("UPDATE _dormant_narrow_rows SET data=?3 WHERE t=?1 AND id=?2",params![ct,child_id,canonical_json(&image)])?; }
            drop(image);
            meter.release_heap(scratch);
        }
        drop(stale);
        drop(q);
        remember(tx, key, pt, id, source, &list, meter)?;
        fields(&mut row)?.remove(source);
        write(tx, pt, id, &row)?;
        Ok(())
    })?;
    tx.conn().execute("INSERT OR IGNORE INTO _extraction_each_definitions VALUES(?1)",[key])?;
    report.backfills.push(format!(
        "extract {} each: prepared {count} child rows and moved existing asset homes",
        e.child
    ));
    Ok(())
}

pub(super) fn backward(
    tx: &Tx<'_>,
    e: &Extraction,
    parent: &Table,
    current_parent: &Table,
    child: &Table,
    key: &str,
    report: &mut super::super::adoption_report::AdoptionReport,
) -> Result<(), RuntimeError> {
    setup(tx)?;
    let pt = tx.num(&e.parent)?;
    let ct = tx.num(&e.child)?;
    let (destination, source) = mapping(e, child);
    validate_all_receipts(tx,key,pt,ct)?;
    let Some(kind) = parent.columns.get(source) else {
        return Ok(());
    };
    if item_type(kind) != Some(&child.columns[destination]) {
        return Err(refuse(
            "reverse extract each requires identical asset element types in the old bounded list",
        ));
    }
    // Retained populated children are not in the active snapshot. Their homes
    // must never disappear from a reconstructed list. Restore their domain in
    // an explicit loosened child bridge first; migration-owned nulls have no
    // live child asset home and remain safely dormant.
    let hidden:i64=tx.conn().query_row("SELECT COUNT(*) FROM _assets a WHERE a.home_table=?1 AND a.home_column=?2 AND a.released_at IS NULL AND EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=?3 AND n.id=a.home_id) AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=?3 AND r.id=a.home_id)",params![e.child,destination,ct],|r|r.get(0))?;
    if hidden>0 { return Err(refuse(format!("reverse extract each cannot omit {hidden} retained narrowed child asset homes in {}; deploy a loosened child bridge that restores these rows before selecting old source",e.child))); }
    // Index the assembled snapshot once on disk; never rescan all children
    // for each parent or keep the whole store in process memory.
    tx.conn().execute_batch("CREATE TEMP TABLE _extraction_each_children(parent_id TEXT NOT NULL,child_id TEXT NOT NULL,PRIMARY KEY(parent_id,child_id)) WITHOUT ROWID;")?;
    super::super::activation_walk::walk_metered(tx, ct, crate::rows::adoption::Work::DECODE, None, |child_id, image, meter| {
        if let Ok(Value::Id(parent_id)) = image.field(&e.reference) {
            meter.heap(
                (child_id.len() as u64 + parent_id.len() as u64)
                    .saturating_mul(8)
                    .saturating_add(256),
            )?;
            tx.conn().execute(
                "INSERT INTO temp._extraction_each_children VALUES(?1,?2)",
                params![parent_id, child_id],
            )?;
        }
        Ok(())
    })?;
    let mut count = 0u64;
    super::super::activation_walk::walk_metered(tx, pt, crate::rows::adoption::Work::DECODE, None, |id, mut row, meter| {
        let mut children = Vec::new();
        let mut membership=tx.conn().prepare("SELECT octet_length(child_id),child_id FROM temp._extraction_each_children WHERE parent_id=?1 ORDER BY child_id")?;
        let mut members = membership.query([id])?;
        while let Some(member) = members.next()? {
            meter.charge(MeterKind::Examined, 1)?;
            let id_bytes:i64=member.get(0)?;
            meter.heap((id_bytes.max(0) as u64).saturating_mul(8).saturating_add(512))?;
            let child_id: String = member.get(1)?;
            let image = read_image(tx, ct, &child_id, meter, false)?.ok_or_else(|| {
                refuse("extract each child disappeared from its activation snapshot")
            })?;
            let child_id = child_id.as_str();
            if !anchored(tx, ct, child_id, key, pt, id)? {
                return Err(refuse(
                    "extract each child lacks valid parent-lifetime evidence; refusing deletion/id reuse or retrospective recapture",
                ));
            }
            if let Some(through) = &child.through {
                let parent_image = crate::schema::row_image(&row, current_parent);
                if through.fields.iter().any(|(capture, field)| {
                    image.field(capture).ok() != parent_image.field(field).ok()
                }) {
                    return Err(refuse(
                        "reverse extract each would change captured parent authority; preserve the child audience in an authored bridge",
                    ));
                }
            }
            let asset_value=image.field(destination)?;
            meter.heap(asset_value.retained_heap_bytes().saturating_mul(4).saturating_add(512))?;
            let v = asset_value.clone();
            let asset_id = asset_id(&v)?;
            let position:Option<i64>=tx.conn().query_row("SELECT position FROM _extraction_each_rows WHERE definition=?1 AND child_t=?2 AND child_id=?3",params![key,ct,child_id],|r|r.get(0)).optional()?;
            children.push((
                position.unwrap_or(i64::MAX),
                child_id.to_owned(),
                image,
                v,
                asset_id,
            ));
        }
        drop(members);
        drop(membership);
        children.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        let mut values = Vec::new();
        let mut seen = BTreeSet::new();
        for (position, (_, child_id, mut image, v, asset_id)) in children.into_iter().enumerate() {
            meter.charge(MeterKind::RowsWritten, 1)?;
            if !seen.insert(asset_id.clone()) {
                return Err(refuse(
                    "extract each found competing child homes for one asset",
                ));
            }
            for (dest, src) in &e.fields {
                if dest != destination && row.field(src).ok() != image.field(dest).ok() {
                    return Err(refuse(
                        "extract each immutable scalar copies disagree with the current parent",
                    ));
                }
            }
            transfer(
                tx,
                &v,
                (&e.child, &child_id, destination),
                (&e.parent, id, source),
            )?;
            fields(&mut image)?.remove(destination);
            write(tx, ct, &child_id, &image)?;
            tx.conn().execute(
                "DELETE FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",
                params![ct, child_id, destination],
            )?;
            save(tx, key, pt, id, ct, &child_id, &asset_id, position)?;
            values.push(v);
            count += 1;
        }
        let was_null:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _extraction_cells WHERE definition=?1 AND parent_t=?2 AND parent_id=?3 AND column_name=?4 AND data=?5)",params![key,pt,id,source,canonical_json(&Value::Null)],|r|r.get(0))?;
        let list = if values.is_empty()
            && kind.is_optional()
            && was_null
        {
            Value::Null
        } else {
            Value::Array(values)
        };
        remember(tx, key, pt, id, source, &list, meter)?;
        fields(&mut row)?.insert(source.into(), list);
        write(tx, pt, id, &row)?;
        Ok(())
    })?;
    tx.conn()
        .execute_batch("DROP TABLE temp._extraction_each_children;")?;
    report.backfills.push(format!(
        "extract {} each: moved {count} child asset homes back into parent lists",
        e.child
    ));
    Ok(())
}
