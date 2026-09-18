#![deny(unsafe_code)]
//! Snapback 4 on a device: the core's interpreter — the same programs, the
//! same words — over a store the device brings, one implementation for
//! every host (LLP 3000 §7). `device` is the device; `store` is what it
//! needs of a store; `memory` and (with `native`) the core's SQLite
//! implement it. Hosts reach it through one JSON call (`call`): the C ABI
//! (`ffi`) for Expo and Exact2, `web` as wasm for the browser, and the
//! `snapback4 device` process for Node.

pub mod call;
pub mod device;
pub mod memory;
pub mod opening;
pub mod store;

#[cfg(feature = "native")]
pub mod ffi;
#[cfg(feature = "native")]
pub mod native;
#[cfg(feature = "native")]
mod sqlite;
#[cfg(feature = "web")]
pub mod web;
