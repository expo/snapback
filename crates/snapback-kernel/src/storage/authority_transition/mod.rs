//! Dormant authority-transition substrate.
//!
//! Landing A deliberately exports no ceremony and connects no legacy writer.
//! The only exercised ceremony is an owning-crate runtime probe below `core`.

mod core;
