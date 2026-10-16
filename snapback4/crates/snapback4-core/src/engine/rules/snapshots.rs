//! Server query proofs from readable point snapshots and surviving branches.
//! No stored dependency, copied-field invariant, or new authority is inferred.
use super::*;
use crate::ir::{BinaryOp as B, Stmt, Program, ProgramKind, Read};

#[derive(Clone, PartialEq, Eq)]
enum Formula { Limit, Yes, No, Atom(String), Not(Box<Formula>), And(Box<Formula>, Box<Formula>), Or(Box<Formula>, Box<Formula>) }
use Formula::*;
// Bounded static work: large control formulas decline the proof.
fn size(f: &Formula) -> usize { match f { And(a,b)|Or(a,b)=>1+size(a)+size(b),Not(a)=>1+size(a),_=>1 } }
fn and(a: Formula, b: Formula) -> Formula {
    if a==Limit || b==Limit {return Limit;}
    if a==No || b==No {return No;} if a==Yes {return b;} if b==Yes || a==b {return a;}
    if size(&a)+size(&b)>1024 {return Limit;}
    And(Box::new(a),Box::new(b))
}
fn or(a: Formula, b: Formula) -> Formula {
    if a==Limit || b==Limit {return Limit;}
    if a==Yes || b==Yes {return Yes;} if a==No {return b;} if b==No || a==b {return a;}
    if let (And(p,c),And(q,d))=(&a,&b) && p==q
        && (matches!(c.as_ref(),Not(value) if value==d) || matches!(d.as_ref(),Not(value) if value==c)) {return *p.clone();}
    if size(&a)+size(&b)>1024 {return Limit;}
    Or(Box::new(a),Box::new(b))
}
fn not(a: Formula) -> Formula { match a { Limit=>Limit,Yes=>No,No=>Yes,Not(value)=>*value,other=>Not(Box::new(other)) } }
type Snapshots = BTreeMap<String, Read>;

// @ref LLP 3000.036.002#12 — only a successful readable point and actual
// continuing paths can establish the audience of an uncapped child page.
pub(super) fn decided(schema: &Schema, program: &Program) -> BTreeSet<String> {
    if program.kind != ProgramKind::Query || !stable_body(&program.body) || !crate::ir::write_tables(program).is_empty() { return BTreeSet::new(); }
    let mut counts = BTreeMap::new();
    assignment_counts(&program.body, &mut counts);
    if program.args.keys().any(|name|counts.contains_key(name)) {return BTreeSet::new();}
    if counts.keys().chain(program.args.keys()).any(|name| matches!(name.as_str(),"$filter"|"$project")) { return BTreeSet::new(); }
    let inputs = program.args.keys().filter(|name| !counts.contains_key(*name) && !matches!(name.as_str(),"$filter"|"$project")).cloned().collect();
    let singles = counts.into_iter().filter_map(|(name,count)|(count == 1).then_some(name)).collect();
    let conditions = short_circuit_bindings(&program.body);
    let mut counts = BTreeMap::new(); assignment_counts(&program.body,&mut counts);
    if counts.iter().any(|(name,count)| *count>1 && !conditions.contains_key(name))
        || conditions.values().any(|value| reconstructed_rebound(value,&counts)) { return BTreeSet::new(); }
    let mut proof = Proof { schema, singles, inputs, conditions, sites: BTreeMap::new() };
    proof.body(&program.body, Yes, Snapshots::new());
    proof.sites.into_iter().filter_map(|(site,good)|good.then_some(site)).collect()
}

struct Proof<'a> { schema: &'a Schema, singles: BTreeSet<String>, inputs: BTreeSet<String>, conditions: BTreeMap<String,Expr>, sites: BTreeMap<String,bool> }
impl Proof<'_> {
    fn body(&mut self, body: &[Stmt], mut path: Formula, mut snapshots: Snapshots) -> Formula {
        for stmt in body {
            match stmt {
                Stmt::If { condition, then_body, else_body } => {
                    self.inspect(condition,&path,&snapshots);
                    let temporary = match condition { Expr::Variable(name)=>Some(name),
                        Expr::Unary {op:crate::ir::UnaryOp::Not,value}=>if let Expr::Variable(name)=value.as_ref() {Some(name)} else {None}, _=>None };
                    if temporary.is_some_and(|name| self.conditions.contains_key(name)
                        && then_body.iter().chain(else_body).any(|stmt|matches!(stmt,Stmt::Assign {name:assigned,..} if assigned==name))) {
                        // This is the setup of a reconstructed short circuit, not its
                        // completed value. Its inner work establishes no later facts.
                        for scan in crate::ir::body_read_structure(std::slice::from_ref(stmt)).0 { self.sites.insert(scan.site.clone(),false); }
                        continue;
                    }
                    let test = expression(condition,&snapshots,&self.conditions,32);
                    let yes = self.body(then_body,and(path.clone(),test.clone()),snapshots.clone());
                    let no = self.body(else_body,and(path,not(test)),snapshots.clone());
                    path = or(yes,no);
                }
                Stmt::Require { condition, .. } => {
                    self.inspect(condition,&path,&snapshots);
                    path = and(path,expression(condition,&snapshots,&self.conditions,32));
                }
                Stmt::Return(value) => { self.inspect(value,&path,&snapshots); return No; }
                Stmt::Let { name, value } | Stmt::Const { name, value } => {
                    self.inspect(value,&path,&snapshots);
                    if self.singles.contains(name) && !matches!(name.as_str(),"$filter"|"$project") && let Expr::Get(read) = value
                        && read.key.iter().all(|key| matches!(key,Expr::Literal(_)|Expr::Input(Input::Viewer))
                            || matches!(key,Expr::Variable(name) if self.inputs.contains(name)))
                        && self.ordinary(&read.table) && self.schema.table(&read.table).and_then(|t|t.index(&read.index))
                            .is_some_and(|index|index.unique && index.is_plain() && index.components.len()==read.key.len()) {
                        snapshots.insert(name.clone(),read.clone());
                    }
                }
                Stmt::For { domain, body, .. } => {
                    for scan in crate::ir::body_read_structure(std::slice::from_ref(stmt)).0 {
                        // Loop contexts deliberately confer no snapshot proof.
                        self.sites.insert(scan.site.clone(),false);
                    }
                    let _ = (domain,body);
                }
                _ => for scan in crate::ir::body_read_structure(std::slice::from_ref(stmt)).0 { self.sites.insert(scan.site.clone(),false); },
            }
        }
        path
    }
    fn ordinary(&self, name: &str) -> bool {
        self.schema.table(name).is_some_and(|t| t.through.is_none() && t.ephemeral.is_none()
            && !t.read_lifetime_sensitive() && t.written_by.is_empty() && t.maintained.is_empty()
            && self.schema.maintain_for(name).is_none())
    }
    fn inspect(&mut self, expr: &Expr, path: &Formula, snapshots: &Snapshots) {
        for scan in crate::ir::expression_scans(expr) {
            let good = self.proves(scan,path,snapshots);
            self.sites.entry(scan.site.clone()).and_modify(|old| *old &= good).or_insert(good);
        }
    }
    fn proves(&self, scan: &Scan, path: &Formula, snapshots: &Snapshots) -> bool {
        let Some(table) = self.schema.table(&scan.table) else { return false };
        if !self.ordinary(&scan.table) || table.sync.is_some() || scan.merge_site.is_some() || scan.existence
            || table.index(&scan.index).is_none_or(|index|!index.is_plain()) || snapshots.is_empty() { return false; }
        let pins = scan_pinned(table,scan).into_iter().map(|(k,v)|(k.clone(),v.clone())).collect::<BTreeMap<_,_>>();
        let mut assumptions = path.clone();
        for (name,read) in snapshots {
            let parent = &self.schema.tables[&read.table];
            let columns = parent.columns.keys().map(|field| (field.clone(), crate::ir::field(crate::ir::var(name),field))).collect();
            // A non-null Get was authorized under this exact parent read rule.
            let Some(policy) = rule(&parent.rules.read,&columns,snapshots,false) else { continue };
            assumptions = and(assumptions,or(not(present(name)),policy));
        }
        let Some(goal) = rule(&table.rules.read,&pins,snapshots,true) else { return false };
        entails(&assumptions,&goal)
    }
}
fn present(name: &str) -> Formula { not(compare(&crate::ir::var(name), &Expr::Literal(Value::Null), &Snapshots::new())) }
fn compare(left: &Expr, right: &Expr, snapshots: &Snapshots) -> Formula {
    // Repeated syntax is an identity only for stable lexical values. Reads,
    // fresh ids and builtin evaluation never supply comparison identities.
    if !symbolic(left) || !symbolic(right) { return Limit; }
    let (a,b) = (left.clone(),right.clone());
    if a == b { return Yes; }
    if let (Expr::Literal(a),Expr::Literal(b)) = (&a,&b) { return if a==b {Yes} else {No}; }
    if let Expr::Literal(Value::Bool(value)) = &b {
        return Atom(format!("bool{value}:{a:?}"));
    }
    if matches!(a,Expr::Literal(Value::Bool(_))) { return compare(&b,&a,snapshots); }
    let (mut a,mut b) = (format!("{a:?}"),format!("{b:?}")); if a>b { std::mem::swap(&mut a,&mut b); }
    Atom(format!("eq:{a}:{b}"))
}
fn expression(expr: &Expr, snapshots: &Snapshots, conditions: &BTreeMap<String,Expr>, fuel: usize) -> Formula {
    if fuel==0 { return Atom(format!("opaque:{expr:?}")); }
    let child = |e|expression(e,snapshots,conditions,fuel-1);
    match expr {
        Expr::Literal(Value::Bool(value)) => if *value {Yes} else {No},
        Expr::Binary {op:B::And,left,right} => and(child(left),child(right)),
        Expr::Binary {op:B::Or,left,right} => or(child(left),child(right)),
        Expr::Binary {op:B::Eq,left,right} => compare(left,right,snapshots),
        Expr::Binary {op:B::Ne,left,right} => not(compare(left,right,snapshots)),
        Expr::Unary {op:crate::ir::UnaryOp::Not,value} => not(child(value)),
        Expr::Variable(name) if conditions.contains_key(name) => child(&conditions[name]),
        other => compare(other,&Expr::Literal(Value::Bool(true)),snapshots),
    }
}
fn term(term: &RuleTerm, pins: &BTreeMap<String,Expr>) -> Option<Expr> {
    match term { RuleTerm::Viewer=>Some(Expr::Input(Input::Viewer)),RuleTerm::Literal(v)=>Some(Expr::Literal(v.clone())),RuleTerm::Field(f)=>pins.get(f).cloned(),_=>None }
}
fn rule(rule: &RuleExpr, pins: &BTreeMap<String,Expr>, snapshots: &Snapshots, goal: bool) -> Option<Formula> {
    Some(match rule {
        RuleExpr::Allow|RuleExpr::Public {..}=>Yes, RuleExpr::Deny=>No,
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) => match (term(a,pins),term(b,pins)) {
            (Some(a),Some(b)) => { let value=compare(&a,&b,snapshots); if matches!(rule,RuleExpr::Ne(..)) {not(value)} else {value} },
            _ if goal => No, _ => return None,
        },
        RuleExpr::And(items)=>items.iter().try_fold(Yes,|a,b|Some(and(a,self::rule(b,pins,snapshots,goal)?)))?,
        RuleExpr::Or(items)=>items.iter().try_fold(No,|a,b|Some(or(a,self::rule(b,pins,snapshots,goal)?)))?,
        RuleExpr::Exists {table,index,key,equalities,..} if goal => {
            let Some(key)=key.iter().map(|t|term(t,pins)).collect::<Option<Vec<_>>>() else { return Some(No) };
            let mut result=No;
            for (name,read) in snapshots {
                if &read.table!=table || &read.index!=index || read.key.len()!=key.len()
                    || !read.key.iter().zip(&key).all(|(a,b)|a==b || (read.index=="byId" && read.key.len()==1
                        && matches!(b,Expr::Field {base,name:field} if field=="id" && matches!(base.as_ref(),Expr::Variable(variable) if variable==name)))) { continue; }
                let mut witness=present(name);
                for (column,value) in equalities {
                    let Some(value)=term(value,pins) else {return Some(No)};
                    witness=and(witness,compare(&crate::ir::field(crate::ir::var(name),column),&value,snapshots));
                }
                result=or(result,witness);
            }
            result
        }
        // Unknown parent-policy probes or negative child evidence stay outside this proof.
        _=>return None,
    })
}
fn entails(have: &Formula, need: &Formula) -> bool {
    if *have == Limit || *need == Limit { return false; }
    fn atoms(f: &Formula, out: &mut BTreeSet<String>) { match f { Atom(a)=>{out.insert(a.clone());},Not(a)=>atoms(a,out),And(a,b)|Or(a,b)=>{atoms(a,out);atoms(b,out);},_=>{} } }
    fn eval(f:&Formula, atoms:&[String], mask:u32)->bool { match f {
        Yes=>true,No|Limit=>false,Atom(a)=>mask&(1<<atoms.binary_search(a).unwrap())!=0,
        Not(a)=>!eval(a,atoms,mask),And(a,b)=>eval(a,atoms,mask)&&eval(b,atoms,mask),Or(a,b)=>eval(a,atoms,mask)||eval(b,atoms,mask),
    } }
    let mut names=BTreeSet::new();atoms(have,&mut names);atoms(need,&mut names);
    if names.len()>12 {return false;}
    let names=names.into_iter().collect::<Vec<_>>();
    let mut inhabited=false;
    for mask in 0..1u32<<names.len() {
        if eval(have,&names,mask) {
            inhabited=true;
            if !eval(need,&names,mask) {return false;}
        }
    }
    inhabited
}

// Expression blocks and pair-return sinks can assign enclosing locals. They
// must not evade the once-bound capture census, even in an untaken branch.
fn stable_body(body: &[Stmt]) -> bool {
    body.iter().all(|stmt| match stmt {
        Stmt::Let {value,..}|Stmt::Const {value,..}|Stmt::Assign {value,..}|Stmt::Return(value)=>stable_expr(value),
        Stmt::Require {condition,..}=>stable_expr(condition),
        Stmt::If {condition,then_body,else_body}=>stable_expr(condition)&&stable_body(then_body)&&stable_body(else_body),
        _=>false,
    })
}
fn stable_expr(expr:&Expr)->bool {
    match expr {
        Expr::Literal(_)|Expr::Variable(_)|Expr::Input(Input::Viewer|Input::Now|Input::ReadTime)=>true,
        Expr::Input(Input::NewId)=>false,
        Expr::Field {base,..}|Expr::Unary {value:base,..}=>stable_expr(base),
        Expr::Binary {left,right,..}=>stable_expr(left)&&stable_expr(right),
        Expr::Array(values)=>values.iter().all(stable_expr),
        Expr::Object(fields)=>fields.values().all(stable_expr),
        Expr::Shape {base,fields}=>stable_expr(base)&&fields.values().all(stable_expr),
        Expr::Get(read)|Expr::Exists(read)=>read.key.iter().all(stable_expr),
        Expr::Builtin {builtin:crate::ir::Builtin::Divmod {..},..}=>false,
        #[cfg(feature="sqlite")]
        Expr::Builtin {builtin:crate::ir::Builtin::JobAs|crate::ir::Builtin::JobQuery {..},..}=>false,
        Expr::Builtin {args,..}=>args.iter().all(stable_expr),
        Expr::Scan(scan)=>scan.prefix.iter().all(|key|key.scalar().is_some_and(stable_expr))
            && scan.after.as_deref().is_none_or(stable_expr)&&scan.before.as_deref().is_none_or(stable_expr)
            && scan.range.is_none()&&scan.filter.as_deref().is_none_or(stable_expr),
        Expr::Block {..}|Expr::Merge(_)=>false,
    }
}

fn symbolic(expr:&Expr)->bool {
    match expr {
        Expr::Literal(_)|Expr::Variable(_)|Expr::Input(Input::Viewer|Input::Now|Input::ReadTime)=>true,
        Expr::Field {base,..}|Expr::Unary {value:base,..}=>symbolic(base),
        Expr::Binary {left,right,..}=>symbolic(left)&&symbolic(right),
        Expr::Array(items)=>items.iter().all(symbolic),
        Expr::Object(fields)=>fields.values().all(symbolic),
        _=>false,
    }
}
// Reconstructed conditions may depend only on once-bound values, never on
// the previous/future value of themselves or another assigned temporary.
fn reconstructed_rebound(expr:&Expr,counts:&BTreeMap<String,usize>)->bool {
    match expr {
        Expr::Variable(name)=>counts.get(name).is_some_and(|count|*count>1),
        Expr::Field {base,..}|Expr::Unary {value:base,..}=>reconstructed_rebound(base,counts),
        Expr::Binary {left,right,..}=>reconstructed_rebound(left,counts)||reconstructed_rebound(right,counts),
        Expr::Literal(_)|Expr::Input(_)=>false,
        _=>true,
    }
}
