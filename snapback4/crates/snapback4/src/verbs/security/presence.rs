//! Review each newly loosened column before advancing the successful baseline.
// @ref LLP 3000.036.004.000#6-concrete-intent-and-loosening — release comparison is independent of local generated state.
use super::*;
type Baseline=BTreeMap<String,BTreeMap<String,bool>>;
fn baseline(bound:&Bound)->Baseline{bound.schema.visible_tables().map(|(n,t)|(n.clone(),t.columns.iter().map(|(c,k)|(c.clone(),k.is_optional())).collect())).collect()}
fn path(project:&Project)->std::path::PathBuf{project.schema_dir().join("generated/security-presence-baseline.json")}
pub(super) fn notes(project:&Project,bound:&Bound,prior:Option<&Bound>,sources:&[(String,String)])->Result<Vec<snapback4_lang::Diagnostic>,String>{
    let old=if let Some(prior)=prior{baseline(prior)}else{match std::fs::read(path(project)){
        Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|e|format!("invalid security presence baseline: {e}"))?,
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Vec::new()),
        Err(e)=>return Err(format!("cannot read security presence baseline: {e}")),
    }};
    let mut out=Vec::new();
    for (table,columns) in baseline(bound){for (column,optional) in columns {
        if !optional||old.get(&table).and_then(|c|c.get(&column))!=Some(&false){continue;}
        let intentional=bound.invariants.iter().filter(|i|i.table==table&&matches!(i.target.as_str(),"always"|"insert"|"write")).any(|i|{
            if snapback4_lang::security::derived::is_derived(i){return false;}
            fn presence(e:&snapback4_lang::ast::Expr,column:&str)->bool{
                use snapback4_lang::ast::{Expr,Literal};
                match e {
                    Expr::Binary{op,left,right,..} if op=="="||op=="!="=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(a,Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..})&&name==column)&&matches!(b,Expr::Literal{value:Literal::Null,..})),
                    Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>presence(left,column)||presence(right,column),
                    Expr::Unary{op,value,..} if op=="not"=>presence(value,column),_=>false,
                }
            }
            i.syntax.as_ref().is_some_and(|e|presence(e,&column))
        });
        if intentional{continue;}
        let site=sources.iter().find_map(|(f,s)|{let (doc,_)=snapback4_lang::parse_document(f,s);doc.tables.into_iter().find(|t|t.name==table).and_then(|t|t.columns.into_iter().find(|c|c.name==column)).map(|c|c.site)}).unwrap_or_default();
        out.push(snapback4_lang::Diagnostic::new(&site,"N_PRESENCE_LOOSENING",format!("{table}.{column}: required column became nullable; confirm the specification's presence intent before accepting the loosening"),format!("declare the spec's presence line; for deliberately optional values use `invariant {table} always .{column} = null or .{column} != null`, or acknowledge this column with check --ack-security ID --reason '<spec rationale>'")).guide("security"));
    }}Ok(out)
}
pub(in crate::verbs) fn remember(project:&Project,bound:&Bound)->Result<(),String>{
    let path=path(project);std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
    let temporary=path.with_extension(format!("{}.tmp",std::process::id()));
    let result=std::fs::write(&temporary,serde_json::to_vec(&baseline(bound)).unwrap()).and_then(|_|std::fs::rename(&temporary,&path));
    if result.is_err(){let _=std::fs::remove_file(&temporary);}result.map_err(|e|e.to_string())
}

#[cfg(test)]mod tests{
    use super::*;
    struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
    #[test]fn only_authored_presence_answers_advance_the_first_check_gate(){
        let dir=std::env::temp_dir().join(format!("sb4-sec9-presence-{}",std::process::id()));let _scratch=Scratch(dir.clone());
        std::fs::create_dir_all(dir.join("snapback")).unwrap();let project=Project{root:dir};
        let required="table rows:\n  value: text\n  read <- allow\n  online only\n";
        let optional=required.replace("value: text","value: text ?");
        let compile=|source:&str|{std::fs::write(project.schema_dir().join("schema.q"),source).unwrap();let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b};
        let old=compile(required);let current=compile(&optional);
        assert!(notes(&project,&current,None,&project.sources().unwrap()).unwrap().is_empty());
        remember(&project,&old).unwrap();
        let pending=notes(&project,&current,None,&project.sources().unwrap()).unwrap();
        assert_eq!(pending.len(),1);assert!(pending[0].message.contains("became nullable"));
        assert_eq!(notes(&project,&current,None,&project.sources().unwrap()).unwrap().len(),1,"failed checks do not advance the baseline");
        let permission=compile(&format!("{optional}\ninvariant rows.value write only viewer = 'service:desk'\n"));
        assert_eq!(notes(&project,&permission,None,&project.sources().unwrap()).unwrap().len(),1,"write permission does not answer presence");
        let deliberate=compile(&format!("{optional}\ninvariant rows always .value = null or .value != null\n"));
        assert!(notes(&project,&deliberate,None,&project.sources().unwrap()).unwrap().is_empty());
        std::fs::remove_file(path(&project)).unwrap();
        assert_eq!(notes(&project,&current,Some(&old),&project.sources().unwrap()).unwrap().len(),1,"release comparison survives deleted local state");
    }
}
