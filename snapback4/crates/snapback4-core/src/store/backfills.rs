//! Release backfills use the same activation transaction as retention and indexes.
// @ref LLP 3000.000.000.002#3-adoption-and-reversibility — stage every result before mutating the input snapshot.
use super::*;
use crate::{schema::{backfill::Backfill, materialize_optional_fields}, engine::{Context, runner::Runner}, meter::{Ceilings, Cut, Meter}};
use std::collections::{BTreeMap, BTreeSet};
pub(crate) const VERSION: &str = "snapback4-release-store-4";
fn refusal(message: impl Into<String>) -> RuntimeError { RuntimeError::Structural { code:"E_ADOPT", message:message.into() } }
fn present(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_backfill_evidence')",[],|r|r.get(0))?)
}
fn enable(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _backfill_evidence(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,inputs TEXT NOT NULL,before_image TEXT NOT NULL,after_image TEXT NOT NULL,active INTEGER NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(t,id,definition)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_pruned(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(t,id,definition)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_definitions(digest TEXT PRIMARY KEY,definition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _backfill_absence(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,column_name TEXT NOT NULL,PRIMARY KEY(t,id,definition,column_name)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_inputs(t INTEGER NOT NULL,column_name TEXT NOT NULL,PRIMARY KEY(t,column_name)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_active(t INTEGER NOT NULL,definition TEXT NOT NULL,input_names TEXT NOT NULL,PRIMARY KEY(t,definition)) WITHOUT ROWID;")?;
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='epoch')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute_batch("ALTER TABLE _backfill_evidence ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;")?;
    }
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_active') WHERE name='input_names')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute_batch("ALTER TABLE _backfill_active ADD COLUMN input_names TEXT NOT NULL DEFAULT '[]';")?;
    }
    tx.set_meta("version", VERSION)
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Evidence { #[serde(default)] absent:BTreeSet<String>, #[serde(default)] epoch:i64, active:bool, inputs: Value, before: BTreeMap<String,Value>, after: BTreeMap<String,Value> }
fn evidence(tx: &Tx<'_>, t:i64,id:&str,key:&str) -> Result<Option<Evidence>,RuntimeError> {
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(inputs)+octet_length(before_image)+octet_length(after_image) FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|r.get(0)).optional()?;
    let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap(bytes.unwrap_or(0).max(0) as u64 * 64 + 8192)?;
    let value:Option<(String,String,String,bool,i64)>=tx.conn().query_row("SELECT inputs,before_image,after_image,active,epoch FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    value.map(|(inputs,before,after,active,epoch)|Ok(Evidence {absent:absence(tx,t,id,key)?,epoch,active,inputs:decode(&inputs)?,before:decode(&before)?,after:decode(&after)?})).transpose()
}
fn decode<T:serde::de::DeserializeOwned>(s:&str)->Result<T,RuntimeError>{serde_json::from_str(s).map_err(|e|RuntimeError::Store(e.to_string()))}
fn absence(tx:&Tx<'_>,t:i64,id:&str,key:&str)->Result<BTreeSet<String>,RuntimeError>{
    Ok(tx.conn().prepare("SELECT column_name FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition=?3")?.query_map(params![t,id,key],|r|r.get(0))?.collect::<Result<_,_>>()?)
}
fn save(tx:&Tx<'_>,t:i64,id:&str,key:&str,e:&Evidence,active:bool)->Result<(),RuntimeError>{
    tx.conn().execute("INSERT INTO _backfill_evidence(t,id,definition,inputs,before_image,after_image,active,epoch) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(t,id,definition) DO UPDATE SET inputs=excluded.inputs,before_image=excluded.before_image,after_image=excluded.after_image,active=excluded.active,epoch=excluded.epoch",params![t,id,key,canonical_json(&e.inputs),canonical_json(&e.before),canonical_json(&e.after),active,e.epoch])?;
    tx.conn().execute("DELETE FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key])?;
    tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key])?;
    for c in &e.absent {tx.conn().execute("INSERT INTO _backfill_absence VALUES(?1,?2,?3,?4)",params![t,id,key,c])?;}
    Ok(())
}
pub(super) fn delete(tx:&Tx<'_>,t:i64,id:&str)->Result<(),RuntimeError>{
    if present(tx)? {
        tx.conn().execute("DELETE FROM _backfill_evidence WHERE t=?1 AND id=?2",params![t,id])?;
        tx.conn().execute("DELETE FROM _backfill_pruned WHERE t=?1 AND id=?2",params![t,id])?;
        tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2",params![t,id])?;
    } Ok(())
}
// Never archive reference/asset preimages without lifetime evidence. New reference
// fields are safe: subsequent retirement is owned by the ordinary dormant ledger.
fn source_owned(table:&Table,column:&str)->bool {
    table.expire.as_deref()==Some(column) || table.not_before.as_deref()==Some(column) || table.engine_field(column) || table.maintained.contains_key(column)
}
// A restored narrowed row owns its archived definition, independently of the
// table-wide schema currently selected for other rows.
fn row_source<'a>(tx:&Tx<'_>,t:i64,id:&str,fallback:Option<&'a Table>)->Result<Option<std::borrow::Cow<'a,Table>>,RuntimeError>{
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(definition) FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
    let Some(bytes)=bytes else{return Ok(fallback.map(std::borrow::Cow::Borrowed))};
    let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((bytes.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
    let definition:String=tx.conn().query_row("SELECT definition FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0))?;
    let mut historical:Table=decode(&definition)?;
    // Later predecessor additions also apply to returning rows. Preserve each
    // original column's own type/default/ownership; import only absent columns.
    if let Some(current)=fallback {for (column,kind) in &current.columns {
        if historical.columns.contains_key(column){continue;}
        historical.columns.insert(column.clone(),kind.clone());
        if let Some(default)=current.defaults.get(column){historical.defaults.insert(column.clone(),default.clone());}
        if let Some(owner)=current.maintained.get(column){historical.maintained.insert(column.clone(),owner.clone());}
        if let Some(owner)=current.recorded.get(column){historical.recorded.insert(column.clone(),owner.clone());}
    }}
    Ok(Some(std::borrow::Cow::Owned(historical)))
}
fn protected(kind:&crate::schema::ColumnType)->bool {
    use crate::schema::ColumnType::*;
    match kind {Optional(k)=>protected(k),Ref{..}|Image{..}|Video{..}|File{..}|List{..}|ListRange{..}=>true,_=>false}
}
pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,sources:&BTreeMap<String,Table>,now:i64,report:&mut super::adoption_report::AdoptionReport)->Result<(),RuntimeError>{
    if next.backfills.is_empty() && previous.is_none_or(|s|s.backfills.is_empty()) && !present(tx)? { return Ok(()); }
    enable(tx)?;
    for fill in &next.backfills {
        fill.admit(next).map_err(refusal)?;
        if let Some(old)=sources.get(&fill.table) {for c in &fill.outputs {
            if source_owned(old,c) {
                return Err(refusal(format!("backfill {} {}: output {c} is a historical lifetime or engine field; preserve its source meaning in a bridge",fill.table,fill.name)));
            }
        }}
    }
    // A name is immutable within a continuous lineage. Replacing a transform
    // deliberately goes through an old-source/bridge transition first.
    if let Some(old)=previous {for f in &next.backfills {if old.backfills.iter().any(|p|p.table==f.table && p.name==f.name && p.key()!=f.key()) {return Err(refusal(format!("backfill {} {} changed; use a new name in a bridge release rather than replacing historical meaning",f.table,f.name)));}}}
    for fill in &next.backfills {
        tx.conn().execute("INSERT OR IGNORE INTO _backfill_definitions VALUES(?1,?2)",params![fill.key(),canonical_json(fill)])?;
    }
    let next_keys:BTreeSet<_>=next.backfills.iter().map(Backfill::key).collect();
    let definitions:Vec<Backfill>=tx.conn().prepare("SELECT definition FROM _backfill_definitions WHERE digest IN (SELECT definition FROM _backfill_evidence WHERE active=1 UNION SELECT definition FROM _backfill_pruned WHERE active=1) ORDER BY digest")?.query_map([],|r|r.get::<_,String>(0))?.map(|s|decode(&s?)).collect::<Result<_,RuntimeError>>()?;
    for fill in definitions.iter().rev().filter(|f|!next_keys.contains(&f.key())) {
        let Some(table)=next.table(&fill.table) else {continue};
        let t=tx.num(&fill.table)?;let key=fill.key();let mut bad=super::adopt_refusals::Samples::default();let mut count=0;
        super::activation::walk(tx,t,|id,mut row|{
            let Some(e)=evidence(tx,t,id,&key)? else {
                let pruned:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3 AND active=1)",params![t,id,key],|r|r.get(0))?;
                if pruned && fill.outputs.iter().any(|c|table.columns.contains_key(c)) {bad.add(id,"rollback preimage was explicitly pruned; select a bridge preserving current data or restore a backup");}
                return Ok(())
            };
            if !e.active {return Ok(())}
            let fields=match &mut row {Value::Row(f)|Value::Map(f)=>f,_=>return Err(refusal("invalid stored row"))};
            let mut changed=false;
            for c in &fill.outputs {if table.columns.contains_key(c) {
                let current=fields.get(c);let before=e.before.get(c);let after=e.after.get(c);
                if current!=after && current!=before {bad.add(id,&format!("{}.{} changed after backfill {}; keep a bridge and repair through an authorized mutation before rollback",fill.table,c,fill.name));return Ok(())}
                if let Some(value)=before {fields.insert(c.clone(),value.clone());}else{fields.remove(c);}
                changed=true;
            }}
            if changed {tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;count+=1;}
            save(tx,t,id,&key,&e,false)
        })?;
        if bad.count>0 {return Err(refusal(format!("backfill {} {} rollback: {}",fill.table,fill.name,bad.describe())))}
        if count>0 {report.backfills.push(format!("{} {} reversed on {count} {}",fill.table,fill.name,if count==1 {"row"}else{"rows"}));tx.set_meta("activation_population","true")?;}
    }
    let old_keys:BTreeSet<_>=previous.into_iter().flat_map(|s|s.backfills.iter().map(Backfill::key)).collect();
    let restored_tables:BTreeSet<i64>=tx.conn().prepare("SELECT DISTINCT n.t FROM _dormant_narrow_rows n WHERE EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id)")?.query_map([],|r|r.get(0))?.collect::<Result<_,_>>()?;
    let entering:Vec<_>=next.backfills.iter().filter(|f|!old_keys.contains(&f.key()) || tx.num(&f.table).is_ok_and(|t|restored_tables.contains(&t))).collect();
    if entering.is_empty(){return Ok(())}
    let populated = entering.iter().try_fold(false, |any,fill| -> Result<bool,RuntimeError> {
        Ok(any || tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t=?1)",[tx.num(&fill.table)?],|r|r.get::<_,bool>(0))?)
    })?;
    if !populated {return Ok(())}
    let mut source=previous.cloned().unwrap_or_default();source.tables=sources.clone();source.backfills.clear();
    // Point lookup indexes are rebuilt against the assembled source images,
    // including restored rows, before any output patch is applied.
    let mut reads=BTreeSet::new();
    for f in &entering {collect_reads(&f.program.body,&mut reads);}
    for (name,index) in &reads {
        let wanted=next.table(name).and_then(|t|t.index(&index)).ok_or_else(||refusal("backfill lookup index absent"))?;
        let old_table=source.tables.get_mut(name).ok_or_else(||refusal(format!("backfill lookup source {name} has no historical definition")))?;
        if !wanted.is_plain() || wanted.columns().iter().any(|c|c!="id" && !old_table.columns.contains_key(c)) {return Err(refusal(format!("backfill lookup {name}.{index} requires predecessor fields; use an indexed bridge")))}
        old_table.indexes.insert(index.clone(),wanted.clone());
    }
    tx.conn().execute_batch("CREATE TEMP TABLE _backfill_pending(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,patch TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(t,id,definition)) WITHOUT ROWID;")?;
    tx.conn().execute_batch("CREATE TEMP TABLE _backfill_originals(t INTEGER NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,id)) WITHOUT ROWID;")?;
    let entering_keys:BTreeSet<_>=entering.iter().map(|f|f.key()).collect();
    let mut epochs=BTreeSet::from([None]);
    for key in &entering_keys {
        let mut q=tx.conn().prepare("SELECT DISTINCT epoch FROM _backfill_evidence WHERE definition=?1 AND EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_evidence.t AND r.id=_backfill_evidence.id)")?;
        for epoch in q.query_map([key],|r|r.get::<_,i64>(0))? {epochs.insert(Some(epoch?));}
    }
    let fresh_epoch=tx.meta("generation")?.and_then(|s|s.parse::<i64>().ok()).unwrap_or(0).saturating_add(1);
    for epoch in epochs {
        restore_snapshot(tx)?;
        if let Some(epoch)=epoch {
            historical_snapshot(tx,epoch,&next_keys)?;
            inactive_snapshot(tx,previous,&entering_keys,epoch)?;
        }
        rebuild_reads(tx,&source,&reads)?;
    for fill in &entering {

        let t=tx.num(&fill.table)?;let key=fill.key();let table=&next.tables[&fill.table];let mut bad=super::adopt_refusals::Samples::default();let mut count=0;
        super::activation::walk(tx,t,|id,mut row|{
            if old_keys.contains(&key) && !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2)",params![t,id],|r|r.get::<_,bool>(0))? {return Ok(())}
            let row_source=row_source(tx,t,id,sources.get(&fill.table))?;
            if let Some(old)=row_source.as_deref() {if let Some(c)=fill.outputs.iter().find(|c|source_owned(old,c)) {
                bad.add(id,&format!("output {c} is a historical lifetime or engine field; preserve its source meaning in a bridge"));return Ok(())
            }}
            let prior=evidence(tx,t,id,&key)?;
            if prior.as_ref().map(|e|e.epoch)!=epoch {return Ok(())}
            let original:Option<String>=tx.conn().query_row("SELECT data FROM temp._backfill_originals WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
            let current:Value=if let Some(text)=original {decode(&text)?}else{row.clone()};
            if prior.is_none() && tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3)",params![t,id,key],|r|r.get::<_,bool>(0))? {
                bad.add(id,"historical backfill evidence was explicitly pruned; cannot safely re-enter this declaration; use a new bridge or restore a backup");return Ok(())
            }
            for c in fill.inputs.keys() {
                if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,c],|r|r.get::<_,bool>(0))? {
                    bad.add(id,&format!("historical reference {}.{c} lost its parent lifetime",fill.table));return Ok(())
                }
            }
            let physically_absent=absence(tx,t,id,"")?;
            let native=absence(tx,t,id,&format!("$native:{key}"))?;
            if prior.is_none() && !native.is_empty() {
                let native_inputs=native_inputs(tx,t,id,&current,fill.inputs.keys().filter(|c|!fill.outputs.contains(*c)).map(String::as_str),row_source.as_deref())?;
                if fill.inputs.iter().any(|(c,kind)|!fill.outputs.contains(c) && !physically_absent.contains(c) && crate::engine::validate::validate_column(&fill.table,c,kind,native_inputs.get(c)).is_err()) {
                    bad.add(id,"native image has an invalid present historical input; use a typed bridge");return Ok(())
                }
                let mut conflict=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_pruned WHERE t=?1 AND id=?2)",params![t,id],|r|r.get::<_,bool>(0))?;
                let others:Vec<String>=tx.conn().prepare("SELECT definition FROM _backfill_evidence WHERE t=?1 AND id=?2")?.query_map(params![t,id],|r|r.get(0))?.collect::<Result<_,_>>()?;
                for other in others {if let Some(e)=evidence(tx,t,id,&other)? {
                    for c in fill.outputs.intersection(&e.after.keys().cloned().collect()) {
                        if e.active || current.field(c).ok()!=e.before.get(c) {conflict=true;}
                    }
                }}
                if conflict {
                    bad.add(id,"native output also has a different transformation's history; resolve its intended view in a bridge");return Ok(())
                }
                let complete=fill.outputs.iter().all(|c|current.field(c).is_ok() && validate_output(&fill.table,table,c,current.field(c).unwrap()).is_ok());
                let fingerprint=crate::value::digest(&native_inputs);
                if !complete {bad.add(id,"native backfill output image is missing or was explicitly pruned; use a bridge or restore a backup");return Ok(())}
                if !native.contains(&fingerprint) {bad.add(id,"native backfill inputs changed after row creation; preserve the authored output in a bridge before re-entry");return Ok(())}
                return Ok(())
            }
            let original_absence=prior.as_ref().filter(|e|e.active).map_or_else(||physically_absent.intersection(&fill.inputs.keys().cloned().collect()).cloned().collect(),|e|e.absent.clone());
            // Resolve retained inputs before source defaults can synthesize null
            // for a hidden optional column with a provided archived cell.
            let retained=native_inputs(tx,t,id,&row,fill.inputs.keys().map(String::as_str),row_source.as_deref())?;
            if let Some(table)=row_source.as_deref(){materialize_optional_fields(&mut row,table);}
            let historical=row.clone();
            let mut args=BTreeMap::new();
            for (c,kind) in &fill.inputs {
                let value=retained.get(c).cloned();
                if crate::engine::validate::validate_column(&fill.table,c,kind,value.as_ref()).is_err() {
                    bad.add(id,&format!("historical input {}.{c} is absent or does not fit {kind}; use a typed bridge to repair it",fill.table));return Ok(())
                }
                if let Some(prior)=&prior {if prior.inputs.field(c).ok()==value.as_ref() {
                    let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(&key,c)],|r|r.get(0))?;
                    if invalid {bad.add(id,&format!("historical backfill reference {c} lost its parent lifetime"));return Ok(())}
                }}
                args.insert(c.clone(),value.unwrap_or(Value::Null));
            }
            let inputs=Value::Row(args.clone().into());
            let mut context=Context::system().at(now);context.args=args;
            let mut runner=Runner::new(tx,&source,context,Meter::new(Ceilings::job(),Cut::Abort),0);
            let patch=match runner.run(&fill.program) {Ok(Value::Row(f)|Value::Map(f))=>f.into_iter().collect::<BTreeMap<_,_>>(),Ok(_)=>{bad.add(id,"backfill did not return an object");return Ok(())},Err(e)=>{bad.add(id,&e.to_string());return Ok(())}};
            if runner.read_cut().is_some() {bad.add(id,"historical lookup did not complete; reduce per-row lookup work before adoption");return Ok(())}
            if patch.keys().cloned().collect::<BTreeSet<_>>()!=fill.outputs {return Err(refusal("backfill returned undeclared output fields"))}
            let fields=current.as_object()?;let mut before=prior.as_ref().filter(|e|e.active).map_or_else(BTreeMap::new,|e|e.before.clone());let mut desired=patch.clone();
            for (c,value) in &patch {
                if let Err(e)=validate_output(&fill.table,table,c,value) {bad.add(id,&e.to_string());return Ok(())}
                if let Some(kind)=row_source.as_deref().and_then(|t|t.columns.get(c)) {if protected(kind) && prior.as_ref().is_none_or(|e|e.before.contains_key(c)) {bad.add(id,&format!("cannot overwrite historical reference or asset {}.{c}; derive into a new column",fill.table));return Ok(())}}
                if !prior.as_ref().is_some_and(|e|e.active) && (previous.and_then(|s|s.table(&fill.table)).is_some_and(|t|t.columns.contains_key(c)) || (previous.and_then(|s|s.table(&fill.table)).is_none() && sources.get(&fill.table).is_some_and(|t|t.columns.contains_key(c)))) {
                    if let Some(v)=historical.field(c).ok(){before.insert(c.clone(),v.clone());}
                }
                if let Some(prior)=&prior {
                    let deps_same=prior.inputs==inputs && prior.after==patch;
                    let current=fields.get(c);
                    let original=prior.before.get(c);
                    if deps_same && (prior.active || original.is_none()) && current.is_some() {
                        // Added columns retain edits under v1's dormant storage.
                        desired.insert(c.clone(),current.unwrap().clone());
                    } else if !deps_same && current!=prior.after.get(c) && current!=original {
                        bad.add(id,&format!("{}.{} was edited and its historical inputs changed; keep a bridge and resolve the conflict",fill.table,c));return Ok(())
                    }
                }
            }
            for(c,value)in &desired {if let Err(e)=validate_output(&fill.table,table,c,value){bad.add(id,&e.to_string());return Ok(())}}
            let e=Evidence{absent:original_absence,epoch:epoch.unwrap_or(fresh_epoch),active:true,inputs,before,after:patch};
            tx.conn().execute("INSERT INTO temp._backfill_pending VALUES(?1,?2,?3,?4,?5)",params![t,id,key,canonical_json(&desired),canonical_json(&e)])?;count+=1;
            Ok(())
        })?;
        if bad.count>0{return Err(refusal(format!("backfill {} {}: {}",fill.table,fill.name,bad.describe())))}
        if count>0{report.backfills.push(format!("{} {} transformed {count} {}",fill.table,fill.name,if count==1 {"row"}else{"rows"}));}
    }
    }
    restore_snapshot(tx)?;
    // Stream patches; avoid retaining the whole transformed population in RAM.
    let mut stmt=tx.conn().prepare("SELECT t,id,definition,patch,evidence FROM temp._backfill_pending ORDER BY t,id,definition")?;
    let mut rows=stmt.query([])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;
        let patch:BTreeMap<String,Value>=decode(&r.get::<_,String>(3)?)?;let e:Evidence=decode(&r.get::<_,String>(4)?)?;
        let data:String=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0))?;let mut row:Value=decode(&data)?;
        if let Value::Row(f)|Value::Map(f)=&mut row {f.extend(patch);}
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
        let prior=evidence(tx,t,&id,&key)?;
        save(tx,t,&id,&key,&e,true)?;
        for c in e.after.keys() {tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition='' AND column_name=?3",params![t,id,c])?;}
        let fill=next.backfills.iter().find(|f|f.key()==key).ok_or_else(||refusal("missing historical declaration"))?;
        let row_source=row_source(tx,t,&id,sources.get(&fill.table))?;
        for(c,kind)in &fill.inputs {
            // A generic id argument cannot erase the source column's lifetime.
            let kind=row_source.as_deref().and_then(|t|t.columns.get(c)).filter(|k|protected(k)).unwrap_or(kind);
            if let Ok(value)=e.inputs.field(c) {
                let binding=input_ref(&key,c);
                let saved=prior.as_ref().is_some_and(|p|p.inputs.field(c).ok()==Some(value)) && tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3)",params![t,id,binding],|r|r.get::<_,bool>(0))?;
                if !saved {super::dormant::capture_refs(tx,t,&id,&binding,kind,value)?;}
            }
        }
    }
    drop(rows);drop(stmt);
    tx.conn().execute_batch("DROP TABLE temp._backfill_pending; DROP TABLE temp._backfill_originals;")?;
    // The source-index rebuild and every transformed dependency require full
    // candidate key/cap/maintain validation, even when its declaration is equal.
    tx.set_meta("activation_population","true")?;
    Ok(())
}
fn collect_reads(body:&[crate::ir::Stmt],out:&mut BTreeSet<(String,String)>){
    use crate::ir::{Expr,Stmt};
    fn expr(e:&Expr,out:&mut BTreeSet<(String,String)>){match e{
        Expr::Scan(r)=>{out.insert((r.table.clone(),r.index.clone()));for k in &r.prefix{if let Some(e)=k.scalar(){expr(e,out);}}if let Some(range)=&r.range {for e in [&range.gt,&range.gte,&range.lt,&range.lte].into_iter().flatten(){expr(e,out);}}if let Some(e)=&r.filter{expr(e,out);}},
        Expr::Get(r)|Expr::Exists(r)=>{out.insert((r.table.clone(),r.index.clone()));for e in &r.key{expr(e,out);}},
        Expr::Field{base,..}|Expr::Unary{value:base,..}=>expr(base,out),Expr::Array(es)|Expr::Builtin{args:es,..}=>{for e in es{expr(e,out);}},
        Expr::Object(fs)=>{for e in fs.values(){expr(e,out);}},Expr::Shape{base,fields}=>{expr(base,out);for e in fields.values(){expr(e,out);}},
        Expr::Binary{left,right,..}=>{expr(left,out);expr(right,out);},Expr::Block{body,value}=>{collect_reads(body,out);expr(value,out);},_=>()
    }}
    for s in body{match s{Stmt::Let{value,..}|Stmt::Const{value,..}|Stmt::Assign{value,..}|Stmt::Return(value)=>expr(value,out),Stmt::Require{condition,..}=>expr(condition,out),Stmt::If{condition,then_body,else_body}=>{expr(condition,out);collect_reads(then_body,out);collect_reads(else_body,out);},_=>()}}
}

// Prune forgets historical values, retaining only the fact that exact reversal
// is no longer available. No tombstone can be queried by an app.
pub(super) fn prune(tx:&Tx<'_>)->Result<(),RuntimeError>{
    if present(tx)? {tx.conn().execute_batch("DELETE FROM _backfill_evidence WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_evidence.t AND r.id=_backfill_evidence.id); DELETE FROM _backfill_pruned WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_pruned.t AND r.id=_backfill_pruned.id); INSERT OR IGNORE INTO _backfill_pruned SELECT t,id,definition,active FROM _backfill_evidence; DELETE FROM _backfill_evidence; DELETE FROM _backfill_absence WHERE (definition!='' AND definition NOT LIKE '$native:%') OR NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_absence.t AND r.id=_backfill_absence.id);")?;}
    Ok(())
}
pub(super) fn inventory_sql(conn:&Connection)->Result<&'static str,RuntimeError>{
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_backfill_evidence')",[],|r|r.get(0))?;
    Ok(if exists {" UNION ALL SELECT c.name||'.backfill#'||substr(e.definition,1,12),'backfill',c.name,e.definition FROM _backfill_evidence e JOIN _catalog c ON c.num=e.t GROUP BY e.t,e.definition "}else{""})
}

pub(crate) fn has_evidence(tx:&Tx<'_>)->Result<bool,RuntimeError>{present(tx)}
pub(super) fn columns(tx:&Tx<'_>,next:&Schema)->Result<BTreeMap<String,BTreeSet<String>>,RuntimeError>{
    let mut out:BTreeMap<String,BTreeSet<String>>=BTreeMap::new();
    for f in &next.backfills {out.entry(f.table.clone()).or_default().extend(f.outputs.iter().cloned());}
    if present(tx)? {
        let mut statement=tx.conn().prepare("SELECT definition FROM _backfill_definitions WHERE digest IN (SELECT definition FROM _backfill_evidence WHERE active=1 UNION SELECT definition FROM _backfill_pruned WHERE active=1)")?;
        for text in statement.query_map([],|r|r.get::<_,String>(0))? {
            let f:Backfill=decode(&text?)?;out.entry(f.table).or_default().extend(f.outputs);
        }
    }
    Ok(out)
}
fn validate_lookup(tx:&Tx<'_>,ti:i64,prefix:usize,table:&str,index:&str)->Result<(),RuntimeError>{
    let mut stmt=tx.conn().prepare("SELECT k,id FROM i WHERE ti=?1 ORDER BY k")?;let mut rows=stmt.query([ti])?;
    let mut prior=None;let mut first=String::new();let mut duplicate=false;let mut bad=super::adopt_refusals::Samples::default();
    while let Some(row)=rows.next()? {
        let key:Vec<u8>=row.get(0)?;let id:String=row.get(1)?;let mut group=crate::key::decode(&key).ok_or_else(||refusal("invalid historical lookup key"))?;group.truncate(prefix);
        if group.contains(&Value::Null){continue;}
        if prior.as_ref()==Some(&group) {
            if !duplicate {bad.add(&first,"duplicate historical lookup key");duplicate=true;}
            bad.add(&id,"duplicate historical lookup key");
        }else{prior=Some(group);first=id;duplicate=false;}
    }
    if bad.count>0{return Err(refusal(format!("historical lookup {table}.{index} is not unique: {}; prepare a unique bridge before deriving values",bad.describe())))}
    Ok(())
}

// Each original adoption cohort saw one snapshot. Re-entry restores that same
// view across all its declarations; later cohorts read earlier cohorts' outputs.
fn restore_snapshot(tx:&Tx<'_>)->Result<(),RuntimeError>{
    tx.conn().execute("UPDATE r SET data=(SELECT o.data FROM temp._backfill_originals o WHERE o.t=r.t AND o.id=r.id) WHERE EXISTS(SELECT 1 FROM temp._backfill_originals o WHERE o.t=r.t AND o.id=r.id)",[])?;Ok(())
}
fn historical_snapshot(tx:&Tx<'_>,epoch:i64,keys:&BTreeSet<String>)->Result<(),RuntimeError>{
    let mut q=tx.conn().prepare("SELECT t,id,definition FROM _backfill_evidence WHERE active=1 AND epoch=?1 ORDER BY t,id,definition")?;
    let mut rows=q.query([epoch])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;if !keys.contains(&key){continue;}
        let data:Option<String>=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
        let Some(data)=data else {continue};
        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_originals SELECT t,id,data FROM r WHERE t=?1 AND id=?2",params![t,id])?;
        let mut row:Value=decode(&data)?;let e=evidence(tx,t,&id,&key)?.unwrap();
        let fields=match &mut row {Value::Row(f)|Value::Map(f)=>f,_=>return Err(refusal("invalid historical row"))};
        if let Value::Row(inputs)|Value::Map(inputs)=e.inputs {for(c,value)in inputs {
            if e.absent.contains(&c) || !fields.contains_key(&c) || fields.get(&c)==Some(&value) {
                let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(&key,&c)],|r|r.get(0))?;
                if invalid {return Err(refusal(format!("historical backfill reference {c} on {id} lost its parent lifetime")));}
                if e.absent.contains(&c) {fields.insert(c,value);}else{fields.entry(c).or_insert(value);}
            }
        }}
        for c in e.after.keys() {if !e.before.contains_key(c) {fields.insert(c.clone(),Value::Null);}}
        for(c,value)in e.before {fields.insert(c,value);}
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    } Ok(())
}
fn rebuild_reads(tx:&Tx<'_>,source:&Schema,reads:&BTreeSet<(String,String)>)->Result<(),RuntimeError>{
    for (name,index) in reads {
        let old=&source.tables[name].indexes[index];let ti=tx.num(&format!("{name}.{index}"))?;
        tx.conn().execute("DELETE FROM i WHERE ti=?1",[ti])?;
        super::activation::walk(tx,tx.num(name)?,|id,mut row|{
            materialize_optional_fields(&mut row,&source.tables[name]);
            for key in index_keys(old,&row,id){tx.conn().execute("INSERT INTO i(ti,k,id) VALUES(?1,?2,?3)",params![ti,key,id])?;}Ok(())
        })?;
        if old.unique {validate_lookup(tx,ti,old.components.len(),name,index)?;}
    } Ok(())
}

// @ref LLP 3000.036.004#6-bakeoff-repairs — computed values obey the ordinary text minimum/format law before narrowing.
fn validate_output(name:&str,table:&Table,column:&str,value:&Value)->Result<(),RuntimeError>{
    crate::engine::validate::validate_column(name,column,&table.columns[column],Some(value))?;
    for constraint in &table.constraints {if let crate::schema::Constraint::Text{field,min,format}=constraint {
        if field==column {if let Value::String(text)=value {crate::engine::validate::validate_text(&format!("{name}.{column}"),text,*min,*format)?;}}
    }}Ok(())
}

fn input_ref(key:&str,column:&str)->String {format!("$backfill:{key}:{column}")}

// A prior transformation's retained added output is not its own old argument
// on forward selection after rollback. Other declarations still see the new
// predecessor snapshot rather than an old cohort's overwritten columns.
fn inactive_snapshot(tx:&Tx<'_>,previous:Option<&Schema>,keys:&BTreeSet<String>,epoch:i64)->Result<(),RuntimeError>{
    let mut q=tx.conn().prepare("SELECT t,id,definition FROM _backfill_evidence WHERE active=0 AND epoch=?1 ORDER BY t,id,definition")?;
    let mut rows=q.query([epoch])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;if !keys.contains(&key){continue;}
        let name:String=tx.conn().query_row("SELECT name FROM _catalog WHERE num=?1",[t],|r|r.get(0))?;
        let old=previous.and_then(|s|s.table(&name));
        let e=evidence(tx,t,&id,&key)?.unwrap();
        let absent:Vec<_>=e.after.keys().filter(|c|!e.before.contains_key(*c) && old.is_none_or(|t|!t.columns.contains_key(*c))).cloned().collect();
        if absent.is_empty() && e.absent.is_empty(){continue;}
        let data:Option<String>=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;let Some(data)=data else{continue};
        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_originals SELECT t,id,data FROM r WHERE t=?1 AND id=?2",params![t,id])?;
        let mut row:Value=decode(&data)?;if let Value::Row(fields)|Value::Map(fields)=&mut row {
            for c in &e.absent {
                let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(&key,c)],|r|r.get(0))?;
                if invalid {return Err(refusal(format!("historical backfill reference {c} on {id} lost its parent lifetime")));}
                if let Ok(value)=e.inputs.field(c){fields.insert(c.clone(),value.clone());}
            }
            for c in absent {fields.insert(c,Value::Null);}
        }
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    }Ok(())
}

// Empty definition denotes currently omitted physical input cells; a definition
// digest denotes absence at that receipt's adoption. Defaults may materialize
// during retention without turning omitted inputs into authored values.
pub(crate) fn prepare_inputs(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>)->Result<(),RuntimeError>{
    if next.backfills.is_empty() && previous.is_none_or(|s|s.backfills.is_empty()) && !present(tx)? {return Ok(());}
    enable(tx)?;
    tx.conn().execute("DELETE FROM _backfill_active",[])?;
    for fill in &next.backfills {tx.conn().execute("INSERT INTO _backfill_active VALUES(?1,?2,?3)",params![tx.num(&fill.table)?,fill.key(),canonical_json(&fill.inputs.keys().filter(|c|!fill.outputs.contains(*c)).collect::<Vec<_>>())])?;}
    for fill in next.backfills.iter().chain(previous.into_iter().flat_map(|s|s.backfills.iter())) {
        tx.conn().execute("INSERT OR IGNORE INTO _backfill_definitions VALUES(?1,?2)",params![fill.key(),canonical_json(fill)])?;
        for c in fill.inputs.keys() {tx.conn().execute("INSERT OR IGNORE INTO _backfill_inputs VALUES(?1,?2)",params![tx.num(&fill.table)?,c])?;}
    }
    let tables:Vec<i64>=tx.conn().prepare("SELECT DISTINCT t FROM _backfill_inputs")?.query_map([],|r|r.get(0))?.collect::<Result<_,_>>()?;
    for t in tables {
        let columns:Vec<String>=tx.conn().prepare("SELECT column_name FROM _backfill_inputs WHERE t=?1")?.query_map([t],|r|r.get(0))?.collect::<Result<_,_>>()?;
        super::activation::walk(tx,t,|id,row|{
            for c in &columns {if row.field(c).is_err(){note_omission(tx,t,id,c)?;}}
            Ok(())
        })?;
    } Ok(())
}
pub(super) fn observe_write(tx:&Tx<'_>,t:i64,id:&str,table:&Table,row:&Value,old:Option<&Value>)->Result<(),RuntimeError>{
    if !present(tx)? {return Ok(());}
    if old.is_none() {
        let active:Vec<(String,String)>=tx.conn().prepare("SELECT definition,input_names FROM _backfill_active WHERE t=?1")?.query_map([t],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        for (key,names) in active {
            let names:Vec<String>=decode(&names)?;
            let fingerprint=input_fingerprint(&crate::schema::row_image(row,table),names.iter().map(String::as_str));
            tx.conn().execute("INSERT OR IGNORE INTO _backfill_absence VALUES(?1,?2,?3,?4)",params![t,id,format!("$native:{key}"),fingerprint])?;
        }
    }
    let columns:Vec<String>=tx.conn().prepare("SELECT column_name FROM _backfill_inputs WHERE t=?1")?.query_map([t],|r|r.get(0))?.collect::<Result<_,_>>()?;
    if columns.is_empty(){return Ok(());}
    let interpreted_old=old.map(|r|crate::schema::row_image(r,table));
    let interpreted_new=crate::schema::row_image(row,table);
    for c in columns {
        let changed=interpreted_old.as_ref().is_none_or(|before|before.field(&c).ok()!=interpreted_new.field(&c).ok());
        if changed {tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND column_name=?3 AND definition NOT LIKE '$native:%'",params![t,id,c])?;}
        if row.field(&c).is_err() {note_omission(tx,t,id,&c)?;}
    } Ok(())
}

pub(super) fn record_omissions(tx:&Tx<'_>,t:i64,id:&str,row:&Value)->Result<(),RuntimeError>{
    if !present(tx)? {return Ok(());}
    let columns:Vec<String>=tx.conn().prepare("SELECT column_name FROM _backfill_inputs WHERE t=?1")?.query_map([t],|r|r.get(0))?.collect::<Result<_,_>>()?;
    for c in columns {if row.field(&c).is_err(){note_omission(tx,t,id,&c)?;}}Ok(())
}

fn input_fingerprint<'a>(row:&Value,names:impl Iterator<Item=&'a str>)->String {
    let fields:BTreeMap<String,Value>=names.map(|c|(c.to_owned(),row.field(c).cloned().unwrap_or(Value::Null))).collect();
    crate::value::digest(&fields)
}

fn note_omission(tx:&Tx<'_>,t:i64,id:&str,c:&str)->Result<(),RuntimeError>{
    // A provided historical cell stays provided when merely moved out of the
    // active projection. Already-recorded omission survives default freezing.
    tx.conn().execute("INSERT OR IGNORE INTO _backfill_absence SELECT ?1,?2,'',?3 WHERE NOT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3)",params![t,id,c])?;Ok(())
}
fn native_inputs<'a>(tx:&Tx<'_>,t:i64,id:&str,row:&Value,names:impl Iterator<Item=&'a str>,table:Option<&Table>)->Result<BTreeMap<String,Value>,RuntimeError>{
    let mut out=BTreeMap::new();let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
    for c in names {
        let value=if let Ok(value)=row.field(c){meter.heap(value.retained_heap_bytes().saturating_mul(64).saturating_add(8192))?;value.clone()}else{
            let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,c],|r|r.get(0)).optional()?;
            meter.heap(bytes.unwrap_or(0).max(0) as u64 * 64 + 8192)?;
            let text:Option<String>=tx.conn().query_row("SELECT data FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,c],|r|r.get(0)).optional()?;
            text.map(|s|decode(&s)).transpose()?.or_else(||table.and_then(|t|if t.maintained.contains_key(c){Some(Value::Int(0))}else{t.defaults.get(c).and_then(|d|if let crate::schema::ColumnDefault::Literal(v)=d {Some(v.clone())}else{None})})).unwrap_or(Value::Null)
        };out.insert(c.to_owned(),value);
    }Ok(out)
}

// @ref LLP 3000.039#3 — source expiry is an ordinary reference-action closure, never an unchecked physical delete.
pub(super) fn retire_snapshot(tx:&Tx<'_>,sources:&BTreeMap<String,Table>,previous:Option<&Schema>,now:i64)->Result<(),RuntimeError>{
    let mut source=previous.cloned().unwrap_or_default();source.tables=sources.clone();source.backfills.clear();source.prepare_receipt_dependencies();
    let names:Vec<String>=source.through_order().into_iter().rev().filter(|n|source.tables[n].ephemeral.is_none() && source.maintain_for(n).is_none()).collect();
    let mut due=false;
    for name in &names {
        let t=tx.num(name)?;
        super::activation::walk(tx,t,|id,row|{if !due {due=source_expired(tx,t,id,&source.tables[name],&row,now)?;}Ok(())})?;
    }
    if !due{return Ok(())}
    // Restored sources have no live index entries. Every reference action,
    // maintained dependency and retained-child probe uses this assembled view.
    for name in &names {
        let table=&source.tables[name];
        for (index,definition) in &table.indexes {
            let ti=tx.num(&format!("{name}.{index}"))?;tx.conn().execute("DELETE FROM i WHERE ti=?1",[ti])?;
            let work=crate::rows::adoption::Work::table(table);
            let scratch=|row:&Value|crate::rows::adoption::contribution_bytes(row,table);
            super::activation_walk::walk_metered(tx,tx.num(name)?,work,if work.index_entries!=0 {Some(&scratch)}else{None},|id,mut row,_|{
                materialize_optional_fields(&mut row,table);
                for key in index_keys(definition,&row,id){tx.conn().execute("INSERT INTO i(ti,k,id) VALUES(?1,?2,?3)",params![ti,key,id])?;}Ok(())
            })?;
        }
    }
    if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_cap_counts')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute("DELETE FROM _cap_counts",[])?;
        for name in &names {let table=&source.tables[name];super::activation::walk(tx,tx.num(name)?,|_,row|tx.update_cap_counts(name,table,None,Some(&row)).map(|_|()))?;}
    }
    validate_action_bounds(tx,&source,now)?;
    tx.clear_activation_scan();
    for name in &names {
        let t=tx.num(name)?;
        super::activation::walk(tx,t,|id,_|{
            let Some(mut row)=tx.get(name,id)? else{return Ok(())};
            if !source_expired(tx,t,id,&source.tables[name],&row,now)? {return Ok(())}
            materialize_optional_fields(&mut row,&source.tables[name]);
            let mut runner=Runner::new(tx,&source,Context::system().at(now),Meter::new(Ceilings::job(),Cut::Abort),tx.next_seq()?);
            match runner.retire_expired_row(name,&row) {
                Ok(true)=>{tx.set_meta("activation_population","true")?;},
                Ok(false)=>return Err(refusal(format!("source expiry {name}/{id} is blocked by retained children; resolve them in a bridge before adoption"))),
                Err(e)=>return Err(refusal(format!("source expiry {name}/{id}: {e}"))),
            }Ok(())
        })?;
    }
    for name in &names {
        let cleared:Vec<_>=source.tables[name].on_delete.iter().filter(|(_,a)|**a==crate::schema::references::OnDelete::SetNull).map(|(c,_)|c.clone()).collect();
        if cleared.is_empty(){continue;}
        super::activation::walk(tx,tx.num(name)?,|id,row|{
            for c in &cleared {if row.field(c).is_ok_and(|v|*v==Value::Null){
                let t=tx.num(name)?;
                tx.conn().execute("UPDATE _dormant_values SET data=?1 WHERE t=?2 AND id=?3 AND column_name=?4",params![canonical_json(&Value::Null),t,id,c])?;
                let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
                let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((bytes.unwrap_or(0).max(0) as u64).saturating_mul(64).saturating_add(row.retained_heap_bytes().saturating_mul(64)).saturating_add(8192))?;
                let archived:Option<String>=tx.conn().query_row("SELECT data FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
                if let Some(archived)=archived {let mut image:Value=decode(&archived)?;if let Value::Row(fields)|Value::Map(fields)=&mut image {fields.insert(c.clone(),Value::Null);}tx.conn().execute("UPDATE _dormant_narrow_rows SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&image),t,id])?;}
                tx.conn().execute("DELETE FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,c])?;
            }}Ok(())
        })?;
    }
    tx.clear_activation_scan();Ok(())
}
fn source_expired(tx:&Tx<'_>,t:i64,id:&str,table:&Table,row:&Value,now:i64)->Result<bool,RuntimeError>{
    if table.expired(row,now){return Ok(true)}
    let definition:Option<String>=tx.conn().query_row("SELECT definition FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
    if let Some(definition)=definition {let old:Table=decode(&definition)?;return Ok(old.expired(row,now));}Ok(false)
}

fn validate_action_bounds(tx:&Tx<'_>,source:&Schema,now:i64)->Result<(),RuntimeError>{
    for parent in source.tables.keys() {for r in source.referencing(parent).into_iter().filter(|r|r.action.writes()) {
        let bound=source.reference_cap(r.child,r.column).ok_or_else(||refusal("historical reference action has no bound"))?;
        let index=source.reference_index(r.child,r.column).ok_or_else(||refusal("historical reference index absent"))?;
        let mut q=tx.conn().prepare("SELECT k FROM i WHERE ti=?1 ORDER BY k")?;let mut rows=q.query([tx.num(&format!("{}.{index}",r.child))?])?;
        let mut prior=None;let mut count=0u64;let mut visited=0u64;let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
        while let Some(row)=rows.next()? {
            if visited%256==0 {meter=Meter::new(Ceilings::job(),Cut::Abort);}visited+=1;
            let mark=meter.mark();let key=row.get_ref(0)?.as_blob().map_err(|e|RuntimeError::Store(e.to_string()))?;meter.heap(key.len() as u64 * 64 + 8192)?;
            let values=crate::key::decode(key).ok_or_else(||refusal("invalid historical reference key"))?;
            if values.first().is_none_or(|v|*v==Value::Null) || r.table.is_expiring() && values.get(1).is_some_and(|v|matches!(v,Value::Int(at) if *at<=now)) {meter.release_heap(mark);continue;}
            if prior.as_ref()==values.first(){count+=1;}else{prior=values.first().cloned();count=1;}
            if count>u64::from(bound){return Err(refusal(format!("historical reference group {}.{} exceeds retirement bound {bound}; reconcile retained capacity in a bridge before adoption",r.child,r.column)));}
            meter.release_heap(mark);
        }
    }}Ok(())
}
