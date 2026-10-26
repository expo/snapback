//! Approval-event markers and edit/version timestamps have different meaning.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — ordinary metadata is not an approval capability.
use super::*;
use snapback4_core::schema::ColumnType as C;
fn word(name:&str)->bool{["approv","authoriz"].iter().any(|part|name.to_lowercase().contains(part))}
fn audit(name:&str,kind:&C)->bool{
    let name=name.to_lowercase().replace('_',"");
    matches!(kind.required(),C::Time)&&["updatedat","changedat","editedat","modifiedat","updatedon","changedon","editedon","modifiedon","updatedtime","changedtime","editedtime","modifiedtime","updatedtimestamp","changedtimestamp","editedtimestamp","modifiedtimestamp"].iter().any(|suffix|name.ends_with(suffix))
}
pub(super) fn evidence(name:&str,kind:&C)->bool{word(name)&&!audit(name,kind)}
pub(crate) fn named(name:&str,kind:&C)->bool{evidence(name,kind)&&matches!(kind.required(),C::Bool|C::Time)}
pub(super) fn columns(_docs:&[ast::Document],_catalog:&Catalog,bound:&Bound)->BTreeSet<(String,String)>{
    bound.schema.visible_tables().flat_map(|(table,t)|t.columns.iter().filter(|(column,kind)|named(column,kind)).map(move |(column,_)|(table.clone(),column.clone()))).collect()
}
