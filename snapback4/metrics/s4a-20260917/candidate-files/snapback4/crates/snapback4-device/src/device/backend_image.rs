//! A backend image is versioned independently of its generation and store id.
use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};

pub const IMAGE_VERSION: u8 = 1;
pub(super) const BACKEND_IMAGE: &str = "device:backend_image";

#[derive(Clone, Debug)]
pub struct BackendImage {
    pub bytes: Vec<u8>,
    pub identity: String,
    pub host_json: String,
}

pub fn image_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::Structural { code: "E_BACKEND_IMAGE", message: message.into() }
}

pub fn decode_image(bytes: &[u8]) -> Result<Backend, RuntimeError> {
    if bytes.get(..4) != Some(b"SB4B") { return Err(image_error("backend image has the wrong magic or is truncated")); }
    if bytes.get(4) != Some(&IMAGE_VERSION) { return Err(image_error("unsupported backend image version; reconnect with a matching runtime")); }
    snapback4_core::compact::from_slice(&bytes[5..]).map_err(|e| image_error(format!("invalid backend image: {e}")))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn encode_image(backend: &Backend) -> Result<Vec<u8>, RuntimeError> {
    let mut bytes = b"SB4B".to_vec();
    bytes.push(IMAGE_VERSION);
    bytes.extend(snapback4_core::compact::to_vec(backend).map_err(|e| image_error(e.to_string()))?);
    Ok(bytes)
}

pub(super) struct Prepared {
    pub backend: Backend,
    pub identity: String,
    pub host_json: String,
    pub image: String,
}
impl Prepared {
    pub fn image(image: BackendImage) -> Result<Self, RuntimeError> {
        let mut backend = decode_image(&image.bytes)?;
        backend.schema.prepare_contribution_indexes();
        if image.identity.len() != 64 || !image.identity.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(image_error("backend identity is a lowercase SHA-256 digest"));
        }
        #[cfg(not(target_arch = "wasm32"))]
        if store_identity::backend_identity(&backend) != image.identity { return Err(image_error("backend image identity does not match its contents")); }
        Ok(Self { backend, identity: image.identity, host_json: image.host_json, image: STANDARD.encode(image.bytes) })
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn json(mut backend: Backend) -> Result<Self, RuntimeError> {
        backend.schema.prepare_contribution_indexes();
        let identity = store_identity::backend_identity(&backend);
        let host_json = encoded(&backend)?;
        Ok(Self { backend, identity, host_json, image: String::new() })
    }
    pub fn kept<S: DeviceStore>(store: &S) -> Result<Self, RuntimeError> {
        if let Some(image) = store.meta(BACKEND_IMAGE)?.filter(|text| !text.is_empty()) {
            return Self::image(BackendImage {
                bytes: STANDARD.decode(image).map_err(|e| image_error(format!("invalid kept backend image: {e}")))?,
                identity: store.meta(BACKEND_IDENTITY)?.ok_or_else(|| image_error("the kept backend image has no identity"))?,
                host_json: store.meta(BACKEND)?.ok_or_else(|| image_error("the kept backend image has no host JSON"))?,
            });
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let text = store.meta(BACKEND)?.ok_or_else(|| RuntimeError::Auth("this device has never synced: the server must be reachable once to open".into()))?;
            Self::json(snapback4_core::json_codec::from_text(&text).map_err(|e| RuntimeError::Store(format!("the kept backend does not parse: {e}")))?)
        }
        #[cfg(target_arch = "wasm32")]
        Err(image_error("connect once so this device can upgrade its kept backend"))
    }
    pub fn metadata(&self) -> BTreeMap<String, String> {
        BTreeMap::from([(BACKEND.to_owned(), self.host_json.clone()), (BACKEND_IMAGE.to_owned(), self.image.clone()),
            (GENERATION.to_owned(), self.backend.generation.to_string()), (BACKEND_IDENTITY.to_owned(), self.identity.clone())])
    }
}

pub(super) fn previous<S: DeviceStore>(store: &S) -> Result<Option<Backend>, RuntimeError> {
    if let Some(image) = store.meta(BACKEND_IMAGE)?.filter(|text| !text.is_empty()) {
        let bytes = STANDARD.decode(image).map_err(|e| image_error(format!("invalid kept backend image: {e}")))?;
        return decode_image(&bytes).map(Some);
    }
    #[cfg(not(target_arch = "wasm32"))]
    { Ok(store.meta(BACKEND)?.and_then(|text| snapback4_core::json_codec::from_text::<Backend>(&text).ok())) }
    #[cfg(target_arch = "wasm32")]
    { Ok(None) }
}
