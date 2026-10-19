//! Finite three-valued implication, deliberately independent of database facts.
// @ref LLP 3000.036.004#3-sound-proof-boundary — impossible valuations overapproximate all snapshots.
use snapback4_core::schema::{RuleExpr as R, RuleTerm as T};
use std::collections::BTreeSet;

pub const MAX_ATOMS: usize = 10;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Truth { Yes, No, Unknown }
impl Truth {
    fn not(self) -> Self { match self { Self::Yes => Self::No, Self::No => Self::Yes, Self::Unknown => Self::Unknown } }
    fn combine(self, other: Self, and: bool) -> Self {
        let decisive = if and { Self::No } else { Self::Yes };
        if self == decisive || other == decisive { decisive }
        else if self == Self::Unknown || other == Self::Unknown { Self::Unknown }
        else { decisive.not() }
    }
}
#[derive(Clone, Debug)]
enum Formula { Constant(Truth), Atom(usize), Not(Box<Self>), And(Vec<Self>), Or(Vec<Self>) }
impl Formula {
    fn eval(&self, values: &[Truth]) -> Truth {
        match self {
            Self::Constant(v) => *v, Self::Atom(n) => values[*n], Self::Not(x) => x.eval(values).not(),
            Self::And(xs) => xs.iter().fold(Truth::Yes, |v, x| v.combine(x.eval(values), true)),
            Self::Or(xs) => xs.iter().fold(Truth::No, |v, x| v.combine(x.eval(values), false)),
        }
    }
}
fn term(t: &T) -> T { match t { T::NextField(f) => T::Field(f.clone()), other => other.clone() } }
fn atom(rule: &R) -> String {
    let mut r = rule.clone();
    match &mut r {
        R::Eq(a,b) | R::Compare(_,a,b) => { *a=term(a); *b=term(b); }
        R::Exists { key, equalities, .. } | R::Created { key, equalities, .. } => {
            for t in key { *t=term(t); }
            for (_,t) in equalities.iter_mut() { *t=term(t); }
            equalities.sort_by(|a,b| a.0.cmp(&b.0));
        }
        _ => {}
    }
    if let R::Eq(a,b)=&mut r && serde_json::to_string(a).unwrap()>serde_json::to_string(b).unwrap() { std::mem::swap(a,b); }
    let mut json=serde_json::to_value(&r).unwrap();
    // Provenance controls planning, not rule evaluation. Remove only this
    // leaf's metadata, never a similarly named literal-object field.
    for name in ["Exists","Created"] { if let Some(body)=json.get_mut(name).and_then(serde_json::Value::as_object_mut) { body.remove("provenance"); } }
    json.to_string()
}
fn formula(rule: &R, atoms: &mut Vec<String>, nodes: &mut usize) -> Result<Formula, String> {
    *nodes+=1; if *nodes>1024 { return Err("formula exceeds 1024 nodes".into()); }
    Ok(match rule {
        R::Allow | R::Public {..} => Formula::Constant(Truth::Yes), R::Deny => Formula::Constant(Truth::No),
        R::And(xs) => Formula::And(xs.iter().map(|r| formula(r,atoms,nodes)).collect::<Result<_,_>>()?),
        R::Or(xs) => Formula::Or(xs.iter().map(|r| formula(r,atoms,nodes)).collect::<Result<_,_>>()?),
        R::Not(x) => Formula::Not(Box::new(formula(x,atoms,nodes)?)),
        R::Ne(a,b) => Formula::Not(Box::new(formula(&R::Eq(a.clone(),b.clone()),atoms,nodes)?)),
        R::Eq(T::Literal(a),T::Literal(b)) => Formula::Constant(if a==b {Truth::Yes}else{Truth::No}),
        R::Eq(T::Viewer,T::Viewer) => Formula::Constant(Truth::Yes),
        other => { let key=atom(other); let n=atoms.iter().position(|a| a==&key).unwrap_or_else(|| {atoms.push(key);atoms.len()-1});
            if atoms.len()>MAX_ATOMS {return Err(format!("more than {MAX_ATOMS} independent predicates"));} Formula::Atom(n) }
    })
}
/// `Ok(true)` is a proof; `Ok(false)` is only an abstract countermodel.
/// Neither limit exhaustion nor a countermodel is a concrete refutation.
pub fn implies(admission: &R, policy: &R) -> Result<bool,String> {
    let (mut atoms,mut nodes)=(Vec::new(),0);
    let a=formula(admission,&mut atoms,&mut nodes)?;
    let p=formula(policy,&mut atoms,&mut nodes)?;
    let mut values=vec![Truth::Unknown;atoms.len()];
    for mut n in 0..3usize.pow(atoms.len() as u32) {
        for v in &mut values { *v=match n%3 {0=>Truth::Yes,1=>Truth::No,_=>Truth::Unknown}; n/=3; }
        if a.eval(&values)==Truth::Yes && p.eval(&values)!=Truth::Yes { return Ok(false); }
    }
    Ok(true)
}
pub fn dependencies(rule: &R) -> BTreeSet<String> {
    let mut out=BTreeSet::new();
    match rule {
        R::Exists{table,key,equalities,..}|R::Created{table,key,equalities,..} => {out.insert(table.clone());for term in key.iter().chain(equalities.iter().map(|(_,t)|t)){for (table,_) in term.references(){out.insert(table.into());}}}
        R::And(xs)|R::Or(xs) => for x in xs {out.extend(dependencies(x));}, R::Not(x) => out.extend(dependencies(x)),
        R::Eq(a,b)|R::Ne(a,b)|R::Compare(_,a,b) => for t in [a,b] { for (table,_) in t.references() {out.insert(table.into());} },
        _=>{}
    }
    out
}
#[cfg(test)] mod tests {
    use super::*;
    fn a() -> R { R::Eq(T::Field("owner".into()),T::Viewer) }
    #[test] fn kleene_unknown_is_neither_true_nor_false() {
        assert_eq!(Truth::Unknown.not(),Truth::Unknown);
        assert_eq!(Truth::No.combine(Truth::Unknown,true),Truth::No);
        assert_eq!(Truth::Yes.combine(Truth::Unknown,false),Truth::Yes);
        assert!(!implies(&R::Allow,&R::Or(vec![a(),R::Not(Box::new(a()))])).unwrap());
    }
    #[test] fn no_boolean_assignment_is_a_concrete_refutation() {
        assert!(implies(&R::And(vec![a(),R::Deny]),&R::Deny).unwrap());
        assert!(!implies(&R::Allow,&a()).unwrap());
        assert!(implies(&a(),&R::Eq(T::Viewer,T::Field("owner".into()))).unwrap());
        let xs=(0..11).map(|n|R::Eq(T::Field(format!("f{n}")),T::Viewer)).collect();
        assert!(implies(&R::And(xs),&a()).is_err());
    }
}
