//! Advisory mismatches between a program's caller gate and its table rule.
use super::catalog::Catalog;
use crate::{ast::*, Diagnostic};
use snapback4_core::schema::{Schema, RuleExpr, RuleTerm};
use std::collections::BTreeMap;
fn seat(expr: &Expr) -> Option<&str> {
    let Expr::Binary { op,left,right,.. }=expr else { return None; };
    if op == "and" { return seat(left).or_else(|| seat(right)); }
    if op != "=" { return None; }
    let name = |e: &Expr| matches!(e, Expr::Name { name,.. } if name == "viewer");
    let value = if name(left) { right.as_ref() } else if name(right) { left.as_ref() } else { return None; };
    match value { Expr::Literal { value:Literal::Str(s),.. } if s.starts_with("service:") => Some(s), _=>None }
}
fn fields(rule: &RuleExpr) -> Vec<String> {
    match rule {
        RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Field(f))|RuleExpr::Eq(RuleTerm::Field(f),RuleTerm::Viewer)=>vec![f.clone()],
        RuleExpr::And(rs)|RuleExpr::Or(rs)=>rs.iter().flat_map(fields).collect(),
        _=>vec![]
    }
}
fn required_owners(rule:&RuleExpr)->Vec<String> {
    match rule {
        RuleExpr::And(parts)=>parts.iter().flat_map(required_owners).collect(),
        RuleExpr::Or(parts)=>{
            let Some(first)=parts.first() else {return vec![]};
            let mut common=required_owners(first);
            for part in &parts[1..] {let have=required_owners(part);common.retain(|f|have.contains(f));}
            common
        }
        other=>fields(other),
    }
}
fn admits_seat(rule: &RuleExpr, seat: &str) -> bool {
    match rule {
        RuleExpr::Allow|RuleExpr::Public { .. }=>true,
        RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Literal(v))|RuleExpr::Eq(RuleTerm::Literal(v),RuleTerm::Viewer)=>v.as_str().ok()==Some(seat),
        RuleExpr::Or(rs)=>rs.iter().any(|r|admits_seat(r,seat)),
        _=>false
    }
}
// @ref LLP 3000.036.002#7 — these notes state conditional argument requirements, never an impossibility theorem over dynamic inputs.
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut out=Vec::new();
    for doc in &catalog.documents {
        for table in &doc.tables {
            for column in &table.columns {
                if column.type_.kind==TypeKind::Principal && let Some(Expr::Literal {value:Literal::Str(value),..})=&column.default
                    && catalog.documents.iter().flat_map(|d|&d.personas).any(|p|p==value) {
                    out.push(Diagnostic::new(&column.site,"N_PERSONA_PRINCIPAL",format!("{}.{} defaults to bare persona '{value}', whose dev principal is 'dev:{value}'",table.name,column.name),format!("use `default 'dev:{value}'` for development, or supply the authenticated principal in the mutation for production")).guide("personas"));
                }
            }
        }
        for program in &doc.programs {
            if program.kind == ProgramKind::Query || program.native { continue; }
            body(catalog,schema,program,&program.body,None,&mut out);
        }
    }
    out
}
fn body(catalog:&Catalog,schema:&Schema,program:&ProgramDecl,statements:&[Stmt], mut gate:Option<String>,out:&mut Vec<Diagnostic>) {
    let mut lookups: BTreeMap<String,(String,Vec<String>)>=BTreeMap::new();
    for statement in statements {
        if let Stmt::Require { condition,code,site,.. }=statement {
            if let Some(seat)=seat(condition) { gate=Some(seat.into()); }
            for (alias,(table,owners)) in &lookups {
                let mut uses_owner=false; let mut copy=condition.clone();
                super::intent_walk::expression(&mut copy,&mut |e| if let Expr::Member { base,name,.. }=e && matches!(base.as_ref(),Expr::Name { name,.. } if name==alias) && owners.contains(name) { uses_owner=true; });
                if uses_owner && code != "NOT_FOUND" {
                    out.push(Diagnostic::new(site,"N_REQUIRE_HIDDEN",format!("{}: callers who cannot read {table} get NOT_FOUND at `{alias}`'s lookup, never {code} from this require",program.name),
                        format!("put a caller authorization check before the lookup if {code} must win; otherwise keep NOT_FOUND as the privacy-preserving answer and test it (guide rules)")).guide("rules"));
                }
            }
        }
        if let Stmt::Bind { names,value:Expr::Assert { value,code,.. },.. }=statement && code=="NOT_FOUND" && let Expr::Read(read)=value.as_ref() {
            if let [name]=names.as_slice() && let Some(table)=schema.table(&read.table) {
                let owners=required_owners(&table.rules.read);
                if !owners.is_empty() { lookups.insert(name.clone(),(read.table.clone(),owners)); }
            }
        }
        let mut copy=vec![statement.clone()];
        // Inspect only this statement's expressions; nested control flow receives its own gate below.
        if !matches!(statement,Stmt::If { .. }|Stmt::For { .. }|Stmt::As { .. }) {
            super::intent_walk::statements(&mut copy,&mut |expr| {
                let Expr::Write { op,table,fields:payload,site,.. }=expr else { return; };
                let Some(def)=schema.table(table) else { return; };
                for field in payload.iter() {
                    let principal=catalog.tables.get(table).and_then(|t|t.columns.get(&field.name)).is_some_and(|t|t.kind==TypeKind::Principal);
                    if principal && let Some(Expr::Literal { value:Literal::Str(value),.. })=&field.value
                        && catalog.documents.iter().flat_map(|d|&d.personas).any(|p| p==value) {
                        out.push(Diagnostic::new(&field.site,"N_PERSONA_PRINCIPAL",format!("{table}.{} stores bare persona '{value}', but its dev viewer is 'dev:{value}'",field.name),format!("write 'dev:{value}' for development, or an authenticated account principal in production; personas are names, not principals")).guide("personas"));
                    }
                }
                let Some(seat)=gate.as_deref() else { return; };
                let effect=match op { WriteOp::Insert=>"insert",WriteOp::Update=>"update", _=>return };
                let rule=if effect=="insert" { &def.rules.insert } else { &def.rules.update };
                if admits_seat(rule,seat) { return; }
                let others=required_owners(rule).into_iter().filter(|owner| payload.iter().find(|f|&f.name==owner).map_or(effect=="update",|f| {
                    let value=f.value.clone().unwrap_or_else(||Expr::Name { name:f.name.clone(),site:f.site.clone() });
                    !matches!(value,Expr::Name { ref name,.. } if name=="viewer") && !matches!(value,Expr::Literal { value:Literal::Str(ref s),.. } if s==seat)
                })).collect::<Vec<_>>();
                if others.is_empty() { return; }
                out.push(Diagnostic::new(site,"N_WRITE_DENIED",format!("{} admits only '{seat}', but {table}'s {effect} rule `{}` requires the written {} to be this caller; writing another principal's value refuses E_RULE",program.name,rule.quarry(),others.join(", ")),
                    format!("if this trusted seat should write other principals' rows, amend `{effect} <- {}` to `{effect} <- ({}) or viewer = '{seat}'`; the mutation require alone grants no table authority (guide deploy, first admin)",rule.quarry(),rule.quarry())).guide("rules"));
            });
        }
        match statement {
            Stmt::If { condition,then_body,else_body,.. }=> { body(catalog,schema,program,then_body,seat(condition).map(String::from).or_else(||gate.clone()),out); body(catalog,schema,program,else_body,gate.clone(),out); }
            Stmt::For { body:inner,.. }=>body(catalog,schema,program,inner,gate.clone(),out),
            Stmt::As { body:inner,.. }=>body(catalog,schema,program,inner,None,out),
            Stmt::Return { .. }|Stmt::Break { .. }|Stmt::Continue { .. }=>break,
            _=>{}
        }
    }
}
