//! Invocation-specific analysis helpers preserve actual lexical evaluation.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — helper body sites alone cannot identify a captured result.
use super::*;
use ast::{FunctionBody,FunctionDecl,Stmt};
fn mark(expression:&mut Expr,tag:&str){
 let site=match expression{
  Expr::Read(read)=>&mut read.site,Expr::Merge(merge)=>&mut merge.site,
  Expr::Name{site,..}|Expr::Literal{site,..}|Expr::Focal{site,..}|Expr::Array{site,..}|Expr::Object{site,..}|Expr::Unary{site,..}|Expr::Binary{site,..}|Expr::If{site,..}|Expr::Assert{site,..}|Expr::Member{site,..}|Expr::Exists{site,..}|Expr::Created{site,..}|Expr::Call{site,..}|Expr::Write{site,..}|Expr::ShapeUse{site,..}|Expr::Shape{site,..}|Expr::Walk{site,..}=>site,
 };
 let prior=site.file.strip_prefix("$advice/value/");
 site.file=if let Some(prior)=prior{format!("$advice/value/$conservation/invocation/{tag}/{prior}")}else{format!("$conservation/invocation/{tag}/{}",site.file)};

}

// Names are classified in lexical order before helper expansion. Unknown/free
// names can be bare maintained scalars or table/view reads; they are never pure
// simply because their AST form is Name. Capture versions also distinguish
// opaque locals rebound between the two births.
type Locals=BTreeMap<String,Option<Site>>;
fn local(scope:&str,name:&str,site:&Site)->Site{
 use sha2::{Digest,Sha256};let tag=format!("{:x}",Sha256::digest(format!("{scope}/{name}/{site}")));
 Site::new(&format!("$conservation/capture/{tag}/{}",site.file),site.line,site.col)
}
fn names(args:&[ast::ArgDecl],scope:&str)->Locals{
 let mut out=BTreeMap::from([("viewer".into(),None),("now".into(),None)]);
 out.extend(args.iter().map(|arg|(arg.name.clone(),Some(local(scope,&arg.name,&arg.site)))));out
}
fn name_site(name:&str,site:&mut Site,locals:&Locals){
 match locals.get(name){
  Some(Some(capture))=>*site=capture.clone(),Some(None)=>{},
  None=>site.file=format!("$advice/value/$conservation/world-name/{}",site.file),
 }
}
fn scope_expression(value:&mut Expr,locals:&Locals){
 super::super::super::super::intent_walk::expression(value,&mut |e|match e{
  Expr::Name{name,site}=>name_site(name,site,locals),
  Expr::Object{fields,..}|Expr::Write{fields,..}=>for field in fields{if field.value.is_none(){
   let mut site=field.site.clone();name_site(&field.name,&mut site,locals);
   field.value=Some(Expr::Name{name:field.name.clone(),site});
  }},
  _=>{}
 });
}
fn scope_body(body:&mut [Stmt],locals:&mut Locals,scope:&str){
 for stmt in body{match stmt{
  Stmt::Bind{names,value,site}=>{scope_expression(value,locals);for name in names{locals.insert(name.clone(),Some(local(scope,name,site)));}},
  Stmt::Expr{value,..}|Stmt::Return{value,..}=>scope_expression(value,locals),
  Stmt::Require{condition,..}=>scope_expression(condition,locals),
  Stmt::Emit{payload,once,..}=>{scope_expression(payload,locals);if let Some(once)=once{scope_expression(once,locals);}},
  Stmt::If{condition,then_body,else_body,..}=>{scope_expression(condition,locals);scope_body(then_body,&mut locals.clone(),scope);scope_body(else_body,&mut locals.clone(),scope);},
  Stmt::For{name,domain,body,site}=>{scope_expression(domain,locals);let mut child=locals.clone();child.insert(name.clone(),Some(local(scope,name,site)));scope_body(body,&mut child,scope);},
  Stmt::As{principal,body,..}=>{scope_expression(principal,locals);let mut child=locals.clone();child.remove("viewer");scope_body(body,&mut child,scope);},
  Stmt::Break{..}|Stmt::Continue{..}=>{}
 }}
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
  let mut locals=names(&function.args,&unique);
  match &mut function.body{
   FunctionBody::Expression(value)=>{
    scope_expression(value,&locals);
    super::super::super::super::intent_walk::expression(value,&mut |e|mark(e,&tag));
    self.expression(value);
   },
   FunctionBody::Block(body)=>{
    scope_body(body,&mut locals,&unique);
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
  let mut locals=names(&p.args,&format!("{}/{}",p.site,p.name));
  scope_body(&mut p.prelude,&mut locals,&p.name);scope_body(&mut p.body,&mut locals,&p.name);
  specializer.statements(&mut p.prelude);specializer.statements(&mut p.body);
 }
 if specializer.failed{return None;}
 catalog.functions.extend(specializer.generated);Some(catalog)
}
