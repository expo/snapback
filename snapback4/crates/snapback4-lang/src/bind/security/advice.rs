//! Structural, invariant-free advice. These are review questions, never refusals.
// @ref LLP 3000.036.004#123-actionable-authority-advice — authority edges matter independently of declared intent.
use super::*;
use ast::{Expr,ProgramKind,WriteOp};
use snapback4_core::schema::{Table,ColumnType};
fn note(code:&str,message:String,rewrite:&str,site:&Site)->Diagnostic{Diagnostic::new(site,code,message,rewrite).guide("security")}
fn leaves(rule:&RuleExpr)->Vec<&RuleExpr>{match rule{RuleExpr::And(xs)=>xs.iter().flat_map(leaves).collect(),r=>vec![r]}}
fn global(bound:&Bound,rule:&RuleExpr)->bool{match rule{
    RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,v)|v)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
    RuleExpr::And(xs)=>xs.iter().all(|r|global(bound,r)),
    RuleExpr::Allow|RuleExpr::Public{..}=>true,_=>false,
}}
fn role_names(bound:&Bound,rule:&RuleExpr)->Vec<String>{
    leaves(rule).into_iter().filter_map(|r|if let RuleExpr::Exists{table,index,key,equalities,..}=r{
        let columns=super::privilege::role_columns(bound,table);
        let roles=super::privilege::probe_pairs(bound,table,index,key,equalities).into_iter().filter_map(|(c,v)|match v{RuleTerm::Literal(snapback4_core::Value::String(s)) if columns.contains(&c)=>Some(format!("{table}.{c}='{s}'")),_=>None}).collect::<Vec<_>>();
        (!roles.is_empty()).then(||roles.join(" and "))
    }else{None}).collect()
}
pub(super) fn read_notes(bound:&Bound,name:&str,t:&Table)->Vec<Diagnostic>{
    let mut out=Vec::new();
    for branch in t.rules.read.disjuncts(){
        // Judge the complete branch. A roster atom inside a conjunction with an
        // owner/status restriction is not by itself a roster-wide admission.
        if branch.is_uniformly_readable(){
            out.push(note("N_BROAD_READ",format!("{name}.read: branch `{}` lets every signed-in user read every row",branch.quarry()),"restrict this branch to the intended role and row relationship, or confirm that every row is public to signed-in users",&Site::default()));break;
        }
        if let RuleExpr::Exists{table:roster,..}=branch&&super::privilege::membership_probe(bound,branch,roster){
            let roles=bound.schema.table(roster).map(|_|super::privilege::role_columns(bound,roster).iter().flat_map(|c|super::privilege::role_values(bound,roster,c)).collect::<Vec<_>>()).unwrap_or_default();
            out.push(note("N_BROAD_READ",format!("{name}.read: branch `{}` lets every {roster} member{} read every row, regardless of ownership",branch.quarry(),if roles.is_empty(){String::new()}else{format!(" (roles: {})",roles.join(", "))}),"restrict this branch to the intended roles and row relationship; a query filter cannot narrow the table rule",&Site::default()));break;
        }
    }
    let media=t.columns.values().any(ColumnType::contains_asset)||bound.invariants.iter().any(|i|i.table==name&&i.target=="read"&&i.column.is_some());
    let roles=super::privilege::role_columns(bound,name);
    let states=t.columns.iter().filter(|(c,k)|!roles.contains(*c)&&matches!(k.required(),ColumnType::Enum{..})&&!t.constraints.iter().any(|k|matches!(k,snapback4_core::schema::Constraint::Immutable{fields} if fields.contains(*c)))).map(|(c,_)|c.as_str()).collect::<Vec<_>>();
    let lifecycle=!states.is_empty();
    // A competing row relationship gives a concrete privacy boundary. Do not
    // infer private payload from a column's spelling.
    fn row_relationship(rule:&RuleExpr)->bool{match rule{
        RuleExpr::Eq(a,b)=>matches!(a,RuleTerm::Field(_)|RuleTerm::Reference{..}|RuleTerm::ReferenceChain{..})&&*b==RuleTerm::Viewer||matches!(b,RuleTerm::Field(_)|RuleTerm::Reference{..}|RuleTerm::ReferenceChain{..})&&*a==RuleTerm::Viewer,
        RuleExpr::Exists{key,equalities,..}=>{
            let terms=key.iter().chain(equalities.iter().map(|(_,v)|v)).collect::<Vec<_>>();
            terms.iter().any(|v|matches!(v,RuleTerm::Field(_)|RuleTerm::Reference{..}|RuleTerm::ReferenceChain{..}))&&terms.contains(&&RuleTerm::Viewer)
        },RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().any(row_relationship),_=>false,
    }}
    let relationship=row_relationship(&t.rules.read);
    for branch in t.rules.read.disjuncts(){
        let roles=role_names(bound,branch);if roles.is_empty(){continue;}
        let row_filter=leaves(branch).iter().any(|r|matches!(r,RuleExpr::Eq(RuleTerm::Field(_),RuleTerm::Literal(_))|RuleExpr::Ne(RuleTerm::Field(_),RuleTerm::Literal(_))|RuleExpr::Eq(RuleTerm::Literal(_),RuleTerm::Field(_))|RuleExpr::Ne(RuleTerm::Literal(_),RuleTerm::Field(_))));
        let existing_shape=media&&row_filter&&leaves(branch).iter().all(|r|match r{RuleExpr::Exists{..}=>global(bound,r),RuleExpr::Eq(RuleTerm::Field(_),RuleTerm::Literal(_))|RuleExpr::Ne(RuleTerm::Field(_),RuleTerm::Literal(_))|RuleExpr::Eq(RuleTerm::Literal(_),RuleTerm::Field(_))|RuleExpr::Ne(RuleTerm::Literal(_),RuleTerm::Field(_))=>true,_=>false});
        // Complete row creators are deliberately excluded from this new advice:
        // their global row authority already establishes the broad audience.
        let pure=lifecycle&&relationship&&global(bound,branch)&&kernel::implies(branch,&t.rules.insert)!=Ok(true);
        if existing_shape||pure{
            out.push(note("N_ROLE_WIDE_READ",format!("{name}.read: {} branch `{}` reads {} including every unprotected column",roles.join(", "),branch.quarry(),if pure{format!("every value of [{}]",states.join(", "))}else{"every matching row".into()}),"conjoin the allowed lifecycle states and resource relationship in this table rule, or publish a board/projection table; protect private columns separately",&Site::default()));
        }
    }
    // Explicit column gates are deliberate privacy boundaries. Creating a row
    // does not establish permanent access to its protected columns. Group the
    // same declared gate to ask one factual question, rather than one per role.
    if lifecycle&&relationship{
        let mut groups=BTreeMap::<String,(Vec<String>,BTreeSet<String>)>::new();
        for (column,rule) in &t.column_reads{
            let effective=super::columns::admission(t,Some(column));
            let admitted=rule.disjuncts().iter().filter(|b|global(bound,b)&&kernel::implies(b,&effective)==Ok(true)).flat_map(|b|role_names(bound,b)).collect::<BTreeSet<_>>();
            if admitted.is_empty(){continue;}
            let group=groups.entry(rule.quarry()).or_default();group.0.push(column.clone());group.1.extend(admitted);
        }
        for (_,(columns,roles)) in groups{
            out.push(note("N_ROLE_WIDE_READ",format!("{name}.{} read: protected columns [{}] admit {} for every value of [{}]; should these roles read all rows or only the spec's resource relationships and states?",columns[0],columns.join(", "),roles.into_iter().collect::<Vec<_>>().join(", "),states.join(", ")),"conjoin the intended resource relationship and lifecycle states in the column read rule; keep the spec's per-column intent independent",&Site::default()));
        }
    }
    out
}
fn trusted_by(bound:&Bound,table:&str,column:&str)->Option<String>{
    for (name,t) in bound.schema.visible_tables(){for rule in super::columns::rules(t){
        fn finds(bound:&Bound,r:&RuleExpr,table:&str,column:&str)->bool{match r{
            RuleExpr::Exists{table:target,index,key,equalities,..} if target==table=>{
                let pairs=super::privilege::probe_pairs(bound,target,index,key,equalities);
                pairs.iter().any(|(c,v)|c==column&&*v==RuleTerm::Viewer)&&pairs.iter().any(|(_,v)|matches!(v,RuleTerm::Field(_)))
            },RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().any(|r|finds(bound,r,table,column)),_=>false,
        }}
        if finds(bound,rule,table,column){return Some(name.clone());}
    }}None
}
fn self_only(rule:&RuleExpr,column:&str)->bool{match rule{
    RuleExpr::And(xs)=>xs.iter().all(|r|self_only(r,column)),
    RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,v)|v)).all(|v|matches!(v,RuleTerm::Viewer|RuleTerm::Literal(_))),
    RuleExpr::Eq(a,b)=>{
        let own=|a:&RuleTerm,b:&RuleTerm|matches!(a,RuleTerm::Field(c)|RuleTerm::NextField(c) if c==column)&&*b==RuleTerm::Viewer||matches!(a,RuleTerm::OldField(c) if c==column)&&*b==RuleTerm::Literal(snapback4_core::Value::Null);
        own(a,b)||own(b,a)
    },RuleExpr::Allow=>true,_=>false,
}}
pub(super) fn source_notes(documents:&[ast::Document],catalog:&Catalog,bound:&Bound)->Vec<Diagnostic>{
    let mut out=super::time_advice::notes(documents,catalog,bound);
    for doc in documents{for p in &doc.programs{if p.kind!=ProgramKind::Mutation{continue;}
        let mut seen=BTreeSet::new();
        for (write,context) in super::authority_walk::writes(catalog,p){
            let Expr::Write{table,fields,op,site,..}=&write else{continue;};
            if !matches!(op,WriteOp::Update|WriteOp::Upsert){continue;}
            let Some(t)=bound.schema.table(table)else{continue;};
            let requirements=catalog.tables.get(table).map(|info|super::operation::requirements(catalog,info,&context)).unwrap_or_default();
            for f in fields{
                if !matches!(t.columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Principal))||!matches!(&f.value,Some(Expr::Name{name,..}) if name=="viewer"){continue;}
                let Some(target)=trusted_by(bound,table,&f.name)else{continue;};
                // A scoped invitation, resource-owner check or other independent
                // evidence makes this narrow pattern inconclusive, not risky.
                let evidence=context.body.iter().filter_map(|s|if let ast::Stmt::Require{condition,..}=s{Some(condition)}else{None}).any(|condition|{
                    let mut condition=condition.clone();let mut found=false;
                    super::super::intent_walk::expression(&mut condition,&mut |e|match e{
                        Expr::Member{name,..} if name!=&f.name=>found=true,
                        Expr::Exists{read,..} if read.keys.iter().any(|k|!matches!(&k.value,Expr::Name{name,..} if name=="viewer")&&!matches!(k.value,Expr::Literal{..}))=>found=true,_=>{}
                    });found
                });
                if evidence{continue;}
                let gates=match op{WriteOp::Update|WriteOp::Upsert=>vec![t.update_rule_judged().into_owned()],_=>Vec::new()};
                if gates.iter().any(|g|g.disjuncts().iter().any(|b|self_only(b,&f.name)&&requirements.iter().all(|r|self_only(r,&f.name))))&&seen.insert((table.clone(),f.name.clone())){
                    let roles=requirements.iter().flat_map(|r|role_names(bound,r)).collect::<Vec<_>>();
                    out.push(note("N_SELF_CLAIMED_RELATIONSHIP",format!("{}: {} can claim {table}.{} for themselves; {target} rules trust that relationship",p.name,if roles.is_empty(){"a caller".into()}else{roles.join(" or ")},f.name),"require an invitation or approval from the existing resource owner before setting this relationship; an unclaimed slot and a caller role do not establish it",site));
                }
            }
        }
    }}out
}
