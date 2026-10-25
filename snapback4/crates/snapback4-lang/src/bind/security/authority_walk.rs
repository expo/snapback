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
// Normalize the paved `update row` form to its selected table and key.
// Keep the authored site: fixture observation binds the executed write there.
fn normalize_target(catalog:&Catalog,p:&ProgramDecl,expr:&mut Expr,env:&Env){
    fn selected(catalog:&Catalog,p:&ProgramDecl,value:&Expr)->Option<(String,Vec<ast::KeyPart>)>{
        let point=|table:String,value:Expr|{let site=value.site().clone();(table,vec![ast::KeyPart{column:Some("id".into()),value,site}])};
        match value{
            Expr::Assert{value,..}=>selected(catalog,p,value),
            Expr::Read(read) if !read.keys.is_empty()&&read.filter.is_none()&&read.range.is_none()&&read.matching.is_none()&&read.seeks.is_empty()=>Some((read.table.clone(),read.keys.clone())),
            Expr::Name{name,..}=>p.args.iter().find_map(|arg|if arg.name==*name&&let ast::TypeKind::Ref{table}=&arg.type_.kind{Some(point(table.clone(),value.clone()))}else{None}),
            Expr::Call{name,args,..} if name=="first"&&args.len()==1=>if let Expr::Read(read)=&args[0]{Some(point(read.table.clone(),Expr::Member{base:Box::new(value.clone()),name:"id".into(),site:value.site().clone()}))}else{None},
            Expr::Member{base,name,..}=>{let (owner,_)=selected(catalog,p,base)?;let table=if name=="id"{owner}else{let ast::TypeKind::Ref{table}=&catalog.tables.get(&owner)?.columns.get(name)?.kind else{return None;};table.clone()};Some(point(table,value.clone()))},_=>None,
        }
    }
    let Expr::Write{table,keys,op:ast::WriteOp::Update|ast::WriteOp::Upsert,..}=expr else{return;};if !keys.is_empty(){return;}
    let value=env.get(table).cloned().unwrap_or_else(||Expr::Name{name:table.clone(),site:p.site.clone()});let value=returned(catalog,&value,0);
    if let Some((target,selected))=selected(catalog,p,&value){*table=target;*keys=selected;}
}
fn expression(catalog:&Catalog,p:&ProgramDecl,expr:&Expr,env:&Env,guards:&[Stmt],changes:&[Change],column:Option<&str>,depth:usize,out:&mut Vec<(Expr,ProgramDecl)>){
    let mut expr=resolve(expr,env);
    let changes=if column.is_some()&&changes::prior_effects(&expr){&[][..]}else{changes};
    super::super::intent_walk::expression(&mut expr,&mut |e|{normalize_target(catalog,p,e,env);match e{
        Expr::Write{keys,fields,condition,..}=>{let mut boundary=Vec::new();for value in keys.iter().map(|key|&key.value).chain(fields.iter().filter_map(|field|field.value.as_ref())).chain(condition.iter().map(|condition|condition.as_ref())){boundary.extend(helper_guards(catalog,value,&Env::new(),depth));}let mut context=p.clone();context.prelude=Vec::new();context.body=guards.to_vec();context.body.extend(boundary);if let Some(column)=column{for change in changes{if change.matches(e,column,p){context.body.extend(change.requirements.clone());}}}out.push((e.clone(),context));},
        Expr::Call{name,args,site} if depth<32=>if let Some(f)=catalog.functions.get(name){
            let mut locals=f.args.iter().zip(args).map(|(arg,value)|(arg.name.clone(),value.clone())).collect();
            let mut inherited=guards.to_vec();
            inherited.push(Stmt::Require{condition:Expr::Literal{value:ast::Literal::Bool(true),site:site.clone()},code:"$callsite".into(),message:None,site:site.clone()});
            match &f.body{
                FunctionBody::Expression(value)=>expression(catalog,p,value,&locals,&inherited,changes,column,depth+1,out),
                FunctionBody::Block(body)=>statements(catalog,p,body,&mut locals,&mut inherited,&mut changes.to_vec(),column,depth+1,out),
            }
        },_=>{}
    }});
}
fn conditional(guards:Vec<Stmt>,premise:Expr,site:&Site)->Vec<Stmt>{guards.into_iter().filter_map(|stmt|if let Stmt::Require{condition,code,..}=stmt{
        let condition=super::creation_advice::simplify_boolean(&Expr::Binary{op:"or".into(),left:Box::new(Expr::Unary{op:"not".into(),value:Box::new(premise.clone()),site:site.clone()}),right:Box::new(condition),site:site.clone()});
        if code=="$advice:cut"&&matches!(condition,Expr::Literal{value:ast::Literal::Bool(true),..}){return None;}
        Some(Stmt::Require{condition,code:if code=="$advice:cut"{code}else{"$advice:implication".into()},message:None,site:site.clone()})
    }else{None}).collect()}

// Guaranteed evaluated operands export helper requirements. Conditional
// operands retain applicability implications, never an unconditional assumption.
pub(super) fn helper_guards(catalog:&Catalog,expr:&Expr,env:&Env,depth:usize)->Vec<Stmt>{
    if depth>=32{return vec![Stmt::Require{condition:Expr::Name{name:"$advice_helper_cut".into(),site:expr.site().clone()},code:"$advice:cut".into(),message:None,site:expr.site().clone()}];}
    let expression=resolve(expr,env);

    match &expression{
        Expr::Unary{value,..}|Expr::Assert{value,..}|Expr::Member{base:value,..}=>return helper_guards(catalog,value,&Env::new(),depth+1),
        Expr::Binary{op,left,right,site}=>{
            let mut out=helper_guards(catalog,left,&Env::new(),depth+1);
            let right=helper_guards(catalog,right,&Env::new(),depth+1);
            if op=="??"{let left=returned(catalog,left,depth+1);let premise=Expr::Binary{op:"=".into(),left:Box::new(left),right:Box::new(Expr::Literal{value:ast::Literal::Null,site:site.clone()}),site:site.clone()};out.extend(conditional(right,premise,site));return out;}
            if op=="and"||op=="or"{let left=returned(catalog,left,depth+1);let premise=if op=="and"{left}else{Expr::Unary{op:"not".into(),value:Box::new(left),site:site.clone()}};out.extend(conditional(right,premise,site));}else{out.extend(right);}return out;
        },
        Expr::If{condition,then,otherwise,site}=>{
            let mut out=helper_guards(catalog,condition,&Env::new(),depth+1);let predicate=returned(catalog,condition,depth+1);
            out.extend(conditional(helper_guards(catalog,then,&Env::new(),depth+1),predicate.clone(),site));
            out.extend(conditional(helper_guards(catalog,otherwise,&Env::new(),depth+1),Expr::Unary{op:"not".into(),value:Box::new(predicate),site:site.clone()},site));return out;
        },
        Expr::Array{items,..}=>return items.iter().flat_map(|value|helper_guards(catalog,value,&Env::new(),depth+1)).collect(),
        Expr::Object{fields,..}=>return fields.iter().filter_map(|field|field.value.as_ref()).flat_map(|value|helper_guards(catalog,value,&Env::new(),depth+1)).collect(),_=>{},
    }
    let Expr::Call{name,args,..}=expression else{return Vec::new();};
    let eager=if name=="sum"&&args.len()==2&&!catalog.functions.contains_key(&name){&args[..1]}else{args.as_slice()};
    let mut evaluated=eager.iter().flat_map(|value|helper_guards(catalog,value,&Env::new(),depth+1)).collect::<Vec<_>>();
    let Some(f)=catalog.functions.get(&name)else{return evaluated;};
    let mut locals=f.args.iter().zip(args).map(|(a,v)|(a.name.clone(),v)).collect::<Env>();
    let FunctionBody::Block(body)=&f.body else{if let FunctionBody::Expression(value)=&f.body{evaluated.extend(helper_guards(catalog,value,&locals,depth+1));}return evaluated;};
    let mut out=Vec::new();out.append(&mut evaluated);
    for s in body{match s{
        Stmt::Require{condition,code,message,site}=>{out.extend(helper_guards(catalog,condition,&locals,depth+1));out.push(Stmt::Require{condition:resolve(condition,&locals),code:code.clone(),message:message.clone(),site:site.clone()});},
        Stmt::Bind{names,value,..}=>{out.extend(helper_guards(catalog,value,&locals,depth+1));if names.len()==1{locals.insert(names[0].clone(),resolve(value,&locals));}else{for name in names{locals.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:value.site().clone()});}}},
        Stmt::Expr{value,..}=>out.extend(helper_guards(catalog,value,&locals,depth+1)),
        Stmt::Return{value,..}=>{out.extend(helper_guards(catalog,value,&locals,depth+1));break;},
        Stmt::If{condition,then_body,else_body,site}=>{out.extend(helper_guards(catalog,condition,&locals,depth+1));let (Some(yes),Some(no))=(conditional_guards(catalog,then_body,&locals,depth+1),conditional_guards(catalog,else_body,&locals,depth+1))else{break;};let predicate=resolve(condition,&locals);out.extend(conditional(yes,predicate.clone(),site));out.extend(conditional(no,Expr::Unary{op:"not".into(),value:Box::new(predicate),site:site.clone()},site));},
        Stmt::For{domain,..}=>{out.extend(helper_guards(catalog,domain,&locals,depth+1));break;},_=>break,
    }}out
}
// Conditional require-only branches impose an implication after rejoining.
// A branch with writes, returns or assignments exports no inferred requirement.
fn conditional_guards(catalog:&Catalog,body:&[Stmt],env:&Env,depth:usize)->Option<Vec<Stmt>> {
    if depth>=32{return Some(vec![Stmt::Require{condition:Expr::Name{name:"$advice_helper_cut".into(),site:body.first().map(|stmt|match stmt{Stmt::Require{site,..}|Stmt::If{site,..}=>site.clone(),_=>Site::new("$advice",1,1)}).unwrap_or_else(||Site::new("$advice",1,1))},code:"$advice:cut".into(),message:None,site:Site::new("$advice",1,1)}]);}
    let mut out=Vec::new();
    for stmt in body {match stmt {
        Stmt::Require{condition,code,message,site}=>{out.extend(helper_guards(catalog,condition,env,depth+1));out.push(Stmt::Require{condition:resolve(condition,env),code:code.clone(),message:message.clone(),site:site.clone()});},
        Stmt::If{condition,then_body,else_body,site}=>{
            out.extend(helper_guards(catalog,condition,env,depth+1));let condition=resolve(condition,env);
            out.extend(conditional(conditional_guards(catalog,then_body,env,depth+1)?,condition.clone(),site));
            out.extend(conditional(conditional_guards(catalog,else_body,env,depth+1)?,Expr::Unary{op:"not".into(),value:Box::new(condition),site:site.clone()},site));
        },_=>return None,
    }}Some(out)
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
            guards.extend(helper_guards(catalog,condition,env,0));
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
            guards.extend(helper_guards(catalog,condition,env,0));
            let condition=resolve(condition,env);
            let mut then_guards=guards.clone();
            then_guards.push(Stmt::Require{condition:condition.clone(),code:"$advice".into(),message:None,site:site.clone()});
            let mut then_env=env.clone();
            statements(catalog,p,then_body,&mut then_env,&mut then_guards,&mut changes.clone(),column,depth,out);
            let mut else_guards=guards.clone();
            else_guards.push(Stmt::Require{condition:Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:site.clone()},code:"$advice".into(),message:None,site:site.clone()});
            let mut else_env=env.clone();
            statements(catalog,p,else_body,&mut else_env,&mut else_guards,&mut changes.clone(),column,depth,out);
            for (negate,branch) in [(true,then_body),(false,else_body)] {
                if let Some(required)=conditional_guards(catalog,branch,env,0){let premise=if negate{condition.clone()}else{Expr::Unary{op:"not".into(),value:Box::new(condition.clone()),site:site.clone()}};guards.extend(conditional(required,premise,site));}
            }
            if contains_exit(then_body)||contains_exit(else_body){
                let branch=Stmt::If{condition:condition.clone(),then_body:then_body.clone(),else_body:else_body.clone(),site:site.clone()};
                if !continuation(guards,fallthrough(&[branch],env,site),site){break;}
            }
            let assigned=branch_assignments(then_body).into_iter().chain(branch_assignments(else_body)).collect::<BTreeSet<_>>();
            if column.is_some()&&assigned.is_empty(){changes.extend(changes::after(catalog,&condition,then_body,else_body,env));}
            let then_stops=matches!(fallthrough(then_body,env,site),Expr::Literal{value:ast::Literal::Bool(false),..});
            let else_stops=matches!(fallthrough(else_body,env,site),Expr::Literal{value:ast::Literal::Bool(false),..});
            let predicate=super::creation_advice::simplify_boolean(&returned(catalog,&condition,0));
            let mut caller=true;let mut probe=predicate.clone();super::super::intent_walk::expression(&mut probe,&mut |e|match e{Expr::Literal{..}=>{},Expr::Name{name,..} if p.args.iter().any(|arg|arg.name==*name)=>{},Expr::Unary{..}|Expr::Binary{..}=>{},_=>caller=false});
            for name in assigned{
                let a=then_env.get(&name).map(|value|super::creation_advice::simplify_boolean(&returned(catalog,value,0)));let b=else_env.get(&name).map(|value|super::creation_advice::simplify_boolean(&returned(catalog,value,0)));
                let boolean=|e:&Expr|if let Expr::Literal{value:ast::Literal::Bool(value),..}=e{Some(*value)}else{None};
                let value=if then_stops{b.clone()}else if else_stops{a.clone()}else if let Expr::Literal{value:ast::Literal::Bool(branch),..}=&predicate{if *branch{a.clone()}else{b.clone()}}else{match (&a,&b){
                    (Some(a),Some(b)) if matches!(a,Expr::Literal{..}|Expr::Name{..})&&crate::print::expression(a)==crate::print::expression(b)=>Some(a.clone()),
                    (Some(a),Some(b)) if caller&&boolean(a).is_some()&&boolean(b).is_some()=>Some(if boolean(a)==Some(true){predicate.clone()}else{Expr::Unary{op:"not".into(),value:Box::new(predicate.clone()),site:site.clone()}}),_=>None,
                }}.unwrap_or_else(||Expr::Name{name:format!("$advice_unknown_{name}"),site:site.clone()});env.insert(name,value);
            }
        },
        Stmt::For{domain,name,body,site}=>{if column.is_some(){changes.clear();}expression(catalog,p,domain,env,guards,changes,column,depth,out);guards.extend(helper_guards(catalog,domain,env,0));let mut local=env.clone();local.remove(name);if let Expr::Read(read)=returned(catalog,&resolve(domain,env),0){let mut binder=site.clone();binder.file=format!("$advice/value/{}",binder.file);local.insert(name.clone(),Expr::Read(ast::ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:read.table,keys:vec![ast::KeyPart{column:Some("id".into()),value:Expr::Member{base:Box::new(Expr::Name{name:name.clone(),site:binder.clone()}),name:"id".into(),site:binder.clone()},site:binder.clone()}],index:None,range:None,matching:None,filter:None,seeks:Vec::new(),site:binder}));}let mut nested=guards.clone();nested.push(Stmt::Require{condition:Expr::Literal{value:ast::Literal::Bool(true),site:site.clone()},code:format!("$iteration:{site}"),message:None,site:site.clone()});statements(catalog,p,body,&mut local,&mut nested,&mut Vec::new(),column,depth,out);for name in branch_assignments(body){env.insert(name.clone(),Expr::Name{name:format!("$advice_unknown_{name}"),site:site.clone()});}if contains_return(body){continuation(guards,Expr::Name{name:format!("$advice_fallthrough:{site}"),site:site.clone()},site);}},
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
pub(super) fn returned(catalog:&Catalog,value:&Expr,depth:usize)->Expr{
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
