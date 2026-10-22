//! Expand advisory write sites with lexical arguments and dominating guards.
// @ref LLP 3000.036.004#128-runtime-intent-and-independent-worlds — helper placement cannot hide a grant writer.
use super::*;
use ast::{Expr,Stmt,ProgramDecl,FunctionBody};
type Env=BTreeMap<String,Expr>;
mod changes;
use changes::Change;
fn resolve(expr:&Expr,env:&Env)->Expr{
    let mut expr=expr.clone();
    super::super::intent_walk::expression(&mut expr,&mut |e|{
        if let Expr::Object{fields,..}|Expr::Write{fields,..}=e{for f in fields{if f.value.is_none(){f.value=Some(env.get(&f.name).cloned().unwrap_or_else(||Expr::Name{name:f.name.clone(),site:f.site.clone()}));}}}
        if let Expr::Name{name,..}=e&&let Some(value)=env.get(name){*e=value.clone();}
    });expr
}
fn expression(catalog:&Catalog,p:&ProgramDecl,expr:&Expr,env:&Env,guards:&[Stmt],changes:&[Change],column:Option<&str>,depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    let mut expr=resolve(expr,env);
    let changes=if column.is_some()&&changes::prior_effects(&expr){&[][..]}else{changes};
    super::super::intent_walk::expression(&mut expr,&mut |e|match e{
        Expr::Write{..}=>{let mut context=p.clone();context.prelude=Vec::new();context.body=guards.to_vec();if let Some(column)=column{for change in changes{if change.matches(e,column,p){context.body.extend(change.requirements.clone());}}}out.push((e.clone(),context));},
        Expr::Call{name,args,..} if depth<32=>if let Some(f)=catalog.functions.get(name){
            let mut locals=f.args.iter().zip(args).map(|(arg,value)|(arg.name.clone(),value.clone())).collect();
            let mut inherited=guards.to_vec();
            match &f.body{
                FunctionBody::Expression(value)=>expression(catalog,p,value,&locals,&inherited,changes,column,depth+1,out),
                FunctionBody::Block(body)=>statements(catalog,p,body,&mut locals,&mut inherited,&mut changes.to_vec(),column,depth+1,out),
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
fn statements(catalog:&Catalog,p:&ProgramDecl,body:&[Stmt],env:&mut Env,guards:&mut Vec<Stmt>,changes:&mut Vec<Change>,column:Option<&str>,depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    for s in body{
        let consuming=column.is_some()&&changes::effectful(s);
        match s{
        Stmt::Bind{names,value,..}=>{expression(catalog,p,value,env,guards,changes,column,depth,out);guards.extend(helper_guards(catalog,value,env,0));if names.len()==1{env.insert(names[0].clone(),resolve(value,env));}},
        Stmt::Require{condition,code,message,site}=>{
            expression(catalog,p,condition,env,guards,changes,column,depth,out);
            guards.push(Stmt::Require{condition:resolve(condition,env),code:code.clone(),message:message.clone(),site:site.clone()});
        },
        Stmt::Return{value,..}=>{expression(catalog,p,value,env,guards,changes,column,depth,out);break;},
        Stmt::Expr{value,..}=>{expression(catalog,p,value,env,guards,changes,column,depth,out);guards.extend(helper_guards(catalog,value,env,0));},
        Stmt::Emit{payload,once,..}=>{
            if column.is_some(){changes.clear();}
            expression(catalog,p,payload,env,guards,changes,column,depth,out);
            if let Some(once)=once{expression(catalog,p,once,env,guards,changes,column,depth,out);}
        },
        Stmt::If{condition,then_body,else_body,site}=>{
            if column.is_some()&&changes::expression_effectful(&resolve(condition,env)){changes.clear();}
            expression(catalog,p,condition,env,guards,changes,column,depth,out);
            let condition=resolve(condition,env);
            let mut then_guards=guards.clone();
            then_guards.push(Stmt::Require{condition:condition.clone(),code:"$advice".into(),message:None,site:site.clone()});
            statements(catalog,p,then_body,&mut env.clone(),&mut then_guards,&mut changes.clone(),column,depth,out);
            let mut else_guards=guards.clone();
            else_guards.push(Stmt::Require{condition:Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:site.clone()},code:"$advice".into(),message:None,site:site.clone()});
            statements(catalog,p,else_body,&mut env.clone(),&mut else_guards,&mut changes.clone(),column,depth,out);
            let assigned=branch_assignments(then_body).into_iter().chain(branch_assignments(else_body)).collect::<BTreeSet<_>>();
            if column.is_some()&&assigned.is_empty(){changes.extend(changes::after(catalog,&condition,then_body,else_body,env));}
            for name in assigned{env.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:site.clone()});}
        },
        Stmt::For{domain,name,body,site}=>{if column.is_some(){changes.clear();}expression(catalog,p,domain,env,guards,changes,column,depth,out);let mut local=env.clone();local.remove(name);statements(catalog,p,body,&mut local,&mut guards.clone(),&mut Vec::new(),column,depth,out);for name in branch_assignments(body){env.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:site.clone()});}},
        Stmt::As{body,..}=>statements(catalog,p,body,&mut env.clone(),&mut guards.clone(),&mut changes.clone(),column,depth,out),_=>{}
    }
    if consuming{changes.clear();}
    }
}
pub(super) fn writes(catalog:&Catalog,p:&ProgramDecl)->Vec<(Expr,ProgramDecl)>{walk_writes(catalog,p,None)}
pub(super) fn column_writes(catalog:&Catalog,p:&ProgramDecl,column:&str)->Vec<(Expr,ProgramDecl)>{walk_writes(catalog,p,Some(column))}
fn walk_writes(catalog:&Catalog,p:&ProgramDecl,column:Option<&str>)->Vec<(Expr,ProgramDecl)>{
    let mut out=Vec::new();let mut env=Env::new();let mut guards=Vec::new();let mut changes=Vec::new();
    statements(catalog,p,&p.prelude,&mut env,&mut guards,&mut changes,column,0,&mut out);
    statements(catalog,p,&p.body,&mut env,&mut guards,&mut changes,column,0,&mut out);out
}

fn branch_assignments(body:&[Stmt])->BTreeSet<String>{
    let mut out=BTreeSet::new();for s in body{match s{Stmt::Bind{names,..}=>out.extend(names.clone()),Stmt::If{then_body,else_body,..}=>{out.extend(branch_assignments(then_body));out.extend(branch_assignments(else_body));},Stmt::For{body,..}|Stmt::As{body,..}=>out.extend(branch_assignments(body)),_=>{}}}out
}
