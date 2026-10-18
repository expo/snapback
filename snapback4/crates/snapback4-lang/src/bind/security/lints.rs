//! Advice identifies a risk shape; it never supplies a proof assumption.
// @ref LLP 3000.036.004#6-bakeoff-repairs — current roles, grant writers, required evidence and refusal oracles.
use super::*;
use crate::ast::{Expr,Stmt,ProgramKind};
fn rule_parts(rule:&RuleExpr)->Vec<&RuleExpr>{match rule{RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().flat_map(rule_parts).collect(),RuleExpr::Not(x)=>rule_parts(x),r=>vec![r]}}
fn role_test(rule:&RuleExpr)->bool {rule_parts(rule).iter().any(|r|matches!(r,RuleExpr::Exists{key,equalities,..} if key.iter().any(|t|matches!(t,RuleTerm::Viewer))&&equalities.iter().any(|(_,t)|matches!(t,RuleTerm::Literal(_)))))}
fn reader_columns(rule:&RuleExpr)->BTreeSet<String>{rule_parts(rule).into_iter().filter_map(|r|match r{RuleExpr::Eq(RuleTerm::Field(f),RuleTerm::Viewer)|RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Field(f))=>Some(f.clone()),_=>None}).collect()}
fn note(notes:&mut Vec<Diagnostic>,site:&Site,code:&str,message:String,rewrite:&str){notes.push(Diagnostic::new(site,code,message,rewrite).guide("security"));}
pub(super) fn notes(bound:&Bound,exposures:&[Exposure])->Vec<Diagnostic>{
    let mut notes=Vec::new();
    for (name,t) in bound.schema.visible_tables(){
        if t.rules.read.is_uniformly_readable(){note(&mut notes,&Site::default(),"N_BROAD_READ",format!("{name} is readable by every signed-in user: {}",t.rules.read.quarry()),"confirm the spec permits these columns and declare read intent; snapback4 audit lists inherited grants and their writers");}
        if let RuleExpr::Exists{table:roster,key,equalities,..}=&t.rules.read
            && equalities.is_empty()&&key.iter().any(|k|matches!(k,RuleTerm::Viewer)) {
            note(&mut notes,&Site::default(),"N_BROAD_READ",format!("{name} is readable by any signed-in user with a matching {roster} row; no particular role or row ownership is required"),"confirm that every roster member should see all these columns; declare intent from the privacy spec and inspect audit");
        }
        for (column,kind) in &t.columns {
            use snapback4_core::schema::ColumnType as C;
            if kind.contains_asset() && (kind.is_optional() || matches!(kind.required(),C::List{..}|C::ListRange{min:0,..})) {
                note(&mut notes,&Site::default(),"N_OPTIONAL_EVIDENCE",format!("{name}.{column} permits omitted or empty media evidence"),"if the spec requires evidence, declare a required image/file or [image] 1..N; otherwise retain optionality deliberately (guide security)");
            }
        }
        for leaf in rule_parts(&t.rules.insert) {
            if let RuleExpr::Created {table:parent,..}=leaf
                && bound.schema.table(parent).is_some_and(|p| p.rules.insert.disjuncts().iter().any(|r| matches!(r,RuleExpr::Allow|RuleExpr::Eq(RuleTerm::Field(_),RuleTerm::Viewer)|RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Field(_)))))
                && bound.schema.tables.values().any(|other| [&other.rules.read,&other.rules.insert,&other.rules.update,&other.rules.delete].iter().any(|r| rule_parts(r).iter().any(|r|matches!(r,RuleExpr::Exists{table,key,equalities,..} if table==name&&matches!(key.as_slice(),[RuleTerm::Viewer])&&equalities.is_empty())))) {
                note(&mut notes,&Site::default(),"N_VACUOUS_RULE",format!("{name}: `created {parent}` can bootstrap authority trusted globally by a viewer-only probe; a caller may create their own global administrator grant"),"provision global authority only through an operator/service seat or existing authorized admin; group creation must scope every later grant to that group (guide deploy, first-admin setup)");
            }
        }
        for branch in t.rules.read.disjuncts(){
            if role_test(branch){continue;}
            for dep in kernel::dependencies(branch){if let Some(g)=bound.schema.table(&dep) && (role_test(&g.rules.insert)||role_test(&g.rules.update)){
                note(&mut notes,&Site::default(),"N_GRANT_OUTLIVES_ROLE",format!("{name}: `{}` trusts {dep} grants, but this branch does not re-check the reader's current role; existing grants can survive a role change",branch.quarry()),"conjoin the current reader-role probe with the grant branch, or revoke derived grants transactionally on every role change; see guide security");
            }}
            if !reader_columns(branch).is_empty() && (role_test(&t.rules.insert)||role_test(&t.rules.update)){note(&mut notes,&Site::default(),"N_GRANT_OUTLIVES_ROLE",format!("{name}: stored principal {} remains a reader independently of a later role change",branch.quarry()),"if access requires a current role, conjoin that role in the read branch; historic attribution alone is not current authority");}
        }
    }
    // Inspect original syntax for argument flow and distinct authored codes.
    // Keeping lints outside Bound.notes preserves the compiler's existing
    // diagnostic contract; check/audit expose this security advice separately.
    let _=exposures;
    notes
}
pub(super) fn source_notes(sources:&[(String,String)],bound:&Bound)->Vec<Diagnostic>{
    let mut out=Vec::new();
    for (file,source) in sources{
        let (doc,_)=crate::parse_document(file,source);
        for p in &doc.programs {
            let mut body=p.prelude.clone();body.extend(p.body.clone());
            let mut seen=BTreeSet::new();
            let mut guarded=BTreeSet::new();
            for statement in p.prelude.iter().chain(&p.body) {
                if let Stmt::Require{condition,..}=statement {
                    let mut condition=condition.clone();
                    super::super::intent_walk::expression(&mut condition,&mut |e|if let Expr::Exists{read,..}=e {
                        for key in &read.keys {if let Expr::Name{name,..}=&key.value {guarded.insert(name.clone());}}
                    });
                }
            }
            super::super::intent_walk::statements(&mut body,&mut |e|{
                let Expr::Write{table,fields,site,..}=e else{return};
                let Some(t)=bound.schema.table(table)else{return};
                let readers=reader_columns(&t.rules.read);
                for f in fields.iter(){
                    let arg=f.value.as_ref().and_then(|e|if let Expr::Name{name,..}=e{Some(name.as_str())}else{None}).unwrap_or(f.name.as_str());
                    if !guarded.contains(arg)&&readers.contains(&f.name)&&p.args.iter().any(|a|a.name==arg)&&seen.insert((table.clone(),f.name.clone())){
                        note(&mut out,site,"N_ARGUMENT_GRANT",format!("{} writes argument {arg} straight into reader-grant column {table}.{}",p.name,f.name),"require the chosen principal's current role and relationship before granting access; caller authority alone does not validate the recipient");
                    }

                }
            });
            // Distinct absent and denial codes disclose logical existence to
            // callers admitted by a broader table rule, even without payload.
            fn refusals(body:&[Stmt],absent:&mut Option<String>,codes:&mut Vec<(Site,String)>){for s in body{match s{
                Stmt::Bind{value:Expr::Assert{code,..},..}=>*absent=Some(code.clone()),
                Stmt::Require{site,code,..}=>if let Some(a)=absent.as_ref()&&a!=code{codes.push((site.clone(),format!("lookup absence {a}, later denial {code}")));},
                Stmt::If{then_body,else_body,..}=>{refusals(then_body,&mut absent.clone(),codes);refusals(else_body,&mut absent.clone(),codes);},
                Stmt::For{body,..}|Stmt::As{body,..}=>refusals(body,&mut absent.clone(),codes),_=>{}}}}
            let mut codes=Vec::new();refusals(&p.body,&mut None,&mut codes);
            for (site,why) in codes.into_iter().take(1){note(&mut out,&site,"N_EXISTENCE_ORACLE",format!("{}: {why}; callers admitted by the read rule can distinguish these outcomes",p.name),"use the same absence/denial code and message when existence is private, or tighten the table read rule; the read gate already hides rows it denies");}
            if p.kind==ProgramKind::Job {
                fn guards(body:&[Stmt],out:&mut Vec<Expr>){for s in body {match s{
                    Stmt::Require{condition,..}=>out.push(condition.clone()),
                    Stmt::If{condition,then_body,else_body,..}=>{out.push(condition.clone());guards(then_body,out);guards(else_body,out);},
                    Stmt::For{body,..}|Stmt::As{body,..}=>guards(body,out),_=>{}
                }}}
                let mut job_guards=Vec::new();guards(&p.body,&mut job_guards);
                let clock=job_guards.iter().any(|g|{let mut g=g.clone();let mut found=false;super::super::intent_walk::expression(&mut g,&mut |e|if matches!(e,Expr::Name{name,..} if name=="now"){found=true;});found});
                if !clock{continue;}
                let mut writes=BTreeSet::new();let mut b=p.body.clone();
                super::super::intent_walk::statements(&mut b,&mut |e|if let Expr::Write{table,fields,..}=e&&fields.iter().any(|f|f.name=="status"){writes.insert(table.clone());});
                for table in writes {for m in doc.programs.iter().filter(|m|m.kind==ProgramKind::Mutation){
                    let mut aliases=BTreeSet::new();
                    for s in &m.body{if let Stmt::Bind{names,value,..}=s{
                        let v=if let Expr::Assert{value,..}=value{value.as_ref()}else{value};
                        if matches!(v,Expr::Read(r) if r.table==table){aliases.extend(names.clone());}
                    }}
                    let mut checks=Vec::new();guards(&m.body,&mut checks);let(mut status,mut now)=(false,false);
                    for mut c in checks{super::super::intent_walk::expression(&mut c,&mut |e|match e{
                        Expr::Name{name,..} if name=="now"=>now=true,
                        Expr::Member{base,name,..} if name=="status"&&matches!(base.as_ref(),Expr::Name{name,..} if aliases.contains(name))=>status=true,_=>{}
                    });}
                    let already_named = bound.notes.iter().any(|n| n.code == "N_SWEEP_DEADLINE" && n.site == m.site
                        && n.message.contains(&format!("column {table}.status)"))
                        && n.message.contains(&format!("scheduled job {} ",p.name)));
                    if status&&!now&&!already_named{note(&mut out,&m.site,"N_SWEEP_ONLY_DEADLINE",format!("{} gates on {table}.status while clock job {} changes that status; writes can run between the deadline and sweep",m.name,p.name),"enforce the deadline against server now in the mutation too; a sweep cleans up state but does not enforce an exact deadline");}
                }}
            }
        }
    }
    out
}
