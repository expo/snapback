//! Receipt-owned child identity for guarded historical result projections.
// @ref LLP 3000.000.000.003#2-frozen-result-fields — an ordinary protected/indexed scalar carries identity, never a second asset home.
use super::*;
pub(super) fn populate(tx:&Tx<'_>,schema:&Schema,report:&mut super::super::adoption_report::AdoptionReport)->Result<(),RuntimeError>{
    if !exists(tx)?{return Ok(());}
    for e in schema.extractions.iter().filter(|e|!e.each){
        let child=&schema.tables[&e.child];let column=e.result_column();
        if !e.has_result_anchor(child){continue;}
        let pt=tx.num(&e.parent)?;let ct=tx.num(&e.child)?;let definition=key(tx,e)?;
        let mut query=tx.conn().prepare("SELECT parent_id,child_id FROM _extraction_rows WHERE definition=?1 AND parent_t=?2 AND child_t=?3 ORDER BY parent_id")?;
        let anchors=query.query_map(params![definition,pt,ct],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?;
        let mut count=0;
        for anchor in anchors {
            let(parent_id,child_id)=anchor?;
            let Some(mut row)=load(tx,ct,&child_id)?else{continue;};
            if row.field(&e.reference).ok()!=Some(&Value::Id(parent_id.clone()))||load(tx,pt,&parent_id)?.is_none(){continue;}
            let valid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3 AND parent_t=?4 AND parent_id=?5 AND invalid=0)",params![ct,child_id,format!("$extract:{definition}"),pt,parent_id],|r|r.get(0))?;
            if !valid{return Err(refuse(format!("extraction result {} parent {parent_id}, child {child_id} has invalid receipt lifetime; preserve the child and repair under an authorized bridge",e.child)));}
            if row.field(&column).ok()==Some(&Value::Id(parent_id.clone())){continue;}
            if let Value::Row(fields)=&mut row{fields.insert(column.clone(),Value::Id(parent_id));}else{return Err(refuse("extraction result anchor needs a row"));}
            write(tx,ct,&child_id,&row)?;count+=1;
        }
        if count>0{report.backfills.push(format!("{}: retained {count} receipt-owned child identities for frozen results",e.child));tx.set_meta("activation_population","true")?;}
    }
    Ok(())
}
