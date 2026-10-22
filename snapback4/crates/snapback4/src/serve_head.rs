//! Read-only durable metadata and request store binding.
use super::*;

pub(super) fn response_head(engine: &mut Engine) -> Result<(String, u64), Refusal> {
    let tx = engine.store_mut().read_transaction()?;
    let id: String = tx.store_id()?;
    Ok((id, tx.next_seq()? - 1))
}

// @ref LLP 3000.013#6 — a replay belongs to its acknowledged store, even if
// the endpoint changes between the client's probe and this transaction.
pub(super) fn intent_store(engine: &Engine, payload: &Json) -> Result<(), Refusal> {
    let Some(expected) = payload.get("store_id").filter(|id| !id.is_null()) else {
        return Ok(());
    };
    let current = engine.store().store_identity()?;
    if expected
        .as_str()
        .is_some_and(|id| Some(id) == current.as_deref())
    {
        return Ok(());
    }
    Err(Refusal::new(
        "E_STORE_REPLACED",
        "store",
        "the intent belongs to another store; its original outcome is unknown",
    )
    .site("request.store_id")
    .rewrite("reconcile this write with its original store before submitting new intent")
    .guide("sync"))
}

// Typed mutation inputs have one terminal failure envelope, including wire decoding.
pub(super) fn argument_refusal(request:Request,shared:&Shared,id:Option<&str>,why:Refusal){
    if !request.url().starts_with("/m/") {return operation_refusal(request,shared,400,why);}
    match shared.read_identity() {
        Ok((store_id,head,generation))=>{
            let mut reply=json!({"state":"failed","why":refusal_json(&why),"store_id":store_id,"head":head,"generation":generation});
            if let Some(id)=id {reply["id"]=json!(id);}
            respond_timed(request,shared,200,reply);
        }
        Err(error)=>respond_timed(request,shared,503,json!({"denied":refusal_json(&error)})),
    }
}
