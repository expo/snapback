//! Attribution must observe exactly the original verdict, probes and deadline.
use super::rules::{self, Probe};
use crate::{RuntimeError, Value, schema::{RuleExpr, RuleTerm}, value::object};

#[derive(Default, Debug)]
struct Witness {
    calls: Vec<String>, expiry: Option<i64>, unknown: bool,
}
impl Probe for Witness {
    fn replace_expiry(&mut self, value: Option<i64>) -> Option<i64> { std::mem::replace(&mut self.expiry,value) }
    fn take_unknown(&mut self) -> bool { std::mem::take(&mut self.unknown) }
    fn exists(&mut self, _: &str, _: &str, key: &[Value], _: &[(String,Value)]) -> Result<bool, RuntimeError> {
        let key=key[0].as_str()?.to_owned(); self.calls.push(key.clone());
        match key.as_str() {
            "finite" => { self.expiry=Some(self.expiry.map_or(100,|e|e.min(100))); Ok(true) },
            "unknown" => { self.unknown=true; Ok(false) },
            "no" => Ok(false), _ => Ok(true),
        }
    }
    fn created(&mut self, _: &str, _: &str, _: &[Value]) -> bool { false }
}
#[test]
fn update_attribution_preserves_three_valued_timelines_and_probe_order() {
    let base=RuleExpr::Exists { table:"members".into(),index:"byId".into(),key:vec![RuleTerm::Field("gate".into())],equalities:vec![],provenance:crate::ir::KeyProvenance::Shape };
    for rule in [base.clone(),RuleExpr::Or(vec![base.clone(),RuleExpr::Deny]),RuleExpr::Not(Box::new(base))] {
        for old_key in ["finite","yes","no","unknown"] {
            for next_key in ["finite","yes","no","unknown"] {
                let old=object([("gate",Value::Id(old_key.into()))]);
                let next=object([("gate",Value::Id(next_key.into()))]);
                let judged=rule.old_and_next();
                let mut original=Witness {expiry:Some(500),..Default::default()};
                let expected=rules::evaluate(&judged,"alice",Some(&old),&next,false,&mut original).unwrap();
                let mut observed=Witness {expiry:Some(500),..Default::default()};
                let (actual,_)=rules::evaluate_update(&judged,true,"alice",Some(&old),&next,&mut observed).unwrap();
                assert_eq!((actual,&observed.calls,observed.expiry),(expected,&original.calls,original.expiry),"{old_key}/{next_key}: {rule:?}");
            }
        }
    }
}
#[test]
fn failed_old_next_and_named_transition_are_distinguished_without_extra_work() {
    let rule=RuleExpr::Eq(RuleTerm::Field("state".into()),RuleTerm::Literal(Value::String("pending".into())));
    for (old,next,image) in [("pending","withdrawn","next image"),("withdrawn","pending","old image")] {
        let old=object([("state",Value::String(old.into()))]); let next=object([("state",Value::String(next.into()))]);
        let mut probe=Witness::default();
        let (allowed,actual)=rules::evaluate_update(&rule.old_and_next(),true,"alice",Some(&old),&next,&mut probe).unwrap();
        assert!(!allowed); assert_eq!(actual,image); assert!(probe.calls.is_empty());
    }
    let mut probe=Witness::default();
    assert_eq!(rules::evaluate_update(&RuleExpr::Deny,false,"alice",None,&Value::Null,&mut probe).unwrap().0,false);
}
