//! Table names may change; numeric row, reference and receipt lifetimes do not.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — renames are identity moves, never row copies or merges.
use super::*;
use std::collections::BTreeMap;
// @ref LLP 3000.000.000.003#2-frozen-result-fields — old cold CLIs cannot select registered result-anchor views without populating them.
pub(super) const VERSION:&str="snapback4-release-store-11";
fn refuse(s:impl Into<String>)->RuntimeError {RuntimeError::Structural{code:"E_ADOPT",message:s.into()}}

// Only structural table identifiers change. Literal values, column names,
// operation names and authored defaults are never table identifiers.
fn identifiers(value:&mut serde_json::Value,map:&BTreeMap<String,String>) {
    match value {
        serde_json::Value::Array(xs)=>for x in xs {identifiers(x,map)},
        serde_json::Value::Object(fields)=>for (key,x) in fields {
            if key=="Literal" || key=="defaults" {continue;}
            if matches!(key.as_str(),"table"|"parent") {if let Some(name)=x.as_str().and_then(|s|map.get(s)){*x=serde_json::Value::String(name.clone());continue;}}
            identifiers(x,map);
        },_=>()
    }
}
fn mapped(name:&str,map:&BTreeMap<String,String>)->String {map.get(name).cloned().unwrap_or_else(||name.into())}
fn remap<T:serde::Serialize+serde::de::DeserializeOwned>(value:&T,map:&BTreeMap<String,String>)->Result<T,RuntimeError> {
    let mut json=serde_json::to_value(value).map_err(|e|RuntimeError::Store(e.to_string()))?;identifiers(&mut json,map);
    serde_json::from_value(json).map_err(|e|RuntimeError::Store(e.to_string()))
}
pub(crate) fn schema(mut schema:Schema,map:&BTreeMap<String,String>)->Result<Schema,RuntimeError> {
    if map.is_empty(){return Ok(schema)}
    schema.tables=std::mem::take(&mut schema.tables).into_iter().map(|(name,table)|Ok((mapped(&name,map),remap(&table,map)?))).collect::<Result<_,RuntimeError>>()?;
    for m in &mut schema.maintains {*m=remap(m,map)?;m.source=mapped(&m.source,map);m.target=mapped(&m.target,map);}
    for f in &mut schema.backfills {fill(f,map,false)?;}
    for f in &mut schema.downfills {fill(f,map,true)?;}
    for e in &mut schema.extractions {e.child=mapped(&e.child,map);}
    // Remaining table-bearing structural metadata is normalized through the
    // same typed codec; maintains' source/target are handled explicitly above.
    // These maps contain column identifiers, including arbitrary keys such as
    // "parent". Normalize their typed table slots, never their column strings.
    let mut extractions=std::mem::take(&mut schema.extractions);
    for e in &mut extractions {e.parent=mapped(&e.parent,map);}
    let columns=std::mem::take(&mut schema.asset_renames).into_iter().map(|(name,columns)|(mapped(&name,map),columns)).collect();
    schema.table_renames.clear();schema=remap(&schema,map)?;
    schema.extractions=extractions;schema.asset_renames=columns;
    Ok(schema)
}
fn fill(f:&mut crate::schema::backfill::Backfill,map:&BTreeMap<String,String>,down:bool)->Result<(),RuntimeError> {
    *f=remap(f,map)?;
    f.program.name=format!("{}{}{}",if down{"down"}else{"backfill"},f.table,f.name);Ok(())
}
pub(super) fn prepare(conn:&Connection,next:&Schema,catalog:&mut BTreeMap<String,i64>)->Result<BTreeMap<String,String>,RuntimeError> {
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_table_renames')",[],|r|r.get(0))?;
    if !exists && next.table_renames.is_empty(){return Ok(BTreeMap::new())}
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _table_renames(name TEXT PRIMARY KEY,origin TEXT NOT NULL) WITHOUT ROWID;")?;
    let mut names:BTreeMap<String,String>=conn.prepare("SELECT name,origin FROM _table_renames")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
    for (new,old) in &next.table_renames {
        if new==old || !next.tables.contains_key(new) || next.tables.contains_key(old){return Err(refuse("table rename requires a distinct predecessor-only source"))}
        let origin=names.get(old).cloned().unwrap_or_else(||old.clone());
        if names.get(new).is_some_and(|root|root!=&origin){return Err(refuse(format!("table rename {old} → {new} conflicts with an independent retained identity")))}
        if let (Some(a),Some(b))=(catalog.get(old),catalog.get(new)) {if a!=b{return Err(refuse(format!("table rename {old} → {new} cannot merge existing table lifetimes")))}}
        for name in [old,new] {names.insert(name.clone(),origin.clone());conn.execute("INSERT OR IGNORE INTO _table_renames VALUES(?1,?2)",params![name,origin])?;}
    }
    let mut selected=BTreeMap::<String,String>::new();
    for name in next.tables.keys() {if let Some(root)=names.get(name) {if let Some(other)=selected.insert(root.clone(),name.clone()){return Err(refuse(format!("table aliases {other} and {name} cannot be active together")))}}}
    let map:BTreeMap<String,String>=names.iter().filter_map(|(name,root)|selected.get(root).filter(|new|*new!=name).map(|new|(name.clone(),new.clone()))).collect();
    for (old,new) in &map {
        if !catalog.contains_key(old){continue;}
        if catalog.contains_key(new){return Err(refuse(format!("table rename {old} → {new} conflicts with retained table storage")))}
        let entries:Vec<_>=catalog.iter().filter(|(key,_)|*key==old || key.starts_with(&format!("{old}."))).map(|(k,v)|(k.clone(),*v)).collect();
        for (key,num) in entries {let renamed=format!("{new}{}",&key[old.len()..]);conn.execute("UPDATE _catalog SET name=?1 WHERE name=?2",params![renamed,key])?;catalog.remove(&key);catalog.insert(renamed,num);}
        conn.execute("UPDATE _assets SET home_table=?1 WHERE home_table=?2",params![new,old])?;
        for table in ["_dormant_tables","_dormant_columns","_dormant_indexes"] {
            if conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[table],|r|r.get::<_,bool>(0))? {conn.execute(&format!("UPDATE {table} SET table_name=?1 WHERE table_name=?2"),params![new,old])?;}
        }
    }
    // Retained typed definitions must use the current public table names too.
    for table in ["_dormant_tables","_dormant_columns","_dormant_narrow_rows"] {
        if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[table],|r|r.get::<_,bool>(0))? {continue;}
        let rows:Vec<(String,String)>=conn.prepare(&format!("SELECT definition,definition FROM {table} GROUP BY definition"))?.query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        for (old,text) in rows {let mut json:serde_json::Value=serde_json::from_str(&text).map_err(|e|RuntimeError::Store(e.to_string()))?;identifiers(&mut json,&map);let new=canonical_json(&json);if old!=new {conn.execute(&format!("UPDATE {table} SET definition=?1 WHERE definition=?2"),params![new,old])?;}}
    }
    history(conn,&map)?;
    conn.execute("UPDATE _meta SET value=?1 WHERE key='version'",[VERSION])?;
    Ok(map)
}
fn history(conn:&Connection,map:&BTreeMap<String,String>)->Result<(),RuntimeError> {
    for (table,down) in [("_backfill_definitions",false),("_downfill_definitions",true)] {
        if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[table],|r|r.get::<_,bool>(0))? {continue;}
        let rows:Vec<(String,String)>=conn.prepare(&format!("SELECT digest,definition FROM {table}"))?.query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        for (old,text) in rows {let mut f:crate::schema::backfill::Backfill=serde_json::from_str(&text).map_err(|e|RuntimeError::Store(e.to_string()))?;fill(&mut f,map,down)?;let new=if down {f.down_key()}else{f.key()};if old==new{continue;}
            conn.execute(&format!("INSERT OR IGNORE INTO {table} VALUES(?1,?2)"),params![new,canonical_json(&f)])?;
            for ledger in ["_backfill_evidence","_backfill_pruned","_backfill_absence"] {conn.execute(&format!("UPDATE {ledger} SET definition=?1 WHERE definition=?2"),params![new,old])?;}
            conn.execute("UPDATE _backfill_absence SET definition=?1 WHERE definition=?2",params![format!("$native:{new}"),format!("$native:{old}")])?;
            conn.execute("UPDATE _backfill_absence SET definition=?1 WHERE definition=?2",params![format!("$authored:{new}"),format!("$authored:{old}")])?;
            for c in f.inputs.keys() {conn.execute("UPDATE _dormant_refs SET column_name=?1 WHERE column_name=?2",params![format!("$backfill:{new}:{c}"),format!("$backfill:{old}:{c}")])?;}
            conn.execute(&format!("DELETE FROM {table} WHERE digest=?1"),[old])?;
        }
    }Ok(())
}
