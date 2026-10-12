//! Device-owned upload dependency: the byte copy travels with one outbox value.
use super::*;
use serde_json::{Value as Json, json};
use snapback4_core::ir::ArgType;
const MAX_BYTES: usize = 64 << 20;
const MAX_QUEUED_BYTES: usize = 128 << 20;
fn refused(code: &'static str, message: &str) -> RuntimeError { RuntimeError::Structural { code, message: message.into() } }
fn string<'a>(upload: &'a Json, key: &str) -> Result<&'a str, RuntimeError> {
    upload.get(key).and_then(Json::as_str).ok_or_else(|| RuntimeError::Input(format!("upload needs {key}")))
}
pub(super) fn input(entry: &Queued) -> Option<String> {
    entry.upload.as_ref().map(|u| if u.get("bytes").and_then(Json::as_str).is_some() {
        snapback4_core::value::digest(&(u.get("bytes"), u.get("argument"), u.get("file"), &entry.args))
    } else { u.get("fingerprint").and_then(Json::as_str).unwrap_or("").to_owned() })
}
fn compare_terminal(entry:&Queued,write:&Json)->Result<Json,RuntimeError>{
            let identity=&write["upload_identity"];
            if write["id"]!=entry.id || identity["fingerprint"].as_str()!=input(entry).as_deref() || identity["op"]!=entry.op || identity["viewer"]!=entry.viewer || identity["store_id"]!=entry.upload.as_ref().map(|u|u["store_id"].clone()).unwrap_or(Json::Null) {
                return Err(refused("E_WRITE_ID_REUSE","this id's terminal receipt belongs to different input or an ordinary mutation; use the original input or a new id"));
            }
            let mut result=write.clone();if let Some(obj)=result.as_object_mut(){obj.remove("upload_identity");}
            Ok(result)
 }
pub(super) fn terminal<T:DeviceTx>(tx:&T,entry:&Queued)->Result<Option<Json>,RuntimeError>{
    let history:Json=tx.meta("client:write-history")?.as_deref().map(decoded).transpose()?.unwrap_or(json!([]));
    history.as_array().and_then(|items|items.iter().find(|w|w["id"]==entry.id)).map(|write|compare_terminal(entry,write)).transpose()
}
pub(super) fn same_input(original:&Queued,entry:&Queued)->bool{
    original.op==entry.op&&original.viewer==entry.viewer&&input(original)==input(entry)
      &&original.upload.as_ref().and_then(|u|u.get("original_args")).unwrap_or(&original.args)==entry.upload.as_ref().and_then(|u|u.get("original_args")).unwrap_or(&entry.args)
      &&original.upload.as_ref().map(|u|u.get("store_id"))==entry.upload.as_ref().map(|u|u.get("store_id"))
}
fn fits_upload_bytes(held:usize,added:usize)->bool{added<=MAX_BYTES&&held.saturating_add(added)<=MAX_QUEUED_BYTES}
fn held_bytes<T: DeviceTx>(tx: &T) -> Result<usize, RuntimeError> {
    let mut held=0usize;
    for data in tx.outbox_entries()? {
        let entry: Queued=decoded(&data)?;
        held=held.saturating_add(entry.upload.as_ref().and_then(|u|u.get("bytes")).and_then(Json::as_str).map_or(0,|b|b.len()/2));
    }
    Ok(held)
}
pub(super) fn transfer<T: DeviceTx>(tx: &T, entry: &Queued) -> Result<(), RuntimeError> {
    if let Some(upload)=&entry.upload {
        let bytes=upload.get("bytes").and_then(Json::as_str).unwrap_or("");
        if !fits_upload_bytes(held_bytes(tx)?,bytes.len()/2) {
            return Err(refused("E_UPLOAD_QUOTA","destination upload custody is full; keep this entry with its source owner until capacity is available"));
        }
    }
    Ok(())
}
fn asset_argument(kind: &ArgType) -> bool {
    match kind { ArgType::Optional(k) => asset_argument(k), ArgType::Image { .. } | ArgType::Video { .. } | ArgType::File { .. } => true, _ => false }
}
// @ref LLP 3000.038.000#2 — bounded immutable input, custody committed before transport.
pub(super) fn validate<T: DeviceTx>(tx: &T, entry: &mut Queued, programs: &BTreeMap<String, Program>) -> Result<(), RuntimeError> {
    let fingerprint = input(entry).unwrap();
    let upload = entry.upload.as_mut().unwrap();
    let bytes = string(upload, "bytes")?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES * 2 || bytes.len() % 2 != 0 || !bytes.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err(refused("E_UPLOAD_BYTES", "upload bytes must be nonempty lowercase hex, at most 64 MiB"));
    }
    let size = bytes.len() / 2;
    if !fits_upload_bytes(held_bytes(tx)?,size) { return Err(refused("E_UPLOAD_QUOTA", "unresolved upload bytes exceed the device's 128 MiB admission allowance")); }
    if encoded(&entry.args)?.len()>64<<10{return Err(refused("E_UPLOAD_ARGUMENT","placing arguments exceed 64 KiB; pass row references instead of embedding large data"));}
    if let Some(file)=upload.get("file") {
        let object=file.as_object().ok_or_else(||refused("E_UPLOAD_ARGUMENT","file metadata must be a name/type object"))?;
        if object.keys().any(|k|k!="name"&&k!="type")||file.get("name").and_then(Json::as_str).is_none_or(|n|n.len()>255)||file.get("type").is_some_and(|t|t.as_str().is_none_or(|t|t.len()>128)){
            return Err(refused("E_UPLOAD_ARGUMENT","normalize file metadata: filename at most 255 UTF-8 bytes and media type at most 128 bytes"));
        }
    }
    let envelope=json!({"op":entry.op,"args":entry.args,"argument":upload.get("argument"),"file":upload.get("file")});
    if encoded(&envelope)?.len()>96<<10{return Err(refused("E_UPLOAD_ARGUMENT","complete placement metadata exceeds 96 KiB; pass row references and normalized filename/type"));}
    let argument = string(upload, "argument")?;
    let args = entry.args.as_object().ok_or_else(|| RuntimeError::Input("placing args must be an object".into()))?;
    if args.contains_key(argument) || !programs.get(&entry.op).is_some_and(|p| p.kind == snapback4_core::ProgramKind::Mutation && p.args.get(argument).is_some_and(asset_argument)) {
        return Err(refused("E_UPLOAD_ARGUMENT", "omit one declared image, video or file argument from a mutation; name it in argument"));
    }
    if entry.id.is_empty() || entry.id.len() > 128 || !entry.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') || entry.viewer.is_empty() {
        return Err(refused("E_UPLOAD_INTENT", "an upload intent needs its viewer and a stable id of 1–128 ASCII letters, digits, hyphens or underscores"));
    }
    let store = tx.meta(STORE_ID)?.filter(|s| !s.is_empty()).ok_or_else(|| refused("E_ADMISSION_STORE", "identify the backend once before admitting offline uploads"))?;
    if upload.get("store_id").and_then(Json::as_str) != Some(&store) { return Err(refused("E_STORE_REPLACED", "upload capture belongs to another backend store")); }
    upload["state"] = json!("queued"); upload["fingerprint"] = json!(fingerprint);
    upload["original_args"] = entry.args.clone(); upload["asset"] = Json::Null; upload["why"] = Json::Null;
    entry.predicted.clear();
    Ok(())
}
pub(super) fn require_ready(entry: &Queued) -> Result<(), RuntimeError> {
    if entry.upload.as_ref().is_some_and(|u| u.get("state").and_then(Json::as_str) != Some("placing")) {
        return Err(refused("E_UPLOAD_PENDING", "the placing mutation is held until its asset upload is durably ready"));
    }
    Ok(())
}
impl<S: DeviceStore> Device<S> {
    /// Compare retained terminal ownership before an upload admission can reuse an id.
    pub fn upload_terminal(&mut self,entry:&Queued)->Result<Option<Json>,RuntimeError>{
        let tx=self.store.read_transaction()?;
        store_identity::require_owner(&tx,&self.backend_identity,&self.store_identity,self.native_digest.as_deref())?;
        store_identity::require_healthy(&tx)?;
        let result=terminal(&tx,entry)?;tx.rollback()?;Ok(result)
    }
    /// Host-verified shared terminal ownership is checked before any retention trimming.
    pub fn check_upload_receipt(&mut self,entry:&Queued,write:&Json)->Result<Json,RuntimeError>{
        let tx=self.store.read_transaction()?;
        store_identity::require_owner(&tx,&self.backend_identity,&self.store_identity,self.native_digest.as_deref())?;
        store_identity::require_healthy(&tx)?;
        let local=terminal(&tx,entry)?;
        let shared=compare_terminal(entry,write)?;
        let result=match local {Some(old) if old["why"]["code"]!="E_STORE_REPLACED"=>old,_=>shared};
        tx.rollback()?;Ok(result)
    }
    pub fn upload_state(&mut self, id: &str, viewer: &str, state: &str, why: Option<&Json>) -> Result<Json, RuntimeError> {
        let tx = self.store.transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        store_identity::require_healthy(&tx)?;
        let Some(data) = tx.outbox_get(id)? else { return Ok(Json::Null) };
        let mut entry: Queued = decoded(&data)?;
        if entry.viewer != viewer { return Err(refused("E_AUTH", "upload intent belongs to another viewer")); }
        let upload = entry.upload.as_mut().ok_or_else(|| refused("E_UPLOAD_INTENT", "this write has no upload dependency"))?;
        if (upload["state"] == "placing" && state != "cancelling") || (upload["state"] == "cancelling" && state!="cancelling") { tx.rollback()?; return snapback4_core::json_codec::to_value(&entry).map_err(|e| RuntimeError::Store(e.to_string())); }
        if !matches!(state, "queued" | "uploading" | "blocked" | "cancelling") { return Err(RuntimeError::Input("upload state is queued, uploading or blocked".into())); }
        if state == "cancelling" && entry.dispatch.is_some() { return Err(refused("E_UPLOAD_DISPATCHED", "placement dispatch already began; recover the existing receipt")); }
        upload["state"] = json!(state); upload["why"] = why.cloned().unwrap_or(Json::Null);
        predictions::enqueue(&tx, &entry)?; tx.commit()?;
        snapback4_core::json_codec::to_value(&entry).map_err(|e| RuntimeError::Store(e.to_string()))
    }
    // @ref LLP 3000.038.000#3 — facts, dependency release and byte disposal share one commit.
    pub fn upload_ready(&mut self, id: &str, viewer: &str, store: &str, asset: &Json) -> Result<Json, RuntimeError> {
        let tx = self.store.transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        store_identity::require_healthy(&tx)?;
        let Some(data) = tx.outbox_get(id)? else { return Ok(Json::Null) };
        let mut entry: Queued = decoded(&data)?;
        if entry.viewer != viewer { return Err(refused("E_AUTH", "upload intent belongs to another viewer")); }
        let upload = entry.upload.as_mut().ok_or_else(|| refused("E_UPLOAD_INTENT", "this write has no upload dependency"))?;
        if upload.get("store_id").and_then(Json::as_str) != Some(store) || tx.meta(STORE_ID)?.as_deref() != Some(store) {
            return Err(refused("E_STORE_REPLACED", "upload receipt belongs to another backend store"));
        }
        if upload["state"] == "cancelling" { return Err(refused("E_UPLOAD_CANCELLED", "upload intent is being cancelled")); }
        if upload["state"] == "placing" {
            if upload["asset"] != *asset { return Err(refused("E_ASSET_INTENT_REUSE", "intent already holds different upload facts")); }
            tx.rollback()?;
            return snapback4_core::json_codec::to_value(&entry).map_err(|e| RuntimeError::Store(e.to_string()));
        }
        let argument = string(upload, "argument")?.to_owned();
        let kind = self.programs.get(&entry.op).and_then(|p| p.args.get(&argument)).ok_or_else(|| refused("E_UPLOAD_ARGUMENT", "placing operation changed; discard this intent and select the file again"))?;
        wire::from_json(kind, asset).map_err(RuntimeError::Input)?;
        let asset_id = asset.get("id").and_then(Json::as_str).ok_or_else(|| RuntimeError::Input("upload facts need id".into()))?;
        tx.set_meta(&media::upload_key(viewer, asset_id), &encoded(asset)?)?;
        entry.args[&argument] = asset.clone();
        upload["asset"] = asset.clone(); upload["state"] = json!("placing"); upload["bytes"] = Json::Null; upload["why"] = Json::Null;
        predictions::enqueue(&tx, &entry)?; tx.commit()?;
        snapback4_core::json_codec::to_value(&entry).map_err(|e| RuntimeError::Store(e.to_string()))
    }
}

#[cfg(test)]mod bounds{
    use super::*;
    #[test]fn admission_and_recovery_share_exact_decoded_byte_edges(){
        assert!(fits_upload_bytes(0,64*1024*1024));
        assert!(fits_upload_bytes(64*1024*1024,64*1024*1024));
        assert!(fits_upload_bytes(128*1024*1024,0));
        assert!(!fits_upload_bytes(128*1024*1024,1));
        assert!(!fits_upload_bytes(0,64*1024*1024+1));
        assert!(!fits_upload_bytes(usize::MAX,1));
    }
}
