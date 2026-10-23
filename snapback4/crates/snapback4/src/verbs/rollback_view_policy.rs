//! Compare aligned policy meaning without confusing a key with its label.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — compiled key meaning and every guard operand survive a visible rollback.
use snapback4_core::{Schema, schema::{Constraint, Horizon, RuleExpr, Sync}};

pub(super) struct Policies<'a> {
    view: &'a Schema,
    current: &'a Schema,
}

impl<'a> Policies<'a> {
    pub(super) fn new(view: &'a Schema, current: &'a Schema) -> Self { Self { view, current } }

    fn index(&self, table: &str, view: &str, current: &str) -> bool {
        match (self.view.table(table).and_then(|t|t.indexes.get(view)),
            self.current.table(table).and_then(|t|t.indexes.get(current))) {
            (Some(view),Some(current))=>view==current,
            _=>false,
        }
    }

    pub(super) fn constraint(&self, view: &Constraint, current: &Constraint) -> bool {
        match (view,current) {
            (Constraint::FinalExistsOnInsert{table:a,index:ai,key:ak},
                Constraint::FinalExistsOnInsert{table:b,index:bi,key:bk})=>
                a==b&&ak==bk&&self.index(a,ai,bi),
            _=>view==current,
        }
    }

    pub(super) fn rule(&self, view: &RuleExpr, current: &RuleExpr) -> bool {
        use RuleExpr::*;
        match (view,current) {
            (Exists{table:a,index:ai,key:ak,provenance:ap,equalities:ae},
                Exists{table:b,index:bi,key:bk,provenance:bp,equalities:be}) |
            (Created{table:a,index:ai,key:ak,provenance:ap,equalities:ae},
                Created{table:b,index:bi,key:bk,provenance:bp,equalities:be})=>
                a==b&&ak==bk&&ap==bp&&ae==be&&self.index(a,ai,bi),
            (And(a),And(b))|(Or(a),Or(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|self.rule(a,b)),
            (Not(a),Not(b))=>self.rule(a,b),
            _=>view==current,
        }
    }

    pub(super) fn optional_rule(&self, view: Option<&RuleExpr>, current: Option<&RuleExpr>) -> bool {
        match (view,current) { (Some(a),Some(b))=>self.rule(a,b),(None,None)=>true,_=>false }
    }

    fn horizon(&self, table: &str, view: Option<&Horizon>, current: Option<&Horizon>) -> bool {
        match (view,current) {
            (Some(a),Some(b))=>a.last==b.last&&self.index(table,&a.by,&b.by),
            (None,None)=>true,
            _=>false,
        }
    }

    pub(super) fn sync(&self, table: &str, view: Option<&Sync>, current: Option<&Sync>) -> bool {
        match (view,current) {
            (Some(a),Some(b))=>a.audience==b.audience&&self.horizon(table,a.horizon.as_ref(),b.horizon.as_ref())
                &&a.also.len()==b.also.len()&&a.also.iter().zip(&b.also).all(|(a,b)|
                    a.audience==b.audience&&self.horizon(table,a.horizon.as_ref(),b.horizon.as_ref())),
            (None,None)=>true,
            _=>false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback4_core::{Value, ir::KeyProvenance, schema::{Audience, RuleTerm}};
    fn schema(name: &str, key: &str) -> Schema {
        let source=format!("table target:\n  code: text <=20\n  other: text <=20\n  unique {name}: {key}\n  public\n  online only\n");
        let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);bound.schema
    }
    fn probe(name: &str) -> RuleExpr {
        RuleExpr::Exists{table:"target".into(),index:name.into(),key:vec![RuleTerm::Field("value".into())],provenance:KeyProvenance::Shape,equalities:Vec::new()}
    }
    #[test]
    fn equivalent_labels_keep_all_probe_operands_and_provenance() {
        let view=schema("oldKey","code");let current=schema("newKey","code");let policy=Policies::new(&view,&current);
        let a=probe("oldKey");let b=probe("newKey");assert!(policy.rule(&a,&b));
        let mut changed=b.clone();if let RuleExpr::Exists{key,..}=&mut changed{*key=vec![RuleTerm::Field("different".into())];}assert!(!policy.rule(&a,&changed));
        let mut changed=b.clone();if let RuleExpr::Exists{provenance,..}=&mut changed{*provenance=KeyProvenance::Const;}assert!(!policy.rule(&a,&changed));
        let mut changed=b.clone();if let RuleExpr::Exists{equalities,..}=&mut changed{equalities.push(("code".into(),RuleTerm::Literal(Value::String("a".into()))));}assert!(!policy.rule(&a,&changed));
        let created=match b.clone(){RuleExpr::Exists{table,index,key,provenance,equalities}=>RuleExpr::Created{table,index,key,provenance,equalities},_=>unreachable!()};assert!(!policy.rule(&a,&created));
        let ca=Constraint::FinalExistsOnInsert{table:"target".into(),index:"oldKey".into(),key:vec![RuleTerm::Field("value".into())]};
        let cb=Constraint::FinalExistsOnInsert{table:"target".into(),index:"newKey".into(),key:vec![RuleTerm::Field("value".into())]};assert!(policy.constraint(&ca,&cb));
        assert!(policy.rule(&RuleExpr::Not(Box::new(a.clone())),&RuleExpr::Not(Box::new(b.clone()))));
        assert!(!policy.rule(&RuleExpr::And(vec![a]),&RuleExpr::Or(vec![b])));
    }
    #[test]
    fn a_shared_label_cannot_hide_a_different_key_or_uniqueness() {
        let view=schema("key","code");let mut current=schema("key","other");
        assert!(!Policies::new(&view,&current).rule(&probe("key"),&probe("key")));
        current=schema("key","code");current.tables.get_mut("target").unwrap().indexes.get_mut("key").unwrap().unique=false;
        assert!(!Policies::new(&view,&current).rule(&probe("key"),&probe("key")));
        assert!(!Policies::new(&view,&current).rule(&probe("missing"),&probe("missing")));
    }
    #[test]
    fn a_window_keeps_its_audience_limit_and_complete_key() {
        let view=schema("oldKey","code");let current=schema("newKey","code");let policy=Policies::new(&view,&current);
        let a=Sync::single(Audience::Public,Some(Horizon{last:10,by:"oldKey".into()}));
        let mut b=Sync::single(Audience::Public,Some(Horizon{last:10,by:"newKey".into()}));
        assert!(policy.sync("target",Some(&a),Some(&b)));
        b.horizon.as_mut().unwrap().last=20;assert!(!policy.sync("target",Some(&a),Some(&b)));
        b.horizon.as_mut().unwrap().last=10;b.audience=Audience::Column("code".into());assert!(!policy.sync("target",Some(&a),Some(&b)));
        assert!(!policy.sync("target",Some(&a),None));
    }
}
