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
                let expected=rules::evaluate_reference(&judged,"alice",Some(&old),&next,&mut original).unwrap();
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

#[test]
fn real_runner_matches_explicit_old_next_rules_at_meter_and_physical_boundaries() {
    use super::{runner::Runner, authorized_scan::AUTHORIZATION_WALK_LIMIT, refusal_trace::RefusalTrace};
    use crate::{Context, Schema, meter::{Ceilings,Cut,Meter}, rows::{MemoryRows,Rows}, schema::Effect};
    let source="table grants:\n  until: time ?\n  expire at .until\n  public\n  online only\ntable notes:\n  gate: grants\n  read <- allow\n  update <- exists grants[.gate]\n  online only\n";
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let schema: Schema=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    for (old_key,next_key,now) in [("g","g",100),("g","missing",100),("missing","g",100),("g","g",500)] {
        for spent in [0,AUTHORIZATION_WALK_LIMIT-1,AUTHORIZATION_WALK_LIMIT] {
            for probes in [1,2,3] {
                let mut results=Vec::new();
                for named in [false,true] {
                    let mut schema=schema.clone();
                    if named {
                        schema.tables.get_mut("notes").unwrap().rules.update=schema.tables["notes"].rules.update.old_and_next();
                        schema.tables.get_mut("notes").unwrap().update_transition=true;
                    }
                    let rows=MemoryRows::default();
                    rows.put("grants",&schema.tables["grants"],&object([("id",Value::Id("g".into())),("until",Value::Int(500))]),None).unwrap();
                    let trace=RefusalTrace::default();
                    let mut r=Runner::new(&rows,&schema,Context::new("alice",Default::default()).at(now).with_refusal_trace(trace.clone()),Meter::new(Ceilings {rule_probes:probes,..Default::default()},Cut::Abort),0);
                    // Consume the original shared physical allowance, without changing
                    // public logical work. Both old/next probes then share its tail.
                    r.prepaid_witnesses(|r,a| {
                        for _ in 0..spent { r.tx.get(a,"grants","g")?; }
                        Ok(())
                    }).unwrap();
                    r.next_expiry=super::expiry::Expiry::from(Some(900));
                    let scope=r.next_expiry.scope();
                    let old=object([("id",Value::Id("n".into())),("gate",Value::Id(old_key.into()))]);
                    let next=object([("id",Value::Id("n".into())),("gate",Value::Id(next_key.into()))]);
                    let result=r.check_rule("notes",Effect::Update,Some(&old),&next).map_err(|e|e.code());
                    scope.emit();
                    if probes==1 { assert_eq!(result,Err("E_BOUND".into())); }
                    if spent==0 && probes>=2 && old_key=="g" && next_key=="g" && now==100 {
                        assert_eq!(result,Ok(true)); assert_eq!(r.meter.used.rule_probes,2); assert_eq!(r.next_expiry.get(),Some(500));
                    }
                    if spent==AUTHORIZATION_WALK_LIMIT && probes>=2 && now==100 {
                        assert_eq!(result,Err("E_RULE".into()));
                    }
                    results.push((result,r.meter.used,r.next_expiry.get(),r.tx.remaining()));
                    if let Some(cause)=trace.take() {
                        if cause.clause=="update rule" && named { assert!(cause.phase.contains("named transition"),"{cause:?}"); }
                    }
                }
                assert_eq!(results[0],results[1],"old={old_key} next={next_key} now={now} spent={spent} probes={probes}");
            }
        }
    }
}
