//! Stable semantic review bindings. Complex flow notes conservatively bind
//! their declaration dependency/writer closure, never the whole source set.
// @ref LLP 3000.036.004#173-presentation-and-review-identity — review survives independent edits.
use super::*;
use std::collections::BTreeSet;
use snapback4_lang::lexer::{lex,Kind};
#[derive(Clone)]
struct Declaration{file:String,line:u32,end:u32,name:String,kind:String,tokens:Vec<(String,String)>}
fn declarations(sources:&[(String,String)])->Vec<Declaration>{
    let mut out=Vec::new();
    for (file,text) in sources{
        let (tokens,_)=lex(file,text);
        let starts=tokens.iter().enumerate().filter(|(_,t)|t.site.col==1&&t.kind==Kind::Word).map(|(i,_)|i).collect::<Vec<_>>();
        for (n,start) in starts.iter().enumerate(){
            let end=starts.get(n+1).copied().unwrap_or(tokens.len());let ts=&tokens[*start..end];
            let Some(name)=ts.get(1).filter(|t|t.kind==Kind::Word)else{continue;};
            out.push(Declaration{file:file.clone(),line:ts[0].site.line,end:tokens.get(end).map_or(u32::MAX,|t|t.site.line),name:name.value.clone(),kind:ts[0].value.clone(),tokens:ts.iter().filter(|t|!matches!(t.kind,Kind::Newline|Kind::Eof)).map(|t|(format!("{:?}",t.kind),t.value.clone())).collect()});
        }
    }
    out
}
fn words(text:&str)->BTreeSet<&str>{text.split(|c:char|!c.is_alphanumeric()&&c!='_').filter(|s|!s.is_empty()).collect()}
fn stable_message(text:&str)->String{
    // Source sites in detector prose are evidence, not review identity.
    text.split_inclusive(char::is_whitespace).map(|chunk|{
        let word=chunk.trim_end_matches(char::is_whitespace);
        let suffix=&chunk[word.len()..];
        let parts=word.split(':').collect::<Vec<_>>();
        let normalized=if parts.len()>=3&&parts[parts.len()-2].parse::<u32>().is_ok()&&parts.last().unwrap().trim_end_matches([',',';',')']).parse::<u32>().is_ok(){parts[..parts.len()-2].join(":")}else{word.into()};
        format!("{normalized}{suffix}")
    }).collect()

}
fn strip_sites(value:&mut serde_json::Value){match value{
    serde_json::Value::Object(fields)=>{
        let metadata=fields.get("site").is_some_and(|site|site.is_string()||site.as_object().is_some_and(|site|site.len()==3&&site.contains_key("file")&&site.contains_key("line")&&site.contains_key("col")));
        if metadata{fields.remove("site");}
        for value in fields.values_mut(){strip_sites(value);}
    },
    serde_json::Value::Array(values)=>for value in values{strip_sites(value)},_=>{}
}}
pub(super) fn identities(notes:&[snapback4_lang::Diagnostic],sources:&[(String,String)])->Vec<(String,String,String)>{
    let decls=declarations(sources);
    let bound=snapback4_lang::compile(sources);
    let mut occurrences=BTreeMap::<String,usize>::new();
    notes.iter().map(|note|{
        let owner=decls.iter().find(|d|d.file==note.site.file&&d.line<=note.site.line&&note.site.line<d.end);
        let subject=owner.map(|d|format!("{}:{}:{}",d.file,d.kind,d.name)).unwrap_or_else(||note.site.file.clone());
        let base=hash(&serde_json::to_vec(&(ANALYZER,&note.code,&subject,stable_message(&note.message),stable_message(&note.rewrite))).unwrap());
        let ordinal=occurrences.entry(base.clone()).or_default();let key=hash(&serde_json::to_vec(&(&base,*ordinal)).unwrap());*ordinal+=1;
        let mentioned=words(&note.message);
        let mut selected=decls.iter().enumerate().filter(|(_,d)|mentioned.contains(d.name.as_str())||owner.is_some_and(|o|std::ptr::eq(o,*d))).map(|(i,_)|i).collect::<BTreeSet<_>>();
        // Optional-column advice is exactly about that declaration's type and
        // rule; unrelated columns in the same table are not dependencies.
        let column=note.message.split_whitespace().next().and_then(|s|s.split_once('.')).filter(|(_,c)|!c.contains(':'));
        let precise=if note.code=="N_OPTIONAL_EVIDENCE"{column.and_then(|(table,column)|{
            sources.iter().find_map(|(file,text)|{
                let (doc,_)=snapback4_lang::parse_document(file,text);
                let c=doc.tables.iter().find(|t|t.name==table)?.columns.iter().find(|c|c.name==column)?;
                let (tokens,_)=lex(file,text);let tokens=tokens.iter().filter(|t|t.site.line==c.site.line&&!matches!(t.kind,Kind::Newline|Kind::Eof)).map(|t|(format!("{:?}",t.kind),t.value.clone())).collect::<Vec<_>>();
                Some(serde_json::to_vec(&(file,table,column,tokens)).unwrap())
            })
        })}else{None};
        let rule_binding=if matches!(note.code.as_str(),"N_INVARIANT_RESTATES_RULE"|"N_ROLE_WIDE_READ"|"N_BROAD_READ"){
            let label=note.message.split_whitespace().next().unwrap_or("").trim_end_matches(':');
            label.split_once('.').and_then(|(table,part)|{
                let t=bound.schema.tables.get(table)?;
                let column=t.columns.contains_key(part).then_some(part);
                let effect=if column.is_some(){note.message.split_whitespace().nth(1).unwrap_or("read").trim_end_matches(':')}else{part};
                let mut columns=column.into_iter().collect::<BTreeSet<_>>();
                if note.code=="N_ROLE_WIDE_READ"&&let Some(group)=note.message.split("protected columns [").nth(1).and_then(|s|s.split(']').next()){
                    columns.extend(group.split(',').map(str::trim).filter(|c|t.columns.contains_key(*c)));
                }
                let column_bindings=columns.iter().map(|c|(*c,serde_json::json!({"type":t.columns.get(*c),"read":t.column_reads.get(*c),"owner":t.written_by.get(*c)}))).collect::<BTreeMap<_,_>>();
                let mut value=serde_json::json!({"rowRead":t.rules.read,"columns":column_bindings,"effect":effect,
                    "invariants":bound.invariants.iter().filter(|i|i.table==table&&(i.column.is_none()&&column.is_none()||i.column.as_deref().is_some_and(|c|columns.contains(c)))&&(i.target==effect||i.target=="write")).collect::<Vec<_>>()});
                if effect!="read"{value["writeRules"]=serde_json::to_value(&t.rules).unwrap();value["owners"]=serde_json::to_value(&t.written_by).unwrap();}
                strip_sites(&mut value);
                let encoded=value.to_string();
                let mut dependencies=bound.schema.tables.keys().filter(|name|name.as_str()!=table&&encoded.contains(&format!("\"{name}\""))).cloned().collect::<BTreeSet<_>>();
                loop{let old=dependencies.clone();for name in &old{let serialized=serde_json::to_string(&bound.schema.tables[name]).unwrap();for candidate in bound.schema.tables.keys(){if candidate.as_str()!=table&&serialized.contains(&format!("\"{candidate}\"")){dependencies.insert(candidate.clone());}}}if dependencies==old{break;}}
                value["dependencies"]=serde_json::to_value(dependencies.iter().map(|name|(name,&bound.schema.tables[name])).collect::<BTreeMap<_,_>>()).unwrap();
                let mut writers=serde_json::to_value(bound.programs.iter().filter(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(table,_)|dependencies.contains(table))).map(|p|&p.program).collect::<Vec<_>>()).unwrap();strip_sites(&mut writers);value["dependencyWriters"]=writers;
                Some(serde_json::to_vec(&value).unwrap())
            })
        }else{None};
        let scope=if precise.is_some(){"exact column declaration"}else if rule_binding.is_some(){"effective rule/column and authority dependency closure"}else if selected.is_empty(){"whole-source fallback: unlocated/unknown subject"}else{"source declaration and dependency/writer closure (conservative)"};
        let fingerprint=if let Some(bytes)=precise.or(rule_binding){hash(&bytes)}else{
            // Forward names include helper bodies and referenced schemas.
            // Reverse writers include newly added mutators of a trusted grant.
            loop{
                let before=selected.clone();
                let names=selected.iter().map(|i|decls[*i].name.as_str()).collect::<BTreeSet<_>>();
                let dependencies=selected.iter().flat_map(|i|decls[*i].tokens.iter().filter(|(k,_)|k=="Word").map(|(_,v)|v.as_str())).collect::<BTreeSet<_>>();
                for (i,d) in decls.iter().enumerate(){
                    let module=std::path::Path::new(&d.file).file_stem().and_then(|s|s.to_str()).unwrap_or("");
                    let operation=if module=="schema"{d.name.clone()}else{format!("{module}.{}",d.name)};
                    let writer=matches!(d.kind.as_str(),"mutation"|"job")&&bound.programs.iter().find(|p|p.program.name==operation).is_some_and(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(table,_)|names.contains(table.as_str())));
                    let intent=d.kind=="invariant"&&names.contains(d.name.as_str());
                    if dependencies.contains(d.name.as_str())||writer||intent{selected.insert(i);}
                }
                if selected==before{break;}
            }
            if selected.is_empty(){
                // Unknown source ownership is not an empty authority binding.
                hash(&serde_json::to_vec(sources).unwrap())
            }else{
                let mut binding=selected.iter().map(|i|{let d=&decls[*i];(&d.file,&d.kind,&d.name,&d.tokens)}).collect::<Vec<_>>();binding.sort();
                hash(&serde_json::to_vec(&binding).unwrap())
            }
        };
        (key,fingerprint,scope.into())
    }).collect()
}

#[cfg(test)]mod tests{
use super::*;
use std::collections::BTreeSet;
fn note(line:u32,code:&str,message:&str)->snapback4_lang::Diagnostic{snapback4_lang::Diagnostic::new(&snapback4_lang::Site::new("schema.q",line,3),code,message,"review")}
fn ids(source:&str,notes:&[snapback4_lang::Diagnostic])->Vec<(String,String,String)>{identities(notes,&[("schema.q".into(),source.into())])}
const SOURCE:&str="table docs:\n  photo: image <=10000 ?\n  title: text <=100\n  read <- allow\n  insert <- allow\n  online only\nmutation add(photo:image <=10000 ?):\n  return insert docs {photo,title:'x'}\nquery unrelated():\n  return true\n";
#[test]fn independent_edits_and_comments_preserve_column_decisions(){
 let n=note(2,"N_OPTIONAL_EVIDENCE","docs.photo permits omitted or empty media evidence");let a=ids(SOURCE,&[n.clone()]);
 let changed=SOURCE.replace("title: text <=100","title: text <=200").replace("return true","return false");assert_eq!(a,ids(&changed,&[n.clone()]));
 let shifted=format!("-- a comment\n\n{SOURCE}");assert_eq!(a,ids(&shifted,&[note(4,&n.code,&n.message)]));
 let changed=SOURCE.replace("photo: image <=10000 ?","photo: image <=20000 ?");assert_ne!(a[0].1,ids(&changed,&[n])[0].1);
}
#[test]fn flow_decisions_bind_helpers_and_new_writers_but_not_independent_queries(){
 let n=note(8,"N_OPTIONAL_UPLOAD_CREATE","add: optional photo creates docs.photo");let a=ids(SOURCE,&[n.clone()]);
 assert_eq!(a,ids(&SOURCE.replace("return true","return false"),&[n.clone()]));
 let changed=format!("{SOURCE}mutation clear(doc:docs):\n  update docs[doc] {{photo:null}}\n");assert_ne!(a[0].1,ids(&changed,&[n.clone()])[0].1);
 let changed=SOURCE.replace("title:'x'","title:'y'");assert_ne!(a[0].1,ids(&changed,&[n])[0].1);
}
#[test]fn repeated_writes_keep_individual_ids_across_line_shifts(){
 let mut a=note(8,"N_OPTIONAL_UPLOAD_CREATE","add: optional photo creates docs.photo");let mut b=a.clone();b.site.line=9;
 let original=ids(SOURCE,&[a.clone(),b.clone()]);assert_ne!(original[0].0,original[1].0);
 a.site.line+=2;b.site.line+=2;assert_eq!(original,ids(&format!("-- comment\n\n{SOURCE}"),&[a,b]));
}
#[test]fn helpers_that_write_a_trusted_table_are_reverse_dependencies(){
 let s=SOURCE.to_owned()+"fn patch(doc:docs,title:text <=100):\n  update docs[doc] {title}\n  return null\nmutation edit(doc:docs):\n  return patch(doc,'a')\n";
 let n=note(8,"N_OPTIONAL_UPLOAD_CREATE","add: optional photo creates docs.photo");
 assert_ne!(ids(&s,&[n.clone()])[0].1,ids(&s.replace("patch(doc,'a')","patch(doc,'b')"),&[n])[0].1);
}
#[test]fn grouped_column_questions_bind_the_nonfirst_column(){
 let s="table docs:\n  a:text <=100\n  b:text <=100\n  read <- allow\n  online only\n";
 let n=note(2,"N_ROLE_WIDE_READ","docs.a read: protected columns [a, b] admit staff for every state");
 assert_ne!(ids(s,&[n.clone()])[0].1,ids(&s.replace("b:text <=100","b:text <=200"),&[n])[0].1);
}

#[test]fn review_identity_preserves_whitespace_inside_literal_values(){
 let a=note(8,"N_OPTIONAL_UPLOAD_CREATE","add: role = 'two  words'");let b=note(8,"N_OPTIONAL_UPLOAD_CREATE","add: role = 'two words'");assert_ne!(ids(SOURCE,&[a])[0].0,ids(SOURCE,&[b])[0].0);
}

#[test]fn an_application_column_named_site_is_not_source_metadata(){
 let s="table docs:\n  a:text <=100\n  site:text <=100\n  read <- allow\n  online only\n";
 let n=note(2,"N_ROLE_WIDE_READ","docs.a read: protected columns [a, site] admit staff for every state");assert_ne!(ids(s,&[n.clone()])[0].1,ids(&s.replace("site:text <=100","site:text <=200"),&[n])[0].1);
}

}
