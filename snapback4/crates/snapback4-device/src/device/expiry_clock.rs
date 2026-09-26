//! Authoritative time publishes in the same transaction as its images and replay.
// @ref LLP 3000.014#5 — expiry never moves behind the last applied server change.
use super::*;
pub(super) const KEY: &str = "device:expiry-clock";
pub(super) const STAGED: &str = "device:snapshot:expiry-clock";
fn read(tx: &dyn crate::store::StreamTx, key: &str) -> Result<Option<i64>, RuntimeError> {
    tx.meta(key)?.map(|text| text.parse().map_err(|_| RuntimeError::Store("invalid device expiry clock".into()))).transpose()
}
pub(super) fn now<T: DeviceTx>(tx: &T, local: i64) -> Result<i64, RuntimeError> { Ok(read(tx, KEY)?.map_or(local, |server| server.max(local))) }
pub(super) fn advance(tx: &dyn crate::store::StreamTx, key: &str, server: Option<i64>) -> Result<bool, RuntimeError> {
    let Some(server) = server else { return Ok(false) };
    if !(snapback4_core::value::I53_MIN..=snapback4_core::value::I53_MAX).contains(&server) { return Err(RuntimeError::Input("sync clock is outside the time range".into())); }
    if read(tx,key)?.is_some_and(|old| old >= server) { return Ok(false); }
    tx.set_meta(key,&server.to_string())?;
    Ok(true)
}
pub(super) fn publish<T:DeviceTx>(tx:&T)->Result<(),RuntimeError> { advance(tx,KEY,read(tx,STAGED)?)?; Ok(()) }
