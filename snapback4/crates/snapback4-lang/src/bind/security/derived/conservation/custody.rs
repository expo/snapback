//! Invocation-specific analysis helpers preserve actual lexical evaluation.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — helper body sites alone cannot identify a captured result.
use super::*;
use ast::{FunctionBody,FunctionDecl,Stmt};
fn mark(expression:&mut Expr,tag:&str){
 let site=match expression{
  Expr::Read(read)=>&mut read.site,Expr::Merge(merge)=>&mut merge.site,
  Expr::Name{site,..}|Expr::Literal{site,..}|Expr::Focal{site,..}|Expr::Array{site,..}|Expr::Object{site,..}|Expr::Unary{site,..}|Expr::Binary{site,..}|Expr::If{site,..}|Expr::Assert{site,..}|Expr::Member{site,..}|Expr::Exists{site,..}|Expr::Created{site,..}|Expr::Call{site,..}|Expr::Write{site,..}|Expr::ShapeUse{site,..}|Expr::Shape{site,..}|Expr::Walk{site,..}=>site,
 };site.file=format!("$conservation/invocation/{tag}/{}",site.file);
}
struct Specializer<'a>{original:&'a BTreeMap<String,FunctionDecl>,generated:BTreeMap<String,FunctionDecl>,stack:Vec<String>,failed:bool}
impl Specializer<'_>{
 fn invocation(&mut self,name:&str,site:&Site)->String{
  use sha2::{Digest,Sha256};
  let tag=format!("{:x}",Sha256::digest(format!("{name}/{site}")));
  let unique=format!("__conservation_invocation_{tag}");
  if self.generated.contains_key(&unique){return unique;}
  if self.stack.len()>=32||self.generated.len()>=256||self.stack.iter().any(|item|item==name){self.failed=true;return name.into();}
  let mut function=self.original[name].clone();function.name=unique.clone();
  self.stack.push(name.into());
  match &mut function.body{
   FunctionBody::Expression(value)=>{
    super::super::super::super::intent_walk::expression(value,&mut |e|mark(e,&tag));
    self.expression(value);
   },
   FunctionBody::Block(body)=>{
    super::super::super::super::intent_walk::statements(body,&mut |e|mark(e,&tag));
    self.statements(body);
   }
  }
  self.stack.pop();self.generated.insert(unique.clone(),function);unique
 }
 fn expression(&mut self,value:&mut Expr){
  super::super::super::super::intent_walk::expression(value,&mut |e|if let Expr::Call{name,site,..}=e&&self.original.contains_key(name){*name=self.invocation(name,site);});
 }
 fn statements(&mut self,body:&mut [Stmt]){
  super::super::super::super::intent_walk::statements(body,&mut |e|if let Expr::Call{name,site,..}=e&&self.original.contains_key(name){*name=self.invocation(name,site);});
 }
}
pub(super) fn catalog(source:&Catalog)->Option<Catalog>{
 let mut catalog=Catalog::build(source.documents.clone(),&mut Vec::new());
 let mut specializer=Specializer{original:&source.functions,generated:BTreeMap::new(),stack:Vec::new(),failed:false};
 for p in catalog.documents.iter_mut().flat_map(|doc|&mut doc.programs).filter(|p|p.kind==ast::ProgramKind::Mutation){
  let births=p.prelude.iter().chain(&p.body).filter(|stmt|match stmt{
   Stmt::Expr{value,..}|Stmt::Bind{value,..}|Stmt::Return{value,..}=>matches!(value,Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,..}),_=>false
  }).count();
  if births<2{continue;}
  specializer.statements(&mut p.prelude);specializer.statements(&mut p.body);
 }
 if specializer.failed{return None;}
 catalog.functions.extend(specializer.generated);Some(catalog)
}
