//! One-child historical extraction moves the existing asset home atomically.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — deterministic identities, no upload or second home.
use super::*;
#[path = "extraction_each.rs"]
mod each;
use crate::{
    meter::{Ceilings, Cut, Meter},
    schema::{ColumnType, Extraction},
};
use std::collections::BTreeMap;
fn refuse(s: impl Into<String>) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_ADOPT",
        message: s.into(),
    }
}
fn asset(k: &ColumnType) -> bool {
    match k {
        ColumnType::Optional(k)
        | ColumnType::List { of: k, .. }
        | ColumnType::ListRange { of: k, .. } => asset(k),
        ColumnType::Image { .. } | ColumnType::File { .. } | ColumnType::Video { .. } => true,
        _ => false,
    }
}
// Closed audience inclusion: equality, deny, and Boolean conjunction/union.
// This never infers a business relation between different atomic predicates.
fn audience_subset(next:&crate::schema::RuleExpr,source:&crate::schema::RuleExpr)->bool{
    use crate::schema::RuleExpr::*;
    next==source || *next==Deny || *source==Allow || match (next,source) {
        (Or(xs),_)=>xs.iter().all(|x|audience_subset(x,source)),
        (_,And(xs))=>xs.iter().all(|x|audience_subset(next,x)),
        (And(xs),_)=>xs.iter().any(|x|audience_subset(x,source)),
        (_,Or(xs))=>xs.iter().any(|x|audience_subset(next,x)),
        _=>false,
    }
}
// @ref LLP 3000.000.000#22-wave-29-release-identity-rel2 — inclusion of collection bounds never invents or coerces a value.
fn payload_accepts(source: &ColumnType, destination: &ColumnType) -> bool {
    if source == destination { return true; }
    if let ColumnType::Optional(inner) = destination {
        return payload_accepts(match source { ColumnType::Optional(kind) => kind, kind => kind }, inner);
    }
    fn bounds(kind: &ColumnType) -> Option<(&ColumnType,u32,u32)> { match kind {
        ColumnType::List { of, max } => Some((of.as_ref(), 0, *max)),
        ColumnType::ListRange { of, min, max } => Some((of.as_ref(), *min, *max)),
        _ => None,
    }}
    match (bounds(source), bounds(destination)) {
        (Some((a, amin, amax)), Some((b, bmin, bmax))) => a == b && bmin <= amin && amax <= bmax,
        _ => false,
    }
}
fn mapped_audience(parent:&Table,child:&Table,e:&Extraction,rule:&crate::schema::RuleExpr)->crate::schema::RuleExpr{
    let mut transported=parent.clone();
    let names=parent.columns.keys().map(|source|{
        let copy=e.fields.iter().find(|(_,old)|*old==source).filter(|(dest,_)|!asset(&child.columns[*dest])&&child.constraints.iter().any(|c|matches!(c,crate::schema::Constraint::Immutable{fields}if fields.contains(*dest))));
        (source.clone(),copy.map(|(dest,_)|dest.clone()).unwrap_or_else(||format!("$extraction-source:{source}")))
    }).collect();
    transported.column_reads=BTreeMap::from([("$gate".into(),rule.clone())]);
    super::asset_renames::table(&mut transported,&names);
    transported.column_reads.remove("$gate").unwrap()
}
fn probe_context(rule:&crate::schema::RuleExpr,sources:&BTreeMap<String,Table>,next:&Schema)->bool{
    use crate::schema::RuleExpr::*;
    match rule {
        Exists{table,index,..}|Created{table,index,..}=>sources.get(table).zip(next.table(table)).is_some_and(|(old,new)|old.index(index)==new.index(index)&&old.rules.read==new.rules.read),
        And(xs)|Or(xs)=>xs.iter().all(|r|probe_context(r,sources,next)),Not(r)=>probe_context(r,sources,next),_=>true,
    }
}
fn fields(row: &mut Value) -> Result<&mut crate::value::ObjectFields, RuntimeError> {
    match row {
        Value::Row(f) | Value::Map(f) => Ok(f),
        _ => Err(refuse("invalid extraction row")),
    }
}
pub(super) fn key(tx:&Tx<'_>,e:&Extraction)->Result<String,RuntimeError>{
    let parent=tx.num(&e.parent)?;let child=tx.num(&e.child)?;
    let aliases:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_asset_column_renames')",[],|r|r.get(0))?;
    let origin=|t:i64,c:&str|->Result<String,RuntimeError>{
        if !aliases{return Ok(c.into())}
        Ok(tx.conn().query_row("SELECT origin FROM _asset_column_renames WHERE t=?1 AND name=?2",params![t,c],|r|r.get(0)).optional()?.unwrap_or_else(||c.into()))
    };
    let fields=e.fields.iter().map(|(dest,source)|Ok((origin(child,dest)?,origin(parent,source)?))).collect::<Result<BTreeMap<_,_>,RuntimeError>>()?;
    let base=(parent,child,origin(child,&e.reference)?,fields);
    Ok(if e.each {crate::value::digest(&("each-v1",base))}else{crate::value::digest(&base)})
}
fn exists(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_extraction_rows')",
        [],
        |r| r.get(0),
    )?)
}
fn load(tx: &Tx<'_>, t: i64, id: &str) -> Result<Option<Value>, RuntimeError> {
    let bytes: Option<i64> = tx
        .conn()
        .query_row(
            "SELECT octet_length(data) FROM r WHERE t=?1 AND id=?2",
            params![t, id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(bytes) = bytes else { return Ok(None) };
    Meter::new(Ceilings::job(), Cut::Abort).heap(
        (bytes.max(0) as u64)
            .saturating_mul(64)
            .saturating_add(8192),
    )?;
    let text: String = tx.conn().query_row(
        "SELECT data FROM r WHERE t=?1 AND id=?2",
        params![t, id],
        |r| r.get(0),
    )?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| refuse(e.to_string()))
}
fn write(tx: &Tx<'_>, t: i64, id: &str, row: &Value) -> Result<(), RuntimeError> {
    tx.conn().execute("INSERT INTO r(t,id,data) VALUES(?1,?2,?3) ON CONFLICT(t,id) DO UPDATE SET data=excluded.data",params![t,id,canonical_json(row)])?;
    super::movement::rewrite(tx,t,id,row)?;
    Ok(())
}
fn value(
    tx: &Tx<'_>,
    t: i64,
    id: &str,
    row: &Value,
    c: &str,
) -> Result<Option<Value>, RuntimeError> {
    if let Ok(v) = row.field(c) {
        return Ok(Some(v.clone()));
    }
    let text: Option<String> = tx
        .conn()
        .query_row(
            "SELECT data FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",
            params![t, id, c],
            |r| r.get(0),
        )
        .optional()?;
    text.map(|s| serde_json::from_str(&s).map_err(|e| refuse(e.to_string())))
        .transpose()
}
fn transfer(
    tx: &Tx<'_>,
    v: &Value,
    from: (&str, &str, &str),
    to: (&str, &str, &str),
) -> Result<(), RuntimeError> {
    if let Value::Array(vs) = v {
        for v in vs {
            transfer(tx, v, from, to)?;
        }
        return Ok(());
    }
    if v == &Value::Null {
        return Ok(());
    }
    let id = crate::assets::asset_id(Some(v))
        .ok_or_else(|| refuse("extraction asset has no typed ledger id"))?;
    let bytes:Option<i64>=tx.conn().query_row("SELECT bytes FROM _assets WHERE id=?1 AND home_table=?2 AND home_id=?3 AND home_column=?4 AND released_at IS NULL",params![id,from.0,from.1,from.2],|r|r.get(0)).optional()?;
    let bytes = bytes.ok_or_else(|| {
        refuse(format!(
            "extraction asset {id} has no live source home; never claim or duplicate it"
        ))
    })?;
    let root = tx
        .meta("activation_asset_root")?
        .ok_or_else(|| refuse("extraction requires activation asset custody"))?;
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(refuse("invalid extraction asset id"));
    }
    let path = std::path::Path::new(&root).join(id);
    let meta = std::fs::symlink_metadata(&path)
        .map_err(|_| refuse(format!("extraction asset {id} bytes are unavailable")))?;
    if !meta.is_file() || meta.len() != bytes as u64 {
        return Err(refuse(format!(
            "extraction asset {id} byte length disagrees with its ledger"
        )));
    }
    if from != to {
    tx.conn().execute(
        "UPDATE _assets SET home_table=?2,home_id=?3,home_column=?4 WHERE id=?1",
        params![id, to.0, to.1, to.2],
    )?;
    }
    Ok(())
}
pub(super) fn transition(
    tx: &Tx<'_>,
    next: &Schema,
    previous: Option<&Schema>,
    sources: &BTreeMap<String, Table>,
    report: &mut super::adoption_report::AdoptionReport,
) -> Result<(), RuntimeError> {
    if next.extractions.is_empty() && previous.is_none_or(|s| s.extractions.is_empty()) {
        return Ok(());
    }
    tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _extraction_rows(definition TEXT NOT NULL,parent_t INTEGER NOT NULL,parent_id TEXT NOT NULL,child_t INTEGER NOT NULL,child_id TEXT NOT NULL,PRIMARY KEY(definition,parent_t,parent_id),UNIQUE(definition,child_t,child_id)) WITHOUT ROWID;")?;
    tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _extraction_cells(definition TEXT NOT NULL,parent_t INTEGER NOT NULL,parent_id TEXT NOT NULL,column_name TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(definition,parent_t,parent_id,column_name)) WITHOUT ROWID;")?;
    tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _extraction_active(child_t INTEGER NOT NULL,definition TEXT NOT NULL,parent_name TEXT NOT NULL,reference_column TEXT NOT NULL,PRIMARY KEY(child_t,definition)) WITHOUT ROWID; DELETE FROM _extraction_active;")?;
    for e in &next.extractions {
        tx.conn().execute(
            "INSERT INTO _extraction_active VALUES(?1,?2,?3,?4)",
            params![tx.num(&e.child)?, key(tx,e)?, e.parent, e.reference],
        )?;
    }
    tx.set_meta("version", super::table_renames::VERSION)?;
    for e in previous
        .into_iter()
        .flat_map(|s| &s.extractions)
        .filter(|e| !next.extractions.contains(e))
    {
        let Some(parent) = next.table(&e.parent) else {
            continue;
        };
        let child = &previous.unwrap().tables[&e.child];
        let pt = tx.num(&e.parent)?;
        let ct = tx.num(&e.child)?;
        let key = key(tx,e)?;
        let mut count = 0;
        let inherited = child
            .through
            .as_ref()
            .is_some_and(|t| t.reference == e.reference && t.parent == e.parent);
        let current_parent = &previous.unwrap().tables[&e.parent];
        if parent.rules.read != crate::schema::RuleExpr::Deny
            && ((inherited && parent.rules.read != current_parent.rules.read)
                || (!inherited && parent.rules.read != child.rules.read))
        {
            return Err(refuse(
                "reverse extraction would broaden the current asset audience; preserve current read policy in an authored bridge",
            ));
        }
        for (dest, source) in &e.fields {
            if asset(&child.columns[dest])
                && parent.columns.contains_key(source)
                && parent.column_reads.get(source) != child.column_reads.get(dest)
            {
                return Err(refuse(
                    "reverse extraction would change the asset column audience; retain its current gate in a bridge",
                ));
            }
        }
        if e.each { each::backward(tx,e,parent,current_parent,child,&key,report)?; continue; }
        super::activation::walk(tx, pt, |id, mut row| {
            let saved:Option<String>=tx.conn().query_row("SELECT child_id FROM _extraction_rows WHERE definition=?1 AND parent_t=?2 AND parent_id=?3",params![key,pt,id],|r|r.get(0)).optional()?;
            let child_id = if let Some(id) = saved {
                id
            } else {
                let mut found = Vec::new();
                super::activation::walk(tx, ct, |child_id, child| {
                    if child.field(&e.reference) == Ok(&Value::Id(id.into())) {
                        if found.len() < 2 {
                            found.push(child_id.to_owned());
                        }
                    }
                    Ok(())
                })?;
                if found.len() > 1 {
                    return Err(refuse(format!(
                        "extraction {} parent {id} via {}: several child rows compete for {}; run rollback --check --bridge <new-dir>, keep the child population visible, choose a truthful old representation with an authorized mutation, then preview exact rollback",
                        e.child,e.reference,e.fields.keys().cloned().collect::<Vec<_>>().join(", ")
                    )));
                }
                let Some(child) = found.pop() else {
                    return Ok(());
                };
                child
            };
            let Some(mut image) = load(tx, ct, &child_id)? else {
                return Err(refuse(format!(
                    "extraction child {}/{child_id} was deleted; old asset has no truthful representation",
                    e.child
                )));
            };
            if image.field(&e.reference) != Ok(&Value::Id(id.into())) {
                return Err(refuse(
                    "extraction child reference changed; refusing to rebind its parent lifetime",
                ));
            }
            let anchored:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND parent_t=?4 AND parent_id=?5 AND invalid=0)",params![ct,child_id,format!("$extract:{key}"),pt,id],|r|r.get(0))?;
            if !anchored {
                return Err(refuse(
                    "extraction child lacks valid parent-lifetime evidence; refusing deletion/id reuse or retrospective recapture",
                ));
            }
            for (destination, source) in &e.fields {
                let kind = &child.columns[destination];
                if !asset(kind) {
                    if row.field(source).ok() != image.field(destination).ok() {
                        return Err(refuse(
                            "extraction immutable scalar copies disagree with the current parent",
                        ));
                    }
                    continue;
                }
                if !parent.columns.contains_key(source) {
                    continue;
                }
                let v = image.field(destination)?.clone();
                crate::engine::validate::validate_column(&e.parent,source,&parent.columns[source],Some(&v))
                    .map_err(|error|refuse(format!("reverse extraction {}.{} → {}.{source}: {error}; keep a widened bridge, repair this child through an authorized mutation, then preview exact rollback",e.child,destination,e.parent)))?;
                retain_cell(tx, &key, pt, id, source, &v)?;
                transfer(
                    tx,
                    &v,
                    (&e.child, &child_id, destination),
                    (&e.parent, id, source),
                )?;
                fields(&mut row)?.insert(source.clone(), v);
                fields(&mut image)?.remove(destination);
                tx.conn().execute(
                    "DELETE FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",
                    params![pt, id, source],
                )?;
            }
            write(tx, pt, id, &row)?;
            write(tx, ct, &child_id, &image)?;
            tx.conn().execute(
                "INSERT OR IGNORE INTO _extraction_rows VALUES(?1,?2,?3,?4,?5)",
                params![key, pt, id, ct, child_id],
            )?;
            count += 1;
            Ok(())
        })?;
        report.backfills.push(format!(
            "extract {}: moved asset homes back for {count} parent rows",
            e.child
        ));
    }
    for e in next
        .extractions
        .iter()
        .filter(|e| previous.is_none_or(|s| !s.extractions.contains(e)))
    {
        e.admit(next).map_err(refuse)?;
        // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — probes retain the selected source definition's schema, including a newly declared parent.
        let (parent, source_context) = if let Some(parent) = sources.get(&e.parent) {
            (parent, sources)
        } else {
            (&next.tables[&e.parent], &next.tables)
        };
        let child = &next.tables[&e.child];
        let pt = tx.num(&e.parent)?;
        let ct = tx.num(&e.child)?;
        let key = key(tx,e)?;
        let mut count = 0;
        let inherited = child
            .through
            .as_ref()
            .is_some_and(|t| t.reference == e.reference && t.parent == e.parent);
        let source_read = &parent.rules.read;
        if !probe_context(source_read,source_context,next) {return Err(refuse(format!("extraction {} → {}: source read rule `{}` has changed probe/index meaning; retain its typed lookup context in a bridge",e.parent,e.child,source_read.quarry())));}

        if inherited {
            if !audience_subset(&next.tables[&e.parent].rules.read,source_read) {
                return Err(refuse(
                    "asset extraction cannot broaden the inherited parent read policy; stage an explicit policy change separately",
                ));
            }
        } else if child.rules.read != crate::schema::RuleExpr::Deny {
            if !audience_subset(&child.rules.read,&mapped_audience(parent,child,e,source_read))
            {
                return Err(refuse(
                    "asset extraction requires read through its parent for row-dependent privacy; the destination cannot broaden the source audience",
                ));
            }
        }
        for (dest, source) in &e.fields {
            if let Some(parent_gate)=parent.column_reads.get(source) {
                // Immutable mapped scalar copies are the same authoritative
                // values, so a stricter child audience can name those copies.
                if !probe_context(parent_gate,source_context,next) {return Err(refuse(format!("extraction {}.{source} → {}.{dest}: source payload rule `{}` has changed probe/index meaning; retain its lookup context in a bridge",e.parent,e.child,parent_gate.quarry())));}
                let transported=mapped_audience(parent,child,e,parent_gate);
                let gate=&transported;
                let covered=child.column_reads.get(dest).is_some_and(|g|audience_subset(g,gate))
                    || (inherited&&audience_subset(&next.tables[&e.parent].rules.read,parent_gate))
                    || (!inherited&&audience_subset(&child.rules.read,gate));
                if !covered {return Err(refuse(format!("extraction {}.{source} → {}.{dest}: preserve source read rule `{}` on the child column or through its parent; an authored stricter audience is allowed",e.parent,e.child,parent_gate.quarry())));}
            }
        }
        let populated: bool =
            tx.conn()
                .query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t=?1)", [pt], |r| {
                    r.get(0)
                })?;
        let consumed_each=e.each && !parent.columns.contains_key(each::source(e,child));
        // @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — definition custody survives an empty parent population; every resumed child still needs its original anchor.
        let resume_each=consumed_each && each::known(tx,&key)?;
        if consumed_each && !resume_each {
            let child_history:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t=?1) OR EXISTS(SELECT 1 FROM _dormant_rows WHERE t=?1) OR EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1) OR EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1)",[ct],|r|r.get(0))?;
            if populated || child_history {return Err(refuse("extract each source list is absent and no successfully applied extraction owns this suspended definition; preserve independent child history in an authored bridge"));}
        }
        for (dest, source) in e.fields.iter().filter(|_| populated) {
            if resume_each && asset(&child.columns[dest]) {continue;}
            let kind = parent.columns.get(source).ok_or_else(|| {
                refuse(format!("extraction source {}.{source} is absent", e.parent))
            })?;
            let same = if e.each && asset(&child.columns[dest]) {each::item_type(kind)==Some(&child.columns[dest])} else {payload_accepts(kind, &child.columns[dest])};
            if !same
                || parent.engine_field(source)
                || parent.maintained.contains_key(source)
                || parent.written_by.contains_key(source)
            {
                return Err(refuse(
                    format!("extraction {}.{source} → {}.{dest} requires identical authoritative element types with inclusive list bounds or required → optional widening",e.parent,e.child),
                ));
            }
            if asset(kind) && next.tables[&e.parent].columns.contains_key(source) {
                return Err(refuse(
                    "extraction must remove the source asset column; one asset cannot have two active homes",
                ));
            }
            if !asset(kind)&&(!parent.constraints.iter().any(|c|matches!(c,crate::schema::Constraint::Immutable{fields} if fields.contains(source)))||matches!(kind,ColumnType::Ref{..}|ColumnType::Optional(_))){return Err(refuse("extraction scalar copies require immutable source fields without reference/captured authority"))}
        }
        if e.each { if resume_each {each::resume(tx,e,parent,child,&key,report)?;}else{each::forward(tx,e,parent,child,&key,report)?;} continue; }
        super::activation::walk(tx, pt, |id, mut row| {
            let saved:Option<String>=tx.conn().query_row("SELECT child_id FROM _extraction_rows WHERE definition=?1 AND parent_t=?2 AND parent_id=?3",params![key,pt,id],|r|r.get(0)).optional()?;
            let child_id = saved.clone().unwrap_or_else(|| id.to_owned());
            let present = load(tx, ct, &child_id)?;
            let independent:bool=if saved.is_none(){tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_rows WHERE t=?1 AND id=?2) OR EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2) OR EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2) OR EXISTS(SELECT 1 FROM _extraction_rows WHERE child_t=?1 AND child_id=?2)",params![ct,child_id],|r|r.get(0))?}else{false};
            if saved.is_none() && (present.is_some()||independent) {
                return Err(refuse(format!(
                    "extraction destination {}/{child_id} already has independent history",
                    e.child
                )));
            }
            if saved.is_some(){
                let anchored:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND parent_t=?4 AND parent_id=?5 AND invalid=0)",params![ct,child_id,format!("$extract:{key}"),pt,id],|r|r.get(0))?;
                if present.is_none()||!anchored{return Err(refuse("returning extraction lacks its receipt-owned child or valid parent-lifetime evidence; never recreate pruned/deleted history"))}
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
                return Err(refuse("extraction cannot rebind a child parent"));
            }
            for (destination, source) in &e.fields {
                let kind = &child.columns[destination];
                let Some(v) = value(tx, pt, id, &row, source)? else {
                    continue;
                };
                if asset(kind) {
                    if image.field(destination).is_ok_and(|old| old != &v && !(saved.is_some() && old == &Value::Null)) {
                        return Err(refuse(
                            "extraction destination asset conflicts with its source",
                        ));
                    }
                    retain_cell(tx, &key, pt, id, source, &v)?;
                    transfer(
                        tx,
                        &v,
                        (&e.parent, id, source),
                        (&e.child, &child_id, destination),
                    )?;
                    fields(&mut image)?.insert(destination.clone(), v);
                    fields(&mut row)?.remove(source);
                    tx.conn().execute(
                        "DELETE FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",
                        params![pt, id, source],
                    )?;
                } else if saved.is_none() {
                    fields(&mut image)?.insert(destination.clone(), v);
                } else if image.field(destination).ok() != Some(&v) {
                    return Err(refuse(
                        "extraction immutable scalar copies disagree with the returning parent",
                    ));
                }
            }
            crate::schema::materialize_optional_fields(&mut image, child);
            write(tx, pt, id, &row)?;
            write(tx, ct, &child_id, &image)?;
            tx.conn().execute(
                "INSERT OR IGNORE INTO _extraction_rows VALUES(?1,?2,?3,?4,?5)",
                params![key, pt, id, ct, child_id],
            )?;
            super::dormant::capture_refs(
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
            Ok(())
        })?;
        report.backfills.push(format!(
            "extract {}: prepared {count} child rows and moved existing asset homes",
            e.child
        ));
    }
    tx.set_meta("activation_population", "true")?;
    Ok(())
}
pub(super) fn delete(tx: &Tx<'_>, t: i64, id: &str) -> Result<(), RuntimeError> {
    if exists(tx)? {
        each::delete(tx,t,id)?;
        tx.conn().execute(
            "DELETE FROM _extraction_cells WHERE parent_t=?1 AND parent_id=?2",
            params![t, id],
        )?;
        tx.conn().execute("DELETE FROM _extraction_rows WHERE (parent_t=?1 AND parent_id=?2) OR (child_t=?1 AND child_id=?2)",params![t,id])?;
    }
    Ok(())
}

pub(super) fn observe_write(
    tx: &Tx<'_>,
    t: i64,
    id: &str,
    row: &Value,
    old: Option<&Value>,
) -> Result<(), RuntimeError> {
    if !exists(tx)? {
        return Ok(());
    }
    let active:Vec<(String,String,String)>=tx.conn().prepare("SELECT definition,parent_name,reference_column FROM _extraction_active WHERE child_t=?1")?.query_map([t],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<Result<_,_>>()?;
    for (key, parent, column) in active {
        let binding = format!("$extract:{key}");
        // @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — only birth or a real reference change can capture a parent lifetime; an asset edit cannot repair missing provenance.
        if old.is_some_and(|old| old.field(&column).ok() == row.field(&column).ok()) {
            continue;
        }
        if let Ok(value) = row.field(&column) {
            super::dormant::capture_refs(
                tx,
                t,
                id,
                &binding,
                &ColumnType::Ref { table: parent },
                value,
            )?;
        }
    }
    Ok(())
}

fn retain_cell(
    tx: &Tx<'_>,
    key: &str,
    t: i64,
    id: &str,
    column: &str,
    value: &Value,
) -> Result<(), RuntimeError> {
    let old: Option<String> = tx
        .conn()
        .query_row(
            "SELECT data FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",
            params![t, id, column],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = old {
        let old: Value = serde_json::from_str(&old).map_err(|e| refuse(e.to_string()))?;
        if &old != value {
            return Err(refuse(
                "extraction has a distinct retained source cell; preserve both meanings in an authored bridge",
            ));
        }
    }
    tx.conn().execute("INSERT INTO _extraction_cells VALUES(?1,?2,?3,?4,?5) ON CONFLICT(definition,parent_t,parent_id,column_name) DO UPDATE SET data=excluded.data",params![key,t,id,column,canonical_json(value)])?;
    Ok(())
}

#[cfg(test)]
mod payload_tests {
    use super::*;
    #[test]
    fn collection_inclusion_preserves_elements_optional_direction_and_both_bounds() {
        let list=|min,max|ColumnType::ListRange{of:Box::new(ColumnType::Text{max:20}),min,max};
        assert!(payload_accepts(&list(1,12),&ColumnType::List{of:Box::new(ColumnType::Text{max:20}),max:12}));
        assert!(payload_accepts(&list(1,12),&list(0,20)));
        assert!(payload_accepts(&list(1,12),&ColumnType::Optional(Box::new(list(0,20)))));
        assert!(!payload_accepts(&list(0,12),&list(1,12)));
        assert!(!payload_accepts(&list(1,12),&list(1,11)));
        assert!(!payload_accepts(&list(1,12),&ColumnType::List{of:Box::new(ColumnType::Text{max:21}),max:12}));
        assert!(!payload_accepts(&ColumnType::Optional(Box::new(list(1,12))),&list(0,20)));
    }
}
