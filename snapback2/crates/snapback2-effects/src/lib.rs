//! Effects run outside the data plane (LLP 0329.014.004 §2.1 D; LLP 1000).
//! Queries and mutations never reach this crate. An effect is JavaScript that
//! Ibex 2 evaluates with the grants its manifest section carries; the data
//! plane only ever sees the effect's result through the outbox.
//!
//! Without the `hermes` feature this crate is the seam alone — it links no
//! engine, so `cargo build` needs nothing beyond crates.io. With `hermes` it
//! links vanilla Hermes through Ibex 2 (see `scripts/hermes`).

use thiserror::Error;

#[derive(Debug, Error)]
pub enum EffectError {
    #[error("no JS engine in this build: {0}")]
    Unavailable(&'static str),
    #[error("effect threw: {0}")]
    Js(String),
}

/// The seam every effect goes through. One implementation per engine.
pub trait EffectHost {
    fn invoke(&mut self, source: &str) -> Result<String, EffectError>;
}

/// The host a build without `hermes` gets: every invocation refuses loudly.
pub struct NoEngine;

impl EffectHost for NoEngine {
    fn invoke(&mut self, _source: &str) -> Result<String, EffectError> {
        Err(EffectError::Unavailable(
            "built without the `hermes` feature; run scripts/hermes",
        ))
    }
}

/// What this build can run. Printed by `snapback2 doctor`.
pub fn describe() -> &'static str {
    if cfg!(feature = "hermes") {
        "ibex2 + vanilla hermes"
    } else {
        "seam only (no engine linked)"
    }
}

#[cfg(feature = "hermes")]
pub mod ibex {
    use super::{EffectError, EffectHost};
    use ibex2::engine::hermes::{DynamicCode, Hermes};

    /// Ibex 2 over vanilla Hermes with dynamic code closed at construction.
    pub struct Ibex2Host {
        rt: Hermes,
    }

    impl Ibex2Host {
        pub fn new() -> Result<Self, EffectError> {
            Hermes::new(DynamicCode::Closed)
                .map(|rt| Self { rt })
                .ok_or(EffectError::Unavailable("Hermes::new returned None"))
        }
    }

    impl EffectHost for Ibex2Host {
        fn invoke(&mut self, source: &str) -> Result<String, EffectError> {
            self.rt.eval(source).map_err(|e| EffectError::Js(e.0))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn evaluates_arithmetic() {
            let mut host = Ibex2Host::new().expect("engine");
            assert_eq!(host.invoke("1 + 1").expect("eval"), "2");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_engine_refuses_loudly() {
        let err = NoEngine.invoke("1 + 1").unwrap_err();
        assert!(matches!(err, EffectError::Unavailable(_)));
    }
}
