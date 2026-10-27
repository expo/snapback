//! Release backfills use the same activation transaction as retention and indexes.
// @ref LLP 3000.000.000.002#3-adoption-and-reversibility — stage every result before mutating the input snapshot.
use super::*;
use crate::{schema::{backfill::Backfill, materialize_optional_fields}, engine::{Context, runner::Runner}, meter::{Ceilings, Cut, Meter}};
use std::collections::{BTreeMap, BTreeSet};
pub(crate) const VERSION: &str = "snapback4-release-store-7";
fn migration_context(tx:&Tx<'_>,now:i64)->Result<Context,RuntimeError>{let mut context=Context::system().at(now);context.migration_assets=tx.meta("activation_asset_root")?.map(std::path::PathBuf::from);Ok(context)}
fn refusal(message: impl Into<String>) -> RuntimeError { RuntimeError::Structural { code:"E_ADOPT", message:message.into() } }
// @ref LLP 3000.000.000.003#4-preview-wording — bounded row values must not truncate the action advice.
fn forward_refusal(message:impl Into<String>)->RuntimeError {
    refusal(format!("{}; forward selection: preserve current values in a bridge and repair through an authorized mutation; use a fresh declaration name for new transform meaning (guide rename)",message.into()))
}
pub(super) fn present(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_backfill_evidence')",[],|r|r.get(0))?)
}
fn enable(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.conn().execute_batch("CREATE TABLE IF NOT EXISTS _backfill_evidence(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,inputs TEXT NOT NULL,before_image TEXT NOT NULL,after_image TEXT NOT NULL,active INTEGER NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,retained_outputs TEXT NOT NULL DEFAULT '[]',reversed_image TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(t,id,definition)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_pruned(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,active INTEGER NOT NULL,retained_outputs TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(t,id,definition)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_definitions(digest TEXT PRIMARY KEY,definition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _downfill_definitions(digest TEXT PRIMARY KEY,definition TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _backfill_absence(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,column_name TEXT NOT NULL,PRIMARY KEY(t,id,definition,column_name)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_inputs(t INTEGER NOT NULL,column_name TEXT NOT NULL,PRIMARY KEY(t,column_name)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS _backfill_active(t INTEGER NOT NULL,definition TEXT NOT NULL,input_names TEXT NOT NULL,PRIMARY KEY(t,definition)) WITHOUT ROWID;")?;
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='reversed_image')",[],|r|r.get::<_,bool>(0))? {
        if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_evidence)",[],|r|r.get::<_,bool>(0))? {return Err(refusal("experimental backfill evidence lacks reversed-view baselines; restore a pre-backfill backup with the matching runtime"));}
        tx.conn().execute_batch("ALTER TABLE _backfill_evidence ADD COLUMN reversed_image TEXT NOT NULL DEFAULT '{}';")?;
    }
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_pruned') WHERE name='retained_outputs')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute_batch("ALTER TABLE _backfill_pruned ADD COLUMN retained_outputs TEXT NOT NULL DEFAULT '[]';")?;
    }
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='epoch')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute_batch("ALTER TABLE _backfill_evidence ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;")?;
    }
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='retained_outputs')",[],|r|r.get::<_,bool>(0))? {
        if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_evidence WHERE active=0)",[],|r|r.get::<_,bool>(0))? {return Err(refusal("experimental backfill evidence lacks per-column view metadata; restore a pre-backfill backup or explicitly prune retained history with its earlier runtime"));}
        tx.conn().execute_batch("ALTER TABLE _backfill_evidence ADD COLUMN retained_outputs TEXT NOT NULL DEFAULT '[]';")?;
    }
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_active') WHERE name='input_names')",[],|r|r.get::<_,bool>(0))? {
        tx.conn().execute_batch("ALTER TABLE _backfill_active ADD COLUMN input_names TEXT NOT NULL DEFAULT '[]';")?;
    }
    if !tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='computed_image')",[],|r|r.get::<_,bool>(0))?{tx.conn().execute_batch("ALTER TABLE _backfill_evidence ADD COLUMN computed_image TEXT NOT NULL DEFAULT '{}';")?;}
    if matches!(tx.meta("version")?.as_deref(),Some("snapback4-release-store-10"|super::table_renames::VERSION)){Ok(())}else{tx.set_meta("version", VERSION)}
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Evidence { #[serde(default)] computed:BTreeMap<String,Value>, #[serde(default)] authored:BTreeSet<String>, #[serde(default)] reversed:BTreeMap<String,Option<Value>>, #[serde(default)] absent:BTreeSet<String>, #[serde(default)] epoch:i64, #[serde(default)] retained:BTreeSet<String>, active:bool, inputs: Value, before: BTreeMap<String,Value>, after: BTreeMap<String,Value> }
fn evidence(tx: &Tx<'_>, t:i64,id:&str,key:&str) -> Result<Option<Evidence>,RuntimeError> {
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(inputs)+octet_length(before_image)+octet_length(after_image)+octet_length(retained_outputs)+octet_length(reversed_image) FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|r.get(0)).optional()?;
    let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap(bytes.unwrap_or(0).max(0) as u64 * 64 + 8192)?;
    let value:Option<(String,String,String,bool,i64,String,String)>=tx.conn().query_row("SELECT inputs,before_image,after_image,active,epoch,retained_outputs,reversed_image FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?;
    let computed:Option<String>=if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('_backfill_evidence') WHERE name='computed_image')",[],|r|r.get::<_,bool>(0))?{
        let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(computed_image) FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|r.get(0)).optional()?;
        admission.heap((bytes.unwrap_or(0).max(0) as u64).saturating_mul(64))?;
        tx.conn().query_row("SELECT computed_image FROM _backfill_evidence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|r.get(0)).optional()?
    }else{None};
    value.map(|(inputs,before,after,active,epoch,retained,reversed)|Ok(Evidence {computed:computed.as_ref().map(|s|decode(s)).transpose()?.unwrap_or_default(),authored:absence(tx,t,id,&format!("$authored:{key}"))?,reversed:decode(&reversed)?,retained:decode(&retained)?,absent:absence(tx,t,id,key)?,epoch,active,inputs:decode(&inputs)?,before:decode(&before)?,after:decode(&after)?})).transpose()
}
fn decode<T:serde::de::DeserializeOwned>(s:&str)->Result<T,RuntimeError>{serde_json::from_str(s).map_err(|e|RuntimeError::Store(e.to_string()))}
fn absence(tx:&Tx<'_>,t:i64,id:&str,key:&str)->Result<BTreeSet<String>,RuntimeError>{
    Ok(tx.conn().prepare("SELECT column_name FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition=?3")?.query_map(params![t,id,key],|r|r.get(0))?.collect::<Result<_,_>>()?)
}
fn save(tx:&Tx<'_>,t:i64,id:&str,key:&str,e:&Evidence,active:bool)->Result<(),RuntimeError>{
    let inputs=canonical_json(&e.inputs);let before=canonical_json(&e.before);let after=canonical_json(&e.after);let retained=canonical_json(&e.retained);let reversed=canonical_json(&e.reversed);
    let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((inputs.len()+before.len()+after.len()+retained.len()+reversed.len()) as u64 * 64 + 8192).map_err(|err|refusal(format!("backfill reversal evidence exceeds its future read budget: {err}; reduce the per-row migration image")))?;
    tx.conn().execute("INSERT INTO _backfill_evidence(t,id,definition,inputs,before_image,after_image,active,epoch,retained_outputs,reversed_image) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(t,id,definition) DO UPDATE SET inputs=excluded.inputs,before_image=excluded.before_image,after_image=excluded.after_image,active=excluded.active,epoch=excluded.epoch,retained_outputs=excluded.retained_outputs,reversed_image=excluded.reversed_image",params![t,id,key,inputs,before,after,active,e.epoch,retained,reversed])?;
    let computed=canonical_json(&e.computed);admission.heap((computed.len() as u64).saturating_mul(64))?;
    tx.conn().execute("UPDATE _backfill_evidence SET computed_image=?1 WHERE t=?2 AND id=?3 AND definition=?4",params![computed,t,id,key])?;
    tx.conn().execute("DELETE FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key])?;
    tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key])?;
    for c in &e.absent {tx.conn().execute("INSERT INTO _backfill_absence VALUES(?1,?2,?3,?4)",params![t,id,key,c])?;}
    tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,format!("$authored:{key}")])?;
    if !e.authored.is_empty(){tx.set_meta("version",super::table_renames::VERSION)?;}
    for c in &e.authored {tx.conn().execute("INSERT INTO _backfill_absence VALUES(?1,?2,?3,?4)",params![t,id,format!("$authored:{key}"),c])?;}
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
    table.expire.as_deref()==Some(column) || table.not_before.as_deref()==Some(column) || table.engine_field(column) || table.sequences.contains_key(column) || table.maintained.contains_key(column)
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
struct SourceMask<'a,'b>(&'a Tx<'b>);
impl Drop for SourceMask<'_,'_>{fn drop(&mut self){let _=self.0.conn().execute_batch("DROP TABLE IF EXISTS temp._backfill_unprovided; DROP TABLE IF EXISTS temp._backfill_native_restored");}}

// A declared forward receipt may temporarily expose its exact predecessor while
// the down receipt still remembers the newer input. Ordinary changed inputs
// remain conflicts; the later forward pass must validate and restore this receipt.
fn receipt_preimage(tx:&Tx<'_>,next:&Schema,table:&str,t:i64,id:&str,column:&str,current:Option<&Value>,newer:&Value,historical:Option<&Table>)->Result<bool,RuntimeError>{
    for fill in next.backfills.iter().filter(|f|f.table==table&&f.outputs.contains(column)) {
        if let Some(e)=evidence(tx,t,id,&fill.key())? {
            if !e.active&&e.before.get(column)==current&&e.after.get(column)==Some(newer){return Ok(true)}
        }
    }
    // Another down receipt (including this one) owns its exact old-view output.
    // Validate all receipts before restoring any, so declaration order is inert.
    for fill in next.downfills.iter().filter(|f|f.table==table&&f.outputs.contains(column)) {
        if let Some(e)=evidence(tx,t,id,&fill.down_key())? {
            if !e.active&&e.after.get(column)==current {
                let native=match e.reversed.get(column){Some(Some(v))=>Some(v.clone()),Some(None)=>interpreted_absence(if next.tables[table].columns.contains_key(column){&next.tables[table]}else{historical.unwrap_or(&next.tables[table])},column),None=>None};
                if native.as_ref()==Some(newer){return Ok(true)}
            }
        }
    }Ok(false)
}

fn assemble_owned_cells<'a>(tx:&Tx<'_>,t:i64,id:&str,row:&mut Value,columns:impl Iterator<Item=&'a str>)->Result<(),RuntimeError>{
    let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
    for column in columns {
        if row.field(column).is_ok(){continue}
        let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column],|r|r.get(0)).optional()?;
        if let Some(bytes)=bytes {
            meter.heap((bytes.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
            let data:String=tx.conn().query_row("SELECT data FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column],|r|r.get(0))?;
            if let Value::Row(fields)|Value::Map(fields)=row {fields.insert(column.to_owned(),decode(&data)?);}
        }
    }Ok(())
}

fn note_native_absence(tx:&Tx<'_>,t:i64,id:&str,column:&str)->Result<(),RuntimeError>{
    tx.conn().execute("INSERT OR IGNORE INTO _backfill_absence VALUES(?1,?2,'$restored-native',?3)",params![t,id,column])?;Ok(())
}
pub(super) fn native_absences(tx:&Tx<'_>,t:i64,id:&str,row:&Value)->Result<BTreeSet<String>,RuntimeError>{
    if !present(tx)?{return Ok(BTreeSet::new())}
    let (bytes,count):(i64,i64)=tx.conn().query_row("SELECT coalesce(sum(octet_length(column_name)),0),count(*) FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition IN ('$restored-native','$native-cell')",params![t,id],|r|Ok((r.get(0)?,r.get(1)?)))?;
    let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((bytes.max(0) as u64).saturating_mul(8).saturating_add((count.max(0) as u64).saturating_mul(64)))?;
    let columns:Vec<String>=tx.conn().prepare("SELECT DISTINCT a.column_name FROM _backfill_absence a WHERE a.t=?1 AND a.id=?2 AND a.definition IN ('$restored-native','$native-cell') AND NOT EXISTS(SELECT 1 FROM _dormant_values v WHERE v.t=a.t AND v.id=a.id AND v.column_name=a.column_name)")?.query_map(params![t,id],|r|r.get(0))?.collect::<Result<_,_>>()?;
    Ok(columns.into_iter().filter(|c|row.field(c).is_err()).collect())
}
pub(super) fn preserve_native_absence(row:&mut Value,columns:&BTreeSet<String>){
    if let Value::Row(fields)|Value::Map(fields)=row {for c in columns {fields.remove(c);}}
}
// @ref LLP 3000.000.000#191-declared-old-views-and-renames — destination narrowing interprets restored absence using the native destination, never an older default.
pub(super) fn native_source<'a>(old:&'a Table,next:&Table,columns:&BTreeSet<String>)->std::borrow::Cow<'a,Table>{
    if columns.is_empty(){return std::borrow::Cow::Borrowed(old)}
    let mut source=old.clone();
    for c in columns {
        let Some(kind)=next.columns.get(c) else {continue};
        source.columns.insert(c.clone(),kind.clone());
        if let Some(default)=next.defaults.get(c){source.defaults.insert(c.clone(),default.clone());}else{source.defaults.remove(c);}
    }
    std::borrow::Cow::Owned(source)
}

fn input_lifetime_lost(tx:&Tx<'_>,t:i64,id:&str,key:&str,column:&str)->Result<bool,RuntimeError>{
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(key,column)],|r|r.get(0))?)
}

// @ref LLP 3000.000.000#191-declared-old-views-and-renames — dormant rows validate and restore their owned receipt before destination visibility is decided.
fn walk_images(tx:&Tx<'_>,t:i64,mut visit:impl FnMut(&str,Value,bool)->Result<(),RuntimeError>)->Result<(),RuntimeError>{
    super::activation::walk(tx,t,|id,row|visit(id,row,true))?;
    let mut after=String::new();
    loop {
        let sizes:Option<(i64,i64)>=tx.conn().query_row("SELECT octet_length(id),octet_length(data) FROM _dormant_narrow_rows n WHERE t=?1 AND id>?2 AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id) ORDER BY id LIMIT 1",params![t,after],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let Some((id_bytes,data_bytes))=sizes else{break};
        let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((id_bytes.max(0) as u64).saturating_mul(8).saturating_add((data_bytes.max(0) as u64).saturating_mul(64)).saturating_add(8192))?;
        let (id,data):(String,String)=tx.conn().query_row("SELECT id,data FROM _dormant_narrow_rows n WHERE t=?1 AND id>?2 AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=n.t AND r.id=n.id) ORDER BY id LIMIT 1",params![t,after],|r|Ok((r.get(0)?,r.get(1)?)))?;
        visit(&id,decode(&data)?,false)?;after=id;
    }Ok(())
}
fn load_image(tx:&Tx<'_>,t:i64,id:&str)->Result<Option<(Value,bool)>,RuntimeError>{
    let active:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
    let (bytes,in_r)=if let Some(bytes)=active{(bytes,true)}else{
        let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
        let Some(bytes)=bytes else{return Ok(None)};(bytes,false)
    };
    let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((bytes.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
    let sql=if in_r{"SELECT data FROM r WHERE t=?1 AND id=?2"}else{"SELECT data FROM _dormant_narrow_rows WHERE t=?1 AND id=?2"};
    let data:String=tx.conn().query_row(sql,params![t,id],|r|r.get(0))?;Ok(Some((decode(&data)?,in_r)))
}

// @ref LLP 3000.000.000#191-declared-old-views-and-renames — receipt-owned cells stay consistent across narrowed archives and dormant overlays.
fn patch_retained<'a>(tx:&Tx<'_>,t:i64,id:&str,patch:impl Iterator<Item=(&'a str,Option<&'a Value>)>)->Result<(),RuntimeError>{
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
    let mut archived=if let Some(bytes)=bytes {
        let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((bytes.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
        let data:String=tx.conn().query_row("SELECT data FROM _dormant_narrow_rows WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0))?;
        Some(decode::<Value>(&data)?)
    }else{None};
    for (column,value) in patch {
        if let Some(value)=value {
            tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition='$native-cell' AND column_name=?3",params![t,id,column])?;
            tx.conn().execute("UPDATE _dormant_values SET data=?1 WHERE t=?2 AND id=?3 AND column_name=?4",params![canonical_json(value),t,id,column])?;
        }else{
            tx.conn().execute("INSERT OR IGNORE INTO _backfill_absence VALUES(?1,?2,'$native-cell',?3)",params![t,id,column])?;
            tx.conn().execute("DELETE FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column])?;
        }
        if let Some(Value::Row(fields)|Value::Map(fields))=&mut archived {
            if let Some(value)=value{fields.insert(column.to_owned(),value.clone());}else{fields.remove(column);}
        }
    }
    if let Some(archived)=archived {tx.conn().execute("UPDATE _dormant_narrow_rows SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&archived),t,id])?;super::movement::rewrite_relation(tx,"_dormant_narrow_rows",t,id,&archived)?;}
    Ok(())
}

fn restore_downfills(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,sources:&BTreeMap<String,Table>,report:&mut super::adoption_report::AdoptionReport)->Result<(),RuntimeError>{
    for validate in [true,false] {
    for fill in &next.downfills {
        let t=tx.num(&fill.table)?;let key=fill.down_key();let table=&next.tables[&fill.table];
        let mut bad=super::adopt_refusals::Samples::default();let mut count=0;
        walk_images(tx,t,|id,mut row,in_r|{
            let Some(mut e)=evidence(tx,t,id,&key)? else {
                let pruned:Option<bool>=tx.conn().query_row("SELECT active FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|r.get(0)).optional()?;
                if let Some(active)=pruned {
                    let carried=previous.is_some_and(|old|old.downfills.iter().any(|f|f.down_key()==key));
                    let mut available=active;
                    if active {for c in fill.outputs.iter().filter(|c|table.columns.contains_key(*c)) {
                        let selected=carried&&previous.and_then(|old|old.table(&fill.table)).is_some_and(|old|old.columns.contains_key(c));
                        if !selected&&row.field(c).is_err()&&!tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3)",params![t,id,c],|r|r.get::<_,bool>(0))? {available=false;}
                    }}
                    if !available {bad.add(id,"reverse projection evidence was explicitly pruned; restore a backup or keep a bridge release");}
                }
                return Ok(())
            };
            if e.active{return Ok(())}
            assemble_owned_cells(tx,t,id,&mut row,e.after.keys().map(String::as_str))?;
            let fields=row.as_object()?;
            if validate {
            for (column,expected) in &e.after {
                if fields.get(column)!=Some(expected) {bad.add(id,&format!("{}.{} changed while the older release was active; expected projected {}, current {}; forward selection refused for this row; repair it through the old operation or an authorized bridge mutation before selecting this release",fill.table,column,canonical_json(expected),fields.get(column).map(canonical_json).unwrap_or_else(||"<absent>".into())));return Ok(())}
            }
            let mut inputs_meter=Meter::new(Ceilings::job(),Cut::Abort);
            let source=row_source(tx,t,id,sources.get(&fill.table))?;
            for (column,original) in &e.inputs.as_object()?.iter().map(|(k,v)|(k.clone(),v.clone())).collect::<BTreeMap<_,_>>() {
                if input_lifetime_lost(tx,t,id,&key,column)? {bad.add(id,&format!("reverse input {column} lost its parent lifetime; restore a backup or use a typed bridge"));return Ok(())}
                    let current=source_value(tx,t,id,&row,column,source.as_deref().or(Some(table)),&mut inputs_meter)?.unwrap_or(Value::Null);
                    if &current!=original
                        && !receipt_preimage(tx,next,&fill.table,t,id,column,fields.get(column),original,source.as_deref())? {
                        bad.add(id,&format!("{}.{} changed while the older release was active; original input {}, current {}; reverse dependencies cannot be recaptured",fill.table,column,canonical_json(original),canonical_json(&current)));return Ok(())
                    }
            }
            return Ok(())
            }
            let fields=match &mut row {Value::Row(f)|Value::Map(f)=>f,_=>return Err(refusal("invalid stored row"))};
            for column in e.reversed.keys() {
                match e.reversed.get(column).cloned().flatten() {
                    Some(value)=>{
                        fields.insert(column.clone(),value.clone());
                        // @ref LLP 3000.000.000.003#1-idempotent-selection-and-repair — only a validated down receipt can supersede damaged forward bookkeeping.
                        tx.conn().execute("INSERT OR REPLACE INTO temp._backfill_native_restored VALUES(?1,?2,?3,?4)",params![t,id,column,canonical_json(&value)])?;
                    },
                    None=>{
                        fields.remove(column);
                        note_native_absence(tx,t,id,column)?;
                        tx.conn().execute("DELETE FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column])?;
                        // A rename/down round trip must not feed the archived
                        // old-view result back into a forward declaration whose
                        // original input was physically absent.
                        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_unprovided VALUES(?1,?2,?3)",params![t,id,column])?;
                    }
                }
            }
            // Restore the receipt's native image before ordinary destination
            // narrowing, including a native row that was already out of domain.
            patch_retained(tx,t,id,e.reversed.iter().map(|(c,v)|(c.as_str(),v.as_ref())))?;
            e.active=true;if in_r {tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;super::movement::rewrite(tx,t,&id,&row)?;}save(tx,t,id,&key,&e,true)?;count+=1;Ok(())
        })?;
        if bad.count>0{return Err(forward_refusal(format!("down {} {} forward: {}",fill.table,fill.name,bad.describe())))}
        if count>0 {report.backfills.push(format!("{} {} restored {count} native {}",fill.table,fill.name,if count==1{"row"}else{"rows"}));tx.set_meta("activation_population","true")?;}
    }} Ok(())
}

fn stage_downfills(tx:&Tx<'_>,next:&Schema,previous:&Schema,sources:&BTreeMap<String,Table>,now:i64,report:&mut super::adoption_report::AdoptionReport)->Result<bool,RuntimeError>{
    let next_keys:BTreeSet<String>=next.downfills.iter().map(Backfill::down_key).collect();
    let leaving:Vec<_>=previous.downfills.iter().filter(|f|!next_keys.contains(&f.down_key())&&next.table(&f.table).is_some_and(|t|f.outputs.iter().any(|c|t.columns.contains_key(c)))).collect();
    if leaving.is_empty(){return Ok(false)}
    let mut source=previous.clone();source.backfills.clear();source.downfills.clear();
    let mut rebuilt_reads=BTreeSet::new();
    tx.conn().execute_batch("CREATE TEMP TABLE _downfill_pending(t INTEGER NOT NULL,id TEXT NOT NULL,definition TEXT NOT NULL,patch TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(t,id,definition)) WITHOUT ROWID;")?;
    for fill in leaving {
        fill.admit_down(previous).map_err(refusal)?;
        let Some(target)=next.table(&fill.table) else {continue};
        let target_outputs:BTreeSet<_>=fill.outputs.iter().filter(|c|target.columns.contains_key(*c)).cloned().collect();
        if target_outputs.is_empty(){continue}
        if fill.name.starts_with("$rename:down:") {
                if fill.inputs.len()!=1 || fill.outputs.len()!=1 {return Err(refusal("generated column rename must have exactly one input and output"))}

            // @ref LLP 3000.000.000.003#3-one-release-evolution — a registered old view may widen beyond the native domain; reverse identity copies validate actual destination values below.
        }
        for c in &target_outputs {
            let kind=&target.columns[c];
            if protected(kind) || target.engine_field(c) || target.sequences.contains_key(c) || target.maintained.contains_key(c) || target.expire.as_ref()==Some(c) || target.not_before.as_ref()==Some(c) {
                return Err(refusal(format!("down {} {} output {c} must be an authoritative scalar without reference or lifetime ownership",fill.table,fill.name)))
            }
        }
        let t=tx.num(&fill.table)?;let key=fill.down_key();let mut bad=super::adopt_refusals::Samples::default();let mut count=0;let mut preimages=0u64;let mut preimage_ids=Vec::new();
        walk_images(tx,t,|id,row,_in_r|{
            let prior=evidence(tx,t,id,&key)?;
            let eligible=!absence(tx,t,id,&format!("$native:{key}"))?.is_empty();
            if prior.is_none() && !eligible{return Ok(())}
            if let Some(prior)=&prior {if !prior.active {
                let fields=row.as_object()?;
                if prior.after.iter().any(|(c,v)|target_outputs.contains(c)&&fields.get(c)!=Some(v)) {
                    bad.add(id,"projected cells changed before their native receipt was restored; repair under a bridge");
                }
                return Ok(())
            }}
            let fields=row.as_object()?;
            // Only a forward receipt that actually owns this output supplies
            // a predecessor preimage. Unrelated transformation history on the
            // same lifetime must not suppress a disjoint reverse projection.
            let mut forward_outputs=BTreeSet::new();
            let mut q=tx.conn().prepare("SELECT octet_length(d.definition),d.definition FROM _backfill_evidence e JOIN _backfill_definitions d ON d.digest=e.definition WHERE e.t=?1 AND e.id=?2 ORDER BY e.definition")?;
            let mut receipts=q.query(params![t,id])?;
            while let Some(r)=receipts.next()? {
                let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((r.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
                let definition:Backfill=decode(&r.get::<_,String>(1)?)?;
                if let Some(receipt)=evidence(tx,t,id,&definition.key())? {
                    // A declared down owns the view of an edited in-place output.
                    // Unedited outputs still restore their exact predecessor.
                    forward_outputs.extend(definition.outputs.into_iter().filter(|c|
                        !receipt.authored.contains(c) && (fields.get(c)==receipt.after.get(c) || fields.get(c)==receipt.before.get(c))));
                }
            }
            drop(receipts);drop(q);
            // An entering inactive receipt restores exact native cells. Those
            // preimages outrank a different leaving declaration's substitution.
            for entering in next.downfills.iter().filter(|f|f.table==fill.table) {
                if let Some(e)=evidence(tx,t,id,&entering.down_key())? {if !e.active {forward_outputs.extend(e.reversed.into_keys());}}
            }
            let mut pruned_outputs=BTreeSet::new();
            let mut q=tx.conn().prepare("SELECT octet_length(d.definition),d.definition FROM _backfill_pruned p JOIN _backfill_definitions d ON d.digest=p.definition WHERE p.t=?1 AND p.id=?2 ORDER BY p.definition")?;
            let mut receipts=q.query(params![t,id])?;
            while let Some(r)=receipts.next()? {
                let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((r.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
                pruned_outputs.extend(decode::<Backfill>(&r.get::<_,String>(1)?)?.outputs);
            }
            drop(receipts);drop(q);
            if target_outputs.iter().any(|c|pruned_outputs.contains(c)) {bad.add(id,"forward predecessor preimage was explicitly pruned");return Ok(())}
            let mut projected_outputs=BTreeSet::new();
            for c in &target_outputs {
                if forward_outputs.contains(c){continue}
                // An active receipt means this cell was supplied by this down
                // declaration on the preceding rollback.  Its archived copy
                // is therefore a prior down result, not a predecessor
                // preimage, and the next cycle must issue a fresh receipt so
                // edits under the older release remain conflict checked.
                if prior.as_ref().is_some_and(|e|e.active && e.reversed.contains_key(c)) {
                    projected_outputs.insert(c.clone());
                    continue;
                }
                // A non-null retained predecessor value is an exact preimage.
                // Legacy rollback loops could manufacture optional null cells;
                // the explicit down declaration is the author's substitution
                // policy for that otherwise ambiguous evidence-free case.
                let retained=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3 AND data!=?4)",params![t,id,c,canonical_json(&Value::Null)],|r|r.get::<_,bool>(0))?;
                // @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — an identical-type rename presents the current business value in the old spelling.
                if !retained || fill.name.starts_with("$rename:down:") {projected_outputs.insert(c.clone());}
            }
            if projected_outputs.len()<target_outputs.len(){preimages+=1;if preimage_ids.len()<5{preimage_ids.push(id.to_owned());}}
            if projected_outputs.is_empty(){return Ok(())}
            if prior.is_none() && tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3)",params![t,id,key],|r|r.get::<_,bool>(0))? {
                bad.add(id,"reverse projection evidence was explicitly pruned");return Ok(())
            }
            let native_source=row_source(tx,t,id,sources.get(&fill.table))?;
            if let Some(source)=native_source.as_deref() {if let Some(c)=projected_outputs.iter().find(|c|source.columns.get(*c).is_some_and(protected)||source_owned(source,c)) {
                bad.add(id,&format!("native preimage {}.{c} requires reference, asset or lifetime custody; keep a typed bridge",fill.table));return Ok(())
            }}
            let mut args=BTreeMap::new();
            for (c,kind) in &fill.inputs {
                let value=source_value(tx,t,id,&row,c,native_source.as_deref().or(Some(&previous.tables[&fill.table])),&mut Meter::new(Ceilings::job(),Cut::Abort))?;
                if crate::engine::validate::validate_column(&fill.table,c,kind,value.as_ref()).is_err(){bad.add(id,&format!("current reverse input {}.{c} is absent or invalid",fill.table));return Ok(())}
                args.insert(c.clone(),value.unwrap_or(Value::Null));
            }
            let inputs=Value::Row(args.clone().into());let mut context=migration_context(tx,now)?;context.args=args;
            for (c,kind) in &fill.inputs {
                let kind=native_source.as_deref().and_then(|s|s.columns.get(c)).filter(|k|protected(k)).unwrap_or(kind);
                let value=inputs.field(c)?;let unchanged=prior.as_ref().is_none_or(|e|e.inputs.field(c).ok()==Some(value));
                capture_input_refs(tx,t,id,c,&input_ref(&key,c),kind,value,unchanged)?;
                if input_lifetime_lost(tx,t,id,&key,c)? {bad.add(id,&format!("reverse input {c} lost its parent lifetime; use a typed bridge"));return Ok(())}
            }
            let mut reads=BTreeSet::new();collect_reads(&fill.program.body,&mut reads);
            let needed=reads.difference(&rebuilt_reads).cloned().collect::<BTreeSet<_>>();
            if !needed.is_empty(){rebuild_reads(tx,&source,&needed)?;tx.clear_activation_scan();tx.set_meta("activation_population","true")?;rebuilt_reads.extend(needed);}
            let mut runner=Runner::new(tx,&source,context,Meter::new(Ceilings::job(),Cut::Abort),0);
            let patch=match runner.run(&fill.program){Ok(Value::Row(f)|Value::Map(f))=>f.into_iter().collect::<BTreeMap<_,_>>(),Ok(_)=>{bad.add(id,"down projection did not return an object");return Ok(())},Err(e)=>{bad.add(id,&e.to_string());return Ok(())}};
            if runner.read_cut().is_some(){bad.add(id,"reverse lookup did not complete; reduce its bounded work");return Ok(())}
            if patch.keys().cloned().collect::<BTreeSet<_>>()!=fill.outputs{return Err(refusal("down projection returned undeclared output fields"))}
            let patch:BTreeMap<_,_>=patch.into_iter().filter(|(c,_)|projected_outputs.contains(c)).collect();
            let reversed=projected_outputs.iter().map(|c|{
                // Each rollback owns this cycle's current physical preimage,
                // including newer writes and absence since the last restoration.
                let value=fields.get(c).cloned();
                (c.clone(),value)
            }).collect();
            let e=Evidence{computed:BTreeMap::new(),authored:BTreeSet::new(),reversed,retained:BTreeSet::new(),absent:BTreeSet::new(),epoch:tx.meta("generation")?.and_then(|s|s.parse::<i64>().ok()).unwrap_or(0).saturating_add(1),active:false,inputs,before:BTreeMap::new(),after:patch.clone()};
            tx.conn().execute("INSERT INTO temp._downfill_pending VALUES(?1,?2,?3,?4,?5)",params![t,id,key,canonical_json(&patch),canonical_json(&e)])?;count+=1;Ok(())
        })?;
        if bad.count>0{return Err(refusal(format!("down {} {}: {}",fill.table,fill.name,bad.describe())))}
        if preimages>0 {report.backfills.push(format!("{} {} retained predecessor preimages on {preimages} rows; sample ids [{}]; the older release serves the retained predecessor representation; newer source cells remain retained for forward",fill.table,fill.name,preimage_ids.join(", ")));}
        if count>0{report.backfills.push(format!("{} {} projected {count} {} down",fill.table,fill.name,if count==1{"row"}else{"rows"}));}
    }
    Ok(true)
}
// @ref LLP 3000.000.000#191-declared-old-views-and-renames — all down expressions observe the assembled newer snapshot before any forward preimage is restored.
fn apply_staged_downfills(tx:&Tx<'_>)->Result<(),RuntimeError>{
    let mut stmt=tx.conn().prepare("SELECT t,id,definition,patch,evidence,octet_length(patch)+octet_length(evidence) FROM temp._downfill_pending ORDER BY t,id,definition")?;let mut rows=stmt.query([])?;
    while let Some(r)=rows.next()? {let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;
        let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((r.get::<_,i64>(5)?.max(0) as u64).saturating_mul(64).saturating_add(8192)).map_err(|err|refusal(format!("down projection staged reversal evidence exceeds its read budget: {err}; reduce the per-row migration image")))?;
        let patch:BTreeMap<String,Value>=decode(&r.get::<_,String>(3)?)?;let e:Evidence=decode(&r.get::<_,String>(4)?)?;
        let (mut row,in_r)=load_image(tx,t,&id)?.ok_or_else(||refusal("down source lifetime ended before its staged patch"))?;if let Value::Row(f)|Value::Map(f)=&mut row{f.extend(patch)}
        patch_retained(tx,t,&id,e.after.iter().map(|(c,v)|(c.as_str(),Some(v))))?;
        if in_r {tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;super::movement::rewrite(tx,t,&id,&row)?;}save(tx,t,&id,&key,&e,false)?;
    }
    drop(rows);drop(stmt);tx.conn().execute_batch("DROP TABLE temp._downfill_pending;")?;tx.set_meta("activation_population","true")?;Ok(())
}

pub(super) fn transition(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>,sources:&BTreeMap<String,Table>,now:i64,report:&mut super::adoption_report::AdoptionReport)->Result<(),RuntimeError>{
    if next.backfills.is_empty() && next.downfills.is_empty()
        && previous.is_none_or(|s|s.backfills.is_empty() && s.downfills.is_empty()) && !present(tx)? { return Ok(()); }
    enable(tx)?;
    tx.conn().execute_batch("CREATE TEMP TABLE _backfill_unprovided(t INTEGER NOT NULL,id TEXT NOT NULL,column_name TEXT NOT NULL,PRIMARY KEY(t,id,column_name)) WITHOUT ROWID;
    CREATE TEMP TABLE _backfill_native_restored(t INTEGER NOT NULL,id TEXT NOT NULL,column_name TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,id,column_name)) WITHOUT ROWID;")?;
    let _source_mask=SourceMask(tx);
    for fill in &next.backfills {
        fill.admit(next).map_err(refusal)?;
        if fill.name.starts_with("$rename:up:") {
                if fill.inputs.len()!=1 || fill.outputs.len()!=1 {return Err(refusal("generated column rename must have exactly one input and output"))}


        }
        if let Some(old)=sources.get(&fill.table) {for c in &fill.outputs {
            if source_owned(old,c) {
                return Err(refusal(format!("backfill {} {}: output {c} is a historical lifetime or engine field; preserve its source meaning in a bridge",fill.table,fill.name)));
            }
        }}
    }
    let mut down_names=BTreeSet::new();let mut down_outputs=BTreeSet::new();
    for fill in &next.downfills {
        fill.admit_down(next).map_err(refusal)?;
        if !down_names.insert((&fill.table,&fill.name)) || fill.outputs.iter().any(|c|!down_outputs.insert((&fill.table,c))) {
            return Err(refusal(format!("down projections require distinct names and disjoint outputs on {} {}",fill.table,fill.name)))
        }
    }
    // A name is immutable within a continuous lineage. Replacing a transform
    // deliberately goes through an old-source/bridge transition first.
    if let Some(old)=previous {for f in &next.backfills {if let Some(p)=old.backfills.iter().find(|p|p.table==f.table && p.name==f.name && p.key()!=f.key()) {return Err(refusal(format!("backfill {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",f.table,f.name,p.key(),f.key())));}}}
    if let Some(old)=previous {for f in &next.downfills {if let Some(p)=old.downfills.iter().find(|p|p.table==f.table && p.name==f.name && p.down_key()!=f.down_key()) {return Err(refusal(format!("down {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",f.table,f.name,p.down_key(),f.down_key())));}}}
    // Names keep one meaning throughout durable store history, including gaps
    // without the table or declaration. A different transform needs a new name.
    let mut known=tx.conn().prepare("SELECT octet_length(definition),definition FROM _backfill_definitions ORDER BY digest")?;
    let mut definitions=known.query([])?;
    while let Some(row)=definitions.next()? {
        let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((row.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
        let old:Backfill=decode(&row.get::<_,String>(1)?)?;
        if let Some(new)=next.backfills.iter().find(|f|f.table==old.table && f.name==old.name && f.key()!=old.key()) {
            return Err(refusal(format!("backfill {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",old.table,old.name,old.key(),new.key())));
        }
    }
    let mut known_down=tx.conn().prepare("SELECT octet_length(definition),definition FROM _downfill_definitions ORDER BY digest")?;
    let mut down_definitions=known_down.query([])?;
    while let Some(row)=down_definitions.next()? {
        let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((row.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
        let old:Backfill=decode(&row.get::<_,String>(1)?)?;
        if let Some(new)=next.downfills.iter().find(|f|f.table==old.table && f.name==old.name && f.down_key()!=old.down_key()) {
            return Err(refusal(format!("down {} {} changed historical meaning; old digest {}; new digest {}; first select a bridge preserving current values, repair through an authorized mutation, declare a new name for new meaning, then preview the destination",old.table,old.name,old.down_key(),new.down_key())))
        }
    }
    for fill in &next.backfills {
        tx.conn().execute("INSERT OR IGNORE INTO _backfill_definitions VALUES(?1,?2)",params![fill.key(),canonical_json(fill)])?;
    }
    for fill in next.downfills.iter().chain(previous.into_iter().flat_map(|s|s.downfills.iter())) {
        tx.conn().execute("INSERT OR IGNORE INTO _downfill_definitions VALUES(?1,?2)",params![fill.down_key(),canonical_json(fill)])?;
    }
    mark_down_native(tx,next)?;
    let next_keys:BTreeSet<_>=next.backfills.iter().map(Backfill::key).collect();
    let down_pending=if let Some(previous)=previous{stage_downfills(tx,next,previous,sources,now,report)?}else{false};
    let definitions:Vec<Backfill>=tx.conn().prepare("SELECT definition FROM _backfill_definitions WHERE digest IN (SELECT definition FROM _backfill_evidence WHERE active=1 OR retained_outputs!='[]' UNION SELECT definition FROM _backfill_pruned WHERE active=1 OR retained_outputs!='[]') ORDER BY digest")?.query_map([],|r|r.get::<_,String>(0))?.map(|s|decode(&s?)).collect::<Result<_,RuntimeError>>()?;
    for fill in definitions.iter().rev().filter(|f|!next_keys.contains(&f.key())) {
        let Some(table)=next.table(&fill.table) else {continue};
        let t=tx.num(&fill.table)?;let key=fill.key();let mut bad=super::adopt_refusals::Samples::default();let mut count=0;
        super::activation::walk(tx,t,|id,mut row|{
            let Some(mut e)=evidence(tx,t,id,&key)? else {
                let pruned:Option<(bool,String)>=tx.conn().query_row("SELECT active,retained_outputs FROM _backfill_pruned WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,key],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
                let unavailable=if let Some((active,retained))=pruned {if active {fill.outputs.clone()}else{decode::<BTreeSet<String>>(&retained)?}}else{BTreeSet::new()};
                if unavailable.iter().any(|c|table.columns.contains_key(c)) {bad.add(id,"rollback preimage was explicitly pruned; select a bridge preserving current data or restore a backup");}
                return Ok(())
            };
            if !e.active && e.retained.is_empty() {return Ok(())}
            let fields=match &mut row {Value::Row(f)|Value::Map(f)=>f,_=>return Err(refusal("invalid stored row"))};
            let mut changed=false;let mut restored=BTreeMap::new();
            for c in &fill.outputs {
                if !e.active && !e.retained.contains(c){continue;}
                if !table.columns.contains_key(c){e.retained.insert(c.clone());continue;}

                let current=fields.get(c);let before=e.before.get(c);let after=e.after.get(c);
                // @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — an inactive receipt is history, not a competing live output owner.
                if !e.active {
                    let successor:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_evidence e JOIN _backfill_definitions d ON d.digest=e.definition, json_each(d.definition,'$.outputs') output WHERE e.t=?1 AND e.id=?2 AND e.active=1 AND e.definition!=?3 AND output.value=?4)",params![t,id,key,c],|r|r.get(0))?;
                    let reentering=next.backfills.iter().any(|f|f.table==fill.table&&f.key()!=key&&f.outputs.contains(c));
                    let accepted_view=e.reversed.get(c).is_some_and(|v|v.as_ref()==current);
                    if successor || (reentering&&accepted_view) {continue;}
                }

                if (current!=after && current!=before) || e.authored.contains(c) {
                    let projected=if down_pending {
                        let patches:Vec<String>=tx.conn().prepare("SELECT patch FROM temp._downfill_pending WHERE t=?1 AND id=?2")?.query_map(params![t,id],|r|r.get(0))?.collect::<Result<_,_>>()?;
                        let mut value=None;
                        for patch in patches {let patch:BTreeMap<String,Value>=decode(&patch)?;if let Some(v)=patch.get(c){value=Some(v.clone());}}
                        value
                    } else {None};
                    if let Some(view)=projected {
                        if e.computed.is_empty() && e.active && e.authored.is_empty(){e.computed=e.after.clone();}
                        if let Some(value)=current {e.after.insert(c.clone(),value.clone());e.authored.insert(c.clone());}
                        e.reversed.insert(c.clone(),Some(view));
                        e.retained.insert(c.clone());
                        continue;
                    }
                    if crate::engine::validate::validate_column(&fill.table,c,&table.columns[c],current).is_ok() {
                        // The selected bridge can represent this exact authored value.
                        if e.computed.is_empty() && e.active && e.authored.is_empty(){e.computed=e.after.clone();}
                        if let Some(value)=current {e.after.insert(c.clone(),value.clone());e.authored.insert(c.clone());}
                        e.reversed.insert(c.clone(),current.cloned());
                        e.retained.insert(c.clone());
                        continue;
                    }
                    bad.add(id,&format!("{}.{} changed after backfill {}; current {}; backfill {}; predecessor {}; declare a truthful down or select a bridge admitting the current value",fill.table,c,fill.name,display_cell(current),display_cell(after),display_cell(before)));return Ok(())
                }
                if let Some(value)=before {fields.insert(c.clone(),value.clone());}else{
                    fields.remove(c);
                    note_native_absence(tx,t,id,c)?;
                    tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_unprovided VALUES(?1,?2,?3)",params![t,id,c])?;
                }
                let mut view=Value::Row(fields.clone());materialize_optional_fields(&mut view,table);
                restored.insert(c.clone(),fields.get(c).cloned());
                e.reversed.insert(c.clone(),view.field(c).ok().cloned());
                e.retained.remove(c);
                changed=true;
            }
            if changed {patch_retained(tx,t,id,restored.iter().map(|(c,v)|(c.as_str(),v.as_ref())))?;tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;super::movement::rewrite(tx,t,&id,&row)?;count+=1;}
            save(tx,t,id,&key,&e,false)
        })?;
        if bad.count>0 {return Err(refusal(format!("backfill {} {} rollback: {}",fill.table,fill.name,bad.describe())))}
        if count>0 {report.backfills.push(format!("{} {} reversed on {count} {}",fill.table,fill.name,if count==1 {"row"}else{"rows"}));tx.set_meta("activation_population","true")?;}
    }
    restore_downfills(tx,next,previous,sources,report)?;
    if down_pending {apply_staged_downfills(tx)?;}
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
        mask_unprovided(tx)?;
        if let Some(epoch)=epoch {
            replay_earlier_cohorts(tx,epoch)?;
            historical_snapshot(tx,epoch,&next_keys)?;
            inactive_snapshot(tx,previous,&entering_keys,epoch)?;
        }
        rebuild_reads(tx,&source,&reads)?;
    for fill in &entering {
        let input_only=input_only(&fill.program.body);
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
                let native_image=native_inputs(tx,t,id,&current,fill.inputs.keys().filter(|c|!fill.outputs.contains(*c)).map(String::as_str),row_source.as_deref())?;
                if fill.inputs.iter().any(|(c,kind)|!fill.outputs.contains(c) && !physically_absent.contains(c) && crate::engine::validate::validate_column(&fill.table,c,kind,native_image.get(c)).is_err()) {
                    bad.add(id,"native image has an invalid present historical input; use a typed bridge");return Ok(())
                }
                let mut conflict=false;
                let mut q=tx.conn().prepare("SELECT octet_length(definition),definition FROM _backfill_definitions WHERE digest IN (SELECT definition FROM _backfill_pruned WHERE t=?1 AND id=?2)")?;
                let mut pruned=q.query(params![t,id])?;
                while let Some(row)=pruned.next()? {
                    let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((row.get::<_,i64>(0)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
                    let definition:Backfill=decode(&row.get::<_,String>(1)?)?;
                    if !definition.outputs.is_disjoint(&fill.outputs) {conflict=true;break;}
                }
                let others:Vec<String>=tx.conn().prepare("SELECT e.definition FROM _backfill_evidence e JOIN _backfill_definitions d ON d.digest=e.definition WHERE e.t=?1 AND e.id=?2")?.query_map(params![t,id],|r|r.get(0))?.collect::<Result<_,_>>()?;
                for other in others {if let Some(e)=evidence(tx,t,id,&other)? {
                    for c in fill.outputs.intersection(&e.after.keys().cloned().collect()) {
                        if e.active || current.field(c).ok()!=e.before.get(c) {conflict=true;}
                    }
                }}
                if conflict {
                    bad.add(id,"native output also has a different transformation's history; resolve its intended view in a bridge");return Ok(())
                }
                let complete=fill.outputs.iter().all(|c|current.field(c).is_ok() && validate_output(&fill.table,table,c,current.field(c).unwrap()).is_ok());
                let fingerprint=crate::value::digest(&native_image);
                if !complete {bad.add(id,"native backfill output image is missing or was explicitly pruned; use a bridge or restore a backup");return Ok(())}
                if !native.contains(&fingerprint) {
                    let args=native_inputs(tx,t,id,&current,fill.inputs.keys().map(String::as_str),row_source.as_deref())?;
                    if fill.inputs.iter().any(|(c,k)|crate::engine::validate::validate_column(&fill.table,c,k,args.get(c)).is_err()) {
                        bad.add(id,"native backfill inputs changed outside its owning release and cannot be recomputed; use a bridge");return Ok(())
                    }
                    let mut context=migration_context(tx,now)?;context.args=args;
                    let mut runner=Runner::new(tx,&source,context,Meter::new(Ceilings::job(),Cut::Abort),0);
                    let agrees=match runner.run(&fill.program) {Ok(Value::Row(p)|Value::Map(p)) if runner.read_cut().is_none()=>p.iter().all(|(c,v)|current.field(c).ok()==Some(v)) && p.keys().cloned().collect::<BTreeSet<_>>()==fill.outputs,_=>false};
                    if !agrees {bad.add(id,"native backfill inputs changed outside its owning release and recomputation differs from its authored output; preserve it in a bridge");return Ok(())}
                }
                return Ok(())
            }
            let mut original_absence=prior.as_ref().map_or_else(||physically_absent.intersection(&fill.inputs.keys().cloned().collect()).cloned().collect(),|e|e.absent.clone());
            for c in fill.inputs.keys() {if (row.field(c).is_err() || row.field(c)==Ok(&Value::Null)) && tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM temp._backfill_unprovided WHERE t=?1 AND id=?2 AND column_name=?3)",params![t,id,c],|r|r.get::<_,bool>(0))? {original_absence.insert(c.clone());}}
            // Resolve retained inputs before source defaults can synthesize null
            // for a hidden optional column with a provided archived cell.
            let retained=native_inputs(tx,t,id,&row,fill.inputs.keys().map(String::as_str),row_source.as_deref())?;
            if let Some(table)=row_source.as_deref(){materialize_optional_fields(&mut row,table);}
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
            let mut context=migration_context(tx,now)?;context.args=args;
            let mut runner=Runner::new(tx,&source,context,Meter::new(Ceilings::job(),Cut::Abort),0);
            let patch=match runner.run(&fill.program) {Ok(Value::Row(f)|Value::Map(f))=>f.into_iter().collect::<BTreeMap<_,_>>(),Ok(_)=>{bad.add(id,"backfill did not return an object");return Ok(())},Err(e)=>{bad.add(id,&e.to_string());return Ok(())}};
            if runner.read_cut().is_some() {bad.add(id,"historical lookup did not complete; reduce per-row lookup work before adoption");return Ok(())}
            if patch.keys().cloned().collect::<BTreeSet<_>>()!=fill.outputs {return Err(refusal("backfill returned undeclared output fields"))}
            let fields=current.as_object()?;let mut before=BTreeMap::new();let mut desired=patch.clone();let mut native_preserved=BTreeSet::new();
            let mut preimage_meter=Meter::new(Ceilings::job(),Cut::Abort);
            for (c,value) in &patch {
                // A new transform may consume an older receipt's accepted view,
                // but cannot overwrite a distinct retained authored native value.
                let others:Vec<String>=tx.conn().prepare("SELECT definition FROM _backfill_evidence WHERE t=?1 AND id=?2 AND active=0 AND definition!=?3 AND retained_outputs!='[]'")?.query_map(params![t,id,key],|r|r.get(0))?.collect::<Result<_,_>>()?;
                for other in others {if let Some(retained)=evidence(tx,t,id,&other)? {
                    if retained.retained.contains(c)&&retained.authored.contains(c)&&retained.after.get(c)!=Some(value)
                        &&retained.reversed.get(c).is_some_and(|view|view.as_ref()==current.field(c).ok()) {
                        bad.add(id,&format!("{}.{} retained authored output {} conflicts with new backfill {} computation {}; select a bridge that exposes the retained native value, repair it through an authorized mutation, then preview the new named transform",fill.table,c,display_cell(retained.after.get(c)),fill.name,display_cell(Some(value))));return Ok(())
                    }
                }}
                if let Err(e)=validate_output(&fill.table,table,c,value) {bad.add(id,&e.to_string());return Ok(())}
                if let Some(kind)=row_source.as_deref().and_then(|t|t.columns.get(c)) {if protected(kind) && prior.as_ref().is_none_or(|e|e.before.contains_key(c)) {bad.add(id,&format!("cannot overwrite historical reference or asset {}.{c}; derive into a new column",fill.table));return Ok(())}}
                if prior.is_none() && fill.name.starts_with("$rename:up:") {
                    if let Some(existing)=physical_value(tx,t,id,&current,c,&mut preimage_meter)? {
                        if &existing!=value {bad.add(id,&format!("rename destination {}.{c} already has a conflicting value: destination {}, source {}; resolve through an authorized mutation under a bridge; see guide deploy",fill.table,display_cell(Some(&existing)),display_cell(Some(value))));return Ok(())}
                    }
                }
                let transformed=prior.as_ref().is_some_and(|e|e.active || e.retained.contains(c));
                if transformed {
                    if let Some(value)=prior.as_ref().and_then(|e|e.before.get(c)){before.insert(c.clone(),value.clone());}
                } else if row_source.as_deref().is_some_and(|t|t.columns.contains_key(c)) {
                    if let Some(value)=source_value(tx,t,id,&current,c,row_source.as_deref(),&mut preimage_meter)? {before.insert(c.clone(),value);}
                }
                if let Some(prior)=&prior {
                    let native:Option<String>=tx.conn().query_row("SELECT data FROM temp._backfill_native_restored WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,c],|r|r.get(0)).optional()?;
                    if let Some(native)=native {
                        let native:Value=decode(&native)?;
                        if (prior.authored.contains(c)||prior.after.get(c)!=Some(&native)) && fields.get(c)==Some(&native) && crate::engine::validate::validate_column(&fill.table,c,&table.columns[c],Some(&native)).is_ok() {
                            // A validated down receipt proves the native image,
                            // not the forward transform's other dependencies.
                            let unchanged=prior.inputs==inputs && if prior.computed.is_empty(){input_only}else{prior.computed==patch};
                            if !unchanged && &native!=value {
                                bad.add(id,&format!("{}.{} authored output {} conflicts with changed historical inputs/dependencies and recomputation {}",fill.table,c,display_cell(Some(&native)),display_cell(Some(value))));return Ok(())
                            }
                            desired.insert(c.clone(),native);
                            native_preserved.insert(c.clone());
                            continue;
                        }
                    }
                    let computation_same=if prior.computed.is_empty(){input_only && prior.after==patch}else{prior.computed==patch};
                    // Value-equal legacy reprojections are still derived views.
                    // They are not computation certificates for authored output:
                    // the authored gate below separately requires computation_same.
                    let deps_same=prior.inputs==inputs && prior.after==patch;
                    let current_field=fields.get(c);
                    let original=prior.before.get(c);
                    let expected=prior.reversed.get(c).cloned().unwrap_or_else(||original.cloned());
                    let actual=if transformed {None}else{source_value_impl(tx,t,id,&current,c,row_source.as_deref(),&mut preimage_meter,false)?};
                    if !transformed && actual.as_ref()!=expected.as_ref() && actual.as_ref()!=prior.after.get(c) && actual.as_ref()!=Some(value) {
                        bad.add(id,&format!("{}.{} changed while backfill {} was absent: older-release value {}, expected old view {}, retained newer value {}, recomputed value {}",fill.table,c,fill.name,display_cell(actual.as_ref()),display_cell(expected.as_ref()),display_cell(prior.after.get(c)),display_cell(Some(value))));return Ok(())
                    }
                    if prior.authored.contains(c)&&(prior.inputs!=inputs||!computation_same)&&current_field!=Some(value){
                        bad.add(id,&format!("{}.{} authored output {} conflicts with changed historical inputs/dependencies and recomputation {}",fill.table,c,display_cell(current_field),display_cell(Some(value))));return Ok(())
                    }
                    if prior.authored.contains(c) && computation_same && prior.inputs==inputs && current_field==prior.after.get(c) && current_field.is_some() {
                        desired.insert(c.clone(),current_field.unwrap().clone());
                    } else if deps_same && transformed && current_field.is_some() {
                        // Added columns retain edits under v1's dormant storage.
                        desired.insert(c.clone(),current_field.unwrap().clone());
                    } else if transformed && !deps_same && current_field!=prior.after.get(c) && current_field!=original && current_field!=Some(value) {
                        bad.add(id,&format!("{}.{} was edited and its historical inputs changed: current {}, retained output {}, recomputed {}",fill.table,c,display_cell(current_field),display_cell(prior.after.get(c)),display_cell(Some(value))));return Ok(())
                    }
                }
            }
            for(c,value)in &desired {if let Err(e)=validate_output(&fill.table,table,c,value){bad.add(id,&e.to_string());return Ok(())}}
            let mut after=patch.clone();
            let mut authored=prior.as_ref().map(|e|e.authored.clone()).unwrap_or_default();authored.extend(native_preserved);
            for c in &authored{if let Some(value)=desired.get(c){after.insert(c.clone(),value.clone());}}
            let e=Evidence{computed:if !authored.is_empty(){patch.clone()}else{BTreeMap::new()},authored,reversed:BTreeMap::new(),retained:BTreeSet::new(),absent:original_absence,epoch:epoch.unwrap_or(fresh_epoch),active:true,inputs,before,after};
            tx.conn().execute("INSERT INTO temp._backfill_pending VALUES(?1,?2,?3,?4,?5)",params![t,id,key,canonical_json(&desired),canonical_json(&e)])?;count+=1;
            Ok(())
        })?;
        if bad.count>0{return Err(forward_refusal(format!("backfill {} {}: {}",fill.table,fill.name,bad.describe())))}
        if count>0{report.backfills.push(format!("{} {} transformed {count} {}",fill.table,fill.name,if count==1 {"row"}else{"rows"}));}
    }
    }
    restore_snapshot(tx)?;
    // Stream patches; avoid retaining the whole transformed population in RAM.
    let mut stmt=tx.conn().prepare("SELECT t,id,definition,patch,evidence,octet_length(patch)+octet_length(evidence) FROM temp._backfill_pending ORDER BY t,id,definition")?;
    let mut rows=stmt.query([])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;
        let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((r.get::<_,i64>(5)?.max(0) as u64).saturating_mul(64).saturating_add(8192)).map_err(|err|refusal(format!("backfill staged reversal evidence exceeds its read budget: {err}; reduce the per-row migration image")))?;
        let patch:BTreeMap<String,Value>=decode(&r.get::<_,String>(3)?)?;let e:Evidence=decode(&r.get::<_,String>(4)?)?;
        let data:String=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0))?;let mut row:Value=decode(&data)?;
        patch_retained(tx,t,&id,patch.iter().map(|(c,v)|(c.as_str(),Some(v))))?;
        if let Value::Row(f)|Value::Map(f)=&mut row {f.extend(patch);}
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;super::movement::rewrite(tx,t,&id,&row)?;
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
                let unchanged=prior.as_ref().is_some_and(|p|p.inputs.field(c).ok()==Some(value));
                capture_input_refs(tx,t,&id,c,&binding,kind,value,unchanged)?;
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
// @ref LLP 3000.000.000.003#forward-dependencies-remain-binding — unknown computations need certificates for data reads.
// Index discovery is not purity: fileText also reads the ledger and file bytes.
// Migration admission has already checked the deterministic instruction subset.
fn input_only(body:&[crate::ir::Stmt])->bool {
    use crate::ir::{Expr,Stmt,Builtin};
    fn value(expr:&Expr)->bool {match expr {
        Expr::Literal(_)|Expr::Variable(_)=>true,
        Expr::Array(values)=>values.iter().all(value),Expr::Object(fields)=>fields.values().all(value),
        Expr::Shape{base,fields}=>value(base)&&fields.values().all(value),
        Expr::Field{base,..}|Expr::Unary{value:base,..}=>value(base),
        Expr::Binary{left,right,..}=>value(left)&&value(right),
        Expr::Block{body,value:result}=>input_only(body)&&value(result),
        Expr::Builtin{builtin,args}=>!matches!(builtin,Builtin::FileText)&&args.iter().all(value),
        _=>false,
    }}
    body.iter().all(|stmt|match stmt {
        Stmt::Let{value:expr,..}|Stmt::Const{value:expr,..}|Stmt::Assign{value:expr,..}|Stmt::Return(expr)=>value(expr),
        Stmt::Require{condition,..}=>value(condition),
        Stmt::If{condition,then_body,else_body}=>value(condition)&&input_only(then_body)&&input_only(else_body),
        _=>false,
    })
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

// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — pruning is a loss of migration evidence, not a way to reset immutable declaration names.
pub(super) fn prune_warnings(tx:&Tx<'_>)->Result<Vec<String>,RuntimeError>{
    if !present(tx)? {return Ok(Vec::new())}
    let mut outputs:BTreeMap<String,BTreeSet<String>>=BTreeMap::new();
    let mut q=tx.conn().prepare("SELECT d.definition FROM _backfill_definitions d WHERE EXISTS(SELECT 1 FROM _backfill_evidence e WHERE e.definition=d.digest)")?;
    for definition in q.query_map([],|r|r.get::<_,String>(0))? {
        let f:Backfill=decode(&definition?)?;
        outputs.entry(f.table).or_default().extend(f.outputs);
    }
    let mut warnings=Vec::new();
    let mut q=tx.conn().prepare("SELECT d.digest,d.definition,EXISTS(SELECT 1 FROM _backfill_evidence e WHERE e.definition=d.digest) FROM _downfill_definitions d ORDER BY d.digest")?;
    for definition in q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,bool>(2)?)))? {
        let (_,definition,has_receipt)=definition?;let f:Backfill=decode(&definition)?;
        if has_receipt || outputs.get(&f.table).is_some_and(|fields|!fields.is_disjoint(&f.outputs)) {
            warnings.push(format!("prune blinds down {} {}: its reverse/native or predecessor preimages will be discarded; future rollback or forward may refuse; retain history or restore a backup. Prune does not reset declaration names or digests",f.table,f.name));
        }
    }
    Ok(warnings)
}

// Prune forgets historical values, retaining only the fact that exact reversal
// is no longer available. No tombstone can be queried by an app.
pub(super) fn prune(tx:&Tx<'_>)->Result<(),RuntimeError>{
    if present(tx)? {tx.conn().execute_batch("DELETE FROM _backfill_evidence WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_evidence.t AND r.id=_backfill_evidence.id); DELETE FROM _backfill_pruned WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_pruned.t AND r.id=_backfill_pruned.id); INSERT OR IGNORE INTO _backfill_pruned(t,id,definition,active,retained_outputs) SELECT t,id,definition,active,retained_outputs FROM _backfill_evidence; DELETE FROM _backfill_evidence; DELETE FROM _backfill_absence WHERE (definition!='' AND definition NOT LIKE '$native:%') OR NOT EXISTS(SELECT 1 FROM r WHERE r.t=_backfill_absence.t AND r.id=_backfill_absence.id);")?;}
    Ok(())
}
pub(super) fn inventory_sql(conn:&Connection)->Result<&'static str,RuntimeError>{
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_backfill_evidence')",[],|r|r.get(0))?;
    Ok(if exists {" UNION ALL SELECT c.name||'.backfill#'||substr(e.definition,1,12),'backfill',c.name,e.definition FROM _backfill_evidence e JOIN _catalog c ON c.num=e.t GROUP BY e.t,e.definition "}else{""})
}

pub(crate) fn has_evidence(tx:&Tx<'_>)->Result<bool,RuntimeError>{present(tx)}
pub(super) fn columns(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>)->Result<BTreeMap<String,BTreeSet<String>>,RuntimeError>{
    let mut out:BTreeMap<String,BTreeSet<String>>=BTreeMap::new();
    for f in &next.backfills {out.entry(f.table.clone()).or_default().extend(f.outputs.iter().cloned());}
    for f in &next.downfills {out.entry(f.table.clone()).or_default().extend(f.outputs.iter().cloned());}
    for f in previous.into_iter().flat_map(|s|s.downfills.iter()) {out.entry(f.table.clone()).or_default().extend(f.outputs.iter().cloned());}
    if present(tx)? {
        let mut statement=tx.conn().prepare("SELECT definition FROM _backfill_definitions WHERE digest IN (SELECT definition FROM _backfill_evidence WHERE active=1 OR retained_outputs!='[]' UNION SELECT definition FROM _backfill_pruned WHERE active=1 OR retained_outputs!='[]')")?;
        for text in statement.query_map([],|r|r.get::<_,String>(0))? {
            let f:Backfill=decode(&text?)?;out.entry(f.table).or_default().extend(f.outputs);
        }
        let mut statement=tx.conn().prepare("SELECT definition FROM _downfill_definitions WHERE digest IN (SELECT definition FROM _backfill_evidence UNION SELECT definition FROM _backfill_pruned)")?;
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
// A reversed, originally absent cell must have the same meaning in explicit
// arguments, point lookups and lookup indexes. Null is a temporary source-view
// marker; the saved physical image is restored before committing any patch.
fn mask_unprovided(tx:&Tx<'_>)->Result<(),RuntimeError>{
    // @ref LLP 3000.000.000#191-declared-old-views-and-renames — close each source cursor before mutating its physical image.
    let mut after=(i64::MIN,String::new());
    loop {
        let next:Option<(i64,String,i64)>=tx.conn().query_row("SELECT r.t,r.id,octet_length(r.data) FROM r WHERE (r.t,r.id)>(?1,?2) AND EXISTS(SELECT 1 FROM temp._backfill_unprovided m WHERE m.t=r.t AND m.id=r.id) ORDER BY r.t,r.id LIMIT 1",params![after.0,after.1],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let Some((t,id,bytes))=next else{break};
        after=(t,id.clone());
        let mut meter=Meter::new(Ceilings::job(),Cut::Abort);meter.heap((bytes.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
        let data:String=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0))?;let mut row:Value=decode(&data)?;
        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_originals SELECT t,id,data FROM r WHERE t=?1 AND id=?2",params![t,id])?;
        if let Value::Row(fields)|Value::Map(fields)=&mut row {
            let mut columns=tx.conn().prepare("SELECT column_name FROM temp._backfill_unprovided WHERE t=?1 AND id=?2")?;
            for c in columns.query_map(params![t,id],|r|r.get::<_,String>(0))? {fields.entry(c?).or_insert(Value::Null);}
        }
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    }Ok(())
}
// Recorded later cohorts originally saw earlier releases' completed patches.
// Replaying those older cohorts virtually preserves that ordering; fresh
// declarations still run first against the untouched predecessor snapshot.
fn replay_earlier_cohorts(tx:&Tx<'_>,epoch:i64)->Result<(),RuntimeError>{
    let mut stmt=tx.conn().prepare("SELECT t,id,octet_length(patch),patch FROM temp._backfill_pending WHERE CAST(json_extract(evidence,'$.epoch') AS INTEGER)<?1 ORDER BY t,id,definition")?;
    let mut rows=stmt.query([epoch])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;
        let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;
        let Some(bytes)=bytes else{continue};
        let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap((bytes.max(0) as u64).saturating_add(r.get::<_,i64>(2)?.max(0) as u64).saturating_mul(64).saturating_add(8192))?;
        let data:String=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0))?;let mut row:Value=decode(&data)?;
        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_originals SELECT t,id,data FROM r WHERE t=?1 AND id=?2",params![t,id])?;
        let patch:BTreeMap<String,Value>=decode(&r.get::<_,String>(3)?)?;
        if let Value::Row(fields)|Value::Map(fields)=&mut row {fields.extend(patch);}
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    }Ok(())
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
        if let Value::Row(inputs)|Value::Map(inputs)=&e.inputs {for(c,value)in inputs {
            if e.absent.contains(c) || !fields.contains_key(c) || fields.get(c)==Some(value) {
                let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(&key,c)],|r|r.get(0))?;
                if invalid {return Err(refusal(format!("historical backfill reference {c} on {id} lost its parent lifetime")));}
                if e.absent.contains(c) {fields.insert(c.clone(),value.clone());}else{fields.entry(c.clone()).or_insert(value.clone());}
            }
        }}
        for c in e.after.keys() {if !e.before.contains_key(c) {fields.insert(c.clone(),Value::Null);}}
        for(c,value)in e.before {fields.insert(c,value);}
        // Keep the receipt's omitted-input meaning separate from its later
        // rollback output preimage/default.
        for c in &e.absent {if let Ok(value)=e.inputs.field(c){fields.insert(c.clone(),value.clone());}}
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    } Ok(())
}
fn rebuild_reads(tx:&Tx<'_>,source:&Schema,reads:&BTreeSet<(String,String)>)->Result<(),RuntimeError>{
    for (name,index) in reads {
        let old=source.table(name).and_then(|t|t.index(index)).ok_or_else(||refusal(format!("migration lookup {name}.{index} is not declared in its source schema")))?;let ti=tx.num(&format!("{name}.{index}"))?;
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
        if field==column {crate::engine::validate::validate_text_value(&format!("{name}.{column}"),value,*min,*format)?;}
    }}Ok(())
}

// Ordinary cell bindings can carry a newer transformed reference type than
// the archived whole-row definition. Copy those exact lifetime bindings before
// restoration consumes its ordinary ledger; same-value replay never rebinds.
fn capture_input_refs(tx:&Tx<'_>,t:i64,id:&str,column:&str,binding:&str,kind:&crate::schema::ColumnType,value:&Value,unchanged:bool)->Result<(),RuntimeError>{
    if !unchanged {tx.conn().execute("DELETE FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,binding])?;}
    let mut admission=Meter::new(Ceilings::job(),Cut::Abort);admission.heap(value.retained_heap_bytes().saturating_mul(64).saturating_add(8192))?;
    fn ids(value:&Value,out:&mut BTreeSet<String>){match value {Value::Id(id)=>{out.insert(id.clone());},Value::Array(values)=>for value in values {ids(value,out)},_=>()}}
    let mut values=BTreeSet::new();ids(value,&mut values);let mut known=BTreeSet::new();
    if unchanged {tx.conn().execute("DELETE FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND parent_id NOT IN (SELECT value FROM json_each(?4))",params![t,id,binding,canonical_json(&values)])?;}
    let mut stmt=tx.conn().prepare("SELECT parent_t,parent_id,invalid FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3")?;
    let mut rows=stmt.query(params![t,id,column])?;
    while let Some(row)=rows.next()? {
        let parent:String=row.get(1)?;if !values.contains(&parent){continue;}
        tx.conn().execute("INSERT OR IGNORE INTO _dormant_refs VALUES(?1,?2,?3,?4,?5,?6)",params![t,id,binding,row.get::<_,i64>(0)?,parent,row.get::<_,i64>(2)?])?;known.insert(parent);
    }
    super::dormant::capture_refs_preserving(tx,t,id,binding,kind,value,&known)
}

fn input_ref(key:&str,column:&str)->String {format!("$backfill:{key}:{column}")}

// A prior transformation's retained added output is not its own old argument
// on forward selection after rollback. Other declarations still see the new
// predecessor snapshot rather than an old cohort's overwritten columns.
fn inactive_snapshot(tx:&Tx<'_>,_previous:Option<&Schema>,keys:&BTreeSet<String>,epoch:i64)->Result<(),RuntimeError>{
    let mut q=tx.conn().prepare("SELECT t,id,definition FROM _backfill_evidence WHERE active=0 AND epoch=?1 ORDER BY t,id,definition")?;
    let mut rows=q.query([epoch])?;
    while let Some(r)=rows.next()? {
        let t:i64=r.get(0)?;let id:String=r.get(1)?;let key:String=r.get(2)?;if !keys.contains(&key){continue;}
        let e=evidence(tx,t,&id,&key)?.unwrap();
        if e.retained.is_empty() && e.absent.is_empty(){continue;}
        let data:Option<String>=tx.conn().query_row("SELECT data FROM r WHERE t=?1 AND id=?2",params![t,id],|r|r.get(0)).optional()?;let Some(data)=data else{continue};
        tx.conn().execute("INSERT OR IGNORE INTO temp._backfill_originals SELECT t,id,data FROM r WHERE t=?1 AND id=?2",params![t,id])?;
        let mut row:Value=decode(&data)?;if let Value::Row(fields)|Value::Map(fields)=&mut row {
            for c in &e.retained {fields.insert(c.clone(),e.before.get(c).cloned().unwrap_or(Value::Null));}
            for c in &e.absent {
                let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND invalid=1)",params![t,id,input_ref(&key,c)],|r|r.get(0))?;
                if invalid {return Err(refusal(format!("historical backfill reference {c} on {id} lost its parent lifetime")));}
                if let Ok(value)=e.inputs.field(c){fields.insert(c.clone(),value.clone());}
            }
        }
        tx.conn().execute("UPDATE r SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&row),t,id])?;
    }Ok(())
}

// Empty definition denotes currently omitted physical input cells; a definition
// digest denotes absence at that receipt's adoption. Defaults may materialize
// during retention without turning omitted inputs into authored values.
pub(crate) fn prepare_inputs(tx:&Tx<'_>,next:&Schema,previous:Option<&Schema>)->Result<(),RuntimeError>{
    if next.backfills.is_empty() && next.downfills.is_empty()
        && previous.is_none_or(|s|s.backfills.is_empty() && s.downfills.is_empty()) && !present(tx)? {return Ok(());}
    enable(tx)?;
    // Check the actual predecessor before prepare_inputs registers new definitions.
    // Re-entry validates immutable receipts and actual rows; retired constraints
    // are not a new native source domain.
    for fill in next.backfills.iter().filter(|f|f.name.starts_with("$rename:up:")) {
        let registered:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _backfill_definitions WHERE digest=?1)",[fill.key()],|r|r.get(0))?;
        if !registered {if let Some(source)=previous.and_then(|s|s.table(&fill.table)) {
            if let (Some(input),Some(output))=(fill.inputs.keys().next(),fill.outputs.iter().next()) {
                if source.columns.contains_key(input) && !crate::schema::backfill::rename_column_accepts(source,input,&next.tables[&fill.table],output) {
                    return Err(refusal(format!("column rename on {} requires the new scalar domain to include the old domain; use a fresh declaration name with typed backfill/down for changed meaning",fill.table)));
                }
            }
        }}
    }
    tx.conn().execute("DELETE FROM _backfill_absence WHERE definition='$restored-native'",[])?;
    tx.conn().execute("DELETE FROM _backfill_active",[])?;
    for fill in &next.backfills {tx.conn().execute("INSERT INTO _backfill_active VALUES(?1,?2,?3)",params![tx.num(&fill.table)?,fill.key(),canonical_json(&fill.inputs.keys().filter(|c|!fill.outputs.contains(*c)).collect::<Vec<_>>())])?;}
    for fill in &next.downfills {tx.conn().execute("INSERT INTO _backfill_active VALUES(?1,?2,?3)",params![tx.num(&fill.table)?,fill.down_key(),canonical_json(&fill.inputs.keys().collect::<Vec<_>>())])?;}
    for fill in next.backfills.iter().chain(previous.into_iter().flat_map(|s|s.backfills.iter())) {
        tx.conn().execute("INSERT OR IGNORE INTO _backfill_definitions VALUES(?1,?2)",params![fill.key(),canonical_json(fill)])?;
        for c in fill.inputs.keys() {tx.conn().execute("INSERT OR IGNORE INTO _backfill_inputs VALUES(?1,?2)",params![tx.num(&fill.table)?,c])?;}
    }
    for fill in next.downfills.iter().chain(previous.into_iter().flat_map(|s|s.downfills.iter())) {
        for c in fill.inputs.keys() {tx.conn().execute("INSERT OR IGNORE INTO _backfill_inputs VALUES(?1,?2)",params![tx.num(&fill.table)?,c])?;}
    }
    let tables:Vec<i64>=tx.conn().prepare("SELECT DISTINCT t FROM _backfill_inputs")?.query_map([],|r|r.get(0))?.collect::<Result<_,_>>()?;
    for t in tables {
        let columns:Vec<String>=tx.conn().prepare("SELECT column_name FROM _backfill_inputs WHERE t=?1")?.query_map([t],|r|r.get(0))?.collect::<Result<_,_>>()?;
        super::activation::walk(tx,t,|id,row|{
            for c in &columns {if row.field(c).is_err(){note_omission(tx,t,id,c)?;}}
            Ok(())
        })?;
    }
    mark_down_native(tx,next)
}
fn mark_down_native(tx:&Tx<'_>,next:&Schema)->Result<(),RuntimeError>{
    // A down declaration can be added after native rows already exist. The
    // marker establishes only that this release owns their current image; it
    // does not infer an earlier birth release. Ordinary forward receipts take
    // precedence when rollback later classifies the row.
    for fill in &next.downfills {
        let key=fill.down_key();
        let t=tx.num(&fill.table)?;let table=&next.tables[&fill.table];
        walk_images(tx,t,|id,row,_in_r|{
            let image=crate::schema::row_image(&row,table);
            let fingerprint=input_fingerprint(&image,fill.inputs.keys().map(String::as_str));
            tx.conn().execute("INSERT OR IGNORE INTO _backfill_absence VALUES(?1,?2,?3,?4)",params![t,id,format!("$native:{key}"),fingerprint])?;Ok(())
        })?;
    }
    Ok(())
}
pub(super) fn observe_write(tx:&Tx<'_>,t:i64,id:&str,table:&Table,row:&Value,old:Option<&Value>)->Result<(),RuntimeError>{
    if !present(tx)? {return Ok(());}
    // @ref LLP 3000.000.000.002#8-wave-21-release-evolution — writes under the owning declaration refresh its accepted input image.
    let image=crate::schema::row_image(row,table);
    let active:Vec<(String,String)>=tx.conn().prepare("SELECT definition,input_names FROM _backfill_active WHERE t=?1")?.query_map([t],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
    for (key,names) in active {
        let names:Vec<String>=decode(&names)?;
        let marker=format!("$native:{key}");
        if old.is_none() || !absence(tx,t,id,&marker)?.is_empty() {
            let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
            let inputs:BTreeMap<_,_>=names.iter().map(|c|Ok((c.clone(),physical_value(tx,t,id,row,c,&mut meter)?.or_else(||interpreted_absence(table,c)).unwrap_or(Value::Null)))).collect::<Result<_,RuntimeError>>()?;
            let fingerprint=crate::value::digest(&inputs);
            tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND definition=?3",params![t,id,marker])?;
            tx.conn().execute("INSERT INTO _backfill_absence VALUES(?1,?2,?3,?4)",params![t,id,marker,fingerprint])?;
        }
        if let Some(mut e)=evidence(tx,t,id,&key)?.filter(|e|e.active) {
            for c in &names {
                // Hidden historical arguments and overwritten inputs keep their
                // original meaning. Only currently authored cells can advance.
                if let Some(kind)=table.columns.get(c).filter(|_|old.is_none_or(|before|crate::schema::row_image(before,table).field(c).ok()!=image.field(c).ok())) {
                    let value=image.field(c).cloned().unwrap_or(Value::Null);
                    let changed=e.inputs.field(c).ok()!=Some(&value);
                    if let Value::Row(inputs)|Value::Map(inputs)=&mut e.inputs {inputs.insert(c.clone(),value.clone());}
                    if changed {e.absent.remove(c);}
                    let binding=input_ref(&key,c);
                    // A generic-id surface cannot erase an already-custodied
                    // parent class when this owning-release write retargets it.
                    let mut reference_kind=kind.clone();
                    if changed && !protected(kind) && matches!(value,Value::Id(_)) {
                        let parents:Vec<String>=tx.conn().prepare("SELECT DISTINCT cat.name FROM _dormant_refs r JOIN _catalog cat ON cat.num=r.parent_t WHERE r.t=?1 AND r.id=?2 AND r.column_name=?3")?.query_map(params![t,id,binding],|r|r.get(0))?.collect::<Result<_,_>>()?;
                        if parents.len()==1 {reference_kind=crate::schema::ColumnType::Ref{table:parents[0].clone()};}
                    }
                    capture_input_refs(tx,t,id,c,&binding,&reference_kind,&value,!changed)?;
                }
            }
            save(tx,t,id,&key,&e,true)?;
        }
    }
    let columns:Vec<String>=tx.conn().prepare("SELECT column_name FROM _backfill_inputs WHERE t=?1")?.query_map([t],|r|r.get(0))?.collect::<Result<_,_>>()?;
    if columns.is_empty(){return Ok(());}
    let interpreted_old=old.map(|r|crate::schema::row_image(r,table));
    let interpreted_new=crate::schema::row_image(row,table);
    for c in columns {
        let changed=interpreted_old.as_ref().is_none_or(|before|before.field(&c).ok()!=interpreted_new.field(&c).ok());
        if changed {tx.conn().execute("DELETE FROM _backfill_absence WHERE t=?1 AND id=?2 AND column_name=?3 AND definition NOT LIKE '$native:%' AND NOT EXISTS(SELECT 1 FROM _backfill_evidence original JOIN _backfill_evidence owner ON owner.t=original.t AND owner.id=original.id AND owner.epoch=original.epoch JOIN json_each(owner.after_image) output ON output.key=?3 WHERE original.t=_backfill_absence.t AND original.id=_backfill_absence.id AND original.definition=_backfill_absence.definition AND owner.active=1)",params![t,id,c])?;}
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
fn physical_value(tx:&Tx<'_>,t:i64,id:&str,row:&Value,column:&str,meter:&mut Meter)->Result<Option<Value>,RuntimeError>{
    if let Ok(value)=row.field(column){meter.heap(value.retained_heap_bytes().saturating_mul(64).saturating_add(8192))?;return Ok(Some(value.clone()));}
    if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_asset_column_renames')",[],|r|r.get::<_,bool>(0))? {
        let aliases:Vec<String>=tx.conn().prepare("SELECT name FROM _asset_column_renames WHERE t=?1 AND origin=(SELECT origin FROM _asset_column_renames WHERE t=?1 AND name=?2) ORDER BY name")?.query_map(params![t,column],|r|r.get(0))?.collect::<Result<_,_>>()?;
        for alias in aliases {if let Ok(value)=row.field(&alias){meter.heap(value.retained_heap_bytes().saturating_mul(64).saturating_add(8192))?;return Ok(Some(value.clone()));}}
    }
    let bytes:Option<i64>=tx.conn().query_row("SELECT octet_length(data) FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column],|r|r.get(0)).optional()?;
    meter.heap((bytes.unwrap_or(0).max(0) as u64).saturating_mul(64).saturating_add(8192))?;
    let text:Option<String>=tx.conn().query_row("SELECT data FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3",params![t,id,column],|r|r.get(0)).optional()?;
    text.map(|s|decode(&s)).transpose()
}
fn source_value(tx:&Tx<'_>,t:i64,id:&str,row:&Value,column:&str,table:Option<&Table>,meter:&mut Meter)->Result<Option<Value>,RuntimeError>{
    source_value_impl(tx,t,id,row,column,table,meter,true)
}
fn source_value_impl(tx:&Tx<'_>,t:i64,id:&str,row:&Value,column:&str,table:Option<&Table>,meter:&mut Meter,honor_absence:bool)->Result<Option<Value>,RuntimeError>{
    if let Ok(value)=row.field(column){meter.heap(value.retained_heap_bytes().saturating_mul(64).saturating_add(8192))?;return Ok(Some(value.clone()));}
    if honor_absence && tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM temp._backfill_unprovided WHERE t=?1 AND id=?2 AND column_name=?3)",params![t,id,column],|r|r.get::<_,bool>(0))? {return Ok(None);}
    if let Some(value)=physical_value(tx,t,id,row,column,meter)?{return Ok(Some(value));}
    Ok(table.and_then(|table|interpreted_absence(table,column)))
}

fn interpreted_absence(table:&Table,column:&str)->Option<Value>{
    if table.maintained.contains_key(column){Some(Value::Int(0))}
    else if table.columns.get(column).is_some_and(|kind|kind.is_optional()){Some(Value::Null)}
    else{table.defaults.get(column).and_then(|d|if let crate::schema::ColumnDefault::Literal(v)=d{Some(v.clone())}else{None})}
}
fn native_inputs<'a>(tx:&Tx<'_>,t:i64,id:&str,row:&Value,names:impl Iterator<Item=&'a str>,table:Option<&Table>)->Result<BTreeMap<String,Value>,RuntimeError>{
    let mut out=BTreeMap::new();let mut meter=Meter::new(Ceilings::job(),Cut::Abort);
    for c in names {out.insert(c.to_owned(),source_value(tx,t,id,row,c,table,&mut meter)?.unwrap_or(Value::Null));}Ok(out)
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
            let mut runner=Runner::new(tx,&source,migration_context(tx,now)?,Meter::new(Ceilings::job(),Cut::Abort),tx.next_seq()?);
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
                if let Some(archived)=archived {let mut image:Value=decode(&archived)?;if let Value::Row(fields)|Value::Map(fields)=&mut image {fields.insert(c.clone(),Value::Null);}tx.conn().execute("UPDATE _dormant_narrow_rows SET data=?1 WHERE t=?2 AND id=?3",params![canonical_json(&image),t,id])?;super::movement::rewrite_relation(tx,"_dormant_narrow_rows",t,id,&image)?;}
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

fn display_cell(value:Option<&Value>)->String {value.map(|v|crate::wire::to_json(v).to_string()).unwrap_or_else(||"<absent>".into())}
