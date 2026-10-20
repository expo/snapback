//! Independent security intent and conservative exposure obligations.
// @ref LLP 3000.036.004#3-sound-proof-boundary — a direct-rule theorem never clears an unmodeled path.
use super::{catalog::Catalog, Bound};
use crate::{ast, Diagnostic, Site};
use snapback4_core::schema::{RuleExpr, RuleTerm, Schema, Effect};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
pub mod kernel;
mod audit;
pub mod challenges;
mod lints;
mod operation;
mod concrete;
mod census;
mod observers;
mod temporal;
mod adoption;
mod images;
mod columns;
mod privilege;
mod authority_walk;
pub use audit::{Exposure, Grant};
pub use observers::Obligation;
pub use adoption::{draft, UncoveredExposure};

#[derive(Clone, Debug, Serialize)]
pub struct Invariant {
    pub table: String,
    pub target: String,
    pub column: Option<String>,
    pub predicate: String,
    pub site: Site,
    pub policy: Option<RuleExpr>,
    pub operation: Option<String>,
    pub requirements: Vec<RuleExpr>,
    #[serde(skip)]
    pub syntax: Option<ast::Expr>,
    pub unsupported: Option<String>,
}
impl Invariant {
    pub fn target_label(&self)->String {match &self.column{Some(c)=>format!("{}.{} {}",self.table,c,self.target),None=>format!("{}.{}",self.table,self.target)}}
}
pub(super) fn bind(catalog: &Catalog, diagnostics: &mut Vec<Diagnostic>) -> Vec<Invariant> {
    let mut out=Vec::new();
    for decl in catalog.documents.iter().flat_map(|d| &d.invariants) {
        let Some(info)=catalog.tables.get(&decl.table) else {
            diagnostics.push(Diagnostic::new(&decl.site,"E_SECURITY_TARGET",format!("invariant names unknown table {}",decl.table),"declare the table or correct its name").guide("security")); continue;
        };
        let named_operation=operation::resolve(catalog,decl);
        if (!matches!(decl.target.as_str(),"read"|"insert"|"update"|"delete"|"write"|"always") && named_operation.is_none())
            || decl.column.as_ref().is_some_and(|c|c!="id"&&!info.columns.contains_key(c)) {
            diagnostics.push(Diagnostic::new(&decl.site,"E_SECURITY_TARGET","invariant needs a declared column or table effect","use invariant table.read only <policy>, table.column write only <policy>, or table always <predicate>").guide("security")); continue;
        }
        let effect=match decl.target.as_str(){"insert"=>ast::Effect::Insert,"update"|"write"=>ast::Effect::Update,"delete"=>ast::Effect::Delete,_=>ast::Effect::Read};
        // Independent intent may use authorized reference operands even when a
        // runtime read gate must use captured authority. It never installs a gate.
        let effect=if effect==ast::Effect::Read{ast::Effect::Insert}else{effect};
        let rule=ast::RuleDecl{effect,bindings:Vec::new(),value:decl.value.clone(),site:decl.site.clone()};
        let (policy,unsupported)=match super::schema::bind_rule(catalog,info,&rule) {
            Ok(rule)=>(Some(rule),None),Err(error)=>match temporal::bind(catalog,info,&decl.value) {
                Some(rule) if decl.target=="read" => (Some(rule),None),
                _ => (None,Some(format!("policy outside rule proof fragment: {} ({})",error.message,error.code))),
            },
        };
        let requirements=named_operation.as_ref().map(|(_,p)| operation::requirements(catalog,info,p)).unwrap_or_default();
        out.push(Invariant{operation:named_operation.map(|(name,_)|name),requirements,syntax:Some(decl.value.clone()),table:decl.table.clone(),target:decl.target.clone(),column:decl.column.clone(),predicate:crate::print::expression(&decl.value),site:decl.site.clone(),policy,unsupported});
    }
    out
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all="lowercase")]
pub enum Status { Proved, Refuted, Unproved }
#[derive(Clone, Debug, Serialize)]
pub struct Verdict {
    pub invariant: Invariant,
    pub status: Status,
    pub direct_rule: Status,
    pub paths: Vec<String>,
    pub reasons: Vec<String>,
    pub counterexample: Option<challenges::Counterexample>,
    pub obligations: Vec<Obligation>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub format: u32,
    pub scope: String,
    pub exclusions: Vec<String>,
    pub invariants: Vec<Verdict>,
    pub exposures: Vec<Exposure>,
    pub roles: BTreeMap<String,Vec<String>>,
    pub notes: Vec<Diagnostic>,
    pub uncovered: Vec<UncoveredExposure>,
    pub campaign_coverage: BTreeSet<String>,
}
impl Report {
    pub fn refuted(&self)->bool {self.invariants.iter().any(|v|v.status==Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable()))}
    pub fn text(&self)->String {self.text_with_all(false)}
    pub fn text_with_all(&self,all:bool)->String {
        let mut out=format!("security: {}\n",self.scope);
        for v in &self.invariants {
            if !all&&v.status==Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|!c.reachability.is_reachable()){out.push_str(&format!("  {}: seed/synthetic refutation only (non-failing; --all for details)\n",v.invariant.target_label()));continue;}
            out.push_str(&format!("  {:?}: {}.{} {} — direct rule {:?}\n",v.status,v.invariant.table,format!("{}{}",v.invariant.column.as_ref().map(|c|format!("{c} ")).unwrap_or_default(),v.invariant.target),v.invariant.predicate,v.direct_rule));
            for reason in &v.reasons {out.push_str(&format!("    {reason}\n"));}
            for o in &v.obligations {out.push_str(&format!("    {:?}: {} — {}\n",o.status,o.path,o.reason));if let Some(repair)=&o.repair{out.push_str(&format!("      repair: {repair}\n"));}}
            if let Some(c)=&v.counterexample {out.push_str(&format!("    counterexample {}\n",serde_json::to_string(c).unwrap()));}
        }
        for note in &self.notes {out.push_str(&format!("  {} {}: {}\n    {}\n",note.site,note.code,note.message,note.rewrite));}
        for (role,entries) in &self.roles {
            out.push_str(&format!("role {role} (possible/conditional; row predicates below decide):\n"));
            for entry in entries {out.push_str(&format!("  {entry}\n"));}
        }
        for x in &self.exposures {
            out.push_str(&format!("table {} columns: {}\n",x.table,x.columns.iter().map(|(c,v)|format!("{c} ({v})")).collect::<Vec<_>>().join(", ")));
            for (column,audience) in &x.column_audiences {out.push_str(&format!("  column {column} audience: {audience}\n"));}
            for path in &x.paths {out.push_str(&format!("  {path}\n"));}
            for grant in &x.grants {out.push_str(&format!("  inherited grant {}: {}\n",grant.table,grant.predicate)); for w in &grant.writers {out.push_str(&format!("    writer {w}\n"));}}
        }
        for reason in &self.campaign_coverage{out.push_str(&format!("  campaign not covered: {reason}\n"));}
        out.push_str(&format!("  exclusions: {}\n",self.exclusions.join("; ")));
        out.push_str("exposures without an invariant (conditional role/row coverage; declarations are not proof):\n");
        for x in &self.uncovered {out.push_str(&format!("  {}.{}: {}; rows: {}\n",x.table,x.effect,x.audience,x.row_predicate));}
        if self.uncovered.is_empty(){out.push_str("  none\n");}out
    }
}
fn effect(word:&str)->Effect {match word {"read"=>Effect::Read,"insert"=>Effect::Insert,"update"=>Effect::Update,_=>Effect::Delete}}
fn effects(inv:&Invariant)->Vec<&str> { if inv.operation.is_some(){vec!["insert","update","delete"]}else if inv.target=="write" {vec!["insert","update"]} else {vec![inv.target.as_str()]} }
/// Analyze declarations without using fixtures as proof assumptions.
pub fn analyze(bound:&Bound)->Report {
    let exposures=audit::exposures(bound);
    let mut verdicts=Vec::new();
    for inv in &bound.invariants {
        let table=&bound.schema.tables[&inv.table];
        let mut reasons=Vec::new();let mut direct=Status::Proved;
        if let Some(why)=&inv.unsupported {reasons.push(why.clone());direct=Status::Unproved;}
        else if inv.target=="always" {
            // This narrow theorem holds on every validated committed image,
            // including seed/adoption, with no assumption about a writer.
            let nonnull=match inv.policy.as_ref().unwrap() {
                RuleExpr::Ne(RuleTerm::Field(f),RuleTerm::Literal(snapback4_core::Value::Null))|
                RuleExpr::Ne(RuleTerm::Literal(snapback4_core::Value::Null),RuleTerm::Field(f)) =>
                    table.columns.get(f).is_some_and(|t| !t.is_optional() && !matches!(t,snapback4_core::schema::ColumnType::Json{..}) && !table.engine_field(f)),
                _=>false,
            };
            if !nonnull {direct=Status::Unproved; reasons.push("row assertion is not implied by the implemented required-column theorem; transitions, counts and time require an additional proof".into());}
        } else if inv.operation.is_some() {
            match operation::prove(bound,inv) {Ok(true)=>{},Ok(false)=>{direct=Status::Unproved;reasons.push("operation admission does not imply the policy; an actual operation challenge is required".into());},Err(e)=>{direct=Status::Unproved;reasons.push(e);}}
        } else {
            for word in effects(inv) {
                let admission=if word=="update" {table.update_rule_judged().into_owned()}else if word=="read" {columns::admission(table,inv.column.as_deref())}else{table.rules.for_effect(effect(word)).clone()};
                let implication=if word=="update"{images::update(table,inv.policy.as_ref().unwrap())}else{kernel::implies(&admission,inv.policy.as_ref().unwrap())};
                match implication {
                    Ok(true)=>{},Ok(false)=>{direct=Status::Unproved;reasons.push(format!("{word} admission does not imply intent over independent predicates; a concrete replay is required for refutation"));},
                    Err(why)=>{direct=Status::Unproved;reasons.push(format!("{word}: {why}"));},
                }
                // Update implication judges both images. Only id/explicit
                // immutable local fields have the equal-image substitution;
                // owner-field and implicit writers remain separate blockers.
            }
        }
        reasons.extend(blockers(bound,inv));
        let obligations=observers::obligations(bound,inv);
        for o in &obligations {if o.status!=Status::Proved {reasons.push(format!("{}: {}; {}",o.path,o.reason,o.repair.as_deref().unwrap_or("declare an explicit observer policy")));}}
        let paths=exposures.iter().find(|x|x.table==inv.table).map(|x|x.paths.clone()).unwrap_or_default();
        let status=if direct==Status::Proved && reasons.is_empty(){Status::Proved}else{Status::Unproved};
        verdicts.push(Verdict{invariant:inv.clone(),status,direct_rule:direct,paths,reasons,counterexample:None,obligations});
    }
    let mut notes=lints::notes(bound,&exposures);
    let missing=adoption::missing(bound);
    if !missing.is_empty() {notes.push(Diagnostic::new(&Site::default(),"N_SECURITY_INTENT",format!("{} tables have access rules and no security invariants: {}; declare the spec's privacy rules as invariants (`guide security`)",missing.len(),missing.join(", ")),"review snapback/generated/security-invariants.q.draft against the spec; candidates are never auto-accepted").guide("security"));}
    let roles=audit::roles(&exposures);
    let uncovered=adoption::uncovered(bound,&exposures);
    Report{format:1,scope:"logical row/authority intent; all database snapshots; ordinary authenticated viewers including service seats; explicit unproved paths".into(),
        exclusions:vec!["system-principal trust boundary".into(),"physical timing, examined counts and resource/meter side channels".into(),"offline access may use a snapshot predating server revocation".into()],invariants:verdicts,exposures,roles,notes,uncovered,campaign_coverage:BTreeSet::new()}
}
fn blockers(bound:&Bound,inv:&Invariant)->Vec<String> {
    let schema=&bound.schema;let t=&schema.tables[&inv.table];let mut out=BTreeSet::new();
    if inv.target=="read" && inv.policy.as_ref().is_some_and(|policy|kernel::implies(&RuleExpr::Allow,policy)!=Ok(true)) {
        out.insert("wire sequencing/activity metadata has no logical-existence reduction; direct row-rule proof does not establish whole-protocol noninterference".into());
    }
    if inv.target=="read" {
        if let Some(policy)=&inv.policy {
            let grants=policy.disjuncts().into_iter().filter(|r|!r.any_term(&|term|!matches!(term,RuleTerm::Viewer|RuleTerm::Literal(_)))).cloned().collect::<Vec<_>>();
            let global=RuleExpr::Or(grants);
            if !matches!(t.rules.insert,RuleExpr::Deny) && kernel::implies(&t.rules.insert,&global)!=Ok(true) {
                out.insert("insert/unique/upsert collision outcomes can reveal an existing hidden row; old-row read authorization is not proved by new-image insert authority".into());
            }
            if kernel::implies(&t.update_rule_judged(),&policy.old_and_next())!=Ok(true) && !matches!(t.rules.update,RuleExpr::Deny) {
                out.insert("blind update/upsert outcomes can reveal hidden-target existence; read correspondence is unproved".into());
            }
        }
        if !t.written_by.is_empty(){out.insert("owner-field write outcomes can observe targets outside the row read audience".into());}
    }
    if inv.target=="read" && t.columns.iter().any(|(c,k)| matches!(k.required(),snapback4_core::schema::ColumnType::Ref{..}) && t.on_delete.get(c).copied().unwrap_or(snapback4_core::schema::references::OnDelete::Restrict).acts()) {
        out.insert("parent deletion/referential refusal can observe this child (including default restrict and transitive closures)".into());
    }
    if inv.target=="read" && t.sync.is_some(){out.insert("device read uses a delivered snapshot; current server role at disconnected access is unproved".into());}
    if t.through.is_some(){out.insert("inherited/captured or live-parent authority requires a separate reduction (RULES5 owns live-parent semantics)".into());}
    if !schema.receipts.is_empty() || !schema.timelines.is_empty(){out.insert("receipt/timeline engine-owned paths require a separate reduction; no affected-table inference is assumed".into());}
    if t.is_expiring() && matches!(inv.target.as_str(),"delete"|"write"|"update"|"always"){out.insert("expiry/commit-end retirement can change rows outside ordinary delete rules".into());}
    if t.ephemeral.is_some() || !t.sequences.is_empty(){out.insert("ephemeral/sequence path is outside the current proof reduction".into());}
    if !t.written_by.is_empty() && matches!(inv.target.as_str(),"write"|"update"|"always"){out.insert("owned-field update bypass: table rule alone does not establish field-write authority".into());}
    for (name,other) in &schema.tables {
        if matches!(inv.target.as_str(),"update"|"delete"|"write"|"always") && other.on_delete.values().any(|a|matches!(a,snapback4_core::schema::references::OnDelete::Cascade|snapback4_core::schema::references::OnDelete::SetNull)) && name==&inv.table {
            out.insert("incoming cascade/set-null changes bypass this table's ordinary rules".into());
        }
        if inv.target=="read" {
            for rule in [&other.rules.read,&other.rules.insert,&other.rules.update,&other.rules.delete] {
                if kernel::dependencies(rule).contains(&inv.table) {out.insert(format!("raw rule probe/reference from {name} can observe {} independently of its read rule",inv.table));}
            }
        }
    }
    if schema.maintains.iter().any(|m|m.target==inv.table) && matches!(inv.target.as_str(),"insert"|"update"|"delete"|"write"|"always") {out.insert("aggregate/view target rows are written by engine maintenance independently of their direct table rules".into());}
    if !t.maintained.is_empty() && matches!(inv.target.as_str(),"write"|"update"|"always"){out.insert("engine-maintained columns bypass ordinary application write rules".into());}
    if bound.programs.iter().any(|p|matches!(p.program.kind,snapback4_core::ir::ProgramKind::Job|snapback4_core::ir::ProgramKind::Action)|p.program.native)
        || !schema.effects.is_empty() || !schema.action_specs.is_empty() {
        out.insert("system/job/action/native/external path requires a reviewed reduction; no affected-table inference is assumed".into());
    }
    if inv.target=="read" {
        for p in &bound.programs {
            let json=serde_json::to_value(&p.program).unwrap();
            if audit::mentions(&json,&inv.table) && !census::body(&p.program.body) {out.insert(format!("{}: scan/merge/loop or opaque IR path needs a reviewed read-disclosure reduction",p.program.name));}
            if audit::mentions(&json,&inv.table) && snapback4_core::ir::write_tables(&p.program).iter().any(|(target,_)|target!=&inv.table) {
                out.insert(format!("{} may copy protected data into another table; cross-table disclosure reduction is unproved",p.program.name));
            }
            if audit::mentions(&json,&inv.table) && audit::authored_refusal(&json) {out.insert(format!("{}: authored refusal observations are not reduced to this read policy",p.program.name));}
        }
    }
    out.into_iter().collect()
}

pub fn add_source_notes(report:&mut Report,sources:&[(String,String)],bound:&Bound){
    report.notes.extend(lints::source_notes(sources,bound));
    let mut sites=BTreeMap::new();
    for (file,source) in sources{let (doc,_)=crate::parse_document(file,source);for t in doc.tables{
        sites.insert(t.name.clone(),t.site.clone());for c in t.columns{sites.insert(format!("{}.{}",t.name,c.name),c.site);}
        for r in t.rules{sites.insert(format!("{}.{}",t.name,r.effect.word()),r.site);}
    }}
    for note in &mut report.notes{if note.site.line==0 {
        let key=note.message.split([' ',':']).next().unwrap_or("");
        note.site=sites.get(key).or_else(||sites.get(key.split('.').next().unwrap_or(""))).cloned().unwrap_or_else(||Site::new(sources.first().map(|s|s.0.as_str()).unwrap_or("schema.q"),1,1));
    }}
}
