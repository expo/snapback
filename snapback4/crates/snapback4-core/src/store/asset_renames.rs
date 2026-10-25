//! Asset/reference renames transport cells, homes and lifetime evidence.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — asset identity is preserved; no upload, re-claim or generated placeholder.
use super::*;
use std::collections::BTreeMap;
type Maps=BTreeMap<String,BTreeMap<String,String>>;
fn refusal(message:impl Into<String>)->RuntimeError {RuntimeError::Structural{code:"E_ADOPT",message:message.into()}}
fn replace_keys<T>(fields:BTreeMap<String,T>,map:&BTreeMap<String,String>)->BTreeMap<String,T> {fields.into_iter().map(|(name,value)|(map.get(&name).cloned().unwrap_or(name),value)).collect()}
pub(super) fn table(table:&mut Table,map:&BTreeMap<String,String>){
    table.columns=replace_keys(std::mem::take(&mut table.columns),map);
    table.defaults=replace_keys(std::mem::take(&mut table.defaults),map);
    table.column_reads=replace_keys(std::mem::take(&mut table.column_reads),map);
    table.column_writes=replace_keys(std::mem::take(&mut table.column_writes),map);
    table.frozen_columns=replace_keys(std::mem::take(&mut table.frozen_columns),map);
    table.on_delete=replace_keys(std::mem::take(&mut table.on_delete),map);
    table.written_by=replace_keys(std::mem::take(&mut table.written_by),map);
    fn term(t:&mut crate::schema::RuleTerm,map:&BTreeMap<String,String>){use crate::schema::RuleTerm::*;if let Field(c)|OldField(c)|NextField(c)|Reference{column:c,..}|ReferenceChain{column:c,..}=t {if let Some(new)=map.get(c){*c=new.clone();}}}
    fn rule(r:&mut crate::schema::RuleExpr,map:&BTreeMap<String,String>){use crate::schema::RuleExpr::*;match r {Eq(a,b)|Ne(a,b)|Compare(_,a,b)=>{term(a,map);term(b,map)},And(xs)|Or(xs)=>for x in xs{rule(x,map)},Not(r)=>rule(r,map),Exists{key,equalities,..}|Created{key,equalities,..}=>{for t in key{term(t,map)}for(_,t)in equalities{term(t,map)}},_=>()}}
    for r in [&mut table.rules.read,&mut table.rules.insert,&mut table.rules.update,&mut table.rules.delete]{rule(r,map)}
    for r in table.column_reads.values_mut().chain(table.column_writes.values_mut()).chain(table.frozen_columns.values_mut()){rule(r,map)}
    for index in table.indexes.values_mut(){for component in &mut index.components {if let crate::schema::IndexComponent::Column(c)=component {if let Some(new)=map.get(c){*c=new.clone();}}}}
    if let Some(sync)=&mut table.sync {
        for audience in std::iter::once(&mut sync.audience).chain(sync.also.iter_mut().map(|a|&mut a.audience)) {
            match audience {crate::schema::Audience::Column(c)=>{if let Some(new)=map.get(c){*c=new.clone();}},crate::schema::Audience::Target{prefix,..}=>for c in prefix {if let Some(new)=map.get(c){*c=new.clone();}},_=>()}
        }
    }
    for c in &mut table.constraints {match c{
        crate::schema::Constraint::Immutable{fields}|crate::schema::Constraint::Cap{by:fields,..}=>for f in fields{if let Some(new)=map.get(f){*f=new.clone();}},
        crate::schema::Constraint::FinalExistsOnInsert{key,..}=>for t in key{term(t,map)},
        _=>(),
    }}
}
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — comparison uses the same typed identity codec as activation.
impl Schema {
    /// Compare schema authority using declared physical column identities.
    pub fn with_column_names(&self,maps:&BTreeMap<String,BTreeMap<String,String>>)->Self{schema(self.clone(),maps)}
}
pub(super) fn schema(mut schema:Schema,maps:&Maps)->Schema {
    for(name,map)in maps {if let Some(t)=schema.tables.get_mut(name){table(t,map);}}
    for e in &mut schema.extractions {
        if let Some(map)=maps.get(&e.child){e.reference=map.get(&e.reference).cloned().unwrap_or_else(||e.reference.clone());e.fields=std::mem::take(&mut e.fields).into_iter().map(|(dest,source)|(map.get(&dest).cloned().unwrap_or(dest),source)).collect();}
        if let Some(map)=maps.get(&e.parent){for source in e.fields.values_mut(){if let Some(new)=map.get(source){*source=new.clone();}}}
    }schema
}
pub(super) fn prepare(conn:&Connection,next:&Schema,catalog:&BTreeMap<String,i64>,renamed_tables:&BTreeMap<String,String>)->Result<Maps,RuntimeError>{
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_asset_column_renames')",[],|r|r.get(0))?;
    if !exists && next.asset_renames.is_empty(){return Ok(Maps::new())}
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _asset_column_renames(t INTEGER NOT NULL,name TEXT NOT NULL,origin TEXT NOT NULL,PRIMARY KEY(t,name)) WITHOUT ROWID;")?;
    let mut maps=Maps::new();
    for (name,current) in &next.tables {
        let Some(t)=catalog.get(name) else {continue};
        let mut aliases:BTreeMap<String,String>=conn.prepare("SELECT name,origin FROM _asset_column_renames WHERE t=?1")?.query_map([t],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        for (new,old) in next.asset_renames.get(name).into_iter().flatten() {
            if old==new || current.columns.contains_key(old) || !current.columns.get(new).is_some_and(asset){return Err(refusal(format!("asset rename {name}.{old} → {new} requires one predecessor-only source and one asset destination")))}
            let root=aliases.get(old).cloned().unwrap_or_else(||old.clone());
            if aliases.get(new).is_some_and(|r|r!=&root){return Err(refusal("asset rename cannot merge independent column lifetimes"))}
            for c in [old,new] {aliases.insert(c.clone(),root.clone());conn.execute("INSERT OR IGNORE INTO _asset_column_renames VALUES(?1,?2,?3)",params![t,c,root])?;}
        }
        let mut selected=BTreeMap::new();for c in current.columns.keys(){if let Some(root)=aliases.get(c){if selected.insert(root.clone(),c.clone()).is_some(){return Err(refusal("two names for the same asset column cannot be active together"))}}}
        let map:BTreeMap<_,_>=aliases.into_iter().filter_map(|(old,root)|selected.get(&root).filter(|new|**new!=old).map(|new|(old,new.clone()))).collect();
        for(old,new)in &map {
            let prior:Option<String>=conn.query_row("SELECT schema FROM _generations WHERE generation=(SELECT value FROM _meta WHERE key='generation')",[],|r|r.get(0)).optional()?;
            if let Some(prior)=prior {
                let prior:Schema=serde_json::from_str(&prior).map_err(|e|refusal(e.to_string()))?;
                let prior=prior.with_table_names(renamed_tables)?;
                if let Some(before)=prior.table(name).filter(|t|t.columns.contains_key(old)){
                    let source=&before.columns[old];let destination=&current.columns[new];
                    if reference(source)||reference(destination){
                        if source!=destination||before.through.as_ref().is_some_and(|t|t.reference==*old)||current.through.as_ref().is_some_and(|t|t.reference==*new){return Err(refusal("reference rename requires identical nominal type and uncaptured ownership in both directions"))}
                    }
                }
            }
            for rows in ["r","_dormant_rows","_dormant_narrow_rows"] {
                if !exists_table(conn,rows)?{continue;}
                let a=format!("$.Row.{}",serde_json::to_string(old).unwrap());let b=format!("$.Row.{}",serde_json::to_string(new).unwrap());
                let conflict:bool=conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {rows} WHERE t=?1 AND json_type(data,?2) IS NOT NULL AND json_type(data,?3) IS NOT NULL AND json_extract(data,?2)!=json_extract(data,?3))"),params![t,a,b],|r|r.get(0))?;
                if conflict{return Err(refusal(format!("asset rename {name}.{old} → {new} has a conflicting physical destination")))}
                conn.execute(&format!("UPDATE {rows} SET data=json_remove(json_set(data,?3,json_extract(data,?2)),?2) WHERE t=?1 AND json_type(data,?2) IS NOT NULL"),params![t,a,b])?;
            }
            conn.execute("UPDATE _assets SET home_column=?3 WHERE home_table=?1 AND home_column=?2",params![name,old,new])?;
            if exists_table(conn,"_dormant_refs")? {conn.execute("UPDATE _dormant_refs SET column_name=?3 WHERE t=?1 AND column_name=?2",params![t,old,new])?;}
            if exists_table(conn,"_dormant_values")? {conn.execute("UPDATE _dormant_values SET column_name=?3 WHERE t=?1 AND column_name=?2",params![t,old,new])?;}
            if exists_table(conn,"_dormant_columns")? {conn.execute("UPDATE _dormant_columns SET column_name=?3 WHERE table_name=?1 AND column_name=?2",params![name,old,new])?;}
        }
        if !map.is_empty(){
            for rows in ["_dormant_narrow_rows","_dormant_tables"] {
                if !exists_table(conn,rows)?{continue;}
                let condition=if rows=="_dormant_tables"{"table_name=?1"}else{"t=?1"};
                let value=if rows=="_dormant_tables"{rusqlite::types::Value::Text(name.clone())}else{rusqlite::types::Value::Integer(*t)};
                let definitions:Vec<String>=conn.prepare(&format!("SELECT DISTINCT definition FROM {rows} WHERE {condition}"))?.query_map([&value],|r|r.get(0))?.collect::<Result<_,_>>()?;
                for text in definitions {let mut definition:Table=serde_json::from_str(&text).map_err(|e|RuntimeError::Store(e.to_string()))?;table(&mut definition,&map);conn.execute(&format!("UPDATE {rows} SET definition=?2 WHERE {condition} AND definition=?3"),params![value,canonical_json(&definition),text])?;}
            }
            maps.insert(name.clone(),map);
        }
    }
    conn.execute("UPDATE _meta SET value=?1 WHERE key='version'",[super::table_renames::VERSION])?;
    Ok(maps)
}
fn exists_table(conn:&Connection,name:&str)->Result<bool,RuntimeError>{Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[name],|r|r.get(0))?)}
fn asset(kind:&crate::schema::ColumnType)->bool {use crate::schema::ColumnType::*;match kind{Optional(k)|List{of:k,..}|ListRange{of:k,..}=>asset(k),File{..}|Image{..}|Video{..}|Ref{..}=>true,_=>false}}

fn reference(kind:&crate::schema::ColumnType)->bool{use crate::schema::ColumnType::*;match kind{Optional(k)|List{of:k,..}|ListRange{of:k,..}=>reference(k),Ref{..}=>true,_=>false}}
