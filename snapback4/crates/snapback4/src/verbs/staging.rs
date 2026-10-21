//! Deployment purpose belongs to the store, never to application source or a seed plan.
use std::path::Path;
use crate::store_owner::Owner;

fn production() -> String {
    "E_STAGING: existing production/legacy stores cannot be relabelled; deploy --staging into a separate fresh directory".into()
}

// @ref LLP 3000.000.000.001#1-commission-and-boundary — classify only a fresh store under its existing exclusive owner.
pub(super) fn classify(dir: &Path, owner: Option<&Owner>, existed: bool, checking: bool) -> Result<(), String> {
    let path = dir.join("store.sqlite");
    if checking && !existed { return Ok(()); }
    if let Some(owner) = owner {
        let store = owner.open_store(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
        match store.deployment_environment().map_err(|e|e.to_string())?.as_deref() {
            Some("staging") => Ok(()),
            None if !existed && !checking => store.set_deployment_environment("staging").map_err(|e|e.to_string()),
            _ => Err(production()),
        }
    } else {
        let store = snapback4_core::store_port::AnyStore::open_read_only(&path).map_err(|e|e.to_string())?;
        if store.deployment_environment().map_err(|e|e.to_string())?.as_deref() == Some("staging") { Ok(()) } else { Err(production()) }
    }
}
