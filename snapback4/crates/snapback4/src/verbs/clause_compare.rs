//! Conservative propositional implication for narration, never admission.
// @ref LLP 3000.000.000#14-wave-14-rollback-narration — implication remains conservative while displayed Boolean grouping stays explicit.
use snapback4_core::schema::RuleExpr;
use snapback4_lang::{ast::{Expr, Literal}, print::expression};
use std::collections::BTreeSet;
#[derive(Clone)]
pub(super) enum Formula { Yes, No, Atom(String), Maybe(String), Not(Box<Formula>), And(Vec<Formula>), Or(Vec<Formula>) }
#[derive(Debug, PartialEq)]
pub(super) enum Change { Same, Tightens, Loosens, Unknown }
#[derive(Clone,Copy,PartialEq)]
enum Truth { Yes, No, Unknown }
impl Truth {
    fn not(self) -> Self { match self { Self::Yes=>Self::No, Self::No=>Self::Yes, Self::Unknown=>Self::Unknown } }
    fn combine(self, other: Self, and: bool) -> Self {
        let decisive=if and { Self::No } else { Self::Yes };
        if self==decisive || other==decisive { decisive }
        else if self==Self::Unknown || other==Self::Unknown { Self::Unknown }
        else { decisive.not() }
    }
}
impl Formula {
    fn atoms(&self, out: &mut BTreeSet<String>, maybe: &mut BTreeSet<String>) {
        match self {
            Self::Atom(a)=>{out.insert(a.clone());},
            Self::Maybe(a)=>{out.insert(a.clone());maybe.insert(a.clone());},
            Self::Not(a)=>a.atoms(out,maybe),
            Self::And(a)|Self::Or(a)=>a.iter().for_each(|a|a.atoms(out,maybe)), _=>()
        }
    }
    fn eval(&self, atoms: &[String], values: &[Truth]) -> Truth {
        match self {
            Self::Yes=>Truth::Yes, Self::No=>Truth::No,
            Self::Atom(a)|Self::Maybe(a)=>values[atoms.binary_search(a).unwrap()],
            Self::Not(a)=>a.eval(atoms,values).not(),
            Self::And(a)=>a.iter().fold(Truth::Yes,|v,a|v.combine(a.eval(atoms,values),true)),
            Self::Or(a)=>a.iter().fold(Truth::No,|v,a|v.combine(a.eval(atoms,values),false)),
        }
    }
}
pub(super) fn compare(old: &Formula, new: &Formula) -> Change {
    let (mut atoms,mut maybe)=(BTreeSet::new(),BTreeSet::new());
    old.atoms(&mut atoms,&mut maybe);new.atoms(&mut atoms,&mut maybe);
    if atoms.len()>12 { return Change::Unknown; }
    let atoms: Vec<_>=atoms.into_iter().collect();
    let radices: Vec<_>=atoms.iter().map(|a|if maybe.contains(a) {3} else {2}).collect();
    let valuations: usize=radices.iter().product();
    if valuations>4096 {return Change::Unknown;}
    let (mut old_implies_new,mut new_implies_old)=(true,true);
    for mut code in 0..valuations {
        let values: Vec<_>=radices.iter().map(|radix| {
            let digit=code%radix;code/=radix;
            match digit {0=>Truth::No,1=>Truth::Yes,_=>Truth::Unknown}
        }).collect();
        let (a,b)=(old.eval(&atoms,&values),new.eval(&atoms,&values));
        // Runtime admits only Readable, never Unknown. Preserve that exact cut.
        old_implies_new &= a!=Truth::Yes || b==Truth::Yes;
        new_implies_old &= b!=Truth::Yes || a==Truth::Yes;
    }
    match (old_implies_new,new_implies_old) { (true,true)=>Change::Same,(false,true)=>Change::Tightens,(true,false)=>Change::Loosens,_=>Change::Unknown }
}
/// Canonical rule text keeps Boolean precedence visible even though the stored
/// rule tree no longer retains redundant source parentheses.
pub(super) fn display_rule(value: &RuleExpr) -> String {
    fn render(value: &RuleExpr, parent: u8) -> String {
        let priority=match value {RuleExpr::Or(_)=>1,RuleExpr::And(_)=>2,RuleExpr::Not(_)=>3,_=>4};
        let text=match value {
            RuleExpr::And(parts)=>parts.iter().map(|part|render(part,priority)).collect::<Vec<_>>().join(" and "),
            RuleExpr::Or(parts)=>parts.iter().map(|part|render(part,priority)).collect::<Vec<_>>().join(" or "),
            RuleExpr::Not(part)=>format!("not {}",render(part,priority)),
            other=>other.quarry(),
        };
        if priority<parent {format!("({text})")} else {text}
    }
    render(value,0)
}
fn equality(a: String,b: String, negated: bool, maybe: bool) -> Formula {
    let name = if a <= b { format!("{a}={b}") } else { format!("{b}={a}") };
    let atom = if maybe { Formula::Maybe(name) } else { Formula::Atom(name) };
    if negated { Formula::Not(Box::new(atom)) } else { atom }
}
// Field and NextField load the same next image; OldField remains distinct.
fn term_key(term: &snapback4_core::schema::RuleTerm) -> String {
    use snapback4_core::schema::RuleTerm;
    serde_json::to_string(&match term {RuleTerm::NextField(name)=>RuleTerm::Field(name.clone()),other=>other.clone()}).unwrap()
}
pub(super) fn rule(value: &RuleExpr) -> Formula {
    match value {
        RuleExpr::Allow | RuleExpr::Public { .. } => Formula::Yes, RuleExpr::Deny => Formula::No,
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) => equality(term_key(a),term_key(b),matches!(value,RuleExpr::Ne(..)), a.references().count()>0 || b.references().count()>0),
        RuleExpr::Not(a) => Formula::Not(Box::new(rule(a))), RuleExpr::And(a) => Formula::And(a.iter().map(rule).collect()), RuleExpr::Or(a) => Formula::Or(a.iter().map(rule).collect()),
        RuleExpr::Compare(op,a,b) if a.references().count()==0 && b.references().count()==0 => Formula::Atom(format!("compare:{op:?}:{}:{}",term_key(a),term_key(b))),
        _ => Formula::Maybe(serde_json::to_string(value).unwrap()),
    }
}
/// Compare only leading unconditional argument/viewer/now requirements.
pub(super) fn require(value: &Expr, args: &BTreeSet<String>, stable_probes: bool) -> Option<Formula> {
    fn scalar(e: &Expr, args: &BTreeSet<String>) -> bool {
        match e { Expr::Name { name,.. } => args.contains(name) || matches!(name.as_str(),"viewer" | "now"), Expr::Literal { .. } => true, _ => false }
    }
    Some(match value {
        Expr::Literal { value: Literal::Bool(true),.. } => Formula::Yes,
        Expr::Literal { value: Literal::Bool(false),.. } => Formula::No,
        Expr::Unary { op,value,.. } if op == "not" => Formula::Not(Box::new(require(value,args,stable_probes)?)),
        Expr::Binary { op,left,right,.. } if op == "and" || op == "or" => {
            let parts = vec![require(left,args,stable_probes)?,require(right,args,stable_probes)?];
            if op == "and" { Formula::And(parts) } else { Formula::Or(parts) }
        },
        Expr::Binary { op,left,right,.. } if scalar(left,args) && scalar(right,args) => {
            if matches!(op.as_str(),"=" | "!=") { equality(expression(left),expression(right),op == "!=",false) }
            else { Formula::Atom(expression(value)) }
        },
        Expr::Exists { read,.. } if stable_probes && read.keys.iter().all(|key| scalar(&key.value,args)) => Formula::Atom(expression(value)),
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

#[cfg(test)]
mod unknown_tests {
    use super::*;
    #[test]
    fn reference_unknown_is_not_a_boolean_tautology() {
        let a=Formula::Maybe("reference".into());
        let excluded_middle=Formula::Or(vec![a.clone(),Formula::Not(Box::new(a.clone()))]);
        assert_eq!(compare(&excluded_middle,&Formula::Yes),Change::Loosens);
        assert_eq!(compare(&Formula::Yes,&excluded_middle),Change::Tightens);
        assert_eq!(compare(&a,&Formula::And(vec![a.clone(),Formula::Atom("role".into())])),Change::Tightens);
        let too_many=Formula::And((0..8).map(|i|Formula::Maybe(i.to_string())).collect());
        assert_eq!(compare(&too_many,&Formula::Yes),Change::Unknown);
    }
}
