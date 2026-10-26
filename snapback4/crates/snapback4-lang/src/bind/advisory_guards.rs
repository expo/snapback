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
    expression(catalog,value,&mut Vec::new(),&mut 4096)
        .then(||super::security::authority_walk::returned(catalog,value,0))
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
