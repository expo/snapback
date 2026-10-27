//! Only current unredacted campaign evidence can evaluate a stored answer.
// @ref LLP 3000.036.004.002#s3-evaluated-answers — evaluation is regenerated, never read from a witness cache.
use super::*;
pub(super) fn lines(project:&Project,options:&Options)->Vec<String>{
 let mut reasons=super::super::super::security_reviews::answer_reasons(project);
 if let Some(reason)=options.flags.get("reason"){reasons.push(reason.clone());}
 reasons.into_iter().flat_map(|reason|reason.split(';').map(str::trim).filter(|line|line.starts_with("allow ")||line.starts_with("invariant ")).map(str::to_owned).collect::<Vec<_>>()).collect::<std::collections::BTreeSet<_>>().into_iter().collect()
}
pub(super) fn attach(sources:&[(String,String)],bound:&Bound,inv:&security::Invariant,c:&Counterexample,lines:&[String],value:&mut serde_json::Value){
 value["answerRequired"]=true.into();
 value["intentAnswers"]=json!(lines.iter().map(|line|challenges::intent_answers::evaluate(sources,bound,inv,c,line)).collect::<Vec<_>>());
}
