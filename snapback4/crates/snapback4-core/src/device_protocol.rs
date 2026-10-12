//! Engine identity is supplied by the binary, never by the app's JS version.
// @ref LLP 3000.001.000#protocol — compatibility admission precedes backend/page decoding.
use serde::{Deserialize, Serialize};
use crate::{Schema, error::Refusal};

pub const FLOOR: &str = "0.4.24";
pub const GENERATION: &str = "sync-generation-v1";
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeviceEngine {
    pub format: u32,
    pub version: String,
    pub capabilities: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Compatibility {
    pub server_version: &'static str,
    pub minimum_version: &'static str,
    pub capabilities: Vec<String>,
}
impl DeviceEngine {
    pub fn current() -> Self {
        let mut capabilities = Schema::supported_capabilities();
        capabilities.push(GENERATION.into()); capabilities.sort();
        Self { format: 1, version: env!("CARGO_PKG_VERSION").into(), capabilities }
    }
}
pub fn compatibility(schema: &Schema) -> Compatibility {
    let mut capabilities: Vec<_> = schema.required_capabilities().into_iter().collect();
    capabilities.push(GENERATION.into()); capabilities.sort();
    Compatibility { server_version: env!("CARGO_PKG_VERSION"), minimum_version: FLOOR, capabilities }
}
fn version(text: &str) -> Option<(u32, u32, u32)> {
    let mut parts = text.split('.');
    let result = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    parts.next().is_none().then_some(result)
}
pub fn check(device: Option<&DeviceEngine>, required: &Compatibility) -> Result<(), Refusal> {
    let missing = match device {
        None => "engine-handshake-v1",
        Some(d) if d.format != 1 => "engine-handshake-v1",
        Some(d) => required.capabilities.iter().find(|cap| !d.capabilities.contains(cap)).map(String::as_str)
            .unwrap_or_else(|| if version(&d.version).zip(version(required.minimum_version)).is_none_or(|(d, floor)| d < floor) { "device-compatibility-floor" } else { "" }),
    };
    if missing.is_empty() { return Ok(()); }
    let device_version = device.map(|d| d.version.as_str()).unwrap_or("unknown (unstamped)");
    let rebuild = format!("Exact: bun exact.mjs snapback; Expo: npx expo run:ios; web: install snapback4@{} and rebuild the web app", required.server_version);
    Err(Refusal::new("E_DEVICE_VERSION", "device-version", format!("device engine {device_version} lacks {missing} (server {}, device floor {}); rebuild the device: {rebuild}", required.server_version, required.minimum_version)).guide("wire"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn floor_and_capabilities_are_independent_and_future_versions_need_capabilities() {
        let required = compatibility(&Schema::default());
        let mut d = DeviceEngine::current(); check(Some(&d), &required).unwrap();
        d.version = "0.4.23".into(); assert_eq!(check(Some(&d), &required).unwrap_err().code, "E_DEVICE_VERSION");
        d.version = "9.0.0".into(); d.capabilities.clear();
        let why = check(Some(&d), &required).unwrap_err(); assert!(why.message.contains(GENERATION));
        assert!(why.message.contains("9.0.0") && why.message.contains(required.server_version));
        assert_eq!(check(None, &required).unwrap_err().code, "E_DEVICE_VERSION");
    }
}
