//! Row authority and dormant cell provenance are separate facts.
// @ref LLP 3000.014.000#implementation-proof-clarifications — validate the immediate manual policy before using older live evidence.
use super::*;
use crate::schema::through::{PARENT_DEADLINE, DEADLINE};

pub(super) fn mode(tx:&Tx<'_>,t:i64,id:&str)->Result<Option<u8>,RuntimeError> {
    if !live_activation::active(tx)? {return Ok(None);}
    Ok(tx.conn().query_row("SELECT CASE kind WHEN 'source-manual' THEN 0 WHEN 'source-captured' THEN 1 ELSE 2 END FROM temp._live_restored WHERE kind IN ('source-manual','source-captured','source-live') AND t=?1 AND col='' AND id=?2",params![t,id],|r|r.get(0)).optional()?)
}
pub(super) fn record(tx:&Tx<'_>,t:i64,id:&str,old:&Table)->Result<(),RuntimeError> {
    if !live_activation::active(tx)? {return Ok(());}
    let kind=match &old.through {None=>"source-manual",Some(e) if e.live.is_some()=>"source-live",Some(_)=>"source-captured"};
    tx.conn().execute("INSERT OR IGNORE INTO temp._live_restored VALUES(?1,?2,'',?3)",params![kind,t,id])?;
    if let Some(edge)=old.through.as_ref().filter(|e|e.live.is_none()) {
        for col in edge.fields.keys().map(String::as_str).chain([PARENT_DEADLINE,DEADLINE]) {
            tx.conn().execute("INSERT OR IGNORE INTO temp._live_restored VALUES('source-capture',?1,?2,?3)",params![t,col,id])?;
        }
    }
    Ok(())
}
fn live_cell(tx:&Tx<'_>,t:i64,id:&str,col:&str)->Result<bool,RuntimeError> {
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3 AND live_source=1)",params![t,id,col],|r|r.get(0))?)
}
/// Captured-only restoration preserves its old audience. A manual row with
/// live-origin inputs must prove its *current* audience before recapture.
pub(super) fn validate(tx:&Tx<'_>,next:&Schema,sources:&BTreeMap<String,Table>,name:&str,old:&Table,row:&Value,now:i64,narrowed:bool)->Result<(),RuntimeError> {
    if !live_activation::active(tx)? || old.through.is_some() {return Ok(());}
    let Some(edge)=next.table(name).and_then(|t|t.through.as_ref()) else {return Ok(())};
    let t=tx.num(name)?;let id=row.field("id")?.as_str()?;
    let mut live=false;
    for col in edge.fields.keys().map(String::as_str).chain([PARENT_DEADLINE,DEADLINE]) {live |= live_cell(tx,t,id,col)?;}
    let history:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id=?2 AND column_name=?3 AND live_source=0)",params![t,id,PARENT_DEADLINE],|r|r.get(0))?;
    if live || edge.live.is_some() || narrowed && !history {
        crate::engine::through_activation::forward_authority(tx,next,sources,name,old,row,now,true)?;
        tx.conn().execute("INSERT OR IGNORE INTO temp._live_restored VALUES('live-authority',?1,'',?2)",params![t,id])?;
    }
    Ok(())
}
/// Never let unused live cells replace a captured row's own audience/deadline.
/// Missing live-origin inputs remain absent until the capture barrier fills
/// just those new inputs from the current parent.
pub(super) fn overlay(tx:&Tx<'_>,t:i64,id:&str,old:Option<&Table>,table:&Table,row:&mut Value,values:Vec<(String,String)>)->Result<(),RuntimeError> {
    let captured=old.and_then(|t|t.through.as_ref()).filter(|e|e.live.is_none());
    for (col,data) in values {
        if !table.columns.contains_key(&col) {continue;}
        let protected=captured.is_some_and(|e|e.fields.contains_key(&col) || matches!(col.as_str(),PARENT_DEADLINE|DEADLINE));
        if protected {continue;}
        let stale=captured.is_some() && live_activation::active(tx)? && live_cell(tx,t,id,&col)?;
        if let Value::Row(fields)|Value::Map(fields)=row {
            if stale {fields.remove(&col);} else {fields.insert(col,serde_json::from_str(&data).map_err(|e|RuntimeError::Store(e.to_string()))?);}
        }
    }
    Ok(())
}
pub(super) fn live_input(table:&Table,column:&str)->bool {
    table.through.as_ref().is_some_and(|e|e.live.is_some() && (e.fields.contains_key(column) || matches!(column,PARENT_DEADLINE|DEADLINE)))
}
/// Current policy inputs are refreshable; the immutable parent lifetime and
/// authored references remain bound even when old policy targets disappear.
pub(super) fn obsolete_ref(tx:&Tx<'_>,t:i64,id:&str,column:&str,table:&Table,old:Option<&Table>)->Result<bool,RuntimeError> {
    let Some(edge)=&table.through else {return Ok(false)};
    if column==PARENT_DEADLINE || !(edge.fields.contains_key(column) || column==DEADLINE) {return Ok(false);}
    let protected=if mode(tx,t,id)?.is_some() {
        tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM temp._live_restored WHERE kind='source-capture' AND t=?1 AND id=?2 AND col=?3)",params![t,id,column],|r|r.get::<_,bool>(0))?
    } else {old.and_then(|t|t.through.as_ref()).is_some_and(|e|e.live.is_none() && (e.fields.contains_key(column) || column==DEADLINE))};
    if protected {return Ok(false);}
    Ok(edge.live.is_some() || live_activation::active(tx)? && live_cell(tx,t,id,column)?)
}

/// Reserve declared parent scratch only for callbacks that can fetch it.
/// Captured-only restoration keeps its existing actual-image admission.
pub(super) fn forward_fetch(tx:&Tx<'_>,t:i64,old:Option<&Table>,table:&Table)->Result<bool,RuntimeError> {
    if !live_activation::active(tx)? || old.is_none_or(|t|t.through.is_some()) {return Ok(false);}
    let Some(edge)=&table.through else {return Ok(false)};
    if edge.live.is_some() {return Ok(true);}
    for col in edge.fields.keys().map(String::as_str).chain([PARENT_DEADLINE,DEADLINE]) {
        if tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND column_name=?2 AND live_source=1)",params![t,col],|r|r.get::<_,bool>(0))? {return Ok(true);}
    }Ok(false)
}
pub(super) fn live_row(tx:&Tx<'_>,t:i64,id:&str,old:&Table,table:&Table)->Result<bool,RuntimeError> {
    if !live_activation::active(tx)? {return Ok(false);}
    if old.through.as_ref().is_some_and(|e|e.live.is_some()) || table.through.as_ref().is_some_and(|e|e.live.is_some()) {return Ok(true);}
    for col in table.columns.keys() {if live_cell(tx,t,id,col)? {return Ok(true);}}
    Ok(false)
}
