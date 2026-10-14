//! Conservative propositional implication for narration, never admission.
// @ref LLP 3000.000.000#12-wave-12-clause-comparison — uncertainty stays a warning.
use snapback4_core::schema::RuleExpr;
use snapback4_lang::{ast::{Expr, Literal}, print::expression};
use std::collections::BTreeSet;
#[derive(Clone)]
pub(super) enum Formula { Yes, No, Atom(String), Not(Box<Formula>), And(Vec<Formula>), Or(Vec<Formula>) }
#[derive(Debug, PartialEq)]
pub(super) enum Change { Same, Tightens, Loosens, Unknown }
impl Formula {
    fn atoms(&self, out: &mut BTreeSet<String>) {
        match self { Self::Atom(a) => { out.insert(a.clone()); }, Self::Not(a) => a.atoms(out), Self::And(a) | Self::Or(a) => a.iter().for_each(|a| a.atoms(out)), _ => () }
    }
    fn eval(&self, atoms: &[String], bits: usize) -> bool {
        match self {
            Self::Yes => true, Self::No => false, Self::Atom(a) => bits & (1 << atoms.binary_search(a).unwrap()) != 0,
            Self::Not(a) => !a.eval(atoms, bits), Self::And(a) => a.iter().all(|a| a.eval(atoms, bits)), Self::Or(a) => a.iter().any(|a| a.eval(atoms, bits)),
        }
    }
}
pub(super) fn compare(old: &Formula, new: &Formula) -> Change {
    let mut atoms = BTreeSet::new(); old.atoms(&mut atoms); new.atoms(&mut atoms);
    if atoms.len() > 12 { return Change::Unknown; }
    let atoms: Vec<_> = atoms.into_iter().collect();
    let (mut old_implies_new, mut new_implies_old) = (true, true);
    for bits in 0..1 << atoms.len() {
        let (a,b) = (old.eval(&atoms,bits),new.eval(&atoms,bits));
        old_implies_new &= !a || b; new_implies_old &= !b || a;
    }
    match (old_implies_new,new_implies_old) { (true,true) => Change::Same, (false,true) => Change::Tightens, (true,false) => Change::Loosens, _ => Change::Unknown }
}
fn equality(a: String,b: String, negated: bool) -> Formula {
    let name = if a <= b { format!("{a}={b}") } else { format!("{b}={a}") };
    let atom = Formula::Atom(name);
    if negated { Formula::Not(Box::new(atom)) } else { atom }
}
pub(super) fn rule(value: &RuleExpr) -> Formula {
    match value {
        RuleExpr::Allow | RuleExpr::Public { .. } => Formula::Yes, RuleExpr::Deny => Formula::No,
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) => equality(serde_json::to_string(a).unwrap(),serde_json::to_string(b).unwrap(),matches!(value,RuleExpr::Ne(..))),
        RuleExpr::Not(a) => Formula::Not(Box::new(rule(a))), RuleExpr::And(a) => Formula::And(a.iter().map(rule).collect()), RuleExpr::Or(a) => Formula::Or(a.iter().map(rule).collect()),
        _ => Formula::Atom(serde_json::to_string(value).unwrap()),
    }
}
/// Compare only leading unconditional argument/viewer/now requirements.
pub(super) fn require(value: &Expr, args: &BTreeSet<String>) -> Option<Formula> {
    fn scalar(e: &Expr, args: &BTreeSet<String>) -> bool {
        match e { Expr::Name { name,.. } => args.contains(name) || matches!(name.as_str(),"viewer" | "now"), Expr::Literal { .. } => true, _ => false }
    }
    Some(match value {
        Expr::Literal { value: Literal::Bool(true),.. } => Formula::Yes,
        Expr::Literal { value: Literal::Bool(false),.. } => Formula::No,
        Expr::Unary { op,value,.. } if op == "not" => Formula::Not(Box::new(require(value,args)?)),
        Expr::Binary { op,left,right,.. } if op == "and" || op == "or" => {
            let parts = vec![require(left,args)?,require(right,args)?];
            if op == "and" { Formula::And(parts) } else { Formula::Or(parts) }
        },
        Expr::Binary { op,left,right,.. } if scalar(left,args) && scalar(right,args) => {
            if matches!(op.as_str(),"=" | "!=") { equality(expression(left),expression(right),op == "!=") }
            else { Formula::Atom(expression(value)) }
        },
        Expr::Name { .. } if scalar(value,args) => Formula::Atom(expression(value)),
        _ => return None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn implication_handles_reordering_complements_and_uncertainty() {
        let a=Formula::Atom("a".into()); let b=Formula::Atom("b".into());
        assert_eq!(compare(&a,&Formula::And(vec![a.clone(),b.clone()])),Change::Tightens);
        assert_eq!(compare(&a,&Formula::Or(vec![a.clone(),b.clone()])),Change::Loosens);
        assert_eq!(compare(&Formula::And(vec![a.clone(),b.clone()]),&Formula::And(vec![b.clone(),a.clone()])),Change::Same);
        assert_eq!(compare(&a,&b),Change::Unknown);
        assert_eq!(compare(&Formula::Yes,&Formula::Or(vec![a.clone(),Formula::Not(Box::new(a))])),Change::Same);
        let many=Formula::And((0..13).map(|i|Formula::Atom(i.to_string())).collect());
        assert_eq!(compare(&many,&Formula::Yes),Change::Unknown);
    }
}
