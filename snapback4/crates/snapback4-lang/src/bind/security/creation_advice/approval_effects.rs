//! Approval questions require an act the application actually models.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — external act records are informational.
use super::*;
use super::lifecycle::state;
fn stem(name:&str)->String{
    let name=name.to_lowercase();
    ["approv","authoriz"].iter().filter_map(|part|name.find(part)).min().map(|at|name[..at].trim_end_matches('_').to_owned()).unwrap_or(name)
}
fn generic(name:&str,parent:&str)->bool{
    name.len()<=2||parent.to_lowercase().trim_end_matches('s')==name.trim_end_matches('s')||
    ["final","first","second","primary","work","stage","step","decision"].contains(&name)
}
fn metadata(name:&str)->bool{
    let name=name.to_lowercase();
    ["approv","authoriz","request","reason","consent","note","cost","permission"].iter().any(|part|name.contains(part))
}
fn literal_act(value:&Expr,name:&str)->bool{
    let mut found=false;walk(value,|e|if let Expr::Literal{value:ast::Literal::Str(value),..}=e{found|=value.to_lowercase().contains(name);});found
}
fn modeled(write:&Write<'_>,name:&str,parent:&str,bound:&Bound)->bool{
    if known_impossible(&write.context,write.catalog){return false;}
    let operation=write.p.name.to_lowercase();
    if ["approv","authoriz","request","record","review","ask"].iter().any(|prefix|operation.starts_with(prefix)){return false;}
    let t=&bound.schema.tables[&write.table];
    if write.table==parent{
        if !matches!(write.op,WriteOp::Update|WriteOp::Upsert){return false;}
        return write.fields.iter().any(|field|!metadata(&field.name)&&(
            field.name.to_lowercase().contains(name)||
            matches!(t.columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&field_value(field).is_some_and(|value|literal_act(value,name))
        ))||operation.contains(name)&&["perform","execute","install","replace","refund","move","take","remove"].iter().any(|prefix|operation.starts_with(prefix));
    }
    if !matches!(write.op,WriteOp::Insert|WriteOp::Upsert)||!t.columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==parent)){return false;}
    // Pure media attachments are evidence about an act, not its performance.
    if t.columns.values().any(ColumnType::contains_asset)&&!operation.starts_with("install")&&!operation.starts_with("replace")&&!write.table.to_lowercase().contains(name)&&!operation.contains(name){return false;}
    if write.table.to_lowercase().contains(name)||operation.contains(name){return true;}
    // An open named installation models every installable item in this parent.
    operation.starts_with("install")&&write.fields.iter().any(|field|
        matches!(field.name.as_str(),"name"|"part"|"item"|"kind")&&
        field_value(field).is_some_and(|value|write.p.args.iter().any(|arg|
            matches!(arg.type_.kind,TypeKind::Text{..})&&uses(value,&arg.name))))
}
pub(super) fn scalar(name:&str,parent:&str,record:&Write<'_>,effect:&Write<'_>,writes:&[Write<'_>],bound:&Bound)->bool{
    let name=stem(name);
    if generic(&name,parent){return state(effect,bound)||matches!(effect.op,WriteOp::Insert|WriteOp::Upsert)&&effect.table!=parent;}
    if modeled(effect,&name,parent,bound){return true;}
    if !std::ptr::eq(effect.p,record.p)&&state(effect,bound)&&writes.iter().any(|other|std::ptr::eq(other.p,record.p)&&other.table==parent&&other.site!=record.site&&state(other,bound)&&
        other.keys.len()==record.keys.len()&&other.keys.iter().zip(&record.keys).all(|(a,b)|a.column==b.column&&crate::print::expression(&a.value)==crate::print::expression(&b.value))){return true;}

    // A feature fixed at birth can qualify the entity's whole workflow.
    // Request/decision flags changed by another operation are separate records.
    state(effect,bound)&&conditions(&record.context).into_iter().any(|condition|{
        let mut found=false;walk(condition,|e|if let Expr::Member{base,name,..}=e&&
            bound.schema.tables[parent].columns.get(name).is_some_and(|kind|matches!(kind.required(),ColumnType::Bool))&&
            !metadata(name)&&super::super::derived::same_resource(base,parent,&record.keys,record.p)&&
            !writes.iter().any(|other|other.table==parent&&matches!(other.op,WriteOp::Update|WriteOp::Upsert)&&other.fields.iter().any(|field|field.name==*name)){
                found=true;
            });found
    })
}
pub(super) fn record(name:&str,parent:&str,effect:&Write<'_>,bound:&Bound)->bool{
    let name=stem(name);
    if generic(&name,parent){return state(effect,bound)||effect.table!=parent&&matches!(effect.op,WriteOp::Insert|WriteOp::Upsert);}
    modeled(effect,&name,parent,bound)
}
pub(super) fn informational(out:&mut Vec<Diagnostic>,site:&Site,subject:&str){
    note(out,site,"N_APPROVAL_INFORMATIONAL",format!("{subject}: informational record; no operation models the approved act, so there is no inferred pending-effect gate"),
        "acknowledge the external decision with check --ack-security ID --reason 'informational record: <spec rationale>'; if this application adds the governed act, require the matching approval there");
}
