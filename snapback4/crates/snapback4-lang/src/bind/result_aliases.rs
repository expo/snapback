//! Result aliases lower to ordinary, metered shapes: no storage alias or alternate runtime.
// @ref LLP 3000.000.000.003#2-frozen-result-fields — an alias copies an authorized returned field, with its omission/null semantics.
use crate::{ast::{self, Document, Expr, ShapeField, Stmt}, diag::{Diagnostic, type_error}};
use std::collections::BTreeSet;

pub(super) fn lower(documents: &mut [Document], diagnostics: &mut Vec<Diagnostic>) {
    for doc in documents {
        let mut names = BTreeSet::new();
        for (operation, old, current, site) in &doc.result_aliases {
            if old == current || !names.insert((operation, old)) {
                diagnostics.push(type_error(site, "result aliases need distinct, unique old field names", "alias result list.oldName = currentName"));
            }
            if !doc.programs.iter().any(|p| &p.name == operation && !p.native && matches!(p.kind, ast::ProgramKind::Query | ast::ProgramKind::Mutation)) {
                diagnostics.push(type_error(site, format!("result alias needs a non-native query or mutation {operation} in this module"), "name the declared endpoint; operation aliases inherit its result"));
            }
        }
        for program in &mut doc.programs {
            let aliases = doc.result_aliases.iter().filter(|(name,_,_,_)| name == &program.name).collect::<Vec<_>>();
            if aliases.is_empty() { continue; }
            fn walk(body: &mut [Stmt], aliases: &[&(String,String,String,crate::Site)], completes: bool) -> usize {
                let mut shaped=0;
                let count=body.len();
                for (i,stmt) in body.iter_mut().enumerate() {
                    let is_return=matches!(stmt,Stmt::Return{..});
                    match stmt {
                        Stmt::Return{value,..} | Stmt::Expr{value,..} if is_return || (completes && i+1==count) => {
                            if matches!(value,Expr::Literal{value:ast::Literal::Null,..}) { continue; }
                            shaped+=1;
                            let site=value.site().clone();
                            let mut fields=vec![ShapeField::Spread{site:site.clone()}];
                            for (_,old,current,alias_site) in aliases {
                                fields.push(ShapeField::Field{name:old.clone(),value:Expr::Member{base:Box::new(Expr::Focal{site:alias_site.clone()}),name:current.clone(),site:alias_site.clone()},site:alias_site.clone()});
                            }
                            *value=Expr::Shape{base:Box::new(value.clone()),fields,site};
                        }
                        Stmt::If{then_body,else_body,..}=>{shaped+=walk(then_body,aliases,false);shaped+=walk(else_body,aliases,false);}
                        Stmt::For{body,..}|Stmt::As{body,..}=>shaped+=walk(body,aliases,false),
                        _=>()
                    }
                }
                shaped
            }
            if walk(&mut program.body,&aliases,true)==0 {
                diagnostics.push(type_error(&aliases[0].3,"result alias needs a returned row, object or page","return the current field on a non-null result"));
            }
        }
    }
}
