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
// Use the binder's actual target index: positional/named keys complete birth
// values before defaults. Ambiguous expanded sources do not establish a default.
fn birth_act(write:&Write<'_>,name:&str,bound:&Bound)->bool{
    if write.op!=WriteOp::Upsert{return false;}
    let table=&bound.schema.tables[&write.table];let source=write.site.to_string();
    let targets=bound.programs.iter().flat_map(|p|snapback4_core::ir::read_sites(&p.program)).filter(|r|r.kind=="write target"&&r.table==write.table&&r.site==source).filter_map(|r|table.index(&r.index)).filter(|index|index.is_plain()).map(|index|index.columns()).collect::<BTreeSet<_>>();
    if targets.len()!=1{return false;}let columns=targets.first().unwrap();
    let keys=write.keys.iter().enumerate().filter_map(|(i,key)|key.column.as_ref().or_else(||columns.get(i)).map(|column|(column.as_str(),&key.value))).collect::<BTreeMap<_,_>>();
    table.columns.iter().any(|(column,kind)|{
        if metadata(column)||write.fields.iter().any(|field|field.name==*column){return false;}
        let named=column.to_lowercase().contains(name);let enum_=matches!(kind.required(),ColumnType::Enum{..});
        if let Some(value)=keys.get(column.as_str()){
            return !matches!(simplify_boolean(value),Expr::Literal{value:ast::Literal::Bool(false)|ast::Literal::Null,..})&&(named||enum_&&literal_act(value,name));
        }
        table.defaults.get(column).is_some_and(|default|{let value=default.value(challenges::NOW,"$audit");!matches!(value,snapback4_core::Value::Bool(false)|snapback4_core::Value::Null)&&(named||enum_&&matches!(value,snapback4_core::Value::String(value) if value.to_lowercase().contains(name)))})
    })
}
fn modeled(write:&Write<'_>,name:&str,parent:&str,bound:&Bound)->bool{
    if known_impossible(&write.context,write.catalog){return false;}

    let t=&bound.schema.tables[&write.table];
    if write.table==parent{
        if !matches!(write.op,WriteOp::Update|WriteOp::Upsert){return false;}
        let default_act=birth_act(write,name,bound);
        let changes=|field:&ast::ObjectField|!matches!(field_value(field),Some(Expr::Member{base,name,..}) if name==&field.name&&super::super::derived::same_resource(base,&write.table,&write.keys,write.p))&&(!matches!(t.columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))||super::lifecycle::state_field_changes(write,field,bound));
        return default_act||write.fields.iter().any(|field|changes(field)&&!metadata(&field.name)&&!matches!(field_value(field).map(simplify_boolean),Some(Expr::Literal{value:ast::Literal::Bool(false)|ast::Literal::Null,..}))&&(
            field.name.to_lowercase().contains(name)||
            matches!(t.columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&field_value(field).is_some_and(|value|literal_act(value,name))
        ));
    }
    if !matches!(write.op,WriteOp::Insert|WriteOp::Upsert)||!t.columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==parent)){return false;}
    // Typed/literal effects establish subjects; verb names neither admit nor
    // exclude an act. A consent or request row records a prerequisite.
    if metadata(&write.table){return false;}
    if write.table.to_lowercase().contains(name){return true;}
    write.fields.iter().any(|field|["name","part","item","kind"].contains(&field.name.as_str())&&field_value(field).is_some_and(|value|literal_act(value,name)||write.p.args.iter().any(|arg|matches!(arg.type_.kind,TypeKind::Text{..})&&uses(value,&arg.name))))

}
const CANCELLATIONS:&[(&[&str],&[&str])]=&[
    (&["cancel","cancellation","cancelation","cancelled","canceled"],&["cancel","cancelled","canceled"]),
    (&["abort","aborted"],&["abort","aborted"]),
    (&["withdraw","withdrawal","withdrawn"],&["withdraw","withdrawn"]),
    (&["reject","rejection","rejected"],&["reject","rejected"]),
    (&["decline","declined"],&["decline","declined"]),
    (&["deny","denial","denied"],&["deny","denied"]),
];
fn approval_words(name:&str)->Vec<String>{
    let chars=name.chars().collect::<Vec<_>>();let mut text=String::new();
    for (n,c) in chars.iter().enumerate(){
        if !c.is_alphanumeric(){text.push(' ');continue;}
        if n>0&&c.is_uppercase()&&(chars[n-1].is_lowercase()||chars[n-1].is_numeric()||chars[n-1].is_uppercase()&&chars.get(n+1).is_some_and(|c|c.is_lowercase())){text.push(' ');}
        text.extend(c.to_lowercase());
    }
    // Also retain approval boundaries in lower-case concatenated names.
    for marker in ["authorizations","authorization","authorized","approvals","approved","approval","approve","authorize"]{text=text.replace(marker," $ ");}
    text.split_whitespace().map(str::to_owned).collect()
}
fn cancellation_cues(name:&str,producer:&Write<'_>)->Vec<String>{
    let recognized=|word:&str|CANCELLATIONS.iter().any(|(words,_)|words.contains(&word));
    let words=approval_words(name);let mut cues=BTreeSet::new();
    for (n,word) in words.iter().enumerate(){if word=="$"{for neighbor in [n.checked_sub(1),n.checked_add(1)].into_iter().flatten().filter_map(|i|words.get(i)){if recognized(neighbor){cues.insert(neighbor.clone());}}}}
    let operation=&producer.p.name;
    for prefix in ["approve","authorize"]{
        if operation.get(..prefix.len()).is_some_and(|part|part.eq_ignore_ascii_case(prefix))&&let Some(word)=approval_words(&operation[prefix.len()..]).first()&&recognized(word){cues.insert(word.clone());}
    }
    cues.into_iter().collect()
}
fn cancellation_effect(cues:&[String],parent:&str,effect:&Write<'_>,bound:&Bound)->bool{
    effect.table==parent&&matches!(effect.op,WriteOp::Update|WriteOp::Upsert)&&effect.fields.iter().any(|field|matches!(bound.schema.tables[parent].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&matches!(field_value(field),Some(Expr::Literal{value:ast::Literal::Str(value),..}) if CANCELLATIONS.iter().any(|(words,states)|cues.iter().any(|cue|words.contains(&cue.as_str()))&&states.contains(&value.to_lowercase().as_str()))))
}
fn producer_cancellation(parent:&str,producer:&Write<'_>,effect:&Write<'_>,bound:&Bound)->bool{
    if !std::ptr::eq(producer.p,effect.p)||effect.table!=parent||effect.op!=WriteOp::Update{return false;}
    let stages=effect.fields.iter().filter(|field|matches!(bound.schema.tables[parent].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))).collect::<Vec<_>>();
    !stages.is_empty()&&stages.len()==effect.fields.len()&&stages.iter().all(|field|matches!(field_value(field),Some(Expr::Literal{value:ast::Literal::Str(value),..}) if ["cancel","cancelled","canceled","aborted","withdrawn","rejected","declined","denied"].contains(&value.to_lowercase().as_str())))
}
pub(super) fn scalar(name:&str,parent:&str,record:&Write<'_>,effect:&Write<'_>,writes:&[Write<'_>],bound:&Bound)->bool{
    let original=name.to_owned();let name=stem(name);
    let cues=cancellation_cues(&original,record);
    if !cues.is_empty(){return cancellation_effect(&cues,parent,effect,bound)||cues.iter().any(|cue|modeled(effect,cue,parent,bound));}
    if producer_cancellation(parent,record,effect,bound){return false;}
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
            (name.to_lowercase().contains(&stem(&original))||!writes.iter().any(|other|other.table==parent&&matches!(other.op,WriteOp::Update|WriteOp::Upsert)&&other.fields.iter().any(|field|field.name==*name))){
                found=true;
            });found
    })
}
pub(super) fn record(name:&str,parent:&str,creator:&Write<'_>,effect:&Write<'_>,bound:&Bound)->bool{
    // A typed read of this receipt on an operation that performs an effect
    // establishes a modeled approval contract independently of verb names.
    if !std::ptr::eq(creator.p,effect.p)&&bound.programs.iter().any(|p|p.program.name==effect.name&&snapback4_core::ir::read_sites(&p.program).iter().any(|read|read.table==creator.table)){return true;}
    // A Boolean that must already be set to request this receipt is an
    // antecedent, not the act that the receipt is supposed to authorize.
    if effect.table==parent&&!effect.fields.is_empty()&&effect.fields.iter().all(|field|
        matches!(bound.schema.tables[parent].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Bool))&&
        matches!(field_value(field),Some(Expr::Literal{value:ast::Literal::Bool(true),..}))&&conditions(&creator.context).iter().any(|condition|{
            super::lifecycle::positive_approval_field(condition,false,&|base,name|name==field.name&&super::approval_records::origin(base,creator.p,bound).is_some_and(|selected|super::approval_records::parent_values(creator,parent,bound).iter().any(|value|super::approval_records::origin(value,creator.p,bound)==Some(selected.clone()))))
        })){return false;}
    // If approval performs a concrete literal effect itself, another writer of
    // that same subject/effect models the act independently of its verb.
    if !std::ptr::eq(creator.p,effect.p)&&effect.table==parent&&authority_walk::writes(creator.catalog,creator.p).iter().any(|(write,_)|{
        let Expr::Write{table,fields,..}=write else{return false;};table==parent&&fields.iter().any(|approved|!metadata(&approved.name)&&effect.fields.iter().any(|field|field.name==approved.name&&matches!(field_value(field),Some(Expr::Literal{..}))&&field_value(field).map(crate::print::expression)==field_value(approved).map(crate::print::expression)))
    }){return true;}
    let original=name.to_owned();let mut name=stem(name);
    let cues=cancellation_cues(&original,creator);
    if !cues.is_empty(){return cancellation_effect(&cues,parent,effect,bound)||cues.iter().any(|cue|modeled(effect,cue,parent,bound));}
    // A generic receipt table does not broaden a specifically named decision
    // (approveDiscount, for example) to every stage of its parent workflow.
    if generic(&name,parent){
        let operation=creator.p.name.to_lowercase();
        if let Some(act)=operation.strip_prefix("approve").or_else(||operation.strip_prefix("authorize")){
            let act=act.trim_start_matches('_');if !act.is_empty(){name=act.into();}
        }
    }
    if producer_cancellation(parent,creator,effect,bound){return false;}
    if generic(&name,parent){return state(effect,bound)||effect.table!=parent&&matches!(effect.op,WriteOp::Insert|WriteOp::Upsert);}
    modeled(effect,&name,parent,bound)
}
pub(super) fn informational(out:&mut Vec<Diagnostic>,site:&Site,subject:&str){
    note(out,site,"N_APPROVAL_INFORMATIONAL",format!("{subject}: informational record; no operation models the approved act, so there is no inferred pending-effect gate"),
        "acknowledge the external decision with check --ack-security ID --reason 'informational record: <spec rationale>'; if this application adds the governed act, require the matching approval there");
}
