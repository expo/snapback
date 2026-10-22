//! Changed-column guards are advisory and bind the exact row, field and new value.
// @ref LLP 3000.036.004#169-day-two-precision-and-destructive-evidence-questions — no table-wide promotion of a column condition.
use super::*;
#[derive(Clone)]
pub(super) struct Change{old:Expr,new:Expr,pub requirements:Vec<Stmt>}
fn read(e:&Expr)->Option<&ast::ReadExpr>{match e{Expr::Read(r)=>Some(r),Expr::Assert{value,..}=>read(value),_=>None}}
impl Change{
    pub fn matches(&self,write:&Expr,column:&str,p:&ProgramDecl)->bool{
        let Expr::Write{op:ast::WriteOp::Update,table,keys,fields,..}=write else{return false;};
        let Expr::Member{base,name,..}=&self.old else{return false;};let Some(old)=read(base)else{return false;};
        fn stable(e:&Expr,p:&ProgramDecl)->bool{match e{Expr::Literal{..}=>true,Expr::Name{name,..}=>name=="viewer"||p.args.iter().any(|a|a.name==*name),Expr::Assert{value,..}=>stable(value,p),_=>false}}
        old.keys.iter().all(|k|stable(&k.value,p))&&keys.iter().all(|k|stable(&k.value,p))&&name==column&&old.table==*table&&old.keys.len()==keys.len()&&old.keys.iter().zip(keys).all(|(a,b)|a.column==b.column&&crate::print::expression(&a.value)==crate::print::expression(&b.value))&&fields.iter().any(|f|f.name==column&&f.value.as_ref().is_some_and(|v|crate::print::expression(v)==crate::print::expression(&self.new)))
    }
}
// Unknown calls and writes end the pending interval; pure leading helper
// requirements can be recovered only inside the immediately tested branch.
pub(super) fn expression_effectful(e:&Expr)->bool{
    let mut e=e.clone();let mut unknown=false;super::super::super::intent_walk::expression(&mut e,&mut |e|if matches!(e,Expr::Write{..}|Expr::Call{..}){unknown=true;});unknown
}
pub(super) fn prior_effects(e:&Expr)->bool{
    let mut e=e.clone();let(mut calls,mut writes)=(false,0);
    super::super::super::intent_walk::expression(&mut e,&mut |e|match e{Expr::Write{..}=>writes+=1,Expr::Call{..}=>calls=true,_=>{}});
    calls||writes>1
}
pub(super) fn effectful(s:&Stmt)->bool{match s{
    Stmt::Expr{value,..}|Stmt::Bind{value,..}|Stmt::Return{value,..}|Stmt::Require{condition:value,..}=>expression_effectful(value),
    Stmt::If{condition,then_body,else_body,..}=>expression_effectful(condition)||then_body.iter().chain(else_body).any(effectful),
    Stmt::For{..}|Stmt::As{..}|Stmt::Emit{..}=>true,_=>false,
}}

fn prefix(_catalog:&Catalog,body:&[Stmt],env:&Env)->Vec<Stmt>{
    let mut env=env.clone();let mut out=Vec::new();
    for s in body{match s{
        Stmt::Require{condition,code,message,site}=>out.push(Stmt::Require{condition:resolve(condition,&env),code:code.clone(),message:message.clone(),site:site.clone()}),
        Stmt::Bind{names,value,..}=>{if effectful(s){break;}if names.len()==1{env.insert(names[0].clone(),resolve(value,&env));}},
        _=>break,
    }}out
}
pub(super) fn after(catalog:&Catalog,condition:&Expr,then_body:&[Stmt],else_body:&[Stmt],env:&Env)->Vec<Change>{
    if expression_effectful(condition){return Vec::new();}
    let Expr::Binary{op,left,right,..}=condition else{return Vec::new();};
    let body=match op.as_str(){"!="=>then_body,"="=>else_body,_=>return Vec::new()};
    if body.iter().any(|s|matches!(s,Stmt::Return{..})||effectful(s)){return Vec::new();}
    let requirements=prefix(catalog,body,env);if requirements.is_empty(){return Vec::new();}
    [(left,right),(right,left)].into_iter().filter(|(old,_)|matches!(old.as_ref(),Expr::Member{..})).map(|(old,new)|Change{old:*old.clone(),new:*new.clone(),requirements:requirements.clone()}).collect()
}
