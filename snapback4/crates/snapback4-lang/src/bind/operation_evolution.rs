//! @ref LLP 3000.000.000.000#11-old-client-operation-contracts-rel5 — operation evolution lowers into the existing shared IR.
use crate::{ast::*, diag::{Diagnostic, Fallible, type_error, unknown}};
use snapback4_core::{Schema, ir::ArgType, value::Value};

fn modified(args: &[ArgDecl]) -> bool { args.iter().any(|a|a.default.is_some() || a.alias.is_some() || a.deprecated) }
fn invalid(site: &crate::Site) -> Diagnostic {
    type_error(site,"argument aliases/defaults/deprecation are supported on non-native queries and mutations only","keep ordinary parameters here; use a query/mutation for a release-compatible wrapper").guide("deploy")
}
pub(super) fn expand(documents: &mut [Document], diagnostics: &mut Vec<Diagnostic>) {
    for doc in documents {
        for p in &doc.programs {
            if (p.native || p.kind==ProgramKind::Job) && modified(&p.args) {diagnostics.push(invalid(&p.site));}
        }
        for a in &doc.actions {if modified(&a.args) {diagnostics.push(invalid(&a.site));}}
        for f in &doc.functions {if modified(&f.args) {diagnostics.push(invalid(&f.site));}}
        let authored=doc.programs.clone();
        for (name,target,site) in &doc.aliases {
            let Some(p)=authored.iter().find(|p|p.name==*target && !p.native && p.kind!=ProgramKind::Job) else {
                diagnostics.push(unknown(site,format!("alias {name} needs an authored query/mutation target {target} in this module"),"target a non-native query or mutation; aliases cannot chain").guide("deploy"));continue;
            };
            let mut alias=p.clone();alias.name=name.clone();alias.site=site.clone();doc.programs.push(alias);
        }
    }
}

pub(super) fn argument(arg: &ArgDecl, schema: &Schema) -> Fallible<(ArgType,Option<Value>)> {
    if arg.alias.is_some() && arg.deprecated {
        return Err(type_error(&arg.site,format!("argument {} cannot be both an alias target and deprecated",arg.name),"keep the canonical argument with `alias oldName`; remove deprecated").guide("deploy"));
    }
    let kind=crate::types::scalar_to_arg(&arg.type_);
    let bad=||type_error(&arg.site,format!("default for {} must be a fitting non-null scalar literal and cannot combine with deprecated",arg.name),"use default <literal>, or mark the unused parameter deprecated").guide("deploy");
    let value=if let Some(expr)=&arg.default {
        if arg.deprecated {return Err(bad());}
        let value=match expr {
            Expr::Literal {value:Literal::Bool(v),..}=>Value::Bool(*v),
            Expr::Literal {value:Literal::Str(v),..}=>match arg.type_.kind {TypeKind::Ref{..}|TypeKind::Id|TypeKind::Principal=>Value::Id(v.clone()),_=>Value::String(v.clone())},
            Expr::Literal {value:Literal::Number(v),..}=>Value::Int(v.parse().map_err(|_|bad())?),
            Expr::Unary {op,value,..} if op=="-" => match value.as_ref() {Expr::Literal{value:Literal::Number(v),..}=>Value::Int(format!("-{v}").parse().map_err(|_|bad())?),_=>return Err(bad())},
            _=>return Err(bad()),
        };
        snapback4_core::engine::validate::validate_arg(schema,&kind,&value,&arg.name).map_err(|_|bad())?;
        Some(value)
    } else {None};
    let wire=if arg.default.is_some() || arg.deprecated {
        match kind {ArgType::Optional(_)=>kind,_=>ArgType::Optional(Box::new(kind))}
    } else {kind};
    Ok((wire,value))
}
