//! Audience helpers lower before any planner or authority analysis.
// @ref LLP 3000.000.000.001#12-wave-24-loop-repairs-dx7 — bounded hygienic expansion keeps the existing rule grammar.
use crate::{ast::*, diag::{Diagnostic, Fallible, Site}, types::Ty};
use std::collections::BTreeMap;

fn refused(site: &Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_RULE_OPERATOR", message,
        "use an expression-bodied audience helper over typed rule terms and unique exists probes; put clock, arithmetic and effects in the mutation").guide("rules")
}

pub(super) fn expand(documents: &mut [Document], diagnostics: &mut Vec<Diagnostic>) {
    let functions: BTreeMap<_,_> = documents.iter().flat_map(|d|d.functions.iter()).map(|f|(f.name.clone(),f.clone())).collect();
    let columns: BTreeMap<_,BTreeMap<_,_>> = documents.iter().flat_map(|d|&d.tables)
        .map(|t|(t.name.clone(),t.columns.iter().map(|c|(c.name.clone(),Ty::from_scalar(&c.type_))).collect())).collect();
    for document in documents {
        for table in &mut document.tables {
            let name = table.name.clone();
            for rule in &mut table.rules {
                if let Err(error) = expand_value(&mut rule.value,&name,&rule.bindings,&functions,&columns,&mut Vec::new(),&mut 4096) { diagnostics.push(error); }
            }
            for column in &mut table.columns {
                if let Some(value) = &mut column.read {
                    if let Err(error) = expand_value(value,&name,&[],&functions,&columns,&mut Vec::new(),&mut 4096) { diagnostics.push(error); }
                }
            }
            for (_,rule) in &mut table.column_reads {
                if let Err(error) = expand_value(&mut rule.value,&name,&[],&functions,&columns,&mut Vec::new(),&mut 4096) { diagnostics.push(error); }
            }
        }
    }
}

fn term_type(value: &Expr, table: &str, images: &[String], columns: &BTreeMap<String,BTreeMap<String,Ty>>) -> Option<Ty> {
    match value {
        Expr::Name {name,..} if name == "viewer" => Some(Ty::Principal),
        Expr::Literal {value,..} => Some(match value {
            Literal::Bool(_) => Ty::Bool, Literal::Number(_) => Ty::Int,
            Literal::Str(text) => Ty::Text(text.chars().count().try_into().unwrap_or(u32::MAX)), Literal::Null => Ty::Null,
        }),
        Expr::Member {base,name,..} => {
            let target = match base.as_ref() {
                Expr::Focal {..} => table.to_owned(),
                Expr::Name {name,..} if images.contains(name) => table.to_owned(),
                other => match term_type(other,table,images,columns)?.required() { Ty::Ref(target) => target, _ => return None },
            };
            if name == "id" { Some(Ty::Ref(target)) } else { columns.get(&target)?.get(name).cloned() }
        }
        _ => None,
    }
}
fn expand_value(value: &mut Expr, table: &str, images: &[String], functions: &BTreeMap<String,FunctionDecl>, columns: &BTreeMap<String,BTreeMap<String,Ty>>, stack: &mut Vec<String>, fuel: &mut usize) -> Fallible<()> {
    let mut error = None;
    super::intent_walk::expression(value,&mut |node| {
        if error.is_some() { return; }
        if *fuel == 0 { error = Some(refused(node.site(),"rule helper expansion exceeds 4096 syntax nodes; simplify the predicate")); return; }
        *fuel -= 1;
        let Expr::Call {name,args,site} = node else { return; };
        let Some(function) = functions.get(name) else { return; };
        if stack.len() >= 8 || stack.contains(name) { error=Some(refused(site,format!("recursive or more than eight nested rule helpers at {name}"))); return; }
        if args.len() != function.args.len() { error=Some(refused(site,format!("rule helper {name} takes {} arguments, received {}",function.args.len(),args.len()))); return; }
        let mut substitutions = BTreeMap::new();
        for (param,arg) in function.args.iter().zip(args.iter()) {
            if ["viewer","allow","deny","public","true","false","now"].contains(&param.name.as_str()) {
                error=Some(refused(&param.site,"rule helper parameters cannot shadow viewer, now or rule constants")); return;
            }
            let expected = Ty::from_scalar(&param.type_);
            let literal = matches!(arg,Expr::Literal {value:Literal::Str(_),..}) && matches!(expected.required(),Ty::Principal|Ty::Ref(_)|Ty::Id|Ty::Enum(_));
            if !literal && !term_type(arg,table,images,columns).is_some_and(|actual|actual.assignable_to(&expected)) {
                error=Some(refused(arg.site(),format!("rule helper {name} parameter {} needs {}; pass a compatible column, viewer or literal",param.name,expected.name()))); return;
            }
            if substitutions.insert(param.name.clone(),arg.clone()).is_some() { error=Some(refused(site,format!("duplicate parameter {} in rule helper {name}",param.name))); return; }
        }
        let mut body = match &function.body {
            FunctionBody::Expression(value) => value.clone(),
            FunctionBody::Block(statements) => match statements.as_slice() {
                [Stmt::Return {value,..}] => value.clone(),
                _ => { error=Some(refused(site,format!("rule helper {name} needs one expression or a block with one return; effects and local statements cannot run in a rule"))); return; }
            },
        };
        // Check lexical closure before substitution: caller focal fields are
        // allowed only as explicit arguments, never as accidental captures.
        super::intent_walk::expression(&mut body,&mut |part| {
            if error.is_some() { return; }
            let part_site = part.site().clone();
            match part {
                Expr::Focal {..} => error=Some(refused(&part_site,format!("rule helper {name} cannot capture the caller's focal row; pass the field as a typed argument"))),
                Expr::Name {name:free,..} if free != "viewer" && !["allow","deny","public","true","false"].contains(&free.as_str()) && !substitutions.contains_key(free) => error=Some(refused(&part_site,format!("rule helper {name} has free name {free}; pass it explicitly (clock and caller variables are unavailable)"))),
                _ => {},
            }
        });
        if error.is_some() { return; }
        super::intent_walk::expression(&mut body,&mut |part| {
            if let Expr::Name {name,..}=part && let Some(argument)=substitutions.get(name) { *part=argument.clone(); }
        });
        stack.push(name.clone());
        let result=expand_value(&mut body,table,images,functions,columns,stack,fuel);
        stack.pop();
        match result { Ok(()) => *node=body, Err(why) => error=Some(why) }
    });
    if let Some(error)=error { Err(error) } else { Ok(()) }
}
