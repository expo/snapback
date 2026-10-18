//! Typed server-clock facts used only by the proof abstraction, never runtime rules.
// @ref LLP 3000.036.004#102-temporal-intent — lifetime is independent of physical sweep lag.
use super::*;
use snapback4_core::{Value, ir::BinaryOp as Op, schema::{Table, ColumnType}};
// Quarry identifiers cannot contain ':'. No authored field aliases this atom.
const CLOCK: &str = "$security:server-clock";
pub(super) fn clock() -> RuleTerm { RuleTerm::Field(CLOCK.into()) }
pub(super) fn has_clock(rule: &RuleExpr) -> bool {
    rule.any_term(&|t| matches!(t, RuleTerm::Field(f) if f == CLOCK))
}
pub(super) fn comparison(op: Op, a: RuleTerm, b: RuleTerm) -> RuleExpr {
    match op {
        Op::Gt => RuleExpr::Compare(Op::Lt,b,a), Op::Gte => RuleExpr::Compare(Op::Lte,b,a),
        Op::Eq => RuleExpr::Eq(a,b), Op::Ne => RuleExpr::Ne(a,b),
        _ => RuleExpr::Compare(op,a,b),
    }
}
pub(super) fn admission(table: &Table) -> RuleExpr {
    let mut facts = vec![table.rules.read.clone()];
    for (column,op) in table.not_before.iter().map(|f|(f,Op::Lte)).chain(table.expire.iter().map(|f|(f,Op::Gt))) {
        let field=RuleTerm::Field(column.clone());
        let edge=comparison(op,field.clone(),clock());
        let edge=if table.columns.get(column).is_some_and(ColumnType::is_optional) {
            RuleExpr::Or(vec![RuleExpr::Eq(field,RuleTerm::Literal(Value::Null)),edge])
        } else {edge};
        facts.push(edge);
    }
    RuleExpr::And(facts)
}

pub(super) fn bind(catalog: &Catalog, info: &super::super::catalog::TableInfo, expr: &ast::Expr) -> Option<RuleExpr> {
    use ast::{Expr,Literal,TypeKind};
    fn term(info:&super::super::catalog::TableInfo,e:&Expr)->Option<RuleTerm>{match e {
        Expr::Name{name,..} if name=="now" => Some(clock()),
        Expr::Member{base,name,..} if matches!(base.as_ref(),Expr::Focal{..}) && info.columns.get(name).is_some_and(|t|t.kind==TypeKind::Time) => Some(RuleTerm::Field(name.clone())),
        Expr::Literal{value:Literal::Number(n),..}=>Some(RuleTerm::Literal(Value::Int(n.parse().ok()?))),
        Expr::Literal{value:Literal::Null,..}=>Some(RuleTerm::Literal(Value::Null)),
        _=>None,
    }}
    if let Expr::Binary{op,left,right,..}=expr {
        if op=="and"||op=="or" {
            let xs=vec![bind(catalog,info,left)?,bind(catalog,info,right)?];
            return Some(if op=="and"{RuleExpr::And(xs)}else{RuleExpr::Or(xs)});
        }
        let op=match op.as_str(){"="=>Op::Eq,"!="=>Op::Ne,"<"=>Op::Lt,"<="=>Op::Lte,">"=>Op::Gt,">="=>Op::Gte,_=>return None};
        if let (Some(a),Some(b))=(term(info,left),term(info,right)){return Some(comparison(op,a,b));}
    }
    if let Expr::Unary{op,value,..}=expr && op=="not" {return Some(RuleExpr::Not(Box::new(bind(catalog,info,value)?)));}
    let rule=ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value:expr.clone(),site:expr.site().clone()};
    super::super::schema::bind_rule(catalog,info,&rule).ok()
}
