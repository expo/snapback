//! Compiled interface shared by the delivery producer and device consumer.
use serde::{Deserialize, Serialize};

// @ref LLP 3000.022#2.1 — the compiled reporter names coordinates and argument order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryBinding {
    pub table: String,
    pub group: String,
    pub position: String,
    pub mutation: String,
    pub args: [String; 3],
}

