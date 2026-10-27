//! Optional in-memory telemetry; the CLI drains it after its verdict is complete.
use std::sync::{Mutex, OnceLock};
static ENABLED:OnceLock<bool>=OnceLock::new();
static EVENTS:Mutex<Vec<serde_json::Value>>=Mutex::new(Vec::new());
pub fn start()->Option<std::time::Instant>{
    (*ENABLED.get_or_init(||std::env::var_os("SNAPBACK4_LATENCY_TRACE").is_some())).then(std::time::Instant::now)
}
pub fn record(mut event:serde_json::Value){
    event["pid"]=std::process::id().into();
    if let Ok(mut events)=EVENTS.lock(){if events.len()<131072{events.push(event);}}
}
pub fn take()->Vec<serde_json::Value>{EVENTS.lock().map(|mut events|std::mem::take(&mut *events)).unwrap_or_default()}
