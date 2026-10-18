//! Closed enum census: a new IR statement/expression/builtin forces review.
// @ref LLP 3000.036.004#3-sound-proof-boundary — opaque context changes are blockers.
use snapback4_core::ir::{Expr,Stmt,Builtin};
pub(super) fn body(xs:&[Stmt])->bool{xs.iter().all(|s|match s{
    Stmt::Const{value,..}|Stmt::Let{value,..}|Stmt::Assign{value,..}|Stmt::Push{value,..}|Stmt::Return(value)=>expr(value),
    Stmt::If{condition,then_body,else_body}=>expr(condition)&&body(then_body)&&body(else_body),
    Stmt::For{..}=>false,
    Stmt::Require{condition,..}|Stmt::Check{condition,..}=>expr(condition),
    Stmt::Insert{row,..}|Stmt::InsertIfAbsent{row,..}|Stmt::Upsert{row,..}=>expr(row),
    Stmt::Update{key,patch,..}=>expr(key)&&expr(patch),
    Stmt::WriteTarget{patch,condition,..}=>expr(patch)&&condition.as_ref().is_none_or(|c|body(&c.setup)&&expr(&c.value)),
    Stmt::Delete{key,..}=>expr(key),Stmt::DeleteTarget{..}|Stmt::Break|Stmt::Continue=>true,
    Stmt::Emit{..}=>false,
})}
fn expr(e:&Expr)->bool{match e{
    Expr::Literal(_)|Expr::Variable(_)|Expr::Input(_)=>true,
    Expr::Field{base,..}|Expr::Unary{value:base,..}=>expr(base),
    Expr::Array(xs)=>xs.iter().all(expr),Expr::Object(xs)=>xs.values().all(expr),
    Expr::Shape{base,fields}=>expr(base)&&fields.values().all(expr),
    Expr::Binary{left,right,..}=>expr(left)&&expr(right),
    Expr::Block{body:xs,value}=>body(xs)&&expr(value),
    Expr::Get(r)|Expr::Exists(r)=>r.key.iter().all(expr),
    Expr::Scan(_)|Expr::Merge(_)=>false,
    Expr::Builtin{builtin,args}=>pure(builtin)&&args.iter().all(expr),
}}
fn pure(b:&Builtin)->bool{match b{
    Builtin::JobAs|Builtin::JobQuery{..}=>false,
    Builtin::ProjectFields{..}|Builtin::ReceiptSettled{..}|Builtin::OptionalField{..}|Builtin::Calendar{..}|Builtin::Civil(_)|Builtin::Len|Builtin::Slice|Builtin::Concat|Builtin::Lower|Builtin::Trim|Builtin::Sha256|Builtin::Join|Builtin::Group{..}|Builtin::First|Builtin::Last|Builtin::At|Builtin::Min|Builtin::Max|Builtin::Extremum{..}|Builtin::ExtremumOf{..}|Builtin::Divmod{..}|Builtin::Divide{..}|Builtin::Sort{..}|Builtin::MentionTokens|Builtin::SearchPresent|Builtin::RequireUncapped|Builtin::DeterministicShare|Builtin::Count|Builtin::Sum|Builtin::CountCapped|Builtin::Connected=>true,
}}
