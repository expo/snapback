//! Compare final-existence obligations in declared row/column identity space.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — spelling-only changes must not trigger a view.
use std::collections::{BTreeMap, BTreeSet};
use snapback4_core::schema::{Constraint, RuleTerm, Schema};
use crate::parser;

#[derive(Default)]
struct Identities {
    tables: BTreeMap<String, String>,
    columns: BTreeMap<String, BTreeMap<String, String>>,
}
impl Identities {
    fn table(&self, name: &str) -> String {self.tables.get(name).cloned().unwrap_or_else(||name.into())}
    fn column(&self, table: &str, name: &str) -> String {
        self.columns.get(table).and_then(|c|c.get(name)).cloned().unwrap_or_else(||name.into())
    }
    fn term(&self, source: &str, term: &RuleTerm) -> RuleTerm {
        match term {
            RuleTerm::Field(c)=>RuleTerm::Field(self.column(source,c)),
            RuleTerm::OldField(c)=>RuleTerm::OldField(self.column(source,c)),
            RuleTerm::NextField(c)=>RuleTerm::NextField(self.column(source,c)),
            RuleTerm::Reference{table,column,field,old}=>RuleTerm::Reference{
                table:self.table(table),column:self.column(source,column),field:self.column(table,field),old:*old},
            RuleTerm::ReferenceChain{column,hops,old}=>RuleTerm::ReferenceChain{
                column:self.column(source,column),old:*old,hops:hops.iter().map(|h|snapback4_core::schema::RuleHop{
                    table:self.table(&h.table),field:self.column(&h.table,&h.field)}).collect()},
            RuleTerm::Viewer|RuleTerm::Literal(_)=>term.clone(),
        }
    }
    fn signature(&self,schema:&Schema,source:&str,constraint:&Constraint)->Option<(String,Vec<String>,Vec<RuleTerm>)> {
        let Constraint::FinalExistsOnInsert{table,index,key}=constraint else{return None};
        let index=schema.table(table)?.index(index)?;
        if !index.is_plain(){return None;}
        Some((self.table(table),index.columns().iter().map(|c|self.column(table,c)).collect(),
            key.iter().map(|t|self.term(source,t)).collect()))
    }
}

pub(super) fn relaxed(target:&[(String,String)],current:&[(String,String)])->bool {
    let old=target.iter().flat_map(|(f,t)|parser::parse_document(f,t).0.tables).collect::<Vec<_>>();
    if !old.iter().any(|t|!t.final_exists.is_empty()){return false;}
    let next=current.iter().flat_map(|(f,t)|parser::parse_document(f,t).0.tables).collect::<Vec<_>>();
    let (before,after)=(crate::compile(target),crate::compile(current));
    if !before.diagnostics.is_empty()||!after.diagnostics.is_empty(){return true;}
    let mut identities=Identities::default();
    let mut pairs=Vec::new();
    for prior in &old {
        let Some(now)=next.iter().find(|n|n.name==prior.name||n.renamed_from.as_ref()==Some(&prior.name)||prior.renamed_from.as_ref()==Some(&n.name))else{continue};
        identities.tables.insert(now.name.clone(),prior.name.clone());
        let mut columns=BTreeMap::new();
        for c in &prior.columns {
            if let Some(n)=now.columns.iter().find(|n|n.name==c.name||n.renamed_from.as_ref()==Some(&c.name)||c.renamed_from.as_ref()==Some(&n.name)) {
                columns.insert(n.name.clone(),c.name.clone());
            }
        }
        if now.columns.iter().map(|c|columns.get(&c.name).unwrap_or(&c.name)).collect::<BTreeSet<_>>().len()!=now.columns.len(){return true;}
        identities.columns.insert(now.name.clone(),columns);
        pairs.push((prior.name.as_str(),now.name.as_str()));
    }
    // Never let two independent current identities collapse to one old name.
    if next.iter().map(|t|identities.table(&t.name)).collect::<BTreeSet<_>>().len()!=next.len(){return true;}
    let unchanged=Identities::default();
    for (prior,now) in pairs {
        let (Some(old_table),Some(new_table))=(before.schema.table(prior),after.schema.table(now))else{return true};
        for constraint in &old_table.constraints {
            if !matches!(constraint,Constraint::FinalExistsOnInsert{..}){continue;}
            let Some(expected)=unchanged.signature(&before.schema,prior,constraint)else{return true};
            if !new_table.constraints.iter().any(|c|identities.signature(&after.schema,now,c).as_ref()==Some(&expected)){return true;}
        }
    }
    false
}
