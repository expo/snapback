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
    CREATE TABLE IF NOT EXISTS _backfill_definitions(digest TEXT PRIMARY KEY,definition TEXT NOT NULL);")?;
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='epoch')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute_batch("ALTER TABLE _backfill_evidence ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;")?;
    }
    tx.set_meta("version", VERSION)
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Evidence { #[serde(default)] epoch:i64, active:bool, inputs: Value, before: BTreeMap<String,Value>, after: BTreeMap<String,Value> }
fn evidence(tx: &Tx<'_>, t:i64,id:&str,key:&str) -> Result<Option<Evidence>,RuntimeError> {
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(inputs)+octet_length(before_image)+octet_length(after_image) FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|r.get(0)).optional()?;
    let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap(bytes.unwrap_or(0).max(0) as u64 * 64 + 8192)?;
    let value:Option<(String,String,String,bool,i64)>=tx.conn().query_row("SELECT inputs,before_image,after_image,active,epoch FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    value.map(|(inputs,before,after,active,epoch)|Ok(Evidence {epoch,active,inputs:decode(&inputs)?,before:decode(&before)?,after:decode(&after)?})).transpose()
}
fn decode<T:serde::de::DeserializeOwned>(s:&str)->Result<T,RuntimeError>{serde_json::from_str(s).map_err(|e|RuntimeError::Store(e.to_string()))}
fn save(tx:&Tx<'_>,t:i64,id:&str,key:&str,e:&Evidence,active:bool)->Result<(),RuntimeError>{
    tx.conn().execute("INSERT INTO _backfill_evidence(t,id,definition,inputs,before_image,after_image,active,epoch) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(t,id,definition) DO UPDATE SET inputs=excluded.inputs,before_image=excluded.before_image,after_image=excluded.after_image,active=excluded.active,epoch=excluded.epoch",params![t,id,key,canonical_json(&e.inputs),canonical_json(&e.before),canonical_json(&e.after),active,e.epoch])?;
    tx.conn().execute("DELETE FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key])?;
    Ok(())
}
pub(super) fn delete(tx:&Tx<'_>,t:i64,id:&str)->Result<(),RuntimeError>{
    if present(tx)? {
        tx.conn().execute("DELETE FROM _backfill_evidence WHERE t=?1 AND id=?2",params![t,id])?;
        tx.conn().execute("DELETE FROM _backfill_pruned WHERE t=?1 AND id=?2",params![t,id])?;
    } Ok(())
}
// Never archive reference/asset preimages without lifetime evidence. New reference
// fields are safe: subsequent retirement is owned by the ordinary dormant ledger.
fn protected(kind:&crate::schema::ColumnType)->bool {
    use crate::schema::ColumnType::*;
    match kind {Optional(k)=>protected(k),Ref{..}|Image{..}|Video{..}|File{..}|List{..}|ListRange{..}=>true,_=>false}
}
pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,sources:&BTreeMap<String,Table>,now:i64,report:&mut super::adoption_report::AdoptionReport)->Result<(),RuntimeError>{
    if next.backfills.is_empty() && previous.is_none_or(|s|s.backfills.is_empty()) && !present(tx)? { return Ok(()); }
    enable(tx)?;
    for fill in &next.backfills { fill.admit(next).map_err(refusal)?; }
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
        let mut q=tx.conn().prepare("SELECT DISTINCT epoch FROM _backfill_evidence WHERE definition=?1 AND active=1 AND EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_evidence.t AND r.id=_backfill_evidence.id)")?;
        for epoch in q.query_map([key],|r|r.get::<_,i64>(0))? {epochs.insert(Some(epoch?));}
    }
    let fresh_epoch=tx.meta("generation")?.and_then(|s|s.parse::<i64>().ok()).unwrap_or(0).saturating_add(1);
    for epoch in epochs {
        restore_snapshot(tx)?;
        if let Some(epoch)=epoch { historical_snapshot(tx,epoch,&next_keys)?; } else { inactive_snapshot(tx,previous,&entering_keys)?; }
        rebuild_reads(tx,&source,&reads)?;
    for fill in &entering {

        let t=tx.num(&fill.table)?;let key=fill.key();let table=&next.tables[&fill.table];let mut bad=super::adopt_refusals::Samples::default();let mut count=0;
        super::activation::walk(tx,t,|id,mut row|{
            if old_keys.contains(&key) && !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=?1 AND id=?2)",params![t,id],|r|r.get::<_,bool>(0))? {return Ok(())}
            let prior=evidence(tx,t,id,&key)?;
            if prior.as_ref().filter(|e|e.active).map(|e|e.epoch)!=epoch {return Ok(())}
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
            if let Some(table)=sources.get(&fill.table){materialize_optional_fields(&mut row,table);}
            let historical=row.clone();
            let mut args=BTreeMap::new();
            for (c,kind) in &fill.inputs {
                let value=historical.field(c).cloned().ok();
                if crate::engine::validate::validate_column(&fill.table,c,kind,value.as_ref()).is_err() {
                    // Native rows can survive a return through an older source;
                    // they have no historical input, but retain a valid v2 image.
                    if prior.is_none() && previous.and_then(|s|s.table(&fill.table)).is_some_and(|old|fill.outputs.iter().all(|c|!old.columns.contains_key(c))) && fill.outputs.iter().all(|c|current.field(c).is_ok() && crate::engine::validate::validate_column(&fill.table,c,&table.columns[c],current.field(c).ok()).is_ok())
                        && tx.conn().query_row("SELECT NOT EXISTS(SELECT 1 FROM _backfill_evidence WHERE t=?1 AND id=?2 UNION ALL SELECT 1 FROM _backfill_pruned WHERE t=?1 AND id=?2)",params![t,id],|r|r.get::<_,bool>(0))? {return Ok(())}
                    bad.add(id,&format!("historical input {}.{c} is absent or does not fit {kind}; use a typed bridge to repair it",fill.table));return Ok(())
                }
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
                if let Err(e)=crate::engine::validate::validate_column(&fill.table,c,&table.columns[c],Some(value)) {bad.add(id,&e.to_string());return Ok(())}
                if let Some(kind)=sources.get(&fill.table).and_then(|t|t.columns.get(c)) {if protected(kind) && prior.as_ref().is_none_or(|e|e.before.contains_key(c)) {bad.add(id,&format!("cannot overwrite historical reference or asset {}.{c}; derive into a new column",fill.table));return Ok(())}}
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
            let e=Evidence{epoch:epoch.unwrap_or(fresh_epoch),active:true,inputs,before,after:patch};
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
        save(tx,t,&id,&key,&e,true)?;
        let fill=next.backfills.iter().find(|f|f.key()==key).ok_or_else(||refusal("missing historical declaration"))?;
        for(c,kind)in &fill.inputs {
            if let Ok(value)=e.inputs.field(c) {super::dormant::capture_refs(tx,t,&id,&input_ref(&key,c),kind,value)?;}
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
    if present(tx)? {tx.conn().execute_batch("DELETE FROM _backfill_evidence WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_evidence.t AND r.id=_backfill_evidence.id); DELETE FROM _backfill_pruned WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_pruned.t AND r.id=_backfill_pruned.id); INSERT OR IGNORE INTO _backfill_pruned SELECT t,id,definition,active FROM _backfill_evidence; DELETE FROM _backfill_evidence;")?;}
    Ok(())
}
pub(super) fn inventory_sql(conn:&Connection)->Result<&'static str,RuntimeError>{
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_backfill_evidence')",[],|r|r.get(0))?;
    Ok(if exists {" UNION ALL SELECT c.name||'.backfill#'||substr(e.definition,1,12),'backfill',c.name,e.definition FROM _backfill_evidence e JOIN _catalog c ON c.num=e.t GROUP BY e.t,e.definition "}else{""})
}

pub(super) fn has_evidence(tx:&Tx<'_>)->Result<bool,RuntimeError>{present(tx)}
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
            if !fields.contains_key(&c) || fields.get(&c)==Some(&value) {
                let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(&key,&c)],|r|r.get(0))?;
                if invalid {return Err(refusal(format!("historical backfill reference {c} on {id} lost its parent lifetime")));}
                fields.entry(c).or_insert(value);
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

fn input_ref(key:&str,column:&str)->String {format!("$backfill:{key}:{column}")}

// A prior transformation's retained added output is not its own old argument
// on forward selection after rollback. Other declarations still see the new
// predecessor snapshot rather than an old cohort's overwritten columns.
fn inactive_snapshot(tx:&Tx<'_>,previous:Option<&Schema>,keys:&BTreeSet<String>)->Result<(),RuntimeError>{
    let mut q=tx.conn().prepare("SELECT t,id,definition FROM _backfill_evidence WHERE active=0 ORDER BY t,id,definition")?;
    let mut rows=q.query([])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;if !keys.contains(&key){continue;}
        let name:String=tx.conn().query_row("SELECT name FROM _catalog WHERE num=?1",[t],|r|r.get(0))?;
        let old=previous.and_then(|s|s.table(&name));
        let e=evidence(tx,t,&id,&key)?.unwrap();
        let absent:Vec<_>=e.after.keys().filter(|c|!e.before.contains_key(*c) && old.is_none_or(|t|!t.columns.contains_key(*c))).cloned().collect();
        if absent.is_empty(){continue;}
        let data:Option<String>=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;let Some(data)=data else{continue};
        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_originals SELECT t,id,data FROM r WHERE t=?1 AND id=?2",params![t,id])?;
        let mut row:Value=decode(&data)?;if let Value::Row(fields)|Value::Map(fields)=&mut row {for c in absent {fields.insert(c,Value::Null);}}
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    }Ok(())
}
