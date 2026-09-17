//! The positional backend codec. The enclosing image owns format versioning;
//! this module never guesses a schema, skips unknown values, or accepts a tail.
use serde::{Serialize, de::DeserializeOwned};
use std::fmt;

mod de;
mod ser;

#[derive(Debug)]
pub struct Error(Kind);
#[derive(Debug)]
enum Kind { Message(String), Absent }
impl Error {
    fn message(message: impl Into<String>) -> Self { Self(Kind::Message(message.into())) }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 { Kind::Message(message) => f.write_str(message), Kind::Absent => f.write_str("absent field") }
    }
}
impl std::error::Error for Error {}
impl serde::ser::Error for Error { fn custom<T: fmt::Display>(value: T) -> Self { Self::message(value.to_string()) } }
impl serde::de::Error for Error { fn custom<T: fmt::Display>(value: T) -> Self { Self::message(value.to_string()) } }

pub fn to_vec<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, Error> {
    let mut serializer = ser::Serializer(Vec::new());
    value.serialize(&mut serializer)?;
    Ok(serializer.0)
}

pub fn from_slice<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, Error> {
    let mut decoder = de::Deserializer::new(bytes);
    let value = T::deserialize(&mut decoder)?;
    if !decoder.remaining().is_empty() { return Err(Error::message("trailing bytes")); }
    Ok(value)
}
