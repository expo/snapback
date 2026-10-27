//! Valid text search inputs; ordinary row/argument validation still decides admission.
// @ref LLP 3000.036.004.002#s1-formatted-text — samples satisfy the declared format and bounds together.
use super::*;
use snapback4_core::schema::{Table, TextFormat};

pub(super) fn text(min:u32,max:u32,format:Option<TextFormat>,variant:usize)->Option<Value>{
    if min==0&&max==0&&matches!(format,None|Some(TextFormat::Handle)){return Some(Value::String(String::new()));}
    let shortest=match format{Some(TextFormat::Url)=>8,Some(TextFormat::Email)=>3,_=>1};
    let length=min.max(shortest).max((variant.to_string().len()+shortest as usize) as u32).min(max) as usize;
    if length<min as usize||length<shortest as usize{return None;}
    let tag=|length:usize| {let mut value="x".repeat(length);let suffix=variant.to_string();let count=suffix.len().min(length);value.replace_range(length-count..,&suffix[suffix.len()-count..]);value};
    let value=match format{
        Some(TextFormat::Url)=>format!("http://{}",tag(length-7)),
        Some(TextFormat::Email)=>{
            if length>254{return None;}
            let local_length=length.saturating_sub(190).clamp(1,64);
            let domain_length=length-local_length-1;
            let labels=(domain_length+1).div_ceil(64);
            let mut letters=domain_length-(labels-1);
            let mut domain=Vec::new();
            for remaining in (0..labels).rev(){let count=(letters-remaining).min(63);domain.push("x".repeat(count));letters-=count;}
            let mut mailbox=format!("{}@{}","x".repeat(local_length),domain.join(".")).into_bytes();
            let mut digits=variant.to_string().into_bytes().into_iter().rev();
            for byte in mailbox.iter_mut().rev(){if !matches!(*byte,b'@'|b'.'){if let Some(digit)=digits.next(){*byte=digit;}else{break;}}}
            String::from_utf8(mailbox).ok()?
        },
        _=>tag(length),
    };
    if !format.is_none_or(|f|f.matches(&value)){return None;}
    Some(Value::String(value))
}
// Keep argument proposals distinct from seeded column proposals. Otherwise a
// valid sample can collide with every existing unique text key before replay.
pub(super) fn argument(min:u32,max:u32,format:Option<TextFormat>,variant:usize)->Option<Value>{
    if matches!(format,None|Some(TextFormat::Handle)){
        if min>max{return None;}
        return Some(Value::String(if variant%2==0{"z"}else{"y"}.repeat(min.max(1).min(max) as usize)));
    }
    let Value::String(value)=text(min,max,format,variant)?else{return None;};
    let letter=if variant%2==0{'z'}else{'y'};
    Some(Value::String(value.chars().map(|c|if c.is_ascii_digit(){letter}else{c}).collect()))
}
pub(super) fn column(table:&Table,name:&str,variant:usize)->Option<Value>{column_sample(table,name,variant,false)}
pub(super) fn present_column(table:&Table,name:&str,variant:usize)->Option<Value>{column_sample(table,name,variant,true)}
fn column_sample(table:&Table,name:&str,variant:usize,present:bool)->Option<Value>{
    let kind=table.columns.get(name)?;
    fn propose(kind:&C,variant:usize,present:bool)->Option<Value>{match kind{
        C::Optional(inner) if present=>propose(inner,variant,present),
        C::ListRange{of,min,..}=>Some(Value::Array((0..*min).map(|_|propose(of,variant,present)).collect::<Option<Vec<_>>>()?)),
        _=>sample(kind,variant),
    }}
    let value=propose(kind,variant,present)?;
    let (min,format)=table.constraints.iter().find_map(|c|if let Constraint::Text{field,min,format}=c&&field==name{Some((*min,*format))}else{None}).unwrap_or((0,None));
    fn replace(kind:&C,value:Value,min:u32,format:Option<TextFormat>,variant:usize)->Option<Value>{
        match (kind,value){
            (_,Value::Null)=>Some(Value::Null),
            (C::Optional(inner),value)=>replace(inner,value,min,format,variant),
            (C::Text{max},_)=>text(min,*max,format,variant),
            (C::List{of,..}|C::ListRange{of,..},Value::Array(values))=>values.into_iter().map(|v|replace(of,v,min,format,variant)).collect::<Option<Vec<_>>>().map(Value::Array),
            (_,value)=>Some(value),
        }
    }
    replace(kind,value,min,format,variant)
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn every_declared_format_obeys_both_bounds_including_email_limits(){
  for format in [None,Some(TextFormat::Handle),Some(TextFormat::Url),Some(TextFormat::Email)]{
   for min in 0..=255{for max in [0,1,3,7,8,63,64,65,66,128,130,254,500]{
    for variant in [0,1,63]{if let Some(Value::String(value))=text(min,max,format,variant){
     assert!(value.len()<=max as usize);assert!(snapback4_core::engine::validate::validate_text("sample",&value,min,format).is_ok(),"{format:?} {min}..{max}: {value}");
    }}
   }}
  }
  assert!(text(255,500,Some(TextFormat::Email),0).is_none());
  assert!(text(0,7,Some(TextFormat::Url),0).is_none());
 }
 #[test]fn generated_variants_preserve_unique_keys_and_boolean_alternatives(){
  for kind in ["text 1..80","text 1..80 format handle","text 8..80 format url","text 3..3 format email","text 66..66 format email","text 130..130 format email"]{
   let sources=vec![("schema.q".into(),format!("table docs:\n  value: {kind}\n  optional: bool ?\n  unique value\n  read <- allow\n  insert <- allow\n  online only\n"))];
   let bound=crate::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
   let t=&bound.schema.tables["docs"];let mut seen=BTreeSet::new();let mut bools=BTreeSet::new();
   for n in 0..8{let v=present_column(t,"value",4+n).unwrap();assert!(seen.insert(serde_json::to_string(&v).unwrap()),"{kind}: {n}");bools.insert(present_column(t,"optional",4+n).unwrap()==Value::Bool(true));}
   assert_eq!(bools.len(),2,"{kind}");
  }
 }
 #[test]fn generated_population_and_actual_creator_accept_formatted_columns_and_arguments(){
  let source="use identity password\ntable docs:\n  link: text 8..80 format url\n  mail: text 3..80 format email\n  handle: text 1..20 format handle\n  read <- allow\n  insert <- allow\n  online only\nmutation create(link: text 8..80 format url, mail: text 3..80 format email, handle: text 1..20 format handle):\n  return insert docs { link, mail, handle }\n";
  let bound=crate::compile(&[("schema.q".into(),source.into())]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
  let mut campaign=Campaign::work_bounded(3072);let engine=generated::fixture(&bound,&mut campaign).unwrap();
  let rows=readback(&engine).unwrap();assert!(!rows["docs"].is_empty(),"{:?}",campaign.unsupported);
  for row in &rows["docs"]{snapback4_core::engine::validate::validate_row(&bound.schema,"docs",row).unwrap();}
 }
 #[test]fn generated_lists_obey_leaf_formats_and_long_minima(){
  for kind in ["[text 8..80 format url] 1..2","[text 66..66 format email] 1..2","[[text 130..130 format email] 1..2] 1..2","[text 30..80 format handle] 1..2","[text 8..80 format url] 1..2 ?"]{
   let source=format!("table docs:\n  values: {kind}\n  read <- allow\n  insert <- allow\n  online only\n");
   let bound=crate::compile(&[("schema.q".into(),source)]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
   let mut campaign=Campaign::work_bounded(3072);let engine=generated::fixture(&bound,&mut campaign).unwrap();
   let rows=readback(&engine).unwrap();assert!(!rows["docs"].is_empty(),"{kind}: {:?}",campaign.unsupported);
   for row in &rows["docs"]{snapback4_core::engine::validate::validate_row(&bound.schema,"docs",row).unwrap();}
   if kind.ends_with('?'){assert!(rows["docs"].iter().any(|r|r.field("values").ok()==Some(&Value::Null)));assert!(rows["docs"].iter().any(|r|matches!(r.field("values"),Ok(Value::Array(values)) if !values.is_empty())));}
  }
 }

 #[test]fn a_valid_formatted_argument_can_create_beside_an_existing_unique_column_sample(){
  for kind in ["text 1..80","text 8..80 format url","text 66..66 format email","text 1..80 format handle"]{
   let sources=vec![("schema.q".into(),format!("table docs:\n  value: {kind}\n  unique value\n  read <- allow\n  insert <- allow\n  online only\nmutation create(value: {kind}):\n  return insert docs {{ value }}\n"))];
   let bound=crate::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
   let initial=Value::Row(BTreeMap::from([("id".into(),Value::Id("seed-doc".into())),("value".into(),column(&bound.schema.tables["docs"],"value",0).unwrap())]).into());
   let mut engine=engine_with(&bound,&BTreeMap::from([("docs".into(),vec![initial])]),Vec::new()).unwrap();
   let args=arguments(&bound.programs[0].program.args,0).unwrap();
   let result=engine.mutate("create",None,Context::new(VIEWER,args).at(NOW)).unwrap();
   assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}),"{kind}: {result:?}");
  }
 }

}
