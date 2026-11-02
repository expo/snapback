//! Engine identity is supplied by the binary, never by the app's JS version.
// @ref LLP 3000.001.000#protocol — compatibility admission precedes backend/page decoding.
use serde::{Deserialize, Serialize};
use crate::{Schema, error::Refusal};

pub const FLOOR: &str = "0.4.24";
pub const PROGRESSIVE_ACQUISITION: &str = "progressive-acquisition-v1";
pub const GENERATION: &str = "sync-generation-v1";
pub const ARGUMENT_ALIAS: &str = "argument-alias-v1";
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeviceEngine {
    pub format: u32,
    pub version: String,
    pub capabilities: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Compatibility {
    // @ref LLP 3000.001.001#9-scope-compatibility-and-costs — optional server protocols do not raise device admission requirements.
    pub advertised: Vec<&'static str>,
    pub server_version: &'static str,
    pub minimum_version: &'static str,
    pub capabilities: Vec<String>,
}
impl DeviceEngine {
    pub fn current() -> Self {
        let mut capabilities = Schema::supported_capabilities();
        capabilities.push(GENERATION.into());
        capabilities.sort();
        Self { format: 1, version: env!("CARGO_PKG_VERSION").into(), capabilities }
    }
}
pub fn compatibility(schema: &Schema) -> Compatibility {
    let mut capabilities: Vec<_> = schema.required_capabilities().into_iter().collect();
    if schema.operations.values().any(|operation| operation.argument_aliases)
        && !capabilities.iter().any(|capability| capability == ARGUMENT_ALIAS) {
        capabilities.push(ARGUMENT_ALIAS.into());
    }
    capabilities.push(GENERATION.into()); capabilities.sort();
    Compatibility { advertised: vec![PROGRESSIVE_ACQUISITION], server_version: env!("CARGO_PKG_VERSION"), minimum_version: FLOOR, capabilities }
}
fn version(text: &str) -> Option<(u32, u32, u32)> {
    let mut parts = text.split('.');
    let number = |text: &str| text.bytes().all(|b| b.is_ascii_digit()).then(|| text.parse::<u32>().ok()).flatten();
    let result = (number(parts.next()?)?, number(parts.next()?)?, number(parts.next()?)?);
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
    // @ref LLP 3000.001.000#narr-stamp-diagnostics — missing identity and a stamped engine below the floor need different repair explanations.
    let state = match device {
        None => "; no valid build stamp",
        Some(d) if version(&d.version).is_none() => "; build stamp present, but engine version is invalid",
        Some(d) if version(&d.version).zip(version(required.minimum_version)).is_some_and(|(d, floor)| d < floor) => "; build stamp present, but engine predates the floor",
        Some(_) => "; build stamp present",
    };
    let rebuild = format!("Exact: bun exact.mjs snapback --rebuild; Expo: npx expo run:ios; web: install snapback4@{} and rebuild the web app", required.server_version);
    Err(Refusal::new("E_DEVICE_VERSION", "device-version", format!("device engine {device_version} lacks {missing} (server {}, device floor {}{state}); rebuild the device: {rebuild}", required.server_version, required.minimum_version)).guide("wire"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn floor_and_capabilities_are_independent_and_future_versions_need_capabilities() {
        let required = compatibility(&Schema::default());
        let mut d = DeviceEngine::current(); check(Some(&d), &required).unwrap();
        d.version = "0.4.23".into(); assert!(check(Some(&d), &required).unwrap_err().message.contains("build stamp present, but engine predates the floor"));
        d.version = "4294967296.0.0".into(); assert_eq!(check(Some(&d), &required).unwrap_err().code, "E_DEVICE_VERSION");
        d.version = "+1.2.3".into(); assert_eq!(check(Some(&d), &required).unwrap_err().code, "E_DEVICE_VERSION");
        d.version = "9.0.0".into(); d.capabilities.clear();
        let why = check(Some(&d), &required).unwrap_err(); assert!(why.message.contains(GENERATION));
        assert!(why.message.contains("9.0.0") && why.message.contains(required.server_version));
        let absent = check(None, &required).unwrap_err(); assert_eq!(absent.code, "E_DEVICE_VERSION"); assert!(absent.message.contains("no valid build stamp"));
    }
    #[test]
    fn argument_aliases_fence_engines_that_would_ignore_program_metadata() {
        let mut schema = Schema::default();
        schema.operations.insert("q".into(), crate::schema::Execution { argument_aliases: true, ..Default::default() });
        let required = compatibility(&schema);
        assert!(required.capabilities.contains(&ARGUMENT_ALIAS.into()));
        let mut old = DeviceEngine::current();
        old.version = "9.0.0".into();
        old.capabilities.retain(|capability| capability != ARGUMENT_ALIAS);
        let refusal = check(Some(&old), &required).unwrap_err();
        assert_eq!(refusal.code, "E_DEVICE_VERSION");
        assert!(refusal.message.contains(ARGUMENT_ALIAS));
    }
}
