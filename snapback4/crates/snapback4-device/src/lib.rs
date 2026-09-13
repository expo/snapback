#![deny(unsafe_code)]
//! Snapback 4 on a device: the core's interpreter — the same programs, the
//! same words — over a store the device brings. Two hosts:
//!
//! - `native`: the module for Expo and for Exact2's Apple and Linux hosts.
//!   The core's own SQLite holds the partition in the server's layout; the
//!   module applies the stream, keeps the outbox, answers queries and
//!   predictions, and speaks one JSON call over a C ABI (`ffi`). The
//!   JavaScript client keeps only the session, the link and the transport.
//! - `web`: the interpreter as wasm over a web host's callbacks, kept for
//!   measurement (LLP 2000.000 §9): at 194 KB gzip the web keeps its
//!   TypeScript twin.

#[cfg(feature = "native")]
pub mod ffi;
#[cfg(feature = "native")]
pub mod native;
#[cfg(feature = "web")]
pub mod web;
