//! Private authority-transition substrate.
//!
//! Landing A deliberately exposes no ceremony and connects no legacy writer
//! to this module. Later LLP 0313 landings move complete ceremonies behind
//! this boundary before enabling its authorizer on serving connections.
//!
//! @ref LLP 0313#3-module-and-visibility-design — evidence, permits, verified
//! components, and writers remain under one private storage child.

#![allow(dead_code)]

mod core;
