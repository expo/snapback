//! Expand advisory write sites with lexical arguments and dominating guards.
// @ref LLP 3000.036.004#128-runtime-intent-and-independent-worlds — helper placement cannot hide a grant writer.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — snapshots and continuation custody keep skipped audits from supplying approval use.
use super::*;
use ast::{Expr,Stmt,ProgramDecl,FunctionBody};
type Env=BTreeMap<String,Expr>;
mod changes;
use changes::Change;
pub(super) fn resolve(expr:&Expr,env:&Env)->Expr{
    let mut expr=expr.clone();
    super::super::intent_walk::expression(&mut expr,&mut |e|{
        if let Expr::Object{fields,..}|Expr::Write{fields,..}=e{for f in fields{if f.value.is_none(){f.value=Some(env.get(&f.name).cloned().unwrap_or_else(||Expr::Name{name:f.name.clone(),site:f.site.clone()}));}}}
        if let Expr::Name{name,site}=e&&!site.file.starts_with("$advice/value/")&&let Some(value)=env.get(name){*e=value.clone();}
    });
    // Values captured at a binding/call retain their original symbolic input.
    // Reusing that expression after a reassignment must not evaluate it again.
    super::super::intent_walk::expression(&mut expr,&mut |e|if let Expr::Name{site,..}=e&&!site.file.starts_with("$advice/value/"){site.file=format!("$advice/value/{}",site.file);});expr
}
fn expression(catalog:&Catalog,p:&ProgramDecl,expr:&Expr,env:&Env,guards:&[Stmt],changes:&[Change],column:Option<&str>,depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    let mut expr=resolve(expr,env);
    let changes=if column.is_some()&&changes::prior_effects(&expr){&[][..]}else{changes};
    super::super::intent_walk::expression(&mut expr,&mut |e|match e{
        Expr::Write{..}=>{let mut context=p.clone();context.prelude=Vec::new();context.body=guards.to_vec();if let Some(column)=column{for change in changes{if change.matches(e,column,p){context.body.extend(change.requirements.clone());}}}out.push((e.clone(),context));},
        Expr::Call{name,args,site} if depth<32=>if let Some(f)=catalog.functions.get(name){
            let mut locals=f.args.iter().zip(args).map(|(arg,value)|(arg.name.clone(),value.clone())).collect();
            let mut inherited=guards.to_vec();
            inherited.push(Stmt::Require{condition:Expr::Literal{value:ast::Literal::Bool(true),site:site.clone()},code:"$callsite".into(),message:None,site:site.clone()});
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
        Stmt::Bind{names,value,..}=>{out.extend(helper_guards(catalog,value,&locals,depth+1));if names.len()==1{locals.insert(names[0].clone(),resolve(value,&locals));}else{for name in names{locals.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:value.site().clone()});}}},
        Stmt::Expr{value,..}=>out.extend(helper_guards(catalog,value,&locals,depth+1)),
        Stmt::Return{value,..}=>{out.extend(helper_guards(catalog,value,&locals,depth+1));break;},_=>break,
    }}out
}
// Conditional require-only branches impose an implication after rejoining.
// A branch with writes, returns or assignments exports no inferred requirement.
fn conditional_guards(body:&[Stmt],env:&Env)->Option<Vec<Expr>> {
    let mut out=Vec::new();
    for s in body {match s {
        Stmt::Require{condition,..}=>out.push(resolve(condition,env)),
        Stmt::If{condition,then_body,else_body,site}=>{
            let condition=resolve(condition,env);
            for (negate,branch) in [(true,then_body),(false,else_body)] {
                for required in conditional_guards(branch,env)? {
                    let premise=if negate{Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:site.clone()}}else{condition.clone()};
                    out.push(Expr::Binary{op:"or".into(),left:Box::new(premise),right:Box::new(required),site:site.clone()});
                }
            }
        },_=>return None,
    }} Some(out)
}
// An early return commits previous writes while skipping later decisions.
// Preserve the continuation path so a later stamp cannot exempt an earlier audit.
fn fallthrough(body:&[Stmt],env:&Env,site:&Site)->Expr{
    fn flow(body:&[Stmt],env:&mut Env,site:&Site)->Expr{
        let literal=|value|Expr::Literal{value:ast::Literal::Bool(value),site:site.clone()};
        let binary=|op:&str,left:Expr,right:Expr|Expr::Binary{op:op.into(),left:Box::new(left),right:Box::new(right),site:site.clone()};
        let unknown=|name:&str|Expr::Name{name:format!("$advice_flow:{site}:{name}"),site:site.clone()};
        let mut result=literal(true);
        for stmt in body{match stmt{
            Stmt::Bind{names,value,..}=>{let value=resolve(value,env);for name in names{env.insert(name.clone(),if names.len()==1{value.clone()}else{unknown(name)});}},
            Stmt::Return{..}|Stmt::Break{..}|Stmt::Continue{..}=>return literal(false),
            Stmt::If{condition,then_body,else_body,..}=>{
                let condition=super::creation_advice::simplify_boolean(&resolve(condition,env));
                let next=if let Expr::Literal{value:ast::Literal::Bool(value),..}=condition{flow(if value{then_body}else{else_body},env,site)}else{
                    let mut yes=env.clone();let a=flow(then_body,&mut yes,site);let mut no=env.clone();let b=flow(else_body,&mut no,site);
                    let stops=|e:&Expr|matches!(e,Expr::Literal{value:ast::Literal::Bool(false),..});
                    if stops(&a){*env=no;}else if stops(&b){*env=yes;}else{for name in yes.keys().chain(no.keys()).cloned().collect::<BTreeSet<_>>(){let value=match (yes.get(&name),no.get(&name)){(Some(a),Some(b)) if crate::print::expression(a)==crate::print::expression(b)=>a.clone(),_=>unknown(&name)};env.insert(name,value);}}
                    let not=Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:site.clone()};binary("or",binary("and",condition,a),binary("and",not,b))
                };result=super::creation_advice::simplify_boolean(&binary("and",result,next));
            },
            Stmt::As{body,..}=>result=binary("and",result,flow(body,&mut env.clone(),site)),
            Stmt::For{domain,body,..}=>{
                let empty=matches!(resolve(domain,env),Expr::Array{items,..} if items.is_empty());
                if !empty&&contains_return(body){result=binary("and",result,unknown("loop-return"));}
                if !empty{for name in branch_assignments(body){env.insert(name.clone(),unknown(&name));}}
            },_=>{},
        }}super::creation_advice::simplify_boolean(&result)
    }flow(body,&mut env.clone(),site)
}
pub(super) fn contains_return(body:&[Stmt])->bool{body.iter().any(|stmt|match stmt{Stmt::Return{..}=>true,Stmt::If{then_body,else_body,..}=>contains_return(then_body)||contains_return(else_body),Stmt::For{body,..}|Stmt::As{body,..}=>contains_return(body),_=>false})}
// Break/continue leave this block, but transfers in a nested loop do not
// escape that loop. Only a return can escape a nested iteration.
pub(super) fn contains_exit(body:&[Stmt])->bool{body.iter().any(|stmt|match stmt{
    Stmt::Return{..}|Stmt::Break{..}|Stmt::Continue{..}=>true,
    Stmt::If{then_body,else_body,..}=>contains_exit(then_body)||contains_exit(else_body),
    Stmt::As{body,..}=>contains_exit(body),Stmt::For{body,..}=>contains_return(body),_=>false,
})}
fn continuation(guards:&mut Vec<Stmt>,condition:Expr,site:&Site)->bool{
    if matches!(condition,Expr::Literal{value:ast::Literal::Bool(false),..}){return false;}
    if !matches!(condition,Expr::Literal{value:ast::Literal::Bool(true),..}){guards.push(Stmt::Require{condition,code:"$advice".into(),message:None,site:site.clone()});}true
}
fn statements(catalog:&Catalog,p:&ProgramDecl,body:&[Stmt],env:&mut Env,guards:&mut Vec<Stmt>,changes:&mut Vec<Change>,column:Option<&str>,depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    for s in body{
        let consuming=column.is_some()&&changes::effectful(s);
        match s{
        Stmt::Bind{names,value,..}=>{expression(catalog,p,value,env,guards,changes,column,depth,out);guards.extend(helper_guards(catalog,value,env,0));if names.len()==1{env.insert(names[0].clone(),resolve(value,env));}else{for name in names{env.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:value.site().clone()});}}},
        Stmt::Require{condition,code,message,site}=>{
            expression(catalog,p,condition,env,guards,changes,column,depth,out);
            guards.push(Stmt::Require{condition:resolve(condition,env),code:code.clone(),message:message.clone(),site:site.clone()});
        },
        Stmt::Return{value,..}=>{expression(catalog,p,value,env,guards,changes,column,depth,out);break;},
        Stmt::Break{..}|Stmt::Continue{..}=>break,
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
            for (negate,branch) in [(true,then_body),(false,else_body)] {
                if let Some(required)=conditional_guards(branch,env) {for required in required {
                    let premise=if negate{Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:site.clone()}}else{condition.clone()};
                    guards.push(Stmt::Require{condition:Expr::Binary{op:"or".into(),left:Box::new(premise),right:Box::new(required),site:site.clone()},code:"$advice:implication".into(),message:None,site:site.clone()});
                }}
            }
            if contains_exit(then_body)||contains_exit(else_body){
                let branch=Stmt::If{condition:condition.clone(),then_body:then_body.clone(),else_body:else_body.clone(),site:site.clone()};
                if !continuation(guards,fallthrough(&[branch],env,site),site){break;}
            }
            let assigned=branch_assignments(then_body).into_iter().chain(branch_assignments(else_body)).collect::<BTreeSet<_>>();
            if column.is_some()&&assigned.is_empty(){changes.extend(changes::after(catalog,&condition,then_body,else_body,env));}
            for name in assigned{env.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:site.clone()});}
        },
        Stmt::For{domain,name,body,site}=>{if column.is_some(){changes.clear();}expression(catalog,p,domain,env,guards,changes,column,depth,out);let mut local=env.clone();local.remove(name);let mut nested=guards.clone();nested.push(Stmt::Require{condition:Expr::Literal{value:ast::Literal::Bool(true),site:site.clone()},code:format!("$iteration:{site}"),message:None,site:site.clone()});statements(catalog,p,body,&mut local,&mut nested,&mut Vec::new(),column,depth,out);for name in branch_assignments(body){env.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:site.clone()});}if contains_return(body){continuation(guards,Expr::Name{name:format!("$advice_fallthrough:{site}"),site:site.clone()},site);}},
        Stmt::As{body,site,..}=>{statements(catalog,p,body,&mut env.clone(),&mut guards.clone(),&mut changes.clone(),column,depth,out);if contains_exit(body)&&!continuation(guards,fallthrough(body,env,site),site){break;}},
    }
    if consuming{changes.clear();}
    }
}
pub(super) fn writes(catalog:&Catalog,p:&ProgramDecl)->Vec<(Expr,ProgramDecl)>{walk_writes(catalog,p,None)}
pub(super) fn column_writes(catalog:&Catalog,p:&ProgramDecl,column:&str)->Vec<(Expr,ProgramDecl)>{walk_writes(catalog,p,Some(column))}
// Expand a helper's single guaranteed value for source analysis. Requirements
// are already exported separately; branches, effects and unknown control flow
// cannot supply a guessed return. This never executes or rewrites a program.
fn returned(catalog:&Catalog,value:&Expr,depth:usize)->Expr{
    if depth>=32{return value.clone();}
    fn effectful(catalog:&Catalog,value:&Expr)->bool{let mut value=value.clone();let mut effect=false;super::super::intent_walk::expression(&mut value,&mut |e|match e{Expr::Write{..}=>effect=true,Expr::Call{name,..} if catalog.functions.contains_key(name)=>effect=true,_=>{}});effect}
    let mut value=value.clone();
    super::super::intent_walk::expression(&mut value,&mut |e|{
        let Expr::Call{name,args,..}=e else{return;};
        let Some(f)=catalog.functions.get(name)else{return;};
        let mut locals=f.args.iter().zip(args.iter()).map(|(a,v)|(a.name.clone(),v.clone())).collect::<Env>();
        let candidate=match &f.body{
            FunctionBody::Expression(value)=>Some(resolve(value,&locals)),
            FunctionBody::Block(body)=>{
                let mut result=None;
                for statement in body{match statement{
                    Stmt::Require{condition,..}=>{if effectful(catalog,&returned(catalog,&resolve(condition,&locals),depth+1)){break;}},
                    Stmt::Bind{names,value,..} if names.len()==1=>{let value=returned(catalog,&resolve(value,&locals),depth+1);if effectful(catalog,&value){break;}locals.insert(names[0].clone(),value);},
                    Stmt::Return{value,..}=>{result=Some(resolve(value,&locals));break;},_=>break,
                }}result
            },
        };
        if let Some(candidate)=candidate{
            let candidate=returned(catalog,&candidate,depth+1);
            if !effectful(catalog,&candidate){*e=candidate;}
        }
    });value
}
fn walk_writes(catalog:&Catalog,p:&ProgramDecl,column:Option<&str>)->Vec<(Expr,ProgramDecl)>{
    let mut out=Vec::new();let mut env=Env::new();let mut guards=Vec::new();let mut changes=Vec::new();
    statements(catalog,p,&p.prelude,&mut env,&mut guards,&mut changes,column,0,&mut out);
    statements(catalog,p,&p.body,&mut env,&mut guards,&mut changes,column,0,&mut out);
    for (write,context) in &mut out{
        *write=returned(catalog,write,0);
        for statement in &mut context.body{if let Stmt::Require{condition,..}=statement{*condition=returned(catalog,condition,0);}}
    }out
}

pub(super) fn branch_assignments(body:&[Stmt])->BTreeSet<String>{
    let mut out=BTreeSet::new();for s in body{match s{Stmt::Bind{names,..}=>out.extend(names.clone()),Stmt::If{then_body,else_body,..}=>{out.extend(branch_assignments(then_body));out.extend(branch_assignments(else_body));},Stmt::For{body,..}|Stmt::As{body,..}=>out.extend(branch_assignments(body)),_=>{}}}out
}
