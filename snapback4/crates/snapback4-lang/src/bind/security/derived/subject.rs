//! Named evidence identifies the subject even when approval only writes a stamp.
// @ref LLP 3000.036.004.000#12-wave-28-inference-and-visible-evidence — a declared subject approval may replace evidence; ordinary setters invalidate it.
use super::*;
pub(super) fn stem(stamp:&str)->String{let stamp=stamp.to_lowercase();["approv","authoriz"].iter().filter_map(|part|stamp.find(part)).min().map(|at|stamp[..at].trim_end_matches('_').to_owned()).unwrap_or_default()}
pub(super) fn same(stem:&str,column:&str)->bool{column.to_lowercase().starts_with(stem)&&column.get(stem.len()..).is_some_and(|tail|tail.is_empty()||tail.starts_with('_')||tail.chars().next().is_some_and(char::is_uppercase))}
pub(super) fn matches(stamp:&str,column:&str,kind:&snapback4_core::schema::ColumnType)->bool{
    let stem=stem(stamp);let matched=same(&stem,column);let column=column.to_lowercase();
    stem.len()>2&&matched&&!["approved","approval","authorized","authorization","approvedat","approvalat","authorizedat","authorizationat","consent","reason","cost","at"].contains(&column[stem.len()..].trim_start_matches('_'))&&kind.contains_asset()
}
pub(super) fn authorized(bound:&Bound,catalog:&Catalog,p:&ast::ProgramDecl,context:&ast::ProgramDecl,table:&str,stamp:&str,column:&str)->bool{
    let stem=stem(stamp);if !matches(stamp,column,&bound.schema.tables[table].columns[column]){return false;}
    let name=&p.name;if !["approve","authorize"].iter().any(|prefix|name.get(..prefix.len()).is_some_and(|head|head.eq_ignore_ascii_case(prefix))&&name.get(prefix.len()..).is_some_and(|act|same(&stem,act.trim_start_matches('_')))){return false;}
    let Some(info)=catalog.tables.get(table)else{return false;};
    let admission=RuleExpr::And(operation::requirements(catalog,info,context).into_iter().filter(operation::safe).chain([bound.schema.tables[table].update_rule_judged().into_owned()]).collect());
    bound.invariants.iter().filter(|inv|inv.table==table&&inv.operation.as_ref().is_some_and(|op|op==&super::super::super::operation_name(std::path::Path::new(&p.site.file).file_stem().and_then(|s|s.to_str()).unwrap_or(&p.site.file),&p.name))).any(|inv|inv.policy.as_ref().is_some_and(|policy|kernel::implies(&RuleExpr::Allow,policy)!=Ok(true)&&kernel::implies(&admission,policy)==Ok(true)))
}

#[cfg(test)]mod tests{use super::*;
#[test]fn qualified_subject_reapproval_uses_the_resolved_operation_identity(){
 let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/wave28/036.q")).replace(": cancelOverdue",": commissions.cancelOverdue");let sources=vec![("commissions.q".into(),source)];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let b=super::super::augmented(&sources,&b);for stamp in ["likenessApproved","likenessApprovedAt"]{assert!(b.security_approval_reissues.contains_key(&("commissions.approveLikenessChange".into(),"figures".into(),stamp.into())),"{:?}",b.security_approval_reissues.keys());}
}
#[test]fn another_approved_act_cannot_borrow_a_subject_prefix(){
 let source="table docs:\n  carPhoto: image <=10000\n  carApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approveCar(doc: docs):\n  update docs[doc] {carApproved:true}\nmutation approveCargo(doc: docs,photo: image <=10000):\n  require viewer = 'service:owner' else NOT_OWNER\n  update docs[doc] {carPhoto:photo}\ninvariant docs.approveCargo only viewer = 'service:owner'\n";let sources=vec![("schema.q".into(),source.into())];let b=super::super::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(!b.security_approval_reissues.contains_key(&("approveCargo".into(),"docs".into(),"carApproved".into())));
}

}
