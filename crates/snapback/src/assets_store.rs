//! Compatibility façade for services-owned asset byte stores.

pub use snapback_kernel::assets_store::*;
pub(crate) use snapback_services::assets_store::{
    AssetStoreBackend, AssetTusPatchGates, hash_path,
};
