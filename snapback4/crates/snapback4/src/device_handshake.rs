//! Host-side admission of actual device engine builds.
// @ref LLP 3000.001.000#protocol — authenticate first; refuse before decoding version-sensitive fields.
use crate::serve::{Shared, lock};
use snapback4_core::{device_protocol::{self, DeviceEngine}, error::Refusal};
use tiny_http::Request;
pub fn header(request: &Request) -> Option<&str> {
    request.headers().iter().find(|h| h.field.equiv("x-snapback-device")).map(|h| h.value.as_str())
}
pub fn check(shared: &Shared, text: Option<&str>, required: bool) -> Result<(), Refusal> {
    if !required && text.is_none() { return Ok(()); } // one-shot/online clients have no replica
    let bound = lock(&shared.bound);
    check_schema(&bound.schema.public_projection(), text, required)
}
pub fn check_schema(schema: &snapback4_core::Schema, text: Option<&str>, required: bool) -> Result<(), Refusal> {
    if !required && text.is_none() { return Ok(()); }
    let device = text.and_then(|text| serde_json::from_str::<DeviceEngine>(text).ok());
    device_protocol::check(device.as_ref(), &device_protocol::compatibility(schema))
}
