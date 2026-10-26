//! Bounded, read-only expansion for diagnostic implication, never authority.
// @ref LLP 3000.036.004.001#2-read-guards — preserve all evaluated arguments.
use super::catalog::Catalog;
use crate::ast::{Expr, FunctionBody, Stmt};

pub(super) fn expand(catalog:&Catalog,value:&Expr)->Option<Expr>{
    fn expression(catalog:&Catalog,value:&Expr,stack:&mut Vec<String>,fuel:&mut usize)->bool{
        let mut safe=true;let mut calls=Vec::new();
        super::intent_walk::expression(&mut value.clone(),&mut |node|{
            if *fuel==0{safe=false;return;}*fuel-=1;
            match node{Expr::Write{..}=>safe=false,Expr::Call{name,..} if catalog.functions.contains_key(name)=>calls.push(name.clone()),_=>{}}
        });
        if !safe{return false;}
        for name in calls{
            if stack.len()>=32||stack.contains(&name){return false;}
            let function=&catalog.functions[&name];stack.push(name);
            let safe=match &function.body{FunctionBody::Expression(value)=>expression(catalog,value,stack,fuel),FunctionBody::Block(body)=>statements(catalog,body,stack,fuel)};
            stack.pop();if !safe{return false;}
        }true
    }
    fn statements(catalog:&Catalog,body:&[Stmt],stack:&mut Vec<String>,fuel:&mut usize)->bool{
        body.iter().all(|stmt|match stmt{
            Stmt::Bind{value,..}|Stmt::Return{value,..}|Stmt::Expr{value,..}|Stmt::Require{condition:value,..}=>expression(catalog,value,stack,fuel),
            Stmt::If{condition,then_body,else_body,..}=>expression(catalog,condition,stack,fuel)&&statements(catalog,then_body,stack,fuel)&&statements(catalog,else_body,stack,fuel),
            Stmt::For{domain,body,..}=>expression(catalog,domain,stack,fuel)&&statements(catalog,body,stack,fuel),
            Stmt::Emit{..}|Stmt::As{..}=>false,Stmt::Break{..}|Stmt::Continue{..}=>true,
        })
    }
    // Bound the substituted tree before constructing it. Parameter weights
    // account for duplication and straight-line local aliases, not just source
    // nodes; a tiny duplicate(duplicate(...)) cannot allocate an exponential AST.
    type Weights=std::collections::BTreeMap<String,usize>;
    fn add(a:usize,b:usize)->Option<usize>{a.checked_add(b).filter(|n|*n<=4096)}
    fn weight(catalog:&Catalog,value:&Expr,env:&Weights,stack:&mut Vec<String>)->Option<usize>{
        match value{
            Expr::Name{name,..}=>Some(env.get(name).copied().unwrap_or(1)),
            Expr::Literal{..}|Expr::Focal{..}=>Some(1),
            Expr::Member{base,..}|Expr::Unary{value:base,..}|Expr::Assert{value:base,..}=>add(1,weight(catalog,base,env,stack)?),
            Expr::Binary{left,right,..}=>add(add(1,weight(catalog,left,env,stack)?)?,weight(catalog,right,env,stack)?),
            Expr::If{condition,then,otherwise,..}=>add(add(add(1,weight(catalog,condition,env,stack)?)?,weight(catalog,then,env,stack)?)?,weight(catalog,otherwise,env,stack)?),
            Expr::Exists{read,..}|Expr::Read(read) if read.range.is_none()&&read.filter.is_none()&&read.matching.is_none()&&read.seeks.is_empty()&&read.computed.is_empty()=>read.keys.iter().try_fold(1,|n,key|add(n,weight(catalog,&key.value,env,stack)?)),
            Expr::Call{name,args,..}=>{
                let weights=args.iter().map(|arg|weight(catalog,arg,env,stack)).collect::<Option<Vec<_>>>()?;
                let arguments=weights.iter().try_fold(1,|n,size|add(n,*size))?;
                let Some(function)=catalog.functions.get(name)else{return Some(arguments);};
                if stack.len()>=32||stack.contains(name){return None;}
                stack.push(name.clone());
                let mut locals=function.args.iter().zip(weights).map(|(arg,size)|(arg.name.clone(),size)).collect::<Weights>();
                let result=match &function.body{
                    FunctionBody::Expression(value)=>weight(catalog,value,&locals,stack),
                    FunctionBody::Block(body)=>{
                        let mut total=Some(1);let mut result=None;
                        for stmt in body{match stmt{
                            Stmt::Bind{names,value,..} if names.len()==1=>{let size=weight(catalog,value,&locals,stack)?;total=add(total?,size);locals.insert(names[0].clone(),size);},
                            Stmt::Require{condition,..}|Stmt::Expr{value:condition,..}=>total=add(total?,weight(catalog,condition,&locals,stack)?),
                            Stmt::Return{value,..}=>{result=add(total?,weight(catalog,value,&locals,stack)?);break;},_=>return None,
                        }}result
                    },
                };
                stack.pop();add(arguments,result?)
            },_=>None,
        }
    }
    if !expression(catalog,value,&mut Vec::new(),&mut 4096){return None;}
    weight(catalog,value,&Weights::new(),&mut Vec::new())?;
    Some(super::security::authority_walk::returned(catalog,value,0))
}
// Extra named equalities test the same unique row. For negative advice facts,
// prove that row readable from its complete key before dropping any tests.
pub(super) fn raw_monotone(catalog:&Catalog,schema:&snapback4_core::schema::Schema,value:&Expr,positive:bool)->bool{
    match value{
        Expr::Exists{read,..} if !positive=>{
            if super::program::maintain_types::program_absence_is_raw(schema,read){return true;}
            let Some(info)=catalog.tables.get(&read.table)else{return false;};
            let Some(table)=schema.table(&read.table)else{return false;};
            if table.through.is_some()||read.range.is_some()||read.filter.is_some()||read.matching.is_some()||!read.seeks.is_empty(){return false;}
            let prefix=read.keys.iter().take_while(|key|key.column.is_none()).map(|key|match &key.value{
                Expr::Name{name,..} if name=="viewer"=>Some((crate::types::Ty::Principal,false)),
                Expr::Literal{value:crate::ast::Literal::Str(value),..}=>Some((crate::types::Ty::Text(value.chars().count() as u32),true)),
                _=>None,
            }).collect::<Option<Vec<_>>>();
            let Ok(normalized)=super::mixed_keys::read_typed(info,read,catalog,prefix.as_deref())else{return false;};
            let Some(pins)=super::auth_lints::pins(catalog,&normalized)else{return false;};
            if pins.keys().any(|column|table.column_reads.contains_key(column)||table.written_by.get(column).is_some_and(|owner|!owner.audience)){return false;}
            info.indexes.iter().filter(|index|info.total_unique(index)).any(|index|{
                let Some(keys)=index.columns.iter().map(|column|Some(crate::ast::KeyPart{column:Some(column.clone()),value:pins.get(column)?.clone(),site:read.site.clone()})).collect::<Option<Vec<_>>>()else{return false;};
                let mut point=read.clone();point.keys=keys;point.index=None;
                super::program::maintain_types::program_absence_is_raw(schema,&point)
            })
        },
        Expr::Unary{op,value,..} if op=="not"=>raw_monotone(catalog,schema,value,!positive),
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>raw_monotone(catalog,schema,left,positive)&&raw_monotone(catalog,schema,right,positive),
        _=>super::maintain_authorization::raw_witness_monotone(schema,value,positive),
    }
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn substituted_helper_output_is_bounded_before_allocation(){
        let expression=(0..30).fold("exists roles[viewer]".to_string(),|inner,_|format!("duplicate({inner})"));
        let source=format!("fn duplicate(value:bool): value or value\nquery guarded():\n  require {expression} else NO\n  return null\n");
        let (doc,errors)=crate::parse_document("guard.q",&source);assert!(errors.is_empty());
        let Stmt::Require{condition,..}=&doc.programs[0].body[0]else{panic!()};let condition=condition.clone();
        let catalog=Catalog::build(vec![doc],&mut Vec::new());
        assert!(expand(&catalog,&condition).is_none());
    }
}
