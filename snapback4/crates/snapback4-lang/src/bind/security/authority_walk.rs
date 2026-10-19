//! Expand advisory write sites with lexical arguments and dominating guards.
// @ref LLP 3000.036.004#128-runtime-intent-and-independent-worlds — helper placement cannot hide a grant writer.
use super::*;
use ast::{Expr,Stmt,ProgramDecl,FunctionBody};
type Env=BTreeMap<String,Expr>;
fn resolve(expr:&Expr,env:&Env)->Expr{
    let mut expr=expr.clone();
    super::super::intent_walk::expression(&mut expr,&mut |e|{
        if let Expr::Object{fields,..}|Expr::Write{fields,..}=e{for f in fields{if f.value.is_none(){f.value=Some(env.get(&f.name).cloned().unwrap_or_else(||Expr::Name{name:f.name.clone(),site:f.site.clone()}));}}}
        if let Expr::Name{name,..}=e&&let Some(value)=env.get(name){*e=value.clone();}
    });expr
}
fn expression(catalog:&Catalog,p:&ProgramDecl,expr:&Expr,env:&Env,guards:&[Stmt],depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    let mut expr=resolve(expr,env);
    super::super::intent_walk::expression(&mut expr,&mut |e|match e{
        Expr::Write{..}=>{let mut context=p.clone();context.prelude=Vec::new();context.body=guards.to_vec();out.push((e.clone(),context));},
        Expr::Call{name,args,..} if depth<32=>if let Some(f)=catalog.functions.get(name){
            let mut locals=f.args.iter().zip(args).map(|(arg,value)|(arg.name.clone(),value.clone())).collect();
            let mut inherited=guards.to_vec();
            match &f.body{
                FunctionBody::Expression(value)=>expression(catalog,p,value,&locals,&inherited,depth+1,out),
                FunctionBody::Block(body)=>statements(catalog,p,body,&mut locals,&mut inherited,depth+1,out),
            }
        },_=>{}
    });
}
// Only an unconditional direct call exports a helper's guaranteed prefix.
// Conditional/loop-local requirements never become caller assumptions.
fn helper_guards(catalog:&Catalog,expr:&Expr,env:&Env,depth:usize)->Vec<Stmt>{
    if depth>=32{return Vec::new();}
    let Expr::Call{name,args,..}=resolve(expr,env)else{return Vec::new();};
    let Some(f)=catalog.functions.get(&name)else{return Vec::new();};
    let mut locals=f.args.iter().zip(args).map(|(a,v)|(a.name.clone(),v)).collect::<Env>();
    let FunctionBody::Block(body)=&f.body else{return if let FunctionBody::Expression(value)=&f.body{helper_guards(catalog,value,&locals,depth+1)}else{Vec::new()};};
    let mut out=Vec::new();
    for s in body{match s{
        Stmt::Require{condition,code,message,site}=>out.push(Stmt::Require{condition:resolve(condition,&locals),code:code.clone(),message:message.clone(),site:site.clone()}),
        Stmt::Bind{names,value,..}=>{out.extend(helper_guards(catalog,value,&locals,depth+1));if names.len()==1{locals.insert(names[0].clone(),resolve(value,&locals));}},
        Stmt::Expr{value,..}=>out.extend(helper_guards(catalog,value,&locals,depth+1)),
        Stmt::Return{value,..}=>{out.extend(helper_guards(catalog,value,&locals,depth+1));break;},_=>break,
    }}out
}
fn statements(catalog:&Catalog,p:&ProgramDecl,body:&[Stmt],env:&mut Env,guards:&mut Vec<Stmt>,depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    for s in body{match s{
        Stmt::Bind{names,value,..}=>{expression(catalog,p,value,env,guards,depth,out);guards.extend(helper_guards(catalog,value,env,0));if names.len()==1{env.insert(names[0].clone(),resolve(value,env));}},
        Stmt::Require{condition,code,message,site}=>{
            expression(catalog,p,condition,env,guards,depth,out);
            guards.push(Stmt::Require{condition:resolve(condition,env),code:code.clone(),message:message.clone(),site:site.clone()});
        },
        Stmt::Return{value,..}=>{expression(catalog,p,value,env,guards,depth,out);break;},
        Stmt::Expr{value,..}=>{expression(catalog,p,value,env,guards,depth,out);guards.extend(helper_guards(catalog,value,env,0));},
        Stmt::If{condition,then_body,else_body,..}=>{
            expression(catalog,p,condition,env,guards,depth,out);
            statements(catalog,p,then_body,&mut env.clone(),&mut guards.clone(),depth,out);
            statements(catalog,p,else_body,&mut env.clone(),&mut guards.clone(),depth,out);
        },
        Stmt::For{domain,name,body,..}=>{expression(catalog,p,domain,env,guards,depth,out);let mut local=env.clone();local.remove(name);statements(catalog,p,body,&mut local,&mut guards.clone(),depth,out);},
        Stmt::As{body,..}=>statements(catalog,p,body,&mut env.clone(),&mut guards.clone(),depth,out),_=>{}
    }}
}
pub(super) fn writes(catalog:&Catalog,p:&ProgramDecl)->Vec<(Expr,ProgramDecl)>{
    let mut out=Vec::new();let mut env=Env::new();let mut guards=Vec::new();
    statements(catalog,p,&p.prelude,&mut env,&mut guards,0,&mut out);
    statements(catalog,p,&p.body,&mut env,&mut guards,0,&mut out);out
}
