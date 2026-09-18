//! Host opening input. The first-install envelope deliberately is not a
//! Backend: older modules reject it rather than silently installing it.
use crate::{device::{Backend, Device}, store::DeviceStore};
use snapback4_core::{error::RuntimeError, json_codec};

pub enum Opening {
    Kept,
    Install(Backend),
    Initial(Backend),
}

impl Opening {
    pub fn parse(text: Option<&str>) -> Result<Self, RuntimeError> {
        #[derive(serde::Deserialize)]
        struct Initial { initial_backend: Backend }
        match text {
            None | Some("") | Some("null") => Ok(Self::Kept),
            Some(text) => {
                if let Ok(initial) = json_codec::from_text::<Initial>(text) { return Ok(Self::Initial(initial.initial_backend)); }
                json_codec::from_text(text).map(Self::Install).map_err(|e| RuntimeError::Input(e.to_string()))
            }
        }
    }

    pub fn open<S: DeviceStore>(self, store: S) -> Result<Device<S>, RuntimeError> {
        match self {
            Self::Kept => Device::open_store(store, None),
            Self::Install(backend) => Device::open_store(store, Some(backend)),
            Self::Initial(backend) => Device::open_store_initial(store, backend),
        }
    }
}
